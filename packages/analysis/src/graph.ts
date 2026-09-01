// packages/analysis/src/graph.ts
// Session[] -> FlowGraph (docs/PLAN.md §19.3, §9). The aggregate view, and where the
// intelligence lives — `FlowGraph` maps almost 1:1 onto React Flow's nodes/edges props, so
// the dashboard stays thin by design.
import type { FlowEdge, FlowGraph, FlowNode, GraphBuilder, Session, Step } from 'rastro-core';

// Re-exported so the import path documented in §19.3 holds (declarations live in core).
export type { FlowEdge, FlowGraph, FlowNode } from 'rastro-core';

export interface BuildGraphOptions {
  /**
   * Drop transitions made by fewer than this many sessions. The first move of §8's
   * spaghetti-taming: a real app produces a hairball, and the long tail of one-off paths is
   * most of it.
   *
   * Defaults to 1 — no pruning — because silently hiding data is worse than an ugly graph
   * until someone chooses otherwise.
   */
  minEdgeCount?: number;
}

/** Separator for the edge key. NUL cannot appear in a fingerprint, so this cannot collide. */
const EDGE_KEY_SEPARATOR = '\u0000';

/**
 * A short, human-readable label for a node. **Display only.**
 *
 * ⚠ This parses the fingerprint, and the conventions say consumers SHOULD treat it as opaque
 * and SHOULD NOT parse it for meaning. The distinction being relied on: nothing here feeds a
 * metric or a join — `FlowNode.id` remains the whole fingerprint, and that is what every
 * count, rate, and edge is keyed on. This only decides what text sits inside a box on screen,
 * and it degrades to the raw fingerprint whenever the shape is unfamiliar.
 *
 * Tied to the v1 fingerprint format (§4.2.1). If that format changes, this is the only thing
 * that needs updating, precisely because nothing else parses it.
 */
export function labelFor(fingerprint: string): string {
  // A label is what sits inside a box on screen, so an empty one is an unreadable node.
  // Every branch below falls back to the raw fingerprint rather than returning nothing.
  // `id:save-profile` — an explicit data-telemetry-id override.
  if (fingerprint.startsWith('id:')) return fingerprint.slice(3) || fingerprint;
  // `route:/orders/:id` — a route change; the path IS the identity.
  if (fingerprint.startsWith('route:')) return fingerprint.slice(6) || fingerprint;

  const [chain = '', role = '', quotedName] = fingerprint.split('|');

  // Prefer the accessible name: it is what the user actually saw on the element.
  if (quotedName !== undefined) {
    const name = quotedName.replace(/^"|"$/g, '').trim();
    if (name !== '') return name;
  }

  // No name (an input, say). The innermost component plus the role is the next best thing.
  const innermost = chain.split('>').at(-1) ?? '';
  if (innermost !== '' && innermost !== 'unknown') return `${innermost} ${role}`.trim();
  if (role !== '') return role;

  return fingerprint;
}

/**
 * Median of a list.
 *
 * Median rather than mean, deliberately: dwell is long-tailed, and one session where somebody
 * walked away from the desk would drag a mean somewhere meaningless.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Mutable accumulator for one edge while walking sessions. */
interface EdgeTally {
  from: string;
  to: string;
  /** Sessions that made this transition. `count` is its size — see FlowEdge. */
  sessions: Set<string>;
  /** Dwell on `from` before each traversal. One entry per traversal, not per session. */
  dwells: number[];
}

/**
 * Build the transition graph.
 *
 * For each session, walk consecutive step pairs -> tally edges; aggregate node hits; compute
 * `medianMs` and `dropoffRate` per edge.
 *
 * Two definitions worth being explicit about, because they are easy to assume wrongly:
 *
 * - **`count` is sessions, not traversals** — §19.3's field comment says "how many sessions
 *   made this A→B transition". One session bouncing A→B→A→B contributes 1. That makes edge
 *   weight answer "how common is this path across users" rather than letting a single
 *   hammering user dominate. `medianMs` still samples every traversal, because more samples
 *   make a better median.
 * - **`dropoffRate` is a property of `from`**, reported on each of its outgoing edges, so
 *   every edge leaving a node carries the same value. That is what §19.3 specifies; it is
 *   redundant on the wire and arguably belongs on `FlowNode`. Worth settling before the shape
 *   ossifies.
 *
 * Output is sorted by id and by (from, to), so the same sessions in any order give an
 * identical graph.
 */
export function buildGraph(
  sessions: Session[],
  { minEdgeCount = 1 }: BuildGraphOptions = {},
): FlowGraph {
  const hits = new Map<string, number>();
  const edges = new Map<string, EdgeTally>();
  /** Sessions that reached a fingerprint at all. Denominator of dropoffRate. */
  const reached = new Map<string, Set<string>>();
  /** Sessions whose LAST step was this fingerprint. Numerator of dropoffRate. */
  const endedAt = new Map<string, Set<string>>();

  const addTo = (map: Map<string, Set<string>>, key: string, sessionId: string): void => {
    const existing = map.get(key);
    if (existing === undefined) map.set(key, new Set([sessionId]));
    else existing.add(sessionId);
  };

  for (const { sessionId, steps } of sessions) {
    for (const step of steps) {
      hits.set(step.fingerprint, (hits.get(step.fingerprint) ?? 0) + 1);
      // A session that visits a node twice still counts once — it is one user reaching it.
      addTo(reached, step.fingerprint, sessionId);
    }

    const last: Step | undefined = steps.at(-1);
    if (last !== undefined) addTo(endedAt, last.fingerprint, sessionId);

    for (let index = 1; index < steps.length; index += 1) {
      const from = steps[index - 1];
      const to = steps[index];
      if (from === undefined || to === undefined) continue;

      const key = `${from.fingerprint}${EDGE_KEY_SEPARATOR}${to.fingerprint}`;
      let tally = edges.get(key);
      if (tally === undefined) {
        tally = { from: from.fingerprint, to: to.fingerprint, sessions: new Set(), dwells: [] };
        edges.set(key, tally);
      }

      tally.sessions.add(sessionId);
      // `activeMs` is the dwell BEFORE a step, so the time spent on `from` before moving to
      // `to` is the dwell recorded on `to`.
      tally.dwells.push(to.activeMs);
    }
  }

  const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  const nodes: FlowNode[] = [...hits]
    .map(([id, count]) => ({ id, label: labelFor(id), hits: count }))
    .sort((a, b) => byString(a.id, b.id));

  const flowEdges: FlowEdge[] = [...edges.values()]
    .filter((tally) => tally.sessions.size >= minEdgeCount)
    .map((tally) => {
      const reachedFrom = reached.get(tally.from)?.size ?? 0;
      const endedAtFrom = endedAt.get(tally.from)?.size ?? 0;

      return {
        from: tally.from,
        to: tally.to,
        count: tally.sessions.size,
        medianMs: Math.round(median(tally.dwells)),
        dropoffRate: reachedFrom === 0 ? 0 : endedAtFrom / reachedFrom,
      };
    })
    .sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to));

  return { nodes, edges: flowEdges };
}

/**
 * The default `GraphBuilder` implementation (§19.5).
 *
 * TODO(§8): this is a transition graph, which is the simple end of process mining. The seam
 * exists so a real miner can replace it — and §8's spaghetti-taming needs more than
 * `minEdgeCount`: collapsing loops, and folding the long tail into an "other" edge rather
 * than deleting it.
 */
export const transitionGraphBuilder: GraphBuilder = { build: (sessions) => buildGraph(sessions) };
