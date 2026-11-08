// packages/core/src/index.ts
// The shared contract. No React, no Node APIs — portable and trivially testable.
export type { AttributeValue, UxEvent } from './events.js';
export {
  isReservedAttribute,
  isUxEvent,
  RESERVED_ATTRIBUTE_NAMESPACES,
  REQUIRED_ATTRIBUTES,
  SESSION_END,
  SESSION_START,
  SEVERITY_INFO,
  UX_CONVENTION_VERSION,
} from './events.js';

export type { FlowEdge, FlowGraph, FlowNode, Session, Step } from './shapes.js';

export { DERIVED_SCOPE_NAME, isDerivedScope } from './derived.js';

export { decodeOtlpLogs, encodeOtlpLogs } from './otlp.js';
export type {
  AnyValue,
  DecodedLogRecord,
  LogRecord,
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpLogRecord,
  OtlpLogsPayload,
  OtlpScope,
} from './otlp.js';

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
  accName,
  attributeChain,
  COMPONENT_ATTRIBUTE,
  componentChain,
  defaultChainWalk,
  documentIsAnnotated,
  defaultFingerprintStrategy,
  describeElement,
  FIBER_PREFIXES,
  fingerprint,
  getFiber,
  INTERACTIVE_SELECTOR,
  MARK_PROPERTY,
  markedComponentChain,
  markedFiberWalk,
  MAX_CHAIN_DEPTH,
  MAX_NAME_LENGTH,
  NOISE,
  norm,
  OVERRIDE_ATTRIBUTE,
  overrideOf,
  resetAnnotationProbe,
  roleOf,
  SOURCE_FILE_ATTRIBUTE,
  UNKNOWN_CHAIN,
} from './fingerprint.js';
export type { ChainWalk, ComponentMark, ComponentWalk, ElementDescription } from './fingerprint.js';
export {
  defaultRedactor,
  noopRedactor,
  PATH_PARAM,
  redact,
  REDACTED,
  tokenizePath,
} from './redact.js';
