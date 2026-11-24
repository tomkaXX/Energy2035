import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  // cache-buster for the data JSON (public/pfc2035), so a new deploy never shows stale data
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
});
