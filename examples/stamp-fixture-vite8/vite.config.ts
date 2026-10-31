import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import auditSitePlugin from '../stamp-fixture/audit/site-plugin.ts';

// The app is examples/stamp-fixture's src/, built here with Vite 8 and plugin-react v6, which
// dropped v5's `babel` option. Pinning `root` to that package keeps stamped paths identical
// across the two builds (`src/patterns.tsx`), so one shared audit suite judges both.
const root = join(import.meta.dirname, '../stamp-fixture');

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'misordered'
      ? // WRONG on purpose: the compiler listed as a plugin ahead of rastro. The audit's canary.
        babel({
          plugins: [[auditSitePlugin, { root }], 'babel-plugin-react-compiler', ['babel-plugin-rastro', { root }]],
        })
      : // What the plugin README documents for plugin-react v6. Babel runs plugins before
        // presets, so rastro reads every owner before the compiler preset hoists anything.
        babel({
          plugins: [[auditSitePlugin, { root }], ['babel-plugin-rastro', { root }]],
          presets: [reactCompilerPreset()],
        }),
  ],
  build: {
    outDir: mode === 'misordered' ? 'dist-misordered' : 'dist',
  },
}));
