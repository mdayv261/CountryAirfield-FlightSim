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
//
// ANGLES: radians, except tables and control throws whose keys end in _deg, which are
// in degrees for readability and are converted when the physics loads them.
//
// AERODYNAMIC SIGN CONVENTIONS (the usual pilot's ones, whatever the body axes):
//   alpha positive = nose above the flight path; beta positive = airflow from the right;
//   roll moment positive = right wing down; pitch positive = nose up; yaw positive = nose right;
//   p, q, r = roll, pitch, yaw rates in that same sense.
//   Control deflections are positive in the direction that makes a positive moment
//   (elevator: stick back; aileron: stick right; rudder: right pedal).

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

/**
 * Whole-aircraft aerodynamic data, coefficients on the wing reference area, span and chord.
 * CL and CD come from tables against angle of attack (covering ±180° so any attitude works:
 * normal flight, the stall break, and flat-plate flow beyond it). Everything else is a
 * stability or control derivative: the change in a coefficient per radian of angle, or
 * per unit of non-dimensional rate (p̂ = p b / 2V, q̂ = q c / 2V, r̂ = r b / 2V).
 */
export interface AeroData {
  alpha_deg: number[];
  CL: number[];
  CD: number[];
  /** Extra pitching moment at each alpha (stall pitch break), same grid. */
  CmExtra: number[];
  /** Multiplier on roll damping Clp at each alpha (drops, even reverses, when stalled), same grid. */
  rollDampingFactor: number[];
  /** Optional multiplier on yaw damping Cnr at each alpha (falls in a deep stall: spins), same grid. */
  yawDampingFactor?: number[];
  /**
   * Optional multiplier on rudder power at each alpha, same grid. In a deep stall the fin and
   * rudder sit in the wake of the stalled wing and tailplane and lose much of their bite.
   */
  rudderFactor?: number[];
  /** Span efficiency for the induced-drag part, used for ground effect. */
  oswald: number;
  CLq: number;
  CLde: number;
  CYbeta: number;
  CYdr: number;
  Clbeta: number;
  Clp: number;
  /** Roll due to yaw rate grows with lift: Clr = Clr_perCL x CL. */
  Clr_perCL: number;
  Clda: number;
  Cm0: number;
  Cmalpha: number;
  Cmq: number;
  Cmde: number;
  Cnbeta: number;
  Cnr: number;
  /** Yaw due to roll rate (adverse) grows with lift: Cnp = Cnp_perCL x CL. */
  Cnp_perCL: number;
  Cndr: number;
  /** Adverse yaw from aileron deflection (negative = yaws away from the roll). */
  Cnda: number;
  /** Extra drag per radian² of control deflection. */
  CDcontrol: number;
  elevatorMax_deg: number;
  aileronMax_deg: number;
  rudderMax_deg: number;
  /** Share of the propeller slipstream's extra dynamic pressure that reaches the tail (tractor). */
  tailSlipstream: number;
  /**
   * Wing rigging incidence: how far the wing chord is set nose-up from the fuselage (body)
   * axis, degrees. The tables are against the wing's angle, so alpha_wing = alpha_body + this.
   */
  wingIncidence_deg?: number;
}

/** Fixed-pitch or constant-speed propeller performance against advance ratio J = V / (n D). */
export interface PropellerData {
  /** Geometric pitch, m (for reference; the CT/CP tables carry the behaviour). */
  pitch_m: number;
  /** Hub position (thrust line), body axes, m. */
  position_m: [number, number, number];
  J: number[];
  /** Thrust coefficient: T = CT ρ n² D⁴ (n in rev/s). */
  CT: number[];
  /** Power coefficient: P = CP ρ n³ D⁵. */
  CP: number[];
  /** Propeller moment of inertia about its shaft, kg m². */
  inertia_kgm2: number;
  /** Direction of rotation seen from the cockpit looking forward. */
  rotation: 'clockwise' | 'anticlockwise';
  /**
   * P-factor: at angle of attack the descending blade takes a bigger bite, moving the thrust
   * centre sideways by pFactor x radius x sin(flow angle to the axis). Typically 0.2–0.5.
   */
  pFactor?: number;
  /**
   * Slipstream swirl: the corkscrewing slipstream strikes one side of the fin. Yaw moment
   * coefficient per unit of slipstream dynamic pressure (on wing area and span).
   */
  swirlYawCn?: number;
  /** Present for a constant-speed propeller: governor and blade pitch range. */
  constantSpeed?: {
    /** Engine rpm with the lever fully back and fully forward. */
    rpmMin: number;
    rpmMax: number;
    /** Blade pitch range as multiples of the reference pitch of the CT/CP tables. */
    pitchScaleMin: number;
    pitchScaleMax: number;
    /** Pitch-scale rate per unit fractional rpm error, 1/s. */
    governorGain: number;
    /** Fastest pitch change the hub can make, pitch scale per second. */
    pitchRateMax: number;
  };
}

export interface EngineData {
  strokes: 2 | 4;
  cylinders: number;
  /** Full-throttle power curve: rpm against fraction of rated power. */
  rpm: number[];
  powerFraction: number[];
  /** Fraction of full-throttle torque available with the throttle closed (idle air bleed), at idleRpm. */
  idleThrottle: number;
  /**
   * Nominal idle speed. The idle bleed lets through a fixed amount of air per second, so above
   * this rpm its torque falls in proportion (the engine brakes in a fast glide).
   */
  idleRpm: number;
  /** Throttle (carburettor) response time constant, s. */
  throttleLag_s: number;
  /** Crankshaft, flywheel and drive pulley inertia, kg m² (engine side of the reduction). */
  inertia_kgm2: number;
  /** Internal friction and pumping torque: a + b x rpm, N m. */
  frictionTorque_Nm: number;
  frictionPerRpm_Nm: number;
  /** Below this rpm a running engine dies. */
  stallRpm: number;
  /** Specific fuel consumption, kg per kWh. */
  bsfc_kgPerkWh: number;
  /** Belt or gearbox efficiency between crank and propeller. */
  driveEfficiency: number;
  /** Cylinder-head and exhaust temperatures (gauges); see physics/engineTemps.ts. */
  temps?: EngineTempsData;
}

/**
 * Engine temperature model, °C on a standard (15 °C) day. CHT is set by the balance between
 * heat from burning fuel (proportional to power) and the air blowing over the fins.
 */
export interface EngineTempsData {
  /** Cylinder-head temperature at rated power with cooling air at refCoolingSpeed_mps, °C. */
  chtClimb_C: number;
  /** Speed of the cooling air over the fins in that full-power climb, m/s. */
  refCoolingSpeed_mps: number;
  /** How quickly the heads warm or cool (thermal mass over cooling), s. */
  chtTimeConstant_s: number;
  /** Share of the propeller slipstream's speed-up that reaches the cooling fins (0..1). */
  slipstreamCooling: number;
  /** Exhaust-gas temperature at idle and at full power, °C, and its response time, s. */
  egtIdle_C: number;
  egtFull_C: number;
  egtTimeConstant_s: number;
}

/**
 * Gyroplane rotor: free-spinning, teetering, fixed blade pitch. Used by the blade-element /
 * momentum autorotation model (physics/rotor.ts).
 */
export interface RotorData {
  /** Rotor hub (teeter bolt), body axes, m. */
  hubPosition_m: [number, number, number];
  bladeChord_m: number;
  /** Blade section lift slope, per radian. */
  liftSlope: number;
  /** Mean blade profile drag coefficient. */
  profileDrag: number;
  /** Fixed blade pitch (gyro blades have no collective), degrees. */
  collectivePitch_deg: number;
  /** Highest thrust coefficient over solidity before the blades stall. */
  maxCTOverSolidity: number;
  /** Rotor moment of inertia about the mast, kg m². */
  inertia_kgm2: number;
  /** Head (spindle) tilted back from the mast with the stick neutral, degrees. */
  headNeutralPitch_deg: number;
  /**
   * Head tilted right with the stick neutral, degrees: the rigging that cancels propeller
   * torque at cruise power, so the gyro flies wings-level hands off.
   */
  headNeutralRoll_deg?: number;
  /** Head tilt from full stick: forward, and left and right (±), degrees. */
  headPitchRange_deg: number;
  headRollRange_deg: number;
  /** Head tilt from full back stick, degrees (more than forward, to load the rotor on take-off). */
  headPitchBackRange_deg?: number;
  /**
   * Stick-free roll stability (hands-off trim, as on modern gyros): with the stick released
   * sideways, the head leans against any bank by this many degrees per degree of bank, plus
   * stickFreeRollDamping_s seconds of roll rate. Fades out as the pilot moves the stick.
   */
  stickFreeRollGain?: number;
  stickFreeRollDamping_s?: number;
  /** Largest blowback (disc tilting back with speed), degrees. */
  maxBlowback_deg: number;
  /** Bearing friction torque, N m. */
  bearingFriction_Nm: number;
  /** Direction of rotation seen from above. */
  rotation: 'clockwise' | 'anticlockwise';
  /**
   * Engine-driven prerotator: full torque, the rotor rpm it cannot drive beyond, and the
   * engine rpm at which its clutch transmits full torque (it takes less as the engine nears
   * idle, so it never stalls the engine).
   */
  prerotator: { torque_Nm: number; maxRpm: number; fullTorqueEngineRpm?: number };
}

/** A tail surface treated as a small wing (gyroplanes). */
export interface SurfaceData {
  name: string;
  /** Centre of pressure, body axes, m. */
  position_m: [number, number, number];
  /** 'yaw' = vertical fin (lift sideways); 'pitch' = horizontal tailplane (lift up). */
  plane: 'yaw' | 'pitch';
  area_m2: number;
  aspectRatio: number;
  /** Lift slope per radian, peak lift coefficient, and drag at zero lift. */
  liftSlope: number;
  CLmax: number;
  CD0: number;
  /** Rudder on this surface: lift coefficient per radian of deflection, and its throw. */
  rudderPower?: number;
  rudderMax_deg?: number;
  /** Share of the propeller slipstream's extra dynamic pressure the surface sits in. */
  slipstream?: number;
  /** Fixed rigging angle, degrees: for a fin, offset to cancel propeller yaw (positive = as right rudder). */
  rigging_deg?: number;
}

/** Airframe aerodynamics for aircraft without a wing: body drag and tail surfaces. */
export interface AirframeAeroData {
  /** Drag area (Cd x area) for head-on and side-on flow, m². */
  dragArea_m2: number;
  sideDragArea_m2: number;
  surfaces: SurfaceData[];
}

/** Gauges an instrument panel can carry (drawn in cockpit/gauges.ts). */
export const GAUGE_KINDS = [
  'asi', 'altimeter', 'vsi', 'tacho', 'rotorTacho', 'slip', 'compass', 'fuel', 'egt', 'cht',
  'attitude', 'dg', 'map', 'gmeter',
] as const;
export type GaugeKind = (typeof GAUGE_KINDS)[number];

/**
 * One gauge on the panel. Scales are in display units: knots, feet, fpm, rpm, litres, °C,
 * inHg, g, psi. Arcs are [from, to] on that scale.
 */
export interface GaugeData {
  kind: GaugeKind;
  /** Centre of the dial from the panel centre, m (x right, y up on the panel face). */
  at_m: [number, number];
  /** Dial diameter, m (a standard 3 1/8 in instrument is 0.08 m, 2 1/4 in is 0.057 m). */
  diameter_m: number;
  min?: number;
  max?: number;
  green?: [number, number];
  yellow?: [number, number];
  /** Red line on the scale. */
  redline?: number;
  /** For an airspeed indicator: the white (flap) arc, if any. */
  white?: [number, number];
  /** 'dial' (needle, the default) or 'lcd' (digital readout, as wide as diameter_m). */
  style?: 'dial' | 'lcd';
}

/** The instrument panel (or pod): a flat face in the cockpit with its gauges. */
export interface PanelData {
  /** Centre of the panel face, body axes, m. */
  position_m: [number, number, number];
  /** Width and height of the face, m. */
  size_m: [number, number];
  /** Face leaned back from vertical, degrees (towards the pilot's eye). */
  tilt_deg: number;
  /** Panel colour, as a CSS colour. */
  colour: string;
  /** Cockpit view: how far the pilot's head looks down from the fuselage line, degrees. */
  lookDown_deg: number;
  /** An open-cockpit pod stands on a post down to this airframe point (body axes, m). */
  postTo_m?: [number, number, number];
  gauges: GaugeData[];
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
  aero?: AeroData;
  rotor?: RotorData;
  airframeAero?: AirframeAeroData;
  propeller?: PropellerData;
  engine?: EngineData;
  panel?: PanelData;
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

  // Flight-model sections are optional until each aircraft's stage, but checked if present.
  const numArray = (obj: Rec, path: string, key: string, len?: number): void => {
    const v = obj[key];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'number' && Number.isFinite(x)))
      problems.push(`${path}${key} must be an array of numbers`);
    else if (len !== undefined && v.length !== len) problems.push(`${path}${key} must have ${len} entries (one per table row)`);
  };
  const ascending = (obj: Rec, path: string, key: string): void => {
    const v = obj[key];
    if (Array.isArray(v) && v.some((x, i) => i > 0 && x <= v[i - 1])) problems.push(`${path}${key} must be in ascending order`);
  };
  if (raw.aero !== undefined) {
    const a = section('aero');
    numArray(a, 'aero.', 'alpha_deg');
    ascending(a, 'aero.', 'alpha_deg');
    const n = Array.isArray(a.alpha_deg) ? a.alpha_deg.length : undefined;
    for (const k of ['CL', 'CD', 'CmExtra', 'rollDampingFactor']) numArray(a, 'aero.', k, n);
    if (a.yawDampingFactor !== undefined) numArray(a, 'aero.', 'yawDampingFactor', n);
    if (a.rudderFactor !== undefined) numArray(a, 'aero.', 'rudderFactor', n);
    for (const k of ['CLq', 'CLde', 'CYbeta', 'CYdr', 'Clbeta', 'Clp', 'Clr_perCL', 'Clda', 'Cm0', 'Cmalpha', 'Cmq', 'Cmde',
      'Cnbeta', 'Cnr', 'Cnp_perCL', 'Cndr', 'Cnda', 'CDcontrol'])
      num(a, 'aero.', k, -50, 50);
    num(a, 'aero.', 'oswald', 0.3, 1);
    for (const k of ['elevatorMax_deg', 'aileronMax_deg', 'rudderMax_deg']) num(a, 'aero.', k, 1, 60);
    num(a, 'aero.', 'tailSlipstream', 0, 1);
    num(a, 'aero.', 'wingIncidence_deg', -5, 10, false);
  }
  if (raw.rotor !== undefined) {
    const r = section('rotor');
    const hub = r.hubPosition_m;
    if (!Array.isArray(hub) || hub.length !== 3 || !hub.every((v) => typeof v === 'number'))
      problems.push('rotor.hubPosition_m must be three numbers');
    num(r, 'rotor.', 'bladeChord_m', 0.05, 1);
    num(r, 'rotor.', 'liftSlope', 3, 7);
    num(r, 'rotor.', 'profileDrag', 0.005, 0.05);
    num(r, 'rotor.', 'collectivePitch_deg', -2, 10);
    num(r, 'rotor.', 'maxCTOverSolidity', 0.05, 0.4);
    num(r, 'rotor.', 'inertia_kgm2', 1, 1000);
    num(r, 'rotor.', 'headNeutralPitch_deg', -10, 20);
    num(r, 'rotor.', 'headNeutralRoll_deg', -10, 10, false);
    num(r, 'rotor.', 'headPitchRange_deg', 1, 20);
    num(r, 'rotor.', 'headRollRange_deg', 1, 20);
    num(r, 'rotor.', 'headPitchBackRange_deg', 1, 30, false);
    num(r, 'rotor.', 'stickFreeRollGain', 0, 2, false);
    num(r, 'rotor.', 'stickFreeRollDamping_s', 0, 1, false);
    num(r, 'rotor.', 'maxBlowback_deg', 0, 20);
    num(r, 'rotor.', 'bearingFriction_Nm', 0, 50);
    oneOf(r, 'rotor.', 'rotation', ['clockwise', 'anticlockwise']);
    const pre = isObj(r.prerotator) ? r.prerotator : {};
    num(pre, 'rotor.prerotator.', 'torque_Nm', 1, 1000);
    num(pre, 'rotor.prerotator.', 'maxRpm', 10, 500);
    num(pre, 'rotor.prerotator.', 'fullTorqueEngineRpm', 500, 10_000, false);
  }
  if (raw.airframeAero !== undefined) {
    const f = section('airframeAero');
    num(f, 'airframeAero.', 'dragArea_m2', 0.01, 10);
    num(f, 'airframeAero.', 'sideDragArea_m2', 0.01, 20);
    if (!Array.isArray(f.surfaces)) problems.push('airframeAero.surfaces must be a list');
    else
      f.surfaces.forEach((s: unknown, i: number) => {
        const path = `airframeAero.surfaces[${i}].`;
        if (!isObj(s)) return void problems.push(`${path} must be an object`);
        str(s, path, 'name');
        oneOf(s, path, 'plane', ['yaw', 'pitch']);
        for (const [k, lo, hi] of [['area_m2', 0.01, 20], ['aspectRatio', 0.3, 20], ['liftSlope', 1, 7], ['CLmax', 0.3, 2], ['CD0', 0, 0.5]] as const)
          num(s, path, k, lo, hi);
        num(s, path, 'rudderPower', 0, 7, false);
        num(s, path, 'rudderMax_deg', 0, 45, false);
        num(s, path, 'slipstream', 0, 1, false);
        num(s, path, 'rigging_deg', -10, 10, false);
      });
  }
  if (raw.propeller !== undefined) {
    const pr = section('propeller');
    num(pr, 'propeller.', 'pitch_m', 0.1, 5);
    const pos = pr.position_m;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number'))
      problems.push('propeller.position_m must be three numbers');
    numArray(pr, 'propeller.', 'J');
    ascending(pr, 'propeller.', 'J');
    const n = Array.isArray(pr.J) ? pr.J.length : undefined;
    numArray(pr, 'propeller.', 'CT', n);
    numArray(pr, 'propeller.', 'CP', n);
    num(pr, 'propeller.', 'inertia_kgm2', 0.001, 50);
    oneOf(pr, 'propeller.', 'rotation', ['clockwise', 'anticlockwise']);
    num(pr, 'propeller.', 'pFactor', 0, 2, false);
    num(pr, 'propeller.', 'swirlYawCn', 0, 0.1, false);
    if (pr.constantSpeed !== undefined) {
      const cs = isObj(pr.constantSpeed) ? pr.constantSpeed : {};
      num(cs, 'propeller.constantSpeed.', 'rpmMin', 500, 10_000);
      num(cs, 'propeller.constantSpeed.', 'rpmMax', 500, 10_000);
      num(cs, 'propeller.constantSpeed.', 'pitchScaleMin', 0.2, 5);
      num(cs, 'propeller.constantSpeed.', 'pitchScaleMax', 0.2, 5);
      num(cs, 'propeller.constantSpeed.', 'governorGain', 0.01, 100);
      num(cs, 'propeller.constantSpeed.', 'pitchRateMax', 0.01, 10);
    }
    if (typeof p.propDiameter_m !== 'number') problems.push('a propeller needs propulsion.propDiameter_m');
  }
  if (raw.engine !== undefined) {
    const e = section('engine');
    num(e, 'engine.', 'strokes', 2, 4);
    num(e, 'engine.', 'cylinders', 1, 12);
    numArray(e, 'engine.', 'rpm');
    ascending(e, 'engine.', 'rpm');
    numArray(e, 'engine.', 'powerFraction', Array.isArray(e.rpm) ? e.rpm.length : undefined);
    num(e, 'engine.', 'idleThrottle', 0, 0.5);
    num(e, 'engine.', 'idleRpm', 300, 3000);
    num(e, 'engine.', 'throttleLag_s', 0, 2);
    num(e, 'engine.', 'inertia_kgm2', 0.001, 10);
    num(e, 'engine.', 'frictionTorque_Nm', 0, 200);
    num(e, 'engine.', 'frictionPerRpm_Nm', 0, 1);
    num(e, 'engine.', 'stallRpm', 100, 3000);
    num(e, 'engine.', 'bsfc_kgPerkWh', 0.15, 1);
    num(e, 'engine.', 'driveEfficiency', 0.5, 1);
    if (e.temps !== undefined) {
      const t = isObj(e.temps) ? e.temps : {};
      num(t, 'engine.temps.', 'chtClimb_C', 50, 350);
      num(t, 'engine.temps.', 'refCoolingSpeed_mps', 5, 100);
      num(t, 'engine.temps.', 'chtTimeConstant_s', 5, 1000);
      num(t, 'engine.temps.', 'slipstreamCooling', 0, 1);
      num(t, 'engine.temps.', 'egtIdle_C', 50, 1000);
      num(t, 'engine.temps.', 'egtFull_C', 200, 1100);
      num(t, 'engine.temps.', 'egtTimeConstant_s', 0.1, 60);
    }
  }

  if (raw.panel !== undefined) {
    const pn = section('panel');
    const pair = (v: unknown, lim: number) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Math.abs(x) <= lim);
    const pos = pn.position_m;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((v) => typeof v === 'number' && Math.abs(v) <= 10))
      problems.push('panel.position_m must be three numbers within ±10 m');
    if (!pair(pn.size_m, 3)) problems.push('panel.size_m must be [width, height] in metres');
    num(pn, 'panel.', 'tilt_deg', -60, 80);
    num(pn, 'panel.', 'lookDown_deg', 0, 45);
    const post = pn.postTo_m;
    if (post !== undefined && !(Array.isArray(post) && post.length === 3 && post.every((v) => typeof v === 'number' && Math.abs(v) <= 10)))
      problems.push('panel.postTo_m must be three numbers within ±10 m');
    str(pn, 'panel.', 'colour');
    if (!Array.isArray(pn.gauges)) problems.push('panel.gauges must be a list');
    else
      pn.gauges.forEach((gg: unknown, i: number) => {
        const path = `panel.gauges[${i}].`;
        if (!isObj(gg)) return void problems.push(`${path} must be an object`);
        oneOf(gg, path, 'kind', GAUGE_KINDS);
        if (!pair(gg.at_m, 2)) problems.push(`${path}at_m must be [x, y] in metres`);
        num(gg, path, 'diameter_m', 0.03, 0.15);
        if (gg.style !== undefined) oneOf(gg, path, 'style', ['dial', 'lcd']);
        for (const k of ['min', 'max', 'redline']) num(gg, path, k, -10_000, 100_000, false);
        for (const k of ['green', 'yellow', 'white'])
          if (gg[k] !== undefined && !pair(gg[k], 100_000)) problems.push(`${path}${k} must be [from, to]`);
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
