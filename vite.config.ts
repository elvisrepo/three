import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2020',
  },
});
