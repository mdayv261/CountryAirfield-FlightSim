import { ktToMps, mpsToKt } from '../core/units';

/** Horizontal wind velocity in world axes, m/s (the direction the air is moving). */
export interface WindVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Convert a meteorological wind report ("from 270° at 10 kt") into a velocity vector.
 * Met direction is where the wind blows FROM, measured clockwise from true north.
 * North is -Z and east is +X, so a wind from the north (0°) moves the air towards +Z.
 */
export function windFromMet(fromDeg: number, speedKt: number): WindVector {
  const a = (fromDeg * Math.PI) / 180;
  const v = ktToMps(speedKt);
  return { x: -Math.sin(a) * v, y: 0, z: Math.cos(a) * v };
}

/** Inverse of windFromMet: { fromDeg 0..360, speedKt }. */
export function metFromWind(w: WindVector): { fromDeg: number; speedKt: number } {
  const speed = Math.hypot(w.x, w.z);
  const fromDeg = ((Math.atan2(-w.x, w.z) * 180) / Math.PI + 360) % 360;
  return { fromDeg, speedKt: mpsToKt(speed) };
}
