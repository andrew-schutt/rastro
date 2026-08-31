// packages/react/src/otlp.ts
// UxEvent[] → the OTLP/HTTP logs envelope.
//
// ⚠ §19.6 is explicit: don't hand-roll this if you can avoid it — the official
// OpenTelemetry JS logs exporter emits the envelope for you, and leaning on it is the real
// meaning of "use the OTLP convention". This tiny version exists for two reasons: zero
// dependencies in commit #1, and making the wire shape legible while the collector is being
// written against it.
//
// TODO(§19.6) before production, switch the default to @opentelemetry/exporter-logs-otlp-http
// and verify the two caveats: (1) does it flush on visibilitychange/pagehide via
// sendBeacon/keepalive — if not, your form-abandonment and exit signals silently vanish
// (§4.4); (2) bundle size against the §4.7 budget.
import type { UxEvent } from 'rastro-core';

/** OTLP encodes every attribute as a typed `{ key, value }` pair. This is that union. */
type AnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: AnyValue[] } };

interface KeyValue {
  key: string;
  value: AnyValue;
}

export interface OtlpLogsPayload {
  resourceLogs: {
    resource: { attributes: KeyValue[] };
    scopeLogs: {
      scope: { name: string; version?: string };
      logRecords: OtlpLogRecord[];
    }[];
  }[];
}

interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  eventName: string;
  severityNumber: number;
  attributes: KeyValue[];
}

export const SCOPE_NAME = 'rastro-react';

function toAnyValue(value: unknown): AnyValue | undefined {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    // OTLP int64 is encoded as a string in JSON — a large seq must not lose precision.
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    const values = value.map(toAnyValue).filter((v): v is AnyValue => v !== undefined);
    return { arrayValue: { values } };
  }
  return undefined; // null/undefined/objects: dropped rather than guessed at
}

function toKeyValues(source: Record<string, unknown>): KeyValue[] {
  const out: KeyValue[] = [];
  for (const [key, raw] of Object.entries(source)) {
    const value = toAnyValue(raw);
    if (value !== undefined) out.push({ key, value });
  }
  return out;
}

/**
 * Wrap records in the OTLP logs envelope: `resourceLogs → scopeLogs → logRecords`.
 *
 * Records are grouped by their resource, so one batch spanning two apps (or two deploy
 * versions) produces two `resourceLogs` entries rather than silently attributing all of them
 * to whichever resource happened to be first.
 */
export function toOtlpLogs(batch: UxEvent[]): OtlpLogsPayload {
  const byResource = new Map<string, { resource: UxEvent['resource']; records: OtlpLogRecord[] }>();

  for (const event of batch) {
    const key = JSON.stringify(event.resource);
    let group = byResource.get(key);
    if (group === undefined) {
      group = { resource: event.resource, records: [] };
      byResource.set(key, group);
    }

    group.records.push({
      timeUnixNano: event.timeUnixNano,
      ...(event.observedTimeUnixNano === undefined
        ? {}
        : { observedTimeUnixNano: event.observedTimeUnixNano }),
      eventName: event.eventName,
      severityNumber: event.severityNumber,
      attributes: toKeyValues(event.attributes),
    });
  }

  return {
    resourceLogs: [...byResource.values()].map(({ resource, records }) => ({
      resource: { attributes: toKeyValues(resource) },
      scopeLogs: [{ scope: { name: SCOPE_NAME }, logRecords: records }],
    })),
  };
}
