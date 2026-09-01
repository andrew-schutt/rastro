# Identity resolution — surviving fingerprint drift across deploys

**Status:** design, unbuilt. Deferred behind both gates in
[`VALIDATION-PLAN.md`](VALIDATION-PLAN.md).

> **Where this lives.** This is a design for unbuilt work, which is normally
> [`DESIGN.md`](DESIGN.md)'s job — but `DESIGN.md` is frozen as the seeding document that
> every `§` reference in the codebase points into, and appending sections would disturb those
> anchors. It stands alone until `DESIGN.md` takes its next revision, at which point it folds
> in as a section and this file goes away.

---

## The problem

`ux.fingerprint` is derived from the React component chain, the element's role, and its
accessible name (§4.2.1). All three change when people edit code. A component rename, a
copy edit, a translation — any of them mints a new identity for an element that did not
change in any way a user could perceive.

```
before v4.3.0    App>SettingsForm|form
after  v4.3.0    App>ProfileForm|form      ← same form, someone renamed the component
```

Because the fingerprint is the join key for every flow, funnel, and friction metric, this is
not a cosmetic problem. It corrupts numbers in two distinct ways.

**Across a version boundary** — the "did this release change behavior" question that
`service.version` exists to answer — the old node's traffic drops to zero and an unrelated
new node appears at the same instant. Read literally: *users completely abandoned the settings
form the day we shipped.* Nothing happened.

**Within a single query window that spans the deploy**, one element becomes two nodes, each
holding roughly half the traffic. Every edge in and out of it halves too. `minEdgeCount` then
prunes rare transitions, and a genuinely common path can fall below the threshold and vanish
from the graph as noise. The flow gets *less* accurate the more deploys the window covers,
which is the opposite of how anyone expects analytics to behave.

The mirror-image failure is worse in one specific way. A false **split** (one element, two
identities) is loud: a node disappears, another appears, and the discontinuity is visible. A
false **merge** (two elements, one identity) is silent — numbers simply blend, and nothing
announces it. Minified production builds cause mass false merges (§4.3), and that asymmetry,
not the raw rate, is why they are the tool's most serious limitation.

## What the fingerprint alone cannot tell you

A rename and a wholesale replacement are indistinguishable from the identity string. But they
are usually distinguishable from the evidence around it:

| Signal | Rename | Replacement |
|---|---|---|
| Timing | Both changes land exactly at one `service.version` boundary | Often the same, so not decisive |
| `url.path` | Unchanged | Frequently unchanged |
| `ux.role` | Unchanged | Often differs |
| Graph neighbours | Same predecessors and successors | Usually differ |
| Volume | Transfers roughly one-for-one | Rarely transfers cleanly |

Every input is already in the data. Events carry `service.version`, so drift pins to an exact
deploy rather than a fuzzy window, and `buildGraph` already computes each node's neighbours.

**But congruence is not proof, and the residual ambiguity is not spread evenly.** A redesigned
form, at the same route, with the same role and the same neighbours, replacing the old one,
matches every signal a rename does — and it is exactly the case where the two must *not* be
merged, because "did the redesign help?" is the whole question. The ambiguity concentrates on
the comparison people most want to make. That is not an argument for a better heuristic. It is
why a human has to confirm.

## The shape: propose, confirm, persist

**1. Propose.** After a deploy, detect fingerprints that stopped appearing at a version
boundary alongside congruent new ones, and raise the candidate:

> `App>SettingsForm|form` stopped appearing at **v4.3.0**. `App>ProfileForm|form` appeared at
> the same deploy — same route, same role, same neighbours, comparable volume.
> **Same element?**

**2. Confirm.** A person answers same or different. This is not a nag: it fires on the order
of once per deploy that touches instrumented components, and a developer can answer in two
seconds because they know what they shipped.

**3. Persist an alias.** Analysis joins on a resolved stable id rather than the raw
fingerprint, and the mapping is scoped by version so history stays correct on both sides of
the boundary.

### The mapping is a separate artifact, and events are never rewritten

Stored events are immutable facts about what was observed. The alias mapping is a **projection
applied at read time** — versioned, out of band, re-derivable, and independently editable when
a confirmation turns out to be wrong.

**Never repair drift by rewriting fingerprints at ingest.** That destroys the evidence that
the drift happened, which is precisely the evidence the confirm prompt, the dashboard display
below, and any future interpreter all depend on. The events say what was observed; the mapping
says what we have since concluded it meant. Keeping those separate is the whole design.

## Surfacing it in the dashboard

**The abstraction must be visible where the split happened, not hidden behind a resolved id.**
A silently merged node is indistinguishable from a node that never drifted, and that is the
same failure mode as rewriting on ingest — the number looks clean and the reader cannot tell
what was inferred versus what was observed.

So a node whose identity was resolved across a boundary is **marked in the flow graph**, at
the node where the split occurred, and the mark carries:

- both fingerprints, before and after,
- the `service.version` the split landed on,
- whether the merge was **confirmed by a person** or is still an **unreviewed proposal**,
- what changed — component chain, role, or accessible name — which is what tells a reader
  whether they are looking at a rename, a copy edit, or a translation.

Unreviewed proposals are rendered differently from confirmed merges and never silently folded
into a metric, in the same spirit as the friction layer presenting evidence rather than a
diagnosis (§12). The session timeline (§13.1) marks the same boundary where a session crosses
one, so a step that changes identity mid-flow is legible rather than looking like a jump to a
different element.

## Why this matters more for the interpretation layer than for a person

§11's discipline is that the model never sees events — it sees a compact deterministic summary.
Without stored identity parts that summary can only say *a node disappeared and another
appeared*, and a model handed that will confidently narrate a UX regression, because that is
what the numbers look like.

With them it says: *the component chain changed from `App>SettingsForm` to `App>ProfileForm`
at v4.3.0; role, route and neighbours unchanged; confirmed same element by a person* — and
the correct interpretation is that nothing happened here.

This is also the cleanest case in §12's correlation-versus-causation problem, and an unusual
one. Most of §12 can only be mitigated by careful framing. A rename masquerading as a drop-off
is a spurious correlation that can be **eliminated mechanically**, not hedged into a "this
pattern may indicate" hypothesis. Storing the parts is what makes elimination possible.

## What it requires from the conventions

`ux.component_chain`, `ux.role`, and `ux.accessible_name` move from Opt-In to Recommended and
default-on, under a strict invariant: **emit exactly the parts that composed the fingerprint,
and nothing more** (see [`SEMANTIC-CONVENTIONS.md`](SEMANTIC-CONVENTIONS.md)).

That invariant is what makes the change privacy-neutral rather than a data-exposure tradeoff.
The parts are *already* leaving the browser, concatenated inside `ux.fingerprint`, which is
Required on every event:

```
App>SettingsForm|form|"Save Profile"
└── chain ──┘ └role┘ └── acc name ──┘
```

Emitting them separately adds nothing to the wire that was not already there. It converts a
string consumers would otherwise have to parse — which the conventions explicitly say they
SHOULD NOT do — into fields they can query.

They are **Recommended, not Required**, deliberately. The conventions' closing claim is that
the analysis layer depends only on the Required set, so a minimal third-party emitter still
produces fully usable flows and timelines. Nothing in flow reconstruction needs the chain;
it is identity *resolution* that needs it, and that degrading gracefully is exactly what
Recommended means.

**Known cost of the invariant.** The chain is capped at depth 4 (§4.2.1). If the identity
spike finds that cap is itself a churn driver — an edit four levels up silently re-identifying
everything beneath it — stored data cannot be re-derived at a deeper cap without
re-collecting. The invariant is still worth keeping: provable privacy-neutrality is worth more
than a hypothetical re-derivation. Revisit only if the spike implicates the cap.

## Prior art in OpenTelemetry, and why none of it fits

OTel does not cover this, which is expected — §5 says OTel standardizes the generic slots and
leaves "which element a user touched and what its stable identity is" to us. Element identity
is ours, so its drift is ours too. Three adjacent things are worth mirroring rather than
reinventing:

- **Telemetry Schemas** are the closest structural match: a `schema_url` points at a versioned
  file declaring transformations (`rename_attributes`, `rename_metrics`) so consumers can
  normalize across a version boundary without anyone rewriting stored telemetry. That is this
  design's shape exactly — but schemas operate on **names and keys**, not on **values**, and
  the fingerprint is a value inside an attribute. (They are also thinly adopted.)
- **`session.previous_id`** is a real in-spec precedent already reused here: when a session
  continues under a new id, OTel emits a pointer to the old one rather than mutating anything.
  Link, don't rewrite — the same rule as above.
- **The Entities work** (identifying versus descriptive attributes, where descriptive
  attributes may change while identity holds) is the nearest concept, but is scoped to the
  entity *producing* telemetry — a host, a pod, a service — not to a UI element.

## What has to be true before this gets built

Deferred behind both gates. Its trigger is the detectability measurement in
[`VALIDATION-PLAN.md`](VALIDATION-PLAN.md) §3.2: for each churned fingerprint in the spike's
corpus, could a rule using version boundary + route + role + neighbours have flagged it and
proposed the correct match? If proposals are mostly right, this design is viable. If they are
mostly wrong, the prompt becomes noise a developer learns to dismiss, and the answer is the
build-time plugin's source-location anchor (§4.3) instead — a rename does not move a file, so
source location survives what the component name does not.

Phase 0 does not need any of this. Hand-placed `data-telemetry-id` on one flow's elements
means no drift at all for that exercise.
