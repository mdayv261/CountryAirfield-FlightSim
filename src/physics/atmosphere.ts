// International Standard Atmosphere (ISA), troposphere only (below 11 km, far above
// anything these aircraft reach). Inputs and outputs are SI.

/** Sea-level standard temperature, K (15 °C). */
export const ISA_T0 = 288.15;
/** Sea-level standard pressure, Pa. */
export const ISA_P0 = 101325;
/** Temperature lapse rate in the troposphere, K/m (2 °C per 1000 ft, near enough). */
export const ISA_LAPSE = 0.0065;
/** Specific gas constant for dry air, J/(kg K). */
export const R_AIR = 287.05287;
/** Ratio of specific heats for air. */
export const GAMMA_AIR = 1.4;
/** Standard gravity used to define the ISA, m/s². */
const G0 = 9.80665;
/** Exponent g0 / (R L) in the pressure law, ≈ 5.2559. */
const PRESSURE_EXPONENT = G0 / (R_AIR * ISA_LAPSE);
/** Top of the troposphere, m. */
const TROPOPAUSE_M = 11000;

export interface AirState {
  /** Temperature, K. */
  temperature: number;
  /** Static pressure, Pa. */
  pressure: number;
  /** Density, kg/m³. */
  density: number;
  /** Speed of sound, m/s. */
  speedOfSound: number;
}

/**
 * Air properties at a pressure altitude (m above mean sea level).
 *
 * Temperature falls linearly with height. Pressure follows from hydrostatics (each
 * layer of air carries the weight of the air above it) combined with the gas law,
 * which gives p = p0 (T/T0)^(g0/(R L)). Density then comes from the gas law
 * p = ρ R T. deltaT shifts the whole temperature profile (hot or cold day) without
 * changing pressure, so a hot day gives thinner air and longer take-off rolls.
 */
export function isa(altitudeM: number, deltaT = 0): AirState {
  const h = Math.min(Math.max(altitudeM, -500), TROPOPAUSE_M);
  const tStd = ISA_T0 - ISA_LAPSE * h;
  const pressure = ISA_P0 * Math.pow(tStd / ISA_T0, PRESSURE_EXPONENT);
  const temperature = tStd + deltaT;
  const density = pressure / (R_AIR * temperature);
  const speedOfSound = Math.sqrt(GAMMA_AIR * R_AIR * temperature);
  return { temperature, pressure, density, speedOfSound };
}
