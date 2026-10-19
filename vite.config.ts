import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the production build runs from any folder.
  base: './',
  // Three.js alone is ~540 kB minified; that's expected for a single-page sim.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
