import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The collector is the only backend (§19.1). Proxying keeps the dashboard same-origin,
    // so it needs no CORS and no endpoint configuration.
    proxy: {
      '/projects': { target: 'http://localhost:4318', changeOrigin: true },
    },
  },
});
