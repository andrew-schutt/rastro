// packages/react/src/route.ts
// Route detection (docs/DESIGN.md §4.6) — the default `RouteAdapter` implementation.
//
// §4.6 is blunt that this is per-router integration work, not one function: React Router v5
// vs v6, TanStack, Next Pages, Next App Router all detect navigation differently. The
// framework-agnostic floor is patching `history`, and that is what this is. It exists so the
// SDK has zero-config route tracking; a real adapter is strictly better where one exists,
// because a router reports its own route PATTERN (`/users/:userId`) rather than a concrete
// path that then has to be guessed at by `tokenizePath` (§4.9).
//
// Not in §19.1's file list. It lives outside capture.ts because it is a seam implementation
// with its own lifecycle, not part of the delegated listener.
import type { RouteAdapter } from 'rastro-core';

type HistoryMethod = 'pushState' | 'replaceState';
const PATCHED_METHODS: HistoryMethod[] = ['pushState', 'replaceState'];

// There is exactly one `history` per window, so the patch is shared and reference-counted
// rather than per-adapter. Two providers, or React StrictMode's remount, must not stack
// patches on top of each other or let one unsubscribe rip out another's instrumentation.
const subscribers = new Set<(path: string) => void>();
let originals: Map<HistoryMethod, History[HistoryMethod]> | null = null;

function notifyAll(): void {
  const path = location.pathname;
  for (const subscriber of subscribers) subscriber(path);
}

function install(): void {
  if (originals !== null) return;

  originals = new Map();
  for (const method of PATCHED_METHODS) {
    // Capturing the unbound method IS the patch; it is re-bound below via
    // `original.apply(this, args)`, which supplies the receiver the rule warns about.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = history[method];
    originals.set(method, original);

    history[method] = function patched(
      this: History,
      ...args: Parameters<History[HistoryMethod]>
    ) {
      // Notify AFTER the call: the router has updated `location` by then, so
      // `location.pathname` is the destination rather than the origin.
      const result = original.apply(this, args);
      notifyAll();
      return result;
    };
  }

  window.addEventListener('popstate', notifyAll);
  window.addEventListener('hashchange', notifyAll);
}

function uninstall(): void {
  if (originals === null) return;

  for (const [method, original] of originals) {
    // Only restore what is still ours. If something patched on top afterwards, leave the
    // chain intact rather than ripping out someone else's instrumentation.
    if (history[method] !== original) history[method] = original;
  }
  originals = null;

  window.removeEventListener('popstate', notifyAll);
  window.removeEventListener('hashchange', notifyAll);
}

/**
 * Detect SPA navigation by patching `history.pushState` / `replaceState` and listening for
 * `popstate` and `hashchange`.
 *
 * ⚠ TODO(§4.6): Next's App Router partially defeats this — it can change what the user sees
 * without a `pushState` this can observe. Next, React Router, and TanStack each want a real
 * adapter that subscribes to the router itself and reports its route pattern.
 */
export function historyRouteAdapter(): RouteAdapter {
  return {
    current: () => (typeof location === 'undefined' ? '/' : location.pathname),

    subscribe(onChange) {
      // §4.8: under SSR there is no history to patch. Return a no-op unsubscribe.
      if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};

      subscribers.add(onChange);
      if (subscribers.size === 1) install();

      return () => {
        subscribers.delete(onChange);
        if (subscribers.size === 0) uninstall();
      };
    },
  };
}
