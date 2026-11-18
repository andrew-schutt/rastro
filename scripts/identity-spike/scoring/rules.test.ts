// scripts/identity-spike/scoring/rules.test.ts
// Rule 3's row judgement and proposals, and rule 4's records, worksheet and verdict.
import { describe, expect, it } from 'vitest';
import type { StateRecord } from '../corpus/flows.ts';
import type { CapturedElement } from '../src/page.ts';
import type { DriftScore } from '../src/drift-proposers.ts';
import type { RecordedSite } from '../src/repeat-oracle.ts';
import { RULE_1_STRATEGIES } from '../src/strategies.ts';
import { driftRecords, ruleFourVerdict, scoreProposers, worksheet } from './drift.ts';
import { beats } from './dominance.ts';
import { judgeRow, propose } from './flow-rule.ts';

function el(print: string, text = print, site: RecordedSite | null = null, x = 0): CapturedElement {
  return {
    visible: true,
    fingerprints: Object.fromEntries(RULE_1_STRATEGIES.map((s) => [s, print])) as CapturedElement['fingerprints'],
    parts: Object.fromEntries(
      RULE_1_STRATEGIES.map((s) => [s, { role: 'button', chain: 'App>Save', file: 'src/Save.tsx', name: text }]),
    ) as CapturedElement['parts'],
    ancestry: [],
    site,
    description: { tag: 'button', role: null, label: null, text, attributes: {}, within: null, box: { x, y: 0, width: 1, height: 1 } },
  };
}
const state = (elements: CapturedElement[]): StateRecord => ({ screen: 's', captured: true, elements });
const row = (item: number): RecordedSite => ({ key: String(item), item, list: 9, slot: '0' });

describe('judgeRow', () => {
  it('is clear when the fingerprint is the element\'s alone', () => {
    expect(judgeRow(state([el('a'), el('b')]), 0, 'attribute', false)).toEqual({ verdict: 'clear' });
  });

  it('is clear when everything sharing it is a repeat of the element itself', () => {
    expect(judgeRow(state([el('r', 'r', row(1)), el('r', 'r', row(2))]), 0, 'attribute', false)).toEqual({ verdict: 'clear' });
  });

  it('collides with a distinct element, off the list or not, and says when the key could not rule', () => {
    expect(judgeRow(state([el('x'), el('y'), el('x')]), 0, 'attribute', false)).toEqual({ verdict: 'collides', with: [2], undecided: true });
  });

  it('reports a void state and an unmatched row, never judging either', () => {
    expect(judgeRow(state([el('a')]), 0, 'attribute', true)).toEqual({ verdict: 'void' });
    expect(judgeRow(state([el('a')]), null, 'attribute', false)).toEqual({ verdict: 'unmatched' });
  });
});

describe('propose', () => {
  it('proposes only an element whose whole description is identical, and only when it is unique', () => {
    const reference = el('p', 'Save', null, 10);
    expect(propose(reference, state([el('q', 'Cancel'), el('q2', 'Save', null, 10)]))).toBe(1);
    expect(propose(reference, state([el('q', 'Save', null, 11)]))).toBeNull();
    expect(propose(reference, state([el('q', 'Save', null, 10), el('q2', 'Save', null, 10)]))).toBeNull();
  });
});

describe('rule 4', () => {
  const screens = (...entries: [string, CapturedElement[]][]) => new Map(entries.map(([n, e]) => [n, state(e)]));

  it('builds one record per fingerprint, with every route it was seen on', () => {
    const records = driftRecords(screens(['/a', [el('nav'), el('x')]], ['/b', [el('nav')]]));
    expect(records.find((r) => r.fingerprint === 'nav')).toMatchObject({ routes: ['/a', '/b'], role: 'button', chain: 'App>Save', file: 'src/Save.tsx' });
  });

  it('gives the labeller the vanished and the appeared, and nothing a proposer said', () => {
    const sheet = worksheet(screens(['/a', [el('old'), el('kept')]]), screens(['/a', [el('new'), el('kept')]]));
    expect(sheet.subjects.map((s) => s.fingerprint)).toEqual(['old']);
    expect(sheet.appeared.map((s) => s.fingerprint)).toEqual(['new']);
    expect(JSON.stringify(sheet)).not.toMatch(/candidate|abstain|propos/);
  });

  it('refuses to run any proposer while a subject is unlabelled', () => {
    const before = driftRecords(screens(['/a', [el('old')]]));
    const after = driftRecords(screens(['/a', [el('new')]]));
    expect(() => scoreProposers(before, after, new Map())).toThrow(/unlabelled/);
    const scores = scoreProposers(before, after, new Map([['old', { kind: 'continued', as: 'new', evidence: '-a +b' }]]));
    expect(scores.naive.continued).toBe(1);
  });

  const s = (correct: number, wrong: number, continued = 5): DriftScore => ({ correct, wrong, abstained: 0, unclear: 0, continued });

  it('follows the plan\'s branches for the verdict', () => {
    expect(ruleFourVerdict({ naive: s(1, 1), anchor: s(2, 1), resolution: s(3, 1) })).toMatch(/^Resolution dominates both/);
    expect(ruleFourVerdict({ naive: s(1, 1), anchor: s(3, 0), resolution: s(3, 1) })).toMatch(/^Anchor matches or beats it/);
    expect(ruleFourVerdict({ naive: s(3, 1), anchor: s(1, 1), resolution: s(3, 1) })).toMatch(/^Naive matches or beats it/);
    expect(ruleFourVerdict({ naive: s(3, 1), anchor: s(4, 0), resolution: s(3, 1) })).toMatch(/Anchor dominates naive/);
    expect(ruleFourVerdict({ naive: s(4, 3), anchor: s(1, 1), resolution: s(3, 1) })).toMatch(/^Neither dominates nor loses/);
    expect(ruleFourVerdict({ naive: s(0, 0, 0), anchor: s(0, 0, 0), resolution: s(0, 0, 0) })).toMatch(/unanswered/);
  });
});

describe('beats', () => {
  const t = (atLeast: number, atMost: number, untouchedChurn: number, falseSplits: number) => ({
    merges: { atLeast, atMost },
    untouchedChurn,
    falseSplits,
  });

  it('is domination: no worse on every count, better on one', () => {
    expect(beats(t(1, 2, 0, 3), t(1, 2, 0, 4))).toBe('beats');
    expect(beats(t(1, 2, 0, 3), t(1, 2, 0, 3))).toBe('does not beat');
    expect(beats(t(0, 0, 1, 0), t(5, 5, 0, 5))).toBe('does not beat');
  });

  it('is undecided when the merge bounds disagree, never settled on the favourable one', () => {
    expect(beats(t(1, 9, 0, 3), t(2, 5, 0, 3))).toBe('undecided');
  });
});
