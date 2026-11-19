// scripts/identity-spike/src/site-referee.ts
// The collision referee, by JSX site: which elements sharing a fingerprint are copies of one
// control, and which are different controls. Replaces the key referee (repeat-oracle.ts) for
// every run after run 2.
//
// THE RULE. Each element has a site sequence: the JSX site of every element above it and of the
// element itself, outermost first, read from the stamps site-plugin.ts puts in the build. Two
// elements are copies of one control exactly when their sequences are equal. Every row of a
// table runs the same JSX, so its buttons have one sequence. Two columns are two JSX sites, so
// their buttons differ at that step. Keys and indices are ignored: they say which copy, never
// which control.
//
// Equality is transitive, so the groups are plain equivalence classes. The key referee's pair
// rule was not, and had to pick which keyed level was the loop. Its nearest-item choice judged
// every row of a nested list distinct (run-2-diagnostic.md).
//
// WHAT IS NOT STAMPED IS A RANGE. Code the build did not run the plugin on, which is mostly
// node_modules, has fibers with no site of their own. Nothing says whether a library's children
// are one loop or several different things, so:
//
// - `atLeast` skips those fibers: a library loop's rows are copies.
// - `atMost` counts each by its type and its key, or its index when unkeyed: a library's rows
//   are all different.
//
// Every element whose path is stamped all the way down gets the same answer under both.
//
// INHERITED STAMPS. A component that spreads its props into unstamped code hands its own stamp
// on. So a stamp equal to one already above the element is treated as unstamped. The cost is
// recursion: a component that renders itself from one JSX line repeats that site honestly, and
// `atLeast` then merges its depths.
//
// Where this is still wrong, in both directions:
//
// - One JSX site rendering different controls from data (`actions.map(a => <IconButton/>)`)
//   is one control here. The key referee said the same.
// - One control written at two sites (`cond ? <button>Save</button> : <button>Save</button>`)
//   is two here, where rows took different branches.
//
// ⚠ Fiber identity is not compared, only stamps, keys and indices, so one call's records are
// plain data from the start. Ids are numbers unique within one `recordSequences` call.
import { getFiber, SITE_PROPERTY } from './fiber.ts';

/** The private fiber fields this reads. */
interface SiteFiber {
  tag?: number;
  type?: unknown;
  key?: string | null;
  index?: number;
  memoizedProps?: unknown;
  return?: SiteFiber | null;
}

/** One element's sequences, as numbers comparable within one `recordSequences` call. */
export interface RecordedSequence {
  /** The stamped sites only: equal means copies under `atLeast`. */
  lower: number;
  /** The stamped sites, plus every unstamped fiber's type and key or index: equal means copies under `atMost`. */
  upper: number;
  /** Fibers on the path carrying their own site. */
  stamped: number;
  /** Fibers on the path with no site of their own, inherited stamps included. */
  unstamped: number;
}

export interface RecordedSequences {
  /** Per element. Null when it has no fiber or no stamped fiber on its path: no evidence. */
  sequences: (RecordedSequence | null)[];
  /** `lower` id → its sites, outermost first, so a person can read what was compared. */
  sites: string[][];
}

/** The site a fiber's own props carry, or null. */
function stampOf(fiber: SiteFiber): string | null {
  const props = fiber.memoizedProps;
  if (typeof props !== 'object' || props === null) return null;
  const value = (props as Record<string, unknown>)[SITE_PROPERTY];
  return typeof value === 'symbol' ? (Symbol.keyFor(value) ?? null) : null;
}

/** Every element's sequences, from ONE pass, so their ids are comparable across all of `elements`. */
export function recordSequences(elements: readonly Element[]): RecordedSequences {
  const intern = (table: Map<string, number>, key: string, onNew?: () => void): number => {
    let id = table.get(key);
    if (id === undefined) {
      id = table.size;
      table.set(key, id);
      onNew?.();
    }
    return id;
  };
  const types = new Map<unknown, number>();
  const typeOf = (fiber: SiteFiber): string => {
    const { type } = fiber;
    if (typeof type === 'string') return type;
    if (type === null || type === undefined) return `tag${fiber.tag ?? '?'}`;
    let id = types.get(type);
    if (id === undefined) {
      id = types.size;
      types.set(type, id);
    }
    return `t${id}`;
  };
  const lowers = new Map<string, number>();
  const uppers = new Map<string, number>();
  const sites: string[][] = [];

  const sequences = elements.map((element): RecordedSequence | null => {
    const path: SiteFiber[] = [];
    for (let fiber = getFiber<SiteFiber>(element); fiber !== null && fiber !== undefined; fiber = fiber.return ?? null) {
      path.push(fiber);
    }
    path.reverse();

    const seen = new Set<string>();
    const lower: string[] = [];
    const upper: string[] = [];
    for (const fiber of path) {
      const stamp = stampOf(fiber);
      if (stamp !== null && !seen.has(stamp)) {
        seen.add(stamp);
        lower.push(stamp);
        upper.push(`s ${stamp}`);
      } else {
        const key = fiber.key;
        upper.push(`u ${typeOf(fiber)} ${key === null || key === undefined ? `#${fiber.index ?? 0}` : `k${key}`}`);
      }
    }
    if (lower.length === 0) return null;

    return {
      lower: intern(lowers, lower.join('\n'), () => sites.push(lower)),
      upper: intern(uppers, upper.join('\n')),
      stamped: lower.length,
      unstamped: path.length - lower.length,
    };
  });
  return { sequences, sites };
}

/** What the referee made of one fingerprint's worth of colliding elements. */
export interface SiteGrouping {
  /** Indices into the input, one group per control under `atLeast`. */
  groups: number[][];
  /**
   * How many distinct controls wear the fingerprint. `atMost` refines `atLeast` (equal upper
   * sequences have equal lower ones), so the range is never inverted. An element with no
   * evidence is its own control under both: silence is not a repeat.
   */
  distinctElements: { atLeast: number; atMost: number };
  /** Elements with no evidence. */
  unrecorded: number;
}

export function groupSequences(sequences: readonly (RecordedSequence | null)[]): SiteGrouping {
  const byLower = new Map<number, number[]>();
  const uppers = new Set<number>();
  const groups: number[][] = [];
  let unrecorded = 0;

  sequences.forEach((sequence, i) => {
    if (sequence === null) {
      unrecorded += 1;
      groups.push([i]);
      return;
    }
    const group = byLower.get(sequence.lower) ?? [];
    group.push(i);
    byLower.set(sequence.lower, group);
    uppers.add(sequence.upper);
  });
  groups.push(...byLower.values());

  return {
    groups,
    distinctElements: { atLeast: byLower.size + unrecorded, atMost: uppers.size + unrecorded },
    unrecorded,
  };
}
