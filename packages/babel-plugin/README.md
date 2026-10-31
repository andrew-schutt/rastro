# babel-plugin-rastro

Build-time component annotation for [Rastro](https://github.com/andrew-schutt/rastro) —
**stable element identity that survives minification.**

> ⚠️ **Status: pre-alpha.** Part of a project built in the open. APIs will change.

## Why this exists

Rastro identifies elements by their React component ancestry. Derived at runtime, that
ancestry comes from `fn.name` on React's internal fiber tree — and a production build renames
`SaveButton` to `t`. Minifiers reuse those short names per module, so unrelated elements
collapse into a single identity, silently, with no error. Every number computed downstream is
then wrong in a way nothing announces.

No runtime trick fixes it. React DevTools reads the same internals, stack traces are minified
too, and source maps are not available in the browser at runtime. Names have to be captured
**before the minifier runs**.

This plugin captures them, as string literals a minifier cannot touch:

```jsx
// you write
function SettingsForm() {
  return <form><input type="email" /></form>;
}

// the plugin emits
function SettingsForm() {
  return (
    <form data-rastro-component="SettingsForm" data-rastro-source-file="src/SettingsForm.tsx">
      <input type="email" data-rastro-component="SettingsForm" data-rastro-source-file="src/SettingsForm.tsx" />
    </form>
  );
}
```

The SDK then reconstructs the ancestry by walking the **DOM** rather than the fiber tree.
Nested components each stamp their own name, so nesting reproduces the chain:

```
<form   data-rastro-component="SettingsForm">
  <button data-rastro-component="SaveButton">   →   SettingsForm>SaveButton
```

`data-rastro-source-file` is the rename-proof half: renaming a component changes its name but
does not move the file, so source location survives exactly the refactor that mints a new
identity everywhere else.

## Install

```bash
pnpm add -D babel-plugin-rastro
```

### Vite

How Babel plugins are passed depends on the major version of `@vitejs/plugin-react`, and **the
wrong form fails silently**: the build succeeds and nothing is annotated.

**plugin-react v6 (Vite 8)** dropped the `babel` option. Babel runs through
[`@rolldown/plugin-babel`](https://npmx.dev/package/@rolldown/plugin-babel) instead:

```bash
pnpm add -D @rolldown/plugin-babel @babel/core
```

```ts
import babel from '@rolldown/plugin-babel';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    babel({ plugins: [['babel-plugin-rastro', { root: import.meta.dirname }]] }),
  ],
});
```

Its defaults already cover your own `.jsx`/`.tsx` and skip `node_modules`. With the React
Compiler, add `presets: [reactCompilerPreset()]` (exported by `@vitejs/plugin-react`) to the
same `babel()` call. Presets run after plugins, which is the order this plugin needs (below).

**plugin-react v5 (Vite 7 and earlier)** runs Babel itself and takes the plugin directly:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react({ babel: { plugins: [['babel-plugin-rastro', { root: import.meta.dirname }]] } })],
});
```

On v6 this second form type-errors and then builds with nothing annotated. Both forms are
built and audited in CI by `examples/stamp-fixture` (v5) and `examples/stamp-fixture-vite8` (v6).

### Babel directly

```json
{ "plugins": ["babel-plugin-rastro"] }
```

### With the React Compiler

**List this plugin before the compiler**, or pass the compiler as a preset (Babel runs plugins
before presets). The compiler rewrites every function as soon as it enters a file, hoisting
`.map()` callbacks out of their component; this plugin reads each element's owner before that
happens. Listed after the compiler, the JSX inside those callbacks is left unannotated, with no
error.

```json
{ "plugins": ["babel-plugin-rastro", "babel-plugin-react-compiler"] }
```

⚠ **This contradicts React's own instruction**, which is that the compiler
["must run first"](https://react.dev/learn/react-compiler/installation) so it sees the original
source. This plugin is an exception because it only appends string-literal attributes to host
elements, which changes nothing the compiler analyses. That was checked, not assumed: Actual
Budget's production build memoizes the same 638 components (1,026 cache sites) with this plugin
running first as without it. Anything that does more than add attributes should still follow
React's rule.

**Next.js is not supported yet.** Next compiles with SWC, not Babel; enabling a Babel config
opts the whole app out of SWC and costs build performance. An SWC port is the open question —
see [`docs/DESIGN.md`](https://github.com/andrew-schutt/rastro/blob/main/docs/DESIGN.md) §4.3.

## Options

| Option | Default | Meaning |
|---|---|---|
| `componentAttribute` | `data-rastro-component` | Attribute carrying the owning component's name |
| `sourceFileAttribute` | `data-rastro-source-file` | Attribute carrying the defining file |
| `includeSourceFile` | `true` | Emit the source-file attribute at all |

## What it does and does not annotate

- **Host elements only** (`div`, `button`) — never component elements (`<SaveButton />`).
  An attribute there becomes a *prop*, and a component that does not spread props onto a DOM
  node would silently drop it. Host-only is sufficient anyway: every component that renders
  anything eventually renders a host element.
- **`.jsx` / `.tsx` only.**
- **The nearest capitalised enclosing component.** Lowercase helpers that return JSX are
  transparent, so their markup is attributed to the component that contains them.
  `memo(...)` and `forwardRef(...)` wrappers resolve to the binding name.
- **Author-supplied attributes always win**, and a double transform adds nothing.
- **Only your own source.** Components from `node_modules` ship pre-built and are never
  annotated — a real difference from the runtime fiber walk, which sees them.

## License

MIT
