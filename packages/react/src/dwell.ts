// packages/react/src/dwell.ts
// Visibility-adjusted timing (docs/DESIGN.md §4.5).
//
// §4.5 calls this out as a silent correctness bug in the exact number the analysis reasons
// over: wall-clock dwell includes tab-backgrounding, someone walking away, and dev tools
// left open. Measure that and "users pause 5.1s before Edit Username" really means "who
// switched tabs".
//
// So `ux.active_ms` is built on a clock that only advances while the page is visible.

/** A monotonic clock that stops while `document.hidden` is true. */
export interface ActiveClock {
  /** Visible milliseconds since the clock started. */
  elapsed(): number;
  /**
   * Force the visibility state. The clock wires itself to `visibilitychange` when a document
   * exists; this is the seam that lets the behaviour be tested without a DOM.
   */
  setVisible(visible: boolean): void;
  /** Detach the visibility listener. */
  stop(): void;
}

export interface ActiveClockOptions {
  /**
   * Time source. Defaults to `performance.now()` where available: it is monotonic, so a
   * user's clock drifting or being corrected mid-session cannot produce a negative dwell.
   */
  now?: () => number;
  /** Starting visibility. Defaults to the document's, or `true` with no document (§4.8 SSR). */
  visible?: boolean;
}

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function documentIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function createActiveClock({
  now = defaultNow,
  visible = documentIsVisible(),
}: ActiveClockOptions = {}): ActiveClock {
  // Time banked from previous visible stretches, plus the start of the current one.
  let banked = 0;
  let visibleSince: number | undefined = visible ? now() : undefined;

  const elapsed = (): number =>
    visibleSince === undefined ? banked : banked + (now() - visibleSince);

  const setVisible = (nextVisible: boolean): void => {
    if (nextVisible === (visibleSince !== undefined)) return; // no change

    if (nextVisible) {
      visibleSince = now();
    } else {
      banked = elapsed();
      visibleSince = undefined;
    }
  };

  const onVisibilityChange = (): void => setVisible(documentIsVisible());

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    elapsed,
    setVisible,
    stop: () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
  };
}

/**
 * How long a dwell may be reported as, in ms.
 *
 * §4.5 says to cap idle gaps as well as subtract hidden time, because a user can leave a
 * visible tab open and walk away. The number is a judgment call and deliberately generous:
 * §10's long-pause friction signal fires well below it, so capping here does not blind that
 * signal, while a lunch break no longer lands in the data as twenty minutes of "engagement".
 *
 * ❓ Unmeasured, and related to §4.5's open question about the sessionization rule. Revisit
 * with real traffic rather than defending this number.
 */
export const MAX_DWELL_MS = 60_000;

/** Clamp and round a raw dwell into the integer `ux.active_ms` wants. */
export function cappedDwell(elapsedMs: number, maxMs: number = MAX_DWELL_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return Math.round(Math.min(elapsedMs, maxMs));
}
