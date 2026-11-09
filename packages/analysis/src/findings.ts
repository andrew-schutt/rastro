// packages/analysis/src/findings.ts
// FrictionSignal[] → Finding[] (docs/OUTPUT-CONVENTIONS.md). Pure.
//
// The one place analysis output is put back into an OTel shape. Everything upstream works on
// flat types (§19.3), and this is the edge where they are re-wrapped for a consumer. Nothing
// emits findings yet; that is work-list item 6 in CONSUMERS.md.
import {
  findingId,
  FINDING_EVENT_NAME,
  OUTPUT_VERSION,
  SEVERITY_INFO,
  type EvidenceRef,
  type Finding,
  type Session,
  type Step,
} from 'rastro-core';
import type { FrictionSignal } from './friction.js';

export interface ToFindingsOptions {
  /** `service.name` of the analyzed app. Steps do not carry it; the caller knows it. */
  app: string;
  /** When the analysis ran, as OTLP nanoseconds. A parameter so output is deterministic. */
  timeUnixNano: string;
}

/**
 * Group signals into one finding per `(kind, service.version, fingerprint)`.
 *
 * Counts are exact for the finding's deploy: occurrences is the number of signals, sessions
 * the distinct sessions among them. Each signal's `magnitude` is dropped on purpose: for
 * `high_abandonment` it is a rate pooled across every deploy in the window, and on a record
 * keyed by one deploy it would read as that deploy's rate (OUTPUT-CONVENTIONS.md).
 *
 * `sessions` is how each signal's step is found, to read the capture-convention version its
 * fingerprint was written under. A signal whose step is missing contributes no convention
 * version, which leaves it off the finding rather than guessing.
 *
 * Findings are ranked by sessions affected, the one number comparable across kinds
 * (`frictionByNode` uses it for the same reason), then by id so output order is stable.
 */
export function toFindings(
  signals: FrictionSignal[],
  sessions: Session[],
  { app, timeUnixNano }: ToFindingsOptions,
): Finding[] {
  const steps = new Map<string, Step>();
  for (const { sessionId, steps: sessionSteps } of sessions) {
    for (const step of sessionSteps) steps.set(`${sessionId}\u0000${step.seq}`, step);
  }

  const groups = new Map<
    string,
    { kind: string; fingerprint: string; serviceVersion?: string; signals: FrictionSignal[] }
  >();
  for (const signal of signals) {
    const id = findingId(signal.kind, signal.serviceVersion, signal.fingerprint);
    let group = groups.get(id);
    if (group === undefined) {
      group = {
        kind: signal.kind,
        fingerprint: signal.fingerprint,
        ...(signal.serviceVersion === undefined ? {} : { serviceVersion: signal.serviceVersion }),
        signals: [],
      };
      groups.set(id, group);
    }
    group.signals.push(signal);
  }

  const findings: Finding[] = [];
  for (const [id, { kind, fingerprint, serviceVersion, signals: grouped }] of groups) {
    const evidence: EvidenceRef[] = grouped
      .map((signal) => ({ 'session.id': signal.sessionId, 'ux.seq': signal.seq }))
      .sort(
        (a, b) =>
          (a['session.id'] < b['session.id'] ? -1 : a['session.id'] > b['session.id'] ? 1 : 0) ||
          a['ux.seq'] - b['ux.seq'],
      );

    // Set only when every occurrence agrees. Within one deploy it always does, since the
    // convention version is a property of the build; a disagreement means unversioned
    // evidence from several builds, and the finding cannot honestly name one format.
    const conventionVersions = new Set(
      grouped.map((signal) => steps.get(`${signal.sessionId}\u0000${signal.seq}`)?.conventionVersion),
    );
    const [onlyConvention] = conventionVersions;
    const conventionVersion =
      conventionVersions.size === 1 && onlyConvention !== undefined ? onlyConvention : undefined;

    findings.push({
      eventName: FINDING_EVENT_NAME,
      timeUnixNano,
      severityNumber: SEVERITY_INFO,
      attributes: {
        'rastro.finding.id': id,
        'rastro.finding.kind': kind,
        'ux.fingerprint': fingerprint,
        'rastro.finding.occurrences': evidence.length,
        'rastro.finding.sessions': new Set(evidence.map((ref) => ref['session.id'])).size,
      },
      resource: {
        'service.name': app,
        ...(serviceVersion === undefined ? {} : { 'service.version': serviceVersion }),
        ...(conventionVersion === undefined ? {} : { 'ux.convention.version': conventionVersion }),
        'rastro.output.version': OUTPUT_VERSION,
      },
      body: { evidence },
    });
  }

  return findings.sort(
    (a, b) =>
      b.attributes['rastro.finding.sessions'] - a.attributes['rastro.finding.sessions'] ||
      (a.attributes['rastro.finding.id'] < b.attributes['rastro.finding.id'] ? -1 : 1),
  );
}
