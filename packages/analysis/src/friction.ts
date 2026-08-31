// packages/analysis/src/friction.ts
// Deterministic friction signals (PLAN.md §10). STUB.
//
// Walking-skeleton step 6 (§19.4) is explicit: add EXACTLY ONE signal for v1. The signal set
// below is mature, re-implementable, and not novel — §10's advice is to under-invest in
// inventing new signals and over-invest in RANKING them (§11).
import type { Session } from 'rastro-core';

/** Which deterministic signal fired. Only one of these ships in v1. */
export type FrictionKind =
  | 'rage_click'          // repeated clicks on the same target
  | 'dead_click'          // click, no state change
  | 'long_pause'          // long active-time pause before an interaction
  | 'repeated_navigation'
  | 'backtracking'
  | 'high_abandonment';

export interface FrictionSignal {
  kind: FrictionKind;
  /** The element this fired on. Joins to FlowNode.id. */
  fingerprint: string;
  sessionId: string;
  /** Signal-specific magnitude — click count, pause in ms, etc. Comparable only within a kind. */
  magnitude: number;
}

/**
 * Detect friction signals across sessions.
 *
 * TODO(§10, §19.4 step 6) pick ONE and implement it:
 *   - rage clicks: N+ consecutive steps sharing a fingerprint within a short window. Needs a
 *     real timestamp, which `Step` does not carry today — extend Step or read raw events.
 *   - drop-off highlighting on edges: cheaper, and it reuses buildGraph's `dropoffRate`
 *     rather than needing a new primitive.
 *
 * TODO(§11) ranking matters more than detection: `Impact × Confidence × Frequency`, surfacing
 * only the top few. 47 signals a week and nobody reads any.
 *
 * @throws always, until implemented.
 */
export function detectFriction(_sessions: Session[]): FrictionSignal[] {
  throw new Error(
    'detectFriction: not implemented — walking-skeleton step 6 (PLAN.md §19.4). One signal only.',
  );
}
