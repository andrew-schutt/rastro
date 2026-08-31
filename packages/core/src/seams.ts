// packages/core/src/seams.ts
// Every deliberate swap point (docs/PLAN.md §19.5).
//
// The rule: depend on a small interface at any boundary where a reasonable person would want
// a different implementation. Defining the interface is the whole win — the alternate
// implementations come when someone actually wants them, not on day one.
import type { UxEvent } from './events.js';
import type { FlowGraph, Session } from './shapes.js';

/**
 * Storage seam. Default: SQLite (`apps/collector/src/db.ts`).
 * Swap for: Postgres, ClickHouse (§8), an in-memory fake in tests.
 *
 * Methods may be sync or async — better-sqlite3 is synchronous, a Postgres driver is not.
 * Callers `await` regardless.
 */
export interface EventStore {
  /** Insert a batch. MUST be idempotent on `ux.event_id`: retried batches reuse it (§4.4). */
  insert(events: UxEvent[]): Promise<void> | void;
  /** Every stored event for an app, newest-first by observed time. Powers the step-1 table. */
  listByApp(app: string, limit?: number): Promise<UxEvent[]> | UxEvent[];
  /** One session's events (§13.1). Ordering is the caller's job — sessionize sorts by ux.seq. */
  listBySession(app: string, sessionId: string): Promise<UxEvent[]> | UxEvent[];
  close(): Promise<void> | void;
}

/**
 * Exporter seam (§19.6). Default: OTLP over HTTP to your collector.
 * Swap for: an OTel Collector, PostHog/Segment/Amplitude adapters, fan-out, custom.
 *
 * Batching and the flush lifecycle live ABOVE this, in `transport.ts` — the exporter only
 * answers "deliver this batch, and in whose shape."
 */
export interface Exporter {
  export(batch: UxEvent[]): Promise<void> | void;   // UxEvent = OTel Event record (§19.2)
}

/**
 * Fingerprint seam (§4.2.1). Default: React fiber component chain + role + accessible name.
 * Swap for: manual-only (`data-telemetry-id`), a hybrid, or something app-specific.
 */
export interface FingerprintStrategy {
  /** Stable element identity. Opaque to consumers — they join on it, they don't parse it. */
  fingerprint(element: Element): string;
}

/**
 * Redaction seam (§4.9). Default: regex email/number strip.
 * Swap for: enterprise DLP rules, or a no-op inside a trusted internal app.
 *
 * Runs on `ux.accessible_name` BEFORE it enters the fingerprint, and on `url.path`.
 */
export interface Redactor {
  redact(text: string): string;
}

/**
 * Route-detection seam (§4.6). Default: `history` patch.
 * Swap for: React Router, Next App/Pages Router, TanStack Router.
 *
 * Budget this as per-router integration work, not one function.
 */
export interface RouteAdapter {
  /** The current route, already tokenized (`/users/:id`) and PII-stripped. */
  current(): string;
  /** Subscribe to route changes. Returns an unsubscribe function. */
  subscribe(onChange: (path: string) => void): () => void;
}

/**
 * Graph-building seam (§19.3). Default: the transition graph.
 * Swap for: a real process-mining miner (§8).
 */
export interface GraphBuilder {
  build(sessions: Session[]): FlowGraph;
}

/**
 * Interpretation seam (§11). Default: `none` — and that default is the point. "AI is not the
 * engine" only becomes real in code if the analytics stand on their own with no Interpreter
 * wired in at all.
 */
export interface Interpreter {
  interpret(graph: FlowGraph): Promise<Recommendation[]> | Recommendation[];
}

/**
 * The recommendation shape from §11: Observation · Evidence · Hypothesis · Recommendation ·
 * Confidence · Expected outcome.
 *
 * `confidence` is deliberately qualitative. A numeric "72%" is theater until it is a
 * calibrated probability tied to a measured outcome (§11), and fabricated precision is the
 * fastest way to lose a serious reviewer's trust.
 */
export interface Recommendation {
  observation: string;
  evidence: string[];
  hypothesis: string;
  recommendation: string;
  confidence: 'weak' | 'moderate' | 'strong';
  expectedOutcome: string;
}
