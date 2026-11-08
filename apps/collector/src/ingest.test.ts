// apps/collector/src/ingest.test.ts
import { describe, expect, it } from 'vitest';
import { DERIVED_SCOPE_NAME, encodeOtlpLogs, type UxEvent } from 'rastro-core';
import { createMemoryEventStore } from './db.ts';
import { decodeOtlpLogs } from './ingest.ts';
import { buildServer } from './server.ts';

const OBSERVED = '1700000000999000000';

function event(overrides: Partial<UxEvent['attributes']> = {}): UxEvent {
  return {
    eventName: 'ux.click',
    timeUnixNano: '1700000000000000000',
    severityNumber: 9,
    attributes: {
      'session.id': 's1',
      'url.path': '/settings',
      'ux.event_id': 'e1',
      'ux.seq': 1,
      'ux.fingerprint': 'App>Nav|button|"Save"',
      'ux.anonymous_id': 'a1',
      ...overrides,
    },
    resource: { 'service.name': 'app', 'service.version': '4.2.1' },
  };
}

describe('decodeOtlpLogs (collector)', () => {
  it('round-trips what rastro-react sends, stamping the observed time', () => {
    const sent = event({ 'ux.component_chain': ['App', 'Nav'], 'ux.active_ms': 1200 });
    const { events, rejected } = decodeOtlpLogs(
      encodeOtlpLogs([sent], { name: 'rastro-react' }),
      OBSERVED,
    );

    expect(rejected).toBe(0);
    expect(events).toEqual([{ ...sent, observedTimeUnixNano: OBSERVED }]);
  });

  it('never trusts a client-sent observed time', () => {
    const sent = { ...event(), observedTimeUnixNano: '1' };
    const { events } = decodeOtlpLogs(encodeOtlpLogs([sent], { name: 'rastro-react' }), OBSERVED);
    expect(events[0]?.observedTimeUnixNano).toBe(OBSERVED);
  });

  it('drops map and mixed-array attributes, which the capture contract does not admit', () => {
    const sent = event();
    const wide = {
      ...sent,
      attributes: { ...sent.attributes, nested: { email: 'jane@x.com' }, mixed: ['a', 1] },
    };
    const { events } = decodeOtlpLogs(encodeOtlpLogs([wide], { name: 'rastro-react' }), OBSERVED);

    expect(events[0]?.attributes).not.toHaveProperty('nested');
    expect(events[0]?.attributes).not.toHaveProperty('mixed');
    expect(events[0]?.attributes['ux.fingerprint']).toBe(sent.attributes['ux.fingerprint']);
  });

  it('counts a record missing the Required set as rejected, and stores none of it', () => {
    const incomplete = { ...event(), attributes: { 'session.id': 's1' } } as unknown as UxEvent;
    const { events, rejected } = decodeOtlpLogs(
      encodeOtlpLogs([incomplete, event()], { name: 'rastro-react' }),
      OBSERVED,
    );

    expect(rejected).toBe(1);
    expect(events).toHaveLength(1);
  });
});

describe('derived records (CONSUMERS.md, rule 1)', () => {
  it('refuses a record under the derived scope even when it carries the whole Required set', () => {
    const result = decodeOtlpLogs(encodeOtlpLogs([event()], { name: DERIVED_SCOPE_NAME }), OBSERVED);

    expect(result.events).toEqual([]);
    expect(result.rejectedDerived).toBe(1);
    expect(result.rejectedNonconforming).toBe(0);
    expect(result.rejected).toBe(1);
  });

  it('accepts a third-party scope, and a record with no scope at all', () => {
    const thirdParty = decodeOtlpLogs(
      encodeOtlpLogs([event()], { name: 'someone-elses-sdk' }),
      OBSERVED,
    );
    expect(thirdParty.events).toHaveLength(1);

    const payload = encodeOtlpLogs([event()], { name: 'unused' });
    const unscoped = {
      resourceLogs: payload.resourceLogs.map((resourceLog) => ({
        ...resourceLog,
        scopeLogs: resourceLog.scopeLogs.map(({ logRecords }) => ({ logRecords })),
      })),
    };
    expect(decodeOtlpLogs(unscoped, OBSERVED).events).toHaveLength(1);
  });

  it('counts each reason separately within one payload', () => {
    const incomplete = { ...event(), attributes: { 'session.id': 's1' } } as unknown as UxEvent;
    const derived = encodeOtlpLogs([event({ 'ux.event_id': 'd1' })], { name: DERIVED_SCOPE_NAME });
    const observed = encodeOtlpLogs([event(), incomplete], { name: 'rastro-react' });
    const payload = { resourceLogs: [...derived.resourceLogs, ...observed.resourceLogs] };

    const result = decodeOtlpLogs(payload, OBSERVED);

    expect(result.events).toHaveLength(1);
    expect(result.rejectedDerived).toBe(1);
    expect(result.rejectedNonconforming).toBe(1);
    expect(result.rejected).toBe(2);
  });
});

describe('POST /v1/logs', () => {
  it('stores nothing from a derived record, and says why in partialSuccess', async () => {
    const store = createMemoryEventStore();
    const app = buildServer({ store, logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: encodeOtlpLogs([event()], { name: DERIVED_SCOPE_NAME }),
    });
    const body = response.json<{
      partialSuccess: { rejectedLogRecords?: string; errorMessage?: string };
    }>();

    expect(response.statusCode).toBe(200);
    expect(body.partialSuccess.rejectedLogRecords).toBe('1');
    expect(body.partialSuccess.errorMessage).toContain(DERIVED_SCOPE_NAME);
    expect(await store.listByApp('app')).toEqual([]);
    await app.close();
  });

  it('answers an all-accepted batch with an empty partialSuccess', async () => {
    const store = createMemoryEventStore();
    const app = buildServer({ store, logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/logs',
      payload: encodeOtlpLogs([event()], { name: 'rastro-react' }),
    });

    expect(response.json()).toEqual({ partialSuccess: {} });
    expect(await store.listByApp('app')).toHaveLength(1);
    await app.close();
  });
});
