// scripts/identity-spike/scoring/collisions.ts
// False merges: distinct elements sharing a fingerprint on one screen, judged by the referee.
//
// README items 4, 6 and 8: per screen, every element counted (visible-only beside), and a range
// rather than a count. The referee is the frozen `groupSites`, run on the sites the capture
// recorded, so it rules exactly as the live referee would have on that page.
import type { CapturedElement } from '../src/page.ts';
import { groupSites } from '../src/repeat-oracle.ts';
import type { CorpusStrategy } from '../src/strategies.ts';

/** One fingerprint worn by more than one element on one document. */
export interface Collision {
  fingerprint: string;
  /** Indices into the document's elements. */
  elements: number[];
  /** How many distinct things wear it: the referee's range. One means a right merge. */
  distinct: { atLeast: number; atMost: number };
  undecidedPairs: number;
}

/** The false-merge range on one document: distinct elements minus one, summed per fingerprint. */
export interface MergeCount {
  atLeast: number;
  atMost: number;
  undecidedPairs: number;
  /** Fingerprints worn by more than one distinct thing under the lower bound. */
  falselyMerged: number;
}

export function collisions(elements: readonly CapturedElement[], strategy: CorpusStrategy): Collision[] {
  const byFingerprint = new Map<string, number[]>();
  elements.forEach((element, i) => {
    const fingerprint = element.fingerprints[strategy];
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), i]);
  });
  const found: Collision[] = [];
  for (const [fingerprint, indices] of byFingerprint) {
    if (indices.length < 2) continue;
    const grouping = groupSites(indices.map((i) => elements[i]!.site));
    found.push({
      fingerprint,
      elements: indices,
      distinct: grouping.distinctElements,
      undecidedPairs: grouping.undecidedPairs,
    });
  }
  return found;
}

export function mergeCount(found: readonly Collision[]): MergeCount {
  return found.reduce<MergeCount>(
    (sum, collision) => ({
      atLeast: sum.atLeast + collision.distinct.atLeast - 1,
      atMost: sum.atMost + collision.distinct.atMost - 1,
      undecidedPairs: sum.undecidedPairs + collision.undecidedPairs,
      falselyMerged: sum.falselyMerged + (collision.distinct.atLeast > 1 ? 1 : 0),
    }),
    { atLeast: 0, atMost: 0, undecidedPairs: 0, falselyMerged: 0 },
  );
}

/** README item 6: the same, over visible elements only, reported beside. */
export function visibleOnly(elements: readonly CapturedElement[]): CapturedElement[] {
  return elements.filter((element) => element.visible);
}
