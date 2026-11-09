// packages/core/src/derived.test.ts
import { describe, expect, it } from 'vitest';
import {
  findingId,
  FINDING_EVENT_NAME,
  isFinding,
  OUTPUT_VERSION,
  type Finding,
} from './derived.js';

const FINGERPRINT = 'App>Form|button:button|"Save: draft"';

function finding(): Finding {
  return {
    eventName: FINDING_EVENT_NAME,
    timeUnixNano: '1730300000000000000',
    severityNumber: 9,
    attributes: {
      'rastro.finding.id': findingId('rage_click', '4.2.1', FINGERPRINT),
      'rastro.finding.kind': 'rage_click',
      'ux.fingerprint': FINGERPRINT,
      'rastro.finding.occurrences': 3,
      'rastro.finding.sessions': 2,
    },
    resource: {
      'service.name': 'app',
      'service.version': '4.2.1',
      'rastro.output.version': OUTPUT_VERSION,
    },
    body: {
      evidence: [
        { 'session.id': 's1', 'ux.seq': 4 },
        { 'session.id': 's1', 'ux.seq': 9 },
        { 'session.id': 's2', 'ux.seq': 2 },
      ],
    },
  };
}

/** A finding's shape with every field open, so a test can break any one of them. */
interface LooseRecord {
  eventName: string;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
  body: { evidence: unknown[] };
}

/** A finding with one field changed. */
function withChange(change: (record: LooseRecord) => void): unknown {
  const record: LooseRecord = structuredClone(finding());
  change(record);
  return record;
}

describe('findingId', () => {
  it('puts the fingerprint last, so the id splits on its first two separators', () => {
    const id = findingId('rage_click', '4.2.1', FINGERPRINT);
    const [kind, version, ...rest] = id.split(':');

    expect([kind, version, rest.join(':')]).toEqual(['rage_click', '4.2.1', FINGERPRINT]);
  });

  it('uses - for an absent version', () => {
    expect(findingId('rage_click', undefined, 'F')).toBe('rage_click:-:F');
  });
});

describe('isFinding', () => {
  it('accepts a conforming finding', () => {
    expect(isFinding(finding())).toBe(true);
  });

  it('accepts one with no service.version, keyed by -', () => {
    expect(
      isFinding(
        withChange((r) => {
          delete r.resource['service.version'];
          r.attributes['rastro.finding.id'] = findingId('rage_click', undefined, FINGERPRINT);
        }),
      ),
    ).toBe(true);
  });

  it('rejects an id that does not match its own parts', () => {
    expect(isFinding(withChange((r) => (r.resource['service.version'] = '4.2.2')))).toBe(false);
  });

  it('rejects evidence that disagrees with the occurrence count', () => {
    expect(isFinding(withChange((r) => (r.attributes['rastro.finding.occurrences'] = 4)))).toBe(
      false,
    );
  });

  it('rejects evidence that disagrees with the session count', () => {
    expect(isFinding(withChange((r) => (r.attributes['rastro.finding.sessions'] = 3)))).toBe(false);
  });

  it('rejects a finding with no evidence', () => {
    expect(
      isFinding(
        withChange((r) => {
          r.body.evidence = [];
          r.attributes['rastro.finding.occurrences'] = 0;
          r.attributes['rastro.finding.sessions'] = 0;
        }),
      ),
    ).toBe(false);
  });

  it('rejects a session.id attribute, which would file the finding inside one session', () => {
    expect(isFinding(withChange((r) => (r.attributes['session.id'] = 's1')))).toBe(false);
  });

  it('rejects a record that is not a finding at all', () => {
    expect(isFinding(withChange((r) => (r.eventName = 'ux.click')))).toBe(false);
    expect(isFinding(withChange((r) => delete r.resource['service.name']))).toBe(false);
    expect(isFinding(withChange((r) => delete r.resource['rastro.output.version']))).toBe(false);
    expect(isFinding(null)).toBe(false);
  });
});
