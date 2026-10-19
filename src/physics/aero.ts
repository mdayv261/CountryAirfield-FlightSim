import * as THREE from 'three';
import type { AeroData } from '../aircraft/schema';
import { degToRad } from '../core/units';
import { interp } from './table';

/** Pilot controls as fractions of full throw, -1..1 (signs as in the schema). */
export interface SurfaceControls {
  elevator: number;
  aileron: number;
  rudder: number;
}

export interface AeroInput {
  /** Aircraft velocity relative to the air, body axes, m/s. */
  airVelocityBody: THREE.Vector3;
  /** Body angular velocity, body axes, rad/s. */
  omegaBody: THREE.Vector3;
  density: number;
  controls: SurfaceControls;
  /** Height of the CG above the ground, m (ground effect). */
  heightAboveGround: number;
  /** Extra dynamic pressure from the propeller slipstream, Pa (before the tail share). */
  slipstreamPressure: number;
}

/** Results, body axes, plus the flight-condition values the HUD and tests want. */
export interface AeroOutput {
  force: THREE.Vector3;
  moment: THREE.Vector3;
  airspeed: number;
  /** Angle of attack of the wing (body angle + rigging incidence), rad: what an AoA gauge shows. */
  alpha: number;
  beta: number;
  dynamicPressure: number;
  CL: number;
  CD: number;
}

export function emptyAeroOutput(): AeroOutput {
  return { force: new THREE.Vector3(), moment: new THREE.Vector3(), airspeed: 0, alpha: 0, beta: 0, dynamicPressure: 0, CL: 0, CD: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Below this airspeed, m/s, aerodynamic forces are negligible and angles meaningless. */
const MIN_AIRSPEED = 0.3;

/**
 * Whole-aircraft aerodynamics by coefficient build-up (the classic flight-dynamics approach).
 *
 * 1. Flow angles from the air velocity in body axes (forward is −z, up is +y, right is +x):
 *      alpha = atan2(−v_y, −v_z): how far the nose sits above the flight path;
 *      beta  = asin(v_x / V): positive when the relative wind comes from the right.
 * 2. Coefficients: CL and CD from tables against alpha (covering the stall and beyond);
 *    side force, rolling, pitching and yawing moments from stability derivatives (how a
 *    coefficient changes per radian of alpha/beta, per unit rotation rate, per radian of
 *    control). Each acts like a spring (static stability) or a damper (rate terms).
 * 3. Forces: lift at right angles to the flight path, drag straight back along it, side
 *    force to the right. Each is coefficient x dynamic pressure q = ½ ρ V² x wing area.
 *    Moments use the span (roll, yaw) or chord (pitch) as the lever length.
 *
 * Extras for moderate realism:
 *  - Ground effect: within about one span of the ground the wingtip vortices are squashed
 *    and induced drag falls (McCormick's factor (16h/b)² / (1 + (16h/b)²)): the float in
 *    the flare.
 *  - Propeller slipstream over the tail: elevator and rudder work at the slipstream's
 *    higher dynamic pressure, so they still bite at walking pace with power on.
 *  - Stall: CL peaks then falls (table), the nose drops (CmExtra) and roll damping fades or
 *    reverses (rollDampingFactor), which lets a wing drop if the stall is not balanced.
 *  - Static moments use sin(alpha), sin(beta) rather than the angle itself: identical in normal
 *    flight, and physically sensible when flying backwards (the aircraft wants to turn round).
 */
export class AeroModel {
  private readonly alphaTable: number[];
  private readonly maxElevator: number;
  private readonly maxAileron: number;
  private readonly maxRudder: number;
  private readonly aspectRatio: number;
  /** Wing rigging incidence, rad (wing chord nose-up from the body axis). */
  readonly incidence: number;
  private readonly u = new THREE.Vector3();
  private readonly liftDir = new THREE.Vector3();
  private readonly sideDir = new THREE.Vector3();
  private static readonly X = new THREE.Vector3(1, 0, 0);

  constructor(
    readonly data: AeroData,
    readonly area: number,
    readonly span: number,
    readonly chord: number,
  ) {
    this.alphaTable = data.alpha_deg.map(degToRad);
    this.maxElevator = degToRad(data.elevatorMax_deg);
    this.maxAileron = degToRad(data.aileronMax_deg);
    this.maxRudder = degToRad(data.rudderMax_deg);
    this.aspectRatio = (span * span) / area;
    this.incidence = degToRad(data.wingIncidence_deg ?? 0);
  }

  CLtable(alpha: number): number {
    return interp(this.alphaTable, this.data.CL, alpha);
  }

  CDtable(alpha: number): number {
    return interp(this.alphaTable, this.data.CD, alpha);
  }

  /** Ground-effect factor on induced drag: 1 high up, falling towards 0 on the ground. */
  groundEffect(height: number): number {
    const x = (16 * Math.max(height, 0)) / this.span;
    return (x * x) / (1 + x * x);
  }

  compute(input: AeroInput, out: AeroOutput = emptyAeroOutput()): AeroOutput {
    const d = this.data;
    const v = input.airVelocityBody;
    const V = v.length();
    out.force.set(0, 0, 0);
    out.moment.set(0, 0, 0);
    out.airspeed = V;
    if (V < MIN_AIRSPEED) {
      Object.assign(out, { alpha: 0, beta: 0, dynamicPressure: 0, CL: 0, CD: 0 });
      return out;
    }
    // Angle of the flow to the wing chord: the body's angle plus the wing's rigging incidence.
    // All tables and the static pitching moment work on this; only the fuselage attitude
    // differs, sitting `incidence` lower for the same flight condition.
    const alpha = Math.atan2(-v.y, -v.z) + this.incidence;
    const beta = Math.asin(clamp(v.x / V, -1, 1));
    const qbar = 0.5 * input.density * V * V;
    // Rates in the pilot's sense: roll right, pitch up, yaw right.
    const p = -input.omegaBody.z;
    const q = input.omegaBody.x;
    const r = -input.omegaBody.y;
    const de = clamp(input.controls.elevator, -1, 1) * this.maxElevator;
    const da = clamp(input.controls.aileron, -1, 1) * this.maxAileron;
    const dr = clamp(input.controls.rudder, -1, 1) * this.maxRudder;
    // Tail surfaces see the free stream plus part of the propeller slipstream.
    const tailRatio = 1 + (d.tailSlipstream * input.slipstreamPressure) / qbar;
    // Rudder blanking in a deep stall (optional table).
    const rudderRatio = tailRatio * (d.rudderFactor ? interp(this.alphaTable, d.rudderFactor, alpha) : 1);

    // Lift and drag. Rate terms are written so that V cancels: damping ∝ ρ V, no 1/V blow-up.
    const CLbasic = this.CLtable(alpha);
    const CL = CLbasic + d.CLq * ((q * this.chord) / (2 * V)) + d.CLde * de * tailRatio;
    const induced = (CLbasic * CLbasic) / (Math.PI * d.oswald * this.aspectRatio);
    const CD =
      this.CDtable(alpha) -
      (1 - this.groundEffect(input.heightAboveGround)) * induced +
      d.CDcontrol * (de * de + da * da + dr * dr);
    const CY = d.CYbeta * Math.sin(beta) + d.CYdr * dr * rudderRatio;

    const ph = (p * this.span) / (2 * V);
    const qh = (q * this.chord) / (2 * V);
    const rh = (r * this.span) / (2 * V);
    const rollDamping = d.Clp * interp(this.alphaTable, d.rollDampingFactor, alpha);
    const Cl = d.Clbeta * Math.sin(beta) + rollDamping * ph + d.Clr_perCL * CLbasic * rh + d.Clda * da;
    const Cm =
      d.Cm0 + d.Cmalpha * Math.sin(alpha) + interp(this.alphaTable, d.CmExtra, alpha) + d.Cmq * qh + d.Cmde * de * tailRatio;
    const yawDamping = d.Cnr * (d.yawDampingFactor ? interp(this.alphaTable, d.yawDampingFactor, alpha) : 1);
    const Cn = d.Cnbeta * Math.sin(beta) + yawDamping * rh + d.Cnp_perCL * CLbasic * ph + d.Cndr * dr * rudderRatio + d.Cnda * da;

    // Force directions: drag against the motion, lift ⟂ motion in the plane of symmetry
    // (right wing × motion), side force completing the right-handed set.
    const u = this.u.copy(v).divideScalar(V);
    this.liftDir.crossVectors(AeroModel.X, u);
    if (this.liftDir.lengthSq() < 1e-9) this.liftDir.set(0, 1, 0);
    else this.liftDir.normalize();
    this.sideDir.crossVectors(u, this.liftDir);

    const S = this.area;
    out.force
      .addScaledVector(u, -CD * qbar * S)
      .addScaledVector(this.liftDir, CL * qbar * S)
      .addScaledVector(this.sideDir, CY * qbar * S);
    // Body torque: pitch about +x, yaw (nose right) about −y, roll (right wing down) about −z.
    out.moment.set(Cm * qbar * S * this.chord, -Cn * qbar * S * this.span, -Cl * qbar * S * this.span);
    Object.assign(out, { alpha, beta, dynamicPressure: qbar, CL, CD });
    return out;
  }
}
