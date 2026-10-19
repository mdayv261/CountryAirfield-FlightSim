import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DAM, TERRAIN } from './layout';
import { fbm, mulberry32, smoothstep, valueNoise } from './noise';

/**
 * Distance from (x, z) to the nearest point of an axis-aligned rectangle (0 inside it).
 * Used to fade hills in with distance from the airfield.
 */
function distanceOutsideRect(
  x: number,
  z: number,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Cross-section of the farm dam as a function of distance r from its centre.
 * A bowl-shaped basin (parabola, deepest at the centre) inside a ring-shaped earth bank
 * with a smooth cos² profile. Zero beyond the outer toe of the bank.
 */
export function damProfile(r: number): number {
  const { radius, depth, bankHeight, bankWidth } = DAM;
  const basin = r < radius ? -depth * (1 - (r / radius) ** 2) : 0;
  const bankCentre = radius + bankWidth * 0.3;
  const t = (r - bankCentre) / (bankWidth / 2);
  const bank = Math.abs(t) < 1 ? bankHeight * Math.cos((t * Math.PI) / 2) ** 2 : 0;
  return basin + bank;
}

/**
 * Analytic ground height (m above field level) at world (x, z).
 *
 * Built as rolling noise hills multiplied by three "masks" that each run 0..1:
 *  - airfield mask: 0 in the flat airfield zone, rising smoothly to 1 over TERRAIN.flatBlend m,
 *    so the strip, apron and approaches are dead flat and the hills grow away from them;
 *  - dam mask: levels the ground where the dam is built;
 *  - edge mask: fades heights to 0 at the map edge so the terrain meets the flat outer skirt.
 * Hills never exceed TERRAIN.hillMax (the smoothstep caps at 1).
 */
export function terrainHeight(x: number, z: number): number {
  const half = TERRAIN.size / 2;
  const n = fbm(x / TERRAIN.baseWavelength + 17.3, z / TERRAIN.baseWavelength - 4.1, TERRAIN.octaves, TERRAIN.seed, TERRAIN.gain);
  const hills = TERRAIN.hillMax * smoothstep(TERRAIN.hillLow, TERRAIN.hillHigh, n);

  const airfieldMask = smoothstep(0, TERRAIN.flatBlend, distanceOutsideRect(x, z, TERRAIN.flatZone));
  const edgeMask = smoothstep(0, TERRAIN.edgeFade, half - Math.max(Math.abs(x), Math.abs(z)));
  const rDam = Math.hypot(x - DAM.cx, z - DAM.cz);
  const damMask = smoothstep(DAM.radius + DAM.bankWidth, DAM.levelRadius, rDam);

  return hills * airfieldMask * edgeMask * damMask + damProfile(rDam);
}

/**
 * Terrain heights sampled on a regular grid, with the exact same triangle layout as the
 * rendered mesh. heightAt() therefore returns the height of the surface you can see,
 * which the Stage 3 landing-gear contact model will use.
 */
export class Heightfield {
  /** Grid points per side. */
  readonly n: number;
  readonly cell: number;
  readonly origin: number;
  readonly heights: Float32Array;

  constructor(size = TERRAIN.size, cell = TERRAIN.cell, fn = terrainHeight) {
    this.cell = cell;
    this.n = Math.round(size / cell) + 1;
    this.origin = -size / 2;
    this.heights = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        this.heights[j * this.n + i] = fn(this.origin + i * cell, this.origin + j * cell);
      }
    }
  }

  /** Height of grid point i (along X), j (along Z). */
  node(i: number, j: number): number {
    return this.heights[j * this.n + i];
  }

  /**
   * Height of the rendered surface at (x, z). Each grid cell is two triangles split along
   * the diagonal from its north-east to south-west corner; we interpolate linearly on
   * whichever triangle contains the point. Outside the grid the ground is flat at 0.
   */
  heightAt(x: number, z: number): number {
    const gx = (x - this.origin) / this.cell;
    const gz = (z - this.origin) / this.cell;
    if (gx < 0 || gz < 0 || gx > this.n - 1 || gz > this.n - 1) return 0;
    const i = Math.min(Math.floor(gx), this.n - 2);
    const j = Math.min(Math.floor(gz), this.n - 2);
    const fx = gx - i;
    const fz = gz - j;
    const h00 = this.node(i, j);
    const h10 = this.node(i + 1, j);
    const h01 = this.node(i, j + 1);
    const h11 = this.node(i + 1, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
}

/** Ground colour at (x, z): paddock patchwork, mown airfield grass, bare earth on the dam bank. */
function groundColour(x: number, z: number, h: number, rng: () => number, out: THREE.Color): THREE.Color {
  const rDam = Math.hypot(x - DAM.cx, z - DAM.cz);
  const f = TERRAIN.mownZone;
  const mown = x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ;

  if (rDam < DAM.radius + DAM.bankWidth && h > DAM.waterLevel) {
    out.setHex(TERRAIN.bankEarth);
  } else if (mown) {
    out.setHex(TERRAIN.airfieldGrass);
  } else {
    // Paddock blocks: hash the block index to choose a colour from the palette.
    const px = Math.floor(x / TERRAIN.paddockSize);
    const pz = Math.floor(z / TERRAIN.paddockSize);
    const pick = Math.floor(valueNoise(px + 0.5, pz + 0.5, TERRAIN.seed + 9) * TERRAIN.paddockColours.length);
    out.setHex(TERRAIN.paddockColours[Math.min(pick, TERRAIN.paddockColours.length - 1)]);
  }
  out.multiplyScalar(1 + (rng() * 2 - 1) * TERRAIN.colourJitter);
  return out;
}

/** Build the visible terrain mesh from a heightfield (one draw call, flat-shaded low-poly). */
export function createTerrainMesh(field: Heightfield): THREE.Mesh {
  const { n, cell, origin } = field;
  const positions = new Float32Array(n * n * 3);
  const colours = new Float32Array(n * n * 3);
  const rng = mulberry32(TERRAIN.seed);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = origin + i * cell;
      const z = origin + j * cell;
      const h = field.heights[k];
      positions.set([x, h, z], k * 3);
      groundColour(x, z, h, rng, c);
      colours.set([c.r, c.g, c.b], k * 3);
    }
  }

  // Two triangles per cell, wound anticlockwise seen from above so normals point up.
  // The split diagonal must match Heightfield.heightAt().
  const index = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const p00 = j * n + i;
      const p10 = p00 + 1;
      const p01 = p00 + n;
      const p11 = p01 + 1;
      index.set([p00, p01, p10, p10, p01, p11], p);
      p += 6;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geom.setIndex(new THREE.BufferAttribute(index, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();

  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  );
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Flat ground from the heightmap edge out to the horizon (a square frame of four strips),
 * so there is no visible world edge when flying high. Terrain heights fade to 0 at the edge,
 * so the join is seamless.
 */
export function createSkirt(): THREE.Mesh {
  const half = TERRAIN.size / 2;
  const outer = TERRAIN.skirtSize / 2;
  const band = outer - half;
  const strips: Array<[number, number, number, number]> = [
    // cx, cz, sizeX, sizeZ
    [0, -(half + band / 2), 2 * outer, band],
    [0, half + band / 2, 2 * outer, band],
    [-(half + band / 2), 0, band, 2 * half],
    [half + band / 2, 0, band, 2 * half],
  ];
  const geoms = strips.map(([cx, cz, sx, sz]) => {
    const g = new THREE.PlaneGeometry(sx, sz);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, 0, cz);
    return g;
  });
  const merged = mergeGeometries(geoms)!;
  const colour = new THREE.Color(TERRAIN.paddockColours[0]).lerp(new THREE.Color(TERRAIN.paddockColours[3]), 0.3);
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: colour }));
  mesh.name = 'skirt';
  return mesh;
}

/** The dam's water surface: a disc at water level, its rim hidden inside the bank. */
export function createDamWater(): THREE.Mesh {
  const g = new THREE.CircleGeometry(DAM.radius + DAM.bankWidth * 0.3, 40);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshPhongMaterial({ color: DAM.waterColour, shininess: 80, specular: 0x667788 }),
  );
  mesh.position.set(DAM.cx, DAM.waterLevel, DAM.cz);
  mesh.name = 'dam-water';
  mesh.receiveShadow = true;
  return mesh;
}
