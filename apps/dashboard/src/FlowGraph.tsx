// apps/dashboard/src/FlowGraph.tsx
// The flow graph (docs/PLAN.md §19.4 step 5, §9) — the headline view.
//
// Thin by design: `FlowGraph` maps almost 1:1 onto React Flow's nodes/edges props, so all
// this does is translate and style. Every number on screen was computed by `buildGraph`,
// which is pure and unit-tested; nothing is derived here.
import { useMemo, type ReactElement } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { FlowGraph as FlowGraphData } from 'rastro-core';
import { NODE_HEIGHT, NODE_WIDTH, edgeWidth, layoutGraph } from './layout.js';
import { formatMs } from './timeline.js';

export interface FlowGraphProps {
  graph: FlowGraphData;
}

/** Drop-off high enough to be worth seeing on the graph rather than hunting for. */
const HIGH_DROPOFF = 0.5;
const DROPOFF_COLOR = '#d1892f';

export function FlowGraph({ graph }: FlowGraphProps): ReactElement {
  const { nodes, edges } = useMemo(() => {
    const positioned = layoutGraph(graph);
    const maxCount = graph.edges.reduce((max, edge) => Math.max(max, edge.count), 0);
    const maxHits = graph.nodes.reduce((max, node) => Math.max(max, node.hits), 0);

    const flowNodes: Node[] = positioned.map(({ node, x, y }) => ({
      id: node.id,
      position: { x, y },
      // The full fingerprint is the title, since the label is a display-only shortening.
      data: {
        label: (
          <div className="node" title={node.id}>
            <span className="node-label">{node.label}</span>
            <span className="node-hits">{node.hits}</span>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        // Busier nodes read as heavier, so the main path is visible before reading anything.
        opacity: maxHits === 0 ? 1 : 0.55 + 0.45 * (node.hits / maxHits),
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    }));

    const flowEdges: Edge[] = graph.edges.map((edge) => {
      const heavyDropoff = edge.dropoffRate >= HIGH_DROPOFF;

      return {
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        label: `${edge.count}× · ${formatMs(edge.medianMs)}`,
        labelShowBg: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          strokeWidth: edgeWidth(edge.count, maxCount),
          // §10's drop-off signal, shown rather than tabulated. Deliberately the ONLY
          // interpretation on this screen — the friction layer is step 6.
          ...(heavyDropoff ? { stroke: DROPOFF_COLOR } : {}),
        },
        ...(heavyDropoff ? { className: 'edge--dropoff' } : {}),
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [graph]);

  if (graph.nodes.length === 0) {
    return <p className="note">No flow yet — interact with the demo app and it will appear.</p>;
  }

  return (
    <>
      <div className="flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          // Cap how far fitView will zoom out: past roughly 0.7 the labels stop being
          // readable, and an unreadable overview is worth less than a readable slice the
          // reader can scroll. Controls has a fit-to-view button for the whole shape.
          fitViewOptions={{ padding: 0.12, minZoom: 0.7, maxZoom: 1 }}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <p className="legend">
        Edge label is <strong>sessions × median dwell</strong>; thickness scales with sessions.
        An amber edge leaves a node where at least {Math.round(HIGH_DROPOFF * 100)}% of sessions
        ended.
      </p>
    </>
  );
}
