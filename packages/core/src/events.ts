// packages/core/src/events.ts
// What the SDK emits, shaped as an OTel LogRecord (Event). One interaction = one record.
//
// This file is the keystone (docs/DESIGN.md §19.2). The `ux.*` attribute names ARE the semantic
// convention — docs/SEMANTIC-CONVENTIONS.md is the contract, and this type must stay in
// lockstep with it. Renaming anything here ripples through the SDK, the collector, and
// every analysis query.
//
// ⚠ DEVIATION FROM §19.2 (see docs/NOTES.md): the snippet in the plan predates
// docs/SEMANTIC-CONVENTIONS.md and omits five attributes the spec defines. They are added below,
// all optional, each tagged `[SPEC]`. Every Required attribute matches §19.2 exactly, so
// this is a superset — nothing that conformed to §19.2 stops conforming.
export interface UxEvent {
  // The literals are absorbed by `string` for the type checker, which is the point: they
  // document the built-in events and drive editor autocomplete while `track()` keeps the
  // union open to app-defined names. §19.2 declares it exactly this way.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  eventName: 'ux.click' | 'ux.route_change' | 'ux.form_submit' | string; // custom via track()
  timeUnixNano: string;          // client time — reference only
  observedTimeUnixNano?: string; // assigned at the collector — authoritative order (§4.5)
  severityNumber: 9;             // INFO
  attributes: {
    'session.id': string;              // STANDARD convention — unit of every flow (§4.5)
    'session.previous_id'?: string;    // STANDARD — continuation link
    'url.path': string;                // STANDARD — tokenized, PII-stripped (§4.9)
    'ux.event_id': string;             // idempotency for retries (§4.4)
    'ux.seq': number;                  // per-session monotonic order — never trust the clock
    'ux.fingerprint': string;          // stable element identity (§4.2.1)
    'ux.interaction.method'?: 'mouse' | 'keyboard' | 'touch';
    'ux.active_ms'?: number;           // visibility-adjusted dwell (§4.5)
    'ux.anonymous_id': string;

    'ux.from_path'?: string;           // [SPEC] Opt-In — on ux.route_change, previous url.path
    'ux.component_chain'?: string[];   // [SPEC] Recommended — outermost → innermost
    'ux.role'?: string;                // [SPEC] Recommended — queryable slice of the fingerprint
    'ux.accessible_name'?: string;     // [SPEC] Recommended — redacted before emit (§4.9)
    // [SPEC] Recommended — repo-relative file defining the chain's innermost component.
    // Emitted only where a build-time annotator supplied it, so it composed the fingerprint.
    // Repo-relative, never absolute: an absolute path is both a leak and a machine-specific
    // identity. The open index signature below would have swallowed the omission silently,
    // which is exactly why every spec attribute is named here explicitly.
    'ux.source_file'?: string;

    // [SPEC] Custom attributes from `track(name, props)`. The conventions say props become
    // attributes, so the shape has to admit them. Keys in a reserved namespace are rejected
    // at the boundary, not here — see RESERVED_ATTRIBUTE_NAMESPACES.
    [key: string]: AttributeValue | undefined;
  };
  resource: {
    'service.name': string;            // STANDARD — the app
    'service.version'?: string;        // STANDARD — deploy dimension (§13/§14)
    'ux.convention.version'?: string;  // [SPEC] Recommended — which spec version this conforms to
  };
}

/** What an OTLP attribute value may hold. Anything else is dropped rather than guessed at. */
export type AttributeValue = string | number | boolean | string[];

/**
 * Attribute namespaces owned by OpenTelemetry or by these conventions. Custom props from
 * `track()` MUST NOT write into them: a stray `{ 'ux.seq': 0 }` would corrupt the one thing
 * every consumer is required to order by.
 */
export const RESERVED_ATTRIBUTE_NAMESPACES = ['session.', 'url.', 'service.', 'ux.'] as const;

/** Is this attribute key owned by the conventions rather than the application? */
export function isReservedAttribute(key: string): boolean {
  return RESERVED_ATTRIBUTE_NAMESPACES.some((namespace) => key.startsWith(namespace));
}

/**
 * The version of the semantic conventions that records from this build conform to.
 * Rides on the resource as `ux.convention.version` so the analysis layer can handle
 * mixed-version data across migrations.
 */
export const UX_CONVENTION_VERSION = '0.3';

/**
 * The Required set from the semantic conventions: every conforming record MUST carry these
 * attributes (plus `service.name` on the resource). Analysis depends on nothing else, so a
 * minimal conforming emitter still produces fully usable flows and timelines.
 */
export const REQUIRED_ATTRIBUTES = [
  'session.id',
  'url.path',
  'ux.event_id',
  'ux.seq',
  'ux.fingerprint',
  'ux.anonymous_id',
] as const;

/** Standard OTel session-lifecycle event names — deliberately NOT `ux.`-prefixed. */
export const SESSION_START = 'session.start';
export const SESSION_END = 'session.end';

/** INFO. The only severity Rastro emits today. */
export const SEVERITY_INFO = 9;

/**
 * Structural check for the Required set. Cheap enough to run on every ingested record; the
 * collector rejects records that fail, so malformed data never reaches analysis.
 */
export function isUxEvent(value: unknown): value is UxEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<UxEvent>;
  if (typeof record.eventName !== 'string' || record.eventName.length === 0) return false;
  if (typeof record.timeUnixNano !== 'string') return false;
  if (typeof record.attributes !== 'object' || record.attributes === null) return false;
  if (typeof record.resource !== 'object' || record.resource === null) return false;
  if (typeof record.resource['service.name'] !== 'string') return false;

  const attrs = record.attributes as Record<string, unknown>;
  for (const key of REQUIRED_ATTRIBUTES) {
    const expected = key === 'ux.seq' ? 'number' : 'string';
    if (typeof attrs[key] !== expected) return false;
  }
  return true;
}
