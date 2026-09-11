import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  // Relative paths so the same build works on GitHub Pages
  // (elvisrepo.github.io/three/), Netlify, itch.io, etc.
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
  },
});
