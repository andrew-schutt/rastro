// packages/react/src/context.ts
// The context object RastroProvider publishes and useTelemetry consumes. Split out of
// Provider.tsx so the hook does not import a .tsx module for a type.
import { createContext } from 'react';
import type { Redactor } from 'rastro-core';
import type { SessionState } from './capture.js';
import type { Transport } from './transport.js';

export interface RastroContextValue {
  state: SessionState;
  transport: Transport;
  /** The §4.9 redaction policy for this provider. Every emit path goes through it. */
  redactor: Redactor;
}

/** `null` means "no provider above me" — the hook turns that into a clear error. */
export const RastroContext = createContext<RastroContextValue | null>(null);
