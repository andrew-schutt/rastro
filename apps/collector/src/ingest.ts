// apps/collector/src/ingest.ts
// POST /v1/logs — accept OTLP logs, assign observedTime, insert (docs/DESIGN.md §19.4 step 1).
import type { FastifyInstance } from 'fastify';
import type { AnyValue, AttributeValue, EventStore, UxEvent } from 'rastro-core';
import { decodeOtlpLogs as decodeRecords, isUxEvent } from 'rastro-core';

/**
 * Narrow a decoded value to what a `UxEvent` attribute may hold.
 *
 * The shared codec carries maps and mixed arrays because analysis output will need them
 * (docs/CONSUMERS.md). Interactions do not, and the capture contract has never admitted them,
 * so they are dropped here exactly as the old decoder dropped them. Widening what an
 * interaction may carry is a conventions change, not a side effect of a codec change.
 */
function toAttributeValue(value: AnyValue): AttributeValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  return undefined;
}

function narrow(source: Record<string, AnyValue>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(source)) {
    const narrowed = toAttributeValue(value);
    if (narrowed !== undefined) out[key] = narrowed;
  }
  return out;
}

export interface DecodeResult {
  events: UxEvent[];
  /** Records that arrived but did not carry the Required set. Counted, never stored. */
  rejected: number;
}

/**
 * Unwrap `resourceLogs → scopeLogs → logRecords` back into flat `UxEvent`s and stamp
 * `observedTimeUnixNano`.
 *
 * The server clock is the authority for arrival because user clocks are skewed and wrong
 * (§4.5) — but note it is only a tiebreaker for *display*. `ux.seq` remains the sole
 * authority for ordering within a session.
 */
export function decodeOtlpLogs(payload: unknown, observedTimeUnixNano: string): DecodeResult {
  const events: UxEvent[] = [];
  let rejected = 0;

  for (const record of decodeRecords(payload)) {
    const candidate = {
      eventName: record.eventName,
      timeUnixNano: record.timeUnixNano,
      // Assigned here, never trusted from the client.
      observedTimeUnixNano,
      severityNumber: record.severityNumber,
      attributes: narrow(record.attributes),
      resource: narrow(record.resource),
    };

    if (isUxEvent(candidate)) events.push(candidate);
    else rejected += 1;
  }

  return { events, rejected };
}

export function registerIngest(app: FastifyInstance, store: EventStore): void {
  app.post('/v1/logs', async (request, reply) => {
    const observedTimeUnixNano = `${Date.now()}000000`;
    const { events, rejected } = decodeOtlpLogs(request.body, observedTimeUnixNano);

    await store.insert(events);

    if (rejected > 0) {
      request.log.warn(
        { rejected },
        'dropped records missing the Required set (docs/SEMANTIC-CONVENTIONS.md)',
      );
    }

    // OTLP's partial-success shape: accepted, with a count of what was dropped.
    return reply.code(200).send({
      partialSuccess: rejected === 0 ? {} : { rejectedLogRecords: String(rejected) },
    });
  });
}
