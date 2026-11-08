// packages/react/src/otlp.ts
// UxEvent[] → the OTLP/HTTP logs envelope, under the SDK's own scope.
//
// The codec itself lives in `rastro-core` (otlp.ts), shared with the collector's decoder so
// the two cannot drift. This file only pins the scope and keeps the published
// `toOtlpLogs(batch)` signature.
import type { OtlpLogsPayload, UxEvent } from 'rastro-core';
import { encodeOtlpLogs } from 'rastro-core';

export type { OtlpLogsPayload };

export const SCOPE_NAME = 'rastro-react';

export function toOtlpLogs(batch: UxEvent[]): OtlpLogsPayload {
  return encodeOtlpLogs(batch, { name: SCOPE_NAME });
}
