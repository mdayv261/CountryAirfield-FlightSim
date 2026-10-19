import * as THREE from 'three';
import { WindModel } from '../../src/physics/wind';

/**
 * The normal wind model plus a scripted extra air velocity (world axes, m/s) as a function
 * of time: for flying through a defined gust in a test.
 */
export class ScriptedWind extends WindModel {
  extra: (t: number, out: THREE.Vector3) => THREE.Vector3 = (_t, out) => out.set(0, 0, 0);
  private readonly add = new THREE.Vector3();

  override velocityAt(heightAboveGround: number, out = new THREE.Vector3()): THREE.Vector3 {
    super.velocityAt(heightAboveGround, out);
    return out.add(this.extra(this.time, this.add));
  }
}

/** A "1 − cos" gust: rises from 0 to `peak` and back over `duration` s, starting at `start`. */
export function oneMinusCos(t: number, start: number, duration: number, peak: number): number {
  const s = (t - start) / duration;
  return s < 0 || s > 1 ? 0 : 0.5 * peak * (1 - Math.cos(2 * Math.PI * s));
}
