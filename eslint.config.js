// Static analysis (CONTRIBUTING.md). Deliberately the stock recommended sets rather than a
// bespoke rule wall: the value is in the type-aware checks TypeScript's own flags cannot make
// — floating promises, misused promises, unnecessary conditions — not in style opinions.
// Formatting is not linted at all; see CONTRIBUTING.md for why there is no Prettier.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.tsbuildinfo', 'docs/**'],
  },

  js.configs.recommended,

  // Type-aware linting for everything TypeScript. The projects listed are the *.test.json
  // variants, because those are the configs that include the test files (see
  // tsconfig.test.json) — pointing at tsconfig.json would leave every test unlintable.
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          './packages/*/tsconfig.test.json',
          './apps/collector/tsconfig.test.json',
          './apps/dashboard/tsconfig.json',
          './examples/demo-app/tsconfig.json',
          './scripts/identity-spike/tsconfig.test.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript's own `noUnusedLocals` / `noUnusedParameters` already error on these
      // (tsconfig.base.json), and two tools reporting one problem is noise.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // The browser SDK and the two Vite apps.
  {
    files: [
      'packages/react/**/*.{ts,tsx}',
      'apps/dashboard/**/*.{ts,tsx}',
      'examples/**/*.{ts,tsx}',
      // The spike runs in a browser page against a rendered app, like the SDK it measures.
      'scripts/identity-spike/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: globals.browser },
  },

  // React hook dependency correctness. Worth more here than any style rule: the provider's
  // effect wiring is non-trivial, and a StrictMode remount silently killing the transport is
  // exactly the class of bug this catches (docs/NOTES.md).
  {
    files: ['packages/react/**/*.{ts,tsx}', 'apps/dashboard/**/*.{ts,tsx}', 'examples/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      'react-hooks/exhaustive-deps': 'error', // a warning nobody fails on is a warning nobody reads
    },
  },

  // Node-side code: the collector and the repo scripts.
  {
    files: ['apps/collector/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },

  // Plain JavaScript — this config file and the demo-recording script — belongs to no
  // TypeScript project, so the type-aware rules cannot run on it.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
