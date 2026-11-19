// scripts/identity-spike/src/page.ts
// The corpus runner's in-page entry. Bundled with esbuild and evaluated in a loaded corpus app,
// after the app has settled, never before it loads: nothing here touches the app's own start.
import { COMPONENT_ATTRIBUTE, INTERACTIVE_SELECTOR } from 'rastro-core';
import { markedAncestry } from './ancestry.ts';
import type { ComponentMark } from './fiber.ts';
import { describeForMatching, type ElementDescription } from './describe.ts';
import { recordSites, type RecordedSite } from './repeat-oracle.ts';
import { recordSequences, type RecordedSequence } from './site-referee.ts';
import { CORPUS_PARTS, RULE_1_STRATEGIES, type CorpusStrategy, type StrategyParts } from './strategies.ts';

export interface CapturedElement {
  /**
   * Whether the element has a box a user could see. Recorded, never filtered on: rule 1 counts
   * every interactive element, and which ones to slice out is the analysis's call, not capture's.
   */
  visible: boolean;
  /** The element's fingerprint under each of rule 1's strategies. */
  fingerprints: Record<CorpusStrategy, string>;
  /**
   * What each fingerprint was composed from: rule 4's proposers compare these (`DriftRecord`).
   * From the same computation as `fingerprints`, so the two cannot disagree.
   */
  parts: Record<CorpusStrategy, Omit<StrategyParts, 'fingerprint'>>;
  /** Every first-party component above it, with files, uncapped: rule 2's "touched" (ancestry.ts). */
  ancestry: ComponentMark[];
  /**
   * The key referee's input, recorded while the fibers exist so it can rule offline
   * (`groupSites`). Numbers compare only within one capture. Null outside any keyed list. Run 2
   * was judged by it. Kept so later runs can report it beside the site referee.
   */
  site: RecordedSite | null;
  /**
   * The site referee's input (`groupSequences`): the element's JSX-site sequence, as numbers
   * that compare only within one capture. Null when no stamped fiber is above it. Absent from
   * run 2's captures, which predate it.
   */
  sequence?: RecordedSequence | null;
  /**
   * What a person matches rule 3's rows against, read from the DOM and never from a strategy
   * (see describe.ts). Recorded, not judged: the rebuild control compares fingerprints only.
   */
  description: ElementDescription;
}

export interface PageCapture {
  /** False means the build plugin stamped nothing: the build is not the one pre-registered. */
  annotated: boolean;
  elements: CapturedElement[];
  /** `sequence.lower` → its JSX sites, outermost first, so a person can read what was compared. */
  sites: string[][];
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return true;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return element.getClientRects().length > 0;
}

/** Every interactive element in document order, under every strategy at once. */
export function capturePage(): PageCapture {
  const annotated = document.querySelector(`[${COMPONENT_ATTRIBUTE}]`) !== null;
  const found = [...document.querySelectorAll(INTERACTIVE_SELECTOR)];
  // One pass over the whole capture, so every site's numbers are comparable with every other's.
  const sites = recordSites(found);
  const sequences = recordSequences(found);
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
      sequence: sequences.sequences[i] ?? null,
      description: describeForMatching(element),
    };
  });
  return { annotated, elements, sites: sequences.sites };
}

declare global {
  interface Window {
    __rastroCorpus?: { capturePage: typeof capturePage; strategies: readonly CorpusStrategy[] };
  }
}

// The strategy list travels with the bundle, so the Node side never needs a second copy.
window.__rastroCorpus = { capturePage, strategies: RULE_1_STRATEGIES };
