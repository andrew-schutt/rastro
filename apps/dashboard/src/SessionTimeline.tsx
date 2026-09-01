// apps/dashboard/src/SessionTimeline.tsx
// One session on a time axis (docs/DESIGN.md §13.1).
//
// §19.4 step 4, and the first real view: no cross-session aggregation, no mining, no
// spaghetti-taming — just one session's events ordered by ux.seq. §13.1 calls it the
// "replay-lite" from §12, the causation tool you get free from the event stream: a long
// pause before an element is the thing you are looking for, and here it is literally the
// tallest gap on the page.
//
// The data path is entirely the analysis layer's: the collector runs sessionize() over one
// session.id and returns Step[]. This component does no flattening and never touches a raw
// OTel record.
import type { ReactElement } from 'react';
import type { Session } from 'rastro-core';
import { formatMs, gapHeight, kindOf, placeSteps, totalActiveMs } from './timeline.js';

export interface SessionTimelineProps {
  session: Session;
}

export function SessionTimeline({ session }: SessionTimelineProps): ReactElement {
  const { steps } = session;
  const placed = placeSteps(steps);

  return (
    <section className="timeline">
      <header className="timeline-header">
        <h2>Session timeline</h2>
        <code className="session-id">{session.sessionId}</code>
        <span className="meta">
          {steps.length} step{steps.length === 1 ? '' : 's'} ·{' '}
          {formatMs(totalActiveMs(placed))} active
        </span>
      </header>

      {steps.length === 0 ? (
        <p className="note">This session has no steps.</p>
      ) : (
        <ol className="track">
          {placed.map(({ step, atMs }, index) => {
            const { label, kind } = kindOf(step);
            // The gap before this step. The first step has no predecessor to dwell after.
            const gap = index === 0 ? 0 : step.activeMs;
            const routeChanged = index > 0 && step.route !== placed[index - 1]?.step.route;

            return (
              <li key={step.seq}>
                {index > 0 && (
                  <div className="gap" style={{ height: `${gapHeight(gap)}px` }}>
                    <span className="gap-label">{formatMs(gap)}</span>
                  </div>
                )}

                <div className="step">
                  <span className="at">{formatMs(atMs)}</span>
                  <span className={`marker marker--${kind}`} aria-hidden="true" />
                  <span className="seq">#{step.seq}</span>
                  <span className={`kind kind--${kind}`} title={label}>
                    {label}
                  </span>
                  <code className="fingerprint" title={step.fingerprint}>
                    {step.fingerprint}
                  </code>
                  <span className={routeChanged ? 'route route--changed' : 'route'}>
                    {step.route}
                  </span>
                  <span className="method">{step.interactionMethod ?? ''}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
