// packages/react/src/capture.ts
// A single delegated root listener (PLAN.md §4.1). STUB.
//
// Walking-skeleton step 2 (§19.4) replaces this with real capture. Today it proves the wire:
// one delegated, passive click listener that emits a PLACEHOLDER event so the pipe
// demo-app → OTLP → SQLite → dashboard is exercised by a real user gesture.
import type { UxEvent } from 'rastro-core';
import { SEVERITY_INFO, UX_CONVENTION_VERSION, fingerprint } from 'rastro-core';

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
  /** Tokenized and PII-stripped (§4.9). */
  route?: string;
  interactionMethod?: 'mouse' | 'keyboard' | 'touch';
  activeMs?: number;
  role?: string;
  accessibleName?: string;
}

/** Build one conforming UxEvent. The single place the Required set is assembled. */
export function buildEvent(state: SessionState, input: BuildEventInput): UxEvent {
  // TODO(§4.6): route detection is a RouteAdapter seam, not `location.pathname`. This value
  // is NOT tokenized, so `/users/42` arrives as `/users/42` and violates the convention's
  // privacy requirement the moment a real app uses it.
  const route =
    input.route ?? (typeof location === 'undefined' ? '/' : location.pathname);

  return {
    eventName: input.eventName,
    timeUnixNano: `${Date.now()}000000`,
    severityNumber: SEVERITY_INFO,
    attributes: {
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
        : { 'ux.accessible_name': input.accessibleName }),
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
export function startCapture({ state, onEvent, root }: CaptureOptions): () => void {
  if (typeof document === 'undefined') return () => {}; // SSR: nothing to attach to (§4.8)

  const target: Document | Element = root ?? document;

  const onClick = (event: Event): void => {
    const element = event.target;
    if (!(element instanceof Element)) return;

    onEvent(
      buildEvent(state, {
        eventName: 'ux.click',
        fingerprint: fingerprint(element),
        interactionMethod: 'mouse', // TODO: derive; see above
      }),
    );
  };

  target.addEventListener('click', onClick, { passive: true, capture: true });
  return () => target.removeEventListener('click', onClick, { capture: true });
}
