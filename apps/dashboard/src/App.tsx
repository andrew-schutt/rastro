// apps/dashboard/src/App.tsx
// Walking-skeleton step 1 (§19.4): render stored events as a plain table.
//
// Unremarkable on purpose. Its job is to prove the pipe is alive end to end —
// demo-app → otlpExporter → POST /v1/logs → SQLite → here. The FlowGraph (React Flow) is
// step 5 and deliberately absent.
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Session, UxEvent } from 'rastro-core';
import { fetchEvents, fetchSession } from './api.js';
import { SessionTimeline } from './SessionTimeline.js';

const DEFAULT_APP = 'demo-app';

export function App(): ReactElement {
  const [app, setApp] = useState(DEFAULT_APP);
  const [events, setEvents] = useState<UxEvent[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await fetchEvents(app);
      setEvents(response.events);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [app]);

  useEffect(() => {
    void load();
    // Poll rather than push: no websocket, no state to keep in sync, and it means a click in
    // the demo app shows up here within a couple of seconds without a reload.
    const timer = setInterval(() => void load(), 2_000);
    return () => clearInterval(timer);
  }, [load]);

  const openSession = async (sessionId: string): Promise<void> => {
    try {
      const response = await fetchSession(app, sessionId);
      setSession(response.session);
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
        <span className="count">{events.length} events</span>
      </header>

      {error !== null && <p className="error">{error}</p>}

      {events.length === 0 && error === null && (
        <p className="note">
          No events yet. Start the collector, then run <code>examples/demo-app</code> and click
          its button.
        </p>
      )}

      {events.length > 0 && (
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

      {/* TODO(§19.4 step 5): replace this table with FlowGraph.tsx (React Flow). FlowGraph
          maps almost 1:1 onto React Flow's nodes/edges props, so that component stays thin —
          the intelligence lives in buildGraph. */}
    </main>
  );
}
