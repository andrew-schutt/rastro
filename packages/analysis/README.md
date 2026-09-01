# rastro-analysis

Pure functions turning UX telemetry into user flows, for
[Rastro](https://github.com/andrew-schutt/rastro).

> ⚠️ **Pre-alpha.** APIs and the `ux.*` conventions will change.

No I/O, no framework, no clock. Fixture traces in, known output out — which is what makes the
interesting part of the system testable.

## Install

```bash
pnpm add rastro-analysis
```

## Use

```ts
import { sessionize, buildGraph, detectFriction } from "rastro-analysis";

const sessions = sessionize(events);   // group by session.id, order by ux.seq
const graph = buildGraph(sessions);    // nodes, transitions, median dwell, drop-off
const friction = detectFriction(sessions);
```

**`sessionize`** groups events by `session.id` and orders each group by `ux.seq` — the sole
authority for order. Timestamps are for display; user clocks are skewed and ordering by them
scrambles sequences.

**`buildGraph`** aggregates sessions into a flow graph. `count` is how many *sessions* made a
transition, so one user hammering a path can't outweigh a path many users take. `medianMs` is
a median rather than a mean, because dwell is long-tailed and one walked-away-from-the-desk
session would drag a mean somewhere meaningless.

**`detectFriction`** returns ranked deterministic signals — rage clicks and high-abandonment
elements. Ranking uses sessions affected, the one measure comparable across signal kinds.

These are evidence, never a diagnosis. A rage click can be a slow network as easily as a
confusing control; an exit point can be where the task legitimately finishes.

## Works without the rest of Rastro

Anything conforming to
[the `ux.*` conventions](https://github.com/andrew-schutt/rastro/blob/main/docs/SEMANTIC-CONVENTIONS.md)
can feed this. You don't need the SDK or the collector to use the analysis.

## License

[MIT](./LICENSE) © 2026 Andrew Schutt
