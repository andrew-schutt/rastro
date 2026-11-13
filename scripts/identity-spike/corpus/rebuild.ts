// scripts/identity-spike/corpus/rebuild.ts
// CORPUS.md's rebuild control: every commit is loaded twice, and every fingerprint under every
// strategy must be identical across the two loads. If it is not, that commit's numbers are void
// until the runner is fixed.
//
// "Identical" is strict: the same elements, in the same document order, with the same
// fingerprint under each strategy. A set comparison would let two elements swap fingerprints
// unnoticed, which is exactly the instability the control exists to catch.
//
// Some strategies are reported rather than judged (CORPUS.md, 2026-11-09 amendment): a strategy
// that is unstable across loads by its own definition says something about that strategy, and
// nothing about whether the runner is deterministic. Its stability is still measured and kept.
import type { CapturedElement } from '../src/page.ts';
import type { CorpusStrategy } from '../src/strategies.ts';

export interface ScreenCapture {
  screen: string;
  /** False when the screen could not be captured at all; `error` says why. */
  captured: boolean;
  error?: string;
  elements: CapturedElement[];
}

export interface ScreenVerdict {
  screen: string;
  /** Element counts on each load. */
  elements: [number, number];
  /** Judged strategies whose fingerprint sequence differs between the loads. Empty means it held. */
  unstable: CorpusStrategy[];
  /** Reported-only strategies that differ between the loads. Measured, never failing. */
  reported: CorpusStrategy[];
  /** Set when either load could not capture the screen: a control that cannot be judged. */
  uncaptured?: true;
}

export interface RebuildVerdict {
  passed: boolean;
  screens: ScreenVerdict[];
}

function sequence(elements: readonly CapturedElement[], strategy: CorpusStrategy): string[] {
  return elements.map((element) => element.fingerprints[strategy]);
}

/**
 * Judged against `expected`, the pre-registered screen list, never against what happened to be
 * captured: a load that captured nothing must not pass by having nothing to compare.
 */
export function rebuildControl(
  expected: readonly string[],
  first: readonly ScreenCapture[],
  second: readonly ScreenCapture[],
  strategies: readonly CorpusStrategy[],
  reportedOnly: readonly CorpusStrategy[] = [],
): RebuildVerdict {
  const names = [...new Set([...expected, ...first.map((c) => c.screen), ...second.map((c) => c.screen)])];
  const screens = names.map((screen): ScreenVerdict => {
    const a = first.find((capture) => capture.screen === screen);
    const b = second.find((capture) => capture.screen === screen);
    const counts: [number, number] = [a?.elements.length ?? 0, b?.elements.length ?? 0];
    if (a === undefined || b === undefined || !a.captured || !b.captured) {
      return { screen, elements: counts, unstable: [], reported: [], uncaptured: true };
    }
    const differs = strategies.filter((strategy) => {
      const left = sequence(a.elements, strategy);
      const right = sequence(b.elements, strategy);
      return left.length !== right.length || left.some((fingerprint, i) => fingerprint !== right[i]);
    });
    return {
      screen,
      elements: counts,
      unstable: differs.filter((strategy) => !reportedOnly.includes(strategy)),
      reported: differs.filter((strategy) => reportedOnly.includes(strategy)),
    };
  });

  return {
    passed:
      strategies.some((strategy) => !reportedOnly.includes(strategy)) &&
      screens.length > 0 &&
      screens.every((verdict) => verdict.unstable.length === 0 && verdict.uncaptured !== true),
    screens,
  };
}

export interface FlowVerdict extends RebuildVerdict {
  /** Rows whose "first" item had a different label on the two loads. None on both is not noise. */
  firsts: { row: string; labels: [string | null, string | null] }[];
}

/**
 * The control over a flow's states (CORPUS.md, 2026-11-09 amendment on how flows are walked):
 * each state is held to the same strict, positional comparison as a screen, and a state not
 * reached on either load fails it. "A first item that differs between the two loads is caught
 * by the rebuild control", so the labels the walk recorded must match too.
 */
export function flowControl(
  expected: readonly string[],
  first: { states: readonly ScreenCapture[]; firsts: Readonly<Record<string, string | null>> },
  second: { states: readonly ScreenCapture[]; firsts: Readonly<Record<string, string | null>> },
  strategies: readonly CorpusStrategy[],
  reportedOnly: readonly CorpusStrategy[] = [],
): FlowVerdict {
  const states = rebuildControl(expected, first.states, second.states, strategies, reportedOnly);
  const rows = [...new Set([...Object.keys(first.firsts), ...Object.keys(second.firsts)])];
  const firsts = rows
    .map((row) => ({ row, labels: [first.firsts[row] ?? null, second.firsts[row] ?? null] as [string | null, string | null] }))
    .filter(({ labels: [a, b] }) => a !== b);
  return { ...states, passed: states.passed && firsts.length === 0, firsts };
}
