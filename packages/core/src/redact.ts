// packages/core/src/redact.ts
// PII redaction and URL tokenization (docs/PLAN.md §4.9).
//
// The conventions make both of these MUST-level requirements, not nice-to-haves:
//   - `url.path` MUST be tokenized before emit — no ids, emails, or tokens in the path.
//   - `ux.accessible_name` MUST be run through redaction and MUST NOT carry raw input.
import type { Redactor } from './seams.js';

/** What a redacted span is replaced with. Kept visible so you can spot over-redaction. */
export const REDACTED = '‹redacted›';

/** What a dynamic path segment collapses to. Matches the conventions' `/users/:id`. */
export const PATH_PARAM = ':id';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Runs of 4+ digits: card fragments, order ids, phone numbers. Deliberately blunt.
const LONG_NUMBER = /\d{4,}/g;

/**
 * Strip emails and long digit runs out of free text.
 *
 * Applied to `ux.accessible_name` BEFORE it enters the fingerprint, so a label like
 * "Delete account for jane@x.com" cannot leak into the join key or the dashboard, and to
 * every string value passed to `track(name, props)`.
 */
export function redact(text: string): string {
  return text.replace(EMAIL, REDACTED).replace(LONG_NUMBER, REDACTED);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_DIGITS = /^\d+$/;
const LONG_HEX = /^[0-9a-f]{12,}$/i;
const HAS_DIGIT = /\d/;

/** Length at which a segment containing a digit is assumed to be an id, not a word. */
const OPAQUE_ID_LENGTH = 8;

/**
 * Does this path segment look like a value rather than a route name?
 *
 * Biased toward tokenizing: a false positive merges two routes that should be distinct, a
 * false negative puts user data on the wire. §4.9 is clear about which of those is worse.
 */
function isDynamicSegment(segment: string): boolean {
  // Already a route pattern — from a RouteAdapter, or from a caller that tokenized upstream.
  if (segment.startsWith(':') || segment.startsWith('*')) return false;

  if (UUID.test(segment)) return true;
  if (ALL_DIGITS.test(segment)) return true;
  if (segment.includes('@')) return true;                       // an email in the path (§4.9)
  if (LONG_HEX.test(segment)) return true;                      // ObjectId, sha, hex token
  // nanoid / ULID / KSUID / "order-10482" — opaque enough to be an identifier.
  if (segment.length >= OPAQUE_ID_LENGTH && HAS_DIGIT.test(segment)) return true;

  return false;
}

/**
 * Tokenize a URL path: `/users/42/settings` → `/users/:id/settings`.
 *
 * Query strings and fragments are dropped entirely — `?token=`, `?email=`, and `#access=`
 * are the highest-yield leaks on the whole surface and none of them belong in `url.path`.
 *
 * ⚠ This is a HEURISTIC, and the honest limit is worth stating plainly: it recognizes the
 * *shape* of identifiers, so it catches numbers, UUIDs, hashes, emails, and nanoids, and it
 * does NOT catch a username or a title. `/users/johndoe` and `/posts/my-divorce-settlement`
 * come through untouched, because nothing in the string distinguishes them from
 * `/docs/getting-started`.
 *
 * The real fix is the `RouteAdapter` seam (§4.6): a router knows its own route pattern, so
 * React Router hands you `/users/:userId` directly and no guessing is involved. This
 * function is the zero-config floor for when no adapter is wired up — which is exactly the
 * state the SDK ships in today.
 */
export function tokenizePath(path: string): string {
  const [withoutQuery = ''] = path.split(/[?#]/);
  if (withoutQuery === '') return '/';

  return withoutQuery
    .split('/')
    .map((segment) => (isDynamicSegment(segment) ? PATH_PARAM : segment))
    .join('/');
}

/**
 * The default `Redactor` (§19.5).
 *
 * TODO(§4.9) still missing, in rough order of value:
 *   - An allow/deny model per attribute, rather than one blanket regex pass. That is what
 *     would let a numeric prop like `{ userId: 84213 }` be caught — see `sanitizeProps` in
 *     rastro-react, which deliberately passes numbers through because a blunt digit rule
 *     would also destroy legitimate metadata like `{ durationMs: 4200 }`.
 *   - Names, addresses, and other PII shapes no regex catches. The seam exists so an adopter
 *     can drop in enterprise DLP rules instead of this.
 */
export const defaultRedactor: Redactor = { redact, tokenizePath };

/**
 * A `Redactor` that does nothing, for a trusted internal app where the metadata is not
 * sensitive and route grouping matters more than tokenization. Opt in deliberately.
 */
export const noopRedactor: Redactor = {
  redact: (text) => text,
  tokenizePath: (path) => path,
};
