import * as THREE from 'three';
import { ktToMps, mpsToKt } from '../core/units';
import { mulberry32 } from '../world/noise';
import { TURBULENCE_SIGMA_MPS, WIND_MODEL, type TurbulenceLevel, type WindPreset } from './windPresets';

interface Gust {
  start: number;
  duration: number;
  /** Peak extra speed, m/s. */
  peak: number;
  /** Direction swing at the peak, rad (signed). */
  swing: number;
}

/**
 * The wind field: steady wind + gusts + turbulence. All internal values SI.
 *
 *  - Steady wind: speed and direction as reported at 10 m, with a power-law boundary
 *    layer so it is lighter near the ground and stronger aloft (wind shear on approach).
 *  - Gusts: discrete events arriving at random (Poisson) times. Each has a smooth
 *    "1 − cos" rise and fall over 2–5 s, the classic engineering gust shape, and swings
 *    the direction slightly.
 *  - Turbulence: three independent random signals (along-wind, cross-wind, vertical),
 *    each white noise passed through a first-order low-pass filter. This is the simple
 *    form of the Dryden model: its time scale is L/V, the time the aircraft takes to fly
 *    through one eddy of size L.
 *
 * Gusts and turbulence are functions of time and uniform across the (small) field, so
 * the windsock and the aircraft feel the same gust. Seeded, so tests are repeatable.
 */
export class WindModel {
  /** Mean speed at 10 m, m/s, and direction the wind blows FROM, rad clockwise from north. */
  speed = 0;
  fromRad = 0;
  /** Strongest gust increment, m/s. */
  gustAmplitude = 0;
  turbulence: TurbulenceLevel = 'none';
  /** Time since start, s. */
  time = 0;

  private readonly rng: () => number;
  private gusts: Gust[] = [];
  private nextGustAt = 0;
  /** Turbulence velocity in wind axes: along, across, vertical (m/s). */
  readonly turb = new THREE.Vector3();

  constructor(seed = 2026) {
    this.rng = mulberry32(seed);
    this.scheduleNextGust();
  }

  setSteady(fromDeg: number, speedKt: number): void {
    this.fromRad = (((fromDeg % 360) + 360) % 360) * (Math.PI / 180);
    this.speed = Math.max(0, ktToMps(speedKt));
  }

  applyPreset(p: WindPreset): void {
    this.setSteady(p.fromDeg, p.speedKt);
    this.gustAmplitude = ktToMps(p.gustKt);
    this.turbulence = p.turbulence;
  }

  /** Reported (10 m) wind as direction-from in degrees and speed in knots, for display. */
  get reported(): { fromDeg: number; speedKt: number } {
    return { fromDeg: (this.fromRad * 180) / Math.PI, speedKt: mpsToKt(this.speed) };
  }

  /** Advance gusts and turbulence by dt. observerSpeed sets the turbulence time scale. */
  update(dt: number, observerSpeed = 0): void {
    this.time += dt;
    while (this.time >= this.nextGustAt) {
      const [d0, d1] = WIND_MODEL.gustDuration_s;
      const size = WIND_MODEL.gustMinFraction + (1 - WIND_MODEL.gustMinFraction) * this.rng();
      this.gusts.push({
        start: this.nextGustAt,
        duration: d0 + (d1 - d0) * this.rng(),
        peak: size,
        swing: (this.rng() * 2 - 1) * WIND_MODEL.gustDirectionSwing_rad,
      });
      this.scheduleNextGust();
    }
    this.gusts = this.gusts.filter((g) => this.time < g.start + g.duration);

    // First-order filtered noise (Ornstein–Uhlenbeck). Per step: decay towards zero with
    // time constant tau, plus a random kick sized so the long-run RMS equals sigma.
    const sigma = TURBULENCE_SIGMA_MPS[this.turbulence];
    const tau = WIND_MODEL.turbulenceLength_m / Math.max(observerSpeed, WIND_MODEL.turbulenceMinSpeed_mps);
    const decay = Math.exp(-dt / tau);
    const kick = Math.sqrt(1 - decay * decay);
    const sig = [sigma, sigma, sigma * WIND_MODEL.verticalTurbulenceRatio];
    for (let i = 0; i < 3; i++) {
      this.turb.setComponent(i, this.turb.getComponent(i) * decay + sig[i] * kick * this.gaussian());
    }
  }

  /** Current gust as fractions: speed factor 0..1 of gustAmplitude, and direction swing (rad). */
  gustState(): { factor: number; swing: number } {
    let factor = 0;
    let swing = 0;
    if (this.gustAmplitude <= 0) return { factor, swing };
    for (const g of this.gusts) {
      const s = (this.time - g.start) / g.duration;
      if (s < 0 || s > 1) continue;
      const shape = 0.5 * (1 - Math.cos(2 * Math.PI * s)); // 1 − cos: 0 → 1 → 0
      factor = Math.max(factor, g.peak * shape);
      swing += g.swing * shape;
    }
    return { factor, swing };
  }

  /** Boundary-layer speed factor at height h above ground (1 at the 10 m reference height). */
  static shearFactor(heightAboveGround: number): number {
    const h = THREE.MathUtils.clamp(heightAboveGround, WIND_MODEL.minHeight_m, WIND_MODEL.shearTop_m);
    return Math.pow(h / WIND_MODEL.referenceHeight_m, WIND_MODEL.shearExponent);
  }

  /** Mean wind (no gusts or turbulence) at a height above ground, world axes, m/s. */
  steadyAt(heightAboveGround: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.vectorFor(this.fromRad, this.speed * WindModel.shearFactor(heightAboveGround), out);
  }

  /** Total air velocity at a height above ground, world axes, m/s. */
  velocityAt(heightAboveGround: number, out = new THREE.Vector3()): THREE.Vector3 {
    const { factor, swing } = this.gustState();
    const shear = WindModel.shearFactor(heightAboveGround);
    const speed = (this.speed + this.gustAmplitude * factor) * shear;
    const from = this.fromRad + swing;
    this.vectorFor(from, speed, out);
    // Turbulence is resolved in wind axes: along (downwind), across (to the right), up.
    const along = { x: -Math.sin(from), z: Math.cos(from) };
    out.x += this.turb.x * along.x - this.turb.y * along.z;
    out.z += this.turb.x * along.z + this.turb.y * along.x;
    out.y += this.turb.z;
    return out;
  }

  /** Headwind and crosswind components (m/s) for a runway heading. Positive cross = from the right. */
  components(runwayHeadingDeg: number): { head: number; cross: number } {
    const rel = this.fromRad - (runwayHeadingDeg * Math.PI) / 180;
    return { head: this.speed * Math.cos(rel), cross: this.speed * Math.sin(rel) };
  }

  private vectorFor(fromRad: number, speed: number, out: THREE.Vector3): THREE.Vector3 {
    // Air moves towards the opposite of "from": north is -Z, east is +X.
    return out.set(-Math.sin(fromRad) * speed, 0, Math.cos(fromRad) * speed);
  }

  private scheduleNextGust(): void {
    // Exponential waiting time gives randomly spaced (Poisson) gust arrivals.
    this.nextGustAt = this.time - WIND_MODEL.gustMeanInterval_s * Math.log(1 - this.rng());
  }

  /** Standard normal random number (Box–Muller). */
  private gaussian(): number {
    const u = Math.max(this.rng(), 1e-12);
    const v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
