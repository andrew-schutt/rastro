# stamp-fixture

A guard on `babel-plugin-rastro`, not a demo. It is a small React app made of the authoring
patterns the plugin must stamp correctly, built with the React Compiler and audited in CI.

## What it checks

Every host element written inside a component must ship stamped with *that* component's name.
The plugin's unit tests transform one file in isolation; this checks the **built bundle**,
which is where the plugin meets everything else in a real build. Another Babel plugin that
rewrites code first, a config that skips files, or a plugin order that changes all show up here
and nowhere else. The React Compiler hoisting `.map()` callbacks out of their component, found
building Actual Budget for `docs/VALIDATION-PLAN.md` §3.2, was one of these.

The rule is absolute-zero: one missed or misattributed element fails.

## How

1. `audit/site-plugin.ts` runs **first** in the Babel plugins. It records on each host element
   its source site and its owner, read from the code as written by a rule written independently
   of the plugin's own.
2. `babel-plugin-rastro` and the React Compiler run after it, in the order the plugin README
   documents.
3. `audit/audit.ts` reads the production bundle and compares the recorded owner with the stamp.

`pnpm build` makes two builds: `dist/` in the documented order, and `dist-misordered/` with the
compiler listed first. The misordered build **must fail** the audit. That is the audit's
canary: if it ever passes, the audit can no longer see the failure it exists for.

## Running it

```bash
pnpm --filter stamp-fixture build
pnpm --filter stamp-fixture test
```

CI runs both through the workspace `build` and `test` steps.

**On a §3.2 corpus app, by hand:** add `audit/site-plugin.ts` as the first Babel plugin in that
app's build, build it, then:

```bash
node examples/stamp-fixture/audit/cli.ts <its build dir>
```

Corpus apps are third-party code with their own install scripts, so they are never built in CI.

## Adding a pattern

Write it in `src/patterns.tsx`, render it from `src/main.tsx`, and add its owner to the
coverage list in `audit/fixture-suite.ts`. That suite is shared with
[`examples/stamp-fixture-vite8`](../stamp-fixture-vite8), which builds this same `src/` with
Vite 8 and plugin-react v6, so one change covers both toolchains. Coverage is pinned, so a pattern that never reaches the
bundle fails the test rather than passing vacuously.

## What it cannot tell you

Whether identity is stable or useful on real apps. This app was written by us to exercise
patterns we already know about, which is exactly the limitation `CLAUDE.md` gives for the demo
app. Finding the patterns we don't know about is what the §3.2 corpus is for.
