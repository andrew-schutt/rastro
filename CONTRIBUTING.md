# Contributing

Rastro is pre-alpha and currently has one maintainer, so this reads as much like a working
agreement as a contributor guide. Both are the intent: the conventions below are what keeps
the project's reasoning legible to a stranger — and to the maintainer in three months.

Setup, the dev loop, and what is implemented vs. stubbed live in
[`docs/NOTES.md`](docs/NOTES.md), not here.

## Orientation

| Document | What it is |
|---|---|
| [`docs/DESIGN.md`](docs/DESIGN.md) | The seeding design document. Section numbers (`§4.2.1`, `§19.3`) referenced throughout the codebase point here. |
| [`docs/SEMANTIC-CONVENTIONS.md`](docs/SEMANTIC-CONVENTIONS.md) | The `ux.*` attribute and event spec. A contract others instrument against — versioned independently of the SDK. |
| [`docs/NOTES.md`](docs/NOTES.md) | The accurate record: what is implemented vs. stubbed, every deviation from the design and why, and the known holes. |
| [`docs/VALIDATION-PLAN.md`](docs/VALIDATION-PLAN.md) | The current body of work and its sequencing. |

**The docs are the contract.** Deviate from them when they are wrong — several deviations are
already on the record — but say so, and say why, in `NOTES.md`. A silent deviation is the
expensive kind, because the next person reads the design and believes it.

## Commits

Small and logically scoped. One commit does one thing, and its message says **why**, not what
— the diff already says what.

The bar: someone running `git blame` on a surprising line six months from now should find
their question answered. In practice this means the body carries the alternative that was
rejected, the constraint that forced the shape, or the bug that motivated it. Several existing
commits and `NOTES.md` entries are the reference register.

## Branches

Never commit straight to `main`. Branch, then open a pull request — including for your own
work.

Naming: `docs/`, `fix/`, `feat/`, `spike/` prefix plus a short slug.

## Pull requests

**One PR per body of work, not per commit.** For work sequenced in `VALIDATION-PLAN.md`, that
means one PR per plan item — the identity spike is one PR, session persistence is one, the
unload/`Exporter` seam change is one. A PR that contains a single commit is fine when the item
is genuinely one change; a PR that exists only to wrap a one-line typo fix is friction with
nothing on the other side, and those can go straight onto a branch and merge.

**The PR body is where reasoning goes that does not belong in a commit message.** Commit
messages explain individual changes; the PR explains the change as a whole and what it means
for the project.

Include:

- **Acceptance criteria as checkboxes.** For plan work, lift the item's *Done* and *How we
  know it worked* from `VALIDATION-PLAN.md` verbatim. They are already written in that shape,
  which turns them into something checkable rather than prose to be re-interpreted later.
- **Browser verification, stated explicitly.** See below.
- **For a public API change** — anything touching `packages/core/src/seams.ts`, the `UxEvent`
  contract, or the `ux.*` conventions — the compatibility story. What breaks, what stays
  valid, and whether `ux.convention.version` moves. Write it once, here, where the changelog
  can later be drawn from it.

### Gate PRs

`VALIDATION-PLAN.md` §3.2 and §3.5 are decision points, not features. Their PRs carry a
different payload and it is the most valuable thing this workflow produces:

- the numbers actually measured,
- the threshold that was **pre-committed before the numbers were seen**,
- the resulting call, including "stop here."

A gate PR whose result was negative still gets merged, with the finding recorded in
`NOTES.md`. A negative result written down honestly is the most valuable artifact the
validation work can produce, and it is the one most likely to go unwritten.

## Merging

**Squash-merge is disabled on this repository, deliberately.** Merge commits and
fast-forward only.

The reason: commits here are small, logically scoped, and carry their *why* in the message.
Squash-merge collapses all of that into one commit whose body is the PR title, destroying
exactly the granularity the commit convention exists to create. It is the most common way this
workflow quietly discards the thing it was adopted for.

Use `--ff-only` where the branch is linear and you want no merge noise; a merge commit
otherwise.

## Verification

**Unit tests are not sufficient evidence that a change works.** Driving the demo app through
Chrome DevTools Protocol has found four bugs that unit tests missed and would have kept
missing:

- a React StrictMode remount silently killing the event transport,
- form abandonment never firing on macOS, because it keyed off `focusout`,
- rage clicks being undetectable on submit buttons, because the click's own `form_submit`
  broke the run,
- the flow graph growing off-screen, because `fitView` only runs at mount.

Every one is a wiring or lifecycle failure invisible to a test that stubs the environment.
**Assume anything unverified in a real browser is unverified**, and say in the PR what you
drove and what you saw.

Tests sit in two deliberate layers, and new code should land in the right one:

- **Pure, no DOM** — the interesting logic, extracted so it tests without a browser at all
  (`sessionize`, `redact`, `createActiveClock`, `createFormTracker`, `timeline.ts`,
  `layout.ts`). DOM-facing code should be a thin wrapper over one of these.
- **jsdom** — only the wiring the pure tests cannot reach: listener registration and teardown,
  ancestor resolution, reference counting. Files opt in with a `@vitest-environment jsdom`
  docblock so the pure suites stay in node and stay fast.

A test that does not fail when you mutate the source it covers is not earning its place.
Check.

## Static analysis

Three layers, all of which CI fails on. Run them together before pushing:

```bash
pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm -r test
```

**The TypeScript compiler is the first layer and does most of the work.**
`tsconfig.base.json` runs `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnused*`, and `erasableSyntaxOnly` —
that last one because `apps/collector`'s dev script runs TypeScript through Node's native type
stripping, which cannot erase an enum or a constructor parameter property. Writing one should
be a compile error, not a dev-script-only runtime failure.

`pnpm -r typecheck` reads `tsconfig.test.json`, which covers source *and* tests. The build
configs exclude tests so they stay out of `dist`, and Vitest transpiles without checking, so
this is the only thing that type-checks the suites.

**ESLint is the second layer, and it is the stock recommended sets — nothing bespoke.**
`js.configs.recommended`, `typescript-eslint`'s `recommendedTypeChecked`, and
`react-hooks`. The value is in the type-aware rules the compiler cannot express — floating
promises, misused promises, unbound methods — and in `react-hooks/exhaustive-deps`, raised to
an error because a warning nobody fails on is a warning nobody reads.

**Formatting is not linted.** There is no Prettier, deliberately: adopting one means a
single reformat commit across every file, and `git blame` is load-bearing here — the commit
convention exists so blame answers *why*. Match the surrounding style by hand.

### Suppressions

`--max-warnings=0`, so an unused `eslint-disable` fails the build. A stale suppression is
worse than none, because it reads as a live decision that no longer applies.

**Every suppression carries a reason on the line above it**, and the bar is that the rule is
wrong here, not that the fix is inconvenient. The four in the tree are the reference:
`no-redundant-type-constituents` on `UxEvent.eventName` (the literals are documentation and
autocomplete; `track()` keeps the union open), `unbound-method` in `route.ts` and
`route.dom.test.ts` (capturing the unbound method *is* the history patch), and
`set-state-in-effect` in the dashboard (the rule cannot see through an `await`). Prefer fixing
the type — `Telemetry`'s methods became function properties rather than being suppressed,
which is both what the rule asked for and the stricter declaration.

## Dependencies

The stack is fixed: pnpm workspaces · TypeScript strict + ESM · Fastify collector ·
better-sqlite3 behind the `EventStore` interface · Vite + React + React Flow · Vitest + jsdom ·
ESLint with typescript-eslint.

Adding to it is a decision to be raised in an issue first, not an implementation detail to be
discovered in a diff. `DESIGN.md` §19 is explicit that ClickHouse, AI, and auth each have a
home in a later phase and none belongs yet — the narrow scope is load-bearing, not an
accident.

## Limitations

State them plainly. The README carries the minification caveat on purpose, and
`NOTES.md` has a standing "known holes that will bite" section. If a change introduces a
limitation, it goes in one of those in the same PR — documenting a weakness is a credibility
signal, and finding it undocumented later is the opposite.
