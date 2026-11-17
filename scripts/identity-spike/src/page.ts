// scripts/identity-spike/src/page.ts
// The corpus runner's in-page entry. Bundled with esbuild and evaluated in a loaded corpus app,
// after the app has settled, never before it loads: nothing here touches the app's own start.
import { documentIsAnnotated, INTERACTIVE_SELECTOR, resetAnnotationProbe, type ComponentMark } from 'rastro-core';
import { markedAncestry } from './ancestry.js';
import { describeForMatching, type ElementDescription } from './describe.js';
import { recordSites, type RecordedSite } from './repeat-oracle.js';
import { CORPUS_PARTS, RULE_1_STRATEGIES, type CorpusStrategy, type StrategyParts } from './strategies.js';

export interface CapturedElement {
  /**
   * Whether the element has a box a user could see. Recorded, never filtered on: rule 1 counts
   * every interactive element, and which ones to slice out is the analysis's call, not capture's.
   */
  visible: boolean;
  /** The element's fingerprint under each of rule 1's six strategies. */
  fingerprints: Record<CorpusStrategy, string>;
  /**
   * What each fingerprint was composed from: rule 4's proposers compare these (`DriftRecord`).
   * From the same computation as `fingerprints`, so the two cannot disagree.
   */
  parts: Record<CorpusStrategy, Omit<StrategyParts, 'fingerprint'>>;
  /** Every first-party component above it, with files, uncapped: rule 2's "touched" (ancestry.ts). */
  ancestry: ComponentMark[];
  /**
   * The collision referee's input, recorded while the fibers exist so it can rule offline
   * (`groupSites`). Numbers compare only within one capture. Null outside any keyed list.
   */
  site: RecordedSite | null;
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
  const found = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
  // One pass over the whole capture, so every site's numbers are comparable with every other's.
  const sites = recordSites(found);
  const elements = found.map((element, i): CapturedElement => {
    const fingerprints = {} as CapturedElement['fingerprints'];
    const parts = {} as CapturedElement['parts'];
    for (const strategy of RULE_1_STRATEGIES) {
      const { fingerprint, ...rest } = CORPUS_PARTS[strategy](element);
      fingerprints[strategy] = fingerprint;
      parts[strategy] = rest;
    }
    return {
      visible: isVisible(element),
      fingerprints,
      parts,
      ancestry: markedAncestry(element),
      site: sites[i] ?? null,
      description: describeForMatching(element),
    };
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
