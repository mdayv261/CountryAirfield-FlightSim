import * as THREE from 'three';
import { AIRCRAFT } from '../../src/aircraft';
import type { AircraftData } from '../../src/aircraft/schema';
import { PHYSICS_DT } from '../../src/core/constants';
import { ktToMps, mpsToKt } from '../../src/core/units';
import { FixedWingAircraft } from '../../src/physics/FixedWingAircraft';
import type { Ground } from '../../src/physics/gear';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { surfaceAt } from '../../src/physics/surfaces';

export const dt = PHYSICS_DT;
const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The airfield is flat (y = 0) out to well beyond the runways, with real surfaces. */
export const fieldGround: Ground = { heightAt: () => 0, surfaceAt };

export function makeWorld(data: AircraftData = AIRCRAFT.airbike103, fuelFraction = 1) {
  const world = new PhysicsWorld(fieldGround);
  const ac = new FixedWingAircraft(data, fuelFraction);
  world.add(ac);
  return { world, ac };
}

/** Attitude angles of the body: pitch θ (nose up +), bank φ (right wing down +), heading ψ (true, rad). */
export function attitude(ac: FixedWingAircraft) {
  const b = ac.body;
  const fwd = b.toWorld(new THREE.Vector3(0, 0, -1));
  const right = b.toWorld(new THREE.Vector3(1, 0, 0));
  const up = b.toWorld(new THREE.Vector3(0, 1, 0));
  return {
    pitch: Math.asin(clamp(fwd.y)),
    bank: Math.atan2(-right.y, up.y),
    heading: Math.atan2(fwd.x, -fwd.z),
  };
}

/** Put the aircraft in the air at an IAS-ish speed, level, heading north, engine running. */
export function startInFlight(ac: FixedWingAircraft, heightM: number, speedKt: number, alphaDeg = 3, headingDeg = 0) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((alphaDeg * Math.PI) / 180, (-headingDeg * Math.PI) / 180, 0, 'YXZ'));
  ac.body.reset(new THREE.Vector3(0, heightM, 0), q);
  const h = (headingDeg * Math.PI) / 180;
  ac.body.velocity.set(Math.sin(h), 0, -Math.cos(h)).multiplyScalar(ktToMps(speedKt));
  ac.powerplant.start();
  ac.powerplant.omega = ((0.9 * ac.data.propulsion.ratedRpm) / 60) * 2 * Math.PI;
}

/** PI(D) controller with output limits and anti-windup. */
export class Pid {
  private integral = 0;
  constructor(
    public kp: number,
    public ki: number,
    public lo = -1,
    public hi = 1,
    public bias = 0,
  ) {}
  update(error: number, rateTerm = 0): number {
    const raw = this.bias + this.kp * error + this.integral + rateTerm;
    const out = clamp(raw, this.lo, this.hi);
    // Only integrate when not saturated in the same direction (anti-windup).
    if (out === raw || Math.sign(error) !== Math.sign(raw - out)) this.integral += this.ki * error * dt;
    return out;
  }
  reset(integral = 0) {
    this.integral = integral;
  }
}

/**
 * A simple autopilot of the kind used for flight-test automation. Loops, inner to outer:
 *  - pitch attitude → elevator (with pitch-rate damping and trim integrator);
 *  - airspeed → pitch attitude (fly the speed with the stick, as pilots do on climb/glide), or
 *  - altitude → vertical speed → pitch attitude;
 *  - bank → aileron (with roll damping); heading → bank;
 *  - sideslip → rudder (keep the ball centred); on the ground, heading → rudder/tailwheel;
 *  - throttle either set directly or held on a power or speed target.
 */
export class TestPilot {
  readonly pitchLoop = new Pid(3.0, 1.5);
  readonly speedLoop = new Pid(0.04, 0.012, -0.35, 0.45);
  readonly vsLoop = new Pid(0.05, 0.03, -0.35, 0.45);
  readonly throttleLoop = new Pid(0.15, 0.08, 0, 1, 0.5);
  readonly groundSteer = new Pid(2.5, 0.3);
  pitchCmd = 0;

  constructor(readonly ac: FixedWingAircraft) {}

  /** Hold a pitch attitude with the elevator. */
  pitchTo(theta: number) {
    const a = attitude(this.ac);
    const q = this.ac.body.angularVelocity.x;
    this.ac.pilot.elevator = this.pitchLoop.update(theta - a.pitch, -0.8 * q);
  }

  /** Fly an indicated airspeed with pitch (stick). */
  holdSpeedWithPitch(iasKt: number) {
    const err = mpsToKt(this.ac.state.ias) - iasKt; // fast → pitch up
    this.pitchCmd = this.speedLoop.update(err);
    this.pitchTo(this.pitchCmd);
  }

  /** Hold an altitude via a vertical-speed command, with pitch. */
  holdAltitude(heightM: number, maxVs = 2) {
    const vsCmd = clamp(0.3 * (heightM - this.ac.body.position.y), -maxVs, maxVs);
    this.pitchCmd = this.vsLoop.update(vsCmd - this.ac.state.verticalSpeed);
    this.pitchTo(this.pitchCmd);
  }

  /** Hold a vertical speed (m/s) with pitch. */
  holdVerticalSpeed(vs: number) {
    this.pitchCmd = this.vsLoop.update(vs - this.ac.state.verticalSpeed);
    this.pitchTo(this.pitchCmd);
  }

  /** Bank to a target with ailerons; keep the slip ball centred with rudder. */
  bankTo(phi: number) {
    const a = attitude(this.ac);
    const p = -this.ac.body.angularVelocity.z;
    this.ac.pilot.aileron = clamp(2.0 * (phi - a.bank) - 0.6 * p);
    const r = -this.ac.body.angularVelocity.y;
    this.ac.pilot.rudder = clamp(3.0 * this.ac.state.beta - 0.3 * r);
  }

  /** Turn onto a heading (rad true) with a bank limit (rad). */
  headingTo(psi: number, maxBank = 0.35) {
    const err = wrapPi(psi - attitude(this.ac).heading);
    this.bankTo(clamp(1.2 * err, -maxBank, maxBank));
  }

  /** On the ground: steer along a heading with rudder/tailwheel, wings level with aileron. */
  steerOnGround(psi: number) {
    const a = attitude(this.ac);
    const r = -this.ac.body.angularVelocity.y;
    this.ac.pilot.rudder = this.groundSteer.update(wrapPi(psi - a.heading), -0.8 * r);
    const p = -this.ac.body.angularVelocity.z;
    this.ac.pilot.aileron = clamp(-1.5 * a.bank - 0.5 * p);
  }

  /** Hold engine brake power at a fraction of rated, with the throttle. */
  holdPower(fraction: number) {
    const rated = this.ac.data.propulsion.ratedPowerW;
    this.ac.pilot.throttle = this.throttleLoop.update(fraction - this.ac.powerplant.out.enginePower / rated);
  }
}

/** Run the world for some seconds, calling `each` before every step. */
export function fly(world: PhysicsWorld, seconds: number, each: (t: number) => void | boolean) {
  let t = 0;
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (each(t) === true) return t;
    world.step(dt);
    t += dt;
  }
  return t;
}
