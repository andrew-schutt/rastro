// packages/analysis/src/graph.ts
// Session[] → FlowGraph (docs/PLAN.md §19.3, §9). STUB.
//
// This is walking-skeleton step 5 (§19.4) and the headline demo. It is written test-first
// against fixture traces — see graph.test.ts for the cases that should drive it.
import type { FlowEdge, FlowGraph, FlowNode, GraphBuilder, Session } from 'rastro-core';

// Re-exported so the import path documented in §19.3 holds (declarations live in core).
export type { FlowEdge, FlowGraph, FlowNode } from 'rastro-core';

/**
 * Build the transition graph: for each session, walk consecutive step pairs → tally edges;
 * aggregate node hits; compute `medianMs` and `dropoffRate` per edge.
 *
 * `FlowGraph` maps almost 1:1 onto React Flow's `nodes`/`edges` props, so the dashboard stays
 * thin by design — the intelligence lives here, and here is pure and fully unit-testable.
 *
 * TODO(§19.3) implement:
 *   - nodes: one per distinct fingerprint; `hits` = how many steps carry it; `label` is the
 *     human-readable part of the fingerprint (NOT parsed for meaning by consumers).
 *   - edges: for each consecutive (a, b) step pair in a session, tally `a.fingerprint →
 *     b.fingerprint`. `count` is per-session transitions, not per-event.
 *   - medianMs: median of `b.activeMs` (dwell on `from` before moving to `to`) across all
 *     occurrences of that edge. Median, not mean — dwell is long-tailed and a single
 *     walked-away-from-the-desk session would wreck a mean.
 *   - dropoffRate: share of sessions that reached `from` and then ended, over sessions that
 *     reached `from` at all. Note this is a NODE property expressed on edges; decide whether
 *     it belongs on FlowNode instead before the shape ossifies.
 *
 * TODO(§8) spaghetti-taming: a real app produces a hairball. Pruning/collapsing rare
 * transitions is what makes the Flow Explorer legible, and it is a graph-building concern,
 * not a rendering one.
 *
 * @throws always, until implemented.
 */
export function buildGraph(_sessions: Session[]): FlowGraph {
  throw new Error(
    'buildGraph: not implemented — walking-skeleton step 5 (docs/PLAN.md §19.4).' +
      ' See graph.test.ts.',
  );
}

/** The default `GraphBuilder` implementation (§19.5). Swap for a process-mining miner (§8). */
export const transitionGraphBuilder: GraphBuilder = { build: buildGraph };
