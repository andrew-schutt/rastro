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
import { roleNameFingerprint, selectorPathFingerprint } from './baselines.js';

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

const via = (walk: ChainWalk) => (element: Element) =>
  describeElement(element, defaultRedactor, walk).fingerprint;

/** Strategy 3: every named component fiber, no file. What `fingerprint()` does with no plugin. */
const fiberWalk: ChainWalk = (element) => ({ componentChain: componentChain(getFiber(element)) });

/** Strategy 4: the stamped chain with the file left off, as a plugin without files produces. */
const attributeWalk: ChainWalk = (element) => ({ componentChain: attributeChain(element) });

export const CORPUS_FINGERPRINT: Record<CorpusStrategy, (element: Element) => string> = {
  'role+name': (element) => roleNameFingerprint(element),
  'selector-path': (element) => selectorPathFingerprint(element),
  fiber: via(fiberWalk),
  attribute: via(attributeWalk),
  // Strategy 5 is the default walk on an annotated document: chain and file from one pass.
  // The caller checks the document is annotated, or this would silently become strategy 3.
  'attribute+file': via(defaultChainWalk),
  'marked-fiber': via(markedFiberWalk),
};
