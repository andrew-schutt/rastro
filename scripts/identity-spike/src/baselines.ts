// scripts/identity-spike/src/baselines.ts
// §3.2 rule 1's two baseline strategies: role + accessible name (1) and the CSS selector
// path (2). Neither will ever ship, which is why they live here and not in rastro-core. What
// they are composed with does ship, so they take it from core: the override, the role, the
// accessible name and its redaction, all exactly as `fingerprint()` uses them.
import { accName, defaultRedactor, overrideOf, roleOf, type Redactor } from 'rastro-core';

/** `<path>|<role>|"<name>"` around any path, the way `fingerprint()` composes its chain. */
function compose(element: Element, path: string | null, redactor: Redactor): string {
  const override = overrideOf(element);
  if (override !== undefined) return `id:${override}`;

  const parts = path === null ? [] : [path];
  parts.push(roleOf(element));
  const name = accName(element, redactor);
  if (name !== undefined) parts.push(`"${name}"`);
  return parts.join('|');
}

/**
 * Strategy 1: role and accessible name, and nothing about where the element sits.
 *
 * The floor every structural strategy must clear. It never splits on a refactor, and merges
 * every pair of controls that look alike to a screen reader: two "Save" buttons anywhere.
 */
export function roleNameFingerprint(element: Element, redactor: Redactor = defaultRedactor): string {
  return compose(element, null, redactor);
}

/**
 * The selector path, modelled on PostHog's `$elements_chain`. This is an approximation of
 * what the incumbent stores, not a copy of it.
 *
 * Read from posthog-js @ 8c832754 (2026-10-30), `packages/browser-common/src/autocapture.ts`
 * (`autocapturePropertiesForElement`, `getPropertiesFromElement`) and
 * `utils/autocapture-utils.ts` (`elementsToString`). What is kept from it:
 *
 * - **Every ancestor, to `<body>` inclusive.** No depth cap. PostHog's 1000-node bound only
 *   guards against cycles. A shadow root is crossed to its host.
 * - **Innermost first, joined by `;`.** Each entry is `tag.class.class:key="value"...`, with
 *   classes sorted and their quotes removed, and keys sorted.
 * - **Classes as written, hashed CSS-in-JS names included.** PostHog filters none, and that
 *   instability is part of what the baseline is meant to measure.
 * - **Position:** `nth-child` and `nth-of-type`, both 1-based, counted over element
 *   siblings, on every entry.
 * - **The `id` attribute,** as `attr_id`.
 *
 * What is dropped, with the reason for each:
 *
 * - **Text, and the `href`.** Rule 1 composes every strategy with role and accessible name,
 *   so the target's own name is already in the fingerprint. PostHog's text and `href` on
 *   ancestors are dropped with it.
 * - **Every other attribute** (`attr__*`: `aria-*`, `data-*`, `type`, state such as
 *   `aria-checked`). Keeping them would add splits on every state change and every new
 *   data attribute, which would make the baseline weaker than PostHog's actions, whose
 *   selectors rarely pin them. Dropping them errs toward the incumbent, the safe side for a
 *   baseline this design is a bet against. It also keeps the harness's `data-el` oracle out
 *   of the identity, as with every other strategy.
 *
 * **What no definition here can model.** PostHog does not use this string as an identity.
 * It stores it, and an Action matches a looser selector over it at query time
 * (docs/PRIOR-ART.md, "The incumbents can repair a false merge"). Treating the whole stored
 * path as the identity makes this baseline split more readily and merge less readily than a
 * well-written Action would. Its splits overstate the incumbent's, and its merges understate
 * them. Report it as the stored chain, not as PostHog's identity.
 *
 * Any change to this definition after a corpus number is seen makes it a different
 * strategy, reported separately.
 */
export function selectorPath(element: Element): string {
  const entries: string[] = [];
  const seen = new Set<Element>();
  let current: Element | null = element;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    entries.push(describeEntry(current));
    if (current.tagName.toLowerCase() === 'body') break;
    current = parentOf(current);
  }
  return entries.join(';');
}

/** Strategy 2: the selector path, composed with role and accessible name. */
export function selectorPathFingerprint(element: Element, redactor: Redactor = defaultRedactor): string {
  return compose(element, selectorPath(element), redactor);
}

const ELEMENT_NODE = 1;
const DOCUMENT_FRAGMENT_NODE = 11;

/** The parent element, crossing a shadow root to its host. PostHog walks `parentNode`. */
function parentOf(element: Element): Element | null {
  const parent = element.parentNode;
  if (parent === null) return null;
  if (parent.nodeType === DOCUMENT_FRAGMENT_NODE && 'host' in parent) return (parent as ShadowRoot).host;
  return parent.nodeType === ELEMENT_NODE ? (parent as Element) : null;
}

const escapeQuotes = (value: string): string => value.replace(/"|\\"/g, '\\"');

/** One `elementsToString` entry, restricted to the parts kept above. */
function describeEntry(element: Element): string {
  const classes = (element.getAttribute('class') ?? '')
    .trim()
    .split(/\s+/)
    .filter((name) => name !== '')
    .sort()
    .map((name) => `.${name.replace(/"/g, '')}`)
    .join('');

  let nthChild = 1;
  let nthOfType = 1;
  for (let sibling = element.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
    nthChild++;
    if (sibling.tagName === element.tagName) nthOfType++;
  }

  const keys: [string, string][] = [];
  const id = element.getAttribute('id');
  if (id !== null && id !== '') keys.push(['attr_id', id]);
  keys.push(['nth-child', String(nthChild)], ['nth-of-type', String(nthOfType)]);
  keys.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const attributes = keys.map(([key, value]) => `${escapeQuotes(key)}="${escapeQuotes(value)}"`).join('');
  return `${element.tagName.toLowerCase()}${classes}:${attributes}`;
}
