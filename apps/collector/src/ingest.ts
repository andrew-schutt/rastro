// apps/collector/src/ingest.ts
// POST /v1/logs — accept OTLP logs, assign observedTime, insert (PLAN.md §19.4 step 1).
import type { FastifyInstance } from 'fastify';
import type { EventStore, UxEvent } from 'rastro-core';
import { isUxEvent } from 'rastro-core';

/** The OTLP/HTTP JSON shapes we read. Only the fields Rastro needs are modelled. */
interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpAnyValue[] };
}

interface OtlpKeyValue {
  key?: string;
  value?: OtlpAnyValue;
}

interface OtlpLogRecord {
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  eventName?: string;
  severityNumber?: number;
  attributes?: OtlpKeyValue[];
}

interface OtlpLogsPayload {
  resourceLogs?: {
    resource?: { attributes?: OtlpKeyValue[] };
    scopeLogs?: { logRecords?: OtlpLogRecord[] }[];
  }[];
}

function fromAnyValue(value: OtlpAnyValue | undefined): unknown {
  if (value === undefined) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.intValue !== undefined) return Number(value.intValue); // int64-as-string on the wire
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(fromAnyValue);
  }
  return undefined;
}

function fromKeyValues(pairs: OtlpKeyValue[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs ?? []) {
    if (pair.key === undefined) continue;
    const value = fromAnyValue(pair.value);
    if (value !== undefined) out[pair.key] = value;
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
  const body = (payload ?? {}) as OtlpLogsPayload;
  const events: UxEvent[] = [];
  let rejected = 0;

  for (const resourceLog of body.resourceLogs ?? []) {
    const resource = fromKeyValues(resourceLog.resource?.attributes);

    for (const scopeLog of resourceLog.scopeLogs ?? []) {
      for (const record of scopeLog.logRecords ?? []) {
        const candidate = {
          eventName: record.eventName,
          timeUnixNano: record.timeUnixNano,
          // Assigned here, never trusted from the client.
          observedTimeUnixNano,
          severityNumber: record.severityNumber,
          attributes: fromKeyValues(record.attributes),
          resource,
        };

        if (isUxEvent(candidate)) events.push(candidate);
        else rejected += 1;
      }
    }
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
        'dropped records missing the Required set (SEMANTIC-CONVENTIONS.md)',
      );
    }

    // OTLP's partial-success shape: accepted, with a count of what was dropped.
    return reply.code(200).send({
      partialSuccess: rejected === 0 ? {} : { rejectedLogRecords: String(rejected) },
    });
  });
}
