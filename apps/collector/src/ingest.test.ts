// apps/collector/src/ingest.test.ts
import { describe, expect, it } from 'vitest';
import { encodeOtlpLogs, type UxEvent } from 'rastro-core';
import { decodeOtlpLogs } from './ingest.ts';

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
