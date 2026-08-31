import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Proxy the OTLP endpoint so the SDK can post to a same-origin `/v1/logs`, exactly as the
    // README's default `otlpExporter({ endpoint: "/v1/logs" })` does.
    proxy: {
      '/v1/logs': { target: 'http://localhost:4318', changeOrigin: true },
    },
  },
});
