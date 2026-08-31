// packages/react/src/capture.ts
// A single delegated root listener (docs/PLAN.md §4.1). STUB.
//
// Walking-skeleton step 2 (§19.4) replaces this with real capture. Today it proves the wire:
// one delegated, passive click listener that emits a PLACEHOLDER event so the pipe
// demo-app → OTLP → SQLite → dashboard is exercised by a real user gesture.
import type { AttributeValue, Redactor, UxEvent } from 'rastro-core';
import {
  SEVERITY_INFO,
  UX_CONVENTION_VERSION,
  defaultRedactor,
  fingerprint,
  isReservedAttribute,
} from 'rastro-core';

/** Per-session state the event factory needs. One instance per RastroProvider. */
export interface SessionState {
  app: string;
  serviceVersion?: string;
  sessionId: string;
  anonymousId: string;
  /** Per-session monotonic counter, assigned at capture. The authoritative ordering. */
  nextSeq(): number;
}

/**
 * Mint the session identity for one provider instance.
 *
 * ⚠ Both ids are in-memory and reset on every page load, because no browser storage API is
 * used yet. That makes `ux.anonymous_id` a per-page-load id, not the stable per-visitor id
 * the convention requires — every reload looks like a new visitor.
 *
 * TODO(§4.5): a real session rule — 30-minute inactivity is the usual default, but an SPA
 * that never reloads, a tab left open overnight, and a backgrounded mobile tab all need an
 * answer, and the choice changes every downstream number. Write the rule down.
 * TODO(§4.5): persist `ux.anonymous_id`, and mint `session.previous_id` on continuation.
 */
export function createSessionState(app: string, serviceVersion?: string): SessionState {
  let seq = 0;
  return {
    app,
    ...(serviceVersion === undefined ? {} : { serviceVersion }),
    sessionId: crypto.randomUUID(),
    anonymousId: crypto.randomUUID(),
    nextSeq: () => (seq += 1),
  };
}

export interface BuildEventInput {
  eventName: string;
  fingerprint: string;
  /** Raw path. Tokenized here — callers do not have to pre-sanitize it (§4.9). */
  route?: string;
  interactionMethod?: 'mouse' | 'keyboard' | 'touch';
  activeMs?: number;
  role?: string;
  /** Raw label. Redacted here (§4.9). */
  accessibleName?: string;
  /** Custom attributes from `track(name, props)`. Already sanitized by `sanitizeProps`. */
  attributes?: Record<string, AttributeValue>;
}

/**
 * Turn `track()` props into attributes, enforcing the two rules that keep them safe.
 *
 * 1. **Reserved namespaces are rejected.** `session.`, `url.`, `service.`, and `ux.` belong
 *    to the conventions. A stray `{ 'ux.seq': 0 }` would silently corrupt the ordering every
 *    consumer is required to trust, so it is dropped with a warning rather than merged.
 * 2. **String values go through the Redactor.** `track('saved', { email })` is the obvious
 *    way for raw user content to reach the wire, and it is the one this closes.
 *
 * ⚠ Numbers and booleans pass through untouched, and that is a deliberate, documented gap.
 * The default redactor's text rule is "4+ consecutive digits", and applying it to numbers
 * would destroy exactly the metadata worth keeping — `{ durationMs: 4200 }`, `{ items: 12 }`
 * — while only catching numeric PII by accident. Catching `{ userId: 84213 }` needs the
 * per-attribute allow/deny model in §4.9, not a blunter regex.
 */
export function sanitizeProps(
  props: TrackProps | undefined,
  redactor: Redactor = defaultRedactor,
): Record<string, AttributeValue> {
  const attributes: Record<string, AttributeValue> = {};
  if (props === undefined) return attributes;

  for (const [key, value] of Object.entries(props)) {
    if (isReservedAttribute(key)) {
      console.warn(
        `[rastro] track(): dropped prop "${key}" — the ${key.split('.')[0]}.* namespace is ` +
          'owned by the semantic conventions.',
      );
      continue;
    }

    attributes[key] = typeof value === 'string' ? redactor.redact(value) : value;
  }

  return attributes;
}

/** Attribute values an app may attach to a custom event. */
export type TrackProps = Record<string, string | number | boolean>;

/**
 * Build one conforming UxEvent. The single place the Required set is assembled, and the
 * single choke point where §4.9 redaction is enforced — every path is tokenized and every
 * label redacted here, so no caller can emit an unsanitized record by forgetting to.
 */
export function buildEvent(
  state: SessionState,
  input: BuildEventInput,
  redactor: Redactor = defaultRedactor,
): UxEvent {
  // TODO(§4.6): route detection belongs behind the RouteAdapter seam, not
  // `location.pathname`. An adapter reports the router's own pattern (`/users/:userId`),
  // which is both more accurate and immune to the heuristic's blind spots — `tokenizePath`
  // cannot tell `/users/johndoe` from `/docs/getting-started`.
  const rawRoute = input.route ?? (typeof location === 'undefined' ? '/' : location.pathname);
  const route = redactor.tokenizePath(rawRoute);

  return {
    eventName: input.eventName,
    timeUnixNano: `${Date.now()}000000`,
    severityNumber: SEVERITY_INFO,
    attributes: {
      // Custom props FIRST, so the conventions' own attributes below always win a collision.
      // `sanitizeProps` already rejects reserved namespaces; this is the belt to that braces,
      // and it is what stops a stray prop from redefining the Required set.
      ...input.attributes,

      'session.id': state.sessionId,
      'url.path': route,
      'ux.event_id': crypto.randomUUID(),
      'ux.seq': state.nextSeq(),
      'ux.fingerprint': input.fingerprint,
      'ux.anonymous_id': state.anonymousId,
      ...(input.interactionMethod === undefined
        ? {}
        : { 'ux.interaction.method': input.interactionMethod }),
      ...(input.activeMs === undefined ? {} : { 'ux.active_ms': input.activeMs }),
      ...(input.role === undefined ? {} : { 'ux.role': input.role }),
      ...(input.accessibleName === undefined
        ? {}
        : { 'ux.accessible_name': redactor.redact(input.accessibleName) }),
    },
    resource: {
      'service.name': state.app,
      ...(state.serviceVersion === undefined
        ? {}
        : { 'service.version': state.serviceVersion }),
      'ux.convention.version': UX_CONVENTION_VERSION,
    },
  };
}

export interface CaptureOptions {
  state: SessionState;
  onEvent: (event: UxEvent) => void;
  /** The §4.9 policy. Defaults to `defaultRedactor` so a bare call is still safe. */
  redactor?: Redactor;
  /** Defaults to `document`. One listener for the whole tree — never per element (§4.1). */
  root?: Document | Element;
}

/**
 * Attach the delegated root listener. Returns a teardown function.
 *
 * STUB. What is real: exactly one listener, registered passive and in the capture phase so a
 * `stopPropagation` in app code cannot blind it, and the §4.7 rule that nothing expensive
 * runs inside the handler.
 *
 * What is a placeholder: `fingerprint()` is itself a stub (`unknown|<tag>` unless the element
 * carries `data-telemetry-id`), so every event here carries a placeholder identity. Do not
 * read meaning into these numbers.
 *
 * TODO(§19.4 step 2) real capture:
 *   - `ux.click` only fires for genuinely interactive targets — walk up to the nearest
 *     button/link/[role]/input, and ignore clicks on inert background.
 *   - `ux.interaction.method`: mouse vs keyboard vs touch, from `PointerEvent.pointerType`
 *     and `MouseEvent.detail === 0` for keyboard activation.
 *   - `ux.route_change` via the RouteAdapter seam (§4.6), carrying `ux.from_path`.
 *   - `ux.form_submit` / `ux.form_abandon` (focus entered a form, then left) — the abandon
 *     signal is the one §4.4 warns dies on unload.
 *   - `ux.active_ms`: visibility-adjusted dwell. MUST subtract time while `document.hidden`
 *     was true, or the flagship metric is really "who switched tabs" (§4.5).
 *   - §4.7 performance: defer the fiber walk to `requestIdleCallback`, never run it
 *     synchronously inside the handler.
 *   - §4.8 SSR: no DOM at boot under Next; guard every registration.
 */
export function startCapture({
  state,
  onEvent,
  root,
  redactor = defaultRedactor,
}: CaptureOptions): () => void {
  if (typeof document === 'undefined') return () => {}; // SSR: nothing to attach to (§4.8)

  const target: Document | Element = root ?? document;

  const onClick = (event: Event): void => {
    const element = event.target;
    if (!(element instanceof Element)) return;

    onEvent(
      buildEvent(
        state,
        {
          eventName: 'ux.click',
          fingerprint: fingerprint(element),
          interactionMethod: 'mouse', // TODO: derive; see above
        },
        redactor,
      ),
    );
  };

  target.addEventListener('click', onClick, { passive: true, capture: true });
  return () => target.removeEventListener('click', onClick, { capture: true });
}
