// packages/core/src/fingerprint.ts
// Stable element identity (docs/PLAN.md §4.2.1) — the interesting code, and the project's
// existence condition. If this is wrong, every number the tool ever produces is noise (§4.2).
//
// Deliberately good enough, not perfect: stable across sessions and small refactors, readable
// enough to eyeball collisions during development, and honest about where it breaks. The
// readability is the point early on — you can SEE false merges and splits in the raw data.
import type { FingerprintStrategy, Redactor } from './seams.js';
import { defaultRedactor } from './redact.js';

/** The `data-telemetry-id` escape hatch: an explicit override always wins (§4.2.1). */
export const OVERRIDE_ATTRIBUTE = 'data-telemetry-id';

/** Emitted for the component chain when it cannot be derived. Degrades, never poisons. */
export const UNKNOWN_CHAIN = 'unknown';

/** React hangs its fiber off the DOM node under a randomized key. 17+ first, then 16. */
export const FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'] as const;

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

/** The parts of React's fiber this walks. Typed loosely on purpose: it is private API. */
interface FiberLike {
  type?: unknown;
  return?: FiberLike | null;
}

/** A function component, or the object forwardRef/memo wrap one in. */
interface ComponentType {
  displayName?: string;
  name?: string;
  render?: ComponentType;
  type?: ComponentType;
}

/**
 * DOM node → React fiber.
 *
 * ⚠ This reads React's private, unstable internals. Heap, PostHog, and FullStory all do some
 * version of this; there is no public API for it. A React version that moves the key makes
 * this return null, and the fingerprint degrades to `unknown|<role>` rather than breaking.
 *
 * Uses `Object.keys` rather than the `for...in` of the §4.2.1 sketch: React sets the fiber as
 * an own enumerable property, while `for...in` also walks an Element's entire prototype
 * chain — hundreds of properties, on every click (§4.7).
 */
export function getFiber(node: Element): FiberLike | null {
  for (const key of Object.keys(node)) {
    for (const prefix of FIBER_PREFIXES) {
      if (key.startsWith(prefix)) {
        return (node as unknown as Record<string, FiberLike>)[key] ?? null;
      }
    }
  }
  return null; // not React, or a version whose internals moved — degrade (Step 5)
}

/** Pull a displayable name off a fiber's `type`, unwrapping forwardRef and memo. */
function nameOfType(type: unknown): string | null {
  if (typeof type === 'function') {
    const fn = type as ComponentType;
    return fn.displayName ?? fn.name ?? null;
  }
  if (typeof type !== 'object' || type === null) return null; // host element ('div'), or null

  const wrapper = type as ComponentType;
  if (wrapper.render !== undefined) {
    return wrapper.render.displayName ?? wrapper.render.name ?? null; // forwardRef
  }
  if (wrapper.type !== undefined) {
    return wrapper.type.displayName ?? wrapper.type.name ?? null; // memo
  }
  return null;
}

/**
 * Fiber → component ancestry, outermost → innermost.
 *
 * The chain is the PRIMARY stabilizer: it survives copy edits, i18n, and CSS refactors, which
 * are exactly the things that break text and selectors. Host elements (`div`, `span`) and
 * NOISE names are skipped so the chain describes structure, not markup.
 *
 * ⚠ MINIFICATION: in a production build without the §4.3 build-time plugin, `fn.name` becomes
 * `t`, `a`, `e` and the chain collapses to garbage — mass false merges. v1 is genuinely
 * reliable only in dev, or in prod WITH the plugin. This is the single most important
 * limitation of the whole tool; see docs/NOTES.md.
 */
export function componentChain(fiber: FiberLike | null, max: number = MAX_CHAIN_DEPTH): string[] {
  const names: string[] = [];
  let current: FiberLike | null | undefined = fiber;

  while (current !== null && current !== undefined && names.length < max) {
    const raw = nameOfType(current.type);
    if (raw !== null && raw !== '' && !NOISE.test(raw)) names.push(raw);
    current = current.return;
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
export function describeElement(
  element: Element,
  redactor: Redactor = defaultRedactor,
): ElementDescription {
  const role = roleOf(element);

  // Step 5, first branch: an explicit override skips derivation entirely. Rock-solid, and the
  // far end of the automatic↔manual dial — worth honouring before any work is done.
  const overrideHost = element.closest(`[${OVERRIDE_ATTRIBUTE}]`);
  const override = overrideHost?.getAttribute(OVERRIDE_ATTRIBUTE);
  if (override !== null && override !== undefined && override !== '') {
    return { fingerprint: `id:${override}`, componentChain: [], role };
  }

  const chain = componentChain(getFiber(element));
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
 * An explicit `data-telemetry-id` yields `id:<value>` and skips derivation.
 *
 * Known v1 failure modes, stated plainly because both are measurable rather than theoretical:
 * i18n and copy edits cause false SPLITS (same button, new text, new fingerprint), and
 * minified production without the §4.3 build plugin causes mass false MERGES. Both are
 * asserted in fingerprint.test.ts so they stay visible.
 */
export function fingerprint(element: Element, redactor: Redactor = defaultRedactor): string {
  return describeElement(element, redactor).fingerprint;
}

/** The default `FingerprintStrategy` implementation (§19.5). */
export const defaultFingerprintStrategy: FingerprintStrategy = { fingerprint };
