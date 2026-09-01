// apps/dashboard/src/FlowGraph.tsx
// The flow graph (docs/PLAN.md §19.4 step 5, §9) — the headline view.
//
// Thin by design: `FlowGraph` maps almost 1:1 onto React Flow's nodes/edges props, so all
// this does is translate and style. Every number on screen was computed by `buildGraph`,
// which is pure and unit-tested; nothing is derived here.
import { useEffect, useMemo, type ReactElement } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  Position,
  useReactFlow,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { FlowGraph as FlowGraphData } from 'rastro-core';
import { DEFAULT_MIN_DROPOFF_RATE, labelFor, type FrictionByNode } from 'rastro-analysis';
import { NODE_HEIGHT, NODE_WIDTH, edgeWidth, layoutGraph } from './layout.js';
import { formatMs } from './timeline.js';

export interface FlowGraphProps {
  graph: FlowGraphData;
  /** §10 signals, rolled up per element and ranked. */
  friction: FrictionByNode[];
}

const DROPOFF_COLOR = '#d1892f';
const FRICTION_COLOR = '#d0454c';

/**
 * Re-fit the viewport when the set of nodes changes.
 *
 * `fitView` on `<ReactFlow>` only runs at mount. The dashboard polls, so a graph that grows
 * while you watch it grows straight off the bottom of the viewport — which is exactly what a
 * live capture of the thing showed. Keyed on the node ids rather than a render count, so
 * panning around a graph that is not changing is left alone.
 */
function FitOnGrowth({ nodeKey }: { nodeKey: string }): null {
  const { fitView } = useReactFlow();

  useEffect(() => {
    // A frame's delay: the new nodes must be measured before a fit can include them.
    const timer = setTimeout(() => fitView({ padding: 0.12, minZoom: 0.7, maxZoom: 1 }), 50);
    return () => clearTimeout(timer);
  }, [nodeKey, fitView]);

  return null;
}

export function FlowGraph({ graph, friction }: FlowGraphProps): ReactElement {
  const { nodes, edges } = useMemo(() => {
    const positioned = layoutGraph(graph);
    const frictionByFingerprint = new Map(friction.map((entry) => [entry.fingerprint, entry]));
    // An edge is amber when it LEAVES a node the friction layer flagged as high-abandonment —
    // not when its own dropoffRate clears a threshold written here. Same source, so the graph
    // and the list below it cannot disagree, and the edge inherits detectFriction's evidence
    // floor: previously a single session ending anywhere lit an edge up.
    const abandoned = new Set(
      friction
        .filter((entry) => entry.kinds.includes('high_abandonment'))
        .map((entry) => entry.fingerprint),
    );
    const maxCount = graph.edges.reduce((max, edge) => Math.max(max, edge.count), 0);
    const maxHits = graph.nodes.reduce((max, node) => Math.max(max, node.hits), 0);

    const flowNodes: Node[] = positioned.map(({ node, x, y }) => {
      const signals = frictionByFingerprint.get(node.id);

      return {
      id: node.id,
      position: { x, y },
      // The full fingerprint is the title, since the label is a display-only shortening.
      data: {
        label: (
          <div className="node" title={node.id}>
            <span className="node-label">{node.label}</span>
            {signals !== undefined && (
              <span
                className="node-friction"
                title={`${signals.kinds.join(', ')} — ${signals.sessions} session(s)`}
              >
                {signals.sessions}
              </span>
            )}
            <span className="node-hits">{node.hits}</span>
          </div>
        ),
      },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        // Busier nodes read as heavier, so the main path is visible before reading anything.
        opacity: maxHits === 0 ? 1 : 0.55 + 0.45 * (node.hits / maxHits),
        ...(signals === undefined ? {} : { borderColor: FRICTION_COLOR, borderWidth: 2 }),
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      };
    });

    const flowEdges: Edge[] = graph.edges.map((edge) => {
      const heavyDropoff = abandoned.has(edge.from);

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
  }, [graph, friction]);

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
          <FitOnGrowth nodeKey={nodes.map((node) => node.id).join('|')} />
          <Background gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <p className="legend">
        Edge label is <strong>sessions × median dwell</strong>; thickness scales with sessions.
        An amber edge leaves a node where at least{' '}
        {Math.round(DEFAULT_MIN_DROPOFF_RATE * 100)}% of sessions ended. A red outline marks
        friction (§10), with the count of sessions affected.
      </p>

      {friction.length > 0 && (
        <section className="friction">
          <h2>Friction</h2>
          {/* §11: rank, and surface only the top few. 47 signals a week and nobody reads any. */}
          <ol>
            {friction.slice(0, 5).map((entry) => (
              <li key={entry.fingerprint}>
                <span className="friction-kind">{entry.kinds.join(' + ')}</span>
                <code title={entry.fingerprint}>{labelFor(entry.fingerprint)}</code>
                <span className="friction-detail">
                  {entry.sessions} session{entry.sessions === 1 ? '' : 's'} ·{' '}
                  {entry.kinds[0] === 'rage_click'
                    ? `up to ${entry.maxMagnitude} clicks`
                    : `${entry.maxMagnitude}% ended here`}
                </span>
              </li>
            ))}
          </ol>
          {/* §12: correlation is not causation, and this must never read as a diagnosis. */}
          <p className="note">
            These patterns <em>may</em> indicate friction. A rage click can equally be a slow
            network or an unresponsive handler; an exit point can be where the task legitimately
            finishes.
          </p>
        </section>
      )}
    </>
  );
}
