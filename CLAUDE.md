# CLAUDE.md

Orientation for a fresh session. Everything here is *routing* plus the handful of facts that
live in no other file — the docs below are the content, and this must not restate them.

## What this is

Rastro reconstructs real user flows in React apps from auto-captured interaction behavior,
emitted as OpenTelemetry Events. Open source, pre-alpha, one maintainer.
`rastro-core` · `rastro-react` · `rastro-analysis` are published at `0.0.1`;
`babel-plugin-rastro` is new and unpublished.

## Where to look

**`§` references throughout the codebase point into `docs/DESIGN.md`** (renamed from
`PLAN.md`; the section numbers are stable and load-bearing).

| Question | File |
|---|---|
| Why is it designed this way? | `docs/DESIGN.md` |
| What does an event have to contain? | `docs/SEMANTIC-CONVENTIONS.md` |
| What is actually built vs. stubbed? Where does it break? How do I run it? | `docs/NOTES.md` |
| What should I work on, and what is deliberately not being worked on? | `docs/VALIDATION-PLAN.md` |
| How do I commit / branch / merge / verify? | `CONTRIBUTING.md` |
| Is this idea novel? Who else does it? | `docs/PRIOR-ART.md` |
| What happens when a fingerprint drifts across a deploy? | `docs/IDENTITY-RESOLUTION.md` |

**`docs/NOTES.md` outranks `docs/DESIGN.md` on questions of fact.** The design says what was
intended; NOTES records what shipped, every deviation and why. Where they disagree about the
code, NOTES is right. Trust it over your own reading of the design, and over assumptions.

## State, as of 2026-09-02

The walking skeleton is complete and spans design Phases 1–5 in thin form. **Both of §16's
de-risking gates are still open** — Phase 0 (Wizard of Oz) has never been run, and the
fingerprint has never been measured. That asymmetry is the whole point of
`docs/VALIDATION-PLAN.md`: the discipline right now is *validate, don't build outward*.

Identity now derives from build-time DOM attributes stamped by `babel-plugin-rastro`, so it
survives minification; the React fiber walk remains the fallback for apps installed without
the build step, and is reliable only in dev. Strategy is chosen once per document, never per
element. **Next.js is the open gap** — it compiles with SWC, and that port is the open half
of §17 #4.

## Traps that are written nowhere else

- **Build before typecheck, lint, or test at the workspace root.** Cross-package types resolve
  through each package's emitted `dist`, so a stale build produces confusing failures in
  unrelated packages.
- **`SEMANTIC-CONVENTIONS.md` is ahead of the code.** The spec is at `0.2`, where the
  fingerprint parts are Recommended and default-on. The emitter still requires the provider's
  `optIn` prop. Do not read the spec as a description of current behaviour.
- **`packages/babel-plugin` disables `exactOptionalPropertyTypes`**, alone in the repo, because
  Babel's published types require it. Do not "fix" this, and do not copy the relaxation
  anywhere else.
- **The demo app is not a test subject.** It proves the pipe works. It cannot answer any
  question about whether identity is stable or whether the output is useful, because we wrote
  both the app and the tool.

## Standing decisions — do not relitigate without new evidence

Each is documented with its reasoning; the pointer is where to argue with it.

- **No AI/interpreter until the analytics stand alone** — `DESIGN.md` §1, §11.
- **No ClickHouse, funnels, segmentation, or spaghetti-taming yet** — `VALIDATION-PLAN.md` §5
  has the full not-doing list with triggers.
- **The stack is fixed.** Additions go to an issue first, not into a diff — `CONTRIBUTING.md`.
- **No Prettier**, and **squash-merge is disabled** — both in `CONTRIBUTING.md`, both for
  reasons that will look like preferences until you read them.
- **Interactions are Events, never spans** — `SEMANTIC-CONVENTIONS.md`.

## How to be useful here

`CONTRIBUTING.md` has the mechanics — commits, branches, PRs, the browser-verification bar,
the three static-analysis layers. Beyond those:

- **Push back on framing.** Several of this project's best decisions came from disputing the
  premise of a request rather than answering it. If a plan looks wrong, say so first, then do
  the work.
- **Never invent a number that looks like a measurement.** Thresholds, rates, and confidence
  scores with no external referent get laundered into standards. There is no published
  false-merge rate anywhere in this industry — `VALIDATION-PLAN.md` §3.2 shows what to do
  instead, which is to pre-commit to comparative or absolute-zero rules.
- **State limitations plainly and put them in writing.** The README carries the minification
  caveat on purpose. A limitation discovered and left undocumented is the expensive kind.
- **Verify claims about the outside world.** Check current sources rather than answering from
  training data; `docs/PRIOR-ART.md` exists because doing so changed the plan.

## Keeping this file honest

It goes stale on: the state paragraph above, and any doc being added, renamed, or retired.
Everything else here should outlive a given week of work. If it starts duplicating a doc,
delete the duplicate rather than syncing it.
