/**
 * @vitest-environment jsdom
 */
// scripts/identity-spike/continuity/strategies.test.ts
// The corpus runner computes every strategy from ONE build carrying stamps and marks
// (src/strategies.ts). The smoke test builds once per strategy instead. These must agree, or the
// corpus would be measuring something other than what the smoke test pins.
//
// The single build here is the harness's `attribute` build with marks, which is exactly what the
// corpus patch builds: the plugin, then the measurement's mark plugin.
import { act } from 'react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_SELECTOR, UNKNOWN_CHAIN } from 'rastro-core';
import { CORPUS_PARTS, RULE_1_STRATEGIES, type CorpusStrategy, type StrategyParts } from '../src/strategies.js';
import { loadApp, loadBaseApp, snapshotVariant, STRATEGIES, type Files } from './harness.js';
import { SCENARIOS } from './scenarios.js';

/** Render the single corpus-style build once and take every strategy's parts. */
function singleBuild(files: Files): Record<string, StrategyParts[]> {
  const App = loadApp(files, 'attribute', { marks: true });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(React.createElement(App)));
    const elements = [...container.querySelectorAll(INTERACTIVE_SELECTOR)];
    return Object.fromEntries(
      RULE_1_STRATEGIES.map((strategy) => [
        strategy,
        elements.map((element) => CORPUS_PARTS[strategy](element)),
      ]),
    );
  } finally {
    act(() => root.unmount());
    container.remove();
  }
}

const base = loadBaseApp();

describe('one annotated build, every strategy', () => {
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
        expect(single[strategy]?.map((parts) => parts.fingerprint), strategy).toEqual(perBuild);
      }
    },
  );
});

/** A fingerprint rebuilt from its recorded parts, by each strategy's composition rule. */
function recompose(strategy: CorpusStrategy, parts: StrategyParts): string {
  if (parts.fingerprint.startsWith('id:')) return parts.fingerprint;
  const head =
    strategy === 'role+name' ? [] : strategy === 'selector-path' ? [parts.chain ?? ''] : [parts.chain ?? UNKNOWN_CHAIN];
  return [...head, parts.role, ...(parts.name === undefined ? [] : [`"${parts.name}"`])].join('|');
}

// Rule 4's proposers read the parts, never the string. If the two ever disagreed, a proposer
// would be judged on an identity the fingerprint does not carry.
describe('the recorded parts', () => {
  it.each([{ name: 'base', edit: (files: Files) => new Map(files) }, ...SCENARIOS])(
    '$name: recompose to the fingerprint under every strategy',
    ({ edit }) => {
      const single = singleBuild(edit(base));
      for (const strategy of RULE_1_STRATEGIES) {
        for (const parts of single[strategy] ?? []) expect(recompose(strategy, parts), strategy).toBe(parts.fingerprint);
      }
      // Not vacuous: the chain strategies carry chains on this app.
      expect(single.attribute?.some((parts) => parts.chain !== undefined)).toBe(true);
      expect(single['selector-path']?.every((parts) => parts.fingerprint.startsWith('id:') || parts.chain !== undefined)).toBe(true);
    },
  );
});
