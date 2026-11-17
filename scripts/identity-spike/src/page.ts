// scripts/identity-spike/src/page.ts
// The corpus runner's in-page entry. Bundled with esbuild and evaluated in a loaded corpus app,
// after the app has settled, never before it loads: nothing here touches the app's own start.
import { documentIsAnnotated, INTERACTIVE_SELECTOR, resetAnnotationProbe } from 'rastro-core';
import { describeForMatching, type ElementDescription } from './describe.js';
import { CORPUS_FINGERPRINT, RULE_1_STRATEGIES, type CorpusStrategy } from './strategies.js';

export interface CapturedElement {
  /**
   * Whether the element has a box a user could see. Recorded, never filtered on: rule 1 counts
   * every interactive element, and which ones to slice out is the analysis's call, not capture's.
   */
  visible: boolean;
  /** The element's fingerprint under each of rule 1's six strategies. */
  fingerprints: Record<CorpusStrategy, string>;
  /**
   * What a person matches rule 3's rows against, read from the DOM and never from a strategy
   * (see describe.ts). Recorded, not judged: the rebuild control compares fingerprints only.
   */
  description: ElementDescription;
}

export interface PageCapture {
  /** False means strategy 5 would have read fibers: the build is not what was pre-registered. */
  annotated: boolean;
  elements: CapturedElement[];
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return element.getClientRects().length > 0;
}

/** Every interactive element in document order, under all six strategies at once. */
export function capturePage(): PageCapture {
  resetAnnotationProbe(document);
  const annotated = documentIsAnnotated(document);
  const elements = [...document.querySelectorAll(INTERACTIVE_SELECTOR)].map((element) => {
    const fingerprints = {} as Record<CorpusStrategy, string>;
    for (const strategy of RULE_1_STRATEGIES) {
      fingerprints[strategy] = CORPUS_FINGERPRINT[strategy](element);
    }
    return { visible: isVisible(element), fingerprints, description: describeForMatching(element) };
  });
  return { annotated, elements };
}

declare global {
  interface Window {
    __rastroCorpus?: { capturePage: typeof capturePage; strategies: readonly CorpusStrategy[] };
  }
}

// The strategy list travels with the bundle, so the Node side never needs a second copy.
window.__rastroCorpus = { capturePage, strategies: RULE_1_STRATEGIES };
