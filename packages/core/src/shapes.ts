// packages/core/src/shapes.ts
// The click-to-graph data shapes (PLAN.md §19.3).
//
// §19.3 declares these next to the functions that produce them, in `packages/analysis`.
// They live here instead because `seams.ts` types `GraphBuilder` and `Interpreter` in terms
// of them, and `core` must never depend on `analysis`. `rastro-analysis` re-exports them
// from `sessionize.ts` / `graph.ts`, so the documented import paths still hold.

/** One interaction, flattened out of the OTel envelope. The envelope stops at sessionize. */
export interface Step {
  fingerprint: string;
  route: string;
  seq: number;
  activeMs: number;
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
