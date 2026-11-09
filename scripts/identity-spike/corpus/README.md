# corpus/ — the §3.2 corpus runner

Builds and (later) drives the two corpus apps pre-registered in
[`docs/CORPUS.md`](../../../docs/CORPUS.md). **Run by hand, locally, never in CI.** These are
third-party apps with their own install scripts.

Two pieces so far: **building** (checkout, harness patch, both variants) and **capturing**
(every pre-registered screen, under all six strategies, twice, under the run conditions). The
rule 3 flow drivers come next, then the freeze.

## The one rule while it is being written

**Only the commits the 2026-10-30 build check already built may be built**, until the runner
is frozen at a recorded commit. A runner debugged on the commits it measures is a runner tuned
on its own numbers, which is what pre-registration exists to prevent. `build.ts` enforces it:
any other commit is refused unless `--after-freeze` is passed, so lifting it shows up in the
command line.

| App | May be built now | Why |
|---|---|---|
| Actual | commit 10, `e82ea4d` | It is the pin. |
| react-admin | commit 10, `61acd3f` | The pin is not in the list, but commit 10 builds the same app: no build input changes between them (`CORPUS.md`). |

## Building

```bash
pnpm -r build                                                  # the plugin must be built first
node scripts/identity-spike/corpus/build.ts react-admin 10     # both variants
node scripts/identity-spike/corpus/build.ts actual 10 mangled  # one variant
```

`<commit>` is `CORPUS.md`'s index or a sha prefix. Clones and builds live in `$RASTRO_CORPUS`,
by default `~/rastro-corpus`. A path inside the rastro repo is refused, so no `git add` or pnpm
workspace glob can ever reach third-party code.

```
~/rastro-corpus/
  actual/  react-admin/              blobless clones, checked out at the commit being built
  logs/                              install logs
  builds/<app>/<nn>-<sha7>/<variant>/
    app/                             the built app, copied out of the clone
    build.json                       commit, variant, rastro commit (and whether it was dirty),
                                     Node version, duration, and whether stamps and marks
                                     reached the bundle
    vite.config.patched              the exact config it was built with
    build.log
```

## Capturing

```bash
node scripts/identity-spike/corpus/capture.ts react-admin 10   # needs the build first
```

Each build variant is served on localhost and loaded **twice**, each time in a fresh browser
context (its own storage, like a first visit). In each load the driver enters the app (Actual:
"Try the demo"; react-admin: sign in) and reaches every screen in `manifest.ts` by a real load.
Once the screen settles, it bundles `src/page.ts` with esbuild, evaluates it in the page, and
records every element matching `INTERACTIVE_SELECTOR`: its six fingerprints, and whether it is
visible. Visibility is recorded, never filtered on.

```
~/rastro-corpus/captures/<app>/<nn>-<sha7>/<variant>/
  load-1.json  load-2.json   every screen's elements, the workers checked, page errors
  rebuild-control.json       per screen: judged strategies that differed, reported ones that did
  capture.json               run conditions, browser, rastro commit (and whether dirty)
  load-N-<screen>.png        only when something failed, to look at
```

It prints counts and verdicts, never a fingerprint, so a capture can be checked without its
output being read.

**One annotated build serves all six strategies.** The smoke test builds once per strategy;
the corpus is built once per variant with stamps, files and marks all present, so
`fingerprint()` would read the attribute chain under every strategy. `src/strategies.ts` names
each strategy's walk explicitly instead, and `continuity/strategies.test.ts` proves it gives the
smoke test's per-build fingerprints on the base app and every scenario.

### The run conditions, and where each one is enforced

`CORPUS.md` lists them, with the 2026-11-09 amendment. In the code:

| Condition | Where |
|---|---|
| Seeded `Math.random`, seeded `crypto`, frozen clock | `conditions.ts`, one script for the page and every worker |
| …in workers | `serve.ts` prepends it to every script requested as a worker; `browser.ts` checks each worker that answers, and a worker without it fails the capture |
| Viewport, locale, UTC, user agent | `browser.ts` |
| Service workers | per app in `apps.ts`: bypassed for Actual (a precache), kept for react-admin (its backend) |
| A real load per screen | `apps.ts` (react-admin goes through `about:blank`, since a hash change is not a load) |
| The rebuild control | `rebuild.ts`: strict, positional, judged against the full screen list |

**Settling** is quiet DOM for 1.5 s with no response still open, timed out at 30 s and recorded.
Open responses come from the corpus server, not CDP: CDP reports a worker script's request
starting on the page and finishing on the worker, so a page would wait on it forever. Every CDP
command has a deadline, so a stuck target fails with an error instead of hanging the runner.

**The rebuild control** judges strategies 1 and 3 to 6. Strategy 2's stability across loads is
measured and reported beside it, never judged: it keeps element ids, and Actual's come from
React's `useId`, which numbers by mount order. See `CORPUS.md`'s amendment.

## What a build is

Two variants per commit, from `VALIDATION-PLAN.md` §3.2 rule 1:

| Variant | Measures | Patch |
|---|---|---|
| `as-shipped` | strategies 1, 2, 4, 5, 6, and 3 as shipped (reported beside, not instead) | the plugin, with `markComponents: true` |
| `mangled` | strategy 3's rule 1 numbers | the same, plus identifier mangling forced on |

The harness patch (`patch.ts`) is a set of exact text anchors in each app's Vite config. Every
anchor must match exactly once, or the patch throws. All anchors were checked at all ten
commits of both apps before this was written, by reading the configs, not by building.

- **Actual:** `babel-plugin-rastro` joins the existing `babel({ presets: [reactCompilerPreset()] })`
  call, whose `include` already scopes it to `packages/*/src`, Actual's own source. `root` is the
  repo root. `mangled` flips Actual's `mangle: false`.
- **react-admin demo:** a `@rolldown/plugin-babel` step (0.2.4, as `CORPUS.md` pins, resolved
  from this package) right after `react()`, scoped to `examples/demo/src` so library source the
  demo aliases in is not stamped. `root` is the demo directory. `mangled` turns off
  `keepNames: true`.

**No build cache can serve a stale stamp.** The plugin lives outside each app's repo, so no
app-side cache key sees it change. That is safe today for a reason in each app's own config,
not in the runner. Actual's `lage` caches `build`, but the patched step, `build:browser`, is
`cache: false` in `lage.config.js`, and the cached `^build` dependencies are other packages'
builds that the patch never reaches. React-admin's demo build goes through no cache. If either
ever changes, a rebuilt plugin could be silently ignored.

A build fails if the bundle carries no stamps or no marks. That only proves the patch reached
the bundle. It is not a measurement.

## Tests

`manifest.test.ts` holds `manifest.ts` to `CORPUS.md`: commits, pins, build commands and
screens. If the doc and the transcription ever disagree, CI fails without cloning anything.
`patch.test.ts` runs the patch on configs written in the test, shaped like the real ones at
their anchors.
