// apps/collector/src/graph.ts
// GET /projects/:app/graph — load events → analysis (docs/PLAN.md §19.1). STUB.
//
// The route exists so the shape of the API is fixed and the dashboard can be written against
// it; the analysis behind it (`buildGraph`) is walking-skeleton step 5 (§19.4).
import type { FastifyInstance } from 'fastify';
import type { EventStore } from 'rastro-core';
import { buildGraph, sessionize } from 'rastro-analysis';

export function registerGraph(app: FastifyInstance, store: EventStore): void {
  app.get<{ Params: { app: string } }>('/projects/:app/graph', async (request, reply) => {
    const events = await store.listByApp(request.params.app, 10_000);
    const sessions = sessionize(events);

    try {
      return reply.send(buildGraph(sessions));
    } catch {
      // 501, not 500: this is a documented gap, not a failure. The dashboard renders the
      // events table until step 5 lands.
      return reply.code(501).send({
        error:
          'buildGraph is not implemented yet — walking-skeleton step 5 (docs/PLAN.md §19.4)',
        sessions: sessions.length,
        events: events.length,
      });
    }
  });
}
