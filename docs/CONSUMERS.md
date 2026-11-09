# CONSUMERS — who reads Rastro's output, and in what shape

*Direction, recorded 2026-11-08. Nothing here is scheduled. Both of §16's gates are still open,
and [`VALIDATION-PLAN.md`](VALIDATION-PLAN.md) still governs what gets built next.*

**Rastro's output will be consumed first by AI agents, feeding a software factory. Later, other
producers will feed it and other consumers will read it, a dashboard among them. Whatever the
producer or the consumer, the output is OpenTelemetry.** Rastro is a transform from OTel
records to OTel records. What it adds in between is component identity and the flows built on
it.

**Rastro is the output library, not the factory.** It emits findings and stops. Writing tests,
fixing code, shipping and judging whether a fix worked all belong to whoever consumes the
output. **A person stays in view.** A person checks the output before any agent relies on it,
and a person can always look at exactly what is being fed to an agent.

This document records that direction, what it changes, and where it is weaker than it looks.
It started from an outside sketch of an "AI-consumable UX flows" product. That sketch was read
skeptically, and most of its specifics are not adopted. The review is
[in §4](#4-the-sketch-read-skeptically).

---

## 1. The shape: OTel at both boundaries

```
 producers              Rastro                              consumers
 ─────────              ──────                              ─────────
 rastro-react ─┐                                         ┌─▶ AI agent / software factory (first)
 other ux.*   ─┼─▶ OTLP ─▶ sessionize → graph ─▶ OTLP ───┼─▶ dashboard                   (later)
 emitters     ─┘   in      → friction             out    └─▶ any OTLP backend            (via Collector)
                           (flat internal types)
```

**In.** Unchanged. [`SEMANTIC-CONVENTIONS.md`](SEMANTIC-CONVENTIONS.md) already calls itself the
contract that *"any instrumentation — first-party SDK or otherwise — should conform to."*
`rastro-react` is one producer, not the definition of one.

**Inside.** Unchanged. §19.3's rule holds: the OTel envelope stops at `sessionize`, and
analysis works on flat types (`packages/core/src/shapes.ts`). Nothing here pushes OTel deeper.

**Out.** New. Analysis output goes back into an OTel envelope at the boundary, the way the
Exporter seam (§19.6) translates at the edge on the way in. Each derived record is an OTel
**Event**, a `LogRecord` with an `eventName`, never a span. The conventions already say flows
are discovered and not declared, so they cannot be spans. A finding is the same kind of thing.
OTel can carry the payload. A LogRecord's body is `AnyValue`, which holds nested maps and
arrays, and so do its attribute values
([logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)).

### What "output is OTel" commits to, and what it does not

It commits to a **record format**. Any consumer can read Rastro's output with OTel tooling and
no Rastro-specific parser, and the OTel Collector can route it, filter it and fan it out like
anything else.

It does **not** give anyone a **query interface**. An agent does not read an OTLP stream. It
asks a question and wants an answer that fits in its context window. Something still has to
store the records and answer questions over them, whether that is MCP, HTTP or a backend's
own query language. That piece is extra work. "OTel out" decides what it returns, not whether
it needs building.

It also does **not** make every analysis output a natural record. A finding, or one session's
summary, is a point-in-time fact and fits an Event well. The flow graph does not. It is an
aggregate over a window, and it changes whenever a session arrives. Putting a whole graph in
one LogRecord body is legal, but it is a snapshot dressed up as an event. **Settled
2026-11-08:** the graph is a view over the interaction events, and findings are the only derived
record ([`OUTPUT-CONVENTIONS.md`](OUTPUT-CONVENTIONS.md)). A session summary detailed enough to
rebuild the graph would be a second copy of observed data.

### Four rules the output has to keep

1. **Derived records must never be mistaken for observed ones.** If findings travel through
   the same collector as interactions, a naive consumer will count them as interactions. Rastro
   will also re-ingest its own output. Derived records need their own instrumentation scope,
   their own event names, and an ingest path that rejects them as input.
2. **Every claim links back to the events that support it.** A finding carries the `session.id`
   values and `ux.event_id` values it rests on, so a person or an agent can check it against
   the raw stream. This is the one design principle from the sketch adopted without change.
3. **The `ux.*` namespace stays a capture contract.** Output vocabulary is a separate, versioned
   document, [`OUTPUT-CONVENTIONS.md`](OUTPUT-CONVENTIONS.md). Mixing the two would make
   `ux.convention.version` move for reasons no emitter cares about.
4. **A person can read what the agent reads, easily.** The records an agent receives must be
   readable by a person as they are, with no separate rendering that could drift from them. A
   view for people sits beside the agent's feed, never in front of it, and shows the same
   records. If what the person sees and what the agent sees can differ, the person is checking
   the wrong thing. This is why output size matters twice: an agent has a context budget, and a
   person peeking has an attention budget.

---

## 2. Consumers and producers over time

| Who | Role | Reads / emits | State today |
|---|---|---|---|
| AI agent in a software factory | First consumer. The factory is not part of Rastro | Findings with evidence, through a query interface | Nothing built |
| A person checking the feed | Alongside the agent, from the start | The same records the agent reads (rule 4) | Nothing built |
| `apps/dashboard` | Later consumer | Today: bespoke JSON from `GET /projects/:app/graph` and `/sessions/:id` | Built. Its output is **not** OTel, a deviation from this rule |
| Any OTLP backend (Grafana, Honeycomb, …) | Consumer of raw input | Interaction events, through `multiExporter` fan-out | Works for input today. Nothing derived reaches it |
| `rastro-react` | Producer | `ux.*` Events over OTLP | Built |
| Other `ux.*`-conforming emitters | Later producers | `ux.*` Events over OTLP | Allowed by the conventions. None exists |

**Other producers are weaker than they sound.** Any emitter that does not produce a conforming
`ux.fingerprint` reduces Rastro to selector-keyed path analysis, which PostHog, Amplitude and
Mixpanel already ship ([`PRIOR-ART.md`](PRIOR-ART.md)). A Faro stream or a generic RUM feed is
not a Rastro producer just because it speaks OTLP. Component identity is the differentiator,
and it comes from the producer.

---

## 3. What this does and does not change

**Does not change:**

- **No model inside Rastro.** The `Interpreter` seam stays `none` (§1, §11, §19.5). An agent
  that reads Rastro's output is a consumer outside the boundary. It is not an interpreter
  wired in. The standing decision holds as written.
- **Validate, don't build outward.** Every item in `VALIDATION-PLAN.md` §5's not-doing list
  stands, including frequency-only ranking and no confidence numbers.
- **Interactions are Events, never spans.** That rule now covers derived records too.

**Changes:**

- **The name of the first audience.** §2's last box and §13 assume a person reading a
  dashboard. The first reader is now an agent, with a person able to see what it sees (rule 4).
  The dashboard stays as a later consumer.
- **The "stand alone" test needs restating.** §16 Phase 5 asks whether the output is
  *"valuable with AI turned off"*, which assumed a human reader. The version that survives
  agent-first consumption: **a person must be able to read Rastro's output and verify every
  claim in it against the raw events, with no model involved.** If they cannot, an agent acting
  on it is acting on noise faster.
- **Phase 0 does not change.** A person checks the output first, as §16 already says. The
  decision is the maintainer's, 2026-11-08. §12's qualified-evaluator paradox is why: an
  agent cannot tell a right finding from a plausible one, so it cannot be the first judge.

---

## 4. The sketch, read skeptically

The sketch proposed an end-to-end loop: Rastro clusters broken flows into ranked issues, an
agent writes a failing browser test from the session, fixes the code and ships it, and Rastro
reopens the issue if the pattern survives the deploy. The idea of an agent as the reader is
adopted. Most of the mechanics are not, or not yet. **The loop itself is out of scope:**
Rastro is the output library, not the factory, so test-writing, fixing and issue tracking are
the consumer's. The rows on them stay because they constrain what the output must carry.

| Claim in the sketch | Verdict | Why |
|---|---|---|
| Agents are the first-class consumer; humans supervise | **Adopted**, sharpened | The maintainer's decision. A person checks the output before an agent relies on it, and can always see exactly what an agent is fed (rule 4). |
| Rastro is the whole software factory | **Rejected** | The maintainer's decision. Rastro is the output library and stops at findings. |
| Every claim links to raw events | **Adopted** | Rule 2 above. |
| Output states "the likely causal chain" ("users abandon here *after* this component ignores clicks") | **Rejected** | §12: the data cannot establish causation. A human reader discounts a stated cause, but an agent treats it as a spec and fixes it. Output carries observations and competing hypotheses, never a single cause. |
| A confidence threshold routes low-confidence clusters to a human | **Rejected** | §11 calls confidence theatre before Phase 7, and the project does not invent thresholds. Any routing rule has to be pre-committed as comparative or absolute-zero, the way `VALIDATION-PLAN.md` §3.2 does it. |
| Session → failing Playwright test that replays the path | **The factory's job; unproven either way** | Rastro deliberately captures no input values (the conventions make redaction a MUST), and no DOM state, viewport or backend state. A fingerprint is not a selector. `data-rastro-component` plus role and accessible name may locate an element, but nobody has tried. A test built this way reconstructs the path. It does not reproduce the session, and it can pass while the bug stays. Any consumer that tries this should be told so by the output. |
| Post-deploy verification: the bad pattern disappears, or the issue reopens | **The factory's job, and unsafe on today's output** | A fix usually edits the very components involved, which moves their fingerprints. The old node's traffic then drops to zero because its identity split, not because the problem went away. That is exactly the drift [`IDENTITY-RESOLUTION.md`](IDENTITY-RESOLUTION.md) describes, and the alias layer is unbuilt. Without it, "verified fixed" and "renamed" look the same. It also needs `service.version`, which is only Recommended, though `rastro-react` emits it when the provider is given one. Rastro's part is to carry `service.version` on findings and say when a node's identity may have drifted, so a consumer cannot mistake a rename for a fix. |
| Flow-shape clustering, impact ranking | **Deferred** | §8 trace clustering and §11 ranking are on `VALIDATION-PLAN.md` §5's not-doing list. Frequency-only is the honest ranking today. |
| MCP interface | **Plausible later** | This is the query interface from §1. Cheap once something is worth querying, and it moves neither gate. |
| Incumbents "start from exceptions"; flow problems that throw no error "never become work" | **Overstated** | Friction without errors is a decade old ([`PRIOR-ART.md`](PRIOR-ART.md)). LogRocket's Galileo AI surfaces rage clicks, dead clicks and slow requests, not just errors ([docs](https://docs.logrocket.com/docs/galileo)). PostHog's MCP server lets a coding agent search replays by rage and dead clicks ([docs](https://posthog.com/docs/session-replay/surfaces/mcp)). Agent-readable UX telemetry is an occupied lane. |
| Differentiators: flow-shape clustering, session-to-test, post-deploy verification | **Not the differentiator** | The first is deferred, the second is unproven and the third is unsafe, all per the rows above. What is unoccupied is still identity keyed on component structure ([`PRIOR-ART.md`](PRIOR-ART.md)). For an agent that matters more, not less: a finding that names a component and a source file (`ux.source_file`) is one an agent can act on. A CSS selector sends it searching. |
| Landscape sourced from job postings | **Not used** | A job posting is not evidence of a shipped product. The product pages above replace it. |
| "A strong portfolio piece" | **Not recorded** | Not a property of the software. |

---

## 5. What would have to be true first

In order. None of these is scheduled, and the first two are already the plan.

1. **§3.2 passes.** No identity means no finding worth handing an agent.
2. **Phase 0 comes back positive**, judged by a person (§3).
3. **An output vocabulary exists**, versioned and separate from the capture contract (rule 3),
   with derived records marked (rule 1) and evidence links (rule 2).
4. **The dashboard reads the same OTel-shaped output** as any other consumer, which retires the
   bespoke JSON endpoints. Until then, the dashboard is the deviation recorded in §2. §7 is
   the list of what that takes.
5. **Identity resolution exists**, before Rastro's output can support any consumer claiming a
   fix worked.

---

## 6. Open questions

1. ~~**Is the flow graph an output record, or a view?**~~ **Settled:** a view over the
   interaction events. Findings are the only derived record. See §1 and
   [`OUTPUT-CONVENTIONS.md`](OUTPUT-CONVENTIONS.md).
2. **What is the person's view of the feed?** Rule 4 says it shows the same records the agent
   gets. Whether that is the dashboard, a collector `debug` exporter, or a plain log of what the
   query interface returned is open. The cheapest one that cannot drift wins.
3. **What does an agent need that the conventions lack?** `ux.source_file` exists (0.3) and may
   be the most agent-useful attribute there is. Whether a finding needs more, such as a
   component's props shape or a route's source, is unknown until an agent tries to use one.
4. **Where do output records live?** The same `EventStore`, kept apart by rule 1, or a second
   store. This is the same storage question §8 defers, and it stays deferred.

---

## 7. Work list

What the code needs to carry this direction, in the order to do it. Items 1 to 4 need no gate:
they are small, touch nothing a gate measures, and are needed under any output shape. Items 5
to 8 wait for §3.2 to pass and Phase 0 to come back positive. Each item is one PR.

**Needs no gate**

- [x] **1. Move the OTLP codec to `core`, and teach it maps and `body`.** `toOtlpLogs` and
  `toAnyValue` live in `packages/react/src/otlp.ts`, the decoder in `apps/collector/src/ingest.ts`,
  and both drop object values. A finding needs map attribute values (`kvlistValue`) and the
  LogRecord `body`, which neither side models. ~~`AttributeValue` in `core/events.ts` widens to
  match.~~ *As built:* `AttributeValue` and `UxEvent` did **not** widen. Widening them would
  let interactions carry maps with no conventions change, which rule 3 forbids. The codec is
  wide; the collector narrows interactions back to the capture contract before validating.
  Teaching the encoder maps also exposed that `track()` passed object props through
  unredacted, so `sanitizeProps` now drops them.
  *Done:* one encoder and one decoder in `rastro-core`, imported by `rastro-react` and the
  collector; a record with a map attribute and a structured body round-trips unchanged.
  *How we know:* a round-trip test in `core`; the existing collector and SDK tests pass with no
  change to what they assert.
- [x] **2. Read the instrumentation scope on ingest, and reject Rastro's own output by name.**
  `decodeOtlpLogs` never reads `scope.name`. A finding posted back to `/v1/logs` is rejected
  today only because it lacks `ux.fingerprint`, which is protection by accident. Rule 1 wants it
  explicit: records in the derived scope are refused and counted in `partialSuccess`.
  *Done:* the scope name is a constant in `core`; the decoder refuses it; the count is
  reported.
  *How we know:* a test posts a derived record and sees it rejected by scope, with the
  `ux.*` Required set present.
  *As built:* the scope is `rastro-analysis` (`DERIVED_SCOPE_NAME` in `core/derived.ts`). It is a
  deny-list of that one name, not an allow-list of `rastro-react`, because the conventions
  admit any instrumentation. An unknown scope, or none, is accepted. `partialSuccess` carries
  an `errorMessage` naming each reason, not just the count.
- [x] **3. Carry `service.version` through `Session`.** `sessionize` flattens the resource away,
  so no analysis output can say which deploy it describes. One session is one page load, so
  one version per session is exact today.
  *Done:* `Session` carries `serviceVersion?`; `FrictionSignal` carries it too.
  *How we know:* a sessionize test with two deploys yields two sessions with different
  versions; a snapshot of the `/graph` response changes only by the new field.
  *As built:* on `Step`, not `Session`. One version per session holds only while sessions are
  per page load, which is a known hole slated to close (§4.5's idle rule); after that a deploy
  can fall inside a session. Every signal points at one step, so `Step.serviceVersion` is exact
  under any session rule, and each `FrictionSignal` takes the version of the step it fired on.
  **Caveat for item 6:** `high_abandonment`'s rate is pooled across deploys, so a signal's
  version dates the occurrence, not the rate. A test pins a 4.2.2 occurrence firing at 67%,
  a rate 4.2.2 never had on its own. Per-version rates are not computed anywhere yet.
- [x] **4. Write the output vocabulary, and type it.** A sibling to `SEMANTIC-CONVENTIONS.md`
  with its own version: the derived scope name, event names (a finding, a session summary),
  their Required set, the evidence link shape (`session.id` + `ux.seq` pairs), and
  `service.version` on every record. This is where open question 1 is decided. The
  recommendation is findings and session summaries as Events, and the graph as a view rebuilt
  from them.
  *Done:* the doc exists; `core` has a `DerivedRecord` type and an `isDerivedRecord` check
  that match it, with a stable finding id (`kind` + `fingerprint` + `service.version`).
  *How we know:* the type and the doc name the same fields; a test builds a finding from a
  `FrictionSignal` and validates it.
  *As built:* [`OUTPUT-CONVENTIONS.md`](OUTPUT-CONVENTIONS.md) 0.1, `Finding` / `isFinding` /
  `findingId` in `core/derived.ts`, and `toFindings` in `rastro-analysis`. Three decisions, the
  maintainer's: **findings only**, with no session summary, and the graph as a view; **counts
  only**, so occurrences and sessions are exact per deploy, and no pooled rate rides on a
  per-deploy record; **the resource is the analyzed app**, and the scope says Rastro made it.
  `ux.convention.version` is Recommended, not Required as first outlined, because it is only
  Recommended on the evidence; `Step` now carries it so a finding can say which fingerprint
  format it uses. The finding type is named `Finding`, not `DerivedRecord`, since it is the only
  one.

**After both gates**

- [ ] **5. Make findings durable.** Today `/graph` recomputes everything per request from up to
  50k events, and a signal has no id or lifetime. Findings need `first_seen` / `last_seen`, a
  store kept apart from interactions (rule 1), and analysis that runs on ingest or on a timer
  rather than on page load.
  *Done:* `EventStore` or a sibling interface persists derived records; a finding seen twice
  updates, never duplicates.
  *How we know:* ingest the same sessions twice and the finding count does not change.
- [ ] **6. Emit.** `GET /projects/:app/findings` returning the OTLP logs JSON shape, and an
  `Exporter` widened to derived records so findings can also be pushed to a configured OTLP
  endpoint. Ranking in the feed uses sessions affected only; `magnitude` never crosses kinds.
  *Done:* a plain OTel consumer (the Collector's `debug` exporter is enough) reads the output
  with no Rastro code.
  *How we know:* drive the demo app, point an OTel Collector at the feed, and see the
  findings in its log, each with its evidence links.
- [ ] **7. Give the person the same feed (rule 4).** A findings view in the dashboard that
  renders the records from item 6 as they are, with each evidence link opening the session
  timeline. Then retire the bespoke `/graph` JSON, or rebuild it from the feed.
  *Done:* the dashboard reads no endpoint an agent could not.
  *How we know:* the known hole in `NOTES.md` is closed, and the browser verification says
  what was clicked.
- [ ] **8. A query interface.** MCP, over the findings store from item 5. Last, because it needs
  something worth asking about, and because an agent's first questions decide its shape.
  *Done:* an agent can ask for the top findings for an app and for one finding's evidence.
  *How we know:* a person asks the same question and gets the same records (rule 4).

Two things this list raises rather than settles. Findings today come from two signal kinds,
and the plan has been resisting more on purpose; an agent fed two kinds has little to act on,
so item 6 will put pressure on `VALIDATION-PLAN.md` §5. And per-page-load sessions, the first
known hole in `NOTES.md`, make every full-page form post end a session, so findings inherit
that error until the §4.5 session rule exists.

---

## Sources

Checked 2026-11-08.

- [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):
  the `Body` and attribute values are `AnyValue`, which allows nested maps and arrays.
- [LogRocket Galileo AI docs](https://docs.logrocket.com/docs/galileo): surfaces rage clicks,
  dead clicks and slow network requests as user struggle.
- [PostHog: session replay over MCP](https://posthog.com/docs/session-replay/surfaces/mcp): agents
  search replays by events, person properties, and rage and dead clicks.
