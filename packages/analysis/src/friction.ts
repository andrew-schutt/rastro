// packages/analysis/src/friction.ts
// Deterministic friction signals (docs/PLAN.md §10).
//
// ⚠ §19.4 step 6 says to add EXACTLY ONE signal, and names two candidates: drop-off
// highlighting, or rage-click detection. Both are implemented here, at the maintainer's
// direction. The plan's "One" is scope discipline rather than a correctness constraint, and
// there is a real argument for two: §10's actual advice is to under-invest in inventing
// signals and over-invest in RANKING them (§11) — and ranking is meaningless with a single
// kind. Two kinds is the smallest number that makes the ranking question real.
//
// What that costs: `magnitude` is kind-specific and NOT comparable across kinds, so anything
// that ranks the two together has to use a common currency. `frictionByNode` uses sessions
// affected, which is the one number that means the same thing for both.
import type { Session, Step } from 'rastro-core';

/**
 * Which deterministic signal fired.
 *
 * `rage_click` and `high_abandonment` are implemented. The rest are named because §10 lists
 * them, not because they are coming next.
 */
export type FrictionKind =
  | 'rage_click'          // repeated clicks on the same target
  | 'high_abandonment'    // a large share of sessions end here
  | 'dead_click'          // click, no state change
  | 'long_pause'          // long active-time pause before an interaction
  | 'repeated_navigation'
  | 'backtracking';

export interface FrictionSignal {
  kind: FrictionKind;
  /** The element this fired on. Joins to `FlowNode.id`. */
  fingerprint: string;
  sessionId: string;
  /** `ux.seq` of the step it fired on, so the signal is locatable on a timeline. */
  seq: number;
  /**
   * Signal-specific magnitude. **Comparable only within a kind** — clicks for `rage_click`,
   * drop-off percentage for `high_abandonment`. Ranking across kinds must not use this.
   */
  magnitude: number;
}

export interface DetectFrictionOptions {
  /**
   * Clicks in a row before it counts as rage. Three is the industry-standard floor: two is a
   * double-click, which is a normal gesture and not distress.
   */
  minClicks?: number;
  /**
   * Maximum visible gap between consecutive clicks, in ms. Above this the user is deliberating
   * or the page is slow, both of which are different problems from hammering a control.
   */
  windowMs?: number;
  /** Share of sessions that must end at an element before it counts as high abandonment. */
  minDropoffRate?: number;
  /**
   * Sessions that must have reached an element before its drop-off rate means anything.
   * Without this, the first session to end anywhere reports a confident 100%.
   */
  minSessions?: number;
}

export const DEFAULT_MIN_CLICKS = 3;
export const DEFAULT_WINDOW_MS = 1_000;
/** Shared with the flow graph's edge colouring, so "high drop-off" means one thing. */
export const DEFAULT_MIN_DROPOFF_RATE = 0.5;
export const DEFAULT_MIN_SESSIONS = 3;

/**
 * Rage clicks: runs of consecutive clicks on the same element, in quick succession.
 *
 * Timing comes from `Step.activeMs`, the visibility-adjusted dwell *before* a step — so the gap
 * between two consecutive clicks is the second one's `activeMs`. Using that rather than a
 * wall-clock timestamp means the signal already excludes time the tab was hidden (§4.5) and
 * needs no field `Step` does not carry.
 *
 * Only `ux.click` steps participate. A repeated route change is `repeated_navigation` — a
 * different signal with a different meaning, and folding them together would make the number
 * mean nothing.
 *
 * What breaks a run is a user doing something ELSE, not a derived event. Clicking a submit
 * button emits `ux.click` *and* `ux.form_submit`, so treating every non-click as a break made
 * rage clicking a submit button — the single most likely place for it — undetectable. Only a
 * route change breaks the run now: that is the user leaving the context. Form and custom
 * events are consequences of the same gesture and pass through transparently.
 */
function detectRageClicks(
  sessions: Session[],
  minClicks: number,
  windowMs: number,
): FrictionSignal[] {
  const signals: FrictionSignal[] = [];

  for (const { sessionId, steps } of sessions) {
    let run: Step[] = [];

    const flush = (): void => {
      const first = run[0];
      if (first !== undefined && run.length >= minClicks) {
        signals.push({
          kind: 'rage_click',
          fingerprint: first.fingerprint,
          sessionId,
          seq: first.seq,
          magnitude: run.length,
        });
      }
      run = [];
    };

    for (const step of steps) {
      if (step.eventName === 'ux.route_change') {
        flush(); // the user left the context
        continue;
      }
      if (step.eventName !== 'ux.click') {
        // A consequence of the same gesture (form_submit, a tracked event). Transparent.
        continue;
      }

      const first = run[0];
      const continues =
        first !== undefined && step.fingerprint === first.fingerprint && step.activeMs <= windowMs;

      if (continues) run.push(step);
      else {
        flush();
        run = [step];
      }
    }
    flush();
  }

  return signals;
}

/**
 * High abandonment: elements where a large share of the sessions that reached them stopped.
 *
 * Unlike a rage click, this is inherently an AGGREGATE property — no single session tells you
 * a node is a drop-off point. It is still emitted per session (one signal per session that
 * ended there) so both kinds share one shape and one roll-up; `magnitude` carries the node's
 * drop-off percentage, which is identical across those occurrences by construction.
 */
function detectAbandonment(
  sessions: Session[],
  minDropoffRate: number,
  minSessions: number,
): FrictionSignal[] {
  const reached = new Map<string, Set<string>>();
  /** Fingerprint -> the last step of each session that ended on it. */
  const endedAt = new Map<string, { sessionId: string; seq: number }[]>();

  for (const { sessionId, steps } of sessions) {
    for (const step of steps) {
      const seen = reached.get(step.fingerprint);
      if (seen === undefined) reached.set(step.fingerprint, new Set([sessionId]));
      else seen.add(sessionId);
    }

    const last = steps.at(-1);
    if (last === undefined) continue;

    const enders = endedAt.get(last.fingerprint);
    if (enders === undefined) endedAt.set(last.fingerprint, [{ sessionId, seq: last.seq }]);
    else enders.push({ sessionId, seq: last.seq });
  }

  const signals: FrictionSignal[] = [];
  for (const [fingerprint, enders] of endedAt) {
    const reachedCount = reached.get(fingerprint)?.size ?? 0;
    if (reachedCount < minSessions) continue; // too little evidence to claim anything

    const rate = enders.length / reachedCount;
    if (rate < minDropoffRate) continue;

    for (const ender of enders) {
      signals.push({
        kind: 'high_abandonment',
        fingerprint,
        sessionId: ender.sessionId,
        seq: ender.seq,
        magnitude: Math.round(rate * 100),
      });
    }
  }

  return signals;
}

/**
 * Detect friction across sessions. Results are deterministic and ranked within kind.
 *
 * TODO(§11): ranking is the part worth investing in, and this ranks by magnitude within a
 * kind and by sessions affected across kinds. The real shape is `Impact × Confidence ×
 * Frequency`, surfacing only the top few — 47 signals a week and nobody reads any.
 * TODO(§12): a signal is evidence of *something*, never a diagnosis. A rage click could be a
 * slow network or an unresponsive handler as easily as a confusing control; an abandonment
 * point could be where the task legitimately finishes. Anything surfacing these must say
 * "this pattern may indicate", and offer competing explanations.
 */
export function detectFriction(
  sessions: Session[],
  {
    minClicks = DEFAULT_MIN_CLICKS,
    windowMs = DEFAULT_WINDOW_MS,
    minDropoffRate = DEFAULT_MIN_DROPOFF_RATE,
    minSessions = DEFAULT_MIN_SESSIONS,
  }: DetectFrictionOptions = {},
): FrictionSignal[] {
  const signals = [
    ...detectRageClicks(sessions, minClicks, windowMs),
    ...detectAbandonment(sessions, minDropoffRate, minSessions),
  ];

  // Grouped by kind, then most severe first. Magnitudes are NOT compared across kinds — the
  // kind ordering is fixed rather than derived, precisely because they are different units.
  const kindOrder: FrictionKind[] = ['rage_click', 'high_abandonment'];

  return signals.sort(
    (a, b) =>
      kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) ||
      b.magnitude - a.magnitude ||
      (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0) ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
      a.seq - b.seq,
  );
}

/** One element's friction, rolled up across sessions — what a graph node wants to show. */
export interface FrictionByNode {
  fingerprint: string;
  /** Which signals fired here, in the order they are ranked. */
  kinds: FrictionKind[];
  /** Distinct sessions affected. The "one angry user, or many?" question. */
  sessions: number;
  /** Total occurrences across all sessions. */
  occurrences: number;
  /** Worst magnitude seen, within the first of `kinds`. */
  maxMagnitude: number;
}

/**
 * Roll signals up per element, ranked by sessions affected.
 *
 * Sessions affected is the ranking key because it is the only number that means the same
 * thing for every kind — §11's "Frequency", and the honest half of a ranking that cannot yet
 * do Impact or Confidence.
 */
export function frictionByNode(signals: FrictionSignal[]): FrictionByNode[] {
  const byFingerprint = new Map<
    string,
    { kinds: Set<FrictionKind>; sessions: Set<string>; occurrences: number; max: number }
  >();

  for (const signal of signals) {
    const existing = byFingerprint.get(signal.fingerprint);
    if (existing === undefined) {
      byFingerprint.set(signal.fingerprint, {
        kinds: new Set([signal.kind]),
        sessions: new Set([signal.sessionId]),
        occurrences: 1,
        max: signal.magnitude,
      });
    } else {
      existing.kinds.add(signal.kind);
      existing.sessions.add(signal.sessionId);
      existing.occurrences += 1;
      // `signals` arrives grouped by kind, so this stays within the first kind seen.
      if (existing.kinds.size === 1) existing.max = Math.max(existing.max, signal.magnitude);
    }
  }

  return [...byFingerprint]
    .map(([fingerprint, tally]) => ({
      fingerprint,
      kinds: [...tally.kinds],
      sessions: tally.sessions.size,
      occurrences: tally.occurrences,
      maxMagnitude: tally.max,
    }))
    .sort(
      (a, b) =>
        b.sessions - a.sessions ||
        b.occurrences - a.occurrences ||
        (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0),
    );
}
