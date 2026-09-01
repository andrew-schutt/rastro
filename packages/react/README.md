# rastro-react

**See the paths your users actually take — with zero instrumentation.**

The React SDK for [Rastro](https://github.com/andrew-schutt/rastro): drop one provider into
your app and it captures meaningful interactions — clicks, SPA route changes, form submits
and abandonments — and emits them as **OpenTelemetry** Events over OTLP.

> ⚠️ **Pre-alpha.** APIs, wire shapes, and the `ux.*` conventions will change. Read the
> limitation below before using this for anything you intend to trust.

## Install

```bash
pnpm add rastro-react
```

## Use

```tsx
import { RastroProvider, otlpExporter } from "rastro-react";

export default function App() {
  return (
    <RastroProvider
      app="my-app"
      exporter={otlpExporter({ endpoint: "http://localhost:4318/v1/logs" })}
    >
      <MyApplication />
    </RastroProvider>
  );
}
```

That's the whole integration. No backend handy? Swap in `consoleExporter()` and watch records
in the browser console — zero services required. `multiExporter([...])` fans out to several
destinations at once, so you can feed your own collector *and* an existing OTel one.

Optional enrichment where auto-capture isn't enough:

```tsx
import { useTelemetry } from "rastro-react";

const { track } = useTelemetry();
track("checkout.completed", { plan: "pro", seats: 3 });
```

String props are redacted and reserved attribute namespaces are rejected, so a stray
`{ email }` cannot reach the wire.

## ⚠️ The limitation to know about first

Element identity is anchored on the **React component chain**, and a production build renames
`SaveButton` to `t`. Minifiers reuse short names per module, so unrelated components collapse
into a single identity — quietly, with no error, corrupting every count downstream.

**Until the build-time plugin ships, this is reliable in development and not in a minified
production build.** That is a real constraint, not a caveat to skim; see
[§4.2.1 and §4.3 of the plan](https://github.com/andrew-schutt/rastro/blob/main/docs/DESIGN.md).

## What it emits

`ux.click`, `ux.route_change`, `ux.form_submit`, `ux.form_abandon`, plus whatever you
`track()`. Each carries a stable element fingerprint, a per-session monotonic sequence number,
and visibility-adjusted dwell time — so a backgrounded tab can't inflate "how long they
looked at it".

Attribute names follow
[the `ux.*` semantic conventions](https://github.com/andrew-schutt/rastro/blob/main/docs/SEMANTIC-CONVENTIONS.md).

## Swap points

Storage, exporter, fingerprint strategy, redaction, and route detection are all interfaces.
Take the SDK without the backend, point it at your own OTel collector, or replace the
redaction policy with your own — `RastroProvider` accepts `exporter`, `redactor`, and
`routeAdapter`.

## License

[MIT](./LICENSE) © 2026 Andrew Schutt
