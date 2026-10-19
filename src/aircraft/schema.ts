// Typed aircraft data schema. One JSON file per aircraft; every number is SI
// (m, kg, s, W, rad, m/s). Stage 1 holds identity, mass, geometry, engine
// rating, limits and the CLAUDE.md performance targets; Stage 3 adds inertia
// and landing gear. Later stages add aerodynamic tables, propeller and rotor data.
//
// BODY AXES (used for every position and inertia in these files):
//   origin at the centre of gravity, x to the right wing, y up, z towards the tail.
//   So "forward" is -z. These are the three.js axes of the model, which means a
//   level aircraft facing north has the identity orientation in the world
//   (+X east, +Y up, +Z south). Roll is about z, pitch about x, yaw about y.

export type AircraftType = 'fixedWing' | 'gyroplane';
export type PropLayout = 'tractor' | 'pusher';
export type GearLayout = 'tricycle' | 'taildragger';

export interface Propulsion {
  layout: PropLayout;
  engineName: string;
  /** Rated (maximum continuous) shaft power at the crankshaft, W. */
  ratedPowerW: number;
  /** Crankshaft rpm at rated power. */
  ratedRpm: number;
  /** Engine rpm / propeller rpm. 1 = direct drive. */
  reductionRatio: number;
  propDiameter_m?: number;
  constantSpeedProp?: boolean;
}

export interface MassData {
  emptyKg: number;
  maxKg: number;
  pilotKg: number;
  fuelCapacityL: number;
  fuelDensityKgPerL: number;
}

export interface Geometry {
  span_m?: number;
  wingArea_m2?: number;
  chord_m?: number;
  rotorDiameter_m?: number;
  rotorBlades?: number;
}

export type GearKind = 'wheel' | 'skid';

/**
 * One landing-gear leg (or a skid/bumper point such as a tail skid or wingtip).
 * The strut works along the body's -y axis: position_m is the tyre's contact
 * point with the strut fully extended; as the ground pushes it up, the strut
 * compresses and a spring plus damper push back.
 */
export interface GearLeg {
  name: string;
  kind: GearKind;
  /** Contact point at full extension, body axes, m. */
  position_m: [number, number, number];
  /** Strut spring rate, N/m. */
  spring_N_per_m: number;
  /** Strut damping, N per (m/s). */
  damper_Ns_per_m: number;
  /** Strut travel before it bottoms on its stop, m. */
  travel_m: number;
  /** Maximum steering angle with full pedal, rad (wheels only; 0 or absent = castoring/fixed). */
  steerMax_rad?: number;
  /** Wheel has a brake. */
  brake?: boolean;
  tyreRadius_m?: number;
}

export interface GearData {
  layout: GearLayout;
  brakes: boolean;
  legs: GearLeg[];
}

/**
 * Moments of inertia about the CG at maximum mass, kg m². Scaled linearly with
 * actual mass. Roll is about the body z (fore-aft) axis, pitch about x
 * (spanwise), yaw about y (vertical). rollYaw is the cross product of inertia.
 */
export interface Inertia {
  roll_kgm2: number;
  pitch_kgm2: number;
  yaw_kgm2: number;
  rollYaw_kgm2?: number;
}

export interface Limits {
  vne_mps?: number;
  vno_mps?: number;
  va_mps?: number;
  gMax?: number;
  gMin?: number;
  rotorRpmMin?: number;
  rotorRpmMax?: number;
  invertedSystems?: boolean;
}

/** Performance targets from CLAUDE.md; the sim must hit these within ±10 %. */
export interface Targets {
  stall_mps?: number;
  cruise_mps?: number;
  maxSpeed_mps?: number;
  vx_mps?: number;
  vy_mps?: number;
  climb_mps?: number;
  takeoffRoll_m?: number;
  landingRoll_m?: number;
}

export interface AircraftData {
  id: string;
  name: string;
  type: AircraftType;
  propulsion: Propulsion;
  mass: MassData;
  geometry: Geometry;
  gear: GearData;
  inertia: Inertia;
  limits: Limits;
  targets: Targets;
  /** Free-text provenance and assumptions; not used by the physics. */
  notes?: string[];
}

export class AircraftDataError extends Error {
  constructor(id: string, problems: string[]) {
    super(`Aircraft data "${id}" is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'AircraftDataError';
  }
}

type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check a parsed JSON object against the schema and return it typed.
 * Throws AircraftDataError listing every problem found, so a bad edit to a
 * data file fails loudly at load time rather than as odd flight behaviour.
 */
export function validateAircraftData(raw: unknown): AircraftData {
  const problems: string[] = [];
  const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : '<unknown>';
  if (!isObj(raw)) throw new AircraftDataError(id, ['top level is not an object']);

  const section = (key: string): Rec => {
    const v = raw[key];
    if (!isObj(v)) {
      problems.push(`missing section "${key}"`);
      return {};
    }
    return v;
  };

  const str = (obj: Rec, path: string, key: string): void => {
    if (typeof obj[key] !== 'string' || (obj[key] as string).length === 0)
      problems.push(`${path}${key} must be a non-empty string`);
  };

  const oneOf = (obj: Rec, path: string, key: string, allowed: readonly string[]): void => {
    if (!allowed.includes(obj[key] as string))
      problems.push(`${path}${key} must be one of ${allowed.join(', ')}`);
  };

  // Numeric check with a plausible range; catches unit mistakes such as
  // entering knots where m/s is expected.
  const num = (obj: Rec, path: string, key: string, min: number, max: number, required = true): void => {
    const v = obj[key];
    if (v === undefined && !required) return;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      problems.push(`${path}${key} must be a finite number`);
    } else if (v < min || v > max) {
      problems.push(`${path}${key} = ${v} is outside the plausible range ${min}..${max}`);
    }
  };

  str(raw, '', 'id');
  str(raw, '', 'name');
  oneOf(raw, '', 'type', ['fixedWing', 'gyroplane']);

  const p = section('propulsion');
  oneOf(p, 'propulsion.', 'layout', ['tractor', 'pusher']);
  str(p, 'propulsion.', 'engineName');
  num(p, 'propulsion.', 'ratedPowerW', 1_000, 1_000_000);
  num(p, 'propulsion.', 'ratedRpm', 500, 10_000);
  num(p, 'propulsion.', 'reductionRatio', 0.5, 5);
  num(p, 'propulsion.', 'propDiameter_m', 0.5, 4, false);

  const m = section('mass');
  num(m, 'mass.', 'emptyKg', 10, 5_000);
  num(m, 'mass.', 'maxKg', 10, 5_000);
  num(m, 'mass.', 'pilotKg', 30, 200);
  num(m, 'mass.', 'fuelCapacityL', 0, 1_000);
  num(m, 'mass.', 'fuelDensityKgPerL', 0.6, 0.9);
  if (typeof m.emptyKg === 'number' && typeof m.maxKg === 'number' && m.maxKg <= m.emptyKg)
    problems.push('mass.maxKg must exceed mass.emptyKg');

  const g = section('geometry');
  num(g, 'geometry.', 'span_m', 1, 30, false);
  num(g, 'geometry.', 'wingArea_m2', 1, 100, false);
  num(g, 'geometry.', 'chord_m', 0.2, 5, false);
  num(g, 'geometry.', 'rotorDiameter_m', 1, 20, false);
  num(g, 'geometry.', 'rotorBlades', 2, 6, false);
  if (raw.type === 'fixedWing' && (g.span_m === undefined || g.wingArea_m2 === undefined))
    problems.push('fixed-wing aircraft need geometry.span_m and geometry.wingArea_m2');
  if (raw.type === 'gyroplane' && g.rotorDiameter_m === undefined)
    problems.push('gyroplanes need geometry.rotorDiameter_m');

  const gear = section('gear');
  oneOf(gear, 'gear.', 'layout', ['tricycle', 'taildragger']);
  if (typeof gear.brakes !== 'boolean') problems.push('gear.brakes must be true or false');
  if (!Array.isArray(gear.legs) || gear.legs.length < 3) {
    problems.push('gear.legs must list at least three legs');
  } else {
    gear.legs.forEach((leg: unknown, i: number) => {
      const path = `gear.legs[${i}].`;
      if (!isObj(leg)) return void problems.push(`${path} must be an object`);
      str(leg, path, 'name');
      oneOf(leg, path, 'kind', ['wheel', 'skid']);
      const pos = leg.position_m;
      if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Math.abs(v) <= 10))
        problems.push(`${path}position_m must be three numbers within ±10 m`);
      num(leg, path, 'spring_N_per_m', 100, 1_000_000);
      num(leg, path, 'damper_Ns_per_m', 0, 100_000);
      num(leg, path, 'travel_m', 0.005, 1);
      num(leg, path, 'steerMax_rad', 0, 1.6, false);
      num(leg, path, 'tyreRadius_m', 0.02, 1, false);
      if (leg.brake !== undefined && typeof leg.brake !== 'boolean') problems.push(`${path}brake must be true or false`);
    });
  }

  const inertia = section('inertia');
  for (const k of ['roll_kgm2', 'pitch_kgm2', 'yaw_kgm2']) num(inertia, 'inertia.', k, 1, 100_000);
  num(inertia, 'inertia.', 'rollYaw_kgm2', -10_000, 10_000, false);

  const lim = section('limits');
  num(lim, 'limits.', 'vne_mps', 10, 150, false);
  num(lim, 'limits.', 'vno_mps', 10, 150, false);
  num(lim, 'limits.', 'va_mps', 10, 150, false);
  num(lim, 'limits.', 'gMax', 1, 12, false);
  num(lim, 'limits.', 'gMin', -10, 0, false);
  num(lim, 'limits.', 'rotorRpmMin', 0, 1_000, false);
  num(lim, 'limits.', 'rotorRpmMax', 0, 1_000, false);

  const t = section('targets');
  for (const k of ['stall_mps', 'cruise_mps', 'maxSpeed_mps', 'vx_mps', 'vy_mps'])
    num(t, 'targets.', k, 5, 150, false);
  num(t, 'targets.', 'climb_mps', 0.5, 30, false);
  num(t, 'targets.', 'takeoffRoll_m', 5, 2_000, false);
  num(t, 'targets.', 'landingRoll_m', 1, 2_000, false);

  if (problems.length > 0) throw new AircraftDataError(id, problems);
  return raw as unknown as AircraftData;
}
