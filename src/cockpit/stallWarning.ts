import { radToDeg } from '../core/units';
import type { PoweredAircraft } from '../physics/PoweredAircraft';

/** Warn this many degrees of angle of attack before the stall (the peak of the lift curve). */
export const STALL_MARGIN_DEG = 3;

/** Angle of attack at which the wing's lift peaks, degrees (Infinity for a wingless gyroplane). */
export function stallAlphaDeg(ac: PoweredAircraft): number {
  const a = ac.data.aero;
  return a ? a.alpha_deg[a.CL.indexOf(Math.max(...a.CL))] : Infinity;
}

/**
 * The stall warning (HUD and stall horn): airborne, moving, and the wing within a few degrees
 * of its stalling angle, as a stall-warning vane or reed on the leading edge senses it.
 */
export function stallWarning(ac: PoweredAircraft, stallAlpha = stallAlphaDeg(ac)): boolean {
  const airborne = ac.gear.states.every((w) => !w.inContact);
  return airborne && ac.state.ias > 5 && radToDeg(ac.state.alpha) > stallAlpha - STALL_MARGIN_DEG;
}
