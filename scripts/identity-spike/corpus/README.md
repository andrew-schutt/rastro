# corpus/ — the §3.2 corpus runner

Builds and (later) drives the two corpus apps pre-registered in
[`docs/CORPUS.md`](../../../docs/CORPUS.md). **Run by hand, locally, never in CI.** These are
third-party apps with their own install scripts.

This is the runner's first piece: checkout, harness patch and build. The browser driver and
the rule 3 flow drivers come next, each in its own PR.

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
