// apps/collector/src/ingest.ts
// POST /v1/logs — accept OTLP logs, assign observedTime, insert (docs/DESIGN.md §19.4 step 1).
import type { FastifyInstance } from 'fastify';
import type { AnyValue, AttributeValue, EventStore, UxEvent } from 'rastro-core';
import {
  decodeOtlpLogs as decodeRecords,
  DERIVED_SCOPE_NAME,
  isDerivedScope,
  isUxEvent,
} from 'rastro-core';

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
  /** Every record refused, for OTLP's `rejectedLogRecords`. The sum of the two below. */
  rejected: number;
  /** Records that did not carry the Required set. Counted, never stored. */
  rejectedNonconforming: number;
  /**
   * Records under Rastro's own derived scope (docs/CONSUMERS.md, rule 1). Refused before the
   * Required-set check, so a finding that happens to carry every `ux.*` attribute is still
   * never counted as an interaction.
   */
  rejectedDerived: number;
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
  let rejectedNonconforming = 0;
  let rejectedDerived = 0;

  for (const record of decodeRecords(payload)) {
    if (isDerivedScope(record.scope?.name)) {
      rejectedDerived += 1;
      continue;
    }

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
    else rejectedNonconforming += 1;
  }

  return {
    events,
    rejected: rejectedNonconforming + rejectedDerived,
    rejectedNonconforming,
    rejectedDerived,
  };
}

/** OTLP's partial-success `errorMessage`: why records were dropped, for the sender's logs. */
function rejectionMessage({ rejectedNonconforming, rejectedDerived }: DecodeResult): string {
  const reasons: string[] = [];
  if (rejectedNonconforming > 0) {
    reasons.push(`${rejectedNonconforming} missing the Required set (SEMANTIC-CONVENTIONS.md)`);
  }
  if (rejectedDerived > 0) {
    reasons.push(
      `${rejectedDerived} under scope ${DERIVED_SCOPE_NAME}, which is Rastro's own output ` +
        'and never input (CONSUMERS.md, rule 1)',
    );
  }
  return `rejected ${reasons.join('; ')}`;
}

export function registerIngest(app: FastifyInstance, store: EventStore): void {
  app.post('/v1/logs', async (request, reply) => {
    const observedTimeUnixNano = `${Date.now()}000000`;
    const result = decodeOtlpLogs(request.body, observedTimeUnixNano);

    await store.insert(result.events);

    if (result.rejected === 0) return reply.code(200).send({ partialSuccess: {} });

    const message = rejectionMessage(result);
    request.log.warn(
      {
        rejectedNonconforming: result.rejectedNonconforming,
        rejectedDerived: result.rejectedDerived,
      },
      message,
    );

    // OTLP's partial-success shape: accepted, with a count of what was dropped and why.
    return reply.code(200).send({
      partialSuccess: { rejectedLogRecords: String(result.rejected), errorMessage: message },
    });
  });
}
