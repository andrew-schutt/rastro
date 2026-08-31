// packages/react/src/capture.test.ts
// `sanitizeProps` and `buildEvent` are pure, so they test without a DOM or a renderer.
import { describe, expect, it, vi } from 'vitest';
import { REDACTED, noopRedactor } from 'rastro-core';
import { buildEvent, createSessionState, sanitizeProps } from './capture.js';

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
