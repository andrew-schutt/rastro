# VALIDATION PLAN — closing the two de-risking gates

*What comes after the walking skeleton, and why it is not more building.*

[`DESIGN.md`](DESIGN.md) §16 sequences the work to de-risk, and is explicit that the risky
assumption is **"can auto-captured React behavior become a recommendation a professional
trusts?"** — not "can a dev install a provider?" It puts two gates in front of everything:

- **Phase 0 (Wizard of Oz)** — manually analyse one real app with real traffic, show the
  output to its actual PM or designer, and see if they act on it. §16 calls this *"the gate"*
  and says to do it in week two, before building anything real.
- **Phase 1 (identity spike)** — build the composite fingerprint and *measure* its
  false-merge / false-split rate on a real app across real deploys.

§19's closing names stable element identity and clean seams as the project's **two existence
conditions**. The seams are in place and typed. Identity is *built* but has never been
measured.

**Both gates are still open, and the walking skeleton spans Phases 1–5 in thin form.** The
plan has been built through in one dimension while neither de-risking gate has been closed.
This document is the plan for closing them.

---

## 1. Corrections to the framing

Three things that look true from the outside and are not, each of which changes what the next
body of work should be.

### 1.1 Hardening is not a prerequisite for Phase 0

The natural instinct is to close the holes in [`NOTES.md`](NOTES.md) first, so that a Phase 0
exercise measures the tool rather than its bugs. But §16 defines Phase 0 as *"Manually
instrument it, run sequence analysis and AI interpretation **by hand** — no SDK, no ingestion
stack."* **Phase 0 does not use the tool.** It is a test of the *product idea*, not of the
implementation. Hardening cannot be justified as a precondition for the gate that matters
most. It applies only to Phase 1, and only to Phase 1's production half.

### 1.2 Minification is the biggest limitation but not the biggest blocker

*Minified production builds destroy fingerprints* is correctly stated in the README as the
tool's single most important limitation. It is **not** a Phase 0 blocker. §4.2.1's
`data-telemetry-id` override wins over everything, skips the fiber walk entirely, and is
immune to minification. Hand-placing it on the 20–40 elements of one flow *is* the "manually
instrument it" that §16 asks for.

`NOTES.md` orders its known holes by how much each hurts the product. The plan needs the
orthogonal ordering — **which holes block a gate** — and the two orders barely overlap.

### 1.3 §16 hides three preconditions on Phase 0

- **A real app with real traffic.** Not the demo app.
- **A named PM or designer who will give you an hour and then act.** This is a recruiting
  problem with weeks of lead time.
- **A legal footing.** Putting autocapture on someone else's production users is
  personal-data processing (§15). §16 is silent on this and it will end the conversation
  before it starts if it is not ready in advance.

Consequently the two gates are **not equally expensive**. Phase 1's measurement is entirely
self-serve — no volunteers, no traffic, no deploys of our own. Phase 0 blocks on other
people. They should run in parallel, longest lead time started first, not in §16's numeric
order.

### 1.4 The skeleton was not a detour

Building through Phases 1–5 before closing the gates made both gates *cheaper*. Phase 0's
collection is now a provider drop-in instead of hand instrumentation, and Phase 1 has a real
fingerprint implementation to measure instead of a hypothesis.

---

## 2. The decision

**Run both gates in their cheapest honest form. Fold in only the fixes the Phase 0 run itself
requires. Build nothing outward.**

The alternatives considered were: harden the holes first (§1.1 dissolves the case for it), or
build outward into Phase 3/4 work — columnar storage, funnels, spaghetti-taming, segmentation.

**What this trades away:** roughly six weeks with no new capability and nothing new to demo.
If the gates come back positive, that time will have been spent confirming what we suspected.
That is the cost of the option and it is the right one to pay: every deferred item in §5 is a
bet on an answer we do not have, and three of them — funnels, segmentation, spaghetti-taming —
cannot be specified correctly without a real user. Building them now means building them
twice.

---

## 3. The sequence

### 3.0 — Tag `v0.0.1`

Five minutes, unrelated to the rest. Nothing currently marks which commit the published
`0.0.1` came from. Do it while it is still unambiguous.

---

### 3.1 — Recruit the Phase 0 host · start now · blocks nothing, gates everything

One real React app with real traffic, and one named person who owns its UX. Not a friend who
will be kind about it — someone who ships changes.

**Done:** a named person, a named app, a scheduled session, and their written agreement to
instrument one flow.

**How we know it worked:** it is on a calendar.

**If no host is found in three weeks:** write that down as the finding. §16 says this is *the*
gate; a gate that cannot be run is a real result about the project's position, not a licence
to substitute the demo app. **Running Phase 0 on `examples/demo-app` proves nothing** — we
already know what our own app does.

---

### 3.2 — The identity spike, run offline · ~1 week · needs nobody's permission

§16 frames Phase 1 as "deploy on one app across a few deploys and measure," which makes it
look blocked on the same real-app access as Phase 0. It is not. Three measurements, in
increasing cost:

**a) Within-commit collision rate.** Render one commit of a real React app, fingerprint every
interactive element, count distinct elements sharing a fingerprint. No history, no traffic, no
ground truth, no labelling. Run it against **a dev build and a minified prod build of the same
commit** and the README's biggest caveat stops being an adjective: *"on app X, 4% of
interactive elements collide in dev and 61% collide in prod."* That single comparison is what
decides whether §4.3's build-time plugin is the next thing built.

**b) Per-deploy churn.** Walk ~10 real commits over ~a month. What fraction of fingerprints
vanish and reappear per deploy? Needs no oracle. If it is 30%, month-over-month comparison is
impossible and the composite fingerprint needs redesign before anything downstream matters.

**c) False split, with a weak oracle.** For elements whose route + role + accessible name are
unchanged across a commit pair, did the fingerprint change? That isolates component-chain
churn, which is the part §4.2.1 calls the primary stabilizer.

**One design wrinkle to settle before writing the harness.** Two identical buttons in a
rendered list *correctly* share a fingerprint — that is a right merge, not a false one, and
§4.2.1's tradeoff table deliberately excluded position hints to get it. The harness must
distinguish "collides with a semantically distinct element" from "collides with its own
repeated siblings," or the collision number is meaningless. Settle that definition first.

**Done:** `scripts/identity-spike/`, plus a written report carrying all three numbers across
≥2 real apps and ≥10 commits. Use apps we do not control — OSS React products with real
history work fine.

**How we know it worked:** the numbers force a decision. **Pre-commit to the thresholds before
seeing them**, or we will rationalize whatever comes out. Proposed: dev collision < 5%, churn
< 10% per deploy.

**If dev collision or churn is bad:** stop here. That is the §19 existence condition failing,
and the fix is fingerprint redesign, not more product.

---

### 3.3 — The two fixes Phase 0 actually requires · ~1 week · only after 3.2 passes

Deliberately sequenced after the spike: if identity fails, these are never built.

**Session persistence + the §4.5 idle rule.** Today every reload is a new visitor and a new
session, because no browser storage is used. On real traffic this does not degrade the
analysis, it *invalidates* it: `FlowEdge.count` is sessions, and `dropoffRate` is "hit this
node, then ended." Both become noise when sessions die at page boundaries. `sessionStorage`
for `session.id`, `localStorage` for `ux.anonymous_id`, 30-minute idle default, threshold
configurable. This also settles §17 unknown #3 by forcing the rule to be written down.

**The unload path (§4.4).** `ux.form_abandon` and exit are precisely the signals Phase 0 wants
to put in front of a designer, and they are the ones that die on teardown —
`transport.ts` relies on the exporter's `fetch` keepalive, and `sendBeaconOtlp()` sits unused
because the one-method `Exporter` interface cannot express "deliver during teardown."

⚠ Fixing this **modifies a seam**, and §19's closing names clean seams as the *other*
existence condition. Grow `Exporter` by an optional second method so every existing exporter
stays valid, keep batching and the flush lifecycle above the seam per §19.6, and do it now
while nobody depends on `0.0.1`.

**Done for both:** driven in a real browser, not just jsdom — per `NOTES.md`, four bugs were
found that way that unit tests missed and would have kept missing. Specifically: a reload
mid-session continues the session; a 31-minute idle starts a new one; a form abandoned by
closing the tab arrives at the collector.

---

### 3.4 — The privacy minimum for touching someone else's users · ~2 days

Not the full §4.9 allow/deny model — the minimum that makes instrumenting a stranger's
production app defensible:

- a `consent` flag on every event (§15),
- a `track()` prop deny-list covering numeric PII (`{ userId: 84213 }` is currently
  unredacted),
- a one-page written statement of what Rastro collects, that the host app's owner can
  actually read.

This is a precondition §16 omits entirely.

---

### 3.5 — Run Phase 0 · ~1 week of traffic, then a few days of analysis

One flow. `data-telemetry-id` hand-placed on its elements, which sidesteps minification
entirely and *is* the manual instrumentation §16 asks for. Autocapture on for everything else,
derived fingerprints treated as untrusted. Collect a week.

Then do the sequence analysis and the interpretation **by hand** — no `Interpreter`, per §1
and per §16's own wording.

**Done:** one Observation · Evidence · Hypothesis · Recommendation document in §11's shape,
**with no confidence number** (§11: confidence is theatre until Phase 7), delivered in person.

**How we know it worked:** not enthusiasm in the room. A change shipped or scheduled within
two weeks. §16's bar is *"I'm changing this tomorrow"* — hold it there.

Note what this actually tests: whether a *hand-made* recommendation from this data is trusted.
That is the **upper bound** on the AI version. If a careful human analysis does not clear the
bar, §17 unknown #6 is answered negatively and no model fixes it.

---

### 3.6 — Write the verdict down · ~1 day

Into `NOTES.md`, in the same register as the rest of it: both gates, the numbers, and what we
would do differently. **A negative result recorded honestly is the most valuable artifact this
plan can produce, and it is the one most likely to go unwritten.**

---

## 4. Timeline

| | Item | Effort | Depends on |
|---|---|---|---|
| 3.0 | Tag `v0.0.1` | minutes | — |
| 3.1 | Recruit Phase 0 host | 1–3 weeks, mostly waiting | starts day 1 |
| 3.2 | Identity spike | ~1 week | — |
| 3.3 | Session persistence + unload | ~1 week | 3.2 passing |
| 3.4 | Privacy minimum | ~2 days | — |
| 3.5 | Phase 0 run | ~1.5 weeks | 3.1, 3.3, 3.4 |
| 3.6 | Verdict | ~1 day | 3.2, 3.5 |

Roughly **4–6 weeks**, with 3.1 running in the background throughout.

---

## 5. Explicitly not doing

The plan's discipline has been to scope narrow on purpose. Each of these is a decision on the
record, not an oversight.

| Not doing | Why |
|---|---|
| ClickHouse / columnar store (§8) | 50k events is not a binding cap at zero users. §8 says name the engine early because it is expensive to change — but the query shapes that decide it come from the Phase 0 app. |
| Funnels (§9) | A funnel needs a human to define the steps. That human is Phase 0's *output*, not its input. |
| Segmentation / user properties (§14) | Same dependency, and nothing to segment without traffic. |
| Spaghetti-taming beyond `minEdgeCount` (§8) | Undecidable on ten demo nodes. Phase 0 produces the first real graph and will say whether loop collapsing or long-tail folding is the one that matters. |
| `Impact × Confidence × Frequency` ranking (§11) | §11's own text: confidence is theatre before Phase 7. Frequency-only is the honest state. |
| `Interpreter` / any AI (§1, §11) | By charter, after the analytics stand alone. Phase 0 is the test of whether they do. |
| Build-time plugin (§4.3) | **Conditionally deferred, not dismissed.** It becomes the immediate next work if the prod collision number from 3.2 is bad *and* Phase 0 comes back positive. Building it before Phase 0's answer is building the fix for a tool that may not exist. |
| Per-router `RouteAdapter`s (§4.6) | Build the one the Phase 0 host app needs. One adapter chosen by evidence, not four on spec. |
| Full §4.9 allow/deny model | Deny-list only, per 3.4. The general model waits for a real app's requirements. |
| rrweb session replay (§12, §14) | §12 calls it the real answer to causation. Phase 0 is exactly the experiment that shows whether §13.1's timeline is a sufficient substitute — run it before paying rrweb's complexity and privacy cost. |
| Browser-level E2E in CI | Real, but moves neither gate. The CDP driving already exists as scripts; keep it manual for now. |

---

## 6. Against §17's unknowns register

**Directly resolved**

- **#1 Fingerprint stability** — the entire subject of 3.2, and the register's one entry
  explicitly marked *"measurable early; measure it."*
- **#6 AI trust** — 3.5 tests its upper bound.
- **#3 Sessionization rule** — 3.3 forces the rule to be written; the Phase 0 traffic says
  whether 30 minutes fits.

**Informed but not settled**

- **#4 Build-plugin burden** — the dev-vs-prod collision gap prices the *benefit* precisely.
  The SWC/Babel *cost* stays open until one is written.
- **#2 The automatic-capture line** — the Phase 0 host will say what reads as noise. One app,
  which is one data point rather than an answer.

**Newly exposed**

- **#7 Consent bias** stops being hypothetical the moment the host app has a consent gate: the
  accept rate becomes visible, and the dashboard has to state which population a number
  describes.
- **New: the collision metric has no agreed definition.** A repeated list item sharing a
  fingerprint is correct behavior, so "collision rate" is undefined until the
  semantic-distinctness rule is fixed. This is the wrinkle in 3.2 and it is a genuine open
  question about §4.2.1's decision to exclude position hints.

**Untouched, and correctly downstream of both gates**

- #5 (mining algorithm fit), #8 (confidence calibration), #9 (semantics vs. automation).
