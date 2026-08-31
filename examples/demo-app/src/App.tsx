// examples/demo-app/src/App.tsx
// Walking-skeleton step 1 (§19.4): "hardcode one event in demo-app and watch it travel the
// whole pipe."
import { useEffect, useState, type ReactElement } from 'react';
import { useTelemetry } from 'rastro-react';

export function App(): ReactElement {
  const { track, flush, sessionId } = useTelemetry();
  const [sent, setSent] = useState(0);

  // THE hardcoded event. One on mount, flushed immediately rather than waiting out the batch
  // interval, so the dashboard table fills in without you wondering whether it worked.
  //
  // The props dogfood §4.9: `plan` and `seats` arrive as attributes untouched, `owner` is
  // redacted before it leaves the browser, and `ux.seq` is dropped because apps do not get
  // to write into a reserved namespace. Check the stored record at
  // /projects/demo-app/events to see all three.
  useEffect(() => {
    track('demo.hello', {
      plan: 'pro',
      seats: 3,
      owner: 'jane@example.com',
      'ux.seq': 999,
    });
    void flush().then(() => setSent((n) => n + 1));
  }, [track, flush]);

  return (
    <main>
      <h1>Rastro demo app</h1>
      <p>
        session <code>{sessionId}</code>
      </p>
      <p>
        Sent {sent} hardcoded event{sent === 1 ? '' : 's'} to the collector.
      </p>

      <p>
        {/* Clicking exercises the delegated root listener in capture.ts. That listener is a
            STUB: the event is real and travels the whole pipe, but its ux.fingerprint is a
            placeholder until §19.4 steps 2 and 3. The data-telemetry-id override IS real,
            so this button fingerprints as `id:demo-save`. */}
        <button type="button" data-telemetry-id="demo-save" onClick={() => void flush()}>
          Save Profile
        </button>{' '}
        <button type="button" onClick={() => void flush()}>
          A button with no telemetry id
        </button>
      </p>

      <p style={{ opacity: 0.6 }}>
        Open the dashboard at <a href="http://localhost:5173">localhost:5173</a> to see these
        events in the table.
      </p>
    </main>
  );
}
