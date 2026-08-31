# NOTES — commit #1 (walking skeleton, step 1)

This is the first commit of the scaffold in [`PLAN.md`](PLAN.md) §19. It stands up the pnpm
monorepo and gets **step 1 of §19.4** running end to end:

```
demo-app fires an event → otlpExporter → POST /v1/logs → SQLite
   → GET /projects/:app/sessions/:id → dashboard table
```

Everything past that is stubbed with real types and TODOs. No fingerprinting, no graph
building, no friction, no AI.

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

Open **http://localhost:5174**. It emits one hardcoded `demo.hello` event on mount, and its
two buttons emit `ux.click`. Open **http://localhost:5173** and the events appear in the
table within ~2s (it polls). Click a `session.id` to open the session timeline placeholder.

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
- **`rastro-analysis/sessionize.ts`** — group by `session.id`, order by `ux.seq`. The only real
  analysis in this commit, and the only one with real tests.
- **`rastro-react`** — provider, `useTelemetry().track()`, batching + flush lifecycle, and the
  three exporters (`otlp`, `console`, `multi`).
- **`collector`** — OTLP decode, SQLite `EventStore`, the session endpoint.
- **`dashboard`** — the plain events table (§19.4 step 1) and a `SessionTimeline` placeholder.

### Stubbed — real signatures, naive bodies, TODOs naming the work

| Thing | State |
|---|---|
| `core/fingerprint.ts` | `data-telemetry-id` override is **real**; everything else degrades to `unknown\|<tag>`. No fiber walk. §4.2.1 is step 3. |
| `core/redact.ts` | Naive email + long-digit regex. No URL tokenization, no allow/deny model. |
| `react/capture.ts` | One real delegated passive listener, but it emits placeholder-identity events. No `ux.route_change`, `ux.form_submit`, `ux.form_abandon`, no `ux.active_ms`. |
| `analysis/graph.ts` | `buildGraph` throws. Test file carries `it.todo` cases. |
| `analysis/friction.ts` | `detectFriction` throws. §19.4 step 6 says pick exactly one signal. |
| `dashboard/FlowGraph.tsx` | Does not exist. React Flow is installed but unused — step 5. |
| `Interpreter` seam | Interface only, default `none`. The analytics must stand alone first (§1, §11). |

### Tests

`pnpm -r test` → 10 passing, 50 `todo`. The passing ones are `sessionize` (grouping,
`ux.seq` ordering, attribute flattening, the `ux.active_ms` default, the single-session case
the §13.1 endpoint uses) and `redact`. The todos in `fingerprint.test.ts` and
`graph.test.ts` name the cases meant to drive steps 3 and 5 — including the
before/after-refactor stability suite §4.2.1 calls the most valuable test file in the repo.

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
- **`url.path` is not tokenized.** `capture.ts` reads `location.pathname` verbatim, so
  `/users/42` goes on the wire as `/users/42`. That violates the convention's privacy
  requirement the moment a real app uses it. Needs the `RouteAdapter` seam (§4.6) and
  tokenization in `redact.ts` (§4.9).
- **`track()` drops its props.** They should become attributes, but they must go through the
  `Redactor` seam first — otherwise `track("saved", { email })` puts raw user content on the
  wire.
- **CORS on the collector is wide open** and there is no project key.
- **The unload path is not wired.** `transport.ts` relies on the exporter's `fetch` keepalive.
  `sendBeaconOtlp()` exists but is unused, because the one-method `Exporter` interface has no
  way to express "deliver this during teardown". Resolving that is the real §4.4 work, and
  until it is done the abandonment and exit signals are the ones most likely to vanish.
- **Fingerprints are meaningless.** Every element that lacks `data-telemetry-id` collapses to
  `unknown|<tag>`. Do not read anything into numbers computed from this data yet.

## Doc nits

- `README.md` renders a `docs/demo.gif` that does not exist yet. §19.4 step 5 is where it
  gets recorded — the flow graph is the demo worth capturing, not this table.
- §19.3's pipeline sketch says transport posts to `POST /events`; §19.4 and §19.6 both say
  `/v1/logs`, which is what is implemented.
