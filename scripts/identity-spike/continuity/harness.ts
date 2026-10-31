// scripts/identity-spike/continuity/harness.ts
// Compile a variant of the base app in memory and render it, under one identity strategy.
//
// A variant is a map of repo-relative path → source. It is compiled with Babel: rastro's
// plugin first (for the attribute strategies), then TypeScript and the automatic JSX runtime,
// then CommonJS, so a ten-line loader can link it. Babel and not a bundler, because esbuild's
// JS API fails inside jsdom test environments, and because Babel leaves every function its
// written name, which is what the fiber walk reads (a dev build, in effect).
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, posix } from 'node:path';
import { transformSync, type PluginItem } from '@babel/core';
import rastroPlugin from 'babel-plugin-rastro';
import { act, type ComponentType } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { fingerprint, resetAnnotationProbe } from 'rastro-core';
import { snapshotDocument, type SnapshotEntry } from '../src/continuity.js';

/**
 * The identity strategies that exist in rastro-core today. §3.2 rule 1 names six; the CSS
 * selector path and the marked fiber walk join this list when they are built.
 */
export const STRATEGIES = ['attribute+file', 'attribute', 'fiber'] as const;
export type Strategy = (typeof STRATEGIES)[number];

export type Files = ReadonlyMap<string, string>;

/** The attribute every interactive element in the base app carries: its ground-truth id. */
export const ORACLE_ATTRIBUTE = 'data-el';

const APP_ROOT = join(import.meta.dirname, 'app');
/** Where compiled files pretend to live. Stamped paths are relative to it: `src/App.tsx`. */
const VIRTUAL_ROOT = '/app';

/** The base app's sources, keyed `src/...`. */
export function loadBaseApp(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(APP_ROOT, dir), { withFileTypes: true })) {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(path, readFileSync(join(APP_ROOT, path), 'utf8'));
    }
  };
  walk('src');
  return files;
}

// Babel resolves plugins named by string against `cwd`, which is virtual here, so they are
// passed as loaded objects instead.
const require = createRequire(import.meta.url);
const jsxPlugin = require('@babel/plugin-transform-react-jsx') as PluginItem;
const commonjsPlugin = require('@babel/plugin-transform-modules-commonjs') as PluginItem;
const typescriptPreset = require('@babel/preset-typescript') as PluginItem;

function compile(path: string, source: string, strategy: Strategy): string {
  const rastro: PluginItem[] =
    strategy === 'fiber'
      ? []
      : [[rastroPlugin, { root: VIRTUAL_ROOT, includeSourceFile: strategy === 'attribute+file' }]];
  const result = transformSync(source, {
    filename: posix.join(VIRTUAL_ROOT, path),
    cwd: VIRTUAL_ROOT,
    babelrc: false,
    configFile: false,
    plugins: [...rastro, [jsxPlugin, { runtime: 'automatic' }], commonjsPlugin],
    presets: [[typescriptPreset, { isTSX: true, allExtensions: true }]],
  });
  if (result?.code == null) throw new Error(`Babel produced nothing for ${path}`);
  return result.code;
}

/** `./NavBar.js` from `src/App.tsx` → `src/NavBar.tsx`, the way TypeScript's NodeNext does. */
function resolveImport(files: Files, from: string, specifier: string): string {
  const base = posix.join(posix.dirname(from), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.tsx`, `${base}.ts`]) if (files.has(candidate)) return candidate;
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

const EXTERNALS: Record<string, unknown> = { react: React, 'react/jsx-runtime': jsxRuntime };

/** Compile and link a variant, returning `src/App.tsx`'s `App`. */
export function loadApp(files: Files, strategy: Strategy): ComponentType {
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  const load = (path: string): Record<string, unknown> => {
    const cached = modules.get(path);
    if (cached !== undefined) return cached.exports;
    const module = { exports: {} as Record<string, unknown> };
    modules.set(path, module);
    const source = files.get(path);
    if (source === undefined) throw new Error(`no such file: ${path}`);
    const requireIn = (specifier: string): unknown =>
      specifier.startsWith('.') ? load(resolveImport(files, path, specifier)) : EXTERNALS[specifier];
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the loader's whole job
    const run = new Function('require', 'module', 'exports', compile(path, source, strategy)) as (
      require: (specifier: string) => unknown,
      module: { exports: Record<string, unknown> },
      exports: Record<string, unknown>,
    ) => void;
    run(requireIn, module, module.exports);
    return module.exports;
  };
  const app = load('src/App.tsx').App;
  if (typeof app !== 'function') throw new Error('src/App.tsx does not export App');
  return app as ComponentType;
}

/** Render a variant under one strategy and snapshot every interactive element. */
export function snapshotVariant(files: Files, strategy: Strategy): SnapshotEntry[] {
  const App = loadApp(files, strategy);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(React.createElement(App)));
    // The annotation probe is cached per document, and this document hosts every strategy in
    // turn. Without the reset, the fiber renders would silently reuse the attribute verdict.
    resetAnnotationProbe(document);
    return snapshotDocument(container, (element) => fingerprint(element), { oracleAttribute: ORACLE_ATTRIBUTE });
  } finally {
    act(() => root.unmount());
    container.remove();
    resetAnnotationProbe(document);
  }
}
