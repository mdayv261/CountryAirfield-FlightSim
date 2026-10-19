import * as THREE from 'three';
import type { AirframeAeroData, SurfaceData } from '../aircraft/schema';
import { degToRad } from '../core/units';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The open-frame airframe of a gyroplane: body drag, plus individual tail surfaces (fin with
 * rudder, small tailplane), each treated as a little wing at its own position.
 *
 * For each surface we find the airflow it actually meets: the aircraft's motion through the
 * air plus the swing of the surface from rotation (ω × r), plus a share of the propeller
 * slipstream for surfaces behind a pusher prop. Its angle to that flow gives a lift
 * coefficient (linear up to its stall, then capped), which acts at right angles to the flow
 * in the surface's working plane. Because the surface sits behind the CG, this produces
 * weathercock stability on its own, and the rotation term produces damping.
 *
 * A fin works in the yaw plane (its lift is sideways); a tailplane in the pitch plane.
 * A rudder on the fin adds lift in proportion to its deflection.
 */
export class LiftingSurfaces {
  private readonly surfaces: Array<SurfaceData & { r: THREE.Vector3; rudderMax: number }>;
  private readonly vLocal = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(readonly data: AirframeAeroData) {
    this.surfaces = data.surfaces.map((s) => ({ ...s, r: new THREE.Vector3(...s.position_m), rudderMax: degToRad(s.rudderMax_deg ?? 0) }));
  }

  /** Total fin area (for the slipstream-swirl moment reference). */
  get finArea(): number {
    return this.surfaces.filter((s) => s.plane === 'yaw').reduce((a, s) => a + s.area_m2, 0);
  }

  /**
   * Add body drag and surface forces to `force` and `moment` (body axes, about the CG).
   * airVelocityBody: aircraft velocity relative to the air; rudder: −1..1 (right positive);
   * slipstreamPressure: extra dynamic pressure behind the propeller, Pa.
   */
  compute(
    airVelocityBody: THREE.Vector3,
    omegaBody: THREE.Vector3,
    density: number,
    rudder: number,
    slipstreamPressure: number,
    force: THREE.Vector3,
    moment: THREE.Vector3,
  ): void {
    // Body drag: open frame, pilot, engine, wheels. A drag area for head-on flow and one for
    // side-on flow, blended by the direction of the airflow.
    const V = airVelocityBody.length();
    if (V > 0.1) {
      const sideFrac = (airVelocityBody.x / V) ** 2;
      const CdA = this.data.dragArea_m2 * (1 - sideFrac) + this.data.sideDragArea_m2 * sideFrac;
      force.addScaledVector(airVelocityBody, -0.5 * density * V * CdA);
    }

    for (const s of this.surfaces) {
      // Local airflow at the surface: aircraft velocity relative to air plus rotation.
      const v = this.vLocal.crossVectors(omegaBody, s.r).add(airVelocityBody);
      const Vl = v.length();
      // Behind a pusher, the slipstream adds dynamic pressure along the flow.
      const q = 0.5 * density * Vl * Vl + (s.slipstream ?? 0) * slipstreamPressure;
      if (q < 1e-3) continue;
      // Flow angle in the surface's working plane, and the direction lift acts in.
      let angle: number;
      let liftDir: THREE.Vector3;
      if (s.plane === 'yaw') {
        // Fin: sideslip angle at the fin; lift pushes against the sideways flow.
        angle = Math.atan2(v.x, -v.z);
        liftDir = this.tmp.set(-1, 0, 0);
      } else {
        // Tailplane: local angle of attack; lift acts upward.
        angle = Math.atan2(-v.y, -v.z);
        liftDir = this.tmp.set(0, 1, 0);
      }
      const deflection = s.plane === 'yaw' ? clamp(rudder, -1, 1) * s.rudderMax : 0;
      // Right rudder puts the fin's lift to the left (−x), swinging the tail left and the nose right.
      const CL = clamp(s.liftSlope * Math.sin(angle) + (s.rudderPower ?? 0) * deflection, -s.CLmax, s.CLmax);
      const CD = s.CD0 + (CL * CL) / (Math.PI * 0.7 * s.aspectRatio);
      this.f.copy(liftDir).multiplyScalar(CL * q * s.area_m2);
      // Drag along the local airflow.
      if (Vl > 0.1) this.f.addScaledVector(v, (-CD * q * s.area_m2) / Vl);
      force.add(this.f);
      moment.add(this.tmp.crossVectors(s.r, this.f));
    }
  }
}
