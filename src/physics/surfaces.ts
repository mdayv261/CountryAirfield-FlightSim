import { APRON, DAM, RUNWAYS, TAXIWAYS, type GroundRect } from '../world/layout';

export type SurfaceType = 'gravel' | 'grass' | 'water';

export interface SurfaceProperties {
  /**
   * Peak tyre-to-ground friction coefficient: the most sideways or braking force a
   * tyre can make, as a fraction of the load on it (CLAUDE.md: gravel 0.6, grass 0.4).
   */
  mu: number;
  /** Rolling resistance as a fraction of wheel load (free-rolling wheel, no brake). */
  rolling: number;
}

/**
 * Ground friction data. Rolling resistance: small tyres on loose gravel ~0.04;
 * mown grass is draggier, ~0.07. Water (the dam) is treated as very soft and
 * draggy so anything that ends up in it stops quickly.
 */
export const SURFACES: Record<SurfaceType, SurfaceProperties> = {
  gravel: { mu: 0.6, rolling: 0.04 },
  grass: { mu: 0.4, rolling: 0.07 },
  water: { mu: 0.3, rolling: 0.5 },
};

const inside = (r: GroundRect, x: number, z: number) =>
  Math.abs(x - r.cx) <= r.sizeX / 2 && Math.abs(z - r.cz) <= r.sizeZ / 2;

/** Surface type under a world point. Gravel: runway, taxiways, apron. Water: the dam. Else grass. */
export function surfaceAt(x: number, z: number): SurfaceType {
  if (inside(RUNWAYS.gravel, x, z) || inside(APRON, x, z) || TAXIWAYS.some((t) => inside(t, x, z))) return 'gravel';
  if (Math.hypot(x - DAM.cx, z - DAM.cz) < DAM.radius * 0.9) return 'water';
  return 'grass';
}
