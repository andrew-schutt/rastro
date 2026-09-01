// apps/dashboard/src/timeline.ts
// The arithmetic behind the session timeline (docs/PLAN.md §13.1), kept pure and out of the
// component so the part that can actually be wrong is testable.
import type { Step } from 'rastro-core';

/** Gap heights, in px. Clamped so a 50ms gap stays visible and a 45s one stays on screen. */
export const MIN_GAP_PX = 10;
export const MAX_GAP_PX = 140;
/** Dwell that maps to MAX_GAP_PX. Above this, gaps stop growing but the label still tells you. */
export const GAP_SCALE_MS = 15_000;

/** A step with its position on the time axis. */
export interface PlacedStep {
  step: Step;
  /** Cumulative active time at which this step occurred, in ms. */
  atMs: number;
}

/**
 * Place steps on the axis (§13.1: "render Step[] on a time axis (cumulative ux.active_ms)").
 *
 * `ux.active_ms` is the dwell BEFORE a step, so a step sits at the running total *including*
 * its own gap. The first step therefore anchors at its own dwell, which is the time spent on
 * the page before the session's first interaction.
 */
export function placeSteps(steps: Step[]): PlacedStep[] {
  let elapsedMs = 0;
  return steps.map((step) => {
    elapsedMs += step.activeMs;
    return { step, atMs: elapsedMs };
  });
}

/** Total active time the session covers. */
export function totalActiveMs(placed: PlacedStep[]): number {
  return placed.at(-1)?.atMs ?? 0;
}

/**
 * Height for the connector representing a dwell.
 *
 * Square-rooted rather than linear: with a linear scale a 15s pause makes every sub-second
 * gap collapse to the same invisible sliver, and the short gaps are what tell you two events
 * were one gesture.
 */
export function gapHeight(activeMs: number): number {
  const bounded = Math.max(0, Math.min(activeMs, GAP_SCALE_MS));
  return MIN_GAP_PX + Math.sqrt(bounded / GAP_SCALE_MS) * (MAX_GAP_PX - MIN_GAP_PX);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Short label for an event, and the modifier that colours its marker. */
export function kindOf(step: Step): { label: string; kind: string } {
  switch (step.eventName) {
    case 'ux.click':
      return { label: 'click', kind: 'click' };
    case 'ux.route_change':
      return { label: 'navigate', kind: 'route' };
    case 'ux.form_submit':
      return { label: 'submit', kind: 'submit' };
    case 'ux.form_abandon':
      return { label: 'abandon', kind: 'abandon' };
    default:
      // A custom event from track(). The name IS the label — app-owned and static.
      return { label: step.eventName, kind: 'custom' };
  }
}
