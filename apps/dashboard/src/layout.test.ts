// apps/dashboard/src/layout.test.ts
import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowGraph, FlowNode } from 'rastro-core';
import { RANK_SPACING, edgeWidth, layoutGraph, rankNodes } from './layout.js';

const node = (id: string, hits = 1): FlowNode => ({ id, label: id, hits });
const edge = (from: string, to: string): FlowEdge => ({
  from,
  to,
  count: 1,
  medianMs: 0,
  dropoffRate: 0,
});

const graphOf = (nodes: FlowNode[], edges: FlowEdge[]): FlowGraph => ({ nodes, edges });

describe('rankNodes', () => {
  it('puts an entry point at rank 0 and ranks by distance from it', () => {
    const ranks = rankNodes(
      graphOf([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('B', 'C')]),
    );

    expect([...ranks]).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]);
  });

  it('puts parallel branches at the same rank', () => {
    const ranks = rankNodes(
      graphOf([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('A', 'C')]),
    );

    expect(ranks.get('B')).toBe(1);
    expect(ranks.get('C')).toBe(1);
  });

  it('ranks a node by its SHORTEST path, so a detour does not push it right', () => {
    const ranks = rankNodes(
      graphOf(
        [node('A'), node('B'), node('C'), node('D')],
        [edge('A', 'D'), edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
      ),
    );

    expect(ranks.get('D')).toBe(1);
  });

  // A user going back to a previous screen is a cycle, and cycles are the normal case.
  it('terminates on a cycle', () => {
    const ranks = rankNodes(
      graphOf([node('A'), node('B')], [edge('A', 'B'), edge('B', 'A')]),
    );

    expect(ranks.get('A')).toBe(0);
    expect(ranks.get('B')).toBe(1);
  });

  it('terminates on a self-loop, and does not treat it as an incoming edge', () => {
    const ranks = rankNodes(graphOf([node('A'), node('B')], [edge('A', 'A'), edge('A', 'B')]));

    // A still counts as an entry point despite pointing at itself.
    expect(ranks.get('A')).toBe(0);
    expect(ranks.get('B')).toBe(1);
  });

  it('places every node even when the graph is entirely a cycle', () => {
    const ranks = rankNodes(
      graphOf([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')]),
    );

    expect(ranks.size).toBe(3);
  });

  it('places disconnected components', () => {
    const ranks = rankNodes(
      graphOf([node('A'), node('B'), node('X'), node('Y')], [edge('A', 'B'), edge('X', 'Y')]),
    );

    expect(ranks.get('A')).toBe(0);
    expect(ranks.get('X')).toBe(0);
    expect(ranks.size).toBe(4);
  });

  it('places an isolated node with no edges at all', () => {
    expect(rankNodes(graphOf([node('A')], []))).toEqual(new Map([['A', 0]]));
  });

  it('handles an empty graph', () => {
    expect(rankNodes(graphOf([], []))).toEqual(new Map());
  });
});

describe('layoutGraph', () => {
  it('spaces ranks vertically — the direction the flow travels', () => {
    const positioned = layoutGraph(graphOf([node('A'), node('B')], [edge('A', 'B')]));

    expect(positioned.map((p) => p.y)).toEqual([0, RANK_SPACING]);
  });

  it('centres a rank on x=0 so ranks of different widths share one spine', () => {
    const positioned = layoutGraph(
      graphOf([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('A', 'C')]),
    );
    const rankOne = positioned.filter((p) => p.rank === 1).map((p) => p.x);

    expect(rankOne.reduce((sum, x) => sum + x, 0)).toBe(0);
  });

  it('puts a single node in a rank on the centre line', () => {
    const positioned = layoutGraph(graphOf([node('A'), node('B')], [edge('A', 'B')]));

    expect(positioned.map((p) => p.x)).toEqual([0, 0]);
  });

  it('gives every node a position exactly once', () => {
    const positioned = layoutGraph(
      graphOf([node('A'), node('B'), node('C')], [edge('A', 'B'), edge('B', 'C')]),
    );

    expect(positioned).toHaveLength(3);
    expect(new Set(positioned.map((p) => p.node.id)).size).toBe(3);
  });

  it('never overlaps two nodes in the same rank', () => {
    const positioned = layoutGraph(
      graphOf(
        [node('A'), node('B'), node('C'), node('D')],
        [edge('A', 'B'), edge('A', 'C'), edge('A', 'D')],
      ),
    );
    const xs = positioned.filter((p) => p.rank === 1).map((p) => p.x);

    expect(new Set(xs).size).toBe(xs.length);
  });

  it('puts the busiest node of a rank nearest the centre line', () => {
    const positioned = layoutGraph(
      graphOf(
        [node('A'), node('quiet', 1), node('busy', 99)],
        [edge('A', 'quiet'), edge('A', 'busy')],
      ),
    );
    const busy = positioned.find((p) => p.node.id === 'busy');
    const quiet = positioned.find((p) => p.node.id === 'quiet');

    expect(Math.abs(busy?.x ?? 0)).toBeLessThanOrEqual(Math.abs(quiet?.x ?? 0));
  });

  it('is deterministic regardless of input node order', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges = [edge('A', 'B'), edge('A', 'C')];

    expect(layoutGraph(graphOf(nodes, edges))).toEqual(
      layoutGraph(graphOf([...nodes].reverse(), [...edges].reverse())),
    );
  });

  it('handles an empty graph', () => {
    expect(layoutGraph(graphOf([], []))).toEqual([]);
  });
});

describe('edgeWidth', () => {
  it('scales with share of the busiest edge', () => {
    expect(edgeWidth(1, 10)).toBeLessThan(edgeWidth(9, 10));
  });

  it('gives the busiest edge the maximum width', () => {
    expect(edgeWidth(10, 10)).toBeCloseTo(5);
  });

  it('falls back to a fixed width when every edge is equally rare', () => {
    expect(edgeWidth(1, 1)).toBe(1.5);
  });

  it('never exceeds the maximum, even if a count somehow exceeds the max', () => {
    expect(edgeWidth(50, 10)).toBeCloseTo(5);
  });
});
