import * as THREE from 'three';
import { DAM, TERRAIN, VEGETATION } from './layout';
import { mulberry32 } from './noise';

export type TreeKind = 'gum' | 'line';

export interface Tree {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  height: number;
  yaw: number;
  /** Index into the kind's canopy colour list. */
  shade: number;
}

/** True where a tree must not grow: the airfield clear zone and the dam and its bank. */
export function treeExcluded(x: number, z: number): boolean {
  const c = VEGETATION.clearZone;
  if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
  return Math.hypot(x - DAM.cx, z - DAM.cz) < DAM.radius + DAM.bankWidth + 5;
}

/**
 * Place every tree. Deterministic (seeded). Two kinds:
 *  - windbreak lines along paddock fences (dense rows of dark cypress/sugar-gum shapes);
 *  - river red / manna gums, in clusters and scattered singly across the paddocks.
 */
export function generateTrees(heightAt: (x: number, z: number) => number): Tree[] {
  const rng = mulberry32(VEGETATION.seed);
  const range = (r: readonly [number, number]) => r[0] + rng() * (r[1] - r[0]);
  const trees: Tree[] = [];
  const plant = (kind: TreeKind, x: number, z: number, heightRange: readonly [number, number]) => {
    if (treeExcluded(x, z)) return;
    const shades = kind === 'gum' ? VEGETATION.gumCanopy.length : VEGETATION.lineCanopy.length;
    trees.push({
      kind,
      x,
      y: heightAt(x, z),
      z,
      height: range(heightRange),
      yaw: rng() * Math.PI * 2,
      shade: Math.floor(rng() * shades),
    });
  };

  for (const [x0, z0, x1, z1] of VEGETATION.treeLines) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.floor(len / VEGETATION.treeLineSpacing);
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      const j = () => (rng() * 2 - 1) * VEGETATION.lineJitter;
      plant('line', x0 + (x1 - x0) * s + j(), z0 + (z1 - z0) * s + j(), VEGETATION.lineTreeHeight);
    }
  }

  const span = TERRAIN.size / 2 - VEGETATION.edgeMargin;
  const randomPoint = () => [(rng() * 2 - 1) * span, (rng() * 2 - 1) * span] as const;
  for (let c = 0; c < VEGETATION.gumClusters; c++) {
    const [cx, cz] = randomPoint();
    const count = Math.round(range(VEGETATION.gumsPerCluster));
    for (let k = 0; k < count; k++) {
      // Square root of a uniform number spreads trees evenly over the cluster's disc.
      const r = VEGETATION.gumClusterRadius * Math.sqrt(rng());
      const a = rng() * Math.PI * 2;
      plant('gum', cx + r * Math.cos(a), cz + r * Math.sin(a), VEGETATION.gumHeight);
    }
  }
  for (let k = 0; k < VEGETATION.scatteredGums; k++) {
    const [x, z] = randomPoint();
    plant('gum', x, z, VEGETATION.gumHeight);
  }
  return trees;
}

/**
 * Canopy lobes for one tree, as (local offset, radii) in units of tree height.
 * Gums: three broad, flattened clumps (the open, irregular eucalypt crown).
 * Windbreak trees: one tall narrow crown.
 */
const CANOPY: Record<TreeKind, Array<{ offset: [number, number, number]; radii: [number, number, number] }>> = {
  gum: [
    { offset: [0.12, 0.62, 0.05], radii: [0.22, 0.15, 0.22] },
    { offset: [-0.13, 0.72, -0.06], radii: [0.2, 0.14, 0.2] },
    { offset: [0.02, 0.86, 0.1], radii: [0.17, 0.12, 0.17] },
  ],
  line: [{ offset: [0, 0.55, 0], radii: [0.17, 0.45, 0.17] }],
};
const TRUNK = { gum: { height: 0.62, radius: 0.025 }, line: { height: 0.25, radius: 0.03 } };

/** Two instanced meshes (trunks and canopy lobes) for all trees: two draw calls in total. */
export function createVegetation(trees: Tree[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const trunkGeom = new THREE.CylinderGeometry(0.7, 1, 1, 5);
  trunkGeom.translate(0, 0.5, 0); // base at the ground
  const trunks = new THREE.InstancedMesh(trunkGeom, new THREE.MeshLambertMaterial(), trees.length);

  const lobeCount = trees.reduce((n, t) => n + CANOPY[t.kind].length, 0);
  const canopy = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    lobeCount,
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  const base = new THREE.Vector3();
  let lobe = 0;
  trees.forEach((tree, k) => {
    const h = tree.height;
    base.set(tree.x, tree.y, tree.z);
    q.setFromAxisAngle(up, tree.yaw);
    const tr = TRUNK[tree.kind];
    // Sink trunks 0.3 m so they never float on sloping ground.
    m.compose(pos.set(tree.x, tree.y - 0.3, tree.z), q, scale.set(tr.radius * h, tr.height * h, tr.radius * h));
    trunks.setMatrixAt(k, m);
    trunks.setColorAt(k, colour.setHex(tree.kind === 'gum' ? VEGETATION.gumTrunk : VEGETATION.lineTrunk));

    const shades = tree.kind === 'gum' ? VEGETATION.gumCanopy : VEGETATION.lineCanopy;
    for (const l of CANOPY[tree.kind]) {
      pos.set(l.offset[0] * h, l.offset[1] * h, l.offset[2] * h).applyQuaternion(q).add(base);
      m.compose(pos, q, scale.set(l.radii[0] * h, l.radii[1] * h, l.radii[2] * h));
      canopy.setMatrixAt(lobe, m);
      canopy.setColorAt(lobe, colour.setHex(shades[tree.shade]));
      lobe++;
    }
  });

  for (const mesh of [trunks, canopy]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  trunks.name = 'tree-trunks';
  canopy.name = 'tree-canopy';
  return group;
}
