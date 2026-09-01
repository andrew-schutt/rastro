// apps/dashboard/src/timeline.test.ts
import { describe, expect, it } from 'vitest';
import type { Step } from 'rastro-core';
import {
  GAP_SCALE_MS,
  MAX_GAP_PX,
  MIN_GAP_PX,
  formatMs,
  gapHeight,
  kindOf,
  placeSteps,
  totalActiveMs,
} from './timeline.js';

const step = (overrides: Partial<Step> = {}): Step => ({
  eventName: 'ux.click',
  fingerprint: 'App>Save|button|"Save"',
  route: '/',
  seq: 1,
  activeMs: 0,
  ...overrides,
});

describe('placeSteps', () => {
  // The §13.1 requirement: a time axis of cumulative ux.active_ms.
  it('accumulates activeMs across steps', () => {
    const placed = placeSteps([
      step({ seq: 1, activeMs: 1_000 }),
      step({ seq: 2, activeMs: 2_500 }),
      step({ seq: 3, activeMs: 500 }),
    ]);

    expect(placed.map((p) => p.atMs)).toEqual([1_000, 3_500, 4_000]);
  });

  it('places a step at the total INCLUDING its own gap, since activeMs precedes it', () => {
    const [first] = placeSteps([step({ activeMs: 4_200 })]);

    // Not 0: the dwell before the first interaction is time the user spent on the page.
    expect(first?.atMs).toBe(4_200);
  });

  it('handles steps with no reported dwell', () => {
    const placed = placeSteps([step({ seq: 1 }), step({ seq: 2 }), step({ seq: 3 })]);

    expect(placed.map((p) => p.atMs)).toEqual([0, 0, 0]);
  });

  it('is monotonic — the axis can never run backwards', () => {
    const placed = placeSteps([
      step({ seq: 1, activeMs: 300 }),
      step({ seq: 2, activeMs: 0 }),
      step({ seq: 3, activeMs: 90 }),
    ]);
    const times = placed.map((p) => p.atMs);

    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('returns nothing for an empty session', () => {
    expect(placeSteps([])).toEqual([]);
  });
});

describe('totalActiveMs', () => {
  it('is the last step position', () => {
    expect(totalActiveMs(placeSteps([step({ activeMs: 1_000 }), step({ activeMs: 250 })]))).toBe(
      1_250,
    );
  });

  it('is 0 for an empty session', () => {
    expect(totalActiveMs([])).toBe(0);
  });
});

describe('gapHeight', () => {
  it('never collapses a gap below the minimum', () => {
    expect(gapHeight(0)).toBe(MIN_GAP_PX);
  });

  it('caps at the maximum so a long pause stays on screen', () => {
    expect(gapHeight(GAP_SCALE_MS)).toBeCloseTo(MAX_GAP_PX);
    expect(gapHeight(45 * 60_000)).toBeCloseTo(MAX_GAP_PX);
  });

  it('grows with dwell', () => {
    expect(gapHeight(5_000)).toBeGreaterThan(gapHeight(500));
  });

  // Why sqrt: on a linear scale, a sub-second gap next to a 15s one is an invisible sliver,
  // and short gaps are what tell you two events were a single gesture.
  it('keeps a short gap visible next to a long one', () => {
    expect(gapHeight(400)).toBeGreaterThan(MIN_GAP_PX + 10);
  });

  it('floors a negative dwell rather than producing NaN', () => {
    expect(gapHeight(-100)).toBe(MIN_GAP_PX);
  });
});

describe('formatMs', () => {
  it.each([
    [0, '0ms'],
    [1, '1ms'],
    [999, '999ms'],
    [1_000, '1.0s'],
    [6_507, '6.5s'],
    [59_999, '60.0s'],
    [60_000, '1m 0s'],
    [125_000, '2m 5s'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(formatMs(ms)).toBe(expected);
  });
});

describe('kindOf', () => {
  it.each([
    ['ux.click', 'click', 'click'],
    ['ux.route_change', 'navigate', 'route'],
    ['ux.form_submit', 'submit', 'submit'],
    ['ux.form_abandon', 'abandon', 'abandon'],
  ])('maps %s to %s', (eventName, label, kind) => {
    expect(kindOf(step({ eventName }))).toEqual({ label, kind });
  });

  it('uses a custom event name verbatim as its own label', () => {
    expect(kindOf(step({ eventName: 'checkout.completed' }))).toEqual({
      label: 'checkout.completed',
      kind: 'custom',
    });
  });
});
