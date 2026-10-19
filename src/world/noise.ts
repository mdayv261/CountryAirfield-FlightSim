// Deterministic pseudo-random numbers and smooth noise, so the world is identical every load.

/** Small fast seeded PRNG (mulberry32). Returns a function giving uniform values in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash an integer lattice point to [0, 1). */
function lattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Quintic fade: zero slope and curvature at the lattice points, so no visible creases. */
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Value noise: random heights on a unit grid, blended smoothly between grid points.
 * Returns values in [0, 1].
 */
export function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const u = fade(x - ix);
  const v = fade(z - iz);
  const a = lattice(ix, iz, seed);
  const b = lattice(ix + 1, iz, seed);
  const c = lattice(ix, iz + 1, seed);
  const d = lattice(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Fractal noise: several octaves of value noise, each half the wavelength of the last and
 * `gain` times its amplitude. Broad hills come from the first octave, small undulations
 * from the rest. Each octave's steepest slope scales with gain x 2, so a gain below 0.5
 * keeps the fine detail from making the ground steep. Normalised to [0, 1].
 */
export function fbm(x: number, z: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/** Hermite smoothstep: 0 below edge0, 1 above edge1, smooth S-curve between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
