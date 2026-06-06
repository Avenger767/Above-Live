import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Above Live — Vite config.
// Proxies /api and /ws to the backend so the frontend can be opened directly
// at the Vite dev URL with no CORS or hardcoded host fuss. Override the backend
// target with VITE_BACKEND if it runs elsewhere.
const backend = process.env.VITE_BACKEND || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on all interfaces (handy on the Pi / LAN)
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/ws': { target: backend, ws: true, changeOrigin: true },
    },
  },
});
