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
  /** Visibility-adjusted dwell BEFORE this step, in ms (§4.5). 0 when not reported. */
  activeMs: number;
  interactionMethod?: 'mouse' | 'keyboard' | 'touch';
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
  medianMs: number;              // median dwell on `from` before moving to `to`
  dropoffRate: number;           // share of sessions that hit `from` then ended
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
