// scripts/identity-spike/scoring/flow-rule.ts
// Rule 3: zero collisions among the flow that matters, judged in the state each row names.
//
// Rows are matched to captured elements by hand (README, item 3), into a matches file this
// module only reads. It proposes matches at the other commits by identical description, and it
// never shows a fingerprint or a verdict while doing so.
import type { StateRecord } from '../corpus/flows.ts';
import type { ElementDescription } from '../src/describe.ts';
import type { CapturedElement } from '../src/page.ts';
import { groupSites } from '../src/repeat-oracle.ts';
import type { CorpusStrategy } from '../src/strategies.ts';

/** One row's match at one commit. `element` null means not found, or not captured: reported, not substituted. */
export interface RowMatch {
  state: string;
  element: number | null;
  /** `hand` or `proposed` (confirmed by a person). */
  by: 'hand' | 'proposed';
  /** Who confirmed it. */
  matcher: string;
  note?: string;
}

/** Matches file: commit index → row id → match. */
export type Matches = Record<string, Record<string, RowMatch>>;

/** Element descriptions are compared whole: every field, as README item 3 fixes. */
const same = (a: ElementDescription, b: ElementDescription) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The element at another commit whose description is identical to the commit-10 match, or null
 * when there is none or more than one, which leaves the row to a person.
 */
export function propose(reference: CapturedElement, state: StateRecord): number | null {
  const found = state.elements.flatMap((element, i) => (same(element.description, reference.description) ? [i] : []));
  return found.length === 1 ? found[0]! : null;
}

export type RowVerdict =
  | { verdict: 'clear' }
  /** Shares a fingerprint with an element the referee calls distinct, or cannot rule on. */
  | { verdict: 'collides'; with: number[]; undecided: boolean }
  | { verdict: 'unmatched' }
  | { verdict: 'void' };

/**
 * One row in its state: does its element share a fingerprint with any other distinct element?
 * Repeats of the element itself (rows of its own list, by the referee) are not collisions. An
 * element the key cannot rule on counts as distinct, as it does in the referee's lower bound,
 * and is marked undecided for the hand inspection §3.2 requires.
 */
export function judgeRow(state: StateRecord, element: number | null, strategy: CorpusStrategy, isVoid: boolean): RowVerdict {
  if (isVoid) return { verdict: 'void' };
  if (element === null) return { verdict: 'unmatched' };
  const print = state.elements[element]?.fingerprints[strategy];
  if (print === undefined) return { verdict: 'unmatched' };
  const sharing = state.elements.flatMap((other, i) => (other.fingerprints[strategy] === print ? [i] : []));
  if (sharing.length === 1) return { verdict: 'clear' };
  const sites = sharing.map((i) => state.elements[i]!.site);
  const { groups } = groupSites(sites);
  const own = groups.find((group) => group.includes(sharing.indexOf(element)))!;
  const others = sharing.filter((_, position) => !own.includes(position));
  if (others.length === 0) return { verdict: 'clear' };
  const mine = state.elements[element]!.site;
  const undecided = mine === null || others.some((i) => state.elements[i]!.site === null);
  return { verdict: 'collides', with: others, undecided };
}
