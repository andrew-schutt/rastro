// examples/demo-app/src/App.tsx
// A real-ish app to dogfood on. Everything below is captured with ZERO instrumentation —
// no handlers call the SDK. The one exception is the `track()` call, which demonstrates the
// Level-2 enrichment escape hatch from §3.
//
// Between them these exercise every event the conventions define for capture:
//   ux.click         every button and link
//   ux.route_change  the nav (pushState, no reload)
//   ux.form_submit   the settings form
//   ux.form_abandon  focus a field, then click away without submitting
import { useEffect, useState, type ReactElement } from 'react';
import { useTelemetry } from 'rastro-react';

/** Routes with a dynamic segment, so path tokenization is visible in the dashboard. */
const ROUTES = ['/', '/users/42/settings', '/orders/10482'] as const;

function Nav(): ReactElement {
  const [path, setPath] = useState(location.pathname);

  // A hand-rolled router: pushState with no reload, which is exactly what the
  // historyRouteAdapter patches. A real app would use React Router here.
  useEffect(() => {
    const onPopState = (): void => setPath(location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const go = (to: string): void => {
    history.pushState({}, '', to);
    setPath(to);
  };

  return (
    <nav>
      {ROUTES.map((route) => (
        <button
          key={route}
          type="button"
          onClick={() => go(route)}
          aria-current={route === path ? 'page' : undefined}
        >
          {route}
        </button>
      ))}
    </nav>
  );
}

function SettingsForm(): ReactElement {
  const [saved, setSaved] = useState(false);

  return (
    <form
      // Deliberately NO data-telemetry-id: the override matches an ANCESTOR, so putting one
      // here would collapse every field inside into the form's identity. Left off so the
      // demo shows real derived fingerprints.
      onSubmit={(event) => {
        event.preventDefault();
        setSaved(true);
      }}
    >
      <h2>Profile</h2>
      <p>
        <label>
          Display name <input name="name" defaultValue="" />
        </label>
      </p>
      <p>
        <label>
          Email <input name="email" type="email" defaultValue="" />
        </label>
      </p>
      <p>
        {/* The override makes this the one element with a real, stable identity today. */}
        <button type="submit" data-telemetry-id="save-profile">
          Save Profile
        </button>{' '}
        <button type="button">A button with no telemetry id</button>
      </p>
      {saved && <p>Saved.</p>}
      <p className="hint">
        Focus a field then click a nav button without submitting — that is
        <code> ux.form_abandon</code>.
      </p>
    </form>
  );
}

export function App(): ReactElement {
  const { track, flush, sessionId } = useTelemetry();

  // Level-2 enrichment (§3): a custom event autocapture could not know to emit. The props
  // dogfood §4.9 — `plan` and `seats` arrive untouched, `owner` is redacted before it leaves
  // the browser, and `ux.seq` is dropped because apps do not write to reserved namespaces.
  useEffect(() => {
    track('demo.session_ready', {
      plan: 'pro',
      seats: 3,
      owner: 'jane@example.com',
      'ux.seq': 999,
    });
    void flush();
  }, [track, flush]);

  return (
    <main>
      <h1>Rastro demo app</h1>
      <p>
        session <code>{sessionId}</code>
      </p>

      <Nav />
      <SettingsForm />

      <p className="hint">
        Everything here is captured with no instrumentation. Open the dashboard at{' '}
        <a href="http://localhost:5173">localhost:5173</a> — events appear within ~2s.
      </p>
    </main>
  );
}
