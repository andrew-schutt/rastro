// scripts/identity-spike/corpus/patch.test.ts
// The harness patch on configs written here, shaped like each app's at its anchors. No
// third-party code is read or run: the real configs are only ever patched by build.ts, by hand.
import { describe, expect, it } from 'vitest';
import { PATCH_MARKER, patchViteConfig, type PatchPaths } from './patch.ts';

const PATHS: PatchPaths = {
  rastroPlugin: '/r/packages/babel-plugin/dist/index.js',
  rolldownBabel: '/r/node_modules/@rolldown/plugin-babel/dist/index.mjs',
  pluginRoot: '/corpus/app',
};

// The lines the patch keys on, in the order and indentation the real configs use.
const ACTUAL = `
      build: {
        rolldownOptions: {
          output: {
            minify: {
              compress: true,
              mangle: false,
              codegen: true,
            },
          },
        },
      },
      babel({
        include: [reactCompilerInclude],
        presets: [reactCompilerPreset()],
      }),
`;

const REACT_ADMIN = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(async ({ mode }) => {
    return {
        plugins: [
            react(),
            visualizer({}),
        ],
        build: {
            rolldownOptions: {
                output: {
                    keepNames: true,
                },
            },
        },
    };
});
`;

const RASTRO = `["/r/packages/babel-plugin/dist/index.js", {"root":"/corpus/app","markComponents":true}]`;

describe('patchViteConfig — Actual', () => {
  it('adds the plugin, with marks, to the existing compiler call', () => {
    const out = patchViteConfig('actual', ACTUAL, 'as-shipped', PATHS);

    expect(out).toContain(`presets: [reactCompilerPreset()], ${PATCH_MARKER}`);
    expect(out).toContain(`plugins: [${RASTRO}],`);
    expect(out).toContain('include: [reactCompilerInclude],');
    expect(out).toContain('mangle: false,');
  });

  it('forces mangling on only for the mangled variant', () => {
    const out = patchViteConfig('actual', ACTUAL, 'mangled', PATHS);
    expect(out).toContain('mangle: true,');
    expect(out).not.toContain('mangle: false,');
  });

  it('refuses a config whose anchor has moved, rather than guessing', () => {
    const moved = ACTUAL.replace('presets: [reactCompilerPreset()],', 'presets: [compiler()],');
    expect(() => patchViteConfig('actual', moved, 'as-shipped', PATHS)).toThrow(/anchor not found/);
  });

  it('refuses a mangled build when there is no mangle: false to flip', () => {
    const noMangle = ACTUAL.replace('mangle: false,', '');
    expect(() => patchViteConfig('actual', noMangle, 'mangled', PATHS)).toThrow(/anchor not found/);
  });
});

describe('patchViteConfig — react-admin', () => {
  it('adds a Babel step scoped to examples/demo/src, right after react()', () => {
    const out = patchViteConfig('react-admin', REACT_ADMIN, 'as-shipped', PATHS);
    const lines = out.split('\n');
    const react = lines.findIndex((line) => line === '            react(),');

    expect(out).toContain(
      `import rastroCorpusBabel from "/r/node_modules/@rolldown/plugin-babel/dist/index.mjs"; ${PATCH_MARKER}`,
    );
    expect(lines[react + 1]).toBe(
      `            rastroCorpusBabel({ include: [/[\\\\/]examples[\\\\/]demo[\\\\/]src[\\\\/]/], plugins: [${RASTRO}] }),`,
    );
    expect(out).toContain('keepNames: true,');
  });

  it('writes an include that matches the demo source and nothing in packages/', () => {
    const out = patchViteConfig('react-admin', REACT_ADMIN, 'as-shipped', PATHS);
    const source = out.match(/include: \[(\/.*\/)\]/)?.[1] ?? '';
    const include = new RegExp(source.slice(1, -1));

    expect(include.test('/c/examples/demo/src/orders/OrderList.tsx')).toBe(true);
    expect(include.test('C:\\c\\examples\\demo\\src\\App.tsx')).toBe(true);
    expect(include.test('/c/packages/ra-ui-materialui/src/list/List.tsx')).toBe(false);
  });

  it('turns keepNames off only for the mangled variant', () => {
    const out = patchViteConfig('react-admin', REACT_ADMIN, 'mangled', PATHS);
    expect(out).toContain('keepNames: false,');
  });
});

describe('patchViteConfig', () => {
  it('refuses a config that is already patched', () => {
    const once = patchViteConfig('actual', ACTUAL, 'as-shipped', PATHS);
    expect(() => patchViteConfig('actual', once, 'as-shipped', PATHS)).toThrow(/already patched/);
  });

  it('refuses an anchor that occurs twice', () => {
    expect(() => patchViteConfig('actual', ACTUAL + ACTUAL, 'as-shipped', PATHS)).toThrow(
      /more than once/,
    );
  });
});
