// packages/core/src/fingerprint.ts
// Stable element identity (PLAN.md §4.2.1) — the interesting code.
//
// STUB. Real signature, naive body, no fiber walk yet. This is deliberately the LAST thing
// built (walking-skeleton step 3, §19.4) because it is the project's existence condition
// (§4.2) and deserves its own before/after-refactor fixture suite rather than a rushed pass.
import type { FingerprintStrategy } from './seams.js';

/** The `data-telemetry-id` escape hatch: an explicit override always wins (§4.2.1). */
export const OVERRIDE_ATTRIBUTE = 'data-telemetry-id';

/** Emitted for the component chain when it cannot be derived. Degrades, never poisons. */
export const UNKNOWN_CHAIN = 'unknown';

/**
 * Derive a stable fingerprint for an element.
 *
 * Format (§4.2.1, and SEMANTIC-CONVENTIONS.md "Fingerprint format"):
 *   `<component chain>|<role>|"<accessible name>"`
 *   e.g. `Settings>ProfileForm>SaveButton|button|"Save Profile"`
 * An explicit override yields `id:<value>` and skips derivation entirely.
 *
 * Today: the override path is real; everything else degrades to `unknown|<tag>`.
 *
 * TODO(§4.2.1) implement the five steps, test-first:
 *   1. DOM node → React fiber, found by the `__reactFiber$` / `__reactInternalInstance$`
 *      key prefix. Return null (→ degrade) when the node is not React.
 *   2. Fiber → component chain: walk up `.return`, collect function/class component names,
 *      unwrap forwardRef/memo, skip host elements and the NOISE regex, cap depth at 4,
 *      reverse to outermost → innermost. This is the primary stabilizer — it survives copy
 *      edits, i18n, and CSS refactors.
 *   3. `roleOf`: explicit `role`, else `tag:type`, else `tag`.
 *   4. `accName`: aria-label → aria-labelledby → innerText → title/alt, whitespace-collapsed
 *      and capped at 50 chars. MUST go through `redact()` before it enters the fingerprint.
 *   5. Compose with graceful degradation: missing chain → `unknown`, missing name → drop the
 *      trailing segment.
 *
 * TODO(§4.2.1) the fixture suite is the point: pairs of "same element before/after a
 * refactor" that must produce the SAME fingerprint. That file is the false-split regression
 * guard and the most valuable test in the repo.
 *
 * KNOWN LIMITATION to carry into the README (§4.2.1): without the §4.3 build-time plugin,
 * a minified production build collapses component names to `t`, `a`, `e` — mass false
 * merges. v1 is genuinely reliable only in dev, or in prod with the plugin.
 */
export function fingerprint(element: Element): string {
  const override = element.closest(`[${OVERRIDE_ATTRIBUTE}]`)?.getAttribute(OVERRIDE_ATTRIBUTE);
  if (override) return `id:${override}`; // manual: rock-solid

  // TODO: steps 1–4. Until then every element in a tree collapses to its tag — correct
  // shape, useless identity. Do not ship analysis numbers built on this.
  return `${UNKNOWN_CHAIN}|${element.tagName.toLowerCase()}`;
}

/** The default `FingerprintStrategy` implementation (§19.5). */
export const defaultFingerprintStrategy: FingerprintStrategy = { fingerprint };
