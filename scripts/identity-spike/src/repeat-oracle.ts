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
  /**
   * Position in the children array React reconciled. Load-bearing for alignment — see
   * `slotWithinItem` for why a hole in that array is the signal and not a nuisance.
   */
  index?: number;
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
  return classifySites(repeatSiteOf(a), repeatSiteOf(b));
}

/**
 * The verdict, given both sites already resolved.
 *
 * Split out so `groupByRepeat` can rule on n² pairs from the sites it resolved once, rather
 * than re-walking two fiber chains per pair. That is not only the cheaper shape but the
 * safer one: React double-buffers, so a second walk can land on a different tree than the
 * one the positions came from, and the two halves of one verdict would then disagree.
 */
function classifySites(siteA: RepeatSite | null, siteB: RepeatSite | null): CollisionVerdict {
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
  /**
   * How many distinct logical elements wear this fingerprint, as a RANGE.
   *
   * `atLeast` is `groups.length`: what the key evidence says, merging everything it can. But
   * a key does not prove a loop — React stamps one on hand-written static siblings too, and
   * `<section key="left">…<section key="right">` is two items of one parent that no signal
   * here separates. So `atMost` assumes no key is a loop and counts every element as its own
   * thing. The true count is inside, and the WIDTH is the disclosure: it says how much of the
   * answer is resting on `key` rather than on something proven, which a single number would
   * launder away. §3.2 asks for a pre-committed rule, not a point estimate with a hidden
   * assumption inside it.
   */
  distinctElements: { atLeast: number; atMost: number };
  /** Element pairs the key signal could not rule on. These want a second referee, or a human. */
  undecidedPairs: number;
  /**
   * Element pairs the key called repeats and the JSX slot then held apart.
   *
   * NOT an escape hatch — these are decided, and in a list of two controls most cross pairs
   * land here as a matter of course. It is reported because it is where the slot signal is
   * doing the work, and therefore where the one way it can be wrong shows up: a control
   * rendered from two JSX sites (`cond ? <button>Save</button> : <button>Save</button>`) is
   * one logical element that the slots split, and this count bounds how much of the answer
   * could be inflated that way.
   */
  slotSeparatedPairs: number;
}

/**
 * Where an element sits INSIDE its list item: the chain of child positions from the item down
 * to the element, as `"1.0.2"`.
 *
 * This is the JSX SITE, not a DOM position, and the difference is the whole point. React sets
 * `fiber.index` from the position in the children array it reconciled, and a branch that
 * rendered nothing still occupies its slot — `{canEdit ? <button/> : null}<button/>` puts the
 * second button at index 1 in every row, whether or not the first one rendered. So two items
 * of one loop produce the same chain even when they hold different numbers of elements, and
 * two different JSX sites produce different chains even when the rendered DOM is identical.
 *
 * Null when the item is not an ancestor of the element's fiber, which the caller treats as no
 * evidence rather than as a position.
 */
function slotWithinItem(element: Element, item: object): string | null {
  let fiber: KeyedFiber | null = getFiber(element);
  const steps: number[] = [];

  while (fiber !== null && fiber !== undefined) {
    if ((fiber as object) === item) return steps.reverse().join('.');
    steps.push(fiber.index ?? 0);
    fiber = fiber.return ?? null;
  }

  return null;
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
 * Repeats are matched by SLOT instead: two elements are repeats when they sit in different
 * items of the same list, at the same JSX position within their item (`slotWithinItem`).
 * Grouping on a composite key rather than merging pairwise is what makes this structural —
 * two elements of one item hold different slots, so no other pair can drag them together.
 *
 * The slot is what the item RENDERED, not what it contains: counting a row's colliding
 * elements and lining the counts up would merge a row holding `[X, Act]` with one holding
 * `[Act, Y]`, both being two-element rows, and no counter would fire. The slot separates them
 * because `X`, `Act` and `Y` are three JSX sites at three indices.
 *
 * An `undecided` pair does not merge: merging on a signal that said nothing would suppress
 * false merges, which are the failure being measured. Nor do elements whose slots disagree —
 * the key called them repeats, the position did not, and a coin flip between two signals is
 * not a measurement.
 *
 * ⚠ What this still cannot see: whether a key means a LOOP at all. React stamps keys on
 * hand-written static siblings too, and two of those are two items of one parent that no
 * signal here distinguishes from two rows of a `.map()`. `distinctElements` carries that as a
 * range rather than pretending the merge was proven.
 */
export function groupByRepeat(elements: readonly Element[]): RepeatGrouping {
  // Resolved once. Every verdict and every slot below reads from these, so the whole function
  // rules on ONE snapshot of the fiber tree (see `classifySites`).
  const sites = elements.map((element) => repeatSiteOf(element));
  const slots = sites.map((site, i) =>
    site === null ? null : slotWithinItem(elements[i] as Element, site.item),
  );

  let undecidedPairs = 0;
  let slotSeparatedPairs = 0;

  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const { verdict } = classifySites(sites[i] ?? null, sites[j] ?? null);
      if (verdict === 'undecided') undecidedPairs += 1;
      // A key-repeat pair that the slots hold apart. Counted here rather than inferred from
      // the groups, because two elements can land in different groups for either reason.
      if (verdict === 'repeated-siblings' && slots[i] !== slots[j]) slotSeparatedPairs += 1;
    }
  }

  const groups: Element[][] = [];
  const bySlot = new Map<object, Map<string, Element[]>>();

  for (let i = 0; i < elements.length; i += 1) {
    const site = sites[i];
    const slot = slots[i];
    const element = elements[i] as Element;

    // Outside any keyed list there is no evidence of repetition, and silence is not evidence.
    // Same for an item that is not an ancestor of its own element, which should not happen and
    // is not worth guessing about if it does.
    if (site === null || site === undefined || slot === null || slot === undefined) {
      groups.push([element]);
      continue;
    }

    const inList = bySlot.get(site.list) ?? new Map<string, Element[]>();
    const group = inList.get(slot) ?? [];
    group.push(element);
    inList.set(slot, group);
    bySlot.set(site.list, inList);
  }

  for (const inList of bySlot.values()) groups.push(...inList.values());

  return {
    groups,
    distinctElements: { atLeast: groups.length, atMost: elements.length },
    undecidedPairs,
    slotSeparatedPairs,
  };
}
