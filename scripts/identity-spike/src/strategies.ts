// scripts/identity-spike/src/strategies.ts
// §3.2 rule 1's six strategies, computed from ONE build that carries every annotation.
//
// The continuity smoke test builds its app once per strategy: no plugin for the fiber walk,
// stamps without files for the attribute chain, and so on, and lets `fingerprint()` pick the
// walk from what the document carries. A corpus app is built once per variant, with stamps,
// files and marks all present, so `fingerprint()` would read the attribute chain under every
// strategy. Here each strategy names its walk explicitly instead. `continuity/strategies.test.ts`
// proves this gives the same fingerprints as the per-strategy builds, on the smoke app.
import {
  attributeChain,
  componentChain,
  defaultChainWalk,
  defaultRedactor,
  describeElement,
  getFiber,
  markedFiberWalk,
  type ChainWalk,
} from 'rastro-core';
import { roleNameParts, selectorPathParts } from './baselines.ts';

/** Rule 1's order: the table's numbering, 1 to 6. */
export const RULE_1_STRATEGIES = [
  'role+name',
  'selector-path',
  'fiber',
  'attribute',
  'attribute+file',
  'marked-fiber',
] as const;
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
  /** The innermost chain entry's file, for the strategies that carry one. */
  file?: string;
  /** The accessible name, redacted, as it sits in the fingerprint. */
  name?: string;
}

const via = (walk: ChainWalk) => (element: Element): StrategyParts => {
  const { fingerprint, role, componentChain, sourceFile, accessibleName } = describeElement(element, defaultRedactor, walk);
  return {
    fingerprint,
    role,
    ...(componentChain.length === 0 ? {} : { chain: componentChain.join('>') }),
    ...(sourceFile === undefined ? {} : { file: sourceFile }),
    ...(accessibleName === undefined ? {} : { name: accessibleName }),
  };
};

/** Strategy 3: every named component fiber, no file. What `fingerprint()` does with no plugin. */
const fiberWalk: ChainWalk = (element) => ({ componentChain: componentChain(getFiber(element)) });

/** Strategy 4: the stamped chain with the file left off, as a plugin without files produces. */
const attributeWalk: ChainWalk = (element) => ({ componentChain: attributeChain(element) });

/** Each strategy's fingerprint with its parts, from one computation so they cannot disagree. */
export const CORPUS_PARTS: Record<CorpusStrategy, (element: Element) => StrategyParts> = {
  'role+name': (element) => roleNameParts(element),
  'selector-path': (element) => selectorPathParts(element),
  fiber: via(fiberWalk),
  attribute: via(attributeWalk),
  // Strategy 5 is the default walk on an annotated document: chain and file from one pass.
  // The caller checks the document is annotated, or this would silently become strategy 3.
  'attribute+file': via(defaultChainWalk),
  'marked-fiber': via(markedFiberWalk),
};

export const CORPUS_FINGERPRINT = Object.fromEntries(
  RULE_1_STRATEGIES.map((strategy) => [strategy, (element: Element) => CORPUS_PARTS[strategy](element).fingerprint]),
) as Record<CorpusStrategy, (element: Element) => string>;
