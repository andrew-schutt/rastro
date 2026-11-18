// scripts/identity-spike/scoring/dominance.ts
// Rule 1's "beat": domination over three error counts, with false merges as a range (README, item 8).

export interface RuleOneTotals {
  /** False merges as the referee's range, summed over commits and screens. */
  merges: { atLeast: number; atMost: number };
  /** Churn instances on untouched components, summed over pairs. Undetermined is counted apart. */
  untouchedChurn: number;
  /** False splits, summed over pairs. */
  falseSplits: number;
}

export type Beat = 'beats' | 'does not beat' | 'undecided';

/** No worse on every count and better on one. */
function dominatesOn(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => value <= b[i]!) && a.some((value, i) => value < b[i]!);
}

/**
 * Does `a` beat `b`? Decided under each bound of the merge range. If the two bounds give
 * different answers, the comparison is undecided: it is never settled on the bound that favours
 * one side.
 */
export function beats(a: RuleOneTotals, b: RuleOneTotals): Beat {
  const under = (bound: 'atLeast' | 'atMost') =>
    dominatesOn([a.merges[bound], a.untouchedChurn, a.falseSplits], [b.merges[bound], b.untouchedChurn, b.falseSplits]);
  const low = under('atLeast');
  const high = under('atMost');
  if (low && high) return 'beats';
  if (!low && !high) return 'does not beat';
  return 'undecided';
}
