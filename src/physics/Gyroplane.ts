import * as THREE from 'three';
import type { AircraftData } from '../aircraft/schema';
import { LiftingSurfaces } from './liftingSurfaces';
import { PoweredAircraft, type AeroContext, type AeroSummary } from './PoweredAircraft';
import { Rotor } from './rotor';

/** Low-g warning threshold (load factor, g). Below about half a g a teetering rotor is losing its authority. */
const LOW_G = 0.5;
/** Power pushover: low g with at least this much throttle, so the high thrust line is pitching the nose down. */
const PUSHOVER_THROTTLE = 0.4;
const PUSHOVER_G = 0.3;

/** Lateral stick deflection beyond which the pilot is flying it and stick-free stability has faded out. */
const STICK_FREE_BAND = 0.15;

/** The prerotator clutch starts to bite this far above the engine's stall rpm (fraction of stall rpm). */
const PREROTATOR_BITE_FRACTION = 1.15;

/** Gyroplane warnings for the HUD and tests. */
export interface GyroWarnings {
  /** Load factor below 0.5 g in flight: the rotor is unloading and losing rpm and control. */
  lowG: boolean;
  /** Very low g with power on: the propeller thrust line, above the CG, is pitching the nose
   * down while the unloaded rotor can no longer stop it (power pushover / bunt). */
  pushover: boolean;
  /** Rotor rpm below the flying minimum while airborne. */
  lowRotorRpm: boolean;
  /** Rotor over its maximum rpm. */
  rotorOverspeed: boolean;
}

/**
 * A gyroplane: the powered airframe (engine, pusher propeller with its thrust line above
 * the CG, gear, fuel) plus a free-spinning rotor (rotor.ts) and an open frame with a fin,
 * rudder and small tailplane (liftingSurfaces.ts). The stick tilts the rotor head; pedals
 * work the rudder and steer the nosewheel; a held button engages the prerotator.
 */
export class Gyroplane extends PoweredAircraft {
  readonly rotor: Rotor;
  readonly surfaces: LiftingSurfaces;
  readonly warnings: GyroWarnings = { lowG: false, pushover: false, lowRotorRpm: false, rotorOverspeed: false };
  private readonly force = new THREE.Vector3();
  private readonly moment = new THREE.Vector3();
  private readonly finArm: number;
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();

  constructor(data: AircraftData, fuelFraction = 1) {
    super(data, fuelFraction);
    if (!data.rotor || !data.airframeAero || !data.geometry.rotorDiameter_m)
      throw new Error(`${data.id} needs rotor, airframeAero and geometry.rotorDiameter_m to fly as a gyroplane`);
    this.rotor = new Rotor(data.rotor, data.geometry.rotorDiameter_m, data.geometry.rotorBlades ?? 2);
    this.surfaces = new LiftingSurfaces(data.airframeAero);
    const fin = data.airframeAero.surfaces.find((s) => s.plane === 'yaw');
    this.finArm = fin ? Math.abs(fin.position_m[2]) : 1;
  }

  protected applyAirframeAero(c: AeroContext): AeroSummary {
    const b = this.body;
    const p = this.pilot;
    const r = this.rotor.step(c.dt, {
      airVelocityBody: c.airVelocityBody,
      omegaBody: b.angularVelocity,
      density: c.density,
      stickPitch: p.elevator,
      stickRoll: p.aileron + this.stickFreeRoll(),
      prerotator: p.prerotator * this.prerotatorEngagement(),
      engineRunning: this.powerplant.running,
      hubHeight: c.heightAgl + this.data.rotor!.hubPosition_m[1],
    });
    this.force.copy(r.force);
    this.moment.copy(r.moment);
    this.surfaces.compute(c.airVelocityBody, b.angularVelocity, c.density, this.rudderApplied, c.slipstreamPressure, this.force, this.moment);
    b.addForce(b.toWorld(this.force));
    b.addTorque(this.moment);

    this.updateWarnings();
    const v = c.airVelocityBody;
    const V = v.length();
    return {
      airspeed: V,
      alpha: V > 0.3 ? Math.atan2(-v.y, -v.z) : 0,
      beta: V > 0.3 ? Math.asin(Math.max(-1, Math.min(1, v.x / V))) : 0,
    };
  }

  /**
   * How much of its torque the prerotator clutch can pass, 0..1, from engine speed. A pilot
   * engages it progressively with the engine at around 2,000–2,500 rpm; at idle a hard
   * engagement would stall the engine. So the clutch passes torque in proportion to how far
   * the engine is running above its stall speed (from 15 % above it), reaching full torque at
   * fullTorqueEngineRpm. The engine then slows towards the bite point but cannot stall.
   * Holding the prerotator at idle turns the rotor slowly; adding power spins it up.
   */
  prerotatorEngagement(): number {
    const pre = this.data.rotor!.prerotator;
    const lo = PREROTATOR_BITE_FRACTION * this.data.engine!.stallRpm;
    const hi = pre.fullTorqueEngineRpm ?? 0.6 * this.data.propulsion.ratedRpm;
    return Math.max(0, Math.min(1, (this.powerplant.rpm - lo) / (hi - lo)));
  }

  /**
   * Stick-free roll stability, in stick units. A stock B-8M is spirally neutral to slightly
   * unstable: let go and a bank slowly develops, because the big fin keeps sideslip (and so the
   * rotor's natural roll-restoring tendency) tiny. Modern gyros are trimmed and rigged to fly
   * hands-off; we model the result: with the stick released sideways, the head floats so as to
   * keep the rotor disc level (and resists roll rate, for damping). The airframe hangs beneath
   * with a slight list that balances the propeller's torque, and the gyro flies straight. As the
   * pilot moves the stick it fades out, so deliberate inputs feel unchanged. Not on the ground.
   */
  private stickFreeRoll(): number {
    const r = this.data.rotor!;
    const gain = r.stickFreeRollGain ?? 0;
    if (gain === 0 || this.gear.states.some((s) => s.inContact)) return 0;
    const free = Math.max(0, 1 - Math.abs(this.pilot.aileron) / STICK_FREE_BAND);
    if (free === 0) return 0;
    // Bank of the rotor disc: its axis's lean towards the body's right, in the horizontal plane.
    const disc = this.body.toWorld(this.tmpUp.copy(this.rotor.discAxis));
    const right = this.body.toWorld(this.tmpRight.set(1, 0, 0));
    right.y = 0;
    right.normalize();
    const discBank = Math.atan2(disc.dot(right), disc.y);
    const p = -this.body.angularVelocity.z;
    const tilt = -gain * discBank - (r.stickFreeRollDamping_s ?? 0) * p; // rad of head roll
    return (free * tilt) / ((r.headRollRange_deg * Math.PI) / 180);
  }

  /** The prerotator's drive takes its power from the engine. */
  protected override accessoryLoad(): number {
    return this.rotor.out.prerotatorPower;
  }

  protected swirlReference(): { area: number; length: number } {
    return { area: this.surfaces.finArea, length: this.finArm };
  }

  override resetOnGround(x: number, z: number, headingDeg: number, groundY: number): void {
    super.resetOnGround(x, z, headingDeg, groundY);
    this.rotor.stop();
    Object.assign(this.warnings, { lowG: false, pushover: false, lowRotorRpm: false, rotorOverspeed: false });
  }

  private updateWarnings(): void {
    const w = this.warnings;
    const airborne = this.gear.states.every((s) => !s.inContact);
    const g = this.gMonitor.g;
    const lim = this.data.limits;
    w.lowG = airborne && g < LOW_G;
    w.pushover = airborne && g < PUSHOVER_G && this.pilot.throttle > PUSHOVER_THROTTLE;
    w.lowRotorRpm = airborne && lim.rotorRpmMin !== undefined && this.rotor.rpm < lim.rotorRpmMin;
    w.rotorOverspeed = lim.rotorRpmMax !== undefined && this.rotor.rpm > lim.rotorRpmMax;
  }
}
