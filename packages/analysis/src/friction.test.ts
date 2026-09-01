// packages/analysis/src/friction.test.ts
import { describe, expect, it } from 'vitest';
import type { Session, Step } from 'rastro-core';
import { detectFriction, frictionByNode } from './friction.js';

const step = (
  fingerprint: string,
  activeMs: number,
  seq: number,
  eventName = 'ux.click',
): Step => ({ eventName, fingerprint, route: '/', seq, activeMs });

/** A session from `[fingerprint, gapBeforeIt, eventName?]` triples. */
const session = (sessionId: string, path: [string, number, string?][]): Session => ({
  sessionId,
  steps: path.map(([fingerprint, activeMs, eventName], index) =>
    step(fingerprint, activeMs, index + 1, eventName),
  ),
});

const rage = (signals: ReturnType<typeof detectFriction>) =>
  signals.filter((signal) => signal.kind === 'rage_click');
const abandonment = (signals: ReturnType<typeof detectFriction>) =>
  signals.filter((signal) => signal.kind === 'high_abandonment');

describe('detectFriction — rage clicks', () => {
  it('fires on three fast clicks on the same element', () => {
    const signals = rage(
      detectFriction([session('s1', [['Save', 0], ['Save', 120], ['Save', 90]])]),
    );

    expect(signals).toEqual([
      { kind: 'rage_click', fingerprint: 'Save', sessionId: 's1', seq: 1, magnitude: 3 },
    ]);
  });

  // Two clicks is a double-click, which is a normal gesture rather than distress.
  it('does NOT fire on a double-click', () => {
    const signals = rage(detectFriction([session('s1', [['Save', 0], ['Save', 80]])]));

    expect(signals).toEqual([]);
  });

  it('counts the whole run, not just the threshold', () => {
    const signals = rage(
      detectFriction([
        session('s1', [['Save', 0], ['Save', 50], ['Save', 50], ['Save', 50], ['Save', 50]]),
      ]),
    );

    expect(signals[0]?.magnitude).toBe(5);
  });

  it('does not fire when the clicks are slow — that is deliberation, not rage', () => {
    const signals = rage(
      detectFriction([session('s1', [['Save', 0], ['Save', 4000], ['Save', 5000]])]),
    );

    expect(signals).toEqual([]);
  });

  it('breaks the run when a slow click interrupts it', () => {
    const signals = rage(
      detectFriction([session('s1', [['Save', 0], ['Save', 50], ['Save', 9000], ['Save', 50]])]),
    );

    // Two runs of two — neither reaches the threshold.
    expect(signals).toEqual([]);
  });

  it('starts a NEW run at the slow click rather than discarding it', () => {
    const signals = rage(
      detectFriction([
        session('s1', [['Save', 0], ['Save', 50], ['Save', 9000], ['Save', 50], ['Save', 50]]),
      ]),
    );

    // The pause ends one run and begins another; the three clicks after it are real rage.
    expect(signals).toHaveLength(1);
    expect(signals[0]?.seq).toBe(3);
    expect(signals[0]?.magnitude).toBe(3);
  });

  it('breaks the run when a different element is clicked', () => {
    const signals = rage(
      detectFriction([
        session('s1', [['Save', 0], ['Save', 50], ['Cancel', 50], ['Save', 50]]),
      ]),
    );

    expect(signals).toEqual([]);
  });

  it('breaks the run on a route change — the user left the context', () => {
    const signals = rage(
      detectFriction([
        session('s1', [
          ['Save', 0],
          ['Save', 50],
          ['route:/x', 50, 'ux.route_change'],
          ['Save', 50],
        ]),
      ]),
    );

    expect(signals).toEqual([]);
  });

  // Clicking a submit button emits ux.click AND ux.form_submit. Treating the submit as "the
  // user did something else" made rage clicking a submit button — the likeliest place for it
  // — undetectable, which is exactly what happened when this was driven in a real browser.
  it('sees through a form_submit emitted by the click itself', () => {
    const signals = rage(
      detectFriction([
        session('s1', [
          ['Save', 0],
          ['Save', 0, 'ux.form_submit'],
          ['Save', 120],
          ['Save', 0, 'ux.form_submit'],
          ['Save', 130],
          ['Save', 0, 'ux.form_submit'],
        ]),
      ]),
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]?.magnitude).toBe(3);
  });

  it('sees through a custom tracked event between clicks', () => {
    const signals = rage(
      detectFriction([
        session('s1', [
          ['Save', 0],
          ['Save', 50],
          ['id:checkout.attempted', 10, 'checkout.attempted'],
          ['Save', 60],
        ]),
      ]),
    );

    expect(signals[0]?.magnitude).toBe(3);
  });

  it('does not fire on three route changes in a row', () => {
    const signals = rage(
      detectFriction([
        session('s1', [
          ['route:/x', 0, 'ux.route_change'],
          ['route:/x', 10, 'ux.route_change'],
          ['route:/x', 10, 'ux.route_change'],
        ]),
      ]),
    );

    expect(signals).toEqual([]);
  });

  it('reports one signal per run, per session', () => {
    const signals = rage(
      detectFriction([
        session('s1', [
          ['Save', 0], ['Save', 50], ['Save', 50],
          ['Cancel', 50],
          ['Save', 50], ['Save', 50], ['Save', 50],
        ]),
      ]),
    );

    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal.seq)).toEqual([1, 5]);
  });

  it('finds runs in several sessions independently', () => {
    const signals = rage(
      detectFriction([
        session('s1', [['Save', 0], ['Save', 50], ['Save', 50]]),
        session('s2', [['Save', 0], ['Save', 50], ['Save', 50], ['Save', 50]]),
      ]),
    );

    expect(signals.map((signal) => signal.sessionId)).toEqual(['s2', 's1']); // ranked by magnitude
  });

  it('honours custom thresholds', () => {
    const trace = [session('s1', [['Save', 0], ['Save', 50]])];

    expect(rage(detectFriction(trace, { minClicks: 2 }))).toHaveLength(1);
  });

  it('finds nothing in an empty trace', () => {
    expect(detectFriction([])).toEqual([]);
    expect(detectFriction([{ sessionId: 's1', steps: [] }])).toEqual([]);
  });
});

describe('detectFriction — high abandonment', () => {
  /**
   * `count` of `reachedBy` sessions stop at `fingerprint`; the rest continue to a node unique
   * to them, so those exits never accumulate into a second drop-off point of their own.
   */
  const endingAt = (fingerprint: string, count: number, reachedBy = count): Session[] =>
    Array.from({ length: reachedBy }, (_, index) =>
      index < count
        ? session(`s${index}`, [['Start', 0], [fingerprint, 100]])
        : session(`s${index}`, [['Start', 0], [fingerprint, 100], [`Next${index}`, 100]]),
    );

  it('fires when most sessions reaching an element stop there', () => {
    const signals = abandonment(detectFriction(endingAt('Dead', 3, 4)));

    expect(signals).toHaveLength(3);
    expect(signals[0]?.fingerprint).toBe('Dead');
    expect(signals[0]?.magnitude).toBe(75); // 3 of 4 sessions
  });

  it('does not fire below the drop-off threshold', () => {
    expect(abandonment(detectFriction(endingAt('Fine', 1, 4)))).toEqual([]);
  });

  // Without a floor, the first session to end anywhere reports a confident 100%.
  it('does not fire on too little evidence, however extreme the rate', () => {
    const signals = abandonment(
      detectFriction([session('s1', [['Start', 0], ['Dead', 100]])]),
    );

    expect(signals).toEqual([]);
  });

  it('honours a custom evidence floor', () => {
    const signals = abandonment(
      detectFriction([session('s1', [['Start', 0], ['Dead', 100]])], { minSessions: 1 }),
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]?.magnitude).toBe(100);
  });

  it('emits one signal per abandoning session, carrying the last step seq', () => {
    const signals = abandonment(detectFriction(endingAt('Dead', 3, 3)));

    expect(signals.map((signal) => signal.sessionId).sort()).toEqual(['s0', 's1', 's2']);
    expect(new Set(signals.map((signal) => signal.seq))).toEqual(new Set([2]));
  });

  it('does not count a revisit as extra evidence', () => {
    // s0 visits Dead twice but is still one session that reached it.
    const signals = abandonment(
      detectFriction([
        session('s0', [['Dead', 0], ['Start', 10], ['Dead', 10]]),
        session('s1', [['Start', 0], ['Dead', 10]]),
        session('s2', [['Start', 0], ['Dead', 10]]),
      ]),
    );

    expect(signals[0]?.magnitude).toBe(100); // 3 of 3 sessions, not 3 of 4 visits
  });
});

describe('detectFriction — ranking', () => {
  it('groups by kind and ranks by magnitude within a kind', () => {
    const signals = detectFriction([
      session('s1', [['Save', 0], ['Save', 50], ['Save', 50]]),
      session('s2', [['Save', 0], ['Save', 50], ['Save', 50], ['Save', 50], ['Save', 50]]),
      session('s3', [['Save', 0], ['Save', 50], ['Save', 50]]),
    ]);

    expect(signals[0]?.kind).toBe('rage_click');
    expect(signals[0]?.magnitude).toBe(5);
    // Rage clicks come before abandonment, and magnitudes never mix across kinds.
    const kinds = signals.map((signal) => signal.kind);
    expect(kinds.indexOf('rage_click')).toBeLessThan(kinds.lastIndexOf('high_abandonment'));
  });

  it('is deterministic regardless of session order', () => {
    const a = session('s1', [['Save', 0], ['Save', 50], ['Save', 50]]);
    const b = session('s2', [['Save', 0], ['Save', 50], ['Save', 50]]);
    const c = session('s3', [['Other', 0], ['Save', 50], ['Save', 50], ['Save', 50]]);

    expect(detectFriction([a, b, c])).toEqual(detectFriction([c, b, a]));
  });
});

describe('frictionByNode', () => {
  it('rolls occurrences up per element', () => {
    const rolled = frictionByNode(
      detectFriction([
        session('s1', [['Save', 0], ['Save', 50], ['Save', 50]]),
        session('s2', [['Save', 0], ['Save', 50], ['Save', 50], ['Save', 50]]),
      ]),
    );
    const save = rolled.find((node) => node.fingerprint === 'Save');

    expect(save?.sessions).toBe(2);
    expect(save?.occurrences).toBe(2);
    expect(save?.maxMagnitude).toBe(4);
  });

  // The ranking key is sessions affected: the one number that means the same for every kind.
  it('ranks a widespread problem above a single furious user', () => {
    const rolled = frictionByNode(
      detectFriction([
        session('s1', [['Furious', 0], ...Array.from({ length: 20 }, () => ['Furious', 20] as [string, number])]),
        session('s2', [['Widespread', 0], ['Widespread', 20], ['Widespread', 20]]),
        session('s3', [['Widespread', 0], ['Widespread', 20], ['Widespread', 20]]),
        session('s4', [['Widespread', 0], ['Widespread', 20], ['Widespread', 20]]),
      ]),
    );

    expect(rolled[0]?.fingerprint).toBe('Widespread');
    expect(rolled[0]?.sessions).toBe(3);
  });

  it('records every kind that fired on an element', () => {
    const rolled = frictionByNode(
      detectFriction([
        session('s1', [['Start', 0], ['Save', 10], ['Save', 20], ['Save', 20]]),
        session('s2', [['Start', 0], ['Save', 10], ['Save', 20], ['Save', 20]]),
        session('s3', [['Start', 0], ['Save', 10], ['Save', 20], ['Save', 20]]),
      ]),
    );
    const save = rolled.find((node) => node.fingerprint === 'Save');

    expect(save?.kinds).toEqual(['rage_click', 'high_abandonment']);
  });

  it('returns nothing for no signals', () => {
    expect(frictionByNode([])).toEqual([]);
  });
});
