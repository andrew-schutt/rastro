// scripts/identity-spike/src/strategies.ts
// The strategies §3.2 measures, computed from ONE build.
//
// Run 2 measured six. The fiber walk, the attribute chain with its file, and the marked fiber
// walk were cut after it (docs/NOTES.md), so three remain: role + accessible name and the
// selector path, the two baselines, and `attribute`, which is Rastro's fingerprint:
// `fingerprint()` itself. Their names are run 2's, so its captures stay readable.
import { defaultRedactor, describeElement } from 'rastro-core';
import { roleNameParts, selectorPathParts } from './baselines.ts';

/** Rule 1's strategies, in run 2's order. */
export const RULE_1_STRATEGIES = ['role+name', 'selector-path', 'attribute'] as const;
export type CorpusStrategy = (typeof RULE_1_STRATEGIES)[number];

/**
 * A fingerprint and the parts it was composed from: what rule 4's proposers compare
 * (`DriftRecord`). Recorded beside the fingerprint, never parsed back out of it, because an
 * accessible name can contain the `|` and `>` the string is joined with.
 */
export interface StrategyParts {
  fingerprint: string;
  role: string;
  /** The structural part, joined: a component chain (`A>B`), or strategy 2's selector path. */
  chain?: string;
  /** The innermost chain entry's file. Run 2's `attribute+file` carried one; no strategy now does. */
  file?: string;
  /** The accessible name, redacted, as it sits in the fingerprint. */
  name?: string;
}

/** Rastro's fingerprint, with the parts it was composed from. */
function attributeParts(element: Element): StrategyParts {
  const { fingerprint, role, componentChain, accessibleName } = describeElement(element, defaultRedactor);
  return {
    fingerprint,
    role,
    ...(componentChain.length === 0 ? {} : { chain: componentChain.join('>') }),
    ...(accessibleName === undefined ? {} : { name: accessibleName }),
  };
}

/** Each strategy's fingerprint with its parts, from one computation so they cannot disagree. */
export const CORPUS_PARTS: Record<CorpusStrategy, (element: Element) => StrategyParts> = {
  'role+name': (element) => roleNameParts(element),
  'selector-path': (element) => selectorPathParts(element),
  attribute: attributeParts,
};

export const CORPUS_FINGERPRINT = Object.fromEntries(
  RULE_1_STRATEGIES.map((strategy) => [strategy, (element: Element) => CORPUS_PARTS[strategy](element).fingerprint]),
) as Record<CorpusStrategy, (element: Element) => string>;
