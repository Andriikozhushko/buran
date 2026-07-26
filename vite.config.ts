import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves the app from /<repo>/; local dev and other hosts use /.
  base: process.env.GH_PAGES ? '/buran/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    strictPort: true,
  },
  preview: {
    port: 5273,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
});
