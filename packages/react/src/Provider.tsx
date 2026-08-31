// packages/react/src/Provider.tsx
// The whole integration surface (README "Quick start"):
//   <RastroProvider app="my-app" exporter={otlpExporter({ endpoint: "/v1/logs" })}>
//
// Zero-config first (§ design principles): baseline value from the provider alone.
import { useEffect, useMemo, type ReactNode } from 'react';
import type { Exporter, RouteAdapter, Redactor } from 'rastro-core';
import { defaultRedactor } from 'rastro-core';
import { createSessionState, startCapture } from './capture.js';
import { RastroContext, type RastroContextValue } from './context.js';
import { createTransport } from './transport.js';

export interface RastroProviderProps {
  /** `service.name` on the resource — the instrumented application. */
  app: string;
  /** Where events go (§19.6). Defaults are the caller's choice, never implicit. */
  exporter: Exporter;
  /** `service.version` — the deploy dimension behind "new behavior changes" (§13). */
  version?: string;
  /**
   * The §4.9 redaction policy (§19.5 seam). Defaults to email/number stripping plus
   * heuristic path tokenization. Pass `noopRedactor` only for a trusted internal app.
   */
  redactor?: Redactor;
  /**
   * Route detection (§4.6 seam). Defaults to patching `history`. Pass a router-specific
   * adapter where one exists — it reports the route PATTERN, which is both more accurate
   * and immune to `tokenizePath`'s blind spots.
   */
  routeAdapter?: RouteAdapter;
  /** Turn off the delegated root listeners and emit only via `track()`. */
  autoCapture?: boolean;
  children?: ReactNode;
}

export function RastroProvider({
  app,
  exporter,
  version,
  redactor = defaultRedactor,
  routeAdapter,
  autoCapture = true,
  children,
}: RastroProviderProps): ReactNode {
  // One session identity and one transport per provider instance. `exporter` is intentionally
  // NOT in the dependency list beyond identity: an inline `otlpExporter({...})` would
  // otherwise tear down and rebuild the transport on every render, losing the queue.
  const value = useMemo<RastroContextValue>(
    () => ({
      state: createSessionState(app, version),
      transport: createTransport({ exporter }),
      redactor,
    }),
    [app, version, exporter, redactor],
  );

  // §4.8: effects never run on the server, which is what keeps the provider safe to render
  // under Next. Nothing outside them touches the DOM or sets a timer.
  useEffect(() => {
    value.transport.start();
    return () => void value.transport.stop();
  }, [value]);

  useEffect(() => {
    if (!autoCapture) return;
    return startCapture({
      state: value.state,
      redactor: value.redactor,
      onEvent: (event) => value.transport.enqueue(event),
      ...(routeAdapter === undefined ? {} : { routeAdapter }),
    });
  }, [autoCapture, routeAdapter, value]);

  return <RastroContext.Provider value={value}>{children}</RastroContext.Provider>;
}
