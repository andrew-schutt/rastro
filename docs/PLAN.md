# Rastro — Build Plan

*UX flow intelligence for React: turn interaction behavior into legible user flows.*

> **This is the seeding document for the project — the source of truth you build the first commits against.** Scope is deliberately narrow: a lean, open-source React UX-flow tool that reconstructs the paths users actually take, with zero instrumentation. The broader platform ideas are kept as north-star context, not as things to build first. The engineering reality is folded directly into the concept — every section carries its "here's what actually makes this hard" inline, and open unknowns are marked **`❓ Unknown`** and collected in §17 (they double as honest README material). **Start at §19** for the concrete kickoff — repo scaffold, the event contract, and the click-to-graph data shapes — and reach back into the earlier sections for the "why" as you need it. §4.2.1 (fingerprinting) and §19 are the two sections you'll actually be coding against first.

---

## 1. What this is, and how the idea evolved

The seed idea was an AI-driven **adaptive UI** — an interface that learns an individual user's behavior and reshapes itself to fit them (surface shortcuts for keyboard users, enlarge targets for people who miss small ones, promote frequently-used actions).

The important realization stands: **fully automatic per-user adaptation is a large, risky, hard-to-test first thing to build.** It's a trust and testability disaster as a starting point — you can't unit-test "the UI rearranged itself and the user got confused," and you can't easily A/B a UI that's different for everyone.

So the arc is unchanged:

```
UX Telemetry → Behavior Analysis → Flow Discovery → AI Recommendations
   → Optional Aggregate UI Improvements → (much later) Individual Adaptive UI
```

But the honest framing of the project is: **a developer-native UX observability tool for React that captures interaction behavior, reconstructs likely user flows, surfaces friction, and uses AI as the interpretation layer on top of deterministic analysis.** Adaptive UI is the long-term *output*, not the thing you build first.

**A founding principle, promoted from an afterthought:** *AI is not the engine.* The durable value is instrumentation + sequence analysis + friction metrics. The AI is the layer that interprets and communicates that evidence. If the deterministic analytics aren't already useful with the AI turned off, the AI is lipstick. Build so the AI can be removed and the tool still earns its place.

---

## 2. The core loop (annotated with where the hard parts actually are)

```
┌─────────────────────┐
│   React Application  │
└──────────┬──────────┘
           ▼
┌─────────────────────┐   ← HARD: what was clicked? (§4.1, §4.2)
│ Interaction Capture │   ← HARD: stable element identity (§4.2)
│      (SDK)          │   ← HARD: perf, SSR, PII (§4.7–4.9)
└──────────┬──────────┘
           ▼
┌─────────────────────┐   ← HARD: delivery on unload, ordering (§4.3, §4.4)
│ Event Transport     │
└──────────┬──────────┘
           ▼
┌─────────────────────┐   ← HARD: storage engine choice (§8), sessionizing (§4.5)
│ Storage & Analysis  │   ← HARD: this is process mining (§8), not "find patterns"
│ Events→Seq→Flows    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐   ← HARD: correlation≠causation (§12), confidence theater (§11)
│ UX Intelligence     │
│ Friction + AI       │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ Dashboard + Recs    │
└─────────────────────┘
```

The original plan spent most of its care on the SDK ergonomics (the top box) and treated the middle boxes as plumbing. It's inverted: the top box is the hardest *engineering*, and the middle boxes are the hardest *product*. Both are hand-waved in the source doc. This version un-waves them.

---

## 3. Developer ergonomics — the incremental philosophy, and its reality tax

The incremental-adoption idea is right and worth keeping:

- **Level 1 — install and get value.** Drop in a provider, get baseline telemetry.
- **Level 2 — enrich where needed.** `useTelemetry().track(...)` for events autocapture misses.
- **Level 3 — add semantics.** Mark important actions/tasks so analysis gets precise.

```tsx
<UXTelemetryProvider endpoint="https://telemetry.example.com" application="my-app">
  <MyApplication />
</UXTelemetryProvider>
```

**The reality tax nobody put a number on:** "Level 1 gives useful automatic telemetry" is doing enormous unnamed work. Autocaptured events are noise until something gives them meaning. The labeling problem doesn't disappear at Level 1 — it *defers* to analysis time. Every Heap-style autocapture user knows this. So Level 1's real promise is "collect raw signal cheaply," not "get insight cheaply." Set that expectation internally or you'll be surprised when the Level-1 dashboard is a wall of `button clicked`.

**API drift to fix now:** the source doc shows `track("profile_saved")` in one place and `track({event, entity})` in another. Pick one shape and freeze it. Suggested: `track(name: string, props?: object)` — string-first for the common case, object for props. Small thing, but it signals whether the schema is actually nailed (§5), and it isn't yet.

---

## 4. The client SDK — where ~80% of the real pain lives

The source doc says "observe interactions" and never picks a mechanism. Here's the mechanism and everything it drags in.

### 4.1 Capture mechanism

Use a **single delegated listener at document root, capture phase**, for click / focus / blur / submit / keydown — not per-element listeners (memory + perf death on large apps). One listener, event bubbles/captures up to it.

But a root listener hands you a **DOM node**, not `<SaveProfileButton>`. That's the core gap.

### 4.2 Stable element identity — *the* data-quality problem

For sequence analysis to work at all, user A's "step 3" must be recognizably the same element as user B's "step 3." Everything downstream (flows, funnels, friction) is built on this, and it's the single most under-specified thing in the original plan.

Recovering React component identity from a DOM node means walking the **fiber tree** via the `__reactFiber$…` / `__reactInternalInstance$…` keys React hangs off DOM nodes. This is **private, unstable, internal API.** Heap, PostHog, FullStory all do some version of this hack. It's load-bearing and it was unmentioned.

Then identity has to survive across sessions and deploys, and every obvious signal is fragile:

- **CSS selectors** — break on refactor.
- **Button text** — breaks on i18n (every locale differs) and copy edits; also collides ("Save" appears on 40 buttons).
- **Component names** — become `t`, `a`, `e` under minification.
- **DOM position** — breaks on layout change, virtualized lists, portals.

The realistic answer is a **composite fingerprint** (element role + accessible name + ancestor component chain + stable position hint) with a versioning strategy for when it drifts — and an acceptance that it *will* drift. **If this is wrong, every number the tool ever produces is noise.** De-risk this before anything else (§16).

**❓ Unknown:** how stable can a composite fingerprint actually be across real refactors? What's the false-merge / false-split rate on a real app over a month of deploys? This is measurable and should be measured early.

### 4.2.1 Fingerprinting — implementation spec (v1, buildable)

This is the concrete "open your editor and code this" version. It is deliberately *good enough*, not perfect — the goal is a fingerprint that's stable across sessions and small refactors, readable enough to eyeball collisions during development, and honest about where it breaks.

**Design decisions for v1:**
- **Human-readable, not hashed.** Emit a readable string like `SettingsPage>ProfileForm>SaveButton|button|"Save Profile"`. Hashing (FNV-1a or similar) is a later storage optimization; early on, readability lets you *see* false merges/splits in the raw data, which is the whole point of the identity spike (§16, Phase 1). Keep the raw components too, so you can re-derive fingerprints later without re-collecting.
- **Explicit override always wins.** If the element (or an ancestor) carries `data-telemetry-id`, use it verbatim and skip everything below. This is the rock-solid manual escape hatch — the far end of the automatic↔manual dial.
- **Component chain is the primary stabilizer.** It survives copy edits, i18n, and CSS refactors — the things that break text and selectors. Everything else is a tiebreaker.

**Step 1 — DOM node → React fiber.** React hangs its internal fiber off the DOM node under a randomized key. Find it by prefix:

```ts
const FIBER_PREFIXES = ['__reactFiber$', '__reactInternalInstance$']; // 17+, then 16

function getFiber(node: Element): any | null {
  for (const key in node) {
    for (const prefix of FIBER_PREFIXES) {
      if (key.startsWith(prefix)) return (node as any)[key];
    }
  }
  return null; // not React, or a version whose internals moved — degrade (Step 5)
}
```

**Step 2 — Fiber → component chain.** Walk *up* via `.return`, collecting the names of component fibers (function/class), skipping host elements (`div`, `span`) and framework noise. Cap the depth so the fingerprint doesn't churn on deep tree changes.

```ts
const NOISE = /^(Provider|Consumer|Context|Fragment|Anonymous|ForwardRef|Memo|.*Boundary)$/;

function componentChain(fiber: any, max = 4): string[] {
  const names: string[] = [];
  let f = fiber;
  while (f && names.length < max) {
    const t = f.type;
    // function/class components; forwardRef/memo wrap the real fn, unwrap loosely
    const raw =
      typeof t === 'function' ? (t.displayName || t.name)
      : t?.render ? (t.render.displayName || t.render.name)  // forwardRef
      : t?.type ? (t.type.displayName || t.type.name)        // memo
      : null;
    if (raw && !NOISE.test(raw)) names.push(raw);
    f = f.return;
  }
  return names.reverse(); // outermost → innermost
}
```

⚠ **Minification caveat:** in a production build without the §4.3 build-time plugin, `t.name` becomes `t`, `a`, `e` — the chain collapses to garbage. So v1 fingerprinting is genuinely reliable **only in dev / on the example app**, or in prod **with** the build plugin. This is the single most important limitation to state in the README, and it's *why* §4.3 exists. Don't hide it — documenting it is a credibility signal.

**Step 3 — Role-ish descriptor.** Tag name plus the disambiguating attribute. Cheap, stable, no accname algorithm needed for v1.

```ts
function roleOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const explicit = el.getAttribute('role');
  const type = el.getAttribute('type');
  return explicit ?? (type ? `${tag}:${type}` : tag); // "button", "input:email", "a"
}
```

**Step 4 — Accessible name (approximation).** Full W3C accessible-name computation is a rabbit hole; this covers ~90% and is a clean v2 upgrade point.

```ts
function accName(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return norm(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) { const r = document.getElementById(by); if (r?.textContent) return norm(r.textContent); }
  const text = (el as HTMLElement).innerText || el.textContent || '';
  if (text.trim()) return norm(text);
  return norm(el.getAttribute('title') || el.getAttribute('alt') || '') || undefined;
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 50);
```

⚠ **PII caveat:** an accessible name can contain user data (`"Delete account for jane@x.com"`). Run the name through a redaction hook (email/number patterns → `‹redacted›`) *before* it enters the fingerprint (ties to §4.9).

**Step 5 — Compose, with graceful degradation.** Each missing signal drops out rather than poisoning the whole thing.

```ts
function fingerprint(el: Element): string {
  const override = el.closest('[data-telemetry-id]')?.getAttribute('data-telemetry-id');
  if (override) return `id:${override}`;                       // manual: rock-solid

  const chain = componentChain(getFiber(el)).join('>');        // primary
  const role  = roleOf(el);                                    // stable
  const name  = accName(el);                                   // semi-stable, redacted

  const parts = [chain || 'unknown', role];
  if (name) parts.push(`"${name}"`);
  return parts.join('|');                                      // e.g. Settings>ProfileForm>SaveButton|button|"Save Profile"
}
```

**The tradeoff dial, made concrete.** Each field you *add* to the fingerprint pushes toward more false splits (more things counted as distinct); each field you *drop* pushes toward more false merges (distinct things collapsed). Where v1 sits:

| Field | If included | If dropped | v1 choice |
|---|---|---|---|
| Component chain | splits on component rename/move | merges unrelated elements sharing role+text | **include** (primary anchor) |
| Accessible name | splits on copy edit / i18n | merges the 40 buttons all saying "Save" | **include** (the i18n split is the accepted cost) |
| Role/tag | splits if tag changes (`div`→`button`) | merges a link and a button in the same slot | **include** (cheap, rarely changes) |
| DOM position / nth-child | splits on any layout reflow | merges repeated list items | **exclude in v1** (too fragile; revisit only for list-item disambiguation) |

So v1's known failure modes, stated plainly: **i18n and copy edits cause false splits** (same button, new text = new fingerprint), and **minified prod without the build plugin causes mass false merges** (chain collapses). Both are acceptable for a project whose demo runs on your own example app in dev — and both are exactly what the Phase 1 spike should *measure* rather than assume.

**Testing (TDD-friendly).** The pure parts — `roleOf`, `accName`, `norm`, redaction, and `fingerprint` given a mock element — test cleanly with jsdom fixtures. The fiber walk needs a real render, so cover it with React Testing Library: render a small component tree, query a node, assert the chain. Build a fixture suite of "same element before/after a refactor" pairs and assert the fingerprint holds — that suite *is* your false-split regression guard, and it's the most valuable test file in the repo.

### 4.3 The build-time escape hatch (missing entirely from the original)

The industry fix for "minification kills names" and "semantics without runtime friction" is a **Babel/SWC plugin** that injects `displayName` and source location `(file:line)` at build time. This is the actual way to get `<Action>`-level meaning *and* stable identity without asking developers to wrap every element by hand. The original reached straight for runtime wrappers (§7 of the source) and skipped the build-time layer that makes the whole semantic story tractable.

**❓ Unknown:** SWC (Next's default) vs Babel plugin authoring effort and maintenance burden across toolchains (Vite, CRA-legacy, Next, Remix). Non-trivial and toolchain-fragmented.

### 4.4 Delivery reliability — where your best signals die

The source says "batch, send." The most valuable events — **form abandonment, exit, drop-off** — fire *exactly as the page tears down*, and a normal `fetch` is killed mid-flight on unload. You silently lose your flagship friction data.

Required:
- `navigator.sendBeacon` or `fetch(url, { keepalive: true })` for unload-time sends.
- Flush on `visibilitychange → hidden` (the only reliable "leaving" signal on mobile Safari).
- Retry with backoff for normal batches.
- **Client-generated event IDs** for idempotency — retries *will* duplicate, and duplicate events corrupt every count and rate.

### 4.5 Timing, ordering, and sessions — the numbers the AI reasons over

- **Timing:** "users pause 5.1s before Edit Username" — measured how? Wall-clock includes tab-backgrounding, someone walking away, dev tools open. You must subtract `document.hidden` time (Page Visibility API) and cap idle gaps, or your flagship metric is really "who switched tabs." Silent correctness bug in the exact number the AI interprets.
- **Ordering:** never trust the client clock — user clocks are skewed and wrong. Need a **per-session monotonic sequence counter** plus **server receive-time**. The source schema's lone `timestamp` implies client-time ordering, which scrambles sequences.
- **Session definition is absent** yet it's the unit of every flow. 30-min inactivity is the usual default, but: what about an SPA that never reloads? A tab left open overnight? Backgrounded mobile? Pick a rule and write it down; it changes all downstream analysis.

**❓ Unknown:** the right sessionization rule for long-lived SPA tabs. There's no clean industry consensus; it's a judgment call with real downstream effects.

### 4.6 Route detection isn't free

React Router v5 vs v6, TanStack Router, Next Pages Router, Next App Router — all detect route changes differently. The framework-agnostic route is monkey-patching `history.pushState`/`replaceState` + `popstate`, which Next's App Router partially defeats. Budget this as **per-router integration work**, not one function.

### 4.7 Performance — the reason a front-end engineer rejects it

Keystroke capture, focus/blur churn, and synchronous fiber walks *inside* event handlers cause main-thread jank. You are the gatekeeper you most need to win over, so:
- passive listeners where possible,
- throttle/debounce high-frequency events,
- defer processing to `requestIdleCallback`,
- hard **bundle budget** — naive autocapture libs balloon to 30–50kb+.

### 4.8 SSR / hydration — the day-one headache

Next dominates React. The provider boots server-side with no DOM; early events can fire before mount; hydration mismatches are easy to introduce. This is unaddressed in the source and it's the *first* thing you'll hit on a real Next app.

### 4.9 PII — worse than "capture 'input changed', not the value"

Redacting input values solves maybe 10%. The real leaks are in metadata captured *by default*:
- **accessible names**: `"Delete message from john@example.com"`,
- **URL paths**: `/users/john@example.com/settings`,
- **page titles / headings**.

Need: URL tokenization (`/users/:id`), text redaction rules, an allow/deny model, and a documented default of "metadata not content." (See also consent/bias, §15.)

---

## 5. Output format — OpenTelemetry-native (OTLP)

**Decision: emit OTel-native rather than a bespoke wire format.** Anything that speaks OTLP — collectors, Loki/Tempo/Grafana, Honeycomb, or your own ingest — can then receive the data, and you inherit the OTel Collector's batching, PII processors, sampling, and fan-out instead of building them. Grounded in current OTel semantic conventions, three decisions fall out:

1. **Interactions are OTel Events, not spans.** An OTel *Event* is a `LogRecord` carrying an event name; the spec's canonical example for point-in-time occurrences is exactly button clicks and user interactions. The rule: point-in-time → Event; has a duration and a meaningful boundary → span. So `ux.click`, `ux.route_change`, `ux.form_submit` are Events. Durational things (a whole task, a page dwell) can become spans later, only if a timeline view earns it (§ unknown below).
2. **Use the standard `session.id` convention — don't invent one.** OTel already defines session semantics: a session is a collection of logs/events/spans sharing a `session.id`, with `session.previous_id` linking a continued session and `session.start`/`session.end` events marking lifecycle. That *is* your sessionization primitive from §4.5, already standardized.
3. **Your UX semantics ride as attributes.** Standard attributes where they exist (`session.id`, `url.path`, `service.name`), your own `ux.*` namespace where they don't. Follow the naming guideline: event names carry no dynamic values — identifiers go in attributes.

One interaction = one OTel Event record:

```jsonc
{
  "timeUnixNano": "…",              // client time — reference only
  "observedTimeUnixNano": "…",      // set at collector = authoritative order (§4.5)
  "eventName": "ux.click",          // ux.click | ux.route_change | ux.form_submit | custom
  "severityNumber": 9,              // INFO
  "attributes": {
    "session.id": "…",              // STANDARD — the unit of every flow (§4.5)
    "session.previous_id": "…",     // STANDARD — continuation link (optional)
    "url.path": "/settings/:id",    // STANDARD — tokenized, PII-stripped (§4.9)
    "ux.event_id": "uuid",          // idempotency for retries (§4.4)
    "ux.seq": 42,                   // per-session monotonic order — don't trust clocks
    "ux.fingerprint": "Settings>ProfileForm>SaveButton|button|\"Save Profile\"", // §4.2.1
    "ux.interaction.method": "mouse",
    "ux.active_ms": 4200,           // visibility-adjusted dwell (§4.5)
    "ux.anonymous_id": "uuid"
  },
  "resource": {                     // OTel Resource = stable per-app context
    "service.name": "my-app",       // STANDARD — the app
    "service.version": "4.2.1"      // STANDARD — deploy dimension for "new behavior" (§13/§14)
  }
}
```

Everything the bespoke schema needed is still here — it just lives in standard slots: `session.id` + `ux.seq` make sequences possible, `service.version` is the deploy dimension, `ux.anonymous_id` carries identity, `ux.active_ms` is visibility-adjusted timing, and `observedTimeUnixNano` gives server ordering. Versioning is handled by the semantic-convention version you target plus your own `ux.*` namespace version.

**The honest catch — read before celebrating "free dashboards."** Emitting OTLP gets you *storage, routing, and raw exploration* in any OTel backend for free. It does **not** give you flow graphs, funnels, drop-off, or friction ranking — generic OTel backends answer *"is the frontend healthy / slow / erroring,"* not *"what path do users take and where do they abandon."* And the lane is occupied: **Grafana Faro** is an OSS web SDK that already captures frontend RUM (errors, web vitals, custom events, user interactions) and ships it via OTLP to the Grafana stack, with regex PII redaction and `session.id` correlation. So OTel-native has a sharp consequence: **capture-and-emit becomes commodity**, and the project's entire differentiation collapses onto two things — the `ux.*` UX semantic conventions, and the behavioral-analysis layer (sessionize → flow graph → funnels → friction) that Faro and generic backends don't provide. That's not a reason to avoid OTel; it's the reason *to* embrace it. It frees you from building transport, collector, and storage plumbing so every hour goes to the only part that's actually yours.

**Reconciliation (this supersedes earlier wording).** Earlier sections framed OTel as "transport only, never your model." The OTel-native decision refines that rather than reversing it: the OTel Event/Log record is the *envelope*; your semantics ride inside it as `ux.*` conventions, so you're expressing your model *within* OTel's extensible attribute system, not surrendering it. The discipline that still holds: **treat generic OTel backends as substrate, not product** — the UX insight is always your analysis layer. Wherever the doc says "own your event model," read it now as "own your `ux.*` conventions and your analysis."

**❓ Unknown:** where to draw the automatic-capture line so events are useful but not overwhelming. Too little → useless; too much → cost + noise + privacy risk. Genuinely open; resolved empirically, not by design.

**Decision (was an unknown): no session-spans — build the timeline from events instead.** A span records something with a duration, so you'd think "make the session a span." But a session ends by the *absence* of activity (idle, tab closed, walked away), and your code can't observe "nothing happened for 30 minutes" — the page is usually gone by then, so `span.end()` never runs. Session-spans dangle unclosed, and trace backends (which assume spans close and traces complete within a bounded window) show them broken or not at all. You don't need them: single-session timeline inspection (§13.1) is just *filter events by `session.id` → sort by `ux.seq` → lay on a time axis*, rendered in your own dashboard — simpler, never "never-ends," and richer than a generic trace waterfall because it shows fingerprint/route/dwell instead of anonymous bars. Spans stay reserved for genuinely bounded *tasks* (e.g. `add_to_cart` → `order_confirmed`, which has a real `.end()`), and only if you later want those to appear in a trace backend — optional, not MVP.

### 5.1 The `ux.*` semantic convention reference

This is the part OTel deliberately leaves to you (§5): the standard defines generic slots like `session.id` and `url.path`, but nothing for *which element a user touched and what its stable identity is* — that's UX-behavioral and unique to this project. The `ux.*` namespace below **is** the differentiator, written as a contract others can instrument against. Treat this as its own versioned spec (a `SEMANTIC-CONVENTIONS.md` in the repo).

**Naming rules (following OTel's own guidance).** Event names are static and dot-separated, never contain dynamic values (identifiers go in attributes). Attribute keys are lowercase, dot-namespaced under `ux.`. Stability starts at *Development* — expect to change it before declaring 1.0.

**Standard attributes reused (owned by OTel, not you) — listed so instrumenters know not to reinvent them:**

| Attribute | Level | Type | Meaning |
|---|---|---|---|
| `session.id` | required | string | Groups all events in one session — the unit of every flow (§4.5) |
| `session.previous_id` | opt-in | string | Links a continued session to its predecessor |
| `url.path` | required | string | Route, tokenized (`/users/:id`) and PII-stripped (§4.9) |
| `service.name` | required | string (resource) | The application |
| `service.version` | recommended | string (resource) | Deploy/release — the dimension for "new behavior" (§14) |

**`ux.*` attributes (owned by this project):**

| Attribute | Level | Type | Meaning / notes |
|---|---|---|---|
| `ux.event_id` | required | string | Client-generated UUID; idempotency key for retries (§4.4) |
| `ux.seq` | required | int | Per-session monotonic counter; the authoritative ordering (§4.5), since clocks lie |
| `ux.fingerprint` | required | string | Stable element identity (§4.2.1). The join key for every flow/funnel/friction metric |
| `ux.anonymous_id` | required | string | Stable per-visitor/device id (not a login) |
| `ux.interaction.method` | recommended | enum `mouse` \| `keyboard` \| `touch` | How the interaction happened; powers accessibility/ergonomics signals |
| `ux.active_ms` | recommended | int | Visibility-adjusted dwell *before* this event (§4.5) — excludes backgrounded/idle time |
| `ux.component_chain` | opt-in | string[] | Component ancestry, outermost→innermost; debugging aid for fingerprint drift |
| `ux.role` | opt-in | string | Element role/tag (`button`, `input:email`); a queryable slice of the fingerprint |
| `ux.accessible_name` | opt-in | string | Element label, **redacted** before emit (§4.9); never raw user content |

**Resource attribute (owned):**

| Attribute | Level | Type | Meaning |
|---|---|---|---|
| `ux.convention.version` | recommended | string (resource) | Version of *this* spec the record conforms to (e.g. `"0.1"`); lets the analysis layer handle mixed-version data during migrations |

**Event names:**

| Event name | Emitted when | Key attributes beyond the required set |
|---|---|---|
| `ux.click` | pointer/keyboard activation of an element | `ux.interaction.method` |
| `ux.route_change` | SPA navigation (§4.6) | previous `url.path` may be carried as `ux.from_path` (opt-in) |
| `ux.form_submit` | a form is submitted | `ux.active_ms` (time-to-complete) |
| `ux.form_abandon` | focus enters a form, leaves without submit (§4.4) | `ux.active_ms` |
| `session.start` / `session.end` | session lifecycle | **standard OTel event names** — reused, not `ux.`-prefixed |
| *custom* (via `track(name)`) | developer-defined | app-owned names, same static-naming rules |

**Required-set recap** — every event, whatever its name, carries: `session.id`, `url.path`, `ux.event_id`, `ux.seq`, `ux.fingerprint`, `ux.anonymous_id`, plus `service.name` on the resource. Everything else is recommended or opt-in. That minimum is exactly what `sessionize` + `buildGraph` (§19.3) need — nothing in the analysis layer depends on an opt-in field.

---

## 6. Semantics — the layered approach, honestly costed

The three-layer idea is sound:

1. **Automatic inference** from route + element type + accessible name + component chain + event type.
2. **Pattern discovery** — repeated sequences across many users are evidence of real behavior.
3. **Developer enrichment** — explicit semantics for critical workflows only.

The honest caveat: **layer 1 quality is capped by §4.2 (identity) and degraded by modern React** (hashed class names, virtualized lists, portals, i18n, design systems where everything says "Save"). Auto-inference gives you roughly what Heap extracts — a starting point, not meaning. **AI recommendation quality is capped by semantic quality**; feed it noisy inference and it will confidently hallucinate UX problems that don't exist. Layers 2 and 3 exist precisely to buy back the precision layer 1 can't provide.

---

## 7. Semantic API — the wrapper is clunky; here's why and what to do instead

The source's `<Action><Button/></Action>` **fights React**:
- injects a wrapper DOM node that breaks flex/grid layout,
- drops refs and disrupts styling that assumes the button is a direct child,
- `cloneElement` gymnastics to avoid the node are their own mess,
- **can't wrap third-party components** at all.

The `telemetry={{…}}` prop is cleaner but requires **every component in the tree to forward it** — third-party ones won't.

Realistic patterns, in order of preference:
1. **`data-telemetry-*` attribute convention** read by the root autocapture listener — no wrapper node, works on anything that renders a DOM element including third-party.
2. **Build-time plugin** (§4.3) injecting identity/semantics — zero runtime footprint.
3. `useTelemetry().track(...)` imperative calls for genuinely custom events.

Keep `<Action>` only as optional sugar, and implement it as attribute-injection on its child (no extra node), not as a wrapper element.

---

## 8. Backend & analysis — this is process mining; name it

"Discover common sequences / find structural similarity / build a behavioral graph" is not a primitive — it's a mature field with real algorithms:

- common sequences → **sequential pattern mining** (PrefixSpan, SPADE),
- path similarity / clustering → **trace clustering**, edit distance,
- the behavioral graph → a **process model** (heuristic miner, inductive miner),
- "did users do what we think" → **conformance checking**.

(Celonis built a company on this.) Treating "structural similarity" as solved is the biggest analytical hand-wave in the original.

**The clean User A/B/C example is fiction.** Real path data is a long tail of thousands of unique traces with backtracking, loops, multi-tab, and interruptions. Process-mining practitioners literally call the raw output **"spaghetti models."** Without frequency thresholds, loop handling, variant collapsing, and noise filtering, your Flow Explorer renders a hairball nobody can read. This machinery is most of the backend and was wholesale missing.

**Storage is the biggest infra decision, hidden in a box labeled "Event Storage."** This is high-cardinality time-series data queried by *sequence*, and Postgres will fall over on sequence queries across billions of rows. The industry answer is a **columnar store — ClickHouse** (what PostHog runs on), which has `sequenceMatch()` and `windowFunnel()` built precisely for path and funnel queries. Given an AWS deployment target, this means either self-managed ClickHouse on EC2, ClickHouse Cloud, or an alternative like a columnar setup on top of managed services — but *name the engine early*, because it dictates the shape of everything upstream and is expensive to change later.

Design the analysis engine behind clean interfaces (ingest → sessionize → mine → metrics) so each stage is independently testable — the mining and metrics stages especially want tight unit tests around known trace fixtures, since that's where silent correctness bugs hide.

**❓ Unknown:** which mining algorithm actually produces readable flows on *your* data at *your* scale. This is empirical and tuning-heavy; expect real iteration, not a library drop-in.

---

## 9. Flows *and* funnels (the source only has half)

- **Flow discovery** (source has this): infer common paths bottom-up. Metrics per transition: frequency, completion rate, drop-off, median duration, inter-step timing, alternative paths, interaction-method differences.
- **Funnels** (missing): the inverse — a human *defines* steps and you measure drop between each. This is what PMs use daily. `windowFunnel()` gives it to you almost for free once ClickHouse is in place. Discovery finds the flow; funnels measure a known one. You need both.

---

## 10. Friction detection

Deterministic signals (all computable without AI): long active-time pauses, rage clicks (repeated clicks same target), dead clicks (click, no state change), repeated navigation, high abandonment, error frequency, excessive interaction count, unexpected backtracking. This is FullStory/Contentsquare's shipped feature set — mature and re-implementable, not novel, so don't over-invest in inventing new signals; invest in *ranking* them (§11).

---

## 11. AI recommendation layer — evidence in, structured hypothesis out

The architecture clarification is right and important: **do not send every event to an LLM.** Aggregate deterministically first, then hand the model a compact summary:

```
Potential flow: Settings → Edit Username → Save
Users: 12,482 · Completion: 78% · Median: 11.2s
Median delay before Edit Username: 5.1s · Drop-off before edit: 14%
```

Recommendation shape: **Observation · Evidence · Hypothesis · Recommendation · Confidence · Expected outcome.**

**Confidence is theater unless it's earned.** A "72% confidence" number is meaningless until it's a *calibrated* probability tied to a measured outcome — and it can't be, until Phase 7 has run long enough on enough traffic to mean anything. Emitting fabricated-looking confidence early is the fastest way to lose a serious reviewer's trust permanently. Options: hide the number until calibrated, or express confidence qualitatively (strength/consistency of the evidence) rather than as false precision.

**Recommendation fatigue** (source Hole 5) is real: 47 recs/week and nobody reads any. Rank by something like `Impact × Confidence × Frequency` and surface only the top few.

**❓ Unknown:** can AI recommendations be consistently useful enough that a professional trusts them *over their own judgment or their existing tool*? This is the bet-the-project question and it's unanswered. See §16 — test it in week two, not phase six.

---

## 12. Correlation vs. causation — and the feature that actually resolves it

The 5-second pause before "Edit Username" does **not** prove the button is hard to find. Competing explanations: reading the existing profile, deciding what to type, distraction, comparing info, *or* genuine discoverability failure. Data alone can't establish causation, so recommendations must be framed as *"this pattern may indicate…"* with multiple hypotheses and honest uncertainty.

But framing is a mitigation, not a fix. **The actual answer is session replay** (§14) — when a friction metric fires, you stop guessing and *watch the recording* of what the user did. This is the single most impactful missing feature and the direct antidote to the causation hole. rrweb (open source) makes it tractable; its absence should be a deliberate scope decision, not an oversight.

There's also a **qualified-evaluator paradox** worth internalizing: the people who can judge whether a recommendation is good (senior UX) often don't need it, and the people who need it can't evaluate it. Replay narrows this gap by letting a non-expert *see* the problem instead of trusting a claim.

**What you get for free without replay: the single-session timeline (§13.1) as "replay-lite."** You can't see pixels, but you can see the exact ordered path a user took, the route at each step, and the visibility-adjusted dwell between steps — reconstructed from the event stream you already have. When a friction metric fires on an aggregate, opening a few representative sessions' timelines is often enough to distinguish "reading the page" from "hunting for the control." It's a large fraction of replay's causation value at zero extra capture cost, and it's the honest first step before deciding whether full rrweb replay earns its complexity and privacy surface.

---

## 13. Dashboard

Four areas, unchanged in spirit: **Overview** (active users, common tasks, completion, friction, new behavior changes), **Flow Explorer** (paths + per-transition metrics — but with spaghetti-taming from §8), **Friction Explorer** (§10 signals), **AI Recommendations** (§11 shape, ranked). "New behavior changes" requires the `service.version` deploy dimension from §5 — you can't detect a behavior shift caused by a deploy if events don't carry the deploy.

### 13.1 Session timeline — single-session inspection

A fifth view, and a high-value early one: pick one `session.id` and see that session as an ordered timeline — every event on a time axis, each showing its `ux.fingerprint`, `url.path`, `ux.interaction.method`, and the `ux.active_ms` gap before it. This is the "replay-lite" from §12 — the causation tool you get for free from the event stream.

It's worth building early precisely because it's the *easiest* real view: it needs **no cross-session aggregation, no mining, no spaghetti-taming** — just one session's events, sorted by `ux.seq`. That makes it a strong demo and a genuine debugging aid long before the flow graph is tuned. Data path:

```
GET /projects/:app/sessions/:id
   → load events where attributes['session.id'] = :id
   → sessionize() (single group) → Session
   → render Step[] on a time axis (cumulative ux.active_ms)
```

No new analysis primitive required — it reuses `sessionize` (§19.3) restricted to one id. The only additions are a collector endpoint and a `SessionTimeline` component.

---

## 14. Wholesale missing vs. what mature tools ship

Framed here as **scope decisions**, not obligations — but each absence should be a choice on the record, because each is load-bearing somewhere in your own plan:

- **Session replay** — flagship of FullStory/LogRocket/PostHog and the real answer to §12. rrweb is open source. Biggest single gap.
- **User/property/group model → segmentation** — your events float free. Without user props you can't ask "is this friction worse on mobile / EU / new users / release 4.2." Every real tool is event + properties + group.
- **Funnels** — see §9.
- **Feature flags / experimentation** — Phase 7 ("measure outcomes") *silently depends on this*. Without experiment infra you can't isolate one change's effect, so the feedback loop can't close. PostHog/Amplitude bundle flags for exactly this reason.
- **Error + network correlation** — LogRocket's core move: tie the friction to the console error and failed request that caused it. Often that *is* the "why." The source lists "errors" as an event but never wires in the console/network layer.
- **Identity resolution** — anonymous→identified merge + cross-device stitching. Without it, "12,482 users" is really "~12,482 anonymous sessions."
- **Retention / cohorts, heatmaps, alerting, sampling, warehouse export** — all standard. **Sampling especially**: without it, high-traffic apps blow up cost *and* feed the AI an unrepresentative slice.

---

## 15. Privacy, consent, and the data bias it creates

Beyond §4.9's metadata leaks: in the EU, interaction telemetry can be **personal data behind a consent gate**. That means flow analysis runs on a **self-selected, consent-biased subset** of users — the metrics describe "people who accepted tracking," not "users." This quietly skews every conclusion and the AI won't know. Carry a `consent` flag on every event and be explicit in the dashboard about what population a number describes.

**❓ Unknown:** how badly consent bias distorts flow/friction metrics in practice. Depends entirely on the app's audience and jurisdiction; unmeasurable until you have real traffic.

---

## 16. Revised phased plan — reordered to de-risk

The source builds the *easy, commoditized* part first (SDK) and defers the *bet-the-project* assumption to Phase 6. That's backwards. "Can a dev install a provider?" isn't risky — it was proven a decade ago. The risky assumption is: **can auto-captured React behavior become a recommendation a professional trusts?**

**Phase 0 — Wizard of Oz (week two, before building anything real).**
Take one real React app with real traffic. Manually instrument it, run sequence analysis and AI interpretation *by hand* — no SDK, no ingestion stack. Show the output to that app's actual PM or designer. If they don't say "I'm changing this tomorrow," the product doesn't exist yet, and you learned it in a week instead of after a platform. **This is the gate.**

**Phase 1 — Identity spike.** Prove §4.2. Build the fiber-walk + composite fingerprint, deploy on one app across a few deploys, and *measure* false-merge/false-split rate. If identity isn't stable, nothing downstream matters.

**Phase 2 — SDK core.** Provider, delegated capture, `track()`, delivery reliability (sendBeacon + visibility flush + idempotency), the real event schema (§5). Include SSR/Next from the start.

**Phase 3 — Ingestion + storage.** Collector, schema validation, **ClickHouse** (or chosen columnar engine), sessionization. Name the engine here and commit.

**Phase 4 — Analysis.** Sequence mining with spaghetti-taming (thresholds, variant collapse, loop handling), flow metrics, friction signals, funnels.

**Phase 5 — Dashboard.** *Test: is this valuable with AI turned off?* If no, stop and fix the analytics before adding AI.

**Phase 6 — AI interpretation.** Summarized evidence → structured recs, ranked, with honest (not fabricated) confidence.

**Phase 7 — Outcome measurement.** Requires feature-flag/experiment infra (§14) to isolate effects. This is where confidence becomes calibrated.

**Phase 8 — Adaptive UI.** Only after behavior is reliably understood: individual model → designer-defined constraints → small, bounded adaptation.

---

## 17. The unknowns register (collected)

The things genuinely unresolved — track these, don't bury them:

1. **Fingerprint stability** — false-merge/split rate across real refactors and deploys? (§4.2) *Measurable early; measure it.*
2. **Automatic-capture line** — how much to capture so it's useful but not noise/cost/privacy hazard? (§5) *Empirical.*
3. **Sessionization rule** — right definition for long-lived SPA tabs and backgrounded mobile? (§4.5) *Judgment call, real downstream effects.*
4. **Build-plugin burden** — SWC vs Babel effort across Vite/Next/Remix/CRA? (§4.3)
5. **Mining algorithm fit** — which miner yields *readable* flows at your data/scale? (§8) *Tuning-heavy.*
6. **AI trust** — can recs be consistently good enough to trust over one's own judgment? (§11) *The bet-the-project question; §0 Phase 0 tests it.*
7. **Consent bias** — how much does it distort metrics for a given audience/jurisdiction? (§15)
8. **Confidence calibration** — can a meaningful confidence number exist before Phase 7 has enough data? (§11) *Probably not; plan around it.*
9. **Semantics vs. automation tradeoff** — the source's own Hole 2, still the hardest: more automatic = less accurate, more annotation = more work. The middle ground is unknown until real data exists. (§6)

---

## 18. Simplest starting architecture (unchanged shape, corrected order of proof)

```
@your-org/react-telemetry
   ├── Automatic events (delegated root listener + fiber identity)
   ├── Custom events (useTelemetry().track)
   └── Semantic hints (data-telemetry-* / build plugin, NOT wrapper nodes)
             │
             ▼  OTel Events (§5), batched + sendBeacon/keepalive, idempotent
      OTLP ingest (accept records, assign observedTime)   ← your collector OR a shared OTel Collector
             │
             ▼
      Event store (SQLite → Postgres → ClickHouse; §8 seam)
             │
             ▼
      Analysis service (sessionize → mine → metrics → friction)   ← THE part that's yours
             │
             ▼
      Dashboard  +  (optional) AI interpretation layer
```

Because the wire format is OTLP, the ingest step is swappable for anyone's OTel Collector — the fan-out in §19.6 can send there *and* to your analysis at once. The part no backend gives you is the analysis service; that's where the whole project lives.

---

## 19. Repository scaffold — start here

This is the concrete kickoff: a pnpm TypeScript monorepo, small enough to hold in your head, structured so the interesting part (the SDK + fingerprinting) is isolated and the plumbing stays boring. Packages publish unscoped with a `rastro-` prefix (`rastro-core`, `rastro-react`, `rastro-analysis`); the apps stay `private`.

**Stack (MVP — nothing more):** TypeScript end to end · pnpm workspaces · Fastify collector · Postgres *or* SQLite (SQLite means contributors clone-and-run with zero setup — a real OSS adoption win at this scale) · Vite + React + **React Flow** for the graph. **No ClickHouse, no OpenTelemetry, no AI, no auth beyond a project key.** Each of those has a home in the earlier sections when the project outgrows the MVP; none belongs in commit #1.

### 19.1 Layout

```
rastro/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json                 # workspace scripts: dev, build, test
├── packages/
│   ├── core/                    # framework-agnostic; the shared contract
│   │   └── src/
│   │       ├── events.ts        # THE event type — imported everywhere (§5, §19.2)
│   │       ├── seams.ts         # every swap-point interface (§19.5)
│   │       ├── fingerprint.ts   # §4.2.1 — the interesting code
│   │       └── redact.ts        # PII redaction hook (§4.9)
│   ├── react/                   # rastro-react — the SDK devs install
│   │   └── src/
│   │       ├── Provider.tsx     # <RastroProvider app exporter>
│   │       ├── useTelemetry.ts  # track(name, props?)
│   │       ├── capture.ts       # single delegated root listener (§4.1)
│   │       ├── transport.ts     # batching + flush lifecycle (§4.4)
│   │       └── exporters/       # WHERE events go — swap points (§19.6)
│   │           ├── otlp.ts      # → any OTLP endpoint / collector (DEFAULT)
│   │           ├── console.ts   # → dev logging, zero backend
│   │           └── multi.ts     # fan-out to several at once
│   └── analysis/                # PURE functions: events → graph (TDD sweet spot)
│       └── src/
│           ├── sessionize.ts    # Event[] → Session[]  (§4.5)
│           ├── graph.ts         # Session[] → FlowGraph (§9)
│           └── friction.ts      # ONE signal for v1 (§10)
├── apps/
│   ├── collector/               # Fastify — the only backend process
│   │   └── src/
│   │       ├── server.ts
│   │       ├── ingest.ts        # POST /v1/logs: accept OTLP, assign observedTime, insert
│   │       ├── graph.ts         # GET /projects/:app/graph: load events → analysis
│   │       ├── session.ts       # GET /projects/:app/sessions/:id: one session's events (§13.1)
│   │       └── db.ts            # Postgres/SQLite behind one thin interface (§8 seam)
│   └── dashboard/               # Vite + React + React Flow
│       └── src/
│           ├── api.ts
│           ├── FlowGraph.tsx       # renders the FlowGraph the collector returns
│           └── SessionTimeline.tsx # one session on a time axis (§13.1) — the easy early view
└── examples/
    └── demo-app/                # a real-ish React app you dogfood on
```

Why these boundaries: `core` has no React and no Node — pure, portable, trivially testable, and it owns the one type every other package depends on. `analysis` is pure functions over arrays, which is exactly the shape TDD loves (fixture traces in, known graph out). `collector` is the *only* server, serving both ingest and the graph query, so there's one thing to run. The `db.ts` interface is the §8 seam — swap SQLite→Postgres→ClickHouse later without touching analysis or ingest.

### 19.2 The keystone: the OTel event contract

Everything hangs off this one type. The SDK builds it and emits it as an **OTel Event record** (§5); ingest and analysis read it back. Get the `ux.*` attribute names stable early — renaming them later ripples through the SDK, the collector, and every analysis query.

```ts
// packages/core/src/events.ts
// What the SDK emits, shaped as an OTel LogRecord (Event). One interaction = one record.
export interface UxEvent {
  eventName: 'ux.click' | 'ux.route_change' | 'ux.form_submit' | string; // custom via track()
  timeUnixNano: string;          // client time — reference only
  observedTimeUnixNano?: string; // assigned at the collector — authoritative order (§4.5)
  severityNumber: 9;             // INFO
  attributes: {
    'session.id': string;              // STANDARD convention — unit of every flow (§4.5)
    'session.previous_id'?: string;    // STANDARD — continuation link
    'url.path': string;                // STANDARD — tokenized, PII-stripped (§4.9)
    'ux.event_id': string;             // idempotency for retries (§4.4)
    'ux.seq': number;                  // per-session monotonic order — never trust the clock
    'ux.fingerprint': string;          // stable element identity (§4.2.1)
    'ux.interaction.method'?: 'mouse' | 'keyboard' | 'touch';
    'ux.active_ms'?: number;           // visibility-adjusted dwell (§4.5)
    'ux.anonymous_id': string;
  };
  resource: {
    'service.name': string;            // STANDARD — the app
    'service.version'?: string;        // STANDARD — deploy dimension (§13/§14)
  };
}
```

The `ux.*` attribute names *are* your semantic conventions — the differentiator from §5. Treat this file as the spec other people instrument against, and version the namespace deliberately.

### 19.3 The click-to-graph data shapes

This is the full spine from a raw click to what the dashboard draws — three pure transforms, each with an explicit intermediate type. This pipeline *is* the product; the SDK feeds it and the dashboard renders its output.

```ts
// packages/analysis/src/sessionize.ts
export interface Step { fingerprint: string; route: string; seq: number; activeMs: number; }
export interface Session { sessionId: string; steps: Step[]; }  // steps sorted by seq

export function sessionize(events: UxEvent[]): Session[];
// group by attributes['session.id'], sort by attributes['ux.seq'],
// flatten each OTel record's attributes into a Step. The OTel envelope stops here —
// downstream analysis works on the flat Step/Session types, not raw records.
```

```ts
// packages/analysis/src/graph.ts
export interface FlowNode { id: string; label: string; hits: number; }        // id = fingerprint
export interface FlowEdge {
  from: string; to: string;      // fingerprints
  count: number;                 // how many sessions made this A→B transition
  medianMs: number;              // median dwell on `from` before moving to `to`
  dropoffRate: number;           // share of sessions that hit `from` then ended
}
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[]; }

export function buildGraph(sessions: Session[]): FlowGraph;
// for each session, walk consecutive step pairs → tally edges; aggregate node hits;
// compute medianMs and dropoffRate per edge
```

```
click in demo-app
   → capture.ts builds a UxEvent — an OTel Event record (fingerprint from §4.2.1)
   → transport.ts batches → POST /events
   → ingest.ts validates + assigns serverTs + inserts
   → GET /projects/:app/graph loads Event[]
   → sessionize(events) → Session[]
   → buildGraph(sessions) → FlowGraph
   → dashboard renders FlowGraph in React Flow
```

`FlowGraph` maps almost 1:1 onto React Flow's `nodes`/`edges` props, so the dashboard is thin by design — the intelligence lives in `buildGraph`, which is pure and fully unit-testable.

### 19.4 First commits (walking skeleton)

Follow the build order in §16 against this scaffold — end-to-end thin before deep:

1. `core/events.ts` + `db.ts` (SQLite) + `POST /v1/logs` (OTLP ingest) + a dashboard that renders stored events as a **plain table**. Hardcode one event in `demo-app` and watch it travel the whole pipe. Unremarkable, but *alive* end to end.
2. Replace the hardcoded event with real delegated `capture.ts`.
3. Add `fingerprint.ts` (§4.2.1) — the fun part; write the before/after-refactor fixture suite here.
4. Add `sessionize` + `SessionTimeline.tsx` (§13.1). **This is the easy first real view** — one session, no aggregation, no mining. It proves capture → identity → ordering end to end and is genuinely useful on its own; a great early demo and debugging aid.
5. Add `buildGraph` (test-first with fixture traces), then swap the table for `FlowGraph.tsx` (React Flow). **This is the headline demo** — record the gif for the README here.
6. Add exactly one friction signal (drop-off highlighting on edges, or rage-click detection). One.

### 19.5 Seams — the deliberate swap points

`db.ts` was one instance of a pattern worth applying everywhere it's sensible: **depend on a small interface at any boundary where a reasonable person would want a different implementation** — your infra vs a vendor, one router vs another, auto identity vs manual, one model vs none. Rule of thumb: if you can imagine a contributor swapping it, or an adopter wanting to *not run part of your stack at all*, it's a seam. Each seam is one interface in `packages/core/src/seams.ts`; the default implementation lives in the package that owns it. This keeps `core` honest (it depends on abstractions, never on SQLite or on your endpoint) and makes the whole thing far more adoptable as OSS — people can take the SDK without your backend, or your analysis without your SDK.

The catalog:

| Seam | Interface | Default | Swap for |
|---|---|---|---|
| Storage | `EventStore` | SQLite | Postgres, ClickHouse (§8), in-memory (tests) |
| **Exporter** | `Exporter` | HTTP → your collector | OTel, PostHog/Segment/Amplitude, fan-out, custom (§19.6) |
| Fingerprint | `FingerprintStrategy` | fiber + composite (§4.2.1) | manual-only (`data-telemetry-id`), hybrid, custom |
| Redaction | `Redactor` | regex email/number strip | enterprise DLP rules, no-op (trusted internal app), custom |
| Route detection | `RouteAdapter` | `history` patch | React Router, Next App/Pages, TanStack (§4.6) |
| Graph building | `GraphBuilder` | transition graph (§19.3) | real process-mining miner (§8), custom |
| Interpretation *(later)* | `Interpreter` | `none` | Anthropic, OpenAI, local model, rules-only (§11) |

Two payoffs beyond tidiness. **Tests** get trivial fakes — an in-memory `EventStore`, a capturing `Exporter` that just pushes to an array. And the `Interpreter` seam is how "AI is not the engine" (§1) becomes real in code: the default is `none`, so the analytics have to stand on their own before any model is wired in.

⚠ Don't over-build the seams on day one. Define the *interface* where it's cheap and obvious (storage, exporter, redaction from the start), but you don't need three implementations of each before the walking skeleton runs. One default behind a clean interface is the whole win; the alternates come when someone actually wants them.

### 19.6 The Exporter seam — OTLP by default, anywhere else by choice

The SDK's job is to *produce* good UX events (§5); where they go is a swap point. It batches internally and hands each batch to an `Exporter` — a one-method destination adapter:

```ts
// packages/core/src/seams.ts
export interface Exporter {
  export(batch: UxEvent[]): Promise<void> | void;   // UxEvent = OTel Event record (§19.2)
}
```

Batching and the flush lifecycle (interval, size cap, flush on `visibilitychange`, `sendBeacon` vs `keepalive`, retry, idempotency — all of §4.4) live *above* the exporter in `transport.ts`, generic and shared. The exporter only answers "deliver this batch, and in whose shape." Swapping destinations never re-opens the delivery-reliability work.

**Default — OTLP.** Because the events are already OTel records, the default exporter just posts them to any OTLP/HTTP endpoint: your own collector, a shared OTel Collector, or straight to a backend. No translation.

```ts
// packages/react/src/exporters/otlp.ts
export const otlpExporter = ({ endpoint }: { endpoint: string }): Exporter => ({
  export: (batch) => {
    const body = toOtlpLogs(batch);                 // wrap records in the OTLP logs envelope
    navigator.sendBeacon(endpoint, JSON.stringify(body));
  },
});
```

**Don't hand-roll `toOtlpLogs` if you can avoid it.** The OTLP wire shape is a fiddly nested envelope (`resourceLogs → scopeLogs → logRecords`, with attributes as typed `{key,value}` arrays). The **official OpenTelemetry JS logs exporter emits that envelope for you** — leaning on it is the real meaning of "use the OTLP convention," and it's the recommended path. Two caveats to verify before committing: (1) its **page-unload flushing** — confirm it flushes on `visibilitychange`/`pagehide` via `sendBeacon`/`keepalive`, or your §4.4 abandonment/exit signals silently vanish; if not, wrap it with the flush lifecycle in `transport.ts`. (2) bundle size. The tiny hand-rolled version above is fine for zero-dependency dev and for making the wire shape legible, but production should default to the official exporter unless a caveat forces the wrapper.

**To a non-OTel third party — translate at the edge:**

```ts
// packages/react/src/exporters/posthog.ts  (illustrative adapter)
export const posthogExporter = (ph: PostHog): Exporter => ({
  export: (batch) => batch.forEach((e) =>
    ph.capture(e.eventName, {                        // map UxEvent → provider shape
      $current_url: e.attributes['url.path'],
      fingerprint:  e.attributes['ux.fingerprint'],
      method:       e.attributes['ux.interaction.method'],
    })),
});
```

The load-bearing discipline, updated for OTel-native (see §5 reconciliation): **your canonical shape is the OTel Event record, and your semantics live in `ux.*` attributes.** OTLP is the wire format, not an escape from owning your model — the model is the conventions. Adapters for non-OTel vendors translate at the boundary; and whatever the destination, the UX insight (flow, funnel, friction) is always *your* analysis layer, never something the backend hands you. The moment a vendor's event shape leaks inward and replaces `ux.*`, you've become a thin wrapper around that vendor.

**Fan-out — your analysis *and* an existing observability backend at once:**

```ts
// packages/react/src/exporters/multi.ts
export const multiExporter = (targets: Exporter[]): Exporter => ({
  export: (batch) => targets.forEach((t) => t.export(batch)),  // add per-target error isolation for prod
});
```

Wiring is the only thing the app developer sees, and the default stays a one-liner:

```tsx
// default: OTLP to your own collector
<RastroProvider app="my-app" exporter={otlpExporter({ endpoint: "/v1/logs" })}>

// or: your analysis pipeline AND a shared OTel collector (→ Grafana/Honeycomb) at once
<RastroProvider
  app="my-app"
  exporter={multiExporter([
    otlpExporter({ endpoint: "/v1/logs" }),          // your UX analysis
    otlpExporter({ endpoint: "https://otel-collector.internal/v1/logs" }), // their observability
  ])}
>
  <App />
</RastroProvider>
```

`consoleExporter()` gives contributors zero-backend local dev (clone, run, see records in the console). And because the default is already OTLP, "bridge into existing observability" is no longer a special adapter — it's just pointing an `otlpExporter` at their collector. The thing that stays yours is what happens *after* ingest: sessionize → flow graph → funnels → friction (§19.3, §9, §10).

---

### The two things that decide whether this is buildable

If only two risks get de-risked before real investment: **stable element identity** (§4.2 / §4.2.1 — without it every number is noise) and **keeping the seams clean** (§19.5 — SQLite and your own collector now, but married to neither). Everything else in this scaffold is boring plumbing you can write in your sleep; those two are the existence conditions. The exporter seam (§19.6) is the bonus — it's what lets the SDK earn users before the backend is anything special. Start at §19.4, commit #1.
