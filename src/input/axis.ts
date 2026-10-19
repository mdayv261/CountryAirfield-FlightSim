// Pure maths for turning raw device readings into clean control values.

export interface AxisCalibration {
  /** Raw reading at each end of travel and at the centre (rest) position. */
  min: number;
  max: number;
  centre: number;
  /** Dead zone around centre (bipolar) or at the low end (unipolar), fraction of travel. */
  deadzone: number;
  invert: boolean;
}

/** A Gamepad API axis reads -1..+1 and rests at 0. */
export function defaultCalibration(deadzone = 0.05): AxisCalibration {
  return { min: -1, max: 1, centre: 0, deadzone, invert: false };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Dead zone with rescaling: values within ±dz read 0, and the rest of the range is
 * stretched so the output still reaches ±1 smoothly (no jump at the edge of the zone).
 */
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

/**
 * Stick or pedal axis to -1..+1. Each side of centre is scaled separately, so a
 * stick whose centre is not mid-travel still reads 0 at rest and ±1 at the stops.
 */
export function bipolarAxis(raw: number, cal: AxisCalibration): number {
  let v: number;
  if (raw >= cal.centre) v = cal.max > cal.centre ? (raw - cal.centre) / (cal.max - cal.centre) : 0;
  else v = cal.centre > cal.min ? (raw - cal.centre) / (cal.centre - cal.min) : 0;
  v = applyDeadzone(clamp(v, -1, 1), cal.deadzone);
  return cal.invert ? -v : v;
}

/** Throttle/brake/lever axis to 0..1 (min → 0, max → 1, or reversed if inverted). */
export function unipolarAxis(raw: number, cal: AxisCalibration): number {
  const span = cal.max - cal.min;
  let v = span !== 0 ? clamp((raw - cal.min) / span, 0, 1) : 0;
  if (cal.invert) v = 1 - v;
  return v <= cal.deadzone ? 0 : (v - cal.deadzone) / (1 - cal.deadzone);
}

/**
 * Keyboard ramp: a held key (direction ±1) moves the value towards that end at deflectRate;
 * with no key held (0) it returns to centre at centreRate. Gives smooth, stick-like inputs.
 */
export function rampAxis(value: number, direction: number, dt: number, deflectRate: number, centreRate: number): number {
  if (direction !== 0) {
    // Reversing direction passes through centre at the faster of the two rates.
    const rate = Math.sign(value) === -direction ? Math.max(deflectRate, centreRate) : deflectRate;
    return clamp(value + direction * rate * dt, -1, 1);
  }
  const step = centreRate * dt;
  return Math.abs(value) <= step ? 0 : value - Math.sign(value) * step;
}

/** Records the range of an axis while the user sweeps it, then gives its calibration. */
export class AxisCalibrator {
  private lo = Infinity;
  private hi = -Infinity;

  sample(raw: number): void {
    this.lo = Math.min(this.lo, raw);
    this.hi = Math.max(this.hi, raw);
  }

  /** Finish with the control at rest; that reading becomes the centre. */
  finish(restRaw: number, previous: AxisCalibration): AxisCalibration {
    this.sample(restRaw);
    if (this.hi - this.lo < 0.2) return previous; // barely moved: keep the old calibration
    return { ...previous, min: this.lo, max: this.hi, centre: restRaw };
  }
}

/** Index of the input that moved furthest from its baseline, if beyond the threshold. */
export function detectMovedInput(baseline: number[], current: number[], threshold: number): number | null {
  let best = -1;
  let bestDelta = threshold;
  current.forEach((v, i) => {
    const d = Math.abs(v - (baseline[i] ?? 0));
    if (d > bestDelta) {
      bestDelta = d;
      best = i;
    }
  });
  return best >= 0 ? best : null;
}
