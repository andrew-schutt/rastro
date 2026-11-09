// scripts/identity-spike/corpus/serve.ts
// Serve a built corpus app on localhost, as CORPUS.md says to.
//
// Actual needs cross-origin isolation (COOP/COEP) for SharedArrayBuffer, so its server sends
// both headers. Routes the build has no file for fall back to index.html, because both apps
// route on the client.
//
// Worker scripts get the run conditions prepended. A page-level injection never reaches a
// worker, and Actual builds its demo budget in one. Holding each worker over CDP until a
// script is evaluated in it deadlocks instead (a worker that has not started has no context to
// evaluate in), and it hung the react-admin demo's mock service worker. The browser says which
// requests are worker scripts, in `Sec-Fetch-Dest`, so the worker's own first line installs
// the conditions, with no timing involved.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.sqlite': 'application/octet-stream',
};

export interface ServeOptions {
  /** Send COOP `same-origin` and COEP `require-corp`. */
  crossOriginIsolated: boolean;
  /** Script prepended to every worker script served: dedicated, shared and service workers. */
  workerPrelude?: string;
}

/** `Sec-Fetch-Dest` values the browser sends for a worker's own script. */
export const WORKER_DESTINATIONS = new Set(['worker', 'sharedworker', 'serviceworker']);

export interface Served {
  url: string;
  /** Paths of responses not yet finished: what a page is still waiting on. */
  pending: () => string[];
  close: () => Promise<void>;
}

/** The file a request path names under `root`, or null when it escapes `root` or is missing. */
export function resolveRequest(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = normalize(join(root, decoded));
  if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) return null;
  if (!existsSync(path)) return null;
  const stats = statSync(path);
  if (stats.isFile()) return path;
  const index = join(path, 'index.html');
  return existsSync(index) ? index : null;
}

export async function serve(
  root: string,
  { crossOriginIsolated, workerPrelude }: ServeOptions,
): Promise<Served> {
  const open = new Map<object, string>();
  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    open.set(response, pathname);
    response.on('close', () => open.delete(response));
    const file = resolveRequest(root, pathname) ?? join(root, 'index.html');
    response.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    response.setHeader('cache-control', 'no-store');
    if (crossOriginIsolated) {
      response.setHeader('cross-origin-opener-policy', 'same-origin');
      response.setHeader('cross-origin-embedder-policy', 'require-corp');
    }
    const destination = request.headers['sec-fetch-dest'];
    if (workerPrelude !== undefined && typeof destination === 'string' && WORKER_DESTINATIONS.has(destination)) {
      response.end(`${workerPrelude}\n${readFileSync(file, 'utf8')}`);
      return;
    }
    createReadStream(file)
      .on('error', () => {
        response.statusCode = 404;
        response.end();
      })
      .pipe(response);
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    pending: () => [...open.values()],
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
