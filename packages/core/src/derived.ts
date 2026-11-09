// packages/core/src/derived.ts
// Records Rastro derives from interactions, as opposed to records it observes
// (docs/CONSUMERS.md, rule 1). docs/OUTPUT-CONVENTIONS.md is the contract; this file must stay
// in lockstep with it, the way events.ts does with SEMANTIC-CONVENTIONS.md.
//
// There is one derived record, the finding. The flow graph is deliberately not one: it is a
// view over the interaction events, which are already OTel records.

/**
 * The instrumentation scope every derived record is emitted under. Named after the package
 * that produces findings, so a record's scope says which side of the analysis it came from.
 */
export const DERIVED_SCOPE_NAME = 'rastro-analysis';

/**
 * Is this scope Rastro's own output?
 *
 * A deny-list of one, not an allow-list of `rastro-react`. The conventions are a contract any
 * instrumentation may emit against, so an unknown scope, or none at all, is a third-party
 * emitter and stays welcome. Only Rastro's own output is refused as input.
 */
export function isDerivedScope(scopeName: string | undefined): boolean {
  return scopeName === DERIVED_SCOPE_NAME;
}

/** The version of OUTPUT-CONVENTIONS.md that findings from this build conform to. */
export const OUTPUT_VERSION = '0.1';

/** The one derived event name. The kind is an attribute, so every kind shares a schema. */
export const FINDING_EVENT_NAME = 'rastro.finding';

/** Stands in for an absent `service.version` inside a finding id. */
export const UNKNOWN_VERSION = '-';

/**
 * One occurrence behind a finding: the interaction the signal fired on. A `type` rather than
 * an `interface` so it stays assignable to the codec's `AnyValue` (interfaces get no implicit
 * index signature).
 */
export type EvidenceRef = {
  'session.id': string;
  'ux.seq': number;
};

/**
 * A finding, shaped as the OTel Event record the codec encodes (OUTPUT-CONVENTIONS.md).
 *
 * What is absent is as deliberate as what is present. No `session.id` attribute: a finding
 * spans sessions, and a backend would file it inside one. No rate: rates are pooled across
 * deploys and this record is keyed by one. No cause, confidence or recommendation: findings
 * are observations.
 */
export type Finding = {
  eventName: typeof FINDING_EVENT_NAME;
  /** When the analysis ran. */
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber: 9;
  attributes: {
    'rastro.finding.id': string;
    'rastro.finding.kind': string;
    'ux.fingerprint': string;
    /** Times the signal fired, in this deploy. */
    'rastro.finding.occurrences': number;
    /** Distinct sessions it fired in, in this deploy. */
    'rastro.finding.sessions': number;
  };
  /** The analyzed app, not Rastro. The scope says who produced it. */
  resource: {
    'service.name': string;
    'service.version'?: string;
    'ux.convention.version'?: string;
    'rastro.output.version': string;
  };
  body: { evidence: EvidenceRef[] };
};

/**
 * `<kind>:<version>:<fingerprint>`. The fingerprint is free text and goes last, so the id
 * splits on its first two separators whatever the fingerprint contains. Deterministic: the
 * same signal on the same element in the same deploy always yields the same id.
 */
export function findingId(
  kind: string,
  serviceVersion: string | undefined,
  fingerprint: string,
): string {
  return `${kind}:${serviceVersion ?? UNKNOWN_VERSION}:${fingerprint}`;
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return isString(ref['session.id']) && isCount(ref['ux.seq']);
}

/**
 * Structural check for the Required set, plus the invariants that make a finding honest: its
 * id matches its own parts, its evidence is non-empty and exactly as long as its occurrence
 * count, and it carries no `session.id` attribute. (A rate or a cause has no fixed name to
 * check for; the type and the conventions are what keep those out.)
 */
export function isFinding(value: unknown): value is Finding {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.eventName !== FINDING_EVENT_NAME) return false;
  if (!isString(record.timeUnixNano)) return false;

  const attributes = record.attributes as Record<string, unknown> | undefined;
  const resource = record.resource as Record<string, unknown> | undefined;
  const body = record.body as Record<string, unknown> | undefined;
  if (typeof attributes !== 'object' || attributes === null) return false;
  if (typeof resource !== 'object' || resource === null) return false;
  if (typeof body !== 'object' || body === null) return false;

  if (!isString(resource['service.name'])) return false;
  if (!isString(resource['rastro.output.version'])) return false;
  const version = resource['service.version'];
  if (version !== undefined && !isString(version)) return false;

  const kind = attributes['rastro.finding.kind'];
  const fingerprint = attributes['ux.fingerprint'];
  const occurrences = attributes['rastro.finding.occurrences'];
  const sessions = attributes['rastro.finding.sessions'];
  if (!isString(kind) || !isString(fingerprint)) return false;
  if (!isCount(occurrences) || !isCount(sessions)) return false;
  if (attributes['rastro.finding.id'] !== findingId(kind, version, fingerprint)) return false;
  if ('session.id' in attributes) return false;

  const evidence = body.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  if (!evidence.every(isEvidenceRef)) return false;
  if (evidence.length !== occurrences) return false;
  const distinct = new Set(evidence.map((ref) => ref['session.id'])).size;
  return distinct === sessions;
}
