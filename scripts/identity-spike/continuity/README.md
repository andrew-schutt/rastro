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
   attribute strategies and, with `markComponents`, the marked fiber walk), renders it with real React in jsdom, and fingerprints every
   interactive element with `rastro-core`.
4. `continuity.test.ts` checks each scenario's changed elements against its expectations,
   checks that the fingerprint-only diff (all the corpus will have) agrees with that, and
   compares everything with `__snapshots__/`.

**Strategies:** all six of §3.2 rule 1's. The three that are `rastro-core`'s own
`fingerprint()`: the attribute chain with file (the default), the attribute chain without
file, and the fiber walk (compiled without the plugin, names intact, so a dev build). Then the
two baselines from `../src/baselines.ts`, both compiled without the plugin: role + accessible
name (`role+name`), and the CSS selector path modelled on PostHog's `$elements_chain`
(`selector-path`). Last, the marked fiber walk (`marked-fiber`): core's `markedFiberWalk`,
composed by `describeElement`, over a build with the plugin's `markComponents` on.

**`app/vendor/` stands in for `node_modules`.** It is compiled without the plugin under every
strategy, as a real build never annotates third-party code. The `pick-theme` button is
rendered by its `Picker`, inside the app's `ThemePicker`, which composes only that library.
Without a library, the marked walk could not be told apart from the fiber walk on this app.

The fixture has no two controls with the same role and name, so it cannot show `role+name`'s
characteristic failure, which is merging look-alikes. That is for the corpus. Here it only
shows that the baseline is wired up and splits on nothing but a name.

## The scenarios

| Scenario | Edit | Changes | Selector path | Marked walk |
|---|---|---|---|---|
| `rebuild` | none | nothing (output is deterministic) | nothing | nothing |
| `heading-copy` | edit a heading no control is named by | nothing | nothing | nothing |
| `provider-wrapper` | wrap the app in a `ThemeProvider` that renders a `<div>` | nothing (NOISE) | **all eight** | nothing |
| `layout-wrapper` | insert `Layout` between `App` and `SettingsPage` | the shallow elements only; the fiber walk spares `pref-dark` and `pick-theme` | everything below `Layout` (six) | the shallow elements, `pick-theme` included |
| `label-edit` | change the Save button's text | `save` | `save` | `save` |
| `rename-component` | rename `Toolbar` in place | `save`, `cancel` | nothing | `save`, `cancel` |
| `move-file` | move `SaveButton.tsx` to another folder | `save`, with the file part only | nothing | `save` |
| `tooltip-wrap` | wrap the Save button in a new `Tooltip` | `save` | `save`, and `cancel` by position alone | `save` |
| `rename-composer` | rename `PreferenceRow`, which only composes primitives | `pref-dark`, fiber walk only | nothing | `pref-dark` |
| `library-upgrade` | rename a component inside `vendor/` | `pick-theme`, fiber walk only | nothing | nothing |

`role+name` changes only on `label-edit`. The selector path's column is the trade the
design bets on, seen on the fixture: it does not notice renames, and it does notice every
wrapper `<div>`, including one around the whole app. Wrappers are exactly what NOISE and the
chain cap exist to absorb. `tooltip-wrap` shows that the selector path's positional parts
move an element no one touched, because `cancel`'s preceding sibling changed tag.

`rename-composer` is the design-system degeneration from `docs/NOTES.md`, seen from its
other side: a component that stamping cannot see is one whose rename stamping cannot see
either. The marked walk sees it, because the plugin marks every component it names, host
element or not.

`library-upgrade` is the other half. The unmarked fiber walk reads library internals, so a
dependency upgrade moves it on an element no one in the app touched. That is the churn rule 2
requires to be zero. The marked walk skips unmarked fibers, so it does not move. Between them,
the two rows are what strategy 6 was pre-registered to show: it sees what 4 and 5 miss,
without 3's exposure to the library.

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
