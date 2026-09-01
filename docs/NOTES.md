# NOTES — commit #1 (walking skeleton, step 1)

This is the scaffold in [`PLAN.md`](PLAN.md) §19. It stands up the pnpm monorepo and gets
**all six steps of §19.4** running end to end:

```
demo-app fires an event → otlpExporter → POST /v1/logs → SQLite
   → GET /projects/:app/sessions/:id → dashboard table
```

Capture and identity are both real: clicks, SPA route changes, and the form submit/abandon
pair are picked up with zero instrumentation, and each carries a stable composite fingerprint
derived from the React component ancestry — `App>Nav|button:button|"/users/42/settings"`.
The session timeline (§13.1) renders one session on a real time axis, the flow graph
aggregates every session into the paths users actually take, and the friction layer (§10)
flags rage clicks and high-abandonment nodes. No AI — and by design the analytics stand on
their own without it (§1).

---

## Running it

Requires **Node ≥ 22.18** and **pnpm** (`corepack enable pnpm`). Two things set that floor:
pnpm 11 imports `node:sqlite` and refuses to start below Node 22.13, and the collector's dev
script runs TypeScript directly via native type stripping, which needs 22.18.

That is the floor for *developing* this repo. The published libraries declare `>=20`, which
is a claim about consuming them — they are plain compiled ESM and need neither pnpm nor type
stripping. CI covers 22 and 24.

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Then three terminals:

```bash
pnpm --filter collector dev     # OTLP ingest + API   → http://localhost:4318
pnpm --filter dashboard dev     # the events table     → http://localhost:5173
pnpm --filter demo-app  dev     # the instrumented app → http://localhost:5174
```

Open **http://localhost:5174** and use it — every one of these is captured with no
instrumentation in the app:

| Do this | Emits |
|---|---|
| Click anything interactive | `ux.click` with `ux.interaction.method` |
| Click a nav button | `ux.route_change` with `ux.from_path` |
| Focus a field, then submit | `ux.form_submit` with time-to-complete |
| Focus a field, then click away without submitting | `ux.form_abandon` |

Fingerprints in the table are real derived identities. The demo deliberately leaves
`data-telemetry-id` off the form — the override matches an *ancestor*, so one there would
collapse every field inside into the form's identity.

The nav routes include `/users/42/settings`, so tokenization is visible in the table as
`/users/:id/settings`. Open **http://localhost:5173**; events appear within ~2s (it polls).
The **Flow** view is the aggregate: nodes are elements, edges are transitions labelled
`sessions × median dwell`, thickness scales with sessions, and an edge turns amber when it
leaves a node where at least half of sessions ended, and a red outline with a count marks a
node the friction layer flagged. A ranked friction list sits below the graph. The **Events**
view is the raw table —
click a `session.id` there to open that session's timeline: every step on a time axis
built from cumulative `ux.active_ms`, with the connector height proportional to the dwell — so
a long hesitation is literally the tallest gap on the page. That is §13.1's "replay-lite", and
it is the point of building this view before the flow graph.

Both Vite apps proxy to the collector, so the SDK posts to a same-origin `/v1/logs` exactly
as the README's default does, and the dashboard needs no endpoint configuration.

No backend at all? Swap the demo app's exporter for `consoleExporter()` and watch records in
the browser console.

### Useful endpoints

| Endpoint | Status |
|---|---|
| `POST /v1/logs` | **implemented** — OTLP logs in, `observedTimeUnixNano` assigned, insert |
| `GET /projects/:app/sessions/:id` | **implemented** — §13.1, via `sessionize` |
| `GET /projects/:app/events` | **implemented** — not in §19.1; step 1's table needs it |
| `GET /projects/:app/graph` | **implemented** — sessionize → buildGraph → detectFriction. `?minEdgeCount=` prunes rare transitions (§8) |
| `GET /health` | implemented |

The SQLite file is `apps/collector/rastro.sqlite` (override with `RASTRO_DB`; `:memory:`
works). Delete it to start clean.

---

## Implemented vs. stubbed

### Implemented

- **`rastro-core/events.ts`** — the `UxEvent` contract (§19.2) and `isUxEvent`, the Required-set
  check the collector rejects malformed records with.
- **`rastro-core/seams.ts`** — all seven swap points from §19.5, typed.
- **`rastro-core/redact.ts`** — the §4.9 privacy requirements, both of which the conventions
  make MUST-level: `tokenizePath` (`/users/42/settings` → `/users/:id/settings`, query
  strings and fragments dropped) and `redact` for free text. `buildEvent` is the single
  choke point that applies them, so no emit path can skip redaction by forgetting to.
- **`rastro-analysis/sessionize.ts`** — group by `session.id`, order by `ux.seq`.
- **`rastro-analysis/graph.ts`** — `buildGraph`: node hits, per-session transition counts,
  median dwell per edge, and drop-off rate. Pure, order-independent, and the only place any
  aggregate number is computed.
- **`rastro-analysis/friction.ts`** — `detectFriction`: rage clicks and high abandonment,
  ranked, plus `frictionByNode` to roll them up per element.
- **`rastro-react`** — provider, `useTelemetry().track()`, batching + flush lifecycle, and the
  three exporters (`otlp`, `console`, `multi`). `track()` props become attributes with string
  values redacted and reserved-namespace keys (`session.`, `url.`, `service.`, `ux.`)
  dropped, so an app cannot overwrite the Required set.
- **`react/capture.ts`** — delegated root capture (§4.1): one passive, capture-phase listener
  per event type at the document root, never per element. Emits all four interaction events,
  resolves a click to the nearest interactive ancestor, and drops inert background clicks.
- **`react/dwell.ts`** — the §4.5 clock. `ux.active_ms` only advances while the page is
  visible, so a backgrounded tab cannot inflate it, and dwell is capped at `MAX_DWELL_MS`
  so a walked-away-from-the-desk gap does not land in the data as engagement.
- **`react/forms.ts`** — the submit/abandon state machine, pure and DOM-free.
- **`react/route.ts`** — the default `RouteAdapter`: a reference-counted `history` patch plus
  `popstate`/`hashchange`.
- **`rastro-core/fingerprint.ts`** — §4.2.1 in full: the fiber walk, component chain with
  forwardRef/memo unwrapping and noise filtering, role descriptor, approximated accessible
  name (redacted), and composition with graceful degradation. `describeElement` returns the
  fingerprint *and* its raw parts from one pass, so identities can be re-derived later
  without re-collecting. The Opt-In attributes `ux.component_chain`, `ux.role`, and
  `ux.accessible_name` are emitted only when switched on via the provider's `optIn` prop.
- **`collector`** — OTLP decode, SQLite `EventStore`, the session endpoint.
- **`dashboard/FlowGraph.tsx`** — the flow graph in React Flow, over a hand-rolled layered
  layout (`layout.ts`). Vertical, because a user flow's long dimension is its step count and a
  browser window is wide but short — laid out horizontally the demo's ten-step flow shrank to
  an unreadable smear.
- **`dashboard`** — the plain events table (§19.4 step 1) and the real `SessionTimeline`
  (§13.1): steps on a cumulative-`ux.active_ms` axis, colour-coded by event kind, route
  changes highlighted where context moves, and `ux.interaction.method` per step. Its
  arithmetic lives in `timeline.ts`, pure and unit-tested, so the component only renders.

### Stubbed — real signatures, naive bodies, TODOs naming the work

| Thing | State |
|---|---|
| `core/redact.ts` | Text redaction and path tokenization are **real**. Still missing the per-attribute allow/deny model, which is what would catch numeric PII like `{ userId: 84213 }`. |
| `session.start` / `session.end` | Defined in the conventions, not emitted. Neither is needed by any analysis today, and `session.end` is unanswerable without the §4.5 idle rule. |
| `Interpreter` seam | Interface only, default `none`. The analytics must stand alone first (§1, §11). |

### Tests

`pnpm -r test` → **284 passing, 1 `todo`**.

Coverage sits in two deliberate layers.

**Pure, no DOM** (`sessionize`, `redact`/`tokenizePath`, `sanitizeProps`/`buildEvent`,
`createActiveClock`, `createFormTracker`, `interactionMethodOf`). The DOM-facing parts of
capture are thin wrappers over these, which is what keeps the interesting logic testable
without a browser at all.

**jsdom** (`capture.dom.test.ts`, `route.dom.test.ts`), for the wiring the pure tests cannot
reach: listener registration and teardown, resolving a click up to its interactive ancestor,
dropping inert background clicks, and the history patch's reference counting. Files opt in
with a `@vitest-environment jsdom` docblock, so the pure suites stay in node and stay fast.

Both layers earn their place — checked by mutating the source and confirming a test fails.
Reading `pointerType` before `detail` (which would label every keyboard user a mouse user) is
caught only by the pure test, because jsdom's `MouseEvent` has no `pointerType` to be misled
by. Making the history patch per-adapter instead of reference-counted is caught only by the
jsdom test.

Test-only dev dependencies: `jsdom` (both packages) and `react-dom` (the renderer, in
`packages/react` only — the SDK source never imports it, so it stays out of `dependencies`
and `peerDependencies`). React Testing Library is deliberately not used: React 19 exports
`act`, and `createRoot` is enough.

`apps/dashboard/src/timeline.ts` holds the timeline's arithmetic — axis placement, gap
scaling, duration formatting — separately from the component, so the part that can actually be
wrong is unit-tested without rendering anything.

`layout.ts` is likewise separate from `FlowGraph.tsx`, so ranking, cycle handling, and
collision-freedom are unit-tested without rendering React Flow.

### Verified end to end

Driven against a real headless Chrome with genuine mouse and keyboard input, on the demo app:

- `ux.click` classified `mouse` for pointer input and `keyboard` for Enter activation
- `ux.route_change` carrying `ux.from_path`, with `/users/42/settings` stored as
  `/users/:id/settings`
- `ux.form_abandon` after focusing a field and clicking a nav button
- `ux.form_submit` with a real time-to-complete, and **no false abandon** on the way to it
- `track()` props: `plan`/`seats` stored, `owner` redacted, `ux.seq: 999` dropped
- real fingerprints from the React tree: `App>Nav|button:button|"/users/42/settings"`,
  `App>SettingsForm|input:email`, `App>SettingsForm|form`
- a driven session rendering on the timeline: a 3.5s pause before navigating, a 6.5s
  hesitation before abandoning the form, then a submit — the tallest gap being the
  hesitation, which is exactly what §13.1 exists to surface
- four sessions aggregating into an 11-node flow graph, with a 6.5s median on the
  `SettingsForm input → form` edge and a 0.75 drop-off on the form
- three frustrated sessions producing `rage_click` on `id:save-profile` (max 5 clicks) and
  `high_abandonment` on `App>SettingsForm|form` (4 sessions, 100%), ranked in that order by
  sessions affected

The hidden-tab rule in `dwell.ts` is unit-tested rather than driven in the browser — there is
no CDP command to force `document.visibilityState`. Real pointer events are browser-only too:
jsdom has no `PointerEvent`, so the DOM tests synthesize `pointerType` onto a `MouseEvent`.

---

## Decisions worth knowing about

**`UxEvent` is a superset of §19.2.** The plan's snippet predates SEMANTIC-CONVENTIONS.md and
omits five attributes the spec defines: `ux.from_path`, `ux.component_chain`, `ux.role`,
`ux.accessible_name`, and the `ux.convention.version` resource attribute. They are added as
optional members, each tagged `[SPEC]`. Every Required attribute matches §19.2 exactly, so
nothing that conformed before stops conforming.

**`Step` / `Session` / `FlowGraph` live in `rastro-core/shapes.ts`, not in `rastro-analysis`.**
§19.3 declares them beside the functions that produce them, but `seams.ts` types
`GraphBuilder` and `Interpreter` in terms of them and `core` must never depend on `analysis`.
`rastro-analysis` re-exports them from `sessionize.ts` and `graph.ts`, so the import paths
§19.3 documents still hold.

**`NOISE` is wider than §4.2.1's regex.** The spec anchors `^Provider$`/`^Consumer$`, which
only match React's own `Context.Provider` displayName — and in React 19 a context provider's
fiber type is the context object, yielding no name at all, so the anchored form is nearly
dead code. Every real wrapper is named `ThemeProvider`, `AuthProvider`, `QueryClientProvider`
— or `RastroProvider`, which was landing in the chain of every fingerprint in the host app.
Matching the suffix is what the rule was plainly reaching for.

**`accName` does not take text content from containers**, where §4.2.1 takes it from any
element. Applied to a `<form>` the spec version produced
`App>SettingsForm|form|"Profile Display name Email Save Profile A button w"` — unstable (any
label inside re-fingerprints the form), a wider PII surface, and not an accessible name in
any real sense. W3C accname, which §4.2.1 says it is approximating, restricts name-from-
content to specific roles; this is that rule, tag-shaped. Author-supplied labels
(`aria-label`, `title`, `alt`) are still honoured on any element.

**The Opt-In attributes are off by default.** The conventions mark `ux.component_chain`,
`ux.role`, and `ux.accessible_name` as "captured only when explicitly enabled", so the
provider takes an `optIn` prop and emits nothing extra without it. The demo turns on
`componentChain` and `role`, and leaves `accessibleName` off — it is redacted, but it is the
closest thing to page content that leaves the browser.

**`Step` gained `eventName` and `interactionMethod`**, which §19.3 does not have. §13.1
requires the timeline to show `ux.interaction.method`, and a timeline that cannot tell a click
from a route change is not readable — so §19.3's `Step` cannot render the view §13.1
specifies. Adding them keeps the load-bearing rule intact ("the OTel envelope stops at
sessionize; downstream works on flat types, not raw records"); the alternative was the
dashboard reaching back into raw OTel attributes, which breaks it.

**`FlowEdge.count` is sessions, not traversals.** §19.3's field comment says "how many
sessions made this A→B transition", so a session bouncing A→B→A→B contributes 1. Edge weight
then answers "how common is this path across users" rather than letting one hammering user
dominate. `medianMs` still samples every traversal — more samples, better median. The two
readings are genuinely in tension in §19.3, which also says "walk consecutive step pairs →
tally edges"; the field comment won because it is the more specific statement.

**`dropoffRate` is a property of `from`, reported on every edge leaving it**, so all of a
node's outgoing edges carry the same number. That is what §19.3 specifies. It is redundant on
the wire and arguably belongs on `FlowNode` — worth settling before the shape ossifies.

**`labelFor` parses the fingerprint, which the conventions say consumers SHOULD NOT do.** The
distinction relied on: nothing it produces feeds a metric or a join. `FlowNode.id` stays the
whole fingerprint and everything is keyed on that; `labelFor` only decides what text sits
inside a box, and falls back to the raw fingerprint on anything unfamiliar.

**Two friction signals, where §19.4 step 6 says exactly one.** A deliberate call, not an
oversight. §10's own advice is to under-invest in inventing signals and over-invest in
*ranking* them (§11) — and ranking is undefined with a single kind. Two forced the real
question: `magnitude` is kind-specific (clicks vs. drop-off percentage) and must never be
compared across kinds, so `frictionByNode` ranks on sessions affected, the one number that
means the same thing for both. The cost is that `high_abandonment` partly restates what the
flow graph already showed, and that it is inherently an aggregate signal squeezed into a
per-session shape. If the friction list ever needs trimming, that is the one to cut.

**Rage detection sees through derived events.** Only a route change breaks a run. Clicking a
submit button emits `ux.click` *and* `ux.form_submit`, so treating every non-click as a break
made rage clicking a submit button — the likeliest place for it — undetectable. Found by
driving it in a real browser, not by a unit test.

**Three files in `packages/react` are not in §19.1's list**: `dwell.ts`, `forms.ts`, and
`route.ts`. Capture would otherwise be one 400-line file mixing four concerns, and each of
these has one job. `forms.ts` and `dwell.ts` being separate is also what makes them pure and
testable without a DOM.

**Abandonment is detected from clicks, not from `focusout`.** Two failure modes rule
`focusout` out on its own. On macOS, clicking a non-focusable element blurs the field without
focusing anything, so `focusin` never fires and the departure is missed entirely. And a
`focusout`-only rule fires a *false* abandon on the way to submitting, because clicking the
submit button blurs the field before `submit` arrives. Keying off the click's own target —
"did this click land inside the active form?" — avoids both with no debounce timer. A click
can only ever *end* a form episode, never start one; only focus starts one, because a click
is not evidence the user began filling anything in.

**`GET /projects/:app/events` is not in §19.1.** §19.4 step 1 calls for a dashboard that
renders stored events as a plain table, and nothing in the documented API returns them.

**The OTLP envelope is hand-rolled.** §19.6 says not to, and it is right — the official
`@opentelemetry/exporter-logs-otlp-http` should become the default. It is hand-rolled here to
keep commit #1 dependency-free and the wire shape legible while the collector was written
against it. Before that swap, verify §19.6's two caveats: page-unload flushing, and bundle
size against the §4.7 budget.

**Events are stored as JSON in one column.** Indexed columns beside it are only for querying.
Adding an attribute needs no migration, and §19.2 stays the single source of truth for the
record's shape. This is also exactly the thing that does not scale, which is the pressure
toward ClickHouse in §8.

**`ux.event_id` is the SQLite PRIMARY KEY**, so ingest is idempotent on retry (§4.4).
Verified: replaying a batch stores nothing new.

---

## Known holes that will bite

- **`ux.anonymous_id` and `session.id` are per-page-load.** No browser storage is used, so
  every reload looks like a new visitor and a new session. The real §4.5 session rule — idle
  threshold, long-lived SPA tabs, backgrounded mobile — is unwritten.
- **Path tokenization is a heuristic, and it has a real blind spot.** It recognizes the
  *shape* of identifiers, so numbers, UUIDs, hashes, emails and nanoids are caught. It cannot
  catch `/users/johndoe` or `/posts/my-divorce-settlement`, because nothing distinguishes
  those from `/docs/getting-started`. The fix is the `RouteAdapter` seam (§4.6) — a router
  knows its own pattern and hands you `/users/:userId` with no guessing. Both gaps are
  asserted in `redact.test.ts` so they stay visible decisions rather than silent holes.
- **Numeric `track()` props are not redacted.** Only strings go through the Redactor, because
  the default text rule is "4+ consecutive digits" and applying it to numbers would destroy
  legitimate metadata (`{ durationMs: 4200 }`) while catching numeric PII only by accident.
  `{ userId: 84213 }` needs the §4.9 allow/deny model.
- **CORS on the collector is wide open** and there is no project key.
- **The unload path is not wired.** `transport.ts` relies on the exporter's `fetch` keepalive.
  `sendBeaconOtlp()` exists but is unused, because the one-method `Exporter` interface has no
  way to express "deliver this during teardown". Resolving that is the real §4.4 work, and
  until it is done the abandonment and exit signals are the ones most likely to vanish.
- **Minified production builds destroy fingerprints.** Without the §4.3 build-time plugin,
  `fn.name` becomes `t`, `a`, `e`, and minifiers reuse those per-module — so unrelated
  components genuinely collapse into one identity. **This is the single most important
  limitation of the tool**, it is a mass false *merge* rather than a visible failure, and it
  means v1 is reliable only in dev, or in prod with the plugin. Asserted in
  `fingerprint.dom.test.tsx` so it stays visible.
- **i18n and copy edits cause false splits.** Same button, new text, new fingerprint. §4.2.1
  accepts this cost knowingly: dropping the name would merge the forty buttons saying "Save".
- **`data-telemetry-id` matches an ANCESTOR.** Putting one on a container collapses every
  element inside it into the container's identity. That is per §4.2.1 and it is a useful
  escape hatch, but it is a foot-gun on a `<form>` or a layout wrapper.
- **The fiber walk reads React's private internals.** A React version that moves the
  `__reactFiber$` key makes `getFiber` return null and every fingerprint degrade to
  `unknown|<role>` — quietly, and everywhere at once. There is no public API for this; every
  autocapture tool has the same exposure.
- **The `history` patch does not see everything.** Next's App Router can change what the user
  sees without a `pushState` this can observe (§4.6). Each router wants a real `RouteAdapter`,
  which would also retire `tokenizePath`'s blind spot by reporting the route pattern directly.
- **Step 3 will make the click handler expensive.** Capture is cheap today, so it runs
  synchronously. A fiber walk inside a passive handler is exactly the jank §4.7 warns about;
  the fix is to take the cheap DOM facts synchronously — `ux.seq` MUST stay in gesture order —
  and defer only the derivation to `requestIdleCallback`.
- **The graph loads every event into memory.** `GET /projects/:app/graph` caps at 50k events
  and aggregates in Node. That is the honest ceiling of "store the record as JSON and read it
  all back", and it is exactly the pressure toward ClickHouse §8 describes — not something to
  fix with a bigger cap.
- **Friction is evidence, never a diagnosis (§12).** A rage click is as easily a slow network
  or an unresponsive handler as a confusing control; an exit point may be where the task
  legitimately finishes. The UI says so; any future AI layer must too.
- **Ranking is half-built.** §11 wants `Impact × Confidence × Frequency`; this has Frequency
  only. Confidence in particular is theatre until it is calibrated against a measured
  outcome, which is why no number pretends to it.
- **Spaghetti-taming is barely started.** `minEdgeCount` prunes rare transitions and nothing
  else. §8 wants loop collapsing and folding the long tail into an "other" edge rather than
  deleting it. On the demo's ten nodes it does not matter; on a real app it will.
- **Dead clicks are dropped, not recorded.** A click resolving to no interactive target is
  ignored. Those are the raw material for §10's dead-click signal, which needs state-change
  observation to tell "clicked nothing" from "clicked something that did nothing".

## Doc nits

- `docs/demo.gif` is recorded. It is a live capture: the dashboard is screenshotted in one
  headless browser while the demo app is driven in another, so the graph in it grows from real
  use rather than being posed. Re-record with `scripts/record-demo.mjs` if the view changes.
- §19.3's pipeline sketch says transport posts to `POST /events`; §19.4 and §19.6 both say
  `/v1/logs`, which is what is implemented.
