// scripts/identity-spike/src/drift-proposers.test.ts
// The rule-4 proposers on hand-built commit pairs whose right answer is known.
import { describe, expect, it } from 'vitest';
import {
  anchor,
  dominates,
  naive,
  proposeAll,
  resolution,
  score,
  type DriftLabel,
  type DriftRecord,
  type Proposal,
} from './drift-proposers.js';

function record(fingerprint: string, parts: Partial<DriftRecord> = {}): DriftRecord {
  return { fingerprint, routes: ['/settings'], role: 'button', ...parts };
}

// IDENTITY-RESOLUTION.md's own example: SettingsForm renamed to ProfileForm, same file.
const renamed = record('old-save', { chain: 'App>SettingsForm', file: 'src/Form.tsx', name: 'Save' });
const continuation = record('new-save', { chain: 'App>ProfileForm', file: 'src/Form.tsx', name: 'Save' });

describe('naive', () => {
  it('proposes the one new fingerprint with the same route and role', () => {
    expect(naive(renamed, [continuation])).toEqual({ candidate: 'new-save' });
  });

  it('ignores candidates with another role or no shared route', () => {
    const link = record('link', { role: 'link' });
    const elsewhere = record('elsewhere', { routes: ['/billing'] });
    expect(naive(renamed, [link, elsewhere])).toEqual({ abstain: 'no-candidate' });
  });

  it('matches on any shared route, not the whole set', () => {
    const subject = record('nav', { routes: ['/a', '/b'] });
    expect(naive(subject, [record('nav2', { routes: ['/b', '/c'] })])).toEqual({ candidate: 'nav2' });
  });

  it('abstains on a tie rather than picking', () => {
    expect(naive(renamed, [continuation, record('other')])).toEqual({ abstain: 'tie' });
  });
});

describe('anchor', () => {
  it('proposes the one new fingerprint with the same file and role, on any route', () => {
    const moved = { ...continuation, routes: ['/profile'] };
    expect(anchor(renamed, [moved])).toEqual({ candidate: 'new-save' });
  });

  it('abstains when the subject has no file to anchor on', () => {
    expect(anchor(record('no-file'), [record('also-no-file')])).toEqual({ abstain: 'no-file' });
  });

  it('ignores a candidate in the same file with another role', () => {
    expect(anchor(renamed, [{ ...continuation, role: 'link' }])).toEqual({ abstain: 'no-candidate' });
  });

  it('does not count two missing files as a match', () => {
    expect(anchor(renamed, [record('no-file')])).toEqual({ abstain: 'no-candidate' });
  });

  it('abstains when the file holds more than one new element of that role', () => {
    // The Actual case: every element's file is View.tsx.
    const view = { file: 'src/View.tsx' };
    expect(anchor(record('a', view), [record('b', view), record('c', view)])).toEqual({ abstain: 'tie' });
  });
});

describe('resolution', () => {
  it('picks the candidate whose shared parts contain every other candidate’s', () => {
    const sameNameOnly = record('decoy', { chain: 'App>Other', file: 'src/Other.tsx', name: 'Save' });
    // continuation shares {file, name}; the decoy {name}. naive ties here.
    expect(resolution(renamed, [continuation, sameNameOnly])).toEqual({ candidate: 'new-save' });
    expect(naive(renamed, [continuation, sameNameOnly])).toEqual({ abstain: 'tie' });
  });

  it('abstains when the leaders share different parts, with no weight to choose by', () => {
    const fileOnly = record('by-file', { chain: 'App>X', file: 'src/Form.tsx', name: 'Submit' });
    const nameOnly = record('by-name', { chain: 'App>Y', file: 'src/Y.tsx', name: 'Save' });
    expect(resolution(renamed, [fileOnly, nameOnly])).toEqual({ abstain: 'tie' });
  });

  it('abstains when two candidates share the same parts', () => {
    const twin = { ...continuation, fingerprint: 'twin' };
    expect(resolution(renamed, [continuation, twin])).toEqual({ abstain: 'tie' });
  });

  it('declines a candidate supported by route and role alone', () => {
    const replacement = record('redesign', { chain: 'App>NewForm', file: 'src/NewForm.tsx', name: 'Continue' });
    expect(resolution(renamed, [replacement])).toEqual({ abstain: 'no-evidence' });
    expect(naive(renamed, [replacement])).toEqual({ candidate: 'redesign' });
  });

  it('does not count shared absences as evidence', () => {
    // The react-admin case: no chain, no file. Only the name can speak.
    const bare = record('bare', { name: 'Export' });
    expect(resolution(bare, [record('bare2', { name: 'Download' })])).toEqual({ abstain: 'no-evidence' });
    expect(resolution(bare, [record('bare3', { name: 'Export', role: 'button' })])).toEqual({ candidate: 'bare3' });
  });

  it('gates on route and role before weighing parts', () => {
    const otherRoute = { ...continuation, routes: ['/billing'] };
    expect(resolution(renamed, [otherRoute])).toEqual({ abstain: 'no-candidate' });
  });
});

describe('proposeAll', () => {
  it('draws subjects from the vanished and candidates from the appeared only', () => {
    const kept = record('kept', { file: 'src/Form.tsx' });
    const proposals = proposeAll([renamed, kept], [continuation, kept], anchor);
    // `kept` persisted, so it is neither a subject nor a candidate that would tie with new-save.
    expect([...proposals]).toEqual([['old-save', { candidate: 'new-save' }]]);
  });

  it('rejects a fingerprint recorded twice, whose routes would be split', () => {
    expect(() => proposeAll([renamed, renamed], [], naive)).toThrow(/recorded twice/);
  });
});

describe('score', () => {
  const labels = new Map<string, DriftLabel>([
    ['a', { kind: 'continued', as: 'a2', evidence: '-<A/> +<A2/>' }],
    ['b', { kind: 'continued', as: 'b2', evidence: '-<B/> +<B2/>' }],
    ['c', { kind: 'removed', evidence: '-<C/>' }],
    ['d', { kind: 'replaced', evidence: '-<D/> +<NewD/>' }],
    ['e', { kind: 'unclear', evidence: 'refactor of Grid' }],
  ]);

  it('counts the labelled continuation as correct and every other proposal as wrong', () => {
    const proposals = new Map<string, Proposal>([
      ['a', { candidate: 'a2' }],
      ['b', { candidate: 'a2' }],
      ['c', { candidate: 'x' }],
      ['d', { abstain: 'tie' }],
      ['e', { candidate: 'e2' }],
    ]);
    expect(score(proposals, labels)).toEqual({ correct: 1, wrong: 2, abstained: 1, unclear: 1, continued: 2 });
  });

  it('refuses an unlabelled subject rather than dropping it', () => {
    expect(() => score(new Map([['z', { abstain: 'tie' }]]), labels)).toThrow(/unlabelled/);
  });
});

describe('dominates', () => {
  const base = { abstained: 0, unclear: 0, continued: 5 };

  it('needs more correct and no more wrong', () => {
    expect(dominates({ ...base, correct: 3, wrong: 1 }, { ...base, correct: 2, wrong: 1 })).toBe(true);
    expect(dominates({ ...base, correct: 3, wrong: 2 }, { ...base, correct: 2, wrong: 1 })).toBe(false);
  });

  it('is never true of equal scores', () => {
    const same = { ...base, correct: 2, wrong: 0 };
    expect(dominates(same, same)).toBe(false);
  });
});
