// packages/analysis/src/sessionize.test.ts
import { describe, expect, it } from 'vitest';
import { makeEvent } from './fixtures.js';
import { sessionize } from './sessionize.js';

describe('sessionize', () => {
  // Deliberately shuffled and interleaved: two sessions, neither in ux.seq order, and
  // session-b's records appear before some of session-a's.
  const events = [
    makeEvent({ sessionId: 'session-a', seq: 3, fingerprint: 'App>Save|button|"Save"', route: '/settings/:id', activeMs: 4200, interactionMethod: 'keyboard' }),
    makeEvent({ sessionId: 'session-b', seq: 2, fingerprint: 'App>Buy|button|"Buy"', route: '/cart' }),
    makeEvent({ sessionId: 'session-a', seq: 1, fingerprint: 'App>Home|a|"Home"', route: '/', activeMs: 900 }),
    makeEvent({ sessionId: 'session-b', seq: 1, fingerprint: 'App>Cart|a|"Cart"', route: '/', activeMs: 150 }),
    makeEvent({ sessionId: 'session-a', seq: 2, fingerprint: 'App>Settings|a|"Settings"', route: '/', activeMs: 1100 }),
  ];

  it('groups events by session.id', () => {
    const sessions = sessionize(events);

    expect(sessions.map((s) => s.sessionId)).toEqual(['session-a', 'session-b']);
    expect(sessions[0]?.steps).toHaveLength(3);
    expect(sessions[1]?.steps).toHaveLength(2);
  });

  it('orders steps by ux.seq, not by input order or timestamp', () => {
    const [sessionA] = sessionize(events);

    expect(sessionA?.steps.map((step) => step.seq)).toEqual([1, 2, 3]);
    expect(sessionA?.steps.map((step) => step.fingerprint)).toEqual([
      'App>Home|a|"Home"',
      'App>Settings|a|"Settings"',
      'App>Save|button|"Save"',
    ]);
  });

  it('flattens the OTel attributes into a Step', () => {
    const [sessionA] = sessionize(events);

    expect(sessionA?.steps[2]).toEqual({
      eventName: 'ux.click',
      fingerprint: 'App>Save|button|"Save"',
      route: '/settings/:id',
      seq: 3,
      activeMs: 4200,
      interactionMethod: 'keyboard',
    });
  });

  it('defaults activeMs to 0 — ux.active_ms is Recommended, not Required', () => {
    const [, sessionB] = sessionize(events);

    expect(sessionB?.steps[1]?.activeMs).toBe(0);
  });

  it('carries eventName through, so a timeline can tell a click from a navigation', () => {
    const mixed = [
      makeEvent({ sessionId: 's', seq: 1, eventName: 'ux.click' }),
      makeEvent({ sessionId: 's', seq: 2, eventName: 'ux.route_change' }),
      makeEvent({ sessionId: 's', seq: 3, eventName: 'checkout.completed' }),
    ];

    expect(sessionize(mixed)[0]?.steps.map((step) => step.eventName)).toEqual([
      'ux.click',
      'ux.route_change',
      'checkout.completed',
    ]);
  });

  it('omits interactionMethod when it was never observed, rather than inventing one', () => {
    const [session] = sessionize([makeEvent({ sessionId: 's', seq: 1 })]);
    const step = session?.steps[0];

    expect(step && 'interactionMethod' in step).toBe(false);
  });

  it('returns no sessions for no events', () => {
    expect(sessionize([])).toEqual([]);
  });

  it('handles the single-session case used by GET /projects/:app/sessions/:id', () => {
    const oneSession = events.filter((e) => e.attributes['session.id'] === 'session-a');
    const sessions = sessionize(oneSession);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('session-a');
  });
});
