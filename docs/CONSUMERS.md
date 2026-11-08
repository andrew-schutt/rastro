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
one LogRecord body is legal, but it is a snapshot dressed up as an event. Open question 1
covers this.

### Four rules the output has to keep

1. **Derived records must never be mistaken for observed ones.** If findings travel through
   the same collector as interactions, a naive consumer will count them as interactions. Rastro
   will also re-ingest its own output. Derived records need their own instrumentation scope,
   their own event names, and an ingest path that rejects them as input.
2. **Every claim links back to the events that support it.** A finding carries the `session.id`
   values and `ux.event_id` values it rests on, so a person or an agent can check it against
   the raw stream. This is the one design principle from the sketch adopted without change.
3. **The `ux.*` namespace stays a capture contract.** Output vocabulary is a separate, versioned
   section of the conventions, or a sibling document. Mixing the two would make
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
   bespoke JSON endpoints. Until then, the dashboard is the deviation recorded in §2.
5. **Identity resolution exists**, before Rastro's output can support any consumer claiming a
   fix worked.

---

## 6. Open questions

1. **Is the flow graph an output record, or a view?** One option: emit findings and
   per-session summaries as Events, and rebuild the graph from those on the consumer side. The
   other: emit graph snapshots, with a window and a `service.version` range. The second is
   simpler to read and harder to keep honest.
2. **What is the person's view of the feed?** Rule 4 says it shows the same records the agent
   gets. Whether that is the dashboard, a collector `debug` exporter, or a plain log of what the
   query interface returned is open. The cheapest one that cannot drift wins.
3. **What does an agent need that the conventions lack?** `ux.source_file` exists (0.3) and may
   be the most agent-useful attribute there is. Whether a finding needs more, such as a
   component's props shape or a route's source, is unknown until an agent tries to use one.
4. **Where do output records live?** The same `EventStore`, kept apart by rule 1, or a second
   store. This is the same storage question §8 defers, and it stays deferred.

---

## Sources

Checked 2026-11-08.

- [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/):
  the `Body` and attribute values are `AnyValue`, which allows nested maps and arrays.
- [LogRocket Galileo AI docs](https://docs.logrocket.com/docs/galileo): surfaces rage clicks,
  dead clicks and slow network requests as user struggle.
- [PostHog: session replay over MCP](https://posthog.com/docs/session-replay/surfaces/mcp): agents
  search replays by events, person properties, and rage and dead clicks.
