# Prior art — what Rastro is similar to, and where it actually differs

**Surveyed September 2026.** A snapshot, not a standing claim: this field moves, and several
findings below would change the plan if they changed. Re-check before leaning on any of it.

The purpose is not marketing positioning. It is to find out which parts of this project are
genuinely unoccupied and which are being rebuilt out of ignorance — and, as it turned out, to
find one piece of prior art that changes what should be built next.

---

## The landscape

| Category | Who | What they do |
|---|---|---|
| Autocapture product analytics | Heap, PostHog, Amplitude, Mixpanel | Capture every click; define events retroactively. Path/journey views, funnels. |
| Session replay / digital experience | FullStory, LogRocket, Contentsquare, Quantum Metric, Hotjar; **OpenReplay**, **Highlight.io** (OSS) | Pixel replay plus friction signals — rage clicks, dead clicks, error correlation. |
| Frontend RUM on OpenTelemetry | **Grafana Faro**, Sentry, Elastic RUM, `@opentelemetry/instrumentation-user-interaction` | Errors, web vitals, traces. Faro is OSS and OTLP-native. |
| OTel-native backends | SigNoz, OpenObserve, Uptrace, Dash0 | Store and explore OTLP. No UX semantics of their own. |
| Process mining | Celonis, Apromore, PM4Py, Disco | Discover process models from event logs. Enterprise and BPM-oriented. |

## Not novel, and the docs should keep saying so

- **Autocapture.** Commodity since Heap, 2013.
- **Path and journey analysis.** Ships in PostHog, Amplitude and Mixpanel.
- **Rage clicks, dead clicks, friction signals.** A decade old at FullStory and Contentsquare.
  §10 already concedes this and redirects the investment into *ranking* (§11), which is the
  right call.
- **Session timelines.** Table stakes.
- **Emitting OTLP from the browser.** Exactly what Grafana Faro does, and it is OSS.

## Genuinely unoccupied

**Element identity derived from React component structure.** The incumbents were checked
individually and all three are DOM/CSS-based — the approach §4.2 rejects as breaking on
refactor:

| Tool | How it identifies an element |
|---|---|
| PostHog | `elements_chain` of DOM ancestors; filtering by CSS selectors |
| Heap | DOM hierarchy view; users write CSS selectors |
| FullStory | "Optimized and Full CSS selectors" for the element |

Nobody in the analytics tier keys identity on the React component tree.

**A published `ux.*` semantic convention.** OpenTelemetry's browser semantic conventions are
at Development status and cover things like `browser.web_vital`. There is no vendor-neutral
contract for *which element a user touched and what its stable identity is*.
[`SEMANTIC-CONVENTIONS.md`](SEMANTIC-CONVENTIONS.md) fills a real gap rather than restating
someone else's spec.

**Interactions as Events, not spans.** Faro's user-interaction instrumentation emits *spans*.
Rastro's conventions say interactions MUST NOT be spans, with a stated reason (§5). That is a
deliberate divergence from the one OSS tool in the same lane, not an oversight.

**Process-mining vocabulary applied to front-end UX.** Apromore and PM4Py are real and open
source, but aimed at business processes from ERP logs. Nobody applies spaghetti models,
variant collapsing, or conformance checking to UI interaction traces in open source.

**Identity drift resolution with human confirmation.** No comparable feature found.
PostHog's *Actions* let you group selectors under a named event, but that is authoring
semantics up front, not detecting and repairing drift after a deploy. See
[`IDENTITY-RESOLUTION.md`](IDENTITY-RESOLUTION.md).

---

## The finding that changes the plan: Sentry already built §4.3

Sentry ships `@sentry/babel-plugin-component-annotate`, a build-time Babel plugin that parses
JSX and injects data attributes onto the rendered DOM:

```html
<div data-sentry-component="MyAwesomeComponent"
     data-sentry-source-file="myAwesomeComponent.jsx">
```

Their stated rationale is the same as §4.3's: component names remove the ambiguity of CSS
selectors, which becomes worse after minification. Three consequences, in increasing
importance.

**1. §17 unknown #4 is partly answered.** "SWC vs Babel plugin authoring effort and
maintenance burden across toolchains" — someone ships and maintains one in production. The
cost is bounded and there is a reference implementation to read. What stays open is the SWC
half and the Next/Remix/Vite matrix.

**2. `data-sentry-source-file` is the rename-proof anchor** §4.3 describes. A rename does not
move a file, so source location survives exactly the refactor that mints a new runtime
fingerprint. Independent arrival at the same design is good validation, and it means that half
is proven rather than speculative.

**3. This may obsolete the fiber walk, which is the uncomfortable one.** If a build plugin
stamps component names onto DOM attributes, the ancestry chain can be reconstructed by walking
up the **DOM** and collecting them — no React internals, minification-proof by construction,
and it fits machinery that already exists, since `data-telemetry-id` already resolves by
ancestor lookup.

The fiber walk's remaining justification is that it needs zero configuration, which matters
for adoption but is a dev-mode-quality answer. Weigh that against what it costs: reading
React's private internals with no public API, which `NOTES.md` records as degrading silently
and everywhere at once if React moves the fiber key.

So the baseline comparison in [`VALIDATION-PLAN.md`](VALIDATION-PLAN.md) §3.2 has to include a
build-plugin DOM-attribute chain, not just the weaker no-fiber baselines. If the fiber walk
cannot beat it, the biggest liability in the codebase is being carried for convenience rather
than capability.

---

## Where this contradicts the project's own positioning

§5 concludes that differentiation collapses onto two things: the `ux.*` conventions, and the
behavioral analysis layer that generic OTel backends do not provide. **The first half holds.
The second is too generous to itself** — path analysis is not differentiated, since PostHog,
Amplitude and Mixpanel all ship it.

What is actually differentiated is flow graphs **keyed on component identity rather than CSS
selectors**, which is what would make them survive a refactor that breaks everyone else's.

That inverts a framing worth correcting. §19 calls stable identity an *existence condition* —
a prerequisite, something that has to work before the interesting part can. On this evidence
identity is not the prerequisite for the differentiator; **identity is the differentiator**,
and the flow graph is how you demonstrate it. Which is a stronger argument for running the
identity spike first than the plan currently makes, and a reason it must measure against a
PostHog-style CSS-selector baseline specifically — that is the incumbent approach the entire
design is a bet against.

---

## Sources

- [Grafana Faro](https://grafana.com/oss/faro/) ·
  [Faro's OpenTelemetry integration](https://deepwiki.com/grafana/faro-web-sdk/5.1-opentelemetry-integration)
- [OTel browser events semconv](https://opentelemetry.io/docs/specs/semconv/browser/browser-events/) ·
  [OTel session semconv](https://opentelemetry.io/docs/specs/semconv/general/session/)
- [PostHog autocapture](https://posthog.com/docs/product-analytics/autocapture) ·
  [PostHog Actions](https://posthog.com/docs/data/actions)
- [Heap — how autocapture actually works](https://www.heap.io/blog/how-autocapture-actually-works)
- [FullStory — finding element selectors](https://help.fullstory.com/hc/en-us/articles/38368342628759-Guides-and-Surveys-Finding-Element-Selectors-on-Your-Website)
- [Sentry — React component name capturing](https://docs.sentry.io/platforms/javascript/guides/react/features/component-names)
- [Process mining tool landscape](https://processmind.com/resources/blog/the-ultimate-list-of-process-mining-tools-for-2026)
