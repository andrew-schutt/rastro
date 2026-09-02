/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/src/repeat-oracle.test.tsx
 * The collision referee, against real React renders — the only place real fibers with real
 * keys exist. A hand-built DOM cannot test this at all, which is the whole reason this is a
 * workspace package with a renderer rather than a loose script.
 */
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyPair, groupByRepeat, repeatSiteOf } from './repeat-oracle.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: ReactElement): (selector: string) => Element[] {
  act(() => root.render(ui));
  return (selector: string) => [...container.querySelectorAll(selector)];
}

const ROWS = [
  { id: 'a1', name: 'Ada' },
  { id: 'b2', name: 'Grace' },
  { id: 'c3', name: 'Katherine' },
];

function Row({ name }: { name: string }): ReactElement {
  return (
    <tr>
      <td>{name}</td>
      <td>
        <button type="button">Edit</button>
      </td>
    </tr>
  );
}

function Table(): ReactElement {
  return (
    <table>
      <tbody>
        {ROWS.map((r) => (
          <Row key={r.id} name={r.name} />
        ))}
      </tbody>
    </table>
  );
}

describe('repeatSiteOf', () => {
  it('finds the enclosing keyed list item', () => {
    const q = render(<Table />);
    const site = repeatSiteOf(q('button')[0] as Element);
    expect(site).not.toBeNull();
    expect(site?.key).toBe('a1');
  });

  it('is null for an element outside any keyed list', () => {
    const q = render(
      <div>
        <button type="button">Save</button>
      </div>,
    );
    expect(repeatSiteOf(q('button')[0] as Element)).toBeNull();
  });

  // Nearest, not outermost: an outer list would call a row's Edit and Delete repeats.
  it('takes the NEAREST keyed ancestor when lists nest', () => {
    const q = render(
      <ul>
        {['outer1', 'outer2'].map((o) => (
          <li key={o}>
            <ul>
              {['inner1', 'inner2'].map((i) => (
                <li key={`${o}-${i}`}>
                  <button type="button">Go</button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>,
    );
    expect(repeatSiteOf(q('button')[0] as Element)?.key).toBe('outer1-inner1');
  });
});

describe('classifyPair', () => {
  // THE case the referee exists for: 50 rows, one button, one identity — a right merge.
  it('calls two rows of one list repeated siblings', () => {
    const q = render(<Table />);
    const buttons = q('button');
    expect(classifyPair(buttons[0] as Element, buttons[1] as Element)).toEqual({
      verdict: 'repeated-siblings',
      reason: 'same-list-different-items',
    });
  });

  // The mirror case: a row's two controls collide because the fingerprint cannot separate
  // them. That is a real false merge, and the referee must not excuse it as "a list".
  it('calls two controls inside ONE row distinct', () => {
    const q = render(
      <ul>
        {ROWS.map((r) => (
          <li key={r.id}>
            <button type="button">Act</button>
            <button type="button">Act</button>
          </li>
        ))}
      </ul>,
    );
    const buttons = q('li:first-child button');
    expect(classifyPair(buttons[0] as Element, buttons[1] as Element)).toEqual({
      verdict: 'distinct',
      reason: 'same-list-item',
    });
  });

  it('calls rows of two SEPARATE lists distinct', () => {
    const q = render(
      <div>
        <div id="admins">
          <Table />
        </div>
        <div id="members">
          <Table />
        </div>
      </div>,
    );
    const admin = q('#admins button')[0] as Element;
    const member = q('#members button')[0] as Element;
    expect(classifyPair(admin, member)).toEqual({
      verdict: 'distinct',
      reason: 'different-lists',
    });
  });

  // React renders an unkeyed array happily — it only warns — so "no key" does not prove
  // "no loop". Answering `distinct` here would inflate the very number the spike measures.
  it('refuses to rule when neither element sits in a keyed list', () => {
    const q = render(
      <div>
        <button type="button">Save</button>
        <button type="button">Save</button>
      </div>,
    );
    const buttons = q('button');
    expect(classifyPair(buttons[0] as Element, buttons[1] as Element)).toEqual({
      verdict: 'undecided',
      reason: 'no-keyed-ancestor',
    });
  });

  it('refuses to rule when only one side is keyed', () => {
    const q = render(
      <div>
        <button type="button">Edit</button>
        <Table />
      </div>,
    );
    const [loose, inList] = [q('button')[0] as Element, q('table button')[0] as Element];
    expect(classifyPair(loose, inList)).toEqual({
      verdict: 'undecided',
      reason: 'one-side-unkeyed',
    });
  });

  // Index keys are bad identity — insert a row and every key renumbers — and irrelevant here,
  // because the referee never compares a key across renders. Worth pinning: index keys are
  // common enough that a referee that choked on them would be useless on real apps.
  it('works on index keys, which are useless for identity but fine as a referee signal', () => {
    const q = render(
      <ul>
        {ROWS.map((r, i) => (
          <li key={i}>
            <button type="button">{r.name}</button>
          </li>
        ))}
      </ul>,
    );
    const buttons = q('button');
    expect(classifyPair(buttons[0] as Element, buttons[1] as Element).verdict).toBe(
      'repeated-siblings',
    );
  });
});

describe('groupByRepeat', () => {
  it('collapses one list into a single logical element', () => {
    const q = render(<Table />);
    const { groups, undecidedPairs } = groupByRepeat(q('button'));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
    expect(undecidedPairs).toBe(0);
  });

  // Six colliding buttons, two logical elements. A raw collision count would report this as
  // five collisions; the honest answer is one false merge between two groups.
  it('reports two groups when two separate tables share a fingerprint', () => {
    const q = render(
      <div>
        <div id="admins">
          <Table />
        </div>
        <div id="members">
          <Table />
        </div>
      </div>,
    );
    const { groups } = groupByRepeat(q('button'));
    expect(q('button')).toHaveLength(6);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length).sort()).toEqual([3, 3]);
  });

  // Undecided must not merge. Merging on a signal that said nothing would suppress false
  // merges, which is precisely the failure the spike is trying to make visible.
  it('counts undecided pairs instead of merging them away', () => {
    const q = render(
      <div>
        <button type="button">Save</button>
        <button type="button">Save</button>
      </div>,
    );
    const { groups, undecidedPairs } = groupByRepeat(q('button'));
    expect(groups).toHaveLength(2);
    expect(undecidedPairs).toBe(1);
  });

  // THE regression. `classifyPair` gets this right pairwise, but the relation it returns is
  // not transitive: row 1's left button and row 2's RIGHT button are two items of one list,
  // so any union-find drags all six into one group and reports a clean bill of health. The
  // honest answer is two logical elements — one false merge — and it must survive being
  // checked through `groupByRepeat`, not only through `classifyPair`.
  it('keeps two controls per row apart despite the repeats between the rows', () => {
    const q = render(
      <ul>
        {ROWS.map((r) => (
          <li key={r.id}>
            <button type="button">Act</button>
            <button type="button">Act</button>
          </li>
        ))}
      </ul>,
    );
    const { groups, undecidedPairs, slotSeparatedPairs } = groupByRepeat(q('button'));
    expect(q('button')).toHaveLength(6);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.length)).toEqual([3, 3]);
    expect(undecidedPairs).toBe(0);
    // Three row pairs × the two cross-column pairs each: the ordinary shape of a two-control
    // list, and the reason this count is reported rather than alarmed on.
    expect(slotSeparatedPairs).toBe(6);
    // Each group is one column, never a mix: grouping by position is what guarantees it.
    for (const group of groups) {
      const parents = new Set(group.map((el) => el.parentElement));
      expect(parents.size).toBe(group.length);
    }
  });

  // A row that renders only one of the pair. Counting a row's colliding elements could not
  // tell which of the two a lone button was; the JSX slot can, because the branch that
  // rendered nothing still holds its index. The lone button belongs to the FIRST column.
  it('aligns a row missing a control by its JSX slot, not by counting the row', () => {
    const q = render(
      <ul>
        {ROWS.map((r, i) => (
          <li key={r.id}>
            <button type="button">Act</button>
            {i < 2 ? <button type="button">Act</button> : null}
          </li>
        ))}
      </ul>,
    );
    const { groups, undecidedPairs, slotSeparatedPairs } = groupByRepeat(q('button'));
    expect(q('button')).toHaveLength(5);
    expect(groups.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(undecidedPairs).toBe(0);
    // The two cross-column pairs between the full rows, plus the lone button against the
    // second-column button of each full row.
    expect(slotSeparatedPairs).toBe(4);
  });

  // The mirror, and the reason the slot is read from the fiber rather than from the DOM: the
  // trailing control is the one that goes missing, so every row's LEADING button sits at DOM
  // index 0 and only the reconciler's hole says which column the lone one belongs to.
  it('aligns a row missing its LAST control, where DOM position cannot tell', () => {
    const q = render(
      <ul>
        {ROWS.map((r, i) => (
          <li key={r.id}>
            {i < 2 ? <button type="button">Act</button> : null}
            <button type="button">Act</button>
          </li>
        ))}
      </ul>,
    );
    const { groups, slotSeparatedPairs } = groupByRepeat(q('button'));
    expect(q('button')).toHaveLength(5);
    // Three in the second column — including row 3's, which is the only button it rendered.
    expect(groups.map((g) => g.length).sort()).toEqual([2, 3]);
    // Mirrors the previous case: two cross pairs between the full rows, and the lone button
    // against the FIRST-column button of each.
    expect(slotSeparatedPairs).toBe(4);
  });

  // THE second regression. Two rows holding the SAME NUMBER of colliding elements, drawn from
  // different JSX sites: `[X, Act]` against `[Act, Y]`. Aligning on a count merges X with Act
  // and Act with Y — three logical elements reported as two, with every escape counter silent,
  // which is the under-reporting direction the module exists to avoid. The slots are 0, 1, 2,
  // so only the middle pair merges.
  it('keeps equal-sized rows apart when a conditional shifts which controls they hold', () => {
    const q = render(
      <ul>
        {[0, 1].map((i) => (
          <li key={i}>
            {i === 0 ? <button type="button">Act</button> : null}
            <button type="button">Act</button>
            {i === 1 ? <button type="button">Act</button> : null}
          </li>
        ))}
      </ul>,
    );
    const { groups, distinctElements, slotSeparatedPairs } = groupByRepeat(q('button'));
    expect(q('button')).toHaveLength(4);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 2]);
    expect(distinctElements.atLeast).toBe(3);
    // X against Act and Y, Act against Y: key-repeats the slots held apart.
    expect(slotSeparatedPairs).toBe(3);
  });

  // A key is not a loop. React stamps one on hand-written static siblings too, and nothing
  // here can tell those from two rows of a `.map()` — so the merge happens, and the RANGE is
  // what keeps it honest. Reporting `atLeast` alone would call this a clean right merge.
  it('reports a range, because a key does not prove a loop', () => {
    const q = render(
      <div>
        <section key="left">
          <button type="button">Go</button>
        </section>
        <section key="right">
          <button type="button">Go</button>
        </section>
      </div>,
    );
    const { groups, distinctElements } = groupByRepeat(q('button'));
    expect(groups).toHaveLength(1);
    expect(distinctElements).toEqual({ atLeast: 1, atMost: 2 });
  });

  // The range's other end: three rows of one genuine loop are one logical element, and the
  // width says the whole collapse rests on the key.
  it('widens the range by exactly what the key merged', () => {
    const q = render(<Table />);
    expect(groupByRepeat(q('button')).distinctElements).toEqual({ atLeast: 1, atMost: 3 });
  });
});
