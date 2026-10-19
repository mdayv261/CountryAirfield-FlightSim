import * as THREE from 'three';
import type { AircraftData } from '../aircraft/schema';
import { GRAVITY } from '../core/constants';
import { AeroModel, emptyAeroOutput, type AeroOutput } from './aero';
import { AutoRudder } from './autoRudder';
import { Airframe, aircraftInertia } from './Airframe';
import { ISA_P0, ISA_T0, R_AIR } from './atmosphere';
import { Powerplant } from './powerplant';
import type { PhysicsEnvironment } from './PhysicsWorld';

/** Sea-level standard density, kg/m³: the reference for indicated airspeed. */
const RHO0 = ISA_P0 / (R_AIR * ISA_T0);
/** Recompute mass and inertia once this much fuel (kg) has been burnt. */
const MASS_UPDATE_KG = 0.05;

/** What the pilot is doing with the controls (fractions of full travel; signs as in the schema). */
export interface PilotControls {
  elevator: number;
  aileron: number;
  rudder: number;
  throttle: number;
  brakeLeft: number;
  brakeRight: number;
  /** Propeller rpm lever 0..1 (constant-speed propellers). */
  propLever: number;
}

/** Live flight data for gauges, HUD and tests. SI units; convert for display. */
export interface FlightState {
  /** True airspeed, m/s. */
  tas: number;
  /** Indicated (equivalent) airspeed, m/s: what the airspeed indicator shows. */
  ias: number;
  alpha: number;
  beta: number;
  /** Load factor along the body's up axis (g); 1 in level flight. */
  loadFactor: number;
  /** Height of the CG above the ground below, m. */
  heightAgl: number;
  verticalSpeed: number;
}

/** G-meter and structural limits. */
export interface GMonitor {
  /** Load factor as a G-meter shows it (lightly smoothed), g. */
  g: number;
  /** Highest and lowest readings since the last reset (the G-meter's tell-tale needles). */
  max: number;
  min: number;
  /** Within 10 % of a limit (or beyond it). */
  warning: boolean;
  /** Latched once a limit has been exceeded: the airframe needs inspecting. Reset on respawn. */
  overstressed: boolean;
  /** Indicated airspeed above Vne right now, and latched if it ever was. */
  overspeed: boolean;
  overspeedLatched: boolean;
}

/** G-meter smoothing time constant, s: removes single-step spikes, keeps manoeuvre loads. */
const G_METER_LAG_S = 0.08;
/** Warn this close to a limit (fraction of the limit). */
const G_WARNING_FRACTION = 0.9;

/**
 * A fixed-wing aircraft: the Stage 3 airframe (rigid body + gear) plus aerodynamics,
 * engine and propeller, fuel, and the pilot's controls. Each physics step it:
 *  1. works out the air velocity relative to the aircraft (its velocity minus the wind),
 *  2. steps the engine and propeller (thrust along the propeller axis at the hub, and the
 *     propeller's torque reaction rolling the airframe the other way),
 *  3. adds aerodynamic forces and moments, with the slipstream feeding the tail,
 *  4. lets the gear react (pedals steer the tailwheel, toe brakes if fitted),
 *  5. burns fuel, updating mass and inertia as it goes.
 */
export class FixedWingAircraft extends Airframe {
  readonly aero: AeroModel;
  readonly powerplant: Powerplant;
  readonly pilot: PilotControls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeLeft: 0, brakeRight: 0, propLever: 1 };
  readonly aeroOut: AeroOutput = emptyAeroOutput();
  readonly state: FlightState = { tas: 0, ias: 0, alpha: 0, beta: 0, loadFactor: 1, heightAgl: 0, verticalSpeed: 0 };
  readonly gMonitor: GMonitor = { g: 1, max: 1, min: 1, warning: false, overstressed: false, overspeed: false, overspeedLatched: false };
  /** Fuel on board, litres. */
  fuelL: number;
  /** Auto-coordinated rudder pilot aid (adds to the pilot's rudder in flight). */
  autoRudderEnabled = false;
  readonly autoRudder = new AutoRudder();
  /** Total rudder actually applied this step: pilot plus aid, -1..1 (for the model and gauges). */
  rudderApplied = 0;

  private readonly propPosition: THREE.Vector3;
  /** +1 if the propeller turns clockwise seen from the cockpit (its torque rolls us left). */
  private readonly propSense: number;
  private massAtLastUpdate: number;
  private readonly wind = new THREE.Vector3();
  private readonly vAir = new THREE.Vector3();
  private readonly vAirBody = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly spinAxis: THREE.Vector3;
  private readonly propRadius: number;
  /** Angular momentum of the engine and propeller about the spin axis last step, kg m²/s. */
  private rotorMomentumPrev: number | null = null;

  constructor(data: AircraftData, fuelFraction = 1) {
    super(data, fuelFraction);
    if (!data.aero || !data.propeller || !data.engine)
      throw new Error(`${data.id} needs aero, propeller and engine data to fly`);
    const g = data.geometry;
    this.aero = new AeroModel(data.aero, g.wingArea_m2!, g.span_m!, g.chord_m ?? g.wingArea_m2! / g.span_m!);
    this.powerplant = new Powerplant(data);
    this.fuelL = data.mass.fuelCapacityL * fuelFraction;
    this.propPosition = new THREE.Vector3(...data.propeller.position_m);
    this.propSense = data.propeller.rotation === 'clockwise' ? 1 : -1;
    // Spin vector of the propeller: clockwise seen from the cockpit points forward (−z).
    this.spinAxis = new THREE.Vector3(0, 0, -this.propSense);
    this.propRadius = data.propulsion.propDiameter_m! / 2;
    this.massAtLastUpdate = this.body.mass;
  }

  override applyForces(env: PhysicsEnvironment, dt: number): void {
    const b = this.body;
    const p = this.pilot;
    // Pilot's rudder plus the auto-rudder aid, which works from last step's flight state.
    let aid = 0;
    if (this.autoRudderEnabled) {
      aid = this.autoRudder.update(dt, {
        beta: this.state.beta,
        yawRate: -b.angularVelocity.y,
        ias: this.state.ias,
        onGround: this.gear.states.some((g) => g.inContact),
      });
    } else {
      this.autoRudder.reset();
    }
    this.rudderApplied = Math.max(-1, Math.min(1, p.rudder + aid));
    Object.assign(this.controls, { pedals: this.rudderApplied, brakeLeft: p.brakeLeft, brakeRight: p.brakeRight });
    super.applyForces(env, dt); // gear

    const air = env.air(b.position.y);
    env.windAt(b.position, this.wind);
    this.vAir.subVectors(b.velocity, this.wind);
    b.toBody(this.vAir, this.vAirBody);

    // Engine and propeller. The propeller feels the airflow along its axis (forward is −z).
    const pp = this.powerplant.step(dt, {
      throttle: p.throttle,
      propLever: p.propLever,
      airspeed: -this.vAirBody.z,
      density: air.density,
      pressure: air.pressure,
      loadFactor: this.gMonitor.g,
      fuelAvailable: this.fuelL > 0,
    });
    this.applyPropellerEffects(pp.thrust, pp.propTorque, pp.slipstreamPressure, dt);

    const heightAgl = b.position.y - env.ground.heightAt(b.position.x, b.position.z);
    const a = this.aero.compute(
      {
        airVelocityBody: this.vAirBody,
        omegaBody: b.angularVelocity,
        density: air.density,
        controls: { elevator: p.elevator, aileron: p.aileron, rudder: this.rudderApplied },
        heightAboveGround: heightAgl,
        slipstreamPressure: pp.slipstreamPressure,
      },
      this.aeroOut,
    );
    b.addForce(b.toWorld(a.force, this.tmp));
    b.addTorque(a.moment);

    this.burnFuel(pp.fuelFlow * dt);

    // Load factor: everything except gravity, per unit weight, along the body's up axis.
    // This is what the pilot's seat (and a G-meter) feels.
    const specific = this.tmp.copy(b.netForce).addScaledVector(this.tmp2.set(0, -GRAVITY * b.mass, 0), -1);
    const up = b.toWorld(this.tmp2.set(0, 1, 0));
    const s = this.state;
    s.loadFactor = specific.dot(up) / (b.mass * GRAVITY);
    s.tas = a.airspeed;
    s.ias = a.airspeed * Math.sqrt(air.density / RHO0);
    s.alpha = a.alpha;
    s.beta = a.beta;
    s.heightAgl = heightAgl;
    s.verticalSpeed = b.velocity.y;
    this.updateGMonitor(dt);
  }

  /**
   * Everything the spinning propeller does to the airframe besides plain thrust:
   *
   *  - P-factor: with the nose up, air comes up through the disc. The blade going down meets
   *    it at a bigger angle and pulls harder than the blade going up, so the thrust centre
   *    shifts towards the descending side (right, for a clockwise prop) and yaws the nose left.
   *    Sideslip shifts it up or down the same way. Offset = pFactor x radius x sin(flow angle).
   *  - Torque reaction: the engine twists the airframe the opposite way to the propeller:
   *    the propeller's aerodynamic torque plus whatever is spent speeding the rotors up (dH/dt).
   *  - Gyroscopic precession: the rotors carry angular momentum H along the shaft. Turning the
   *    shaft (pitching or yawing) needs a torque −ω × H on the airframe: pitch up with a
   *    clockwise prop and the nose swings right; lift the tail on take-off and it swings left.
   *  - Slipstream swirl: the corkscrewing slipstream strikes one side of the fin (the left,
   *    for a clockwise prop), yawing the nose left at high power and low speed.
   */
  private applyPropellerEffects(thrust: number, propTorque: number, slipstreamPressure: number, dt: number): void {
    const b = this.body;
    const pr = this.data.propeller!;
    // Air flowing through the disc (opposite to our motion through the air), and its part across the shaft.
    const w = this.tmp.copy(this.vAirBody).negate();
    const V = w.length();
    const offset = this.tmp2.set(0, 0, 0);
    if (V > 1 && pr.pFactor) {
      w.z = 0; // remove the component along the shaft (z axis)
      offset.crossVectors(this.spinAxis, w).multiplyScalar((pr.pFactor * this.propRadius) / V);
    }
    offset.add(this.propPosition);
    b.addForceAtBodyPoint(b.toWorld(this.tmp.set(0, 0, -thrust), this.vAir), offset);
    this.vAir.subVectors(b.velocity, this.wind); // restore (used as scratch above)

    const pp = this.powerplant;
    const H = pp.crankInertia * pp.omega + pp.propInertia * (pp.omega / pp.ratio);
    const dHdt = this.rotorMomentumPrev === null ? 0 : (H - this.rotorMomentumPrev) / dt;
    this.rotorMomentumPrev = H;
    // Reaction torque: −(aerodynamic torque + dH/dt) along the spin axis.
    b.addTorque(this.tmp.copy(this.spinAxis).multiplyScalar(-(propTorque + dHdt)));
    // Gyroscopic torque on the airframe: −ω × H.
    b.addTorque(this.tmp.copy(this.spinAxis).multiplyScalar(H).cross(b.angularVelocity));

    if (pr.swirlYawCn) {
      const S = this.aero.area;
      // Left yaw (about +y) for a clockwise propeller.
      b.addTorque(this.tmp.set(0, this.propSense * pr.swirlYawCn * slipstreamPressure * S * this.aero.span, 0));
    }
  }

  /** G-meter, structural limit warnings and over-stress / over-speed flags. */
  private updateGMonitor(dt: number): void {
    const m = this.gMonitor;
    m.g += (this.state.loadFactor - m.g) * Math.min(1, dt / G_METER_LAG_S);
    m.max = Math.max(m.max, m.g);
    m.min = Math.min(m.min, m.g);
    const lim = this.data.limits;
    const hi = lim.gMax ?? Infinity;
    const lo = lim.gMin ?? -Infinity;
    m.warning = m.g > G_WARNING_FRACTION * hi || m.g < G_WARNING_FRACTION * lo;
    if (m.g > hi || m.g < lo) m.overstressed = true;
    m.overspeed = lim.vne_mps !== undefined && this.state.ias > lim.vne_mps;
    if (m.overspeed) m.overspeedLatched = true;
  }

  /** Clear the G-meter tell-tales and the over-stress and over-speed flags. */
  resetGMonitor(): void {
    Object.assign(this.gMonitor, { g: 1, max: 1, min: 1, warning: false, overstressed: false, overspeed: false, overspeedLatched: false });
  }

  /**
   * Line up on the ground at (x, z) facing headingDeg, refuelled, engine started at idle
   * and controls neutral: ready to take off.
   */
  resetOnGround(x: number, z: number, headingDeg: number, groundY: number): void {
    this.placeOnGround(x, z, headingDeg, groundY, 0.02);
    this.fuelL = this.data.mass.fuelCapacityL;
    this.body.mass = this.massAtLastUpdate = this.data.mass.emptyKg + this.data.mass.pilotKg + this.fuelL * this.data.mass.fuelDensityKgPerL;
    this.body.setInertia(aircraftInertia(this.data, this.body.mass));
    Object.assign(this.pilot, { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeLeft: 0, brakeRight: 0, propLever: 1 });
    this.powerplant.omega = 0;
    this.powerplant.throttleOpening = 0;
    this.powerplant.start();
    this.rotorMomentumPrev = null;
    this.resetGMonitor();
  }

  private burnFuel(kg: number): void {
    if (kg <= 0) return;
    this.fuelL = Math.max(0, this.fuelL - kg / this.data.mass.fuelDensityKgPerL);
    const m = this.data.mass;
    const mass = m.emptyKg + m.pilotKg + this.fuelL * m.fuelDensityKgPerL;
    if (Math.abs(mass - this.massAtLastUpdate) > MASS_UPDATE_KG) {
      this.body.mass = mass;
      this.body.setInertia(aircraftInertia(this.data, mass));
      this.massAtLastUpdate = mass;
    }
  }
}
