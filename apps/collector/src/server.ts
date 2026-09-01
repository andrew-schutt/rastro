// apps/collector/src/server.ts
// The only backend process: OTLP ingest AND the graph/session API, so there is one thing to
// run (docs/DESIGN.md §19.1).
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { EventStore } from 'rastro-core';
import { createSqliteEventStore } from './db.ts';
import { registerGraph } from './graph.ts';
import { registerIngest } from './ingest.ts';
import { registerSession } from './session.ts';

export const DEFAULT_PORT = 4318; // the OTLP/HTTP default, and what the README points at

export interface BuildServerOptions {
  store: EventStore;
  logger?: boolean;
}

export function buildServer({ store, logger = true }: BuildServerOptions): FastifyInstance {
  const app = Fastify({ logger });

  // `navigator.sendBeacon` with a string body sends `text/plain`, and that is the only send
  // that survives page teardown (§4.4) — so the unload path arrives here, not as JSON.
  app.addContentTypeParser(
    'text/plain',
    { parseAs: 'string' },
    (_request, body: string | Buffer, done) => {
      try {
        done(null, JSON.parse(body.toString()));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // Dev CORS: the demo app and the dashboard are on other origins during local development.
  // Hand-rolled rather than pulling in @fastify/cors for four headers.
  // TODO: this is wide open. Before anything but localhost, restrict the origin and add the
  // project key the plan assumes ("no auth beyond a project key", §19).
  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', request.headers.origin ?? '*');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
  });
  app.options('/*', async (_request, reply) => reply.code(204).send());

  app.get('/health', () => ({ ok: true }));

  registerIngest(app, store);
  registerSession(app, store);
  registerGraph(app, store);

  return app;
}

export async function start(): Promise<void> {
  const filename = process.env['RASTRO_DB'] ?? 'rastro.sqlite';
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const store = createSqliteEventStore({ filename });
  const app = buildServer({ store });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await store.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ filename }, 'rastro collector ready');
}

// Only start when run directly, so tests can import buildServer without binding a port.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await start();
}
