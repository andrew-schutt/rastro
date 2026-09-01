/**
 * @vitest-environment jsdom
 *
 * packages/react/src/route.dom.test.ts
 * The history patch is shared process-wide (there is one `history` per window), so these
 * assert the reference counting as much as the notification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { historyRouteAdapter } from './route.js';

describe('historyRouteAdapter', () => {
  let pristinePushState: typeof history.pushState;

  beforeEach(() => {
    pristinePushState = history.pushState;
    history.replaceState({}, '', '/');
  });

  afterEach(() => {
    history.pushState = pristinePushState;
  });

  it('reports the current pathname', () => {
    history.replaceState({}, '', '/settings');

    expect(historyRouteAdapter().current()).toBe('/settings');
  });

  it('notifies on pushState, with the DESTINATION path', () => {
    const onChange = vi.fn();
    const unsubscribe = historyRouteAdapter().subscribe(onChange);

    history.pushState({}, '', '/users/42');

    // Notifying before the call would report the origin — the bug this ordering avoids.
    expect(onChange).toHaveBeenCalledWith('/users/42');
    unsubscribe();
  });

  it('notifies on replaceState', () => {
    const onChange = vi.fn();
    const unsubscribe = historyRouteAdapter().subscribe(onChange);

    history.replaceState({}, '', '/orders');

    expect(onChange).toHaveBeenCalledWith('/orders');
    unsubscribe();
  });

  it('notifies on popstate', () => {
    const onChange = vi.fn();
    const unsubscribe = historyRouteAdapter().subscribe(onChange);

    history.replaceState({}, '', '/back');
    onChange.mockClear();
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onChange).toHaveBeenCalledWith('/back');
    unsubscribe();
  });

  it('restores the original history methods on the last unsubscribe', () => {
    const original = history.pushState;
    const unsubscribe = historyRouteAdapter().subscribe(() => {});

    expect(history.pushState).not.toBe(original);

    unsubscribe();

    expect(history.pushState).toBe(original);
  });

  it('stops notifying after unsubscribe', () => {
    const onChange = vi.fn();
    historyRouteAdapter().subscribe(onChange)();

    history.pushState({}, '', '/after');

    expect(onChange).not.toHaveBeenCalled();
  });

  // The bug the reference counting exists to prevent: a per-adapter patch would let the
  // first unsubscribe restore the pre-patch original and go deaf for everyone else. React
  // StrictMode's mount/unmount/remount hits exactly this.
  it('keeps the second subscriber working when the first unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = historyRouteAdapter().subscribe(first);
    const unsubscribeSecond = historyRouteAdapter().subscribe(second);

    unsubscribeFirst();
    history.pushState({}, '', '/still-listening');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('/still-listening');
    unsubscribeSecond();
  });

  it('does not stack patches when two adapters subscribe', () => {
    const onChange = vi.fn();
    const a = historyRouteAdapter().subscribe(onChange);
    const b = historyRouteAdapter().subscribe(() => {});

    history.pushState({}, '', '/once');

    expect(onChange).toHaveBeenCalledTimes(1);
    a();
    b();
  });
});
