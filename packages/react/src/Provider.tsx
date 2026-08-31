// packages/react/src/Provider.tsx
// The whole integration surface (README "Quick start"):
//   <RastroProvider app="my-app" exporter={otlpExporter({ endpoint: "/v1/logs" })}>
//
// Zero-config first (§ design principles): baseline value from the provider alone.
import { useEffect, useMemo, type ReactNode } from 'react';
import type { Exporter } from 'rastro-core';
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
  /** Turn off the delegated root listener and emit only via `track()`. */
  autoCapture?: boolean;
  children?: ReactNode;
}

export function RastroProvider({
  app,
  exporter,
  version,
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
    }),
    [app, version, exporter],
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
      onEvent: (event) => value.transport.enqueue(event),
    });
  }, [autoCapture, value]);

  return <RastroContext.Provider value={value}>{children}</RastroContext.Provider>;
}
