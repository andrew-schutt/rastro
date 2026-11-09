// scripts/identity-spike/corpus/serve.test.ts
// The corpus server, on a directory written here.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveRequest, serve, type Served } from './serve.ts';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'corpus-serve-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(root, 'static'));
  writeFileSync(join(root, 'static', 'app.js'), 'console.log(1)');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveRequest', () => {
  it('resolves a file and a directory index', () => {
    expect(resolveRequest(root, '/static/app.js')).toBe(join(root, 'static', 'app.js'));
    expect(resolveRequest(root, '/')).toBe(join(root, 'index.html'));
  });

  it('refuses a path that climbs out of the root', () => {
    expect(resolveRequest(root, '/../../etc/passwd')).toBeNull();
    expect(resolveRequest(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
  });

  it('returns null for a client route, so the server can fall back to index.html', () => {
    expect(resolveRequest(root, '/budget')).toBeNull();
  });
});

describe('serve', () => {
  const get = async (served: Served, path: string) => {
    const response = await fetch(`${served.url}${path}`);
    return { response, body: await response.text() };
  };

  it('sends COOP and COEP when the app needs cross-origin isolation', async () => {
    const served = await serve(root, { crossOriginIsolated: true });
    try {
      const { response } = await get(served, '/static/app.js');
      expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
      expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
      expect(response.headers.get('content-type')).toContain('text/javascript');
    } finally {
      await served.close();
    }
  });

  it('sends neither when it does not', async () => {
    const served = await serve(root, { crossOriginIsolated: false });
    try {
      const { response } = await get(served, '/');
      expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
      expect(response.headers.get('cross-origin-embedder-policy')).toBeNull();
    } finally {
      await served.close();
    }
  });

  it('prepends the prelude to worker scripts only', async () => {
    const served = await serve(root, { crossOriginIsolated: false, workerPrelude: '/*prelude*/' });
    try {
      const asWorker = async (dest: string) =>
        (await fetch(`${served.url}/static/app.js`, { headers: { 'sec-fetch-dest': dest } })).text();
      expect(await asWorker('worker')).toBe('/*prelude*/\nconsole.log(1)');
      expect(await asWorker('sharedworker')).toBe('/*prelude*/\nconsole.log(1)');
      expect(await asWorker('serviceworker')).toBe('/*prelude*/\nconsole.log(1)');
      expect(await asWorker('script')).toBe('console.log(1)');
      expect((await get(served, '/static/app.js')).body).toBe('console.log(1)');
    } finally {
      await served.close();
    }
  });

  it('falls back to index.html for a client route', async () => {
    const served = await serve(root, { crossOriginIsolated: false });
    try {
      const { response, body } = await get(served, '/reports/net-worth');
      expect(response.status).toBe(200);
      expect(body).toContain('<title>app</title>');
    } finally {
      await served.close();
    }
  });
});
