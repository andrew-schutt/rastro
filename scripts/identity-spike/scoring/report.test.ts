// scripts/identity-spike/scoring/report.test.ts
// The whole report on a synthetic two-commit corpus, where every number is known in advance.
// It runs before the report ever reads a real capture, so a bug surfaces here, not after a
// number exists.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StateRecord } from '../corpus/flows.ts';
import type { CorpusApp } from '../corpus/manifest.ts';
import type { CapturedElement } from '../src/page.ts';
import type { RecordedSite } from '../src/repeat-oracle.ts';
import { RULE_1_STRATEGIES } from '../src/strategies.ts';
import type { Capture } from './captures.ts';
import { markdown, scoreApp, type Sources } from './report.ts';
import type { PairDiff } from './touched.ts';

function el(print: string, name: string, file: string, site: RecordedSite | null = null): CapturedElement {
  const fingerprints = Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, print])) as CapturedElement['fingerprints'];
  fingerprints['role+name'] = name;
  return {
    visible: true,
    fingerprints,
    parts: Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, { role: 'button', chain: 'App', file, name }])) as CapturedElement['parts'],
    ancestry: [{ name: 'App', file }],
    site,
    description: { tag: 'button', role: null, label: null, text: name, attributes: {}, within: null, box: { x: 0, y: 0, width: 1, height: 1 } },
  };
}
const row = (item: number): RecordedSite => ({ key: String(item), item, list: 7, slot: '0' });

/** At commit 1: Save, two rows of Edit (a right merge), two unkeyed Dup (an undecided false merge). */
const one = (save: string): StateRecord[] => [
  {
    screen: '/a',
    captured: true,
    elements: [el(save, 'Save', 'src/Save.tsx'), el('edit', 'Edit', 'src/Rows.tsx', row(1)), el('edit', 'Edit', 'src/Rows.tsx', row(2)), el('dup', 'Dup', 'src/Dup.tsx'), el('dup', 'Dup', 'src/Dup.tsx')],
  },
];

const APP: CorpusApp = {
  id: 'actual',
  repository: '',
  pin: 'b'.repeat(40),
  commits: [
    { index: 1, sha: 'a'.repeat(40), date: '2026-10-01' },
    { index: 2, sha: 'b'.repeat(40), date: '2026-10-02' },
  ],
  buildDirectory: '.',
  build: { env: {}, command: [] },
  outputDirectory: '',
  viteConfig: '',
  pluginRoot: 'demo',
  screens: ['/a'],
  flow: { name: 'test', rows: [{ id: 'X1', state: 'st', element: 'button: "Save"' }] },
};

function capture(index: 1 | 2, variant: 'as-shipped', frozen = 'f', passed = true): Capture {
  // Between the commits, Save's fingerprint changes under every strategy but role+name, and the
  // diff touches nothing Save is rendered by: one untouched churn instance, one false split.
  const screens = one(index === 1 ? 'save' : 'save-2');
  return {
    app: 'actual',
    commit: APP.commits[index - 1]!,
    variant,
    load: { entered: true, screens, flow: { states: [{ ...screens[0]!, screen: 'st' }], firsts: {} } },
    control: { passed, flow: { voidStates: [] } },
    frozen,
  };
}

const UNTOUCHED: PairDiff = { changed: new Set(['demo/src/Other.tsx']), deleted: new Set(), hunks: () => [], before: () => null };

let inputs: string;
afterEach(() => rmSync(inputs, { recursive: true, force: true }));

function sources(overrides: Partial<Sources> = {}): Sources {
  inputs = mkdtempSync(join(tmpdir(), 'rastro-scoring-'));
  return { capture: (_app, commit, variant) => capture(commit.index as 1 | 2, variant), diff: () => UNTOUCHED, inputs, ...overrides };
}

describe('scoreApp', () => {
  it('computes rules 1 and 2 exactly, and leaves 3 and 4 pending without their human inputs', () => {
    const result = scoreApp(APP, sources(), 'f');
    const attribute = result.strategies.attribute;

    // Per commit: Dup is one undecided false merge (1–1), Edit adds only to the upper bound (0–1).
    expect(attribute.totals).toEqual({ merges: { atLeast: 2, atMost: 4 }, untouchedChurn: 1, falseSplits: 1 });
    expect(attribute.undecidedPairs).toBe(2);
    expect(attribute.instances).toMatchObject([{ fingerprint: 'save', touch: 'untouched', pair: '1-2' }]);
    // Role + name never moved, so it neither churned nor split.
    expect(result.strategies['role+name'].totals).toMatchObject({ untouchedChurn: 0, falseSplits: 0 });
    expect(result.comparisons['role+name']!.attribute).toBe('beats');
    expect([result.ruleThree, result.ruleFour]).toEqual([null, null]);
    expect(markdown([result], 'f')).toContain('Rule 3:** pending');
  });

  it('calls the churn touched when the diff changes the component Save is rendered by', () => {
    const touched: PairDiff = {
      changed: new Set(['demo/src/Save.tsx']),
      deleted: new Set(),
      hunks: () => [{ start: 1, count: 1 }],
      before: () => 'export function App() {\n  return null;\n}\n',
    };
    expect(scoreApp(APP, sources({ diff: () => touched }), 'f').strategies.attribute.totals.untouchedChurn).toBe(0);
  });

  it('judges rule 3 from the matches and rule 4 from the labels once they exist', () => {
    const s = sources();
    mkdirSync(join(inputs, 'matches'));
    mkdirSync(join(inputs, 'labels'));
    const match = (element: number) => ({ X1: { state: 'st', element, by: 'hand', matcher: 'test' } });
    writeFileSync(join(inputs, 'matches', 'actual.json'), JSON.stringify({ 1: match(0), 2: match(3) }));
    writeFileSync(join(inputs, 'labels', 'actual.json'), JSON.stringify({ '1-2': { save: { kind: 'continued', as: 'save-2', evidence: 'test' } } }));
    const result = scoreApp(APP, s, 'f');

    // Save is clear at commit 1; the row matched to Dup at commit 2 collides, undecided.
    expect(result.ruleThree?.attribute).toMatchObject({ collisions: 1, undecidedCollisions: 1, unmatched: 0, void: 0 });
    expect(result.ruleFour?.scores.resolution.continued).toBe(1);
  });

  it('voids a commit whose rebuild control failed, and every pair it is in', () => {
    const failed = sources({ capture: (_app, commit, variant) => capture(commit.index as 1 | 2, variant, 'f', commit.index !== 2) });
    const result = scoreApp(APP, failed, 'f');
    expect(result.voidCommits).toEqual([2]);
    // Commit 1 alone: its merges are counted, and there is no pair left to churn or split.
    expect(result.strategies.attribute.totals).toEqual({ merges: { atLeast: 1, atMost: 2 }, untouchedChurn: 0, falseSplits: 0 });
    expect(markdown([result], 'f')).toContain('**Void commits**');
  });

  it('refuses a capture from any runner but the frozen one', () => {
    const stale = sources({ capture: (_app, commit, variant) => capture(commit.index as 1 | 2, variant, 'other') });
    expect(() => scoreApp(APP, stale, 'f')).toThrow(/not the frozen runner/);
  });
});
