import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import auditSitePlugin from './audit/site-plugin.ts';

const root = import.meta.dirname;
const audit = [auditSitePlugin, { root }];
const rastro = ['babel-plugin-rastro', { root }];

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      babel: {
        // The audit's site plugin always runs first, so it records each element's owner from
        // the source as written (audit/site-plugin.ts). After it, the order the plugin README
        // documents: rastro, then the React Compiler.
        //
        // `--mode misordered` builds the WRONG order on purpose, into its own directory. The
        // audit must find misses there; if it ever finds none, the audit has stopped being
        // able to see the failure it exists for, and its test says so.
        plugins:
          mode === 'misordered'
            ? [audit, 'babel-plugin-react-compiler', rastro]
            : [audit, rastro, 'babel-plugin-react-compiler'],
      },
    }),
  ],
  build: {
    outDir: mode === 'misordered' ? 'dist-misordered' : 'dist',
  },
}));
