// scripts/identity-spike/src/fiber.ts
// React's internals, read by the measurement and never by Rastro.
//
// Rastro's fingerprint stopped reading React's fiber tree after §3.2's run 2 (docs/NOTES.md).
// The measurement still needs it. The collision referee reads React's `key` off each element's
// fiber (repeat-oracle.ts), and rule 2's "touched" reads every first-party component above an
// element, which only the fiber tree knows across portals (ancestry.ts). So the fiber lookup and
// the marks moved here from rastro-core, unchanged.

/** React hangs its fiber off the DOM node under a randomized key. 17+ first, then 16. */
export const FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'] as const;

/**
 * DOM node → React fiber, or null for a node React did not render. Typed loosely: each reader
 * declares the private fields it reads.
 */
export function getFiber<T = unknown>(node: Element): T | null {
  for (const key of Object.keys(node)) {
    for (const prefix of FIBER_PREFIXES) {
      if (key.startsWith(prefix)) return ((node as unknown as Record<string, T>)[key] ?? null);
    }
  }
  return null;
}

/**
 * Where the spike's mark plugin (mark-plugin.ts) attaches a component's mark: a property on the
 * component itself, holding `{ name, file }` as string literals that minification cannot touch.
 */
export const MARK_PROPERTY = '__rastroMark';

/** What the mark plugin marks a first-party component with. */
export interface ComponentMark {
  name: string;
  /** Repo-relative, POSIX. Absent when the file sits outside the build's root. */
  file?: string;
}
