// scripts/identity-spike/scoring/touched.test.ts
import { describe, expect, it } from 'vitest';
import { componentRanges, overlaps, parseHunks, touchAncestry, touchComponent, type PairDiff } from './touched.ts';

const SOURCE = `import { memo, forwardRef } from 'react';

export function Header() {
  return <h1>Title</h1>;
}

const Row = memo(forwardRef((props, ref) => {
  return <tr ref={ref} />;
}));

function helper() {
  return <span />;
}

export default class Table extends Component {
  render() { return <table />; }
}
`;

describe('componentRanges', () => {
  it('finds declarations and wrapped consts by the plugin rule, and skips lowercase helpers', () => {
    const ranges = componentRanges(SOURCE, 'src/Table.tsx');
    expect(Object.fromEntries(ranges)).toEqual({
      Header: [{ start: 3, end: 5 }],
      Row: [{ start: 7, end: 9 }],
      Table: [{ start: 15, end: 17 }],
    });
  });

  it('finds a name twice when two scopes declare it, which makes it undetermined', () => {
    const ranges = componentRanges(`function A() { function B() {} return null; }\nfunction B() {}`, 'a.js');
    expect(ranges.get('B')).toHaveLength(2);
  });

  it('parses a .ts file whose type assertions would break JSX parsing', () => {
    expect(componentRanges(`const x = <string>y;\nexport class Store {}`, 'store.ts').get('Store')).toEqual([
      { start: 2, end: 2 },
    ]);
  });
});

describe('parseHunks and overlaps', () => {
  const diff = `diff --git a/f b/f\n@@ -4 +4 @@\n-a\n+b\n@@ -10,0 +11,2 @@\n+c\n@@ -20,3 +21,0 @@\n-d`;

  it('reads old-side starts and counts, with a missing count meaning one line', () => {
    expect(parseHunks(diff)).toEqual([{ start: 4, count: 1 }, { start: 10, count: 0 }, { start: 20, count: 3 }]);
  });

  it('touches on a changed line inside, an insertion strictly inside, or a deletion that reaches in', () => {
    expect(overlaps({ start: 3, end: 5 }, [{ start: 4, count: 1 }])).toBe(true);
    expect(overlaps({ start: 9, end: 12 }, [{ start: 10, count: 0 }])).toBe(true);
    expect(overlaps({ start: 22, end: 30 }, [{ start: 20, count: 3 }])).toBe(true);
  });

  it('does not touch on a change outside, or an insertion right after the last line', () => {
    expect(overlaps({ start: 3, end: 5 }, [{ start: 6, count: 2 }])).toBe(false);
    expect(overlaps({ start: 3, end: 5 }, [{ start: 5, count: 0 }])).toBe(false);
  });
});

/** A pair whose diff changes only `src/Table.tsx`, at the given hunks. */
function pair(hunks: { start: number; count: number }[], overrides: Partial<PairDiff> = {}): PairDiff {
  return {
    changed: new Set(['demo/src/Table.tsx']),
    deleted: new Set(),
    hunks: () => hunks,
    before: (path) => (path === 'demo/src/Table.tsx' ? SOURCE : null),
    ...overrides,
  };
}

describe('touchComponent', () => {
  const row = { name: 'Row', file: 'src/Table.tsx' };

  it('is component-level: an edit to another component in the same file does not touch', () => {
    expect(touchComponent(row, 'demo', pair([{ start: 4, count: 1 }]))).toBe('untouched');
    expect(touchComponent(row, 'demo', pair([{ start: 8, count: 1 }]))).toBe('touched');
  });

  it('is untouched when the file is not in the diff, touched when it is deleted', () => {
    expect(touchComponent({ name: 'X', file: 'src/Other.tsx' }, 'demo', pair([]))).toBe('untouched');
    expect(touchComponent(row, 'demo', pair([], { deleted: new Set(['demo/src/Table.tsx']) }))).toBe('touched');
  });

  // Never assumed touched: that is the lenient direction the pre-registration rules out.
  it('is undetermined when the component is not found, is found twice, or has no file', () => {
    expect(touchComponent({ name: 'Missing', file: 'src/Table.tsx' }, 'demo', pair([{ start: 1, count: 1 }]))).toBe('undetermined');
    const twice = pair([{ start: 1, count: 1 }], { before: () => 'function Row() {}\nfunction X() { function Row() {} }' });
    expect(touchComponent(row, 'demo', twice)).toBe('undetermined');
    expect(touchComponent({ name: 'Row' }, 'demo', pair([]))).toBe('undetermined');
  });
});

describe('touchAncestry', () => {
  const ancestry = [{ name: 'Table', file: 'src/Table.tsx' }, { name: 'Row', file: 'src/Table.tsx' }];

  it('is touched if any component is, and reports file-level beside it', () => {
    expect(touchAncestry(ancestry, 'demo', pair([{ start: 8, count: 1 }]))).toEqual({ touch: 'touched', fileLevel: true });
  });

  it('separates the two levels: same file changed, no component in the ancestry touched', () => {
    expect(touchAncestry(ancestry, 'demo', pair([{ start: 4, count: 1 }]))).toEqual({ touch: 'untouched', fileLevel: true });
  });

  it('lets undetermined outrank untouched, never touched', () => {
    const withUnknown = [...ancestry, { name: 'Missing', file: 'src/Table.tsx' }];
    expect(touchAncestry(withUnknown, 'demo', pair([{ start: 4, count: 1 }])).touch).toBe('undetermined');
  });

  it('is untouched with no first-party ancestry: only a library rendered it', () => {
    expect(touchAncestry([], 'demo', pair([{ start: 8, count: 1 }]))).toEqual({ touch: 'untouched', fileLevel: false });
  });
});
