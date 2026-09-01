# rastro-core

The shared contract for [Rastro](https://github.com/andrew-schutt/rastro), an
OpenTelemetry-native UX-flow tool for React.

> ⚠️ **Pre-alpha.** APIs and the `ux.*` conventions will change.

Framework-agnostic and dependency-free: no React, no Node APIs. It owns the one type every
other package depends on, plus every deliberate swap point.

## Install

```bash
pnpm add rastro-core
```

Most people don't install this directly — [`rastro-react`](https://www.npmjs.com/package/rastro-react)
depends on it. Install it on its own if you're writing your own instrumentation, your own
storage, or your own analysis against the same contract.

## What's in it

**`UxEvent`** — the event contract. An OTel LogRecord (Event) carrying the `ux.*` attributes
defined by
[the semantic conventions](https://github.com/andrew-schutt/rastro/blob/main/docs/SEMANTIC-CONVENTIONS.md).
One interaction, one record.

```ts
import { isUxEvent, type UxEvent } from "rastro-core";

if (isUxEvent(record)) {
  record.attributes["ux.fingerprint"]; // stable element identity
  record.attributes["ux.seq"];         // per-session order — never trust the clock
}
```

**`fingerprint(element)`** — stable element identity from React component ancestry, role, and
accessible name: `Settings>ProfileForm>SaveButton|button|"Save Profile"`. An explicit
`data-telemetry-id` overrides it entirely.

**`redact` / `tokenizePath`** — the privacy defaults. Emails and long digit runs stripped from
text; `/users/42/settings` tokenized to `/users/:id/settings`, with query strings and
fragments dropped.

**Seam interfaces** — `EventStore`, `Exporter`, `FingerprintStrategy`, `Redactor`,
`RouteAdapter`, `GraphBuilder`, `Interpreter`. Depend on the interface at any boundary a
reasonable person would want to replace.

## License

[MIT](./LICENSE) © 2026 Andrew Schutt
