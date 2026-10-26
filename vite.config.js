import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://tomkaXX.github.io/Energy2035/
export default defineConfig({
  plugins: [react()],
  base: '/Energy2035/',
});
