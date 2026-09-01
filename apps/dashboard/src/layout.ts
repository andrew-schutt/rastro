// apps/dashboard/src/layout.ts
// Positions for the flow graph.
//
// React Flow renders nodes where you tell it to and has no opinion about where that is, so
// something has to assign coordinates. This is a layered ("Sugiyama-lite") layout: rank nodes
// by their distance from an entry point, then lay each rank out as a row.
//
// Top-to-bottom, not left-to-right. A user flow is a long chain with occasional branching, so
// its long dimension is the number of steps — and a browser window is wide but short. Laid out
// horizontally, the demo's ten-step flow shrank to an unreadable smear; vertically the same
// graph reads at full size and scrolls, which is also the funnel shape people already have in
// their heads.
//
// Deliberately hand-rolled rather than pulling in dagre or elk: it is ~40 lines, it keeps the
// dependency budget (§4.7) intact, and a flow graph that has been through §8's
// spaghetti-taming is small. Revisit if the graphs get big enough to look tangled.
import type { FlowGraph, FlowNode } from 'rastro-core';

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 40;
/**
 * Vertical distance between ranks — the direction the flow travels. Sized to leave room for
 * an edge label between two nodes without it landing on either.
 */
export const RANK_SPACING = 92;
/** Horizontal distance between siblings sharing a rank. */
export const SIBLING_SPACING = 240;

export interface PositionedNode {
  node: FlowNode;
  /** Column: distance from an entry point. */
  rank: number;
  x: number;
  y: number;
}

/**
 * Rank every node by its shortest distance from an entry point.
 *
 * Entry points are nodes nothing links to — where sessions actually start. Cycles are
 * handled by never re-ranking a visited node, so a loop settles at the first depth it was
 * reached at instead of spinning. Anything unreachable from a real entry point (a component
 * that only exists inside a cycle) seeds its own traversal afterwards, so no node is lost.
 */
export function rankNodes(graph: FlowGraph): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();

  for (const edge of graph.edges) {
    const targets = outgoing.get(edge.from);
    if (targets === undefined) outgoing.set(edge.from, [edge.to]);
    else targets.push(edge.to);

    if (edge.to !== edge.from) hasIncoming.add(edge.to); // a self-loop is not an entry barrier
  }

  const ranks = new Map<string, number>();
  const ordered = [...graph.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const traverse = (start: string): void => {
    if (ranks.has(start)) return;
    ranks.set(start, 0);

    let frontier = [start];
    let depth = 0;
    while (frontier.length > 0) {
      depth += 1;
      const next: string[] = [];
      for (const id of frontier) {
        for (const target of outgoing.get(id) ?? []) {
          if (ranks.has(target)) continue; // already placed, or a cycle closing
          ranks.set(target, depth);
          next.push(target);
        }
      }
      frontier = next;
    }
  };

  // Real entry points first, so the common case ranks from where sessions begin.
  for (const node of ordered) {
    if (!hasIncoming.has(node.id)) traverse(node.id);
  }
  // Then anything still unplaced — nodes reachable only from inside a cycle.
  for (const node of ordered) traverse(node.id);

  return ranks;
}

/**
 * Assign coordinates. Within a rank, the busiest nodes sit nearest the centre line, so the
 * main path reads as a straight spine and the rare branches fan out either side.
 */
export function layoutGraph(graph: FlowGraph): PositionedNode[] {
  const ranks = rankNodes(graph);

  const byRank = new Map<number, FlowNode[]>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const column = byRank.get(rank);
    if (column === undefined) byRank.set(rank, [node]);
    else column.push(node);
  }

  const positioned: PositionedNode[] = [];
  for (const [rank, column] of byRank) {
    // Busiest first, then by id so the result never depends on Map iteration luck.
    const sorted = [...column].sort(
      (a, b) => b.hits - a.hits || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    sorted.forEach((node, index) => {
      positioned.push({
        node,
        rank,
        // Centre each row on x=0, so ranks of different widths share one spine.
        x: (index - (sorted.length - 1) / 2) * SIBLING_SPACING,
        y: rank * RANK_SPACING,
      });
    });
  }

  return positioned.sort((a, b) => a.rank - b.rank || a.x - b.x);
}

/** Stroke width for an edge, scaled by how many sessions took it. */
export function edgeWidth(count: number, maxCount: number): number {
  if (maxCount <= 1) return 1.5;
  return 1 + (Math.min(count, maxCount) / maxCount) * 4;
}
