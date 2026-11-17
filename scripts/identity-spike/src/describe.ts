// scripts/identity-spike/src/describe.ts
// What a person needs to find a captured element on the page: the corpus capture's description.
//
// CORPUS.md matches rule 3's rows to captured elements "by hand, from that description", and the
// list is "never by fingerprint". So this reads the DOM directly and owes nothing to rastro-core.
// Built from `roleOf` and `accName` instead, it would be strategy 1 under another name: blind
// exactly where strategy 1 is (an unlabelled input, a cell that is a `<div>` until edited), and
// the hand matching would lean on the strategy it is meant to judge.
//
// Everything here is recorded, never interpreted: no implicit roles, no name computation.
//
// Not redacted. The corpus apps show generated demo data, and captures stay in $RASTRO_CORPUS,
// outside the repo. Input values are never read, so nothing a user typed is recorded.

/** Visible text and labels are cut here: enough to recognise an element, not to copy a page. */
export const DESCRIPTION_TEXT_LIMIT = 80;

export interface ElementDescription {
  tag: string;
  /** The `role` attribute as written. Null when absent: implicit roles are not computed. */
  role: string | null;
  /**
   * An author-written label, the first present of: `aria-label`, the text of every element
   * `aria-labelledby` names, `title`, `alt`, `placeholder`.
   */
  label: string | null;
  /** Rendered text, whitespace collapsed. Empty for an element with none. */
  text: string;
  /** Only the attributes present: `type`, `name`, `href`, `data-testid`. */
  attributes: Partial<Record<'type' | 'name' | 'href' | 'testId', string>>;
  /**
   * The nearest ancestor that names itself, by `data-testid` or `aria-label`: which cell, row
   * or menu the element sits in. Actual's transaction fields are told apart only by this.
   */
  within: { testId?: string; label?: string } | null;
  /** Where it is in the viewport, in CSS pixels, rounded: left from right, row from row. */
  box: { x: number; y: number; width: number; height: number };
}

const clip = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_TEXT_LIMIT);

function present(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name);
  return value === null || value.trim() === '' ? undefined : value;
}

function labelOf(element: Element): string | null {
  const aria = present(element, 'aria-label');
  if (aria !== undefined) return clip(aria);
  const by = present(element, 'aria-labelledby');
  if (by !== undefined) {
    const text = by
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim() !== '') return clip(text);
  }
  for (const name of ['title', 'alt', 'placeholder']) {
    const value = present(element, name);
    if (value !== undefined) return clip(value);
  }
  return null;
}

export function describeForMatching(element: Element): ElementDescription {
  const attributes: ElementDescription['attributes'] = {};
  for (const [key, name] of [['type', 'type'], ['name', 'name'], ['href', 'href'], ['testId', 'data-testid']] as const) {
    const value = present(element, name);
    if (value !== undefined) attributes[key] = value;
  }

  const ancestor = element.parentElement?.closest('[data-testid], [aria-label]') ?? null;
  let within: ElementDescription['within'] = null;
  if (ancestor !== null) {
    within = {};
    const testId = present(ancestor, 'data-testid');
    const label = present(ancestor, 'aria-label');
    if (testId !== undefined) within.testId = testId;
    if (label !== undefined) within.label = clip(label);
  }

  const rect = element.getBoundingClientRect();
  const rendered = element instanceof HTMLElement ? element.innerText : undefined;
  return {
    tag: element.tagName.toLowerCase(),
    role: present(element, 'role') ?? null,
    label: labelOf(element),
    // innerText where the layout gives one (jsdom has none), textContent otherwise.
    text: clip(rendered ?? element.textContent ?? ''),
    attributes,
    within,
    box: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}
