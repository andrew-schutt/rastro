// packages/react/src/capture.test.ts
// `sanitizeProps` and `buildEvent` are pure, so they test without a DOM or a renderer.
import { describe, expect, it, vi } from 'vitest';
import { REDACTED, noopRedactor } from 'rastro-core';
import {
  buildEvent,
  createSessionState,
  interactionMethodOf,
  sanitizeProps,
} from './capture.js';

describe('sanitizeProps', () => {
  it('passes ordinary props through as attributes', () => {
    expect(sanitizeProps({ plan: 'pro', seats: 3, trial: false })).toEqual({
      plan: 'pro',
      seats: 3,
      trial: false,
    });
  });

  it('redacts an email in a string prop — the leak this closes', () => {
    expect(sanitizeProps({ owner: 'jane@x.com' })).toEqual({ owner: REDACTED });
  });

  it('redacts long digit runs in a string prop', () => {
    expect(sanitizeProps({ note: 'card 4111111111111111' })).toEqual({
      note: `card ${REDACTED}`,
    });
  });

  it('returns an empty object for no props', () => {
    expect(sanitizeProps(undefined)).toEqual({});
  });

  it('honours a swapped-in Redactor', () => {
    expect(sanitizeProps({ owner: 'jane@x.com' }, noopRedactor)).toEqual({
      owner: 'jane@x.com',
    });
  });

  describe('reserved namespaces', () => {
    it.each(['session.id', 'url.path', 'service.name', 'ux.seq'])('drops %s', (key) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(sanitizeProps({ [key]: 'hijacked' })).toEqual({});
      expect(warn).toHaveBeenCalledOnce();

      warn.mockRestore();
    });

    it('keeps app-namespaced props that merely resemble a reserved one', () => {
      expect(sanitizeProps({ sessionId: 'ok', myapp: 'ok' })).toEqual({
        sessionId: 'ok',
        myapp: 'ok',
      });
    });
  });
});

describe('buildEvent', () => {
  const state = () => createSessionState('test-app');

  it('tokenizes the route before it reaches url.path', () => {
    const event = buildEvent(state(), {
      eventName: 'ux.click',
      fingerprint: 'id:x',
      route: '/users/john@example.com/settings',
    });

    expect(event.attributes['url.path']).toBe('/users/:id/settings');
  });

  it('redacts the accessible name', () => {
    const event = buildEvent(state(), {
      eventName: 'ux.click',
      fingerprint: 'id:x',
      route: '/',
      accessibleName: 'Delete account for jane@x.com',
    });

    expect(event.attributes['ux.accessible_name']).toBe(`Delete account for ${REDACTED}`);
  });

  it('carries the source file through unredacted, unlike the accessible name', () => {
    const event = buildEvent(state(), {
      eventName: 'ux.click',
      fingerprint: 'App>Card@src/billing/Card2024.tsx|button|"Edit"',
      route: '/',
      sourceFile: 'src/billing/Card2024.tsx',
    });

    // A repo-relative path is authored by a developer, never by a user, and it is already on
    // the wire inside the Required fingerprint. Redacting it would mangle `Card2024` on the
    // default 4-digit rule while protecting nobody.
    expect(event.attributes['ux.source_file']).toBe('src/billing/Card2024.tsx');
  });

  it('omits ux.source_file entirely when there is no file to report', () => {
    const event = buildEvent(state(), {
      eventName: 'ux.click',
      fingerprint: 'App|button|"Edit"',
      route: '/',
    });

    expect('ux.source_file' in event.attributes).toBe(false);
  });

  it('carries custom attributes alongside the Required set', () => {
    const event = buildEvent(state(), {
      eventName: 'checkout.completed',
      fingerprint: 'id:checkout.completed',
      route: '/',
      attributes: { plan: 'pro' },
    });

    expect(event.attributes['plan']).toBe('pro');
    expect(event.attributes['ux.seq']).toBe(1);
  });

  it('never lets a custom attribute overwrite the Required set', () => {
    const event = buildEvent(state(), {
      eventName: 'evil',
      fingerprint: 'id:evil',
      route: '/',
      // sanitizeProps would have dropped this; buildEvent must not depend on that.
      attributes: { 'ux.seq': 999, 'session.id': 'hijacked' },
    });

    expect(event.attributes['ux.seq']).toBe(1);
    expect(event.attributes['session.id']).not.toBe('hijacked');
  });

  it('assigns a monotonic ux.seq per session', () => {
    const shared = state();
    const first = buildEvent(shared, { eventName: 'a', fingerprint: 'id:a', route: '/' });
    const second = buildEvent(shared, { eventName: 'b', fingerprint: 'id:b', route: '/' });

    expect(first.attributes['ux.seq']).toBe(1);
    expect(second.attributes['ux.seq']).toBe(2);
    expect(first.attributes['session.id']).toBe(second.attributes['session.id']);
  });
});

describe('interactionMethodOf', () => {
  it('classifies a mouse click', () => {
    expect(interactionMethodOf({ detail: 1, pointerType: 'mouse' })).toBe('mouse');
  });

  it('classifies a touch tap', () => {
    expect(interactionMethodOf({ detail: 1, pointerType: 'touch' })).toBe('touch');
  });

  it('classifies a pen as touch — direct manipulation, and the enum has no third option', () => {
    expect(interactionMethodOf({ detail: 1, pointerType: 'pen' })).toBe('touch');
  });

  it('classifies keyboard activation by detail === 0, NOT by pointerType', () => {
    // Enter/Space on a button produces a real click whose pointerType is empty. Reading
    // pointerType first would label every keyboard user a mouse user.
    expect(interactionMethodOf({ detail: 0, pointerType: '' })).toBe('keyboard');
  });

  it('prefers keyboard even when a pointerType is somehow present', () => {
    expect(interactionMethodOf({ detail: 0, pointerType: 'mouse' })).toBe('keyboard');
  });

  it('omits the method rather than guessing when nothing identifies it', () => {
    expect(interactionMethodOf({ detail: 1 })).toBeUndefined();
    expect(interactionMethodOf({})).toBeUndefined();
  });
});

describe('buildEvent — route change', () => {
  it('tokenizes ux.from_path like url.path', () => {
    const event = buildEvent(createSessionState('test-app'), {
      eventName: 'ux.route_change',
      fingerprint: 'route:/users/:id',
      route: '/users/99',
      fromPath: '/orders/12345?token=secret',
    });

    expect(event.attributes['url.path']).toBe('/users/:id');
    expect(event.attributes['ux.from_path']).toBe('/orders/:id');
  });
});
