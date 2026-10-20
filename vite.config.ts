import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Base path for the built page's script and assets. Relative ('./') suits GitHub Pages: the
  // game is a project site served from a folder, https://mdayv261.github.io/CountryAirfield-FlightSim/,
  // and the same build also works at a site root, from npm run preview, or copied to any folder
  // on a static server. An absolute base ('/') would break everything except the root.
  base: './',
  // Three.js alone is ~540 kB minified; that's expected for a single-page sim.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
