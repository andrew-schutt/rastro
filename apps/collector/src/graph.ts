// apps/collector/src/graph.ts
// GET /projects/:app/graph — load events → analysis (docs/PLAN.md §19.1).
//
// The whole spine in four lines: load events → sessionize → buildGraph → send. Everything
// interesting is in the pure analysis layer, which is the point of §19.3's shape.
import type { FastifyInstance } from 'fastify';
import type { EventStore } from 'rastro-core';
import { buildGraph, sessionize } from 'rastro-analysis';

/**
 * Cap on events loaded per graph request.
 *
 * TODO(§8): this is the honest limit of "store the record as JSON and read it all back".
 * Beyond this the aggregation belongs in the store — which is exactly the pressure toward
 * ClickHouse that §8 describes, not something to paper over with a bigger number.
 */
const MAX_EVENTS = 50_000;

export function registerGraph(app: FastifyInstance, store: EventStore): void {
  app.get<{ Params: { app: string }; Querystring: { minEdgeCount?: string } }>(
    '/projects/:app/graph',
    async (request, reply) => {
      const events = await store.listByApp(request.params.app, MAX_EVENTS);
      const sessions = sessionize(events);

      // §8's spaghetti-taming, exposed so the dashboard can dial it without a redeploy.
      const minEdgeCount = Number(request.query.minEdgeCount ?? '1');
      const graph = buildGraph(sessions, {
        minEdgeCount: Number.isFinite(minEdgeCount) && minEdgeCount > 0 ? minEdgeCount : 1,
      });

      return reply.send({
        app: request.params.app,
        sessions: sessions.length,
        events: events.length,
        graph,
      });
    },
  );
}
