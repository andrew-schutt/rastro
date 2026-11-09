// scripts/identity-spike/corpus/patch.ts
// The harness patch: docs/CORPUS.md's "Harness patch" row, applied to each app's Vite config.
//
// Pure text edits with exact anchors. Every anchor must match exactly once, or the patch throws
// rather than guessing. A config that has moved under the anchor is a finding to record against
// CORPUS.md, and a silent near-miss would build an app that is not the one pre-registered. Both
// apps' anchors were checked at all ten commits before this was written.
import type { AppId, BuildVariant } from './manifest.ts';

export interface PatchPaths {
  /** Absolute path to `babel-plugin-rastro`'s built entry. */
  rastroPlugin: string;
  /** Absolute path to `@rolldown/plugin-babel`'s entry. Only react-admin needs it. */
  rolldownBabel: string;
  /** Absolute path the plugin's `root` resolves to: CORPUS.md's `root`. */
  pluginRoot: string;
}

/** Marks a patched config, so a run can prove from the file that its build was patched. */
export const PATCH_MARKER = '/* rastro corpus harness patch */';

function replaceOnce(text: string, anchor: string, replacement: string, where: string): string {
  const first = text.indexOf(anchor);
  if (first === -1) throw new Error(`${where}: anchor not found: ${JSON.stringify(anchor)}`);
  if (text.indexOf(anchor, first + anchor.length) !== -1) {
    throw new Error(`${where}: anchor found more than once: ${JSON.stringify(anchor)}`);
  }
  return text.slice(0, first) + replacement + text.slice(first + anchor.length);
}

/**
 * The plugin options both apps get. `markComponents` is on in the same scope as the stamps,
 * because strategy 6 reads the marks and the other strategies ignore them.
 */
function pluginEntry(paths: PatchPaths): string {
  return `[${JSON.stringify(paths.rastroPlugin)}, ${JSON.stringify({
    root: paths.pluginRoot,
    markComponents: true,
  })}]`;
}

/**
 * Actual: add the plugin to the existing `babel({ presets: [reactCompilerPreset()] })` call. Its
 * `include` already scopes Babel to `packages/*\/src`, which is exactly what rule 1 calls
 * Actual's own source. Babel runs plugins before presets, so rastro reads every component before
 * the compiler rewrites it, as the plugin README requires.
 *
 * `mangled` flips the `mangle: false` Actual ships with, which overrides the mangling
 * `minify: 'oxc'` would otherwise do.
 */
function patchActual(config: string, variant: BuildVariant, paths: PatchPaths): string {
  const where = 'actual vite.config.mts';
  let out = replaceOnce(
    config,
    'presets: [reactCompilerPreset()],',
    `presets: [reactCompilerPreset()], ${PATCH_MARKER}\n        plugins: [${pluginEntry(paths)}],`,
    where,
  );
  if (variant === 'mangled') out = replaceOnce(out, 'mangle: false,', 'mangle: true,', where);
  return out;
}

/**
 * React-admin's demo: it has no Babel step, so add one with `@rolldown/plugin-babel@0.2.4`,
 * right after `react()`. `include` scopes it to `examples/demo/src`, because Vite aliases every
 * react-admin package to its source, and an unscoped plugin would stamp the library as if the
 * app had written it. No React Compiler here: the demo does not use one.
 *
 * `mangled` turns off the `keepNames: true` the demo ships with. Vite's default minifier
 * mangles once names are not kept.
 */
function patchReactAdmin(config: string, variant: BuildVariant, paths: PatchPaths): string {
  const where = 'react-admin examples/demo/vite.config.ts';
  let out = replaceOnce(
    config,
    "import { defineConfig } from 'vite';",
    `import { defineConfig } from 'vite';\nimport rastroCorpusBabel from ${JSON.stringify(paths.rolldownBabel)}; ${PATCH_MARKER}`,
    where,
  );
  out = replaceOnce(
    out,
    '            react(),\n',
    '            react(),\n' +
      `            rastroCorpusBabel({ include: [/[\\\\/]examples[\\\\/]demo[\\\\/]src[\\\\/]/], plugins: [${pluginEntry(paths)}] }),\n`,
    where,
  );
  if (variant === 'mangled') out = replaceOnce(out, 'keepNames: true,', 'keepNames: false,', where);
  return out;
}

export function patchViteConfig(
  app: AppId,
  config: string,
  variant: BuildVariant,
  paths: PatchPaths,
): string {
  if (config.includes(PATCH_MARKER)) throw new Error(`${app}: the config is already patched`);
  return app === 'actual'
    ? patchActual(config, variant, paths)
    : patchReactAdmin(config, variant, paths);
}
