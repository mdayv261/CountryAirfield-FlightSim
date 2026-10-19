import * as THREE from 'three';
import type { RotorData } from '../aircraft/schema';
import { degToRad } from '../core/units';

const TWO_PI = 2 * Math.PI;
/** Below this tip speed (m/s) the blades make no useful force (rotor stopped or barely turning). */
const MIN_TIP_SPEED = 1;
/** Momentum-theory iterations for the induced velocity each step (it changes slowly). */
const INFLOW_ITERATIONS = 4;
/** Ground effect never cuts the induced flow below this fraction (the formula breaks down very close in). */
const MIN_GROUND_FACTOR = 0.5;

export interface RotorInput {
  /** Aircraft velocity relative to the air, body axes, m/s. */
  airVelocityBody: THREE.Vector3;
  /** Body angular velocity, rad/s. */
  omegaBody: THREE.Vector3;
  density: number;
  /** Stick: pitch +1 = fully back (head tilted back), roll +1 = fully right. */
  stickPitch: number;
  stickRoll: number;
  /** Prerotator clutch 0..1 (only drives while the engine is running). */
  prerotator: number;
  engineRunning: boolean;
  /** Height of the hub above the ground, m (rotor ground effect). */
  hubHeight?: number;
}

export interface RotorOutput {
  /** Force on the airframe (body axes), N, and its moment about the CG, N m. */
  force: THREE.Vector3;
  moment: THREE.Vector3;
  thrust: number;
  /** Rotor speed, rpm. */
  rpm: number;
  /** Thrust coefficient and inflow ratio (positive = air flowing up through the disc). */
  CT: number;
  inflow: number;
  /** Advance ratio μ: in-plane airspeed / tip speed. */
  mu: number;
  /** Angle of the disc to the airflow, rad (positive = air striking the underside). */
  discAlpha: number;
  /** Aerodynamic torque on the rotor, N m (positive slows it, negative = autorotation driving it). */
  aeroTorque: number;
  /** Torque the prerotator is applying, N m, and the power it draws from the engine, W. */
  prerotatorTorque: number;
  prerotatorPower: number;
}

/**
 * A gyroplane rotor: two teetering blades on a free-spinning hub, nothing driving them in
 * flight. Blade-element theory with a uniform inflow from momentum theory (the classic
 * Glauert approach used for autogyros since the 1930s):
 *
 *  - Thrust. Each blade section meets the air at its pitch angle plus the angle of the air
 *    coming up through the disc. Integrating along the blade gives the thrust coefficient
 *        C_T = (σ a / 2) · [ θ (1/3 + μ²/2) + λ / 2 ]
 *    where σ = blade area / disc area (solidity), a = blade lift slope, θ = fixed blade pitch,
 *    μ = in-plane airspeed / tip speed, λ = (up-flow − induced flow) / tip speed.
 *    Thrust = C_T ρ A (ΩR)²: it grows with the square of rotor speed and with the up-flow.
 *  - Induced flow. Making thrust pushes air down through the disc; momentum theory gives
 *    its speed v_i = T / (2 ρ A V′), V′ the total flow through the disc (solved iteratively).
 *  - Autorotation. Air coming up through the disc tilts each blade's lift forward, which
 *    pulls the blade round; blade drag holds it back. The torque coefficient is
 *        C_Q = (σ δ / 8)(1 + μ²) − λ C_T
 *    (δ = mean blade drag coefficient). Positive slows the rotor, negative speeds it up.
 *    The rotor settles at the rpm where these balance. Unload the rotor (low g) and C_T
 *    falls, the driving term λ C_T collapses and the rotor slows down: rotor decay.
 *  - The disc. Thrust acts along the disc's axis, through the hub. The stick tilts the head
 *    (and so the disc) in pitch and roll; airflow across the disc tilts it further back,
 *    "blowback" (flapping a1 = 2μ(4θ/3 + λ)/(1 − μ²/2)), which gives speed stability; and
 *    when the airframe rotates the disc lags behind it for a moment (flapLag_s), which gives
 *    pitch and roll damping. A teetering rotor passes no moment through its hub, so all
 *    control comes from tilting the thrust line relative to the CG: with no thrust (zero g)
 *    the pilot has no control at all. That is why gyro pushovers are so dangerous.
 *  - Ground effect: near the ground the downwash cannot get away freely, so less induced
 *    flow is needed for the same thrust. Cheeseman and Bennett: v_i is reduced by the factor
 *    1 − (R / 4z)², z the hub height. With the hub about 0.6 R up, that is roughly 15 %,
 *    which lets a gyro lift off at a smaller disc angle (and less drag) than in free air.
 *  - In-plane (H) force: blade profile drag gives a small force along the in-plane airflow.
 *  - Prerotator: a clutch from the engine spins the rotor up on the ground before take-off,
 *    up to its maximum rpm; it reacts its torque onto the airframe and loads the engine.
 */
export class Rotor {
  /** Rotor speed, rad/s. */
  omega = 0;
  /** Induced velocity (down through the disc), m/s. */
  private vi = 0;
  readonly radius: number;
  readonly discArea: number;
  readonly solidity: number;
  private readonly theta: number;
  private readonly hub: THREE.Vector3;
  private readonly neutralPitch: number;
  private readonly neutralRoll: number;
  private readonly pitchRange: number;
  private readonly pitchBackRange: number;
  private readonly rollRange: number;
  private readonly prerotMaxOmega: number;
  /** +1 if the rotor turns anticlockwise seen from above (spin vector along body +y). */
  private readonly spinSense: number;
  readonly out: RotorOutput = {
    force: new THREE.Vector3(),
    moment: new THREE.Vector3(),
    thrust: 0,
    rpm: 0,
    CT: 0,
    inflow: 0,
    mu: 0,
    discAlpha: 0,
    aeroTorque: 0,
    prerotatorTorque: 0,
    prerotatorPower: 0,
  };
  /** Disc axis (unit), body axes, as last computed: for the 3D model. */
  readonly discAxis = new THREE.Vector3(0, 1, 0);
  private readonly vHub = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly wPar = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly data: RotorData,
    diameter: number,
    blades: number,
  ) {
    this.radius = diameter / 2;
    this.discArea = Math.PI * this.radius * this.radius;
    this.solidity = (blades * data.bladeChord_m) / (Math.PI * this.radius);
    this.theta = degToRad(data.collectivePitch_deg);
    this.hub = new THREE.Vector3(...data.hubPosition_m);
    this.neutralPitch = degToRad(data.headNeutralPitch_deg);
    this.neutralRoll = degToRad(data.headNeutralRoll_deg ?? 0);
    this.pitchRange = degToRad(data.headPitchRange_deg);
    this.pitchBackRange = degToRad(data.headPitchBackRange_deg ?? data.headPitchRange_deg);
    this.rollRange = degToRad(data.headRollRange_deg);
    this.prerotMaxOmega = (data.prerotator.maxRpm / 60) * TWO_PI;
    this.spinSense = data.rotation === 'anticlockwise' ? 1 : -1;
  }

  get rpm(): number {
    return (this.omega * 60) / TWO_PI;
  }

  /** Stop the rotor (on the ground, blades parked). */
  stop(): void {
    this.omega = 0;
    this.vi = 0;
  }

  /** Thrust coefficient for an inflow ratio and advance ratio (blade-element theory). */
  thrustCoefficient(inflow: number, mu: number): number {
    const d = this.data;
    const CT = ((this.solidity * d.liftSlope) / 2) * (this.theta * (1 / 3 + (mu * mu) / 2) + inflow / 2);
    // Blade stall caps the thrust: C_T / σ cannot exceed the data's limit (either way).
    const cap = d.maxCTOverSolidity * this.solidity;
    return Math.max(-cap, Math.min(cap, CT));
  }

  /** Torque coefficient: positive slows the rotor (profile drag), negative drives it (autorotation). */
  torqueCoefficient(inflow: number, mu: number, CT: number): number {
    return ((this.solidity * this.data.profileDrag) / 8) * (1 + mu * mu) - inflow * CT;
  }

  step(dt: number, inp: RotorInput): RotorOutput {
    const d = this.data;
    const o = this.out;
    const R = this.radius;
    const rho = inp.density;

    // Disc axis: the head's tilt (neutral + stick), plus blowback and lag, applied to body up.
    // Pitch is a rotation about x (positive tilts the top of the disc back, towards +z);
    // roll is about −z (positive tilts it to the right, towards +x).
    const p = -inp.omegaBody.z; // roll rate, right wing down positive
    const q = inp.omegaBody.x; // pitch rate, nose up positive
    const stick = clamp1(inp.stickPitch);
    let tiltBack = this.neutralPitch + (stick > 0 ? this.pitchBackRange : this.pitchRange) * stick - q * d.flapLag_s;
    let tiltRight = this.neutralRoll + this.rollRange * clamp1(inp.stickRoll) - p * d.flapLag_s;

    // Air velocity at the hub (aircraft motion through the air plus rotation), and the airflow past it.
    this.vHub.crossVectors(inp.omegaBody, this.hub).add(inp.airVelocityBody);
    const w = this.w.copy(this.vHub).negate(); // air moving past the rotor
    const tipSpeed = Math.max(this.omega * R, 0);

    // Blowback: tilt the disc away from the in-plane airflow, using last step's inflow.
    const axis0 = discAxis(tiltBack, tiltRight, this.tmp);
    const wUp0 = w.dot(axis0);
    this.wPar.copy(w).addScaledVector(axis0, -wUp0);
    const wParMag = this.wPar.length();
    if (tipSpeed > MIN_TIP_SPEED && wParMag > 0.1) {
      const mu = wParMag / tipSpeed;
      const a1 = (2 * mu * ((4 * this.theta) / 3 + o.inflow)) / Math.max(1 - (mu * mu) / 2, 0.3);
      const blow = Math.min(a1, d.maxBlowback_deg * (Math.PI / 180));
      // The disc tilts towards where the in-plane air is going: its z part tilts back, x part sideways.
      tiltBack += (blow * this.wPar.z) / wParMag;
      tiltRight += (blow * this.wPar.x) / wParMag;
    }
    const n = discAxis(tiltBack, tiltRight, this.discAxis);
    const wUp = w.dot(n); // air flowing up through the disc (positive in autorotation)
    this.wPar.copy(w).addScaledVector(n, -wUp);
    const wPar = this.wPar.length();

    // Thrust and induced flow (momentum theory), iterated from last step's value.
    let CT = 0;
    let inflow = 0;
    let mu = 0;
    let thrust = 0;
    if (tipSpeed > MIN_TIP_SPEED) {
      mu = wPar / tipSpeed;
      const thrustScale = rho * this.discArea * tipSpeed * tipSpeed;
      const z = Math.max(inp.hubHeight ?? Infinity, 0.01);
      const groundFactor = Math.max(MIN_GROUND_FACTOR, 1 - (R / (4 * z)) ** 2);
      for (let k = 0; k < INFLOW_ITERATIONS; k++) {
        inflow = (wUp - this.vi) / tipSpeed;
        CT = this.thrustCoefficient(inflow, mu);
        thrust = CT * thrustScale;
        const flow = Math.sqrt(wPar * wPar + (wUp - this.vi) ** 2) + 0.5;
        const viNew = (groundFactor * Math.max(thrust, 0)) / (2 * rho * this.discArea * flow);
        this.vi += 0.5 * (viNew - this.vi);
      }
      inflow = (wUp - this.vi) / tipSpeed;
      CT = this.thrustCoefficient(inflow, mu);
      thrust = CT * thrustScale;
    } else {
      this.vi = 0;
    }

    // Rotor speed: aerodynamic torque plus the prerotator (which only drives up to its limit).
    const CQ = tipSpeed > MIN_TIP_SPEED ? this.torqueCoefficient(inflow, mu, CT) : 0;
    const aeroTorque = CQ * rho * this.discArea * tipSpeed * tipSpeed * R;
    const prerot =
      inp.engineRunning && inp.prerotator > 0 && this.omega < this.prerotMaxOmega ? d.prerotator.torque_Nm * clamp1(inp.prerotator) : 0;
    // Bearing friction stops a stationary rotor creeping.
    const friction = Math.min(d.bearingFriction_Nm, (this.omega * d.inertia_kgm2) / dt);
    this.omega = Math.max(0, this.omega + ((prerot - aeroTorque - friction) * dt) / d.inertia_kgm2);

    // Forces at the hub: thrust along the disc axis, H-force along the in-plane airflow.
    const f = o.force.copy(n).multiplyScalar(thrust);
    if (wPar > 0.1 && tipSpeed > MIN_TIP_SPEED) {
      const CH = (this.solidity * d.profileDrag * mu) / 4;
      f.addScaledVector(this.wPar, (CH * rho * this.discArea * tipSpeed * tipSpeed) / wPar);
    }
    o.moment.crossVectors(this.hub, f);
    // The prerotator twists the airframe the opposite way to the rotor (about the mast).
    o.moment.y -= this.spinSense * prerot;

    o.thrust = thrust;
    o.rpm = this.rpm;
    o.CT = CT;
    o.inflow = inflow;
    o.mu = mu;
    o.discAlpha = Math.atan2(wUp, Math.max(wPar, 1e-6));
    o.aeroTorque = aeroTorque;
    o.prerotatorTorque = prerot;
    o.prerotatorPower = prerot * this.omega;
    return o;
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Unit disc axis for a back tilt (about +x) and a right tilt (about −z), body axes. */
function discAxis(back: number, right: number, out: THREE.Vector3): THREE.Vector3 {
  // Start from body up, tilt back (rotate about +x), then right (rotate about −z).
  return out.set(Math.sin(right) * Math.cos(back), Math.cos(right) * Math.cos(back), Math.sin(back)).normalize();
}
