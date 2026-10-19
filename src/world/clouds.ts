import * as THREE from 'three';
import { CLOUDS } from './layout';
import { mulberry32, valueNoise } from './noise';

/** One rounded lobe of a cloudlet: centre and semi-axes, m. */
export interface CloudLobe {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/**
 * Altocumulus: a sheet of small rounded cloudlets lined up in parallel rows (billows),
 * the rows lying across the upper wind. We lay a rotated grid of rows and slots, fill a
 * share of the slots (with large-scale noise so there are thicker patches and clear
 * gaps), and build each cloudlet from a few overlapping flattened lobes.
 * Each row has its own base height; every lobe stays between baseMin and topMax.
 */
export function generateCloudLobes(): CloudLobe[] {
  const rng = mulberry32(CLOUDS.seed);
  const lobes: CloudLobe[] = [];
  const half = CLOUDS.extent / 2;
  const az = (CLOUDS.rowAzimuthDeg * Math.PI) / 180;
  // Row direction (along a row) and across-row direction, in the ground plane. North = -Z.
  const along = { x: Math.sin(az), z: -Math.cos(az) };
  const across = { x: Math.cos(az), z: Math.sin(az) };
  // Tallest possible cloudlet: lobes reach up to 2.5 lobe-heights above the cloudlet base.
  const maxLobeRy = CLOUDS.radius[1] * CLOUDS.lobeSize[1] * CLOUDS.flatness;
  const baseRange = CLOUDS.topMax - 2.5 * maxLobeRy - CLOUDS.baseMin;
  // Rotated grid must cover the square's diagonal.
  const reach = half * Math.SQRT2;
  const rows = Math.ceil(reach / CLOUDS.rowSpacing);
  const slots = Math.ceil(reach / CLOUDS.cloudletSpacing);

  for (let r = -rows; r <= rows; r++) {
    const rowBase = CLOUDS.baseMin + rng() * baseRange;
    for (let s = -slots; s <= slots; s++) {
      const a = s * CLOUDS.cloudletSpacing + (rng() - 0.5) * CLOUDS.cloudletSpacing * 0.4;
      const c = r * CLOUDS.rowSpacing + (rng() - 0.5) * CLOUDS.rowSpacing * 0.1;
      const x = along.x * a + across.x * c;
      const z = along.z * a + across.z * c;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const patchiness = valueNoise(x / 4000, z / 4000, CLOUDS.seed);
      if (rng() > CLOUDS.coverage * (0.4 + 1.2 * patchiness)) continue;

      // A cloudlet is a clump of rounded lobes scattered over an ellipse (longer along the
      // row). All lobes sit on a common flat base; their tops vary, giving a lumpy dome.
      const R = CLOUDS.radius[0] + rng() * (CLOUDS.radius[1] - CLOUDS.radius[0]);
      for (let l = 0; l < CLOUDS.lobes; l++) {
        const ang = rng() * Math.PI * 2;
        const dist = Math.sqrt(rng());
        const da = Math.cos(ang) * dist * R * 0.6; // along the row
        const dc = Math.sin(ang) * dist * R * 0.3; // across the row
        const rl = R * (CLOUDS.lobeSize[0] + rng() * (CLOUDS.lobeSize[1] - CLOUDS.lobeSize[0]));
        const ry = rl * CLOUDS.flatness;
        // Lobes nearer the middle ride higher, so the clump is domed.
        const lift = 1 + 0.5 * (1 - dist) * rng();
        lobes.push({
          x: x + along.x * da + across.x * dc,
          y: rowBase + ry * lift,
          z: z + along.z * da + across.z * dc,
          rx: rl,
          ry,
          rz: rl * 0.85,
        });
      }
    }
  }
  return lobes;
}

/** The cloud layer as one instanced mesh of faceted, flattened spheres. */
export function createClouds(lobes = generateCloudLobes()): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({
      color: CLOUDS.colour,
      emissive: CLOUDS.emissive,
      flatShading: true,
      // Clouds lie far beyond the fog range; fogging them would hide them in haze.
      fog: false,
    }),
    lobes.length,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -(CLOUDS.rowAzimuthDeg * Math.PI) / 180,
  );
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  lobes.forEach((l, k) => mesh.setMatrixAt(k, m.compose(p.set(l.x, l.y, l.z), q, s.set(l.rz, l.ry, l.rx))));
  mesh.computeBoundingSphere();
  mesh.name = 'clouds';
  return mesh;
}
