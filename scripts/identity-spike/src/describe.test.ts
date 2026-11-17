// scripts/identity-spike/src/describe.test.ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DESCRIPTION_TEXT_LIMIT, describeForMatching } from './describe.ts';

function render(html: string): Element {
  document.body.innerHTML = html;
  const target = document.querySelector('[data-target]');
  if (target === null) throw new Error('no [data-target] in the fixture');
  return target;
}

describe('describeForMatching', () => {
  it('records the tag, the role as written, the text and the attributes present', () => {
    const description = describeForMatching(
      render('<a data-target href="/accounts/1" data-testid="account" role="menuitem">  Bank of\n America <b>9,440.93</b></a>'),
    );

    expect(description).toMatchObject({
      tag: 'a',
      role: 'menuitem',
      label: null,
      text: 'Bank of America 9,440.93',
      attributes: { href: '/accounts/1', testId: 'account' },
    });
  });

  it('computes no implicit role, so a plain button has none', () => {
    expect(describeForMatching(render('<button data-target>Save</button>')).role).toBeNull();
  });

  // The case it exists for: an input strategy 1 can name nothing, which the description must
  // still place. Actual's new-transaction Date field is one.
  it('places an unlabelled input by the ancestor that names itself, and never reads its value', () => {
    const description = describeForMatching(
      render('<div data-testid="new-transaction"><div data-testid="date"><input data-target value="10/30/2026"></div></div>'),
    );

    expect(description.label).toBeNull();
    expect(description.within).toEqual({ testId: 'date' });
    expect(JSON.stringify(description)).not.toContain('10/30/2026');
  });

  it('takes the first author label present, joining every id aria-labelledby names', () => {
    render('<label id="a">Order</label><label id="b">Status</label><div data-target role="combobox" aria-labelledby="a b" title="ignored">ordered</div>');
    expect(describeForMatching(document.querySelector('[data-target]')!).label).toBe('Order Status');
    expect(describeForMatching(render('<input data-target placeholder="Search">')).label).toBe('Search');
    expect(describeForMatching(render('<button data-target aria-label="Close" title="x">×</button>')).label).toBe('Close');
  });

  it('does not count the element itself as its own context', () => {
    const description = describeForMatching(render('<nav aria-label="Sidebar"><button data-target aria-label="Pin">p</button></nav>'));
    expect(description.within).toEqual({ label: 'Sidebar' });
  });

  it('cuts long text and labels to the limit', () => {
    const description = describeForMatching(render(`<button data-target aria-label="${'l'.repeat(200)}">${'t'.repeat(200)}</button>`));
    expect(description.text).toHaveLength(DESCRIPTION_TEXT_LIMIT);
    expect(description.label).toHaveLength(DESCRIPTION_TEXT_LIMIT);
  });
});
