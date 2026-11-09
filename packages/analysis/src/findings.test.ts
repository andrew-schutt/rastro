// packages/analysis/src/findings.test.ts
import { describe, expect, it } from 'vitest';
import {
  decodeOtlpLogs,
  DERIVED_SCOPE_NAME,
  encodeOtlpLogs,
  isFinding,
  UX_CONVENTION_VERSION,
} from 'rastro-core';
import { makeEvent } from './fixtures.js';
import { detectFriction } from './friction.js';
import { toFindings } from './findings.js';
import { sessionize } from './sessionize.js';

const OPTIONS = { app: 'fixture-app', timeUnixNano: '1730300000000000000' };
const SAVE = 'App>Form|button|"Save"';

/** Three rapid clicks on Save, in one session and one deploy: one rage_click signal. */
function rageSession(sessionId: string, serviceVersion?: string, startSeq = 1) {
  return [0, 1, 2].map((offset) =>
    makeEvent({
      sessionId,
      seq: startSeq + offset,
      fingerprint: SAVE,
      activeMs: offset === 0 ? 2000 : 100,
      ...(serviceVersion === undefined ? {} : { serviceVersion }),
    }),
  );
}

/** Real signals from real events, not hand-written ones. */
function findingsFor(events: ReturnType<typeof makeEvent>[]) {
  const sessions = sessionize(events);
  return toFindings(detectFriction(sessions), sessions, OPTIONS);
}

describe('toFindings', () => {
  it('builds a conforming finding from FrictionSignals', () => {
    const [finding] = findingsFor([...rageSession('s1', '4.2.1'), ...rageSession('s2', '4.2.1')]);

    expect(isFinding(finding)).toBe(true);
    expect(finding?.attributes).toEqual({
      'rastro.finding.id': `rage_click:4.2.1:${SAVE}`,
      'rastro.finding.kind': 'rage_click',
      'ux.fingerprint': SAVE,
      'rastro.finding.occurrences': 2,
      'rastro.finding.sessions': 2,
    });
    expect(finding?.resource).toEqual({
      'service.name': 'fixture-app',
      'service.version': '4.2.1',
      'ux.convention.version': UX_CONVENTION_VERSION,
      'rastro.output.version': '0.1',
    });
    expect(finding?.body.evidence).toEqual([
      { 'session.id': 's1', 'ux.seq': 1 },
      { 'session.id': 's2', 'ux.seq': 1 },
    ]);
  });

  it('splits the same signal on the same element into one finding per deploy', () => {
    const findings = findingsFor([...rageSession('s1', '4.2.1'), ...rageSession('s2', '4.2.2')]);

    expect(findings.map((finding) => finding.resource['service.version'])).toEqual([
      '4.2.1',
      '4.2.2',
    ]);
    expect(findings.every(isFinding)).toBe(true);
  });

  it('counts two runs in one session as two occurrences in one session', () => {
    const events = [
      ...rageSession('s1', '4.2.1', 1),
      makeEvent({ sessionId: 's1', seq: 4, fingerprint: 'Other', activeMs: 3000, serviceVersion: '4.2.1' }),
      ...rageSession('s1', '4.2.1', 5),
    ];
    const [finding] = findingsFor(events);

    expect(finding?.attributes['rastro.finding.occurrences']).toBe(2);
    expect(finding?.attributes['rastro.finding.sessions']).toBe(1);
    expect(isFinding(finding)).toBe(true);
  });

  it('carries no rate: magnitude is pooled across deploys, and the finding is keyed by one', () => {
    const [finding] = findingsFor(rageSession('s1', '4.2.1'));
    const flat = JSON.stringify(finding);

    expect(flat).not.toContain('magnitude');
    expect(flat).not.toContain('rate');
  });

  it('keys an unversioned finding with -, and still conforms', () => {
    const [finding] = findingsFor(rageSession('s1'));

    expect(finding?.attributes['rastro.finding.id']).toBe(`rage_click:-:${SAVE}`);
    expect(finding?.resource).not.toHaveProperty('service.version');
    expect(isFinding(finding)).toBe(true);
  });

  // Every session also ends on Save, and three is enough sessions for high_abandonment to
  // fire too, so two kinds across two deploys come out ranked together.
  it('ranks by sessions affected, the one number comparable across kinds', () => {
    const findings = findingsFor([
      ...rageSession('s1', '4.2.1'),
      ...rageSession('s2', '4.2.2'),
      ...rageSession('s3', '4.2.2'),
    ]);

    expect(
      findings.map((finding) => [
        finding.attributes['rastro.finding.kind'],
        finding.resource['service.version'],
        finding.attributes['rastro.finding.sessions'],
      ]),
    ).toEqual([
      ['high_abandonment', '4.2.2', 2],
      ['rage_click', '4.2.2', 2],
      ['high_abandonment', '4.2.1', 1],
      ['rage_click', '4.2.1', 1],
    ]);
    expect(findings.every(isFinding)).toBe(true);
  });

  it('returns no findings for no signals', () => {
    expect(toFindings([], [], OPTIONS)).toEqual([]);
  });
});

describe('a finding on the wire', () => {
  it('round-trips through the codec under the derived scope and still conforms', () => {
    const [finding] = findingsFor([...rageSession('s1', '4.2.1'), ...rageSession('s2', '4.2.1')]);
    if (finding === undefined) throw new Error('expected a finding');

    const [decoded] = decodeOtlpLogs(encodeOtlpLogs([finding], { name: DERIVED_SCOPE_NAME }));

    expect(decoded?.scope?.name).toBe(DERIVED_SCOPE_NAME);
    expect(isFinding(decoded)).toBe(true);
    expect(decoded?.body).toEqual(finding.body);
  });
});
