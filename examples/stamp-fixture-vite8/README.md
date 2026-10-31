# stamp-fixture-vite8

[`examples/stamp-fixture`](../stamp-fixture)'s app, built with **Vite 8 and plugin-react v6**
and audited by the same shared suite.

It exists because plugin-react v6 dropped the `babel` option that v5 takes, and the v5 form
fails silently on v6: the build succeeds with nothing annotated. Babel now runs through
`@rolldown/plugin-babel`, configured exactly as `babel-plugin-rastro`'s README documents. A
regression in either the plugin or that documented config fails here.

It has no source of its own. `index.html` loads `../stamp-fixture/src/main.tsx`, and `root` is
pinned to that package so stamped paths are identical across the two builds. Add patterns, and
change what the audit expects, in `examples/stamp-fixture`. See that README for how the audit
works.
