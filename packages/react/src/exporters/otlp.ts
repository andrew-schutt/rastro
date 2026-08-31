// packages/react/src/exporters/otlp.ts
// The DEFAULT exporter (§19.6): post OTel records to any OTLP/HTTP endpoint — your own
// collector, a shared OTel Collector, or straight to a backend. No translation, because the
// events are already OTel records.
import type { Exporter, UxEvent } from 'rastro-core';
import { toOtlpLogs } from '../otlp.js';

export interface OtlpExporterOptions {
  /** e.g. `/v1/logs`, or `http://localhost:4318/v1/logs`. */
  endpoint: string;
  /** Extra headers (auth, project key). Ignored on the sendBeacon unload path — beacons carry none. */
  headers?: Record<string, string>;
}

export const otlpExporter = ({ endpoint, headers }: OtlpExporterOptions): Exporter => ({
  export: async (batch: UxEvent[]): Promise<void> => {
    if (batch.length === 0) return;
    const body = JSON.stringify(toOtlpLogs(batch));

    // §19.6 shows sendBeacon. We prefer fetch + keepalive for the normal path: beacons carry
    // no headers and report no status, so retry and auth are both impossible. transport.ts
    // falls back to `sendBeaconOtlp` below on the unload path, where fetch is unreliable (§4.4).
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      keepalive: true,
    }).then((response) => {
      if (!response.ok) {
        throw new Error(`otlpExporter: ${endpoint} responded ${response.status}`);
      }
    });
  },
});

/**
 * The unload-time path (§4.4): `navigator.sendBeacon` is the only send that reliably survives
 * page teardown, and form-abandonment / exit / drop-off — the most valuable signals — fire
 * exactly then.
 *
 * Note the Content-Type: a beacon with a string body sends `text/plain`, so the collector
 * must accept that too. It does; see apps/collector/src/server.ts.
 *
 * @returns false when the browser refused to queue the beacon (payload too large).
 */
export function sendBeaconOtlp(endpoint: string, batch: UxEvent[]): boolean {
  if (batch.length === 0) return true;
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
  return navigator.sendBeacon(endpoint, JSON.stringify(toOtlpLogs(batch)));
}
