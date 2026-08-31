// packages/react/src/useTelemetry.ts
// Optional enrichment where auto-capture isn't enough (README "Quick start"):
//   const { track } = useTelemetry();
//   track("profile.saved");
import { useContext, useMemo } from 'react';
import { buildEvent, sanitizeProps, type TrackProps } from './capture.js';
import { RastroContext } from './context.js';

/** Attribute values a custom event may carry. Props become attributes (the conventions). */
export type { TrackProps };

export interface Telemetry {
  /**
   * Emit a custom event.
   *
   * `name` MUST be static and dot-separated with no dynamic values in it — identifiers and
   * per-occurrence data go in `props`. Names SHOULD be namespaced to the app
   * (`checkout.completed`).
   *
   * String props are redacted and reserved-namespace keys are dropped (§4.9). Numeric props
   * pass through untouched — see `sanitizeProps` for why, and for what that does not cover.
   */
  track(name: string, props?: TrackProps): void;
  /** Force a flush. Useful right before a deliberate navigation. */
  flush(): Promise<void>;
  /** The current `session.id` — the handle for GET /projects/:app/sessions/:id (§13.1). */
  sessionId: string;
}

export function useTelemetry(): Telemetry {
  const context = useContext(RastroContext);

  if (context === null) {
    throw new Error('useTelemetry: no <RastroProvider> above this component.');
  }

  const { state, transport, redactor } = context;

  return useMemo<Telemetry>(
    () => ({
      sessionId: state.sessionId,
      flush: () => transport.flush(),
      track: (name, props) => {
        // A custom event still carries the Required set — `ux.fingerprint` included. The
        // event name IS the identity for a tracked call, so it doubles as the fingerprint.
        transport.enqueue(
          buildEvent(
            state,
            {
              eventName: name,
              fingerprint: `id:${name}`,
              attributes: sanitizeProps(props, redactor),
            },
            redactor,
          ),
        );
      },
    }),
    [state, transport, redactor],
  );
}
