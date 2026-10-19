// Wind presets for the field (runway 18/36). Entered the way a pilot reads a forecast:
// direction the wind blows FROM (degrees true) and speed in knots; the wind model
// converts to SI. gustKt is the extra speed the strongest gusts add on top of the mean.

export type TurbulenceLevel = 'none' | 'light' | 'moderate' | 'severe';

export interface WindPreset {
  name: string;
  fromDeg: number;
  speedKt: number;
  gustKt: number;
  turbulence: TurbulenceLevel;
}

export const WIND_PRESETS: WindPreset[] = [
  { name: 'Calm', fromDeg: 0, speedKt: 0, gustKt: 0, turbulence: 'none' },
  { name: 'Light northerly (headwind rwy 36)', fromDeg: 360, speedKt: 8, gustKt: 0, turbulence: 'light' },
  { name: 'Southerly 12 kt gusting (headwind rwy 18)', fromDeg: 180, speedKt: 12, gustKt: 6, turbulence: 'light' },
  { name: 'Quartering 220/10', fromDeg: 220, speedKt: 10, gustKt: 4, turbulence: 'light' },
  { name: 'Crosswind from east 10 kt', fromDeg: 90, speedKt: 10, gustKt: 0, turbulence: 'light' },
  { name: 'Crosswind from west 15 kt gusting 22', fromDeg: 270, speedKt: 15, gustKt: 7, turbulence: 'moderate' },
  { name: 'Strong crosswind 300/20 gusting 28', fromDeg: 300, speedKt: 20, gustKt: 8, turbulence: 'moderate' },
];

/**
 * RMS turbulence velocity for each level, m/s, at 20 ft and above in the lower layers
 * (in the spirit of MIL-F-8785C: light ≈ 15 kt surface wind, moderate ≈ 30 kt, severe ≈ 45 kt,
 * scaled to σ ≈ 0.1 x wind). Gentle numbers: these are small aircraft near the ground.
 */
export const TURBULENCE_SIGMA_MPS: Record<TurbulenceLevel, number> = {
  none: 0,
  light: 0.7,
  moderate: 1.5,
  severe: 3.0,
};

/** Model constants for the wind field. */
export const WIND_MODEL = {
  /**
   * Wind shear near the ground. Reported wind is measured at 10 m; below that friction
   * with the grass slows it, above it speeds up. Power law V(h) = V10 (h/10)^α with
   * α ≈ 1/7 for open farmland, held constant above shearTop_m.
   */
  shearExponent: 0.14,
  referenceHeight_m: 10,
  shearTop_m: 300,
  minHeight_m: 0.5,
  /** Gusts: mean time between gust onsets, s, and gust rise-and-fall duration range, s. */
  gustMeanInterval_s: 6,
  gustDuration_s: [2, 5] as const,
  /** Smallest gust as a fraction of gustKt. */
  gustMinFraction: 0.4,
  /** Gusts also veer/back the wind a little, rad at full gust. */
  gustDirectionSwing_rad: 0.15,
  /** Turbulence correlation length, m (low-level Dryden scale of a few hundred feet). */
  turbulenceLength_m: 150,
  /** Vertical turbulence is weaker than horizontal near the ground. */
  verticalTurbulenceRatio: 0.6,
  /** Reference speed used for the turbulence time scale when the observer is slow, m/s. */
  turbulenceMinSpeed_mps: 10,
};
