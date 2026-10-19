import type { EngineTempsData } from '../aircraft/schema';

/** Standard-day temperature the data file's figures are quoted at, °C. */
const DATA_AMBIENT_C = 15;
/**
 * Slowest cooling air we allow, m/s: even standing still with the engine stopped, warm fins
 * set up some natural convection, so the head never heats without limit.
 */
const MIN_COOLING_SPEED_MPS = 2;
/**
 * Forced-convection heat transfer from finned cylinders grows roughly with the square root
 * of the cooling-air speed (laminar-ish flow between closely spaced fins).
 */
const COOLING_EXPONENT = 0.5;
/**
 * A pilot warms the engine up at a fast idle before take-off. A reset starts the engine as
 * if it had just done that: temperatures settled at this fraction of rated power.
 */
const WARM_UP_POWER_FRACTION = 0.2;

export interface EngineTempsInput {
  running: boolean;
  /** Fuel-air charge flow as a fraction of rated (Powerplant chargeFlow): heat follows fuel burnt. */
  powerFraction: number;
  /** Airspeed along the aircraft's axis, m/s. */
  airspeed: number;
  /** Extra dynamic pressure in the slipstream, Pa, and air density, kg/m³. */
  slipstreamPressure: number;
  density: number;
  /** Outside air temperature, °C. */
  oat_C: number;
}

/**
 * Air-cooled engine temperatures for the gauges.
 *
 * Cylinder heads (CHT): a lump of metal heated by combustion and cooled by air over its fins.
 * Heat in is proportional to the fuel burnt (the charge flow, manifold pressure x rpm); heat out is proportional to the head's
 * temperature rise above the outside air times a heat-transfer coefficient that grows with
 * cooling-air speed (∝ V^0.5). So the head settles where they balance:
 *     ΔT_eq = ΔT_climb · (charge flow / rated) · (V_ref / V_cool)^0.5
 * calibrated so a full-power climb (cooling air at V_ref) gives the data file's CHT. The head
 * moves towards that temperature exponentially with its thermal time constant (minutes).
 * Cooling air is the airspeed plus part of the propeller's slipstream speed-up, which is why
 * a long full-power ground run or a slow climb runs hot, and a fast glide at idle cools down.
 *
 * Exhaust gas (EGT): follows power quickly (seconds) between its idle and full-power values,
 * and falls to the head temperature when the engine stops.
 */
export class EngineTemps {
  cht_C: number;
  egt_C: number;
  private readonly chtRise: number;

  constructor(private readonly data: EngineTempsData, oat_C = DATA_AMBIENT_C) {
    this.chtRise = data.chtClimb_C - DATA_AMBIENT_C;
    this.cht_C = this.egt_C = oat_C;
  }

  /** Cooling-air speed over the fins, m/s: airspeed plus the share of slipstream they see. */
  coolingSpeed(inp: EngineTempsInput): number {
    const v = Math.max(inp.airspeed, 0);
    // Slipstream speed from its extra dynamic pressure: ½ρV_s² = ½ρV² + Δq.
    const vSlip = Math.sqrt(v * v + (2 * Math.max(inp.slipstreamPressure, 0)) / inp.density);
    return Math.max(v + this.data.slipstreamCooling * (vSlip - v), MIN_COOLING_SPEED_MPS);
  }

  /** Temperatures the engine would settle at in this condition, °C. */
  equilibrium(inp: EngineTempsInput): { cht: number; egt: number } {
    const heat = inp.running ? Math.max(inp.powerFraction, 0) : 0;
    const cooling = Math.pow(this.data.refCoolingSpeed_mps / this.coolingSpeed(inp), COOLING_EXPONENT);
    const cht = inp.oat_C + this.chtRise * heat * cooling;
    const d = this.data;
    const egt = inp.running ? inp.oat_C - DATA_AMBIENT_C + d.egtIdle_C + (d.egtFull_C - d.egtIdle_C) * Math.min(heat, 1) : this.cht_C;
    return { cht, egt };
  }

  step(dt: number, inp: EngineTempsInput): void {
    const eq = this.equilibrium(inp);
    this.cht_C += (eq.cht - this.cht_C) * Math.min(1, dt / this.data.chtTimeConstant_s);
    this.egt_C += (eq.egt - this.egt_C) * Math.min(1, dt / this.data.egtTimeConstant_s);
  }

  /**
   * Jump straight to the settled temperatures: in flight, for the current condition; on the
   * ground, as after a warm-up run (a warmed-up engine ready for take-off).
   */
  settle(inp: EngineTempsInput, onGround = false): void {
    const eq = this.equilibrium(onGround ? { ...inp, powerFraction: Math.max(inp.powerFraction, WARM_UP_POWER_FRACTION) } : inp);
    this.cht_C = eq.cht;
    this.egt_C = eq.egt;
  }
}
