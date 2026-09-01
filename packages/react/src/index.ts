// packages/react/src/index.ts — rastro-react, the SDK devs install.
export { RastroProvider } from './Provider.js';
export type { RastroProviderProps } from './Provider.js';

export { useTelemetry } from './useTelemetry.js';
export type { Telemetry, TrackProps } from './useTelemetry.js';

export {
  buildEvent,
  createSessionState,
  interactionMethodOf,
  sanitizeProps,
  startCapture,
} from './capture.js';
export type {
  BuildEventInput,
  CaptureOptions,
  InteractionSource,
  OptInAttributes,
  SessionState,
} from './capture.js';

export { MAX_DWELL_MS, cappedDwell, createActiveClock } from './dwell.js';
export type { ActiveClock, ActiveClockOptions } from './dwell.js';

export { createFormTracker } from './forms.js';
export type { FormOutcome, FormTracker } from './forms.js';

export { historyRouteAdapter } from './route.js';

export { createTransport, DEFAULT_FLUSH_INTERVAL_MS, DEFAULT_MAX_BATCH_SIZE } from './transport.js';
export type { Transport, TransportOptions } from './transport.js';

export { otlpExporter, sendBeaconOtlp } from './exporters/otlp.js';
export type { OtlpExporterOptions } from './exporters/otlp.js';
export { consoleExporter } from './exporters/console.js';
export type { ConsoleExporterOptions } from './exporters/console.js';
export { multiExporter } from './exporters/multi.js';

export { SCOPE_NAME, toOtlpLogs } from './otlp.js';
export type { OtlpLogsPayload } from './otlp.js';

// Re-exported so an app that only installs rastro-react still gets the contract.
export type {
  ElementDescription,
  Exporter,
  Redactor,
  RouteAdapter,
  UxEvent,
} from 'rastro-core';
export { describeElement, fingerprint } from 'rastro-core';
export { defaultRedactor, noopRedactor } from 'rastro-core';
