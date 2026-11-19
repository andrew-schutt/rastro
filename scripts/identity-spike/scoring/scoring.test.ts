// scripts/identity-spike/scoring/scoring.test.ts
// Collisions, churn and false splits on synthetic captures, where the right answer is known.
import { describe, expect, it } from 'vitest';
import type { StateRecord } from '../corpus/flows.ts';
import type { CapturedElement } from '../src/page.ts';
import type { RecordedSite } from '../src/repeat-oracle.ts';
import { RULE_1_STRATEGIES, type CorpusStrategy } from '../src/strategies.ts';
import { isVoid, type Capture } from './captures.ts';
import { churn, falseSplits } from './churn.ts';
import { collisions, mergeCount, visibleOnly } from './collisions.ts';
import type { Touch } from './touched.ts';

/** An element whose fingerprint is `print` under every strategy except where overridden. */
function el(
  print: string,
  options: { site?: RecordedSite | null; visible?: boolean; name?: string; file?: string; strategies?: Partial<Record<CorpusStrategy, string>> } = {},
): CapturedElement {
  const fingerprints = Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, print])) as CapturedElement['fingerprints'];
  fingerprints['role+name'] = options.name ?? print;
  Object.assign(fingerprints, options.strategies);
  return {
    visible: options.visible ?? true,
    fingerprints,
    parts: Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, { role: 'button' }])) as CapturedElement['parts'],
    ancestry: options.file === undefined ? [] : [{ name: 'C', file: options.file }],
    site: options.site ?? null,
    description: { tag: 'button', role: null, label: null, text: print, attributes: {}, within: null, box: { x: 0, y: 0, width: 1, height: 1 } },
  };
}

const row = (item: number, slot = '0'): RecordedSite => ({ key: String(item), item, list: 100, slot });
const doc = (screen: string, elements: CapturedElement[]): StateRecord => ({ screen, captured: true, elements });
const docs = (...records: StateRecord[]) => new Map(records.map((r) => [r.screen, r]));

describe('collisions and mergeCount', () => {
  it('calls three rows of one list a right merge: one distinct thing, no false merge', () => {
    const found = collisions([el('Edit', { site: row(1) }), el('Edit', { site: row(2) }), el('Edit', { site: row(3) })], 'attribute');
    expect(found).toHaveLength(1);
    expect(mergeCount(found)).toEqual({ atLeast: 0, atMost: 2, undecidedPairs: 0, falselyMerged: 0 });
  });

  it('counts two controls in one row as a false merge on the lower bound', () => {
    const found = collisions([el('Act', { site: row(1, '0') }), el('Act', { site: row(1, '1') })], 'attribute');
    expect(mergeCount(found)).toEqual({ atLeast: 1, atMost: 1, undecidedPairs: 0, falselyMerged: 1 });
  });

  it('keeps unkeyed pairs undecided: the range is the honest answer', () => {
    const found = collisions([el('Save'), el('Save')], 'attribute');
    expect(mergeCount(found)).toEqual({ atLeast: 1, atMost: 1, undecidedPairs: 1, falselyMerged: 1 });
  });

  it('judges each strategy by its own fingerprints', () => {
    const elements = [el('A', { strategies: { 'role+name': 'same' } }), el('B', { strategies: { 'role+name': 'same' } })];
    expect(collisions(elements, 'attribute')).toEqual([]);
    expect(collisions(elements, 'role+name')).toHaveLength(1);
  });

  it('reports visible-only beside, by filtering before counting', () => {
    expect(collisions(visibleOnly([el('X'), el('X', { visible: false })]), 'attribute')).toEqual([]);
  });
});

const touchBy = (files: Record<string, Touch>) => (element: CapturedElement) => {
  const file = element.ancestry[0]?.file;
  return { touch: file === undefined ? ('untouched' as Touch) : (files[file] ?? 'untouched'), fileLevel: file !== undefined && file in files };
};

describe('churn', () => {
  it('finds a vanished fingerprint and classifies it by its ancestry', () => {
    const before = docs(doc('/a', [el('keep', { file: 'k.tsx' }), el('old', { file: 'x.tsx' })]));
    const after = docs(doc('/a', [el('keep', { file: 'k.tsx' }), el('new', { file: 'x.tsx' })]));
    const result = churn(before, after, 'attribute', touchBy({ 'x.tsx': 'touched' }));
    expect(result.vanished).toMatchObject([{ screen: '/a', fingerprint: 'old', touch: 'touched', fileLevel: true }]);
    expect(result.appeared).toBe(1);
  });

  // The strict direction: one untouched element that changed is untouched churn.
  it('calls a fingerprint untouched if any element wearing it was untouched', () => {
    const before = docs(doc('/a', [el('shared', { file: 'x.tsx' }), el('shared', { file: 'y.tsx' })]));
    const after = docs(doc('/a', [el('n1', { file: 'x.tsx' }), el('n2', { file: 'y.tsx' })]));
    expect(churn(before, after, 'attribute', touchBy({ 'x.tsx': 'touched' })).vanished[0]?.touch).toBe('untouched');
  });

  it('lets undetermined outrank touched but not untouched', () => {
    const before = docs(doc('/a', [el('s', { file: 'x.tsx' }), el('s', { file: 'u.tsx' })]));
    const after = docs(doc('/a', []));
    expect(churn(before, after, 'attribute', touchBy({ 'x.tsx': 'touched', 'u.tsx': 'undetermined' })).vanished[0]?.touch).toBe('undetermined');
  });

  it('flags a role or name change as a hint for the excuse, and never grants it', () => {
    const before = docs(doc('/a', [el('p1', { name: 'button|"Save"' })]));
    const after = docs(doc('/a', [el('p2', { name: 'button|"Save changes"' })]));
    const [instance] = churn(before, after, 'attribute', touchBy({})).vanished;
    expect(instance).toMatchObject({ roleOrNameChanged: true, touch: 'untouched' });
  });

  it('reports a screen captured at only one commit as absent, never comparing it', () => {
    const result = churn(docs(doc('/a', [el('x')]), doc('/b', [el('y')])), docs(doc('/a', [el('x')])), 'attribute', touchBy({}));
    expect(result).toEqual({ vanished: [], appeared: 0, absent: ['/b'] });
  });
});

describe('falseSplits', () => {
  it('matches by screen, role and name, and counts a changed fingerprint as a split', () => {
    const before = docs(doc('/a', [el('p1', { name: 'save' }), el('q', { name: 'cancel' })]));
    const after = docs(doc('/a', [el('p2', { name: 'save' }), el('q', { name: 'cancel' })]));
    expect(falseSplits(before, after, 'attribute')).toEqual({ matched: 2, split: 1, skipped: 0 });
  });

  it('skips a key that is not unique on its screen at either commit', () => {
    const before = docs(doc('/a', [el('p1', { name: 'edit' }), el('p2', { name: 'edit' })]));
    const after = docs(doc('/a', [el('p3', { name: 'edit' })]));
    expect(falseSplits(before, after, 'attribute')).toEqual({ matched: 0, split: 0, skipped: 2 });
  });
});

describe('isVoid', () => {
  const capture = (passed: boolean, voidStates: string[] = []) =>
    ({ control: { passed, flow: { voidStates } } }) as unknown as Capture;

  it('voids a commit whose control failed on either build', () => {
    expect(isVoid([capture(true), capture(false)])).toBe(true);
    expect(isVoid([capture(true), capture(true)])).toBe(false);
  });

  it('leaves a commit standing when a build is missing or a traced state is void', () => {
    expect(isVoid([capture(true), null])).toBe(false);
    expect(isVoid([capture(true, ['after Add']), capture(true)])).toBe(false);
  });
});
