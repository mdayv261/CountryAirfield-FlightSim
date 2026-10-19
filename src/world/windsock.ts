import * as THREE from 'three';
import { WINDSOCK } from './layout';
import { smoothstep } from './noise';
import type { WindVector } from '../physics/windVector';

export interface WindsockPose {
  /** Rotation about +Y that points the sock's local +X axis downwind, rad. */
  yaw: number;
  /** Droop of each segment below horizontal, mouth first, rad (0 = flying straight out). */
  droop: number[];
}

/**
 * Shape of the windsock for a given wind, without flutter.
 *
 * A standard sock has five bands and each band fills at about 3 kt, so it flies fully
 * horizontal at 15 kt. We model that directly: with f = speed / 15 kt (capped at 1),
 * segment i lifts from hanging (90°) to horizontal (0°) as f x 5 runs from i to i+1.
 * So at 6 kt the first two bands stand out and the rest hang, as pilots read it.
 */
export function windsockPose(wind: WindVector): WindsockPose {
  const speed = Math.hypot(wind.x, wind.z);
  const f = Math.min(speed / WINDSOCK.fullSpeedMps, 1);
  const n = WINDSOCK.segments;
  const droop = Array.from({ length: n }, (_, i) => (Math.PI / 2) * (1 - smoothstep(0, 1, f * n - i)));
  // three.js rotation.y = θ turns local +X to world (cos θ, 0, -sin θ).
  const yaw = speed > 1e-6 ? Math.atan2(-wind.z, wind.x) : 0;
  return { yaw, droop };
}

/** Windsock on a mast. Call update() each frame with the current wind. */
export class Windsock {
  readonly object = new THREE.Group();
  private readonly sock = new THREE.Group();
  private readonly segments: THREE.Mesh[] = [];
  private readonly segLength = WINDSOCK.length / WINDSOCK.segments;

  constructor(base: THREE.Vector3) {
    this.object.name = 'windsock';
    this.object.position.copy(base);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(WINDSOCK.mastRadius, WINDSOCK.mastRadius * 1.4, WINDSOCK.mastHeight, 6),
      new THREE.MeshLambertMaterial({ color: WINDSOCK.mastColour }),
    );
    mast.position.y = WINDSOCK.mastHeight / 2;
    mast.castShadow = true;
    this.object.add(mast);

    this.sock.position.y = WINDSOCK.mastHeight;
    this.object.add(this.sock);
    const n = WINDSOCK.segments;
    const radius = (i: number) => WINDSOCK.mouthRadius + ((WINDSOCK.tailRadius - WINDSOCK.mouthRadius) * i) / n;
    const mats = WINDSOCK.colours.map(
      (c) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }),
    );
    for (let i = 0; i < n; i++) {
      // Open-ended tapered tube along local +X, starting at the origin.
      // Cylinder top (+Y) is the narrower tail end; rotating -90° about Z turns +Y into +X.
      const g = new THREE.CylinderGeometry(radius(i + 1), radius(i), this.segLength, 10, 1, true);
      g.rotateZ(-Math.PI / 2);
      g.translate(this.segLength / 2, 0, 0);
      const seg = new THREE.Mesh(g, mats[i % mats.length]);
      seg.castShadow = true;
      this.segments.push(seg);
      this.sock.add(seg);
    }
    this.update({ x: 0, y: 0, z: 0 }, 0);
  }

  /** Re-pose the sock for this wind. timeS drives a small flutter that grows with wind. */
  update(wind: WindVector, timeS: number): void {
    const pose = windsockPose(wind);
    const f = Math.min(Math.hypot(wind.x, wind.z) / WINDSOCK.fullSpeedMps, 1);
    const w = 2 * Math.PI * WINDSOCK.flutterHz * timeS;
    const a = WINDSOCK.flutterAmplitude * f;
    this.sock.rotation.y = pose.yaw + a * Math.sin(w);
    // Chain the segments: each starts where the previous one ended.
    let x = 0;
    let y = 0;
    pose.droop.forEach((d, i) => {
      const droop = Math.max(0, d + a * Math.sin(w * 1.3 + i) * ((i + 1) / pose.droop.length));
      const seg = this.segments[i];
      seg.position.set(x, y, 0);
      seg.rotation.z = -droop; // positive rotation about Z would lift +X; we want it down
      x += this.segLength * Math.cos(droop);
      y -= this.segLength * Math.sin(droop);
    });
  }
}
