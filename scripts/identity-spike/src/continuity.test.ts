// scripts/identity-spike/src/continuity.test.ts
// The pure half: diffing two snapshots by fingerprint alone.
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from './continuity.js';

describe('diffSnapshots', () => {
  it('reports nothing for identical snapshots', () => {
    const diff = diffSnapshots(['a', 'b'], ['b', 'a']);
    expect(diff).toEqual({ kept: ['a', 'b'], vanished: [], appeared: [], countChanged: [] });
  });

  it('reports a continued element as one vanished and one appeared', () => {
    const diff = diffSnapshots(['App>Save|button|"Save"'], ['App>Save|button|"Save changes"']);
    expect(diff.vanished).toEqual(['App>Save|button|"Save"']);
    expect(diff.appeared).toEqual(['App>Save|button|"Save changes"']);
    expect(diff.kept).toEqual([]);
  });

  // Two distinct elements starting to share a fingerprint change no set membership. The count
  // is the only trace of a new merge, so dropping it would hide the silent failure.
  it('reports a new merge as a count change, not as churn', () => {
    const diff = diffSnapshots(['x', 'y'], ['x', 'x']);
    expect(diff.vanished).toEqual(['y']);
    expect(diff.appeared).toEqual([]);
    expect(diff.countChanged).toEqual([{ fingerprint: 'x', before: 1, after: 2 }]);
  });

  it('is deterministic regardless of input order', () => {
    expect(diffSnapshots(['c', 'a', 'b'], ['b', 'd'])).toEqual(diffSnapshots(['b', 'a', 'c'], ['d', 'b']));
  });
});
