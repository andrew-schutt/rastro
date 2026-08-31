// packages/react/src/dwell.test.ts
import { describe, expect, it } from 'vitest';
import { MAX_DWELL_MS, cappedDwell, createActiveClock } from './dwell.js';

/** A hand-cranked clock, so these assert behaviour rather than race a real timer. */
function fakeNow(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('createActiveClock', () => {
  it('accrues time while visible', () => {
    const time = fakeNow();
    const clock = createActiveClock({ now: time.now, visible: true });

    time.advance(500);

    expect(clock.elapsed()).toBe(500);
  });

  it('stops accruing while hidden — the §4.5 correctness bug', () => {
    const time = fakeNow();
    const clock = createActiveClock({ now: time.now, visible: true });

    time.advance(200);
    clock.setVisible(false);
    time.advance(10_000); // user is on another tab for ten seconds
    clock.setVisible(true);
    time.advance(300);

    expect(clock.elapsed()).toBe(500);
  });

  it('reports zero for a clock that starts hidden and stays hidden', () => {
    const time = fakeNow();
    const clock = createActiveClock({ now: time.now, visible: false });

    time.advance(5_000);

    expect(clock.elapsed()).toBe(0);
  });

  it('is monotonic across several hide/show cycles', () => {
    const time = fakeNow();
    const clock = createActiveClock({ now: time.now, visible: true });
    const readings: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      time.advance(100);
      readings.push(clock.elapsed());
      clock.setVisible(false);
      time.advance(1_000);
      clock.setVisible(true);
      readings.push(clock.elapsed());
    }

    expect(readings).toEqual([100, 100, 200, 200, 300, 300]);
    expect([...readings].sort((a, b) => a - b)).toEqual(readings);
  });

  it('ignores a redundant visibility change', () => {
    const time = fakeNow();
    const clock = createActiveClock({ now: time.now, visible: true });

    time.advance(100);
    clock.setVisible(true); // already visible — must not restart the stretch
    time.advance(100);

    expect(clock.elapsed()).toBe(200);
  });
});

describe('cappedDwell', () => {
  it('passes an ordinary dwell through, rounded', () => {
    expect(cappedDwell(4200.4)).toBe(4200);
  });

  it('caps a walked-away-from-the-desk gap (§4.5)', () => {
    expect(cappedDwell(45 * 60_000)).toBe(MAX_DWELL_MS);
  });

  it('leaves a long pause below the cap intact, so §10 can still see it', () => {
    expect(cappedDwell(12_000)).toBe(12_000);
  });

  it('floors a negative dwell at 0 rather than emitting nonsense', () => {
    expect(cappedDwell(-5)).toBe(0);
  });

  it('handles a non-finite input', () => {
    expect(cappedDwell(Number.NaN)).toBe(0);
  });
});
