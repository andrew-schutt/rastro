// apps/dashboard/src/SessionTimeline.tsx
// One session on a time axis (docs/PLAN.md §13.1). PLACEHOLDER.
//
// §19.4 builds this properly at step 4, after real capture and fingerprinting exist — until
// then every fingerprint is `unknown|<tag>` and a timeline of those says nothing. What is
// real here is the data path: the session comes back already sessionized, ordered by ux.seq.
import type { ReactElement } from 'react';
import type { Session } from 'rastro-core';

export interface SessionTimelineProps {
  session: Session;
}

export function SessionTimeline({ session }: SessionTimelineProps): ReactElement {
  // Cumulative dwell is the time axis (§13.1). `activeMs` is the gap BEFORE each step, so the
  // running total up to (not including) a step is when that step happened.
  let elapsedMs = 0;

  return (
    <section className="timeline">
      <h2>
        Session <code>{session.sessionId}</code>
      </h2>
      <p className="note">
        Placeholder — §19.4 step 4. The ordering is real (ux.seq); the fingerprints are not
        yet, because capture and fingerprinting are still stubs.
      </p>

      <ol className="steps">
        {session.steps.map((step) => {
          const at = elapsedMs;
          elapsedMs += step.activeMs;

          return (
            <li key={step.seq}>
              <span className="at">+{(at / 1000).toFixed(1)}s</span>
              <span className="seq">#{step.seq}</span>
              <code className="fingerprint">{step.fingerprint}</code>
              <span className="route">{step.route}</span>
              <span className="dwell">{step.activeMs}ms</span>
            </li>
          );
        })}
      </ol>

      {/* TODO(§13.1): a real time axis, not a list — proportional spacing, and each event
          showing ux.interaction.method alongside the dwell gap before it. */}
    </section>
  );
}
