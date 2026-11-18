// packages/core/src/fingerprint.ts
// Stable element identity (docs/DESIGN.md §4.2.1) — the interesting code, and the project's
// existence condition. If this is wrong, every number the tool ever produces is noise (§4.2).
//
// Deliberately good enough, not perfect: stable across sessions and small refactors, readable
// enough to eyeball collisions during development, and honest about where it breaks. The
// readability is the point early on — you can SEE false merges and splits in the raw data.
import type { FingerprintStrategy, Redactor } from './seams.js';
import { defaultRedactor } from './redact.js';

/** The `data-telemetry-id` escape hatch: an explicit override always wins (§4.2.1). */
export const OVERRIDE_ATTRIBUTE = 'data-telemetry-id';

/**
 * Selector for things a user meaningfully activates: the elements that get an identity.
 *
 * Capture resolves every click to the nearest match and drops a click that resolves to none,
 * since inert background would bury real interactions in noise. The identity spike counts
 * the same set. It lives here, not in either consumer, because the two must agree: a spike
 * counting a different set from the one capture emits would measure elements no event ever
 * carries, and miss some that every event does.
 *
 * `[data-telemetry-id]` is included so an explicit opt-in always counts, even on a div.
 */
export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  `[${OVERRIDE_ATTRIBUTE}]`,
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where `babel-plugin-rastro` stamps the owning component (§4.3).
 *
 * ⚠ This string is duplicated in the plugin, which keeps it dependency-free rather than
 * importing `rastro-core` into a build-time tool. The two MUST agree; `core` owns the name
 * because the attribute is part of the identity contract, not of any one toolchain.
 */
export const COMPONENT_ATTRIBUTE = 'data-rastro-component';

/** Emitted for the component chain when it cannot be derived. Degrades, never poisons. */
export const UNKNOWN_CHAIN = 'unknown';

/**
 * Wrapper and framework component names that carry no UX meaning. Including them would make
 * the fingerprint churn whenever a provider or boundary is added anywhere in the ancestry.
 *
 * ⚠ Widened from §4.2.1, which anchors `^Provider$` and `^Consumer$`. Those only ever match
 * React's own `Context.Provider` displayName — and in React 19 a context provider's fiber
 * type is the context object, which yields no name at all, so the anchored form is nearly
 * dead code. Meanwhile every real wrapper is named `ThemeProvider`, `QueryClientProvider`,
 * `AuthProvider`, and `RastroProvider` — including this SDK's own, which was landing in the
 * chain of every fingerprint in the host app. Matching the suffix is what the rule was
 * plainly reaching for, and it fixes the SDK polluting its own output.
 */
export const NOISE =
  /^(Context|Fragment|Anonymous|ForwardRef|Memo|.*(Provider|Consumer|Boundary))$/;

/**
 * How many component names the chain keeps, counted from the element upward.
 *
 * The cap is what stops the fingerprint churning when someone restructures the top of the
 * tree — a change five levels above a button should not rename that button.
 */
export const MAX_CHAIN_DEPTH = 4;

/** Accessible names are truncated to this. Long labels are usually content, not identity. */
export const MAX_NAME_LENGTH = 50;

/**
 * Elements whose accessible name may come from their own text content.
 *
 * ⚠ Narrower than §4.2.1, which falls back to text content for ANY element. Applied to a
 * container that produces a text blob: a `<form>` fingerprints as
 * `App>SettingsForm|form|"Profile Display name Email Save Profile A button w"`, which is
 * unstable (any label inside it re-fingerprints the form), a wider PII surface, and not an
 * accessible name in any real sense.
 *
 * W3C accname — which §4.2.1 says it is approximating — agrees: "name from content" applies
 * only to specific roles, not to containers. This is that rule, tag-shaped for v1. §4.2.1
 * calls accName "an approximation" and "a clean v2 upgrade point"; this is that upgrade.
 */
export const NAME_FROM_CONTENT = new Set([
  'a', 'button', 'summary', 'label', 'legend', 'option', 'th', 'td', 'caption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

/** ARIA roles that take their name from content, for elements using an explicit role. */
export const ROLES_FROM_CONTENT = new Set([
  'button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'treeitem', 'heading', 'cell', 'gridcell', 'columnheader',
  'rowheader', 'tooltip',
]);

/** May this element be named by its own text? */
function namedByContent(element: Element): boolean {
  const explicit = element.getAttribute('role');
  if (explicit !== null && explicit !== '') return ROLES_FROM_CONTENT.has(explicit);
  return NAME_FROM_CONTENT.has(element.tagName.toLowerCase());
}

/**
 * DOM → component ancestry, outermost → innermost, from build-time attributes (§4.3).
 *
 * The plugin stamps the component that owns each host element as a string literal, so this
 * survives minification. It is the only chain Rastro derives: the runtime fiber walk was removed
 * after §3.2's run 2, where it did not beat role and accessible name alone, and churned on
 * untouched code once names were minified (docs/NOTES.md). A document the plugin did not
 * annotate has no stamps, so its chain is empty and the fingerprint says `unknown`.
 *
 * - **Consecutive duplicates collapse.** The plugin stamps EVERY host element, so a
 *   `<form><div><input>` all rendered by `SettingsForm` carries the name three times, where
 *   the component appears once.
 * - **NOISE is skipped.** A `ThemeProvider` that renders a `<div>` gets stamped like anything
 *   else, and would otherwise churn the chain whenever a provider is added.
 *
 * Known, irreducible limits (docs/PRIOR-ART.md): portaled content loses its ancestry, since DOM
 * nesting does not cross a portal; components that render no host element of their own are
 * invisible; and `node_modules` components are never annotated.
 */
export function attributeChain(element: Element, max: number = MAX_CHAIN_DEPTH): string[] {
  const names: string[] = [];
  let current: Element | null = element;

  while (current !== null && names.length < max) {
    const name = current.getAttribute(COMPONENT_ATTRIBUTE);
    if (
      name !== null &&
      name !== '' &&
      !NOISE.test(name) &&
      name !== names[names.length - 1] // the plugin stamps every host element; collapse repeats
    ) {
      names.push(name);
    }
    current = current.parentElement;
  }

  return names.reverse(); // outermost → innermost
}

/**
 * Role-ish descriptor: tag name plus the disambiguating attribute.
 *
 * Cheap, stable, and no accessible-name algorithm needed. Rarely changes, and when it does
 * (`div` → `button`) the split is usually a genuine semantic change worth seeing.
 */
export function roleOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const explicit = element.getAttribute('role');
  if (explicit !== null && explicit !== '') return explicit;

  const type = element.getAttribute('type');
  return type !== null && type !== '' ? `${tag}:${type}` : tag; // "button", "input:email", "a"
}

/** Collapse whitespace, trim, and cap. Applied AFTER redaction so nothing escapes by truncation. */
export function norm(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * Accessible name, approximated.
 *
 * Full W3C accessible-name computation is a rabbit hole; this covers roughly 90% and is a
 * clean v2 upgrade point. Redaction runs BEFORE truncation, so an email cannot survive by
 * being cut in half (§4.9).
 *
 * Author-supplied labels (`aria-label`, `aria-labelledby`, `title`, `alt`) are honoured on
 * ANY element — a container the developer bothered to name has a real name. Only the
 * text-content fallback is restricted.
 *
 * TODO(§4.2.1): `aria-labelledby` may list several ids; only the first is resolved here.
 */
export function accName(
  element: Element,
  redactor: Redactor = defaultRedactor,
): string | undefined {
  const clean = (text: string): string | undefined => {
    const result = norm(redactor.redact(text));
    return result === '' ? undefined : result;
  };

  const aria = element.getAttribute('aria-label');
  if (aria !== null && aria !== '') return clean(aria);

  const by = element.getAttribute('aria-labelledby');
  if (by !== null && by !== '') {
    const referenced = element.ownerDocument.getElementById(by.split(/\s+/)[0] ?? by);
    const text = referenced?.textContent;
    if (text !== null && text !== undefined && text !== '') return clean(text);
  }

  // Text content, but only for elements the accname rules allow it for (see
  // NAME_FROM_CONTENT). `innerText` respects CSS visibility, so it matches what a user can
  // actually read — but it is layout-dependent. See the §4.7 note on describeElement.
  if (namedByContent(element)) {
    const rendered = (element as Partial<HTMLElement>).innerText ?? element.textContent ?? '';
    if (rendered.trim() !== '') return clean(rendered);
  }

  return clean(element.getAttribute('title') ?? element.getAttribute('alt') ?? '');
}

/**
 * The `data-telemetry-id` override that applies to this element, if any.
 *
 * The nearest carrier wins, on the element or any ancestor. An empty value on the nearest
 * carrier means no override, not "keep looking": the closest host is the one the developer
 * wrote, and emitting `id:` would join everything that does the same.
 *
 * Exported so every identity strategy honours the override the same way. §3.2 rule 1
 * composes each alternative "exactly as `fingerprint()` does", and an override that only the
 * default respected would count as a win for the default that no strategy ever earned.
 */
export function overrideOf(element: Element): string | undefined {
  const value = element.closest(`[${OVERRIDE_ATTRIBUTE}]`)?.getAttribute(OVERRIDE_ATTRIBUTE);
  return value === null || value === undefined || value === '' ? undefined : value;
}

/** Everything §4.2.1 derives about an element, from a single pass. */
export interface ElementDescription {
  /** The composite identity. Opaque to consumers — they join on it, they do not parse it. */
  fingerprint: string;
  /** `ux.component_chain`: outermost → innermost. Empty when not derivable. */
  componentChain: string[];
  /** `ux.role`: a queryable slice of the fingerprint. */
  role: string;
  /** `ux.accessible_name`, already redacted. Absent when the element has no label. */
  accessibleName?: string;
}

/**
 * Derive the fingerprint AND the raw parts that composed it, in one pass.
 *
 * §4.2.1: "Keep the raw components too, so you can re-derive fingerprints later without
 * re-collecting." That is what makes a fingerprint-format change survivable — the alternative
 * is discovering the format is wrong and having no way to fix historical data.
 *
 * §4.7 (measured, not assumed): this runs synchronously inside a passive click handler.
 * Measured at ~0.0015 ms per call in Chrome on the demo app — roughly 1/10,000th of a frame
 * budget, so the `requestIdleCallback` deferral §4.7 reaches for is not warranted yet.
 *
 * ⚠ What that measurement does NOT cover: `accName` reads `innerText`, which is
 * layout-dependent. Layout was clean in the benchmark, as it usually is at the start of a
 * gesture. A click handler firing against a dirty layout would force a reflow, and the cost
 * would not resemble the number above. Re-measure on a large app before assuming this is
 * free there; the escape hatch remains to take the cheap facts synchronously (`ux.seq` MUST
 * stay in gesture order) and defer the derivation.
 */
export function describeElement(element: Element, redactor: Redactor = defaultRedactor): ElementDescription {
  const role = roleOf(element);

  // Step 5, first branch: an explicit override skips derivation entirely. Rock-solid, and the
  // far end of the automatic↔manual dial — worth honouring before any work is done.
  const override = overrideOf(element);
  if (override !== undefined) {
    return { fingerprint: `id:${override}`, componentChain: [], role };
  }

  const chain = attributeChain(element);
  const name = accName(element, redactor);

  // Each missing signal drops out rather than poisoning the whole thing.
  const parts = [chain.length > 0 ? chain.join('>') : UNKNOWN_CHAIN, role];
  if (name !== undefined) parts.push(`"${name}"`);

  return {
    fingerprint: parts.join('|'),
    componentChain: chain,
    role,
    ...(name === undefined ? {} : { accessibleName: name }),
  };
}

/**
 * Stable element identity.
 *
 * Format (§4.2.1, and the conventions' "Fingerprint format"):
 *   `<component chain>|<role>|"<accessible name>"`
 *   e.g. `Settings>ProfileForm>SaveButton|button|"Save Profile"`
 * The chain comes from the build plugin's stamps, and is `unknown` without them.
 * An explicit `data-telemetry-id` yields `id:<value>` and skips derivation.
 *
 * Known failure modes, stated plainly because both are measured (§3.2 run 2): i18n and copy
 * edits cause false SPLITS (same button, new text, new fingerprint), and distinct elements
 * that share a component and a name, such as unlabelled icon buttons, MERGE. Both are asserted
 * in fingerprint.test.ts so they stay visible.
 */
export function fingerprint(element: Element, redactor: Redactor = defaultRedactor): string {
  return describeElement(element, redactor).fingerprint;
}

/** The default `FingerprintStrategy` implementation (§19.5). */
export const defaultFingerprintStrategy: FingerprintStrategy = { fingerprint };
