import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Base path for the built page's script and assets. Relative ('./') suits GitHub Pages: the
  // user site https://mdayv261.github.io/ serves dist/ at the root, and the same build would
  // also work under a project-site subpath (/repo-name/), from npm run preview, or copied to
  // any folder on a static server. An absolute base ('/') would break the subpath cases.
  base: './',
  // Three.js alone is ~540 kB minified; that's expected for a single-page sim.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
