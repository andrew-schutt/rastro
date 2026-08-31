// packages/react/src/useTelemetry.ts
// Optional enrichment where auto-capture isn't enough (README "Quick start"):
//   const { track } = useTelemetry();
//   track("profile.saved");
import { useContext, useMemo } from 'react';
import { buildEvent } from './capture.js';
import { RastroContext } from './context.js';

/** Attribute values a custom event may carry. Props become attributes (SEMANTIC-CONVENTIONS). */
export type TrackProps = Record<string, string | number | boolean>;

export interface Telemetry {
  /**
   * Emit a custom event.
   *
   * `name` MUST be static and dot-separated with no dynamic values in it — identifiers and
   * per-occurrence data go in `props`. Names SHOULD be namespaced to the app
   * (`checkout.completed`).
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

  const { state, transport } = context;

  return useMemo<Telemetry>(
    () => ({
      sessionId: state.sessionId,
      flush: () => transport.flush(),
      track: (name, props) => {
        // A custom event still carries the Required set — `ux.fingerprint` included. The
        // event name IS the identity for a tracked call, so it doubles as the fingerprint.
        const event = buildEvent(state, { eventName: name, fingerprint: `id:${name}` });

        // TODO: props are dropped. The convention says they become attributes, but they need
        // to go through the Redactor seam first (§4.9) — a `track("saved", { email })` call
        // would otherwise put raw user content on the wire, which is exactly the leak the
        // "metadata, not content" default exists to prevent.
        void props;

        transport.enqueue(event);
      },
    }),
    [state, transport],
  );
}
