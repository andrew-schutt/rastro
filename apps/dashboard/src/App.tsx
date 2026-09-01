// apps/dashboard/src/App.tsx
// Two views over the same collector: the aggregate flow graph (§19.4 step 5) and the raw
// events table that step 1 started with. Selecting a session opens its timeline (§13.1).
//
// The events table survives the "swap the table for FlowGraph" instruction on purpose: it is
// how you find a session to inspect, and while fingerprinting is still v1 it is how you spot
// a false merge or split in the raw data — which §4.2.1 says is the whole point of a
// readable fingerprint.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { FlowGraph as FlowGraphData, Session, UxEvent } from 'rastro-core';
import { fetchEvents, fetchGraph, fetchSession } from './api.js';
import { FlowGraph } from './FlowGraph.js';
import { SessionTimeline } from './SessionTimeline.js';

const DEFAULT_APP = 'demo-app';
const POLL_MS = 2_000;

type View = 'flow' | 'events';

export function App(): ReactElement {
  const [app, setApp] = useState(DEFAULT_APP);
  const [view, setView] = useState<View>('flow');
  const [events, setEvents] = useState<UxEvent[]>([]);
  const [graph, setGraph] = useState<FlowGraphData | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [eventsResponse, graphResponse] = await Promise.all([
        fetchEvents(app),
        fetchGraph(app),
      ]);
      setEvents(eventsResponse.events);
      setGraph(graphResponse.graph);
      setSessionCount(graphResponse.sessions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [app]);

  useEffect(() => {
    void load();
    // Poll rather than push: no websocket, no state to keep in sync, and a click in the demo
    // app shows up here within a couple of seconds without a reload.
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const openSession = async (sessionId: string): Promise<void> => {
    try {
      setSession((await fetchSession(app, sessionId)).session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <main>
      <header>
        <h1>Rastro</h1>
        <label>
          app{' '}
          <input value={app} onChange={(event) => setApp(event.target.value)} spellCheck={false} />
        </label>

        <nav className="views">
          {(['flow', 'events'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={view === candidate ? 'view view--active' : 'view'}
              onClick={() => setView(candidate)}
            >
              {candidate === 'flow' ? 'Flow' : 'Events'}
            </button>
          ))}
        </nav>

        <span className="count">
          {sessionCount} session{sessionCount === 1 ? '' : 's'} · {events.length} events
        </span>
      </header>

      {error !== null && <p className="error">{error}</p>}

      {events.length === 0 && error === null && (
        <p className="note">
          No events yet. Start the collector, then run <code>examples/demo-app</code> and use it.
        </p>
      )}

      {view === 'flow' && graph !== null && <FlowGraph graph={graph} />}

      {view === 'events' && events.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>seq</th>
              <th>event</th>
              <th>ux.fingerprint</th>
              <th>url.path</th>
              <th>method</th>
              <th>active_ms</th>
              <th>session.id</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const attributes = event.attributes;
              const sessionId = attributes['session.id'];

              return (
                <tr key={attributes['ux.event_id']}>
                  <td>{attributes['ux.seq']}</td>
                  <td>{event.eventName}</td>
                  <td>
                    <code>{attributes['ux.fingerprint']}</code>
                  </td>
                  <td>{attributes['url.path']}</td>
                  <td>{attributes['ux.interaction.method'] ?? '—'}</td>
                  <td>{attributes['ux.active_ms'] ?? '—'}</td>
                  <td>
                    {/* §13.1: one session is the easiest real view, so make it one click away. */}
                    <button type="button" onClick={() => void openSession(sessionId)}>
                      {sessionId.slice(0, 8)}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {session !== null && <SessionTimeline session={session} />}
    </main>
  );
}
