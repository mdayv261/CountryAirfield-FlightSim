import * as THREE from 'three';
import { FIELD_ELEVATION_M } from '../core/constants';
import { mpsToFpm, mpsToKt, mToFt, paToInHg, radToDeg } from '../core/units';
import { Gyroplane } from '../physics/Gyroplane';
import type { PoweredAircraft } from '../physics/PoweredAircraft';

/**
 * Instrument lags, s. A real VSI works from a calibrated leak, so it trails the true climb
 * rate by a few seconds; the wet compass card is damped by its fluid. Both the gauges and the
 * HUD show these same indicated values, so they always agree.
 */
export const INSTRUMENT_LAG = { vsi_s: 1.0, compass_s: 0.3 };

/** Everything the gauges and the HUD display, in display units (kt, ft, fpm, °, g, °C, inHg, L). */
export interface InstrumentReadings {
  iasKt: number;
  /** Altitude above sea level (altimeter set to the field's QNH), ft. */
  altitudeFt: number;
  /** Height above the ground below the wheels, ft. */
  aglFt: number;
  vsiFpm: number;
  /** True heading, degrees 0..360 (DG and HUD; the map has no magnetic variation). */
  headingDeg: number;
  /** Wet compass: the same heading with its fluid damping, degrees 0..360. */
  compassDeg: number;
  pitchDeg: number;
  /** Bank, right wing down positive, degrees. */
  bankDeg: number;
  /** Slip ball displacement, degrees of apparent-gravity angle; positive = ball to the right. */
  slipDeg: number;
  g: number;
  gMax: number;
  gMin: number;
  /** Wind at the aircraft: direction it blows from (true), degrees, and speed, kt. */
  windFromDeg: number;
  windKt: number;
  engineRpm: number;
  /** Rotor rpm (gyroplanes), else null. */
  rotorRpm: number | null;
  mapInHg: number;
  fuelL: number;
  chtC: number | null;
  egtC: number | null;
  /** Throttle lever position 0..1. */
  throttle: number;
}

/** Bearing (degrees true, 0..360) of a direction in the world's horizontal plane: +X east, −Z north. */
export function bearingDeg(x: number, z: number): number {
  return (((Math.atan2(x, -z) * 180) / Math.PI) % 360 + 360) % 360;
}

/** Move an angle (degrees) towards a target the short way round, by fraction k. */
function approachAngle(from: number, to: number, k: number): number {
  const d = ((to - from + 540) % 360) - 180;
  return (from + d * k + 360) % 360;
}

/**
 * Reads the aircraft's state and turns it into what the instruments indicate. Updated once
 * per displayed frame; the panel gauges and the HUD both read `readings`.
 */
export class Instruments {
  readonly readings: InstrumentReadings = {
    iasKt: 0, altitudeFt: 0, aglFt: 0, vsiFpm: 0, headingDeg: 0, compassDeg: 0, pitchDeg: 0, bankDeg: 0, slipDeg: 0,
    g: 1, gMax: 1, gMin: 1, windFromDeg: 0, windKt: 0, engineRpm: 0, rotorRpm: null, mapInHg: 0, fuelL: 0, chtC: null,
    egtC: null, throttle: 0,
  };
  private initialised = false;
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /** Snap the lagging instruments to the current values (after a reset or aircraft change). */
  reset(): void {
    this.initialised = false;
  }

  /**
   * @param ac the aircraft
   * @param wind wind velocity at the aircraft, world axes, m/s (the direction it blows towards)
   * @param dt display frame time, s (0 while paused)
   */
  update(ac: PoweredAircraft, wind: THREE.Vector3, dt: number): InstrumentReadings {
    const r = this.readings;
    const s = ac.state;
    const b = ac.body;
    const fwd = b.toWorld(this.fwd.set(0, 0, -1));
    const right = b.toWorld(this.right.set(1, 0, 0));
    const up = b.toWorld(this.up.set(0, 1, 0));

    r.iasKt = mpsToKt(s.ias);
    r.altitudeFt = mToFt(b.position.y + FIELD_ELEVATION_M);
    // Height of the wheels (lowest gear contact point) above the ground; level attitude assumed.
    const gearDrop = -Math.min(...ac.data.gear.legs.map((l) => l.position_m[1]));
    r.aglFt = mToFt(Math.max(0, s.heightAgl - gearDrop));
    r.headingDeg = bearingDeg(fwd.x, fwd.z);
    r.pitchDeg = radToDeg(Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)));
    r.bankDeg = radToDeg(Math.atan2(-right.y, up.y));
    // The ball sits where apparent gravity (the opposite of the seat's push) points across the tube.
    r.slipDeg = radToDeg(Math.atan2(-s.lateralG, Math.max(Math.abs(s.loadFactor), 0.05)));
    const vsi = mpsToFpm(s.verticalSpeed);
    if (!this.initialised) {
      r.vsiFpm = vsi;
      r.compassDeg = r.headingDeg;
    } else {
      r.vsiFpm += (vsi - r.vsiFpm) * Math.min(1, dt / INSTRUMENT_LAG.vsi_s);
      r.compassDeg = approachAngle(r.compassDeg, r.headingDeg, Math.min(1, dt / INSTRUMENT_LAG.compass_s));
    }
    this.initialised = true;

    const gm = ac.gMonitor;
    r.g = gm.g;
    r.gMax = gm.max;
    r.gMin = gm.min;
    // Wind blows towards `wind`; it comes from the opposite bearing.
    r.windFromDeg = bearingDeg(-wind.x, -wind.z);
    r.windKt = mpsToKt(Math.hypot(wind.x, wind.z));

    const pp = ac.powerplant;
    r.engineRpm = pp.out.engineRpm;
    r.rotorRpm = ac instanceof Gyroplane ? ac.rotor.rpm : null;
    r.mapInHg = paToInHg(pp.out.manifoldPressure);
    r.fuelL = ac.fuelL;
    r.chtC = ac.temps?.cht_C ?? null;
    r.egtC = ac.temps?.egt_C ?? null;
    r.throttle = ac.pilot.throttle;
    return r;
  }
}
