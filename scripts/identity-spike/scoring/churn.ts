// scripts/identity-spike/scoring/churn.ts
// Rule 2's churn, and rule 1c's false splits, across one commit pair on the screens both have.
import type { StateRecord } from '../corpus/flows.ts';
import type { CapturedElement } from '../src/page.ts';
import type { CorpusStrategy } from '../src/strategies.ts';
import type { Touch } from './touched.ts';

/** One fingerprint present on a screen at the older commit and absent from it at the newer. */
export interface ChurnInstance {
  screen: string;
  fingerprint: string;
  /** Indices into the older capture's elements on that screen. */
  elements: number[];
  /**
   * Untouched if any element wearing it was untouched: every one of them changed, so an
   * untouched one changed without cause (README, item 1). Otherwise undetermined if any was,
   * otherwise touched.
   */
  touch: Touch;
  /** File-level, reported beside and never judged. */
  fileLevel: boolean;
  /**
   * Whether an element's role and accessible name are absent from the newer screen. A hint for
   * rule 2's one excuse (a change to the element's own role or name). The excuse itself needs
   * the diff line, so a person grants it.
   */
  roleOrNameChanged: boolean;
}

export interface PairChurn {
  vanished: ChurnInstance[];
  /** Fingerprints new on a screen at the newer commit. Reported, not judged: vanished counts each split once. */
  appeared: number;
  /** Screens captured at only one of the two commits: reported absent, never replaced. */
  absent: string[];
}

const fingerprintsOf = (elements: readonly CapturedElement[], strategy: CorpusStrategy) =>
  new Set(elements.map((element) => element.fingerprints[strategy]));

export function churn(
  before: ReadonlyMap<string, StateRecord>,
  after: ReadonlyMap<string, StateRecord>,
  strategy: CorpusStrategy,
  touchOf: (element: CapturedElement) => { touch: Touch; fileLevel: boolean },
): PairChurn {
  const result: PairChurn = { vanished: [], appeared: 0, absent: [] };
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(name);
    const now = after.get(name);
    if (was === undefined || now === undefined) {
      result.absent.push(name);
      continue;
    }
    const nowPrints = fingerprintsOf(now.elements, strategy);
    const wasPrints = fingerprintsOf(was.elements, strategy);
    const nowNames = fingerprintsOf(now.elements, 'role+name');
    result.appeared += [...nowPrints].filter((print) => !wasPrints.has(print)).length;

    const gone = new Map<string, number[]>();
    was.elements.forEach((element, i) => {
      const print = element.fingerprints[strategy];
      if (!nowPrints.has(print)) gone.set(print, [...(gone.get(print) ?? []), i]);
    });
    for (const [fingerprint, indices] of gone) {
      const touches = indices.map((i) => touchOf(was.elements[i]!));
      const kinds = touches.map((t) => t.touch);
      result.vanished.push({
        screen: name,
        fingerprint,
        elements: indices,
        touch: kinds.includes('untouched') ? 'untouched' : kinds.includes('undetermined') ? 'undetermined' : 'touched',
        fileLevel: touches.some((t) => t.fileLevel),
        roleOrNameChanged: indices.some((i) => !nowNames.has(was.elements[i]!.fingerprints['role+name'])),
      });
    }
  }
  return result;
}

export interface SplitCount {
  /** Elements matched across the pair by screen, role and accessible name. */
  matched: number;
  /** Matched elements whose fingerprint under the strategy changed. */
  split: number;
  /** Elements whose key was not unique on its screen at either commit, so not matched (README, item 7). */
  skipped: number;
}

/** Rule 1c: elements whose route, role and accessible name held across the pair, but whose fingerprint did not. */
export function falseSplits(
  before: ReadonlyMap<string, StateRecord>,
  after: ReadonlyMap<string, StateRecord>,
  strategy: CorpusStrategy,
): SplitCount {
  const count: SplitCount = { matched: 0, split: 0, skipped: 0 };
  const byKey = (elements: readonly CapturedElement[]) => {
    const keyed = new Map<string, CapturedElement[]>();
    for (const element of elements) {
      const key = element.fingerprints['role+name'];
      keyed.set(key, [...(keyed.get(key) ?? []), element]);
    }
    return keyed;
  };
  for (const [name, was] of before) {
    const now = after.get(name);
    if (now === undefined) continue;
    const wasKeys = byKey(was.elements);
    const nowKeys = byKey(now.elements);
    for (const [key, wasElements] of wasKeys) {
      const nowElements = nowKeys.get(key);
      if (nowElements === undefined) continue;
      if (wasElements.length !== 1 || nowElements.length !== 1) {
        count.skipped += wasElements.length;
        continue;
      }
      count.matched += 1;
      if (wasElements[0]!.fingerprints[strategy] !== nowElements[0]!.fingerprints[strategy]) count.split += 1;
    }
  }
  return count;
}
