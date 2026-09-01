// packages/react/src/capture.ts
// Delegated root capture (docs/PLAN.md §4.1) — walking-skeleton step 2 (§19.4).
//
// One listener per event type at the document root, in the capture phase, passive. This
// emits the four interaction events the conventions define — ux.click, ux.route_change,
// ux.form_submit, ux.form_abandon — each carrying visibility-adjusted dwell.
//
// What is still a placeholder is IDENTITY, not capture: `fingerprint()` is a stub until
// step 3, so every element without a `data-telemetry-id` collapses to `unknown|<tag>`.
import type {
  AttributeValue,
  ElementDescription,
  Redactor,
  RouteAdapter,
  UxEvent,
} from 'rastro-core';
import {
  SEVERITY_INFO,
  UX_CONVENTION_VERSION,
  defaultRedactor,
  describeElement,
  isReservedAttribute,
} from 'rastro-core';
import { MAX_DWELL_MS, cappedDwell, createActiveClock } from './dwell.js';
import { createFormTracker, type FormOutcome } from './forms.js';
import { historyRouteAdapter } from './route.js';

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
  /** On `ux.route_change`, the previous path. Tokenized here, like `route`. */
  fromPath?: string;
  /** `ux.component_chain`, outermost → innermost. */
  componentChain?: string[];
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
      ...(input.componentChain === undefined
        ? {}
        : { 'ux.component_chain': input.componentChain }),
      ...(input.accessibleName === undefined
        ? {}
        : { 'ux.accessible_name': redactor.redact(input.accessibleName) }),
      ...(input.fromPath === undefined
        ? {}
        : { 'ux.from_path': redactor.tokenizePath(input.fromPath) }),
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

/**
 * Selector for things a user meaningfully activates. A click that resolves to none of these
 * is inert background and is dropped — recording it would bury real interactions in noise.
 *
 * `[data-telemetry-id]` is included so an explicit opt-in always counts, even on a div.
 */
const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
  '[data-telemetry-id]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The shape of a click event this needs, narrowed so the logic below is testable. */
export interface InteractionSource {
  /** `UIEvent.detail` — 0 when a click was synthesized from Enter/Space on a control. */
  detail?: number;
  /** `PointerEvent.pointerType` — 'mouse' | 'pen' | 'touch', or '' for keyboard. */
  pointerType?: string;
}

/**
 * Classify how an interaction happened (`ux.interaction.method`), which is what powers the
 * accessibility and ergonomics signals.
 *
 * Keyboard is checked first: activating a button with Enter or Space produces a real click
 * event whose `detail` is 0 and whose `pointerType` is empty, so reading `pointerType` alone
 * would silently label every keyboard user a mouse user.
 *
 * A pen reports as touch: it is direct manipulation, and the enum has no third option.
 */
export function interactionMethodOf(
  source: InteractionSource,
): 'mouse' | 'keyboard' | 'touch' | undefined {
  if (source.detail === 0) return 'keyboard';

  switch (source.pointerType) {
    case 'touch':
    case 'pen':
      return 'touch';
    case 'mouse':
      return 'mouse';
    default:
      // A non-pointer click event with a non-zero detail. Real, but unclassifiable — and
      // `ux.interaction.method` is Recommended, so omitting beats guessing.
      return undefined;
  }
}

/**
 * The conventions mark `ux.component_chain`, `ux.role`, and `ux.accessible_name` **Opt-In**:
 * "captured only when explicitly enabled". So they are off by default, and this is the
 * switch.
 *
 * §4.2.1 recommends turning `componentChain` on while tuning fingerprints — it is what lets
 * you re-derive identities later without re-collecting, and it is the debugging aid for
 * fingerprint drift. `accessibleName` is the one to think twice about: it is redacted, but
 * it is still the closest thing to page content that leaves the browser.
 */
export interface OptInAttributes {
  componentChain?: boolean;
  role?: boolean;
  accessibleName?: boolean;
}

/** Pick out whichever Opt-In attributes are enabled, from an already-derived description. */
function optInFrom(
  described: ElementDescription,
  optIn: OptInAttributes,
): Pick<BuildEventInput, 'componentChain' | 'role' | 'accessibleName'> {
  return {
    ...(optIn.componentChain === true && described.componentChain.length > 0
      ? { componentChain: described.componentChain }
      : {}),
    ...(optIn.role === true ? { role: described.role } : {}),
    ...(optIn.accessibleName === true && described.accessibleName !== undefined
      ? { accessibleName: described.accessibleName }
      : {}),
  };
}

export interface CaptureOptions {
  state: SessionState;
  onEvent: (event: UxEvent) => void;
  /** The §4.9 policy. Defaults to `defaultRedactor` so a bare call is still safe. */
  redactor?: Redactor;
  /** Defaults to `document`. One listener for the whole tree — never per element (§4.1). */
  root?: Document | Element;
  /** Route detection (§4.6 seam). Defaults to the `history` patch. */
  routeAdapter?: RouteAdapter;
  /** Cap on a reported dwell (§4.5). */
  maxDwellMs?: number;
  /** Opt-In attributes from the conventions. All off by default. */
  optIn?: OptInAttributes;
}

/**
 * Attach the delegated root listeners. Returns a teardown function.
 *
 * One listener per event type at the root, registered passive (§4.7 — never block the main
 * thread on a user gesture) and in the capture phase, so a `stopPropagation` in app code
 * cannot blind the SDK. Never per-element listeners: that is memory and performance death on
 * a large app (§4.1).
 *
 * Emits `ux.click`, `ux.route_change`, `ux.form_submit`, and `ux.form_abandon`, each with a
 * visibility-adjusted `ux.active_ms` (§4.5).
 *
 * ⚠ The identities are still placeholders. `fingerprint()` is a stub until §19.4 step 3, so
 * every element without a `data-telemetry-id` collapses to `unknown|<tag>`. The capture is
 * real; the join key is not yet.
 *
 * TODO(§4.7): step 3 puts a synchronous fiber walk inside these handlers, which is exactly
 * the jank §4.7 warns about. The fix is to capture the cheap DOM facts synchronously — the
 * element, the method, and `ux.seq`, which MUST stay in gesture order — and defer only the
 * expensive derivation to `requestIdleCallback`.
 * TODO(§10): a click that resolves to no interactive target is dropped here. Those are the
 * raw material for the dead-click friction signal, which needs state-change observation to
 * tell "clicked nothing" from "clicked something that did nothing".
 */
export function startCapture({
  state,
  onEvent,
  root,
  redactor = defaultRedactor,
  routeAdapter = historyRouteAdapter(),
  maxDwellMs = MAX_DWELL_MS,
  optIn = {},
}: CaptureOptions): () => void {
  if (typeof document === 'undefined') return () => {}; // SSR: nothing to attach to (§4.8)

  const target: Document | Element = root ?? document;
  const clock = createActiveClock();
  const forms = createFormTracker();

  let lastEventAtMs = clock.elapsed();
  let currentPath = routeAdapter.current();

  /** Dwell since the previous event in this session — what `ux.active_ms` means by default. */
  const dwellSinceLastEvent = (): number => {
    const nowMs = clock.elapsed();
    const dwell = cappedDwell(nowMs - lastEventAtMs, maxDwellMs);
    lastEventAtMs = nowMs;
    return dwell;
  };

  const emit = (input: BuildEventInput): void => {
    onEvent(buildEvent(state, input, redactor));
  };

  const onClick = (event: Event): void => {
    if (!(event.target instanceof Element)) return;

    // Walk up to the thing the user actually activated — a click almost always lands on a
    // span or an svg inside the control, not the control itself.
    const element = event.target.closest(INTERACTIVE_SELECTOR);
    if (element === null) return;

    // A click outside the active form ends that form's episode. Emitted before the click
    // itself: the form was left, and then the new thing was interacted with.
    emitFormOutcome(forms.interactionOutside(element.closest('form'), clock.elapsed()));

    const source = event as Partial<InteractionSource> & Event;
    const method = interactionMethodOf({
      ...(source.detail === undefined ? {} : { detail: source.detail }),
      ...(source.pointerType === undefined ? {} : { pointerType: source.pointerType }),
    });

    // One derivation per event: the fingerprint and its raw parts come from a single fiber
    // walk rather than one per attribute (§4.7).
    const described = describeElement(element, redactor);

    emit({
      eventName: 'ux.click',
      fingerprint: described.fingerprint,
      route: currentPath,
      activeMs: dwellSinceLastEvent(),
      ...optInFrom(described, optIn),
      ...(method === undefined ? {} : { interactionMethod: method }),
    });
  };

  const onSubmit = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    const form = event.target.closest('form');
    if (form === null) return;

    emitFormOutcome(forms.submitted(form, clock.elapsed()));
  };

  const onFocusIn = (event: Event): void => {
    const form = event.target instanceof Element ? event.target.closest('form') : null;
    emitFormOutcome(forms.focusEntered(form, clock.elapsed()));
  };

  // The §4.4 signal that dies on unload. transport.ts flushes on the same event, so the
  // abandonment is queued before the flush rather than after it.
  const onPageHide = (): void => emitFormOutcome(forms.pageHidden(clock.elapsed()));

  function emitFormOutcome(outcome: FormOutcome | null): void {
    if (outcome === null) return;
    if (!(outcome.form instanceof Element)) return;

    const described = describeElement(outcome.form, redactor);

    lastEventAtMs = clock.elapsed();
    emit({
      eventName: outcome.kind === 'form_submit' ? 'ux.form_submit' : 'ux.form_abandon',
      fingerprint: described.fingerprint,
      route: currentPath,
      ...optInFrom(described, optIn),
      // `ux.active_ms` here is time-to-complete, not the gap since the last event.
      ...(outcome.activeMs === undefined
        ? {}
        : { activeMs: cappedDwell(outcome.activeMs, maxDwellMs) }),
    });
  }

  const unsubscribeRoute = routeAdapter.subscribe((path) => {
    if (path === currentPath) return; // a replaceState that did not move the user

    // Navigating away from a half-filled form abandons it just as surely as clicking away.
    emitFormOutcome(forms.interactionOutside(null, clock.elapsed()));

    const fromPath = currentPath;
    currentPath = path;

    emit({
      eventName: 'ux.route_change',
      // A route change is not an element interaction. The route IS the identity.
      fingerprint: `route:${redactor.tokenizePath(path)}`,
      route: path,
      activeMs: dwellSinceLastEvent(),
      fromPath,
    });
  });

  // Passive: these never call preventDefault, and saying so lets the browser scroll without
  // waiting on the handler (§4.7). Capture phase: app code cannot hide events from the SDK.
  const options: AddEventListenerOptions = { passive: true, capture: true };
  target.addEventListener('click', onClick, options);
  target.addEventListener('submit', onSubmit, options);
  target.addEventListener('focusin', onFocusIn, options);
  window.addEventListener('pagehide', onPageHide);

  return () => {
    target.removeEventListener('click', onClick, options);
    target.removeEventListener('submit', onSubmit, options);
    target.removeEventListener('focusin', onFocusIn, options);
    window.removeEventListener('pagehide', onPageHide);
    unsubscribeRoute();
    clock.stop();
  };
}
