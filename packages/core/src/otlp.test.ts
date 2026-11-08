// packages/core/src/otlp.test.ts
import { describe, expect, it } from 'vitest';
import { decodeOtlpLogs, encodeOtlpLogs, type LogRecord } from './otlp.js';

const SCOPE = { name: 'test-scope', version: '1.2.3' };

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    eventName: 'ux.click',
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    attributes: { 'session.id': 's1', 'ux.seq': 1 },
    resource: { 'service.name': 'app', 'service.version': '4.2.1' },
    ...overrides,
  };
}

describe('encodeOtlpLogs → decodeOtlpLogs', () => {
  it('round-trips an interaction-shaped record unchanged', () => {
    const input = record({
      attributes: {
        'session.id': 's1',
        'ux.seq': 42,
        'ux.active_ms': 12.5,
        'ux.component_chain': ['App', 'Nav'],
        trial: false,
      },
    });

    const [decoded] = decodeOtlpLogs(encodeOtlpLogs([input], SCOPE));

    expect(decoded).toEqual({ ...input, scope: SCOPE });
  });

  it('round-trips a map attribute and a structured body — what a finding needs', () => {
    const input = record({
      eventName: 'rastro.finding',
      attributes: {
        evidence: { sessions: ['s1', 's2'], first: { session: 's1', seq: 7 } },
      },
      body: {
        kind: 'rage_click',
        steps: [
          { session: 's1', seq: 7 },
          { session: 's2', seq: 3 },
        ],
        nested: [[1, 2], { deep: true }],
      },
    });

    const [decoded] = decodeOtlpLogs(encodeOtlpLogs([input], SCOPE));

    expect(decoded?.attributes).toEqual(input.attributes);
    expect(decoded?.body).toEqual(input.body);
  });

  it('round-trips a plain string body', () => {
    const [decoded] = decodeOtlpLogs(encodeOtlpLogs([record({ body: 'hello' })], SCOPE));
    expect(decoded?.body).toBe('hello');
  });

  it('keeps one record per input and groups them by resource', () => {
    const payload = encodeOtlpLogs(
      [
        record({ resource: { 'service.name': 'a' } }),
        record({ resource: { 'service.name': 'b' } }),
        record({ resource: { 'service.name': 'a' } }),
      ],
      SCOPE,
    );

    expect(payload.resourceLogs).toHaveLength(2);
    expect(decodeOtlpLogs(payload).map((r) => r.resource['service.name'])).toEqual([
      'a',
      'a',
      'b',
    ]);
  });
});

describe('encodeOtlpLogs', () => {
  it('writes integers as int64 strings and fractions as doubles', () => {
    const payload = encodeOtlpLogs([record({ attributes: { seq: 9007199254740991, ms: 0.5 } })], SCOPE);
    const attributes = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes;

    expect(attributes).toEqual([
      { key: 'seq', value: { intValue: '9007199254740991' } },
      { key: 'ms', value: { doubleValue: 0.5 } },
    ]);
  });

  it('drops what JSON or OTLP cannot carry, rather than guessing', () => {
    const payload = encodeOtlpLogs(
      [
        record({
          attributes: {
            missing: undefined,
            empty: null,
            nan: Number.NaN,
            when: new Date(0),
            fn: () => 1,
            kept: 'yes',
          },
        }),
      ],
      SCOPE,
    );

    expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes).toEqual([
      { key: 'kept', value: { stringValue: 'yes' } },
    ]);
  });

  it('omits the body when the record has none', () => {
    const payload = encodeOtlpLogs([record()], SCOPE);
    expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]).not.toHaveProperty('body');
  });

  it('stamps every scopeLogs entry with the given scope', () => {
    const payload = encodeOtlpLogs([record()], SCOPE);
    expect(payload.resourceLogs[0]?.scopeLogs[0]?.scope).toEqual(SCOPE);
  });
});

describe('decodeOtlpLogs', () => {
  it('returns nothing, without throwing, for a payload that is not OTLP', () => {
    expect(decodeOtlpLogs(undefined)).toEqual([]);
    expect(decodeOtlpLogs(null)).toEqual([]);
    expect(decodeOtlpLogs({ resourceLogs: [{}] })).toEqual([]);
  });

  it('leaves out fields the sender left out, and keeps attributes as an object', () => {
    const [decoded] = decodeOtlpLogs({ resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }] });
    expect(decoded).toEqual({ attributes: {}, resource: {} });
  });

  it('drops bytesValue and pairs with no key', () => {
    const [decoded] = decodeOtlpLogs({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: 'blob', value: { bytesValue: 'AAEC' } },
                    { value: { stringValue: 'orphan' } },
                    { key: 'kept', value: { stringValue: 'yes' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(decoded?.attributes).toEqual({ kept: 'yes' });
  });

  it('accepts intValue sent as a JSON number, as some senders do', () => {
    const [decoded] = decodeOtlpLogs({
      resourceLogs: [
        { scopeLogs: [{ logRecords: [{ attributes: [{ key: 'n', value: { intValue: 3 } }] }] }] },
      ],
    });
    expect(decoded?.attributes).toEqual({ n: 3 });
  });
});
