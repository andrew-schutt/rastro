# continuity — the fingerprint continuity smoke test

A small app we wrote, a list of known edits to it, and the fingerprint change each edit must
cause. It runs in CI, and its outputs are committed.

## What it is for

**It tests the measuring instrument, not the identity design.** We wrote the app and the
edits, so it cannot say whether fingerprints hold up on real apps; that is what the §3.2
corpus is for (`docs/VALIDATION-PLAN.md`). What it can say, on an app whose answers we know:

- the diff tooling (`src/continuity.ts`) reports exactly the changes that happened, before
  the corpus runner trusts it with numbers nobody can check;
- the identity rules behave as written: the 4-component chain cap, `*Provider` filtering,
  the file part, deterministic output;
- **no PR changes a fingerprint without saying so.** Any change to fingerprint output shows
  up as a diff in `__snapshots__/`, which a reviewer sees.

## How it works

1. `app/src/` is the base app. Every interactive element carries `data-el`, its ground-truth
   identity, which fingerprints never read.
2. `scenarios.ts` lists the edits. Each is a small patch to the base app, with the elements
   whose fingerprint it must change under each strategy. Every other element must not change.
   The expectations were written from the rules before the first run, and each says why.
3. `harness.ts` compiles a variant in memory with Babel (`babel-plugin-rastro` first for the
   attribute strategies), renders it with real React in jsdom, and fingerprints every
   interactive element with `rastro-core`.
4. `continuity.test.ts` checks each scenario's changed elements against its expectations,
   checks that the fingerprint-only diff (all the corpus will have) agrees with that, and
   compares everything with `__snapshots__/`.

**Strategies:** the three that exist in `rastro-core` today: the attribute chain with file
(the default), the attribute chain without file, and the fiber walk (compiled without the
plugin, names intact, so a dev build). The CSS selector path and the marked fiber walk from
§3.2 rule 1 join `STRATEGIES` in `harness.ts` when they are built, and every scenario then
needs an expectation for them.

## The scenarios

| Scenario | Edit | Changes |
|---|---|---|
| `rebuild` | none | nothing (output is deterministic) |
| `heading-copy` | edit a heading no control is named by | nothing |
| `provider-wrapper` | wrap the app in a `ThemeProvider` that renders a `<div>` | nothing (NOISE) |
| `layout-wrapper` | insert `Layout` between `App` and `SettingsPage` | the shallow elements only; the fiber walk spares `pref-dark` |
| `label-edit` | change the Save button's text | `save` |
| `rename-component` | rename `Toolbar` in place | `save`, `cancel` |
| `move-file` | move `SaveButton.tsx` to another folder | `save`, with the file part only |
| `tooltip-wrap` | wrap the Save button in a new `Tooltip` | `save` |
| `rename-composer` | rename `PreferenceRow`, which only composes primitives | `pref-dark`, fiber walk only |

The last row is the design-system degeneration from `docs/NOTES.md`, seen from its other
side: a component that stamping cannot see is one whose rename stamping cannot see either.

## When it fails

- **An expectation fails:** the tooling or an identity rule does not do what the scenario
  says. Find which rule is responsible before touching the expectation. Never change one to
  match a run without being able to name the rule that produced it.
- **Only a snapshot fails:** some fingerprint changed in a way no expectation covers, such
  as a format change. If it is intended, update with
  `pnpm --filter identity-spike test -u` and say in the PR what changed and why, because a
  fingerprint change splits every stored identity it touches. In CI the snapshots are never
  rewritten, only compared.

## Adding a scenario

Add it to `SCENARIOS` with an expectation for every strategy and a reason for any that
differ, run the tests once with `-u` to write its snapshot, and read that snapshot before
committing it.
