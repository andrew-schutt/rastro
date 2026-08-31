// packages/core/src/redact.ts
// PII redaction hook (docs/PLAN.md §4.9). STUB — naive body, real signature.
import type { Redactor } from './seams.js';

/** What a redacted span is replaced with. Kept visible so you can spot over-redaction. */
export const REDACTED = '‹redacted›'; // ‹redacted›

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Runs of 4+ digits: card fragments, order ids, phone numbers. Deliberately blunt.
const LONG_NUMBER = /\d{4,}/g;

/**
 * The default redactor: strip emails and long digit runs.
 *
 * Applied to `ux.accessible_name` BEFORE it enters the fingerprint, so a label like
 * "Delete account for jane@x.com" cannot leak into the join key or the dashboard.
 *
 * TODO(§4.9): this covers maybe 10% of the real leak surface. Still needed —
 *   - URL tokenization: `/users/john@example.com/settings` → `/users/:id/settings`.
 *     Today `url.path` is trusted to arrive tokenized; nothing enforces it.
 *   - An allow/deny model per attribute, rather than one blanket regex pass.
 *   - Names, addresses, and other PII shapes no regex catches — the seam exists so an
 *     adopter can drop in enterprise DLP rules instead of this.
 *   - A `noopRedactor` for trusted internal apps.
 */
export function redact(text: string): string {
  return text.replace(EMAIL, REDACTED).replace(LONG_NUMBER, REDACTED);
}

/** The default `Redactor` implementation (§19.5). */
export const defaultRedactor: Redactor = { redact };
