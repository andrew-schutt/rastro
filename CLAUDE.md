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
| What does a finding (Rastro's output) have to contain? | `docs/OUTPUT-CONVENTIONS.md` |
| What is actually built vs. stubbed? Where does it break? How do I run it? | `docs/NOTES.md` |
| What should I work on, and what is deliberately not being worked on? | `docs/VALIDATION-PLAN.md` |
| How do I commit / branch / merge / verify? | `CONTRIBUTING.md` |
| Is this idea novel? Who else does it? | `docs/PRIOR-ART.md` |
| What happens when a fingerprint drifts across a deploy? | `docs/IDENTITY-RESOLUTION.md` |
| Which commits, screens and flows does §3.2 run on? | `docs/CORPUS.md` |
| Who reads the output, and in what format? | `docs/CONSUMERS.md` |

**`docs/NOTES.md` outranks `docs/DESIGN.md` on questions of fact.** The design says what was
intended; NOTES records what shipped, every deviation and why. Where they disagree about the
code, NOTES is right. Trust it over your own reading of the design, and over assumptions.

## State, as of 2026-11-18

**Active again since 2026-10-29, on §3.2 (the identity spike).** Work had paused on
2026-09-02.

The walking skeleton is complete and spans design Phases 1–5 in thin form. **Neither of §16's
de-risking gates has passed.** Phase 0 (Wizard of Oz) has never been run, and the identity gate
was measured and failed rule 1 (below). The discipline right now is still *validate, don't
build outward* (`docs/VALIDATION-PLAN.md`).

**§3.1's own three-week trigger has fired, and the finding is recorded against it.** Read that
before planning anything: it is why the restart point is §3.2, which never needed anyone's
permission, and not §3.1. Recruiting a host is the maintainer's to do, not a code task.

**§3.2's first scored run (run 2) failed rule 1 and passed rule 2 (2026-11-18).** The shipped
fingerprint beats none of its alternatives, and barely differs from role + accessible name
alone, but it never churned on untouched code. Under `docs/VALIDATION-PLAN.md` §3.2 the next
step is fingerprint redesign, not more product. The report is
`scripts/identity-spike/scoring/results/run-2.md`. Run 1 was void and never scored
(`docs/CORPUS.md`). The corpus (two third-party apps, built by hand and never in CI) and
`scripts/identity-spike/scoring/` are the standing measure of identity. A changed fingerprint
is judged on them as a new run, under a new freeze (`corpus/freeze.json`), with definitions
fixed before its numbers are seen, on commits nobody has seen. Rules 3 and 4 await their hand
steps, and their worksheets exist.

Identity derives from build-time DOM attributes stamped by `babel-plugin-rastro`, so it
survives minification. The React fiber walk is still in the code as the fallback for apps
installed without the build step, but run 2 decided its removal: it did not beat role +
accessible name. Removing it, the marked fiber walk and the plugin's `includeSourceFile` and
`markComponents` options is the next change. After it, an app without the plugin gets role and
accessible name only. Strategy is chosen once per document, never per
element. **Next.js is the open gap.** It compiles with SWC, and that port is the open half of
§17 #4.

**Output has a direction and a first record, and nothing emits it.** `docs/CONSUMERS.md` names
AI agents as the first consumer. `docs/OUTPUT-CONVENTIONS.md` defines the one derived record,
the finding, which is typed and built. Work-list items 1 to 4 needed no gate and are done.
Items 5 to 8, which emit findings, wait for both gates.

## Traps that are written nowhere else

- **Build before typecheck, lint, or test at the workspace root.** Cross-package types resolve
  through each package's emitted `dist`, so a stale build produces confusing failures in
  unrelated packages.
- **`SEMANTIC-CONVENTIONS.md` is ahead of the code.** Since spec `0.2` the
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
- **Output is OpenTelemetry, whoever produces or consumes it; AI agents read it first** —
  `docs/CONSUMERS.md`. Rastro is the output library, not the factory, and a person can always
  see what an agent is fed. An agent reading the output is not an `Interpreter`, so §1 holds.

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
