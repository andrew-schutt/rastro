// scripts/identity-spike/corpus/browser.ts
// Drive Chrome over the DevTools Protocol, under CORPUS.md's run conditions.
//
// Raw CDP, not Playwright: Playwright is not part of this repo's stack, and the protocol
// covers everything the run conditions need. It also cannot leak "playwright" into the user
// agent, which Actual treats as a test mode.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOCALE, TIME_ZONE, VIEWPORT } from './conditions.ts';

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

type Params = Record<string, unknown>;
interface Message {
  id?: number;
  method?: string;
  params?: Params;
  result?: Params;
  error?: { message: string };
  sessionId?: string;
}

/** One WebSocket to the browser; sessions are multiplexed over it (CDP's flatten mode). */
class Connection {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (r: Params) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(message: Message) => void>();

  private readonly socket: WebSocket;

  // A plain field, not a parameter property: Node's type stripping cannot run those.
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) waiter?.reject(new Error(message.error.message));
        else waiter?.resolve(message.result ?? {});
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async open(url: string): Promise<Connection> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), { once: true });
    });
    return new Connection(socket);
  }

  /**
   * Every command has a deadline. A target that has stopped answering (a stuck main thread, a
   * service worker the browser idled out) would otherwise hang the runner with no error at all.
   */
  send(method: string, params: Params = {}, sessionId?: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<Params> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} got no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
    });
  }

  on(listener: (message: Message) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.socket.close();
  }
}

export interface Browser {
  version: string;
  userAgent: string;
  /**
   * `pending` lists requests still open, from the server's side. The server, not CDP, is the
   * source of truth: CDP reports a worker script's request starting on the page but its
   * completion on the worker, so the page would wait on it forever.
   */
  newPage: (options: PageOptions) => Promise<Page>;
  close: () => Promise<void>;
}

export interface Page {
  /** Navigate and wait until the page has settled, or the timeout passes. */
  goto: (url: string) => Promise<Settle>;
  /** Evaluate an expression in the page and return its JSON value. */
  evaluate: <T>(expression: string) => Promise<T>;
  /** Wait until the page settles after an action. */
  settle: () => Promise<Settle>;
  /** Wait until an in-page expression is truthy, or throw after the settle timeout. */
  waitFor: (expression: string, what: string) => Promise<void>;
  /** Click the centre of the first element matching the in-page expression. */
  click: (elementExpression: string) => Promise<void>;
  /** Type into the focused element. */
  type: (text: string) => Promise<void>;
  /** Uncaught exceptions and console errors so far, from the page and its workers. */
  errors: () => string[];
  /** A PNG of the viewport, for a failure someone has to look at. */
  screenshot: () => Promise<Buffer>;
  /** Every live worker, and whether the run conditions are installed in it. */
  workers: () => Promise<WorkerCheck[]>;
  close: () => Promise<void>;
}

export interface PageOptions {
  /** The run conditions, installed before any page script. The server installs them in workers. */
  init: string;
  pending?: () => string[];
  /**
   * Send every request to the network, past any service worker. For an app whose service worker
   * is a cache (Actual's precaches the app with its own fetch(), so a cached worker script would
   * run without the conditions). Never for one whose service worker IS the backend, as the
   * react-admin demo's Mock Service Worker is.
   */
  bypassServiceWorker: boolean;
}

/** A command this slow means its target is stuck. Fail, rather than hang. */
export const COMMAND_TIMEOUT_MS = 60_000;

/** A worker that does not answer in this long is recorded as unreachable. */
export const WORKER_CHECK_TIMEOUT_MS = 5_000;

export interface WorkerCheck {
  type: string;
  url: string;
  /**
   * `unreachable` when the worker did not answer, e.g. a service worker the browser stopped
   * while idle. That is not the same as answering without the conditions, which is a failure.
   */
  conditions: boolean | 'unreachable';
}

const WORKER_TYPES = new Set(['worker', 'shared_worker', 'service_worker']);

export interface Settle {
  settled: boolean;
  ms: number;
  /** Requests still open when a settle timed out. Empty when it settled. */
  pending?: string[];
}

/** Quiet this long, with no request in flight, counts as settled. A runtime knob, not a result. */
export const QUIET_MS = 1500;
export const SETTLE_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The user agent Chrome reports, with "Headless" removed. CORPUS.md requires only that it not
 * say Playwright; dropping Headless too keeps headless and headed runs indistinguishable to an
 * app that sniffs it.
 */
export function corpusUserAgent(reported: string): string {
  return reported.replace('HeadlessChrome', 'Chrome');
}

/** Marks DOM activity with performance.now(), which the frozen Date cannot stand in for. */
const SETTLE_PROBE = `(() => {
  if (globalThis.__rastroLastMutation !== undefined) return;
  globalThis.__rastroLastMutation = performance.now();
  const start = () => new MutationObserver(() => { globalThis.__rastroLastMutation = performance.now(); })
    .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

export async function launch(chromePath: string = process.env.CHROME ?? DEFAULT_CHROME): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'rastro-corpus-chrome-'));
  const chrome: ChildProcess = spawn(
    chromePath,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
      '--no-default-browser-check', `--lang=${LOCALE}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise<string>((resolve, reject) => {
    let buffered = '';
    chrome.stderr?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = buffered.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    chrome.once('exit', (code) => reject(new Error(`Chrome exited (${code}) before listening`)));
  });

  const connection = await Connection.open(endpoint);
  const version = await connection.send('Browser.getVersion');
  const userAgent = corpusUserAgent(String(version.userAgent));

  async function newPage({ init, pending = () => [], bypassServiceWorker }: PageOptions): Promise<Page> {
    // A fresh browser context per page: its own storage, so every load starts like a first visit.
    const { browserContextId } = await connection.send('Target.createBrowserContext');
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = String(sessionId);
    const send = (method: string, params: Params = {}) => connection.send(method, params, page);

    const errors: string[] = [];
    const workers = new Map<string, { type: string; url: string }>();
    const off = connection.on((message) => {
      if (message.method === 'Page.javascriptDialogOpening' && message.sessionId === page) {
        errors.push(`dialog (${String(message.params?.type)}): ${String(message.params?.message)}`);
        void connection.send('Page.handleJavaScriptDialog', { accept: false }, page).catch(() => {});
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails as { exception?: { description?: string }; text?: string };
        errors.push(details.exception?.description ?? details.text ?? 'exception');
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const args = message.params.args as { value?: unknown; description?: string }[];
        errors.push(
          args
            .map((arg) => (typeof arg.value === 'string' ? arg.value : (arg.description ?? JSON.stringify(arg.value) ?? '')))
            .join(' '),
        );
      }
      if (message.method === 'Target.attachedToTarget' && message.params !== undefined) {
        const child = message.params.sessionId as string;
        const info = message.params.targetInfo as { type: string; url: string };
        if (WORKER_TYPES.has(info.type)) {
          workers.set(child, { type: info.type, url: info.url });
          void connection.send('Runtime.enable', {}, child).catch(() => {});
          void connection.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, child).catch(() => {});
        }
      }
      if (message.method === 'Target.detachedFromTarget' && message.params !== undefined) {
        workers.delete(message.params.sessionId as string);
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: bypassServiceWorker });
    await send('Network.setUserAgentOverride', { userAgent, acceptLanguage: LOCALE });
    await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setLocaleOverride', { locale: LOCALE });
    await send('Emulation.setTimezoneOverride', { timezoneId: TIME_ZONE });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: SETTLE_PROBE });
    // Attach to workers to verify them, never to hold them: the server installs the conditions
    // as each worker script's first line (serve.ts says why holding deadlocks).
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

    async function evaluate<T>(expression: string): Promise<T> {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      const details = result.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      if (details !== undefined) throw new Error(details.exception?.description ?? details.text ?? 'evaluation failed');
      return (result.result as { value: T }).value;
    }

    async function settle(): Promise<Settle> {
      const started = Date.now();
      while (Date.now() - started < SETTLE_TIMEOUT_MS) {
        await sleep(250);
        const quiet = await evaluate<number>(
          `document.readyState === 'complete' && globalThis.__rastroLastMutation !== undefined
             ? performance.now() - globalThis.__rastroLastMutation : 0`,
        ).catch(() => 0);
        if (quiet >= QUIET_MS && pending().length === 0) return { settled: true, ms: Date.now() - started };
      }
      return { settled: false, ms: Date.now() - started, pending: pending() };
    }

    return {
      evaluate,
      settle,
      waitFor: async (expression, what) => {
        const started = Date.now();
        while (Date.now() - started < SETTLE_TIMEOUT_MS) {
          if (await evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
          await sleep(250);
        }
        throw new Error(`timed out waiting for ${what}`);
      },
      goto: async (url) => {
        await send('Page.navigate', { url });
        return settle();
      },
      click: async (elementExpression) => {
        const box = await evaluate<{ x: number; y: number } | null>(`(() => {
          const element = ${elementExpression};
          if (!element) return null;
          element.scrollIntoView({ block: 'center', inline: 'center' });
          const rect = element.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        if (box === null) throw new Error(`nothing to click: ${elementExpression}`);
        for (const type of ['mousePressed', 'mouseReleased']) {
          await send('Input.dispatchMouseEvent', { type, ...box, button: 'left', clickCount: 1 });
        }
      },
      type: async (text) => {
        await send('Input.insertText', { text });
      },
      errors: () => [...errors],
      screenshot: async () => Buffer.from(String((await send('Page.captureScreenshot', { format: 'png' })).data), 'base64'),
      workers: async () =>
        Promise.all(
          [...workers].map(async ([session, info]) => {
            const result = await connection
              .send('Runtime.evaluate', { expression: 'globalThis.__rastroCorpusConditions === true', returnByValue: true }, session, WORKER_CHECK_TIMEOUT_MS)
              .catch(() => undefined);
            if (result === undefined) return { ...info, conditions: 'unreachable' as const };
            return { ...info, conditions: (result.result as { value?: unknown } | undefined)?.value === true };
          }),
        ),
      close: async () => {
        off();
        await connection.send('Target.disposeBrowserContext', { browserContextId });
      },
    };
  }

  return {
    version: String(version.product),
    userAgent,
    newPage,
    close: async () => {
      await connection.send('Browser.close').catch(() => {});
      connection.close();
      await new Promise((resolve) => {
        if (chrome.exitCode !== null) resolve(undefined);
        else chrome.once('exit', resolve);
      });
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
