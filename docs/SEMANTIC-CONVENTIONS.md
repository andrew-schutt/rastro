# Rastro Semantic Conventions

**Version:** 0.1 · **Stability:** Development (expect breaking changes before 1.0)

This document defines how Rastro represents UX-behavioral telemetry on top of
OpenTelemetry. It is the contract any instrumentation — first-party SDK or otherwise —
should conform to, and it is the part OpenTelemetry deliberately leaves open: OTel
standardizes generic slots (`session.id`, `url.path`, `service.name`), but nothing for
*which element a user interacted with and what its stable identity is*. That gap is the
`ux.*` namespace defined here, and it is Rastro's core semantic contribution.

## Requirement levels

Following OpenTelemetry's own levels:

- **Required** — MUST be present on every conforming record.
- **Recommended** — SHOULD be present; analysis degrades gracefully without it.
- **Opt-In** — MAY be present; captured only when explicitly enabled.

## Signal model

- **Interactions are OTel Events**, i.e. `LogRecord`s that carry an `eventName`. A user
  interaction is a point-in-time occurrence, which is exactly what an Event is; OTel's
  own guidance names button clicks as the canonical example. Anything with a genuine
  duration and boundary MAY instead be a span — but individual interactions MUST NOT be
  modeled as spans.
- **Sessions use the standard OTel session convention.** All records in one session MUST
  share a `session.id`. Session continuation MAY be linked via `session.previous_id`.
  Lifecycle is signaled with the **standard** `session.start` / `session.end` event names
  (not `ux.`-prefixed).
- **Sessions MUST NOT be modeled as spans.** A session ends by the absence of activity
  (idle, tab close), which client code cannot reliably observe, so a session-span would
  never receive `span.end()`. Single-session inspection is reconstructed from the event
  stream (sort by `ux.seq`), not from a trace.

## Attribute naming

- Event names are static and dot-separated and MUST NOT contain dynamic values.
  Identifiers, labels, and per-occurrence data go in attributes.
- Attribute keys are lowercase and dot-namespaced under `ux.`.
- Standard OTel attributes MUST be reused where one exists; do not mint a `ux.*` alias
  for something OTel already defines.

---

## Standard attributes (reused from OpenTelemetry)

These are owned by OpenTelemetry and reused as-is. Listed so instrumenters do not
reinvent them.

| Attribute | Level | Type | Meaning |
|---|---|---|---|
| `session.id` | Required | string | Groups all events in one session. The unit of every flow. |
| `session.previous_id` | Opt-In | string | Links a continued session to its predecessor. |
| `url.path` | Required | string | Route of the page. MUST be tokenized (`/users/:id`) and PII-stripped. |
| `service.name` | Required | string (resource) | The instrumented application. |
| `service.version` | Recommended | string (resource) | Release/deploy identifier. The dimension used to attribute behavior changes to a deploy. |

## `ux.*` attributes (defined by Rastro)

| Attribute | Level | Type | Meaning |
|---|---|---|---|
| `ux.event_id` | Required | string | Client-generated UUID. Idempotency key; retried batches MUST reuse it so duplicates collapse. |
| `ux.seq` | Required | int | Per-session monotonic counter assigned at capture. The authoritative ordering — consumers MUST order by this, not by timestamp. |
| `ux.fingerprint` | Required | string | Stable element identity. The join key for every flow, funnel, and friction metric. See "Fingerprint format" below. |
| `ux.anonymous_id` | Required | string | Stable per-visitor/device identifier. MUST NOT be a login or any PII. |
| `ux.interaction.method` | Recommended | enum | How the interaction occurred: `mouse` \| `keyboard` \| `touch`. Powers accessibility/ergonomics signals. |
| `ux.active_ms` | Recommended | int | Visibility-adjusted dwell **before** this event, in ms. MUST exclude time while `document.hidden` was true. |
| `ux.from_path` | Opt-In | string | On `ux.route_change`, the previous `url.path` (tokenized). |
| `ux.component_chain` | Opt-In | string[] | Component ancestry, outermost → innermost. Debugging aid for fingerprint drift. |
| `ux.role` | Opt-In | string | Element role/tag (`button`, `input:email`, `a`). A queryable slice of the fingerprint. |
| `ux.accessible_name` | Opt-In | string | Element label. MUST be redacted before emit; MUST NOT contain raw user content. |

## Resource attributes (defined by Rastro)

| Attribute | Level | Type | Meaning |
|---|---|---|---|
| `ux.convention.version` | Recommended | string (resource) | Version of *this* spec the record conforms to (e.g. `"0.1"`). Lets the analysis layer handle mixed-version data across migrations. |

## Fingerprint format

`ux.fingerprint` is a human-readable composite (v1), stable across sessions and small
refactors, of the form:

```
<component chain>|<role>|"<accessible name>"
```

Example: `Settings>ProfileForm>SaveButton|button|"Save Profile"`.

Fields degrade gracefully: a missing component chain becomes `unknown`; a missing
accessible name drops the trailing segment. An explicit `data-telemetry-id` on the
element (or an ancestor) overrides derivation entirely and yields `id:<value>`.

Consumers MUST treat the fingerprint as an opaque string for joining; they SHOULD NOT
parse it for meaning (use `ux.role` / `ux.component_chain` for that).

---

## Events

Every event, regardless of name, carries the **required set**:
`session.id`, `url.path`, `ux.event_id`, `ux.seq`, `ux.fingerprint`, `ux.anonymous_id`,
plus `service.name` on the resource. Additional attributes per event below.

| Event name | Emitted when | Notable attributes |
|---|---|---|
| `ux.click` | An element is activated by pointer or keyboard. | `ux.interaction.method` |
| `ux.route_change` | SPA navigation changes the route. | `ux.from_path` (opt-in) |
| `ux.form_submit` | A form is submitted. | `ux.active_ms` = time-to-complete |
| `ux.form_abandon` | Focus entered a form, then left without submitting. | `ux.active_ms` |
| `session.start` | A new session begins. | `session.previous_id` if a continuation. **Standard OTel event.** |
| `session.end` | A session ends (best-effort). | **Standard OTel event.** |
| *custom* | Developer calls `track(name, props?)`. | App-owned name; same static-naming rules; props become attributes. |

Custom event names SHOULD be namespaced to the application (e.g. `checkout.completed`)
and MUST follow the static-naming rule (no dynamic values in the name).

## Full example

One `ux.click` record (OTel logical shape; the OTLP wire envelope is produced by the
exporter):

```jsonc
{
  "timeUnixNano": "1730300000000000000",       // client time — reference only
  "observedTimeUnixNano": "1730300000120000000", // set at collector — authoritative order
  "eventName": "ux.click",
  "severityNumber": 9,                           // INFO
  "attributes": {
    "session.id": "5f2c…",
    "url.path": "/settings/:id",
    "ux.event_id": "9b1e…",
    "ux.seq": 42,
    "ux.fingerprint": "Settings>ProfileForm>SaveButton|button|\"Save Profile\"",
    "ux.anonymous_id": "a77c…",
    "ux.interaction.method": "mouse",
    "ux.active_ms": 4200
  },
  "resource": {
    "service.name": "my-app",
    "service.version": "4.2.1",
    "ux.convention.version": "0.1"
  }
}
```

## Privacy requirements

- `url.path` MUST be tokenized before emit — no ids, emails, or tokens in the path.
- `ux.accessible_name` MUST be run through redaction (emails, numbers, and other PII
  patterns replaced) and MUST NOT carry raw input values.
- The default capture level is **metadata, not content**: record *that* an input
  changed, never *what* was typed.

## Ordering and sessions

- `ux.seq` is monotonic within a `session.id` and is the sole authority for order.
  Timestamps are for display and latency only.
- A new `session.id` is assigned after inactivity or an explicit session reset. The
  exact idle threshold is an implementation choice and is out of scope for this spec.

## Versioning and stability

- This spec is versioned independently of the SDK via `ux.convention.version`.
- At **Development** stability, attribute names and event names may change. Breaking
  changes bump the minor version until 1.0, after which removals/renames require a major.
- The **required set** is intended to be the most stable part; opt-in attributes are the
  most likely to evolve.

## Minimum for analysis

Rastro's analysis layer (`sessionize` → `buildGraph` → single-session timeline)
depends only on the **required set**. No aggregate or timeline metric depends on any
Recommended or Opt-In attribute, so a minimal conforming emitter still produces fully
usable flows and timelines.
