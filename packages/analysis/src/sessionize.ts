// packages/analysis/src/sessionize.ts
// UxEvent[] → Session[] (PLAN.md §19.3, §4.5). IMPLEMENTED.
//
// The OTel envelope stops here: downstream analysis works on the flat Step/Session types,
// never on raw records.
import type { Session, Step, UxEvent } from 'rastro-core';

// Re-exported so the import path documented in §19.3 holds, even though the declarations
// live in `rastro-core` (see packages/core/src/shapes.ts for why).
export type { Session, Step } from 'rastro-core';

/**
 * Group events by `session.id` and order each group by `ux.seq`.
 *
 * `ux.seq` is the sole authority for order (SEMANTIC-CONVENTIONS.md, "Ordering and
 * sessions"). Timestamps are for display and latency only — user clocks are skewed, and
 * ordering by them scrambles sequences (§4.5).
 *
 * Sessions are returned in the order their first event appears in `events`; steps within a
 * session are sorted ascending by `ux.seq`.
 */
export function sessionize(events: UxEvent[]): Session[] {
  const bySession = new Map<string, Step[]>();

  for (const event of events) {
    const { attributes } = event;
    const sessionId = attributes['session.id'];

    let steps = bySession.get(sessionId);
    if (steps === undefined) {
      steps = [];
      bySession.set(sessionId, steps);
    }

    steps.push({
      fingerprint: attributes['ux.fingerprint'],
      route: attributes['url.path'],
      seq: attributes['ux.seq'],
      // `ux.active_ms` is Recommended, not Required — a minimal conforming emitter omits it.
      // 0 keeps the Step shape total instead of pushing the optionality downstream.
      activeMs: attributes['ux.active_ms'] ?? 0,
    });
  }

  return [...bySession].map(([sessionId, steps]) => ({
    sessionId,
    steps: steps.sort((a, b) => a.seq - b.seq),
  }));
}
