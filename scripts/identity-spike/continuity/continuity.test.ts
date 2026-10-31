/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/continuity/continuity.test.ts
 * The continuity smoke test: every scenario in scenarios.ts, under every strategy, against the
 * base app. Two layers of check, which fail for different reasons:
 *
 * 1. **Expectations.** Exactly the elements a scenario names change fingerprint, and no
 *    others. A failure means the tooling or the identity rules do not behave as written.
 * 2. **Snapshots** in __snapshots__/, committed. Every fingerprint, before and after, and the
 *    diff between them. A failure means some fingerprint changed in a way (1) does not cover,
 *    such as a format change, and a reviewer has to see it. Update deliberately with
 *    `pnpm --filter identity-spike test -u`, and say why in the PR.
 */
import { describe, expect, it } from 'vitest';
import { diffSnapshots, type SnapshotEntry } from '../src/continuity.js';
import { loadBaseApp, STRATEGIES, snapshotVariant, type Strategy } from './harness.js';
import { SCENARIOS } from './scenarios.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base = loadBaseApp();
const ELEMENTS = ['cancel', 'email', 'nav-help', 'nav-home', 'page-docs', 'pref-dark', 'save'];

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** One fingerprint per element, or a failure: a duplicated or missing id would make (1) vacuous. */
function byElement(entries: SnapshotEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const { element, fingerprint } of entries) {
    if (element === null) throw new Error(`an interactive element has no data-el: ${fingerprint}`);
    if (map.has(element)) throw new Error(`data-el="${element}" appears twice`);
    map.set(element, fingerprint);
  }
  expect([...map.keys()].sort()).toEqual(ELEMENTS);
  return map;
}

const baseline = new Map<Strategy, SnapshotEntry[]>(STRATEGIES.map((s) => [s, snapshotVariant(base, s)]));

describe('the base app', () => {
  it('matches its committed snapshot under every strategy', async () => {
    await expect(json(Object.fromEntries(baseline))).toMatchFileSnapshot('./__snapshots__/base.json');
  });

  it('gives every element a distinct fingerprint under every strategy', () => {
    for (const strategy of STRATEGIES) {
      const fingerprints = [...byElement(baseline.get(strategy) ?? []).values()];
      expect(new Set(fingerprints).size, strategy).toBe(fingerprints.length);
    }
  });
});

describe.each(SCENARIOS)('$name', (scenario) => {
  const variant = scenario.edit(base);
  const results = STRATEGIES.map((strategy) => {
    const before = byElement(baseline.get(strategy) ?? []);
    const afterEntries = snapshotVariant(variant, strategy);
    const after = byElement(afterEntries);
    const changed = ELEMENTS.filter((element) => before.get(element) !== after.get(element));
    const diff = diffSnapshots([...before.values()], [...after.values()]);
    return { strategy, changed, after: afterEntries, diff };
  });

  it.each(results)('changes exactly the expected elements under $strategy', ({ strategy, changed }) => {
    expect(changed).toEqual([...scenario.changes[strategy]].sort());
  });

  // The diff sees fingerprints only, as on the corpus. Here it must agree with the oracle: no
  // change means an empty diff, and every changed element's old fingerprint has vanished.
  it.each(results)('reports the same change by fingerprint alone under $strategy', ({ strategy, changed, diff }) => {
    const before = byElement(baseline.get(strategy) ?? []);
    if (changed.length === 0) {
      expect(diff.vanished).toEqual([]);
      expect(diff.appeared).toEqual([]);
    } else {
      expect(diff.vanished).toEqual(changed.map((element) => before.get(element)).sort());
      expect(diff.appeared).toHaveLength(changed.length);
    }
    expect(diff.countChanged).toEqual([]);
  });

  it('matches its committed snapshot', async () => {
    const artifact = {
      scenario: scenario.name,
      description: scenario.description,
      strategies: Object.fromEntries(
        results.map(({ strategy, changed, after, diff }) => [strategy, { changed, diff, after }]),
      ),
    };
    await expect(json(artifact)).toMatchFileSnapshot(`./__snapshots__/${scenario.name}.json`);
  });
});
