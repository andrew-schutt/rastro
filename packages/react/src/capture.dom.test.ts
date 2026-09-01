/**
 * @vitest-environment jsdom
 *
 * packages/react/src/capture.dom.test.ts
 * The DOM wiring of startCapture: listener registration, target resolution, and the
 * interaction between clicks, focus, and the form lifecycle. The pure logic these sit on top
 * of is tested without a DOM in capture.test.ts, dwell.test.ts, and forms.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UxEvent } from 'rastro-core';
import { createSessionState, startCapture } from './capture.js';

/** A click carrying a pointerType, which jsdom has no PointerEvent to provide. */
function pointerClick(element: Element, pointerType = 'mouse'): void {
  const event = new MouseEvent('click', { bubbles: true, detail: 1 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  element.dispatchEvent(event);
}

/** Enter/Space on a control: a real click whose detail is 0 and pointerType is empty. */
function keyboardClick(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
}

describe('startCapture', () => {
  let events: UxEvent[];
  let stop: () => void;

  const names = (): string[] => events.map((event) => event.eventName);
  const last = (): UxEvent => {
    const event = events.at(-1);
    if (event === undefined) throw new Error('no events captured');
    return event;
  };

  const el = (id: string): Element => {
    const found = document.getElementById(id);
    if (found === null) throw new Error(`missing #${id}`);
    return found;
  };

  beforeEach(() => {
    history.replaceState({}, '', '/');
    document.body.innerHTML = `
      <nav><button id="nav-orders" type="button">Orders</button></nav>
      <button id="save"><span id="label">Save</span></button>
      <div id="inert">just text</div>
      <div id="tagged" data-telemetry-id="custom-widget">widget</div>
      <form id="settings">
        <input id="email" name="email" />
        <button id="submit" type="submit">Submit</button>
      </form>
    `;
    // jsdom has no navigation, so an unprevented submit logs a "not implemented" error.
    // Real apps preventDefault here too — the demo app does.
    el('settings').addEventListener('submit', (event) => event.preventDefault());

    events = [];
    stop = startCapture({
      state: createSessionState('test-app'),
      onEvent: (event) => events.push(event),
    });
  });

  afterEach(() => stop());

  describe('ux.click', () => {
    it('captures a click on a button', () => {
      pointerClick(el('save'));

      expect(names()).toEqual(['ux.click']);
      expect(last().attributes['ux.interaction.method']).toBe('mouse');
    });

    it('resolves a click on an inner span up to the button', () => {
      // A click almost always lands on a child, not the control itself.
      pointerClick(el('label'));

      // No React render here, so the chain degrades; the role and name are real.
      expect(last().attributes['ux.fingerprint']).toBe('unknown|button|"Save"');
    });

    it('drops a click on inert background', () => {
      pointerClick(el('inert'));

      expect(events).toHaveLength(0);
    });

    it('captures a click on a non-interactive element carrying data-telemetry-id', () => {
      pointerClick(el('tagged'));

      expect(last().attributes['ux.fingerprint']).toBe('id:custom-widget');
    });

    it('classifies keyboard activation as keyboard, not mouse', () => {
      keyboardClick(el('save'));

      expect(last().attributes['ux.interaction.method']).toBe('keyboard');
    });

    it('classifies a touch tap', () => {
      pointerClick(el('save'), 'touch');

      expect(last().attributes['ux.interaction.method']).toBe('touch');
    });

    it('assigns a monotonic ux.seq across every event type', () => {
      pointerClick(el('save'));
      history.pushState({}, '', '/orders');
      pointerClick(el('save'));

      expect(events.map((event) => event.attributes['ux.seq'])).toEqual([1, 2, 3]);
    });
  });

  describe('ux.route_change', () => {
    it('fires on pushState, carrying ux.from_path', () => {
      history.pushState({}, '', '/users/42/settings');

      expect(names()).toEqual(['ux.route_change']);
      expect(last().attributes['url.path']).toBe('/users/:id/settings');
      expect(last().attributes['ux.from_path']).toBe('/');
    });

    it('does not fire when the path did not actually change', () => {
      // A replaceState that only swaps query state should not read as navigation.
      history.replaceState({}, '', '/');

      expect(events).toHaveLength(0);
    });
  });

  describe('forms', () => {
    it('emits ux.form_submit after focus entered the form', () => {
      el('email').dispatchEvent(new Event('focusin', { bubbles: true }));
      el('settings').dispatchEvent(new Event('submit', { bubbles: true }));

      expect(names()).toEqual(['ux.form_submit']);
      // A container takes no name from its own text, so the form's identity does not move
      // when the copy inside it changes.
      expect(last().attributes['ux.fingerprint']).toBe('unknown|form');
    });

    it('emits ux.form_abandon when a click lands outside the form', () => {
      el('email').dispatchEvent(new Event('focusin', { bubbles: true }));
      pointerClick(el('nav-orders'));

      // The abandon is emitted before the click that caused it.
      expect(names()).toEqual(['ux.form_abandon', 'ux.click']);
    });

    it('does NOT emit a false abandon when clicking submit inside the form', () => {
      // Clicking a submit button fires the form's own submit event, exactly as a browser
      // does — so this is the real sequence, and the one a focusout-based rule got wrong by
      // emitting an abandon between the click and the submit.
      el('email').dispatchEvent(new Event('focusin', { bubbles: true }));
      pointerClick(el('submit'));

      expect(names()).toEqual(['ux.click', 'ux.form_submit']);
    });

    it('abandons a half-filled form on navigation', () => {
      el('email').dispatchEvent(new Event('focusin', { bubbles: true }));
      history.pushState({}, '', '/orders');

      expect(names()).toEqual(['ux.form_abandon', 'ux.route_change']);
    });

    it('abandons a half-filled form on pagehide — the §4.4 signal', () => {
      el('email').dispatchEvent(new Event('focusin', { bubbles: true }));
      window.dispatchEvent(new Event('pagehide'));

      expect(names()).toEqual(['ux.form_abandon']);
    });
  });

  describe('teardown', () => {
    it('stops capturing after the returned function is called', () => {
      stop();

      pointerClick(el('save'));
      history.pushState({}, '', '/gone');
      window.dispatchEvent(new Event('pagehide'));

      expect(events).toHaveLength(0);
    });
  });
});
