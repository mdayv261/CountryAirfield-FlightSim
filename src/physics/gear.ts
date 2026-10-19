import * as THREE from 'three';
import type { GearLeg } from '../aircraft/schema';
import type { RigidBody } from './RigidBody';
import { SURFACES, type SurfaceType } from './surfaces';

/** What the gear needs to know about the ground. */
export interface Ground {
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): SurfaceType;
}

/** Pilot inputs that act on the gear. */
export interface GearControls {
  /** Rudder pedals, -1 (full left) .. +1 (full right). */
  pedals: number;
  /** Toe brakes, 0..1. */
  brakeLeft: number;
  brakeRight: number;
}

/** Live state of one leg, for gauges, sounds and tests. */
export interface LegState {
  inContact: boolean;
  /** Strut compression, m. */
  compression: number;
  /** Load pressing the tyre onto the ground, N. */
  normalForce: number;
  surface: SurfaceType | null;
  /** Speed along the ground in the wheel's rolling direction, m/s (for rumble sounds). */
  rollingSpeed: number;
  /** Sideways slip speed of the tyre, m/s (for tyre squeal). */
  slipSpeed: number;
}

export const GEAR_MODEL = {
  /** Bump stop stiffness as a multiple of the strut spring, once travel is used up. */
  bumpStopFactor: 10,
  /**
   * Friction smoothing speed, m/s. Real dry friction jumps from +μN to −μN as the slip
   * velocity changes sign; a step that sharp makes a fixed-step simulation chatter.
   * Below this slip speed the friction force is scaled down linearly, which behaves like
   * a stiff viscous damper and lets a parked aircraft sit still.
   */
  frictionSmoothing_mps: 0.1,
  /**
   * Largest friction "gain" allowed, as a fraction of what would stop a contact point's slip
   * in one step, shared between all contacts touching the ground. Keeps several stiff
   * contacts (a box resting on four corners) from overcorrecting each other and chattering.
   */
  frictionGainLimit: 0.8,
  /**
   * Stability caps for the struts themselves. A spring of rate k on effective mass m
   * vibrates at ω = √(k/m); a fixed-step integrator goes unstable once ω·dt nears 2.
   * We cap each contact so ω·dt ≤ 1 (stiffness ≤ m/dt²) and its damping so it can at most
   * stop the contact's motion in one step (c ≤ m/dt), shared between touching contacts.
   * Real aircraft struts sit far below these caps; they only bite on a hard bump-stop hit
   * or a light corner of a tumbling object.
   */
  stiffnessLimit: 1.0,
  dampingLimit: 0.8,
  /**
   * Static friction. Below stickSpeed a contact patch sticks to the ground point it is on,
   * held by a stiff spring and damper (natural frequency stickHz, close to critically
   * damped). It stays stuck until holding it would need more than the friction available,
   * or until it slides faster than releaseSpeed. Without this, the smoothed dynamic
   * friction lets a steady sideways force (a slope, a crosswind, a gyro's prerotator torque)
   * creep the aircraft along indefinitely.
   */
  stickSpeed_mps: 0.05,
  releaseSpeed_mps: 0.3,
  stickHz: 4,
  stickDamping: 0.8,
  /** Tyre slip angle at which side force reaches its peak (μN), rad (~8°). */
  peakSlipAngle_rad: 0.14,
  /** Strut must stay this close to vertical to the ground for the contact model (cos of angle). */
  minStrutCos: 0.3,
  /** Step used to estimate the ground slope (normal), m. */
  normalStep_m: 0.5,
};

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Landing gear: spring-damper struts with tyre friction, one call per physics step.
 *
 * For each leg:
 *  1. Find how far the fully-extended contact point has sunk below the ground. Measured
 *     along the strut, that is the strut compression c.
 *  2. Strut force = k c + b dc/dt (spring plus damper, like a car's suspension), plus a
 *     much stiffer bump stop if the travel runs out. The ground can only push, never pull,
 *     so a negative total (strut extending faster than the damper allows) is set to zero.
 *     This load N acts along the ground's normal (straight up on level ground).
 *  3. Tyre friction acts in the ground plane, split into the wheel's rolling direction and
 *     the sideways direction:
 *       rolling: rolling resistance (μ_roll N) plus brakes (up to μ N);
 *       sideways: grows with slip angle up to the surface's peak μ N, like a real tyre's
 *       cornering force. The total is capped by the friction circle |F| ≤ μ N.
 *     Skids (tail skids, wingtips) just slide with friction μ N in any direction.
 *  4. Steering: pedals turn steerable wheels. A wheel ahead of the CG (nosewheel) turns
 *     the same way as the pedal; one behind (tailwheel) turns the opposite way, so right
 *     pedal swings the tail left and the nose right in both cases.
 */
export class GearSet {
  readonly states: LegState[];
  private readonly rBody: THREE.Vector3[];

  // Scratch vectors (no allocation per step).
  private readonly down = new THREE.Vector3();
  private readonly cw = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly vp = new THREE.Vector3();
  private readonly vt = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly rContact = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly ub = new THREE.Vector3();
  private readonly ra = new THREE.Vector3();
  private contactsLastStep = 1;
  /** Ground point each contact is stuck to (static friction), or null while sliding/rolling. */
  private readonly anchors: Array<THREE.Vector3 | null>;
  private readonly patch = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly fs = new THREE.Vector3();

  constructor(readonly legs: GearLeg[]) {
    this.rBody = legs.map((l) => new THREE.Vector3(...l.position_m));
    this.anchors = legs.map(() => null);
    this.states = legs.map(() => ({
      inContact: false,
      compression: 0,
      normalForce: 0,
      surface: null,
      rollingSpeed: 0,
      slipSpeed: 0,
    }));
  }

  /** Ground normal (unit, pointing up) from the local height slope. */
  groundNormal(ground: Ground, x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const d = GEAR_MODEL.normalStep_m;
    const dhdx = (ground.heightAt(x + d, z) - ground.heightAt(x - d, z)) / (2 * d);
    const dhdz = (ground.heightAt(x, z + d) - ground.heightAt(x, z - d)) / (2 * d);
    return out.set(-dhdx, 1, -dhdz).normalize();
  }

  /**
   * Effective mass at body point r for motion along world direction u: how heavy the body
   * feels if you push it there in that direction. Pushing near the CG you feel all the mass;
   * pushing a wingtip sideways it partly swings instead, so it feels lighter:
   *     1 / m_eff = 1/m + (r × u) · I⁻¹ (r × u)
   */
  private effectiveMass(body: RigidBody, r: THREE.Vector3, uWorld: THREE.Vector3): number {
    body.toBody(uWorld, this.ub);
    this.ra.crossVectors(r, this.ub);
    const turning = this.ub.copy(this.ra).applyMatrix3(body.inverseInertia).dot(this.ra);
    return 1 / (1 / body.mass + turning);
  }

  /**
   * Smoothing speed for friction along direction u: the larger of the base smoothing speed
   * and the speed below which friction would exceed the stable gain for this time step.
   */
  private smoothing(body: RigidBody, r: THREE.Vector3, u: THREE.Vector3, maxForce: number, dt: number): number {
    const gain = (GEAR_MODEL.frictionGainLimit * this.effectiveMass(body, r, u)) / (dt * this.contactsLastStep);
    return Math.max(GEAR_MODEL.frictionSmoothing_mps, maxForce / gain);
  }

  /** Compute and apply all gear forces to the body for a step of dt seconds. */
  apply(body: RigidBody, ground: Ground, controls: GearControls, dt: number): void {
    body.toWorld(this.tmp.set(0, -1, 0), this.down); // strut axis, pointing down
    let contacts = 0;

    this.legs.forEach((leg, i) => {
      const st = this.states[i];
      const r = this.rBody[i];
      body.pointToWorld(r, this.cw);
      const h = ground.heightAt(this.cw.x, this.cw.z);
      const depth = h - this.cw.y;
      if (depth <= 0) {
        this.anchors[i] = null;
        Object.assign(st, { inContact: false, compression: 0, normalForce: 0, surface: null, rollingSpeed: 0, slipSpeed: 0 });
        return;
      }
      const n = this.groundNormal(ground, this.cw.x, this.cw.z, this.n);
      // Strut alignment with the ground normal; a strut lying flat cannot carry load.
      // Skids are pads, not struts: they always compress straight along the normal.
      const cosStrut = leg.kind === 'skid' ? 1 : Math.max(-this.down.dot(n), GEAR_MODEL.minStrutCos);
      const penetration = depth * n.y; // perpendicular distance below the ground plane
      const compression = penetration / cosStrut;

      body.pointVelocity(r, this.vp);
      const vn = this.vp.dot(n); // negative when moving into the ground
      const compressionRate = -vn / cosStrut;

      let spring = leg.spring_N_per_m * compression;
      if (compression > leg.travel_m) {
        spring += GEAR_MODEL.bumpStopFactor * leg.spring_N_per_m * (compression - leg.travel_m);
      }
      const mNormal = this.effectiveMass(body, r, n) / this.contactsLastStep;
      spring = Math.min(spring, (GEAR_MODEL.stiffnessLimit * mNormal * compression) / (dt * dt));
      const damper = Math.min(leg.damper_Ns_per_m, (GEAR_MODEL.dampingLimit * mNormal) / dt);
      const N = Math.max(spring + damper * compressionRate, 0);
      contacts++;

      const surface = ground.surfaceAt(this.cw.x, this.cw.z);
      const props = SURFACES[surface];

      // Velocity of the contact patch along the ground plane.
      this.vt.copy(this.vp).addScaledVector(n, -vn);
      this.f.copy(n).multiplyScalar(N);

      let rollingSpeed = 0;
      let slipSpeed = 0;
      // Ground point under the contact.
      this.patch.copy(this.cw).addScaledVector(n, penetration);
      const stuck = this.staticFriction(i, leg.kind, body, r, n, N, props.mu, props.rolling, leg.brake ? this.brakeFor(r.x, controls) : 0, controls);
      if (stuck) {
        this.f.add(this.fs);
        rollingSpeed = 0;
        slipSpeed = 0;
      } else if (leg.kind === 'skid') {
        const speed = this.vt.length();
        if (speed > 1e-9) {
          const u = this.tmp.copy(this.vt).divideScalar(speed);
          const vs = this.smoothing(body, r, u, props.mu * N, dt);
          this.f.addScaledVector(this.vt, (-props.mu * N) / Math.max(speed, vs));
        }
        slipSpeed = speed;
      } else {
        // Wheel heading: body forward (-z) turned by the steering angle about the strut.
        const steerSign = r.z <= 0 ? 1 : -1;
        const delta = (leg.steerMax_rad ?? 0) * clamp1(controls.pedals) * steerSign;
        body.toWorld(this.tmp.set(Math.sin(delta), 0, -Math.cos(delta)), this.fwd);
        this.fwd.addScaledVector(n, -this.fwd.dot(n)).normalize();
        this.side.crossVectors(this.fwd, n); // points to the wheel's right

        const vr = this.vt.dot(this.fwd);
        const vside = this.vt.dot(this.side);
        rollingSpeed = vr;
        slipSpeed = vside;

        const brake = leg.brake ? this.brakeFor(r.x, controls) : 0;
        const rollingMu = props.rolling + brake * props.mu;
        const vsRoll = this.smoothing(body, r, this.fwd, rollingMu * N, dt);
        const vsSide = this.smoothing(body, r, this.side, props.mu * N, dt);
        let fRoll = -rollingMu * N * clamp1(vr / vsRoll);
        // Side force: proportional to slip angle until the peak, then constant (sliding).
        // The slip reference never drops below the smoothing speed, so at walking pace
        // the tyre still grips like dry friction.
        const slipRef = Math.max(Math.abs(vr) * Math.tan(GEAR_MODEL.peakSlipAngle_rad), vsSide);
        let fSide = -props.mu * N * clamp1(vside / slipRef);
        // Friction circle: rolling and side forces share one grip budget.
        const total = Math.hypot(fRoll, fSide);
        const limit = props.mu * N;
        if (total > limit && total > 0) {
          fRoll *= limit / total;
          fSide *= limit / total;
        }
        this.f.addScaledVector(this.fwd, fRoll).addScaledVector(this.side, fSide);
      }

      // Apply at the contact point (on the ground, below the compressed strut).
      this.rContact.copy(r).addScaledVector(body.toBody(n, this.tmp), penetration);
      body.addForceAtBodyPoint(this.f, this.rContact);

      Object.assign(st, { inContact: true, compression, normalForce: N, surface, rollingSpeed, slipSpeed });
    });
    this.contactsLastStep = Math.max(1, contacts);
  }

  /**
   * Static friction for contact i. Returns true (with the force in this.fs) while the patch is
   * stuck to its anchor point; false when it is sliding or rolling (use dynamic friction).
   * For a wheel the rolling direction may still roll against its rolling resistance and
   * brakes: the anchor slides along with it, so only the sideways direction is truly fixed.
   */
  private staticFriction(
    i: number,
    kind: 'wheel' | 'skid',
    body: RigidBody,
    r: THREE.Vector3,
    n: THREE.Vector3,
    N: number,
    mu: number,
    rolling: number,
    brake: number,
    controls: GearControls,
  ): boolean {
    const speed = this.vt.length();
    let anchor = this.anchors[i];
    if (!anchor) {
      if (speed > GEAR_MODEL.stickSpeed_mps || N <= 0) return false;
      anchor = this.anchors[i] = this.patch.clone();
    }
    if (speed > GEAR_MODEL.releaseSpeed_mps || N <= 0) {
      this.anchors[i] = null;
      return false;
    }
    // Wheel axes (for a skid any horizontal pair will do).
    if (kind === 'wheel') {
      const leg = this.legs[i];
      const steerSign = r.z <= 0 ? 1 : -1;
      const delta = (leg.steerMax_rad ?? 0) * clamp1(controls.pedals) * steerSign;
      body.toWorld(this.tmp.set(Math.sin(delta), 0, -Math.cos(delta)), this.fwd);
    } else {
      body.toWorld(this.tmp.set(0, 0, -1), this.fwd);
    }
    this.fwd.addScaledVector(n, -this.fwd.dot(n)).normalize();
    this.side.crossVectors(this.fwd, n);

    // Spring-damper to the anchor, stiffness from the contact's effective mass so it stays stable.
    const m = Math.min(this.effectiveMass(body, r, this.fwd), this.effectiveMass(body, r, this.side)) / this.contactsLastStep;
    const w = 2 * Math.PI * GEAR_MODEL.stickHz;
    const k = m * w * w;
    const c = 2 * GEAR_MODEL.stickDamping * m * w;
    this.d.subVectors(this.patch, anchor);
    this.d.addScaledVector(n, -this.d.dot(n));
    this.fs.copy(this.d).multiplyScalar(-k).addScaledVector(this.vt, -c);

    const sideLimit = mu * N;
    if (kind === 'skid') {
      if (this.fs.length() > sideLimit) {
        this.anchors[i] = null;
        return false;
      }
      return true;
    }
    let fRoll = this.fs.dot(this.fwd);
    const fSide = this.fs.dot(this.side);
    if (Math.abs(fSide) > sideLimit) {
      this.anchors[i] = null; // skidding sideways
      return false;
    }
    // Rolling direction: the wheel turns once rolling resistance and brakes are overcome.
    // Let the anchor follow it so the held force stays at that limit.
    const rollLimit = (rolling + brake * mu) * N;
    if (Math.abs(fRoll) > rollLimit) {
      const excess = Math.abs(fRoll) - rollLimit;
      anchor.addScaledVector(this.fwd, (-Math.sign(fRoll) * excess) / k);
      fRoll = Math.sign(fRoll) * rollLimit;
    }
    this.fs.copy(this.fwd).multiplyScalar(fRoll).addScaledVector(this.side, fSide);
    return true;
  }

  /** Brake demand for a wheel: left wheels use the left toe brake, right the right, centre the average. */
  private brakeFor(x: number, c: GearControls): number {
    if (x < -1e-3) return c.brakeLeft;
    if (x > 1e-3) return c.brakeRight;
    return (c.brakeLeft + c.brakeRight) / 2;
  }
}
