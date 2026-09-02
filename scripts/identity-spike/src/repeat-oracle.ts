// scripts/identity-spike/src/repeat-oracle.ts
// The collision referee for docs/VALIDATION-PLAN.md §3.2.
//
// §3.2's wrinkle, in its own words: "Two identical buttons in a rendered list *correctly*
// share a fingerprint — that is a right merge, not a false one... The harness must distinguish
// 'collides with a semantically distinct element' from 'collides with its own repeated
// siblings', or the collision number is meaningless."
//
// This answers that with React's `key`. When React renders an array it stamps each child's
// fiber with the key the developer supplied, and React warns loudly when one is missing — so
// on most real apps the loops announce themselves. Two elements are repeats of one another
// exactly when they hang off two DIFFERENT keyed items of the SAME list.
//
// ⚠ WHY THIS IS A REFEREE AND NOT AN IDENTITY. Keys are unique only among siblings, never
// globally, and `key={i}` — the array index, which is extremely common — renumbers every item
// when one is inserted. Both properties are disqualifying for something that must match an
// element across deploys. Neither matters here: the referee compares elements to each other
// within ONE rendered page at ONE commit, and never persists anything. The transience that
// rules keys out of the fingerprint costs this nothing.
//
// ⚠ Fiber identity is compared with `===`, which holds within a single rendered snapshot.
// React double-buffers trees (`current` / `alternate`), so a verdict must be computed and used
// before the page re-renders. The harness reads a static page, so it is.
import { getFiber } from 'rastro-core';

/** The private fiber fields this reads. Typed locally: `rastro-core` does not export them. */
interface KeyedFiber {
  key?: string | null;
  return?: KeyedFiber | null;
}

/** Where an element sits inside a rendered list, if it sits inside one at all. */
export interface RepeatSite {
  /** The key React was given for the item. Informational — never compared across lists. */
  key: string;
  /**
   * The keyed fiber itself: one list ITEM. Two elements inside the same row share this, and
   * they are two different controls rather than repeats of each other.
   */
  item: object;
  /**
   * The keyed item's parent fiber: the LIST. Two items sharing this are siblings produced by
   * one loop, which is the right-merge case.
   */
  list: object;
}

/**
 * The nearest enclosing list item, or null when the element is not in a keyed list.
 *
 * Nearest rather than outermost: for a button inside a row inside a table, the row is what
 * makes it a repeat of the button in the next row. An outer list would call two genuinely
 * different controls in one row repeats of each other.
 */
export function repeatSiteOf(element: Element): RepeatSite | null {
  // An assignment rather than a cast: `rastro-core`'s fiber type is structurally compatible,
  // it just does not name the one field this cares about.
  let fiber: KeyedFiber | null = getFiber(element);

  while (fiber !== null && fiber !== undefined) {
    const key = fiber.key;
    const parent = fiber.return;
    if (key !== null && key !== undefined && key !== '' && parent !== null && parent !== undefined) {
      return { key, item: fiber, list: parent };
    }
    fiber = parent ?? null;
  }

  return null;
}

/** What the referee concluded about one colliding pair. */
export type Verdict = 'repeated-siblings' | 'distinct' | 'undecided';

/**
 * Why it concluded that. Kept as a stable slug so the harness can report each reason as its
 * own bucket — §3.2 pre-commits to comparative rules, and a single blended rate would hide
 * which calls were confident and which were guesses.
 */
export type VerdictReason =
  | 'same-element'
  | 'same-list-different-items'
  | 'same-list-item'
  | 'different-lists'
  | 'no-keyed-ancestor'
  | 'one-side-unkeyed';

export interface CollisionVerdict {
  verdict: Verdict;
  reason: VerdictReason;
}

/**
 * Do these two elements share a fingerprint *correctly*?
 *
 * `undecided` is a real answer and is never folded into either other one. React renders an
 * unkeyed array perfectly happily — it only warns — so "no key" does not prove "no loop". Those
 * pairs are the hand-inspected bucket §3.2 asks for, and quietly counting them as false merges
 * would inflate exactly the number the spike exists to establish.
 */
export function classifyPair(a: Element, b: Element): CollisionVerdict {
  if (a === b) return { verdict: 'distinct', reason: 'same-element' };

  const siteA = repeatSiteOf(a);
  const siteB = repeatSiteOf(b);

  if (siteA === null && siteB === null) {
    return { verdict: 'undecided', reason: 'no-keyed-ancestor' };
  }
  if (siteA === null || siteB === null) {
    return { verdict: 'undecided', reason: 'one-side-unkeyed' };
  }

  // Two controls in one row. Not repeats of each other — a row's Edit and Delete are distinct
  // even where a fingerprint cannot tell them apart.
  if (siteA.item === siteB.item) {
    return { verdict: 'distinct', reason: 'same-list-item' };
  }

  // The right merge: two items of one loop.
  if (siteA.list === siteB.list) {
    return { verdict: 'repeated-siblings', reason: 'same-list-different-items' };
  }

  // Two separate lists — an admin table and a members table, say. Their rows are not repeats
  // of each other, and a metric that blends them is answering neither question.
  return { verdict: 'distinct', reason: 'different-lists' };
}

/** What the referee made of one fingerprint's worth of colliding elements. */
export interface RepeatGrouping {
  /**
   * Elements clustered so that each group is ONE logical element. A group count above 1 is a
   * false merge: that many distinct things wearing one identity.
   */
  groups: Element[][];
  /** Pairs the key signal could not rule on. These want a second referee, or a human. */
  undecidedPairs: number;
  /**
   * Pairs of items in one list holding different numbers of colliding elements, so position
   * cannot line them up — a control rendered conditionally inside a repeated row. Counted
   * apart from `undecidedPairs`: the key was there, it was the alignment that failed.
   */
  unalignedPairs: number;
}

/** Document order, so the grouping does not depend on the order the caller passed elements. */
function inDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) === 0 ? 1 : -1;
}

/**
 * Cluster elements sharing a fingerprint into the distinct things they actually are.
 *
 * ⚠ NOT a union over the `repeated-siblings` relation. That relation is not transitive, and
 * unioning over it erases the `same-list-item` verdict in precisely the case this exists to
 * catch. Three rows of two identical buttons: `classifyPair` correctly calls row 1's two
 * buttons distinct, but row 1's LEFT button and row 2's RIGHT button are two items of one
 * list, so a union drags all six into a single group and reports zero false merges. The honest
 * answer is two groups, one false merge. Under-reporting is the failure direction the whole
 * exercise is built to avoid, so the relation is not what the clustering runs on.
 *
 * Repeats are matched by POSITION instead: two elements are repeats when they sit in different
 * items of the same list, at the same index among the colliding elements their item holds.
 * Grouping on a composite key rather than merging pairwise is what makes this structural —
 * two elements of one item hold different indices, so no other pair can drag them together.
 *
 * Two escapes are counted rather than guessed at. An `undecided` pair does not merge: merging
 * on a signal that said nothing would suppress false merges. Neither do items that disagree on
 * how many colliding elements they hold — index lines up two-against-two, but against a row
 * rendering only one of the pair it is a coin flip, and a coin flip is not a measurement.
 */
export function groupByRepeat(elements: readonly Element[]): RepeatGrouping {
  const sites = elements.map((element) => repeatSiteOf(element));

  // Each element's index within its own list item, and how many the item holds. Both are
  // properties of the collision set, not of the page: the question is only ever "which of this
  // item's colliding elements is this one", so elements wearing other fingerprints are absent
  // by construction and cannot shift a position.
  const ordinal = new Array<number>(elements.length).fill(0);
  const itemSize = new Array<number>(elements.length).fill(0);
  const byItem = new Map<object, number[]>();

  for (let i = 0; i < elements.length; i += 1) {
    const site = sites[i];
    if (site === null || site === undefined) continue;
    const members = byItem.get(site.item) ?? [];
    members.push(i);
    byItem.set(site.item, members);
  }

  for (const members of byItem.values()) {
    members.sort((a, b) => inDocumentOrder(elements[a] as Element, elements[b] as Element));
    members.forEach((index, position) => {
      ordinal[index] = position;
      itemSize[index] = members.length;
    });
  }

  let undecidedPairs = 0;
  let unalignedPairs = 0;

  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const { verdict } = classifyPair(elements[i] as Element, elements[j] as Element);
      if (verdict === 'undecided') undecidedPairs += 1;
      if (verdict === 'repeated-siblings' && itemSize[i] !== itemSize[j]) unalignedPairs += 1;
    }
  }

  const groups: Element[][] = [];
  const byPosition = new Map<object, Map<string, Element[]>>();

  for (let i = 0; i < elements.length; i += 1) {
    const site = sites[i];
    const element = elements[i] as Element;

    // Outside any keyed list there is no evidence of repetition, and silence is not evidence.
    if (site === null || site === undefined) {
      groups.push([element]);
      continue;
    }

    // The item's size rides in the key so an item this cannot align with its neighbours groups
    // apart rather than being guessed into one of their positions.
    const slot = `${itemSize[i]}:${ordinal[i]}`;
    const inList = byPosition.get(site.list) ?? new Map<string, Element[]>();
    const group = inList.get(slot) ?? [];
    group.push(element);
    inList.set(slot, group);
    byPosition.set(site.list, inList);
  }

  for (const inList of byPosition.values()) groups.push(...inList.values());

  return { groups, undecidedPairs, unalignedPairs };
}
