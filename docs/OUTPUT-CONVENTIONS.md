# Rastro Output Conventions

**Version:** 0.1 · **Stability:** Development (expect breaking changes before 1.0)

This document defines the records Rastro *derives*, as opposed to the interactions it
observes. [`SEMANTIC-CONVENTIONS.md`](SEMANTIC-CONVENTIONS.md) is the capture contract: what an
emitter sends. This is the output contract: what Rastro's analysis hands to a consumer, an AI
agent first ([`CONSUMERS.md`](CONSUMERS.md)). The two are versioned apart on purpose, so a
change to what Rastro emits never moves `ux.convention.version` for emitters that did not
change (CONSUMERS rule 3).

Requirement levels (Required, Recommended, Opt-In) mean what they mean in the capture
conventions.

## Signal model

- **One derived record: the finding.** A finding says that a friction signal fired on one
  element, in one deploy, and lists every occurrence behind it. Nothing else is derived.
- **The flow graph is not a record.** It is a view over the interaction events, which are
  already OpenTelemetry, and any consumer can rebuild it from them the way `buildGraph` does.
  A record that could rebuild the graph would have to carry each session's steps, which is a
  second copy of observed data dressed up as derived.
- **Findings are OTel Events,** `LogRecord`s with an `eventName`, never spans. A finding has no
  duration Rastro can observe, for the same reason sessions and flows are not spans.
- **The scope is `rastro-analysis`, and it is Required.** It is how a finding is told apart
  from an interaction. The collector refuses records under this scope as input, so analysis
  output can never be counted as user behavior.
- **The resource is the analyzed app, not Rastro.** `service.name` names the app whose users
  produced the evidence, so a backend that filters by service shows an app's findings next to
  its own interactions. The scope says who produced the finding; the resource says what it is
  about.
- **Findings are observations.** They say what happened and how often. They never say why.

## Event

| Event name | Emitted when |
|---|---|
| `rastro.finding` | A friction signal fired on an element, for one deploy. |

One name for every kind, with the kind as an attribute. Event names stay static, and every
kind shares one schema.

## Resource attributes

| Attribute | Level | Type | Description |
|---|---|---|---|
| `service.name` | Required | string | The analyzed app. Same value as its interactions'. |
| `service.version` | Recommended | string | The deploy the finding is about. Absent when the evidence did not report one, which the capture conventions allow. |
| `ux.convention.version` | Recommended | string | The capture-convention version of the evidence. It pins the format of `ux.fingerprint`: fingerprints do not join across 0.2 and 0.3. Present only when every occurrence agrees. |
| `rastro.output.version` | Required | string | The version of *this* document the record conforms to. |

`service.version` and `ux.convention.version` are Recommended because they are Recommended on
the interactions. A finding cannot require what its own evidence was never required to carry.

## Attributes

| Attribute | Level | Type | Description |
|---|---|---|---|
| `rastro.finding.id` | Required | string | Stable identity: `<kind>:<service.version>:<ux.fingerprint>`, with `-` for an absent version. See below. |
| `rastro.finding.kind` | Required | string | Which signal fired. See [Kinds](#kinds). |
| `ux.fingerprint` | Required | string | The element. Reused from the capture conventions, not re-minted: same meaning, and the capture conventions forbid aliases for a defined attribute. |
| `rastro.finding.occurrences` | Required | int | How many times the signal fired, in this deploy. |
| `rastro.finding.sessions` | Required | int | Distinct sessions it fired in, in this deploy. The one number that means the same thing for every kind. |

Both counts are exact for the finding's deploy. That is the whole of the finding's
quantitative claim.

### The id

`rastro.finding.id` is `kind`, `service.version` and `ux.fingerprint` joined with `:`, the
fingerprint last. The fingerprint is free text and may contain `:`. Kind and version come
first, so the id splits on the first two separators however the fingerprint is written.

The same signal on the same element in the same deploy always yields the same id. That is
what lets a consumer tell a new finding from a recurring one. Findings without a version all
share `-`, so an app that reports no `service.version` gets one finding per element and kind
across all its deploys. That is the honest consequence of not reporting it.

## Body

The body is a map with one Required key:

| Key | Type | Description |
|---|---|---|
| `evidence` | array of `{ "session.id": string, "ux.seq": int }` | One entry per occurrence, ordered by `session.id` then `ux.seq`. Each names the interaction the signal fired on. |

Evidence goes in the body rather than in an attribute because it is payload, not something to
filter on. Many backends do not index map-valued attributes in any case. Every entry resolves
to exactly one interaction event, so every claim the finding makes can be checked against the
raw stream (CONSUMERS rule 2).

Evidence is unbounded in 0.1. A cap is a budget, and the right budget depends on a consumer
that does not exist yet.

## What a finding MUST NOT carry

- **`session.id` as an attribute.** A finding spans sessions. A backend that sees `session.id`
  on a record files it inside that session. Sessions appear only inside `evidence`.
- **A rate.** Rates are computed over every session in the analysis window, across deploys. On a
  record keyed by one deploy, a pooled rate reads as that deploy's rate when it is not
  ([`NOTES.md`](NOTES.md), known holes). A rate returns when one is computed per deploy.
- **A cause, hypothesis, confidence or recommendation.** The data cannot establish causation
  ([`DESIGN.md`](DESIGN.md) §12), confidence is theatre until it is calibrated (§11), and an
  agent treats a stated cause as a spec. Interpretation belongs to a consumer, never to the
  record.

## Kinds

| Kind | Fires when | `occurrences` counts |
|---|---|---|
| `rage_click` | A session clicks the same element three or more times in quick succession. | Runs of rapid clicks |
| `high_abandonment` | Sessions that reached the element end on it at a high rate. | Sessions that ended on it |

A `high_abandonment` finding *exists* because the pooled rate, over every deploy in the
window, crossed the threshold. Its counts are its own deploy's. Thresholds are the analysis
defaults (`DEFAULT_MIN_DROPOFF_RATE`, `DEFAULT_MIN_CLICKS` and the rest in `rastro-analysis`).

Consumers MUST tolerate a kind they do not know. New kinds are added without a breaking
version.

## Time

`timeUnixNano` is when the analysis ran. `observedTimeUnixNano` is set by whatever receives the
record. When a finding was first and last seen belongs to durable findings
([`CONSUMERS.md`](CONSUMERS.md) §7, item 5), and is not in 0.1.

`severityNumber` is 9 (INFO). A severity would be a judgement, and findings carry none.

## Full example

```jsonc
{
  "resource": {
    "service.name": "my-app",
    "service.version": "4.2.1",
    "ux.convention.version": "0.4",
    "rastro.output.version": "0.1"
  },
  "scope": { "name": "rastro-analysis" },
  "logRecord": {
    "eventName": "rastro.finding",
    "timeUnixNano": "1730300000000000000",
    "severityNumber": 9,
    "attributes": {
      "rastro.finding.id": "rage_click:4.2.1:App>SettingsForm@src/App.tsx|button:button|\"Save\"",
      "rastro.finding.kind": "rage_click",
      "ux.fingerprint": "App>SettingsForm@src/App.tsx|button:button|\"Save\"",
      "rastro.finding.occurrences": 3,
      "rastro.finding.sessions": 2
    },
    "body": {
      "evidence": [
        { "session.id": "3f2a…", "ux.seq": 7 },
        { "session.id": "3f2a…", "ux.seq": 19 },
        { "session.id": "9c41…", "ux.seq": 4 }
      ]
    }
  }
}
```

## Versioning and stability

- Versioned independently of the capture conventions, via `rastro.output.version`.
- At **Development** stability, names may change. Breaking changes bump the minor version until
  1.0.
- Adding a kind is not a breaking change. Adding a Required attribute is.

## Change history

**0.1** — first version. One derived record, `rastro.finding`. Settled with it: the flow graph
is a view over interactions, not a record; findings carry exact per-deploy counts and no
rate; the resource is the analyzed app.
