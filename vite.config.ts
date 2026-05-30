import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
  },
});
