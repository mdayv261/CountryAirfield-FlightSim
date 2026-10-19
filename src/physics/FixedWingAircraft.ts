import * as THREE from 'three';
import type { AircraftData } from '../aircraft/schema';
import { GRAVITY } from '../core/constants';
import { AeroModel, emptyAeroOutput, type AeroOutput } from './aero';
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
  readonly pilot: PilotControls = { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeLeft: 0, brakeRight: 0 };
  readonly aeroOut: AeroOutput = emptyAeroOutput();
  readonly state: FlightState = { tas: 0, ias: 0, alpha: 0, beta: 0, loadFactor: 1, heightAgl: 0, verticalSpeed: 0 };
  /** Fuel on board, litres. */
  fuelL: number;

  private readonly propPosition: THREE.Vector3;
  /** +1 if the propeller turns clockwise seen from the cockpit (its torque rolls us left). */
  private readonly propSense: number;
  private massAtLastUpdate: number;
  private readonly wind = new THREE.Vector3();
  private readonly vAir = new THREE.Vector3();
  private readonly vAirBody = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

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
    this.massAtLastUpdate = this.body.mass;
  }

  override applyForces(env: PhysicsEnvironment, dt: number): void {
    const b = this.body;
    const p = this.pilot;
    Object.assign(this.controls, { pedals: p.rudder, brakeLeft: p.brakeLeft, brakeRight: p.brakeRight });
    super.applyForces(env, dt); // gear

    const air = env.air(b.position.y);
    env.windAt(b.position, this.wind);
    this.vAir.subVectors(b.velocity, this.wind);
    b.toBody(this.vAir, this.vAirBody);

    // Engine and propeller. The propeller feels the airflow along its axis (forward is −z).
    const pp = this.powerplant.step(dt, p.throttle, -this.vAirBody.z, air.density, this.fuelL > 0);
    b.addForceAtBodyPoint(b.toWorld(this.tmp.set(0, 0, -pp.thrust), this.tmp2), this.propPosition);
    b.addTorque(this.tmp.set(0, 0, this.propSense * pp.propTorque));

    const heightAgl = b.position.y - env.ground.heightAt(b.position.x, b.position.z);
    const a = this.aero.compute(
      {
        airVelocityBody: this.vAirBody,
        omegaBody: b.angularVelocity,
        density: air.density,
        controls: { elevator: p.elevator, aileron: p.aileron, rudder: p.rudder },
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
    Object.assign(this.pilot, { elevator: 0, aileron: 0, rudder: 0, throttle: 0, brakeLeft: 0, brakeRight: 0 });
    this.powerplant.omega = 0;
    this.powerplant.throttleOpening = 0;
    this.powerplant.start();
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
