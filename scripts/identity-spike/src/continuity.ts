// scripts/identity-spike/src/continuity.ts
// Fingerprint continuity across two builds of one app: docs/VALIDATION-PLAN.md §3.2 (b)–(d).
//
// Two halves, both used by the continuity smoke test (continuity/) and both meant for the
// corpus runner: `snapshotDocument` records what a rendered page's interactive elements are
// called, and `diffSnapshots` says what changed between two of those records.
//
// `diffSnapshots` works on fingerprints alone, because that is all the corpus has: no oracle
// says which element at commit B "is" which element at commit A. That question is rule 4's
// blind labelling. The smoke test knows the answer for its own app and checks this diff
// against it.

/**
 * What counts as interactive: the elements a user can act on and Rastro would emit events
 * for. The same selector the build checks used, so their numbers and the runner's agree.
 */
export const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role=button]',
  '[role=link]',
  '[role=checkbox]',
  '[role=switch]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=option]',
].join(', ');

export interface SnapshotEntry {
  /** The element's ground-truth identity, where the page carries one; null otherwise. */
  element: string | null;
  fingerprint: string;
}

export interface SnapshotOptions {
  /** Attribute holding a ground-truth element id. Corpus apps have none. */
  oracleAttribute?: string;
  /** Narrow the elements further, e.g. to those visible in a real browser. */
  include?: (element: Element) => boolean;
}

/** Every interactive element under `root`, in document order, with its fingerprint. */
export function snapshotDocument(
  root: ParentNode,
  fingerprintOf: (element: Element) => string,
  options: SnapshotOptions = {},
): SnapshotEntry[] {
  const { oracleAttribute, include } = options;
  return [...root.querySelectorAll(INTERACTIVE_SELECTOR)]
    .filter((element) => include === undefined || include(element))
    .map((element) => ({
      element: oracleAttribute === undefined ? null : element.getAttribute(oracleAttribute),
      fingerprint: fingerprintOf(element),
    }));
}

export interface CountChange {
  fingerprint: string;
  before: number;
  after: number;
}

export interface ContinuityDiff {
  /** Fingerprints present at both, in sorted order. */
  kept: string[];
  /** Present before and gone after: (b)'s churn, and (d)'s candidates for a drift proposal. */
  vanished: string[];
  /** New after. A continued element shows up as one vanished and one appeared. */
  appeared: string[];
  /**
   * Kept, but carried by a different number of elements. Not churn in itself, since a list
   * can grow, but the only trace a new merge leaves: two elements that start sharing a
   * fingerprint change no set membership, only a count.
   */
  countChanged: CountChange[];
}

function counts(fingerprints: readonly string[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const fingerprint of fingerprints) tally.set(fingerprint, (tally.get(fingerprint) ?? 0) + 1);
  return tally;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/** What changed between two snapshots, by fingerprint alone. Deterministic: every list is sorted. */
export function diffSnapshots(before: readonly string[], after: readonly string[]): ContinuityDiff {
  const was = counts(before);
  const now = counts(after);

  const kept = sorted([...was.keys()].filter((fingerprint) => now.has(fingerprint)));
  return {
    kept,
    vanished: sorted([...was.keys()].filter((fingerprint) => !now.has(fingerprint))),
    appeared: sorted([...now.keys()].filter((fingerprint) => !was.has(fingerprint))),
    countChanged: kept
      .map((fingerprint) => ({ fingerprint, before: was.get(fingerprint) ?? 0, after: now.get(fingerprint) ?? 0 }))
      .filter((change) => change.before !== change.after),
  };
}
