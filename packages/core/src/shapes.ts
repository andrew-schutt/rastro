// packages/core/src/shapes.ts
// The click-to-graph data shapes (docs/DESIGN.md §19.3).
//
// §19.3 declares these next to the functions that produce them, in `packages/analysis`.
// They live here instead because `seams.ts` types `GraphBuilder` and `Interpreter` in terms
// of them, and `core` must never depend on `analysis`. `rastro-analysis` re-exports them
// from `sessionize.ts` / `graph.ts`, so the documented import paths still hold.

/**
 * One interaction, flattened out of the OTel envelope. The envelope stops at sessionize.
 *
 * ⚠ `eventName` and `interactionMethod` are additions to §19.3's Step. §13.1 requires the
 * session timeline to show `ux.interaction.method`, and a timeline that cannot tell a click
 * from a route change is not readable — so the shape §19.3 specifies cannot render the view
 * §13.1 specifies. Adding them here keeps the load-bearing rule intact ("the OTel envelope
 * stops at sessionize; downstream works on flat types, not raw records"); the alternative
 * was the dashboard reaching back into raw OTel attributes, which breaks it.
 */
export interface Step {
  /** `ux.click`, `ux.route_change`, `ux.form_submit`, `ux.form_abandon`, or a custom name. */
  eventName: string;
  fingerprint: string;
  route: string;
  seq: number;
  /**
   * Visibility-adjusted dwell BEFORE this step, in ms (§4.5). Absent when not reported:
   * `ux.active_ms` is Recommended, and a 0 standing in for "unknown" would be a measurement
   * nobody took — it dragged edge medians toward zero and read as an instant on the timeline.
   */
  activeMs?: number;
  interactionMethod?: 'mouse' | 'keyboard' | 'touch';
  /**
   * The deploy this step ran on: the record's `service.version` resource attribute. Absent
   * when the app did not report one, which is Recommended, not Required.
   *
   * Per step rather than per session, deliberately. Sessions are per page load today, so a
   * session cannot span a deploy, but that is a known hole (NOTES.md), not a guarantee. Once
   * §4.5's idle-timeout rule lands, a deploy can fall inside a session, and a per-session
   * version would silently pick one side. Every finding points at a step, so the step is the
   * one place the version is always exact.
   */
  serviceVersion?: string;
}

/** All of one `session.id`'s steps, sorted by `ux.seq`. */
export interface Session {
  sessionId: string;
  steps: Step[];
}

/** A node in the flow graph. `id` is the fingerprint. */
export interface FlowNode {
  id: string;
  label: string;
  hits: number;
}

export interface FlowEdge {
  from: string;
  to: string;                    // fingerprints
  count: number;                 // how many sessions made this A→B transition
  medianMs?: number;             // median dwell on `from` before moving to `to`; absent when
                                 // no traversal reported one
  dropoffRate: number;           // share of sessions that hit `from` then ended there, other
                                 // than by submitting it
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
