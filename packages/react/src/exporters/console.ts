// packages/react/src/exporters/console.ts
// Zero-backend local dev (§19.6): clone the repo, run the example, see records in the
// console. No services required.
import type { Exporter, UxEvent } from 'rastro-core';

export interface ConsoleExporterOptions {
  /** Log each record on its own line instead of one grouped table. */
  verbose?: boolean;
}

export const consoleExporter = ({ verbose = false }: ConsoleExporterOptions = {}): Exporter => ({
  export: (batch: UxEvent[]): void => {
    if (batch.length === 0) return;

    if (verbose) {
      for (const event of batch) console.log('[rastro]', event.eventName, event.attributes);
      return;
    }

    // The flat view is what you actually want while eyeballing fingerprints for false
    // merges/splits during development (§4.2.1).
    console.table(
      batch.map((event) => ({
        seq: event.attributes['ux.seq'],
        event: event.eventName,
        fingerprint: event.attributes['ux.fingerprint'],
        path: event.attributes['url.path'],
        activeMs: event.attributes['ux.active_ms'] ?? '',
        session: event.attributes['session.id'],
      })),
    );
  },
});
