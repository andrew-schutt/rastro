// packages/react/src/exporters/multi.ts
// Fan-out (§19.6): your UX analysis AND an existing observability backend at once. Because
// the default is already OTLP, "bridge into existing observability" is not a special
// adapter — it is a second otlpExporter pointed at their collector.
import type { Exporter, UxEvent } from 'rastro-core';

/**
 * Fan a batch out to several exporters.
 *
 * §19.6's one-liner is `targets.forEach((t) => t.export(batch))` with a note to "add
 * per-target error isolation for prod". That isolation is here from the start: one failing
 * destination must never cost you the others, which is the entire reason someone reaches for
 * fan-out. Failures are logged and swallowed per target.
 */
export const multiExporter = (targets: Exporter[]): Exporter => ({
  export: async (batch: UxEvent[]): Promise<void> => {
    const results = await Promise.allSettled(targets.map(async (target) => target.export(batch)));

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[rastro] exporter failed:', result.reason);
      }
    }
  },
});
