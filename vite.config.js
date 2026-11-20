import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from the custom domain root: https://pfc2035.ch/  (GitHub Pages + custom domain).
// For the old project URL https://tomkaXX.github.io/Energy2035/ build with:  VITE_BASE=/Energy2035/ npm run build
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
});
