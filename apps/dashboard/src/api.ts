// apps/dashboard/src/api.ts
// The collector is the only backend (§19.1), so this is the whole data layer. Requests are
// same-origin in dev via the Vite proxy in vite.config.ts.
import type { FlowGraph, Session, UxEvent } from 'rastro-core';
import type { FrictionByNode, FrictionSignal } from 'rastro-analysis';

export interface EventsResponse {
  app: string;
  events: UxEvent[];
}

export interface SessionResponse {
  app: string;
  session: Session;
  events: UxEvent[];
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Every stored event for an app — what the step-1 table renders. */
export function fetchEvents(app: string): Promise<EventsResponse> {
  return get<EventsResponse>(`/projects/${encodeURIComponent(app)}/events`);
}

/** One session, sessionized (§13.1). */
export function fetchSession(app: string, sessionId: string): Promise<SessionResponse> {
  return get<SessionResponse>(
    `/projects/${encodeURIComponent(app)}/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export interface GraphResponse {
  app: string;
  /** How many sessions and events the graph was aggregated from. */
  sessions: number;
  events: number;
  graph: FlowGraph;
  /** §10 signals rolled up per element, ranked by sessions affected. */
  friction: FrictionByNode[];
  /** The individual occurrences behind the roll-up. */
  signals: FrictionSignal[];
}

/** The aggregate flow across every stored session (§19.3, §9). */
export function fetchGraph(app: string, minEdgeCount = 1): Promise<GraphResponse> {
  return get<GraphResponse>(
    `/projects/${encodeURIComponent(app)}/graph?minEdgeCount=${minEdgeCount}`,
  );
}
