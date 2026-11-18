// scripts/identity-spike/corpus/patch.test.ts
// The harness patch on configs written here, shaped like each app's at its anchors. No
// third-party code is read or run: the real configs are only ever patched by build.ts, by hand.
import { describe, expect, it } from 'vitest';
import { PATCH_MARKER, patchViteConfig, type PatchPaths } from './patch.ts';

const PATHS: PatchPaths = {
  rastroPlugin: '/r/packages/babel-plugin/dist/index.js',
  markPlugin: '/corpus/builds/mark-plugin.cjs',
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

const RASTRO = `"/r/packages/babel-plugin/dist/index.js", ["/corpus/builds/mark-plugin.cjs", {"root":"/corpus/app"}]`;

describe('patchViteConfig — Actual', () => {
  it('adds the plugin, then the marks, to the existing compiler call', () => {
    const out = patchViteConfig('actual', ACTUAL, PATHS);

    expect(out).toContain(`presets: [reactCompilerPreset()], ${PATCH_MARKER}`);
    expect(out).toContain(`plugins: [${RASTRO}],`);
    expect(out).toContain('include: [reactCompilerInclude],');
    expect(out).toContain('mangle: false,');
  });

  it('refuses a config whose anchor has moved, rather than guessing', () => {
    const moved = ACTUAL.replace('presets: [reactCompilerPreset()],', 'presets: [compiler()],');
    expect(() => patchViteConfig('actual', moved, PATHS)).toThrow(/anchor not found/);
  });
});

describe('patchViteConfig — react-admin', () => {
  it('adds a Babel step scoped to examples/demo/src, right after react()', () => {
    const out = patchViteConfig('react-admin', REACT_ADMIN, PATHS);
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
    const out = patchViteConfig('react-admin', REACT_ADMIN, PATHS);
    const source = out.match(/include: \[(\/.*\/)\]/)?.[1] ?? '';
    const include = new RegExp(source.slice(1, -1));

    expect(include.test('/c/examples/demo/src/orders/OrderList.tsx')).toBe(true);
    expect(include.test('C:\\c\\examples\\demo\\src\\App.tsx')).toBe(true);
    expect(include.test('/c/packages/ra-ui-materialui/src/list/List.tsx')).toBe(false);
  });
});

describe('patchViteConfig', () => {
  it('refuses a config that is already patched', () => {
    const once = patchViteConfig('actual', ACTUAL, PATHS);
    expect(() => patchViteConfig('actual', once, PATHS)).toThrow(/already patched/);
  });

  it('refuses an anchor that occurs twice', () => {
    expect(() => patchViteConfig('actual', ACTUAL + ACTUAL, PATHS)).toThrow(
      /more than once/,
    );
  });
});
