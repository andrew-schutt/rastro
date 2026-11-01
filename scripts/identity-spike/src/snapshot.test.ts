/**
 * @vitest-environment jsdom
 *
 * scripts/identity-spike/src/snapshot.test.ts
 * The DOM half of continuity.ts: which elements a snapshot counts.
 */
import { describe, expect, it } from 'vitest';
import { snapshotDocument } from './continuity.js';

describe('snapshotDocument', () => {
  // The spike once carried its own, narrower selector. These are the kinds it missed, each an
  // element capture emits events for, so a snapshot without them measures fewer elements than
  // Rastro identifies.
  it('counts every kind of element capture emits events for', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <button data-el="button"></button>
      <label data-el="label">Remember me</label>
      <details><summary data-el="summary">More</summary></details>
      <div data-telemetry-id="hero" data-el="override"></div>
      <div role="radio" data-el="radio"></div>
      <div role="menuitemcheckbox" data-el="menuitemcheckbox"></div>
      <div tabindex="0" data-el="tabbable"></div>
      <div tabindex="-1" data-el="not-tabbable"></div>
      <div data-el="inert"></div>
    `;
    const counted = snapshotDocument(root, () => 'fp', { oracleAttribute: 'data-el' }).map((entry) => entry.element);
    expect(counted).toEqual(['button', 'label', 'summary', 'override', 'radio', 'menuitemcheckbox', 'tabbable']);
  });
});
