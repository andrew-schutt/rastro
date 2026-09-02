import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // The Babel plugin runs in dev AND in the production build, deliberately. If it only ran on
  // `build`, dev would derive identity from the React fiber tree and production from build-time
  // attributes — two identity schemes for one app, and no dev session's data comparable with
  // production's. On in both, an app has exactly one scheme.
  plugins: [react({ babel: { plugins: ['babel-plugin-rastro'] } })],
  // `vite preview` serves the production build, and its proxy config is separate from the dev
  // server's. Without this the minified bundle cannot reach the collector, and the prod build
  // is exactly the one worth verifying (docs/DESIGN.md §4.3).
  preview: {
    port: 5175,
    proxy: {
      '/v1/logs': { target: 'http://localhost:4318', changeOrigin: true },
    },
  },
  server: {
    port: 5174,
    // Proxy the OTLP endpoint so the SDK can post to a same-origin `/v1/logs`, exactly as the
    // README's default `otlpExporter({ endpoint: "/v1/logs" })` does.
    proxy: {
      '/v1/logs': { target: 'http://localhost:4318', changeOrigin: true },
    },
  },
});
