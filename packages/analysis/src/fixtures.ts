// packages/analysis/src/fixtures.ts
// Fixture traces for the pure analysis layer. Kept in src (not a test file) so the collector
// and dashboard can reuse them for a zero-backend demo later.
import type { UxEvent } from 'rastro-core';
import { SEVERITY_INFO, UX_CONVENTION_VERSION } from 'rastro-core';

export interface EventOverrides {
  eventName?: string;
  sessionId?: string;
  seq?: number;
  fingerprint?: string;
  route?: string;
  activeMs?: number;
  app?: string;
  interactionMethod?: 'mouse' | 'keyboard' | 'touch';
}

/** Build one conforming UxEvent. Every Required attribute gets a default. */
export function makeEvent(overrides: EventOverrides = {}): UxEvent {
  const {
    eventName = 'ux.click',
    sessionId = 'session-a',
    seq = 1,
    fingerprint = 'App>Button|button|"Go"',
    route = '/',
    activeMs,
    app = 'fixture-app',
    interactionMethod,
  } = overrides;

  return {
    eventName,
    timeUnixNano: String(1_730_300_000_000_000_000n + BigInt(seq) * 1_000_000_000n),
    severityNumber: SEVERITY_INFO,
    attributes: {
      'session.id': sessionId,
      'url.path': route,
      'ux.event_id': `${sessionId}-${seq}`,
      'ux.seq': seq,
      'ux.fingerprint': fingerprint,
      'ux.anonymous_id': 'anon-1',
      ...(activeMs === undefined ? {} : { 'ux.active_ms': activeMs }),
      ...(interactionMethod === undefined
        ? {}
        : { 'ux.interaction.method': interactionMethod }),
    },
    resource: {
      'service.name': app,
      'ux.convention.version': UX_CONVENTION_VERSION,
    },
  };
}
