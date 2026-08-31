// packages/core/src/index.ts
// The shared contract. No React, no Node APIs — portable and trivially testable.
export type { UxEvent } from './events.js';
export {
  isUxEvent,
  REQUIRED_ATTRIBUTES,
  SESSION_END,
  SESSION_START,
  SEVERITY_INFO,
  UX_CONVENTION_VERSION,
} from './events.js';

export type { FlowEdge, FlowGraph, FlowNode, Session, Step } from './shapes.js';

export type {
  EventStore,
  Exporter,
  FingerprintStrategy,
  GraphBuilder,
  Interpreter,
  Recommendation,
  Redactor,
  RouteAdapter,
} from './seams.js';

export {
  defaultFingerprintStrategy,
  fingerprint,
  OVERRIDE_ATTRIBUTE,
  UNKNOWN_CHAIN,
} from './fingerprint.js';
export { defaultRedactor, redact, REDACTED } from './redact.js';
