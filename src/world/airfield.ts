import * as THREE from 'three';
import { APRON, MARKERS, RUNWAYS, SURFACES, TAXIWAYS, type GroundRect } from './layout';
import { prismGeometry } from './meshBuilder';
import { mulberry32 } from './noise';

/**
 * A flat ground surface (runway, taxiway, apron) made of square patches, each with its own
 * colour. The patches give gravel a speckled look and grass its mowing stripes without
 * any textures. colourOf(i, j) receives the patch column (across X) and row (along Z).
 */
function createSurface(
  rect: GroundRect,
  name: string,
  colourOf: (i: number, j: number) => THREE.Color,
): THREE.Mesh {
  const nx = Math.max(1, Math.round(rect.sizeX / SURFACES.patch));
  const nz = Math.max(1, Math.round(rect.sizeZ / SURFACES.patch));
  const dx = rect.sizeX / nx;
  const dz = rect.sizeZ / nz;
  const x0 = rect.cx - rect.sizeX / 2;
  const z0 = rect.cz - rect.sizeZ / 2;
  const y = RUNWAYS.surfaceLift;
  const positions = new Float32Array(nx * nz * 18);
  const colours = new Float32Array(nx * nz * 18);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const xa = x0 + i * dx, xb = xa + dx;
      const za = z0 + j * dz, zb = za + dz;
      // Two triangles, anticlockwise seen from above (normal +Y).
      positions.set([xa, y, za, xa, y, zb, xb, y, za, xb, y, za, xa, y, zb, xb, y, zb], k * 18);
      const c = colourOf(i, j);
      for (let v = 0; v < 6; v++) colours.set([c.r, c.g, c.b], k * 18 + v * 3);
      k++;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, surfaceMaterial);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

const surfaceMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  // Pull the surfaces slightly towards the camera in the depth test so they never
  // flicker against the terrain underneath at long range.
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** Speckled colour: base colour with a small random brightness change per patch. */
function speckled(base: number, rng: () => number): () => THREE.Color {
  return () => new THREE.Color(base).multiplyScalar(1 + (rng() * 2 - 1) * SURFACES.jitter);
}

/** Positions of the edge cones: both edges of both runways, every MARKERS.coneSpacing m. */
export function conePositions(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = RUNWAYS.length / 2;
  const count = Math.floor(RUNWAYS.length / MARKERS.coneSpacing) + 1;
  for (const rw of [RUNWAYS.gravel, RUNWAYS.grass]) {
    for (const side of [-1, 1]) {
      const x = rw.cx + side * (rw.sizeX / 2 + MARKERS.coneOffset);
      for (let k = 0; k < count; k++) out.push(new THREE.Vector3(x, 0, -half + k * MARKERS.coneSpacing));
    }
  }
  return out;
}

/**
 * Threshold markers: a row of white gable markers lying across each end of each runway,
 * just inside the runway end, spread evenly across the width.
 */
export function gablePositions(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const half = RUNWAYS.length / 2;
  const inset = MARKERS.gable.width;
  const rows: Array<[GroundRect, number]> = [
    [RUNWAYS.gravel, MARKERS.gablesPerThreshold.gravel],
    [RUNWAYS.grass, MARKERS.gablesPerThreshold.grass],
  ];
  for (const [rw, n] of rows) {
    const usable = rw.sizeX - MARKERS.gable.length;
    for (const end of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const x = rw.cx - usable / 2 + (usable * k) / (n - 1);
        out.push(new THREE.Vector3(x, 0, end * (half - inset)));
      }
    }
  }
  return out;
}

/** Runways, taxiways, apron and their markers. */
export function createAirfield(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'airfield';
  const rng = mulberry32(SURFACES.seed);

  group.add(createSurface(RUNWAYS.gravel, 'runway-gravel', speckled(SURFACES.gravel, rng)));
  const light = new THREE.Color(SURFACES.grassLight);
  const dark = new THREE.Color(SURFACES.grassDark);
  group.add(
    createSurface(RUNWAYS.grass, 'runway-grass', (i) =>
      (i % 2 === 0 ? light : dark).clone().multiplyScalar(1 + (rng() * 2 - 1) * SURFACES.jitter * 0.5),
    ),
  );
  group.add(createSurface(APRON, 'apron', speckled(SURFACES.apron, rng)));
  TAXIWAYS.forEach((t, k) => group.add(createSurface(t, `taxiway-${k}`, speckled(SURFACES.gravel, rng))));

  const white = new THREE.MeshLambertMaterial({ color: MARKERS.colour });

  const { height, baseRadius, radialSegments } = MARKERS.cone;
  const coneGeom = new THREE.ConeGeometry(baseRadius, height, radialSegments);
  coneGeom.translate(0, height / 2, 0); // base on the ground
  const cones = conePositions();
  const coneMesh = new THREE.InstancedMesh(coneGeom, white, cones.length);
  const m = new THREE.Matrix4();
  cones.forEach((p, k) => coneMesh.setMatrixAt(k, m.makeTranslation(p.x, RUNWAYS.surfaceLift, p.z)));
  coneMesh.name = 'edge-cones';
  coneMesh.castShadow = true;
  coneMesh.computeBoundingSphere();
  group.add(coneMesh);

  const { length, width, height: gh } = MARKERS.gable;
  const gables = gablePositions();
  const gableMesh = new THREE.InstancedMesh(prismGeometry(length, width, gh), white, gables.length);
  gables.forEach((p, k) => gableMesh.setMatrixAt(k, m.makeTranslation(p.x, RUNWAYS.surfaceLift, p.z)));
  gableMesh.name = 'threshold-markers';
  gableMesh.castShadow = true;
  gableMesh.computeBoundingSphere();
  group.add(gableMesh);

  return group;
}
