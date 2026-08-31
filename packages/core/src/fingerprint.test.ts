// packages/core/src/fingerprint.test.ts
// Placeholders only — `fingerprint()` is a stub until walking-skeleton step 3 (§19.4).
// These name the cases that should drive the implementation.
import { describe, it } from 'vitest';

describe('fingerprint', () => {
  it.todo('returns `id:<value>` when the element carries data-telemetry-id');
  it.todo('returns `id:<value>` when an ANCESTOR carries data-telemetry-id');
  it.todo('prefers the override over every derived signal');

  it.todo('composes <component chain>|<role>|"<accessible name>"');
  it.todo('degrades the component chain to `unknown` on a non-React node');
  it.todo('drops the trailing segment when there is no accessible name');
});

describe('componentChain', () => {
  it.todo('walks up fiber.return collecting function and class component names');
  it.todo('unwraps forwardRef and memo to the real component name');
  it.todo('skips host elements (div, span) and the NOISE regex (Provider, Fragment, ...)');
  it.todo('caps depth at 4 so deep-tree changes do not churn the fingerprint');
  it.todo('orders names outermost → innermost');
  it.todo('returns [] when the DOM node has no React fiber');
});

describe('roleOf', () => {
  it.todo('prefers an explicit role attribute');
  it.todo('returns `input:email` for <input type="email">');
  it.todo('falls back to the lowercased tag name');
});

describe('accName', () => {
  it.todo('prefers aria-label');
  it.todo('resolves aria-labelledby to the referenced element text');
  it.todo('falls back to innerText, then title/alt');
  it.todo('collapses whitespace and caps at 50 characters');
  it.todo('runs the name through redact() before it enters the fingerprint');
});

// The false-split regression guard (§4.2.1). The most valuable test file in the repo —
// each case is a "same element, small refactor" pair that MUST keep its fingerprint.
describe('stability across refactors', () => {
  it.todo('survives an unrelated wrapper div being added around the element');
  it.todo('survives a CSS class / styling change');
  it.todo('survives a sibling element being reordered');
  it.todo('survives a noise component (Provider, ErrorBoundary) appearing in the ancestry');

  // Known v1 failure modes — assert them explicitly so a future fix is a visible change.
  it.todo('KNOWN: splits when the button copy is edited (i18n / copy change)');
  it.todo('KNOWN: splits when the owning component is renamed');
  it.todo('KNOWN: mass-merges under minification without the §4.3 build plugin');
});
