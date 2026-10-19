import * as THREE from 'three';

/**
 * Where a ray first meets the ground, or null within maxDist. Marches along the ray in
 * fixed steps until it drops below the ground, then bisects that step to ~1 mm.
 * Works directly on the height function, so no mesh raycasting is needed.
 */
export function rayGroundHit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  heightAt: (x: number, z: number) => number,
  maxDist = 20000,
  step = 2,
): THREE.Vector3 | null {
  const p = new THREE.Vector3();
  const above = (t: number) => {
    p.copy(origin).addScaledVector(dir, t);
    return p.y - heightAt(p.x, p.z);
  };
  if (above(0) < 0) return null;
  let t0 = 0;
  for (let t = step; t <= maxDist; t += step) {
    if (above(t) <= 0) {
      let lo = t0;
      let hi = t;
      while (hi - lo > 1e-3) {
        const mid = (lo + hi) / 2;
        if (above(mid) > 0) lo = mid;
        else hi = mid;
      }
      above(hi);
      return p.clone();
    }
    t0 = t;
  }
  return null;
}

/**
 * Two-point ground measuring tool: each press drops a point where the screen centre meets
 * the ground; with two points it reports the horizontal distance. Red posts mark the points.
 */
export class MeasureTool {
  readonly points: THREE.Vector3[] = [];
  readonly object = new THREE.Group();
  private readonly marker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 3, 6).translate(0, 1.5, 0),
    new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  );

  constructor(
    private readonly camera: THREE.Camera,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.object.name = 'measure';
  }

  /** Drop a point at the screen centre. A third press starts a new measurement. */
  mark(): THREE.Vector3 | null {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const hit = rayGroundHit(this.camera.position, dir, this.heightAt);
    if (!hit) return null;
    if (this.points.length === 2) {
      this.points.length = 0;
      this.object.clear();
    }
    this.points.push(hit);
    const m = this.marker.clone();
    m.position.copy(hit);
    this.object.add(m);
    return hit;
  }

  /** Horizontal distance between the two points, m, or null. */
  get distance(): number | null {
    if (this.points.length < 2) return null;
    const [a, b] = this.points;
    return Math.hypot(b.x - a.x, b.z - a.z);
  }
}
