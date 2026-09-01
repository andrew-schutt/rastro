// packages/react/src/transport.ts
// Batching + the flush lifecycle (docs/DESIGN.md §4.4, §19.6).
//
// This sits ABOVE the Exporter seam, generic and shared: the exporter only answers "deliver
// this batch, and in whose shape", so swapping destinations never re-opens delivery
// reliability. §4.4 is blunt about the stakes — the most valuable events (form abandonment,
// exit, drop-off) fire exactly as the page tears down, and a normal fetch is killed
// mid-flight on unload. Get this wrong and you silently lose your flagship friction data.
import type { Exporter, UxEvent } from 'rastro-core';

export interface TransportOptions {
  exporter: Exporter;
  /** Flush once the queue reaches this many events. */
  maxBatchSize?: number;
  /** Flush at least this often, in ms. */
  flushIntervalMs?: number;
}

export interface Transport {
  /** Queue one event. Flushes immediately if the batch is full. Always accepted. */
  enqueue(event: UxEvent): void;
  /** Drain the queue to the exporter. Safe to call with an empty queue. */
  flush(): Promise<void>;
  /**
   * Attach the flush timer and the page-lifecycle listeners. Idempotent, and safe to call
   * again after `stop()` — React StrictMode mounts, unmounts, and remounts every effect in
   * development, so a transport that could only be started once would go deaf after the
   * first remount.
   */
  start(): void;
  /** Detach listeners and timers, flushing whatever is left. Does not discard the queue. */
  stop(): Promise<void>;
}

export const DEFAULT_MAX_BATCH_SIZE = 20;
export const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export function createTransport({
  exporter,
  maxBatchSize = DEFAULT_MAX_BATCH_SIZE,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
}: TransportOptions): Transport {
  let queue: UxEvent[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;

  const flush = async (): Promise<void> => {
    if (queue.length === 0) return;

    // Take the whole queue before awaiting, so events arriving mid-export are not lost or
    // double-sent.
    const batch = queue;
    queue = [];

    try {
      await exporter.export(batch);
    } catch (error) {
      // TODO(§4.4): retry with backoff, and re-queue rather than drop. `ux.event_id` already
      // makes retries idempotent — the collector collapses duplicates on it — so the only
      // missing piece is the backoff schedule and a cap on queue growth while offline.
      console.warn('[rastro] export failed, dropping batch of', batch.length, error);
    }
  };

  const enqueue = (event: UxEvent): void => {
    queue.push(event);
    if (queue.length >= maxBatchSize) void flush();
  };

  // The only reliable "user is leaving" signal on mobile Safari (§4.4). `pagehide` covers the
  // bfcache path that `visibilitychange` alone misses.
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'hidden') return;
    void flush();
  };
  const onPageHide = (): void => void flush();

  const start = (): void => {
    if (timer !== undefined) return; // already started

    timer = setInterval(() => void flush(), flushIntervalMs);

    // §4.8: guarded so the provider is safe to render on the server, where neither exists.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide);
    }
  };

  // TODO(§4.4, §19.6): the unload flush currently relies on the exporter's own keepalive.
  // `navigator.sendBeacon` is the only send that reliably survives teardown, but it is
  // destination-specific and the one-method `Exporter` interface has no way to express it.
  // Resolving that — probably an optional `exportOnUnload?(batch)` on the seam — is the real
  // §4.4 work. `sendBeaconOtlp` in exporters/otlp.ts is the piece waiting to be wired in.

  const stop = async (): Promise<void> => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide);
    }
    await flush();
  };

  return { enqueue, flush, start, stop };
}
