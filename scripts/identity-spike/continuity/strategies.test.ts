/**
 * @vitest-environment jsdom
 */
// scripts/identity-spike/continuity/strategies.test.ts
// The corpus runner computes all six strategies from ONE build carrying stamps, files and marks
// (src/strategies.ts). The smoke test builds once per strategy instead. These must agree, or the
// corpus would be measuring something other than what the smoke test pins.
//
// The single build here is the harness's `marked-fiber` build, which is exactly the corpus
// patch's plugin options: `includeSourceFile` on, `markComponents` on.
import { act } from 'react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_SELECTOR, resetAnnotationProbe } from 'rastro-core';
import { CORPUS_FINGERPRINT, RULE_1_STRATEGIES } from '../src/strategies.js';
import { loadApp, loadBaseApp, snapshotVariant, STRATEGIES, type Files } from './harness.js';
import { SCENARIOS } from './scenarios.js';

/** Render the single corpus-style build once and fingerprint it under every strategy. */
function singleBuild(files: Files): Record<string, string[]> {
  const App = loadApp(files, 'marked-fiber');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(React.createElement(App)));
    resetAnnotationProbe(document);
    const elements = [...container.querySelectorAll(INTERACTIVE_SELECTOR)];
    return Object.fromEntries(
      RULE_1_STRATEGIES.map((strategy) => [
        strategy,
        elements.map((element) => CORPUS_FINGERPRINT[strategy](element)),
      ]),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    resetAnnotationProbe(document);
  }
}

const base = loadBaseApp();

describe('one annotated build, six explicit walks', () => {
  it('covers exactly the smoke test strategies', () => {
    expect([...RULE_1_STRATEGIES].sort()).toEqual([...STRATEGIES].sort());
  });

  it.each([{ name: 'base', edit: (files: Files) => new Map(files) }, ...SCENARIOS])(
    '$name: matches the per-strategy builds under every strategy',
    ({ edit }) => {
      const files = edit(base);
      const single = singleBuild(files);
      for (const strategy of STRATEGIES) {
        const perBuild = snapshotVariant(files, strategy).map((entry) => entry.fingerprint);
        expect(single[strategy], strategy).toEqual(perBuild);
      }
    },
  );
});
