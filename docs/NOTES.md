# NOTES — commit #1 (walking skeleton, step 1)

This is the scaffold in [`PLAN.md`](PLAN.md) §19. It stands up the pnpm monorepo and gets
**steps 1–2 of §19.4** running end to end:

```
demo-app fires an event → otlpExporter → POST /v1/logs → SQLite
   → GET /projects/:app/sessions/:id → dashboard table
```

Capture is real: clicks, SPA route changes, and the form submit/abandon pair are picked up
with zero instrumentation. What is still a placeholder is **identity** — `fingerprint()` is a
stub, so every element without a `data-telemetry-id` collapses to `unknown|<tag>` (step 3).
No graph building, no friction, no AI.

---

## Running it

Requires **Node ≥ 22.18** (the collector's dev script runs TypeScript directly via Node's
native type stripping) and **pnpm**. `corepack enable pnpm` if you don't have it.

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

The nav routes include `/users/42/settings`, so tokenization is visible in the table as
`/users/:id/settings`. Open **http://localhost:5173**; events appear within ~2s (it polls).
Click a `session.id` to open the session timeline placeholder.

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
| `GET /projects/:app/graph` | **501** until `buildGraph` lands (§19.4 step 5) |
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
- **`rastro-analysis/sessionize.ts`** — group by `session.id`, order by `ux.seq`. The only real
  analysis in this commit, and the only one with real tests.
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
- **`collector`** — OTLP decode, SQLite `EventStore`, the session endpoint.
- **`dashboard`** — the plain events table (§19.4 step 1) and a `SessionTimeline` placeholder.

### Stubbed — real signatures, naive bodies, TODOs naming the work

| Thing | State |
|---|---|
| `core/fingerprint.ts` | `data-telemetry-id` override is **real**; everything else degrades to `unknown\|<tag>`. No fiber walk. §4.2.1 is step 3. |
| `core/redact.ts` | Text redaction and path tokenization are **real**. Still missing the per-attribute allow/deny model, which is what would catch numeric PII like `{ userId: 84213 }`. |
| `react/capture.ts` | Capture is **real**. The identities are not: every event carries a stub fingerprint until step 3. |
| `session.start` / `session.end` | Defined in the conventions, not emitted. Neither is needed by any analysis today, and `session.end` is unanswerable without the §4.5 idle rule. |
| `analysis/graph.ts` | `buildGraph` throws. Test file carries `it.todo` cases. |
| `analysis/friction.ts` | `detectFriction` throws. §19.4 step 6 says pick exactly one signal. |
| `dashboard/FlowGraph.tsx` | Does not exist. React Flow is installed but unused — step 5. |
| `Interpreter` seam | Interface only, default `none`. The analytics must stand alone first (§1, §11). |

### Tests

`pnpm -r test` → **74 passing, 48 `todo`**.

The passing ones cover `sessionize` (grouping, `ux.seq` ordering, attribute flattening, the
`ux.active_ms` default, the single-session case the §13.1 endpoint uses),
`redact`/`tokenizePath` (including the two known gaps, asserted), `sanitizeProps`/`buildEvent`
(redaction, reserved-namespace rejection, and the guarantee that a custom attribute can never
overwrite the Required set), the visibility-adjusted clock, and the form state machine.

The DOM-facing parts of capture are deliberately thin wrappers over pure logic —
`interactionMethodOf`, `createActiveClock`, `createFormTracker` — so all of it tests without
jsdom, which is not a dependency here. What that leaves untested by unit tests is the DOM
wiring itself: listener registration, `closest()` target resolution, and the history patch.
Those are covered by driving a real headless Chrome against the demo app (see below).

**Adding `jsdom` as a dev dependency is the obvious next testing improvement** — it would let
`startCapture` and `historyRouteAdapter` be tested directly rather than only end to end.
Not added without asking.

The todos in `fingerprint.test.ts` and `graph.test.ts` name the cases meant to drive steps 3
and 5 — including the before/after-refactor stability suite §4.2.1 calls the most valuable
test file in the repo.

### Verified end to end

Driven against a real headless Chrome with genuine mouse and keyboard input, on the demo app:

- `ux.click` classified `mouse` for pointer input and `keyboard` for Enter activation
- `ux.route_change` carrying `ux.from_path`, with `/users/42/settings` stored as
  `/users/:id/settings`
- `ux.form_abandon` after focusing a field and clicking a nav button
- `ux.form_submit` with a real time-to-complete, and **no false abandon** on the way to it
- `track()` props: `plan`/`seats` stored, `owner` redacted, `ux.seq: 999` dropped

The hidden-tab rule in `dwell.ts` is unit-tested rather than driven in the browser — there is
no CDP command to force `document.visibilityState`.

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
- **Fingerprints are meaningless.** Every element that lacks `data-telemetry-id` collapses to
  `unknown|<tag>`. Worse for reading the data today: because the override matches an
  *ancestor*, every field inside a marked form reports as the form. Do not read anything into
  numbers computed from this data yet. This is step 3.
- **The `history` patch does not see everything.** Next's App Router can change what the user
  sees without a `pushState` this can observe (§4.6). Each router wants a real `RouteAdapter`,
  which would also retire `tokenizePath`'s blind spot by reporting the route pattern directly.
- **Step 3 will make the click handler expensive.** Capture is cheap today, so it runs
  synchronously. A fiber walk inside a passive handler is exactly the jank §4.7 warns about;
  the fix is to take the cheap DOM facts synchronously — `ux.seq` MUST stay in gesture order —
  and defer only the derivation to `requestIdleCallback`.
- **Dead clicks are dropped, not recorded.** A click resolving to no interactive target is
  ignored. Those are the raw material for §10's dead-click signal, which needs state-change
  observation to tell "clicked nothing" from "clicked something that did nothing".

## Doc nits

- `README.md` renders a `docs/demo.gif` that does not exist yet. §19.4 step 5 is where it
  gets recorded — the flow graph is the demo worth capturing, not this table.
- §19.3's pipeline sketch says transport posts to `POST /events`; §19.4 and §19.6 both say
  `/v1/logs`, which is what is implemented.
