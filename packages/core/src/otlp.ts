// packages/core/src/otlp.ts
// The OTLP/HTTP JSON logs codec: records ⇄ `resourceLogs → scopeLogs → logRecords`.
//
// One codec for both directions and both record kinds. `rastro-react` encodes interactions
// with it, the collector decodes them, and analysis output will be encoded with it too
// (docs/CONSUMERS.md). It lives in `core` because every one of those sides needs it, and a
// second hand-written copy is how an encoder and a decoder quietly disagree.
//
// It is deliberately wider than the capture contract. It carries maps (`kvlistValue`) and a
// structured `body`, which interactions never use and findings will. What a `UxEvent` may
// hold is narrowed elsewhere (`AttributeValue`, `sanitizeProps`, the collector's decode), so
// widening the codec widens nothing a conforming emitter can put on the wire.
//
// ⚠ §19.6 still applies to the SDK's sending path: before production, the default should be
// @opentelemetry/exporter-logs-otlp-http, with its unload flushing and bundle size verified.
// This codec stays either way, because the collector has to decode whatever arrives.

/**
 * A value the codec can carry: OTel's `AnyValue`, minus bytes. Nested arrays and maps are
 * both allowed, as the logs data model allows them on attributes and on the body.
 */
export type AnyValue = string | number | boolean | AnyValue[] | { [key: string]: AnyValue };

/** OTLP's JSON encoding of `AnyValue`. `bytesValue` is read and dropped, never written. */
export type OtlpAnyValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: OtlpKeyValue[] } };

export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  eventName: string;
  severityNumber: number;
  attributes: OtlpKeyValue[];
  body?: OtlpAnyValue;
}

export interface OtlpScope {
  name: string;
  version?: string;
}

export interface OtlpLogsPayload {
  resourceLogs: {
    resource: { attributes: OtlpKeyValue[] };
    scopeLogs: { scope: OtlpScope; logRecords: OtlpLogRecord[] }[];
  }[];
}

/**
 * What the encoder accepts. A `UxEvent` is one; a derived record will be another. Values the
 * codec cannot carry (`undefined`, `null`, functions, class instances) are dropped rather
 * than guessed at.
 */
export interface LogRecord {
  eventName: string;
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber: number;
  attributes: Readonly<Record<string, unknown>>;
  resource: Readonly<Record<string, unknown>>;
  body?: AnyValue;
}

/**
 * What the decoder returns: everything the wire carried, unvalidated. Fields a sender left
 * out stay absent. Deciding whether a record conforms is the caller's job (`isUxEvent`).
 */
export interface DecodedLogRecord {
  eventName?: string;
  timeUnixNano?: string;
  observedTimeUnixNano?: string;
  severityNumber?: number;
  attributes: Record<string, AnyValue>;
  resource: Record<string, AnyValue>;
  body?: AnyValue;
  /** The instrumentation scope the record arrived under, e.g. `rastro-react`. */
  scope?: OtlpScope;
}

/** A plain `{}` literal, not a Date, Map, class instance or array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function toOtlpAnyValue(value: unknown): OtlpAnyValue | undefined {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined; // JSON has no NaN or Infinity
    // OTLP int64 is a string in JSON, so a large ux.seq cannot lose precision on the wire.
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    const values = value
      .map(toOtlpAnyValue)
      .filter((v): v is OtlpAnyValue => v !== undefined);
    return { arrayValue: { values } };
  }
  if (isPlainObject(value)) return { kvlistValue: { values: toKeyValues(value) } };
  return undefined;
}

function toKeyValues(source: Readonly<Record<string, unknown>>): OtlpKeyValue[] {
  const out: OtlpKeyValue[] = [];
  for (const [key, raw] of Object.entries(source)) {
    const value = toOtlpAnyValue(raw);
    if (value !== undefined) out.push({ key, value });
  }
  return out;
}

/**
 * Wrap records in the OTLP logs envelope under one instrumentation scope.
 *
 * Records are grouped by resource, so a batch spanning two apps (or two deploy versions)
 * produces two `resourceLogs` entries rather than attributing every record to whichever
 * resource came first.
 */
export function encodeOtlpLogs(
  records: readonly LogRecord[],
  scope: OtlpScope,
): OtlpLogsPayload {
  const byResource = new Map<
    string,
    { resource: LogRecord['resource']; logRecords: OtlpLogRecord[] }
  >();

  for (const record of records) {
    const key = JSON.stringify(record.resource);
    let group = byResource.get(key);
    if (group === undefined) {
      group = { resource: record.resource, logRecords: [] };
      byResource.set(key, group);
    }

    const body = record.body === undefined ? undefined : toOtlpAnyValue(record.body);
    group.logRecords.push({
      timeUnixNano: record.timeUnixNano,
      ...(record.observedTimeUnixNano === undefined
        ? {}
        : { observedTimeUnixNano: record.observedTimeUnixNano }),
      eventName: record.eventName,
      severityNumber: record.severityNumber,
      attributes: toKeyValues(record.attributes),
      ...(body === undefined ? {} : { body }),
    });
  }

  return {
    resourceLogs: [...byResource.values()].map(({ resource, logRecords }) => ({
      resource: { attributes: toKeyValues(resource) },
      scopeLogs: [{ scope, logRecords }],
    })),
  };
}

/** The wire shapes as they may actually arrive: every field optional, nothing trusted. */
interface WireAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: WireAnyValue[] };
  kvlistValue?: { values?: WireKeyValue[] };
}

interface WireKeyValue {
  key?: string;
  value?: WireAnyValue;
}

interface WireLogsPayload {
  resourceLogs?: {
    resource?: { attributes?: WireKeyValue[] };
    scopeLogs?: {
      scope?: { name?: string; version?: string };
      logRecords?: {
        timeUnixNano?: string;
        observedTimeUnixNano?: string;
        eventName?: string;
        severityNumber?: number;
        attributes?: WireKeyValue[];
        body?: WireAnyValue;
      }[];
    }[];
  }[];
}

function fromOtlpAnyValue(value: WireAnyValue | undefined): AnyValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  // int64 arrives as a string. Number() loses precision past 2^53, which no ux.seq reaches.
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? [])
      .map(fromOtlpAnyValue)
      .filter((v): v is AnyValue => v !== undefined);
  }
  if (value.kvlistValue !== undefined) return fromKeyValues(value.kvlistValue.values);
  return undefined; // bytesValue, or a shape this codec does not know
}

function fromKeyValues(pairs: WireKeyValue[] | undefined): Record<string, AnyValue> {
  const out: Record<string, AnyValue> = {};
  for (const pair of pairs ?? []) {
    if (pair.key === undefined) continue;
    const value = fromOtlpAnyValue(pair.value);
    if (value !== undefined) out[pair.key] = value;
  }
  return out;
}

/**
 * Unwrap `resourceLogs → scopeLogs → logRecords` into flat records, each carrying its
 * resource and scope. Nothing is validated or stamped here: a malformed payload yields
 * records with fields missing, never an exception.
 */
export function decodeOtlpLogs(payload: unknown): DecodedLogRecord[] {
  const body = (payload ?? {}) as WireLogsPayload;
  const out: DecodedLogRecord[] = [];

  for (const resourceLog of body.resourceLogs ?? []) {
    const resource = fromKeyValues(resourceLog.resource?.attributes);

    for (const scopeLog of resourceLog.scopeLogs ?? []) {
      const name = scopeLog.scope?.name;
      const version = scopeLog.scope?.version;
      const scope =
        name === undefined ? undefined : { name, ...(version === undefined ? {} : { version }) };

      for (const record of scopeLog.logRecords ?? []) {
        const recordBody = fromOtlpAnyValue(record.body);
        out.push({
          ...(record.eventName === undefined ? {} : { eventName: record.eventName }),
          ...(record.timeUnixNano === undefined ? {} : { timeUnixNano: record.timeUnixNano }),
          ...(record.observedTimeUnixNano === undefined
            ? {}
            : { observedTimeUnixNano: record.observedTimeUnixNano }),
          ...(record.severityNumber === undefined
            ? {}
            : { severityNumber: record.severityNumber }),
          attributes: fromKeyValues(record.attributes),
          resource,
          ...(recordBody === undefined ? {} : { body: recordBody }),
          ...(scope === undefined ? {} : { scope }),
        });
      }
    }
  }

  return out;
}
