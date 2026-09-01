// apps/collector/src/session.ts
// GET /projects/:app/sessions/:id — one session's events (docs/DESIGN.md §13.1).
//
// The easiest real view, and a high-value early one: no cross-session aggregation, no mining,
// no spaghetti-taming. Just one session's events sorted by `ux.seq`. It reuses `sessionize`
// restricted to a single id, so no new analysis primitive is required.
import type { FastifyInstance } from 'fastify';
import type { EventStore, Session, UxEvent } from 'rastro-core';
import { sessionize } from 'rastro-analysis';

export interface SessionResponse {
  app: string;
  session: Session;
  /** The raw records, so the timeline can show attributes `Step` deliberately drops. */
  events: UxEvent[];
}

export function registerSession(app: FastifyInstance, store: EventStore): void {
  app.get<{ Params: { app: string; id: string } }>(
    '/projects/:app/sessions/:id',
    async (request, reply) => {
      const { app: appName, id } = request.params;
      const events = await store.listBySession(appName, id);

      if (events.length === 0) {
        return reply.code(404).send({ error: `no events for session ${id} in app ${appName}` });
      }

      // Single group in, single Session out.
      const [session] = sessionize(events);

      return reply.send({ app: appName, session, events });
    },
  );

  /**
   * Not in §19.1. Added because §19.4 step 1 needs "a dashboard that renders stored events as
   * a plain table" and nothing in the documented API returns them. It is also what makes the
   * session ids discoverable so you can click through to the timeline.
   */
  app.get<{ Params: { app: string }; Querystring: { limit?: string } }>(
    '/projects/:app/events',
    async (request, reply) => {
      const limit = Number(request.query.limit ?? '200');
      const events = await store.listByApp(
        request.params.app,
        Number.isFinite(limit) ? limit : 200,
      );
      return reply.send({ app: request.params.app, events });
    },
  );
}
