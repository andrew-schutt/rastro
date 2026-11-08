// packages/core/src/derived.ts
// Records Rastro derives from interactions, as opposed to records it observes
// (docs/CONSUMERS.md, rule 1).
//
// Only the scope name lives here so far. The record type, its event names and its Required
// set arrive with the output vocabulary (work-list item 4). The name comes first because the
// collector has to refuse derived records before anything emits one: a guard written after
// the first finding is posted back is a guard written after the first corrupted count.

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
