import type { SoundData } from '../aircraft/schema';
import { stallWarning } from '../cockpit/stallWarning';
import { GRAVITY } from '../core/constants';
import { Gyroplane } from '../physics/Gyroplane';
import type { PoweredAircraft } from '../physics/PoweredAircraft';

// What each sound source should be doing this frame, worked out from the physics. Pure
// functions of the aircraft state (no Web Audio here) so they can be tested in Node; the
// voices in voices.ts turn these numbers into sound.

/** Engine level never quite reaches zero while running (idle is still audible), fraction. */
const IDLE_LEVEL = 0.3;
/** Airspeed at which wind noise reaches full level, m/s (about 60 kt). */
const WIND_FULL_MPS = 31;
/** Wind roar band: centre frequency at rest and its rise per m/s of airspeed, Hz. */
const WIND_BASE_HZ = 250;
const WIND_HZ_PER_MPS = 22;
/** An enclosed cabin keeps out most of the wind roar and the engine's highs. */
export const CABIN = { windFactor: 0.3, engineCutoffHz: 2200 };
/** Rotor speed at which the swish reaches its full level, rpm. */
const ROTOR_FULL_RPM = 350;

export interface EngineSound {
  /** Fundamental of the engine note: the firing frequency, Hz. */
  firingHz: number;
  /** Output level 0..1. */
  level: number;
  /** Low-pass cutoff, Hz: opens up with throttle. */
  cutoffHz: number;
  /** Exhaust noise level 0..1, band centre Hz, and how hard each firing pulses it 0..1. */
  noiseLevel: number;
  noiseHz: number;
  pulse: number;
  /** Crankshaft-rate throb (cylinder-to-cylinder variation), Hz and level. */
  throbHz: number;
  throbLevel: number;
  /** Belt whine (belt teeth passing a pulley), Hz and level; 0 without a belt drive. */
  beltHz: number;
  beltLevel: number;
  /** Propeller blade-passing frequency, Hz, and buzz level. */
  propHz: number;
  propLevel: number;
}

/**
 * Engine and propeller. The firing frequency is the physics: rpm/60 x cylinders x 2/strokes
 * (a two-stroke fires every turn, a four-stroke every other), so the Hirth single, the
 * McCulloch flat-4 two-stroke and the Lycoming flat-4 four-stroke each have their own pitch
 * at their own rpm. The tone colour (harmonics) comes from the data file. Level and
 * brightness follow throttle opening and rpm; the prop buzz follows its blade-passing rate.
 */
export function engineSound(ac: PoweredAircraft, snd: SoundData): EngineSound {
  const pp = ac.powerplant;
  const rated = ac.data.propulsion.ratedRpm;
  const rpmFrac = Math.max(0, pp.rpm / rated);
  const running = pp.running;
  const open = pp.throttleOpening;
  const e = snd.engine;
  const level = running ? e.loudness * (IDLE_LEVEL + (1 - IDLE_LEVEL) * open) * Math.sqrt(Math.min(rpmFrac, 1.2)) : 0;
  const mix = (a: [number, number], t: number) => a[0] + (a[1] - a[0]) * Math.min(1, Math.max(0, t));
  const propRev = pp.out.propRpm / 60;
  return {
    firingHz: pp.out.vibrationHz,
    level,
    cutoffHz: mix(e.brightnessHz, open) * Math.max(0.3, Math.min(rpmFrac, 1.2)),
    noiseLevel: level * e.noise,
    noiseHz: mix(e.noiseBandHz, open * rpmFrac),
    pulse: e.pulse,
    throbHz: pp.rpm / 60,
    throbLevel: level * e.throb,
    beltHz: snd.beltWhine ? (pp.rpm / 60) * snd.beltWhine.teethPerRev : 0,
    beltLevel: snd.beltWhine && running ? snd.beltWhine.level * Math.min(rpmFrac, 1.2) : 0,
    propHz: propRev * snd.prop.blades,
    // A spinning prop buzzes with or without the engine (windmilling), growing with speed squared.
    propLevel: snd.prop.level * Math.min(1, (pp.out.propRpm / (rated / ac.data.propulsion.reductionRatio)) ** 2),
  };
}

/**
 * Wind noise: turbulent flow over the airframe and round the pilot's head. Its loudness grows
 * with dynamic pressure (airspeed squared) and its pitch rises with speed. Open cockpits roar;
 * a cabin keeps most of it out.
 */
export function windSound(iasMps: number, snd: SoundData): { level: number; centreHz: number } {
  const v = Math.max(0, iasMps);
  const level = Math.min(1, (v / WIND_FULL_MPS) ** 2) * (snd.cockpit === 'enclosed' ? CABIN.windFactor : 1);
  return { level, centreHz: WIND_BASE_HZ + WIND_HZ_PER_MPS * v };
}

/**
 * Rotor swish: each blade sweeps past the listener once per revolution, so the noise beats at
 * the blade-passing rate (blades x rpm / 60, about 12 Hz at 360 rpm for two blades). Louder
 * with rotor speed and with the load on the rotor (a loaded blade "chops" harder).
 */
export function rotorSound(ac: PoweredAircraft, snd: SoundData): { swishHz: number; level: number; bandHz: number } {
  if (!(ac instanceof Gyroplane) || !snd.rotorSwish) return { swishHz: 0, level: 0, bandHz: 0 };
  const rpm = ac.rotor.rpm;
  const load = Math.min(1.5, Math.max(0.2, ac.rotor.out.thrust / (ac.body.mass * GRAVITY)));
  return {
    swishHz: (rpm / 60) * (ac.data.geometry.rotorBlades ?? 2),
    level: snd.rotorSwish.level * Math.min(1, (rpm / ROTOR_FULL_RPM) ** 2) * load,
    bandHz: snd.rotorSwish.bandHz,
  };
}

/** Stall warning horn: sounds while the stall warning is on (aircraft that have a horn). */
export function stallHorn(ac: PoweredAircraft, snd: SoundData): { on: boolean; frequencyHz: number; level: number } {
  if (!snd.stallHorn) return { on: false, frequencyHz: 0, level: 0 };
  return { on: stallWarning(ac), frequencyHz: snd.stallHorn.frequencyHz, level: snd.stallHorn.level };
}

/**
 * Hearing it from outside: level falls off with distance (inverse distance beyond a few metres)
 * and the pitch rises as it approaches and drops as it goes away (Doppler).
 */
export const LISTENER = { referenceDistance_m: 8, speedOfSound_mps: 343 };

export function outsideHearing(distance: number, closingSpeed: number): { gain: number; doppler: number } {
  const gain = Math.min(1, LISTENER.referenceDistance_m / Math.max(distance, 1e-3));
  // Moving source, still listener: f' = f · c / (c − v_closing).
  const v = Math.max(-0.5, Math.min(0.5, closingSpeed / LISTENER.speedOfSound_mps));
  return { gain, doppler: 1 / (1 - v) };
}
