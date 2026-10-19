import type { AircraftData, EngineData, PropellerData } from '../aircraft/schema';
import { ISA_P0, ISA_T0, R_AIR } from './atmosphere';
import { interp } from './table';

const TWO_PI = 2 * Math.PI;
const RPM_PER_RAD_S = 60 / TWO_PI;
/** Below this propeller speed (rev/s) we treat the propeller as stopped. */
const MIN_PROP_REV_S = 0.5;
const RHO0 = ISA_P0 / (R_AIR * ISA_T0);

/** Fuel and oil feed under negative g, for engines without inverted systems. */
export const FEED = {
  /** Load factor below which a float carburettor and wet-sump oil pickup lose their supply. */
  starveBelowG: 0.0,
  /** How long negative g must last before the engine starves, s (fuel in the float bowl). */
  starveAfter_s: 0.4,
  /** Positive g needed for this long before fuel and oil return, s. */
  recoverAfter_s: 0.6,
  /** Oil pressure falls / rises towards its new value with this time constant, s. */
  oilLag_s: 0.8,
};

/** Manifold pressure as a fraction of ambient: closed throttle about 0.3, wide open about 0.97. */
const MAP_CLOSED = 0.3;
const MAP_OPEN = 0.97;

export interface PowerplantInputs {
  throttle: number;
  /** Propeller rpm lever 0 (low rpm / coarse) .. 1 (high rpm / fine); constant-speed props only. */
  propLever?: number;
  /** Flow speed along the propeller axis, m/s (forward). */
  airspeed: number;
  density: number;
  /** Ambient static pressure, Pa (manifold pressure gauge). */
  pressure?: number;
  /** Load factor on the airframe (g), for fuel and oil feed. */
  loadFactor?: number;
  fuelAvailable?: boolean;
  /** Extra power drawn from the crankshaft by accessories (a rotor prerotator), W. */
  accessoryPower?: number;
}

export interface PowerplantOutput {
  /** Thrust along the propeller axis (forward), N. Negative when windmilling. */
  thrust: number;
  /** Aerodynamic torque the propeller takes from the shaft, N m. */
  propTorque: number;
  /** Shaft power delivered to the propeller, W. */
  propPower: number;
  /** Engine brake power, W. */
  enginePower: number;
  /**
   * Fuel-air charge flowing through the engine as a fraction of the flow at rated rpm, wide
   * open, at sea level: manifold pressure x rpm (the cylinders fill to manifold pressure on
   * every intake stroke). Heat into the cylinder heads follows it.
   */
  chargeFlow: number;
  engineRpm: number;
  propRpm: number;
  advanceRatio: number;
  /** Blade pitch as a multiple of the reference pitch (1 for a fixed-pitch propeller). */
  pitchScale: number;
  /** rpm the governor is aiming for (constant-speed props), else 0. */
  governorRpm: number;
  /** Manifold pressure, Pa. */
  manifoldPressure: number;
  /** Extra dynamic pressure in the slipstream, Pa (momentum theory: thrust / disc area). */
  slipstreamPressure: number;
  /** Fuel burn, kg/s. */
  fuelFlow: number;
  /** True while negative g has cut the fuel supply (engines without inverted systems). */
  fuelStarved: boolean;
  /** Oil pressure as a fraction of normal (falls when starved inverted). */
  oilPressure: number;
  /** Firing frequency, Hz, and a 0..1 vibration level for camera shake and sound. */
  vibrationHz: number;
  vibration: number;
}

/**
 * Piston engine driving a propeller, directly or through a belt reduction.
 *
 * Shaft dynamics, referred to the crankshaft:
 *     I_total dω/dt = engine torque − friction − propeller torque / (ratio x drive efficiency)
 * where I_total = crank inertia + propeller inertia / ratio² (a reduction makes the heavy
 * prop feel lighter to the engine by the square of the ratio, like a gearbox in a car).
 *
 * Engine torque: the power curve is brake power (what a dynamometer measures at the
 * crank, after internal friction). The burning charge makes that plus the friction (the
 * "indicated" torque), scaled by throttle opening; friction is then taken off. So at full
 * throttle the crank delivers exactly the published curve, and with the throttle closed
 * friction exceeds the small idle charge and the engine brakes. The opening runs from a
 * small idle bleed (closed) to 1, and follows the lever with a short lag.
 *
 * Altitude: a normally aspirated engine breathes thinner air, so full-throttle power falls
 * with density ratio σ = ρ/ρ0 by the Gagg–Ferrar rule, P/P0 = σ − (1 − σ)/7.55
 * (about 75 % of sea-level power at 8,000 ft).
 *
 * Propeller: thrust and absorbed power from its CT and CP curves against advance ratio
 * J = V / (n D): the distance flown per revolution in diameters. At J = 0 (standing still)
 * the blades work at high angle and give maximum thrust; as J rises the blade angle of
 * attack falls, until thrust reaches zero and then reverses (windmilling) in a dive.
 *
 * Constant-speed propeller: the blades can twist in the hub. We describe the pitch by a
 * scale s on the reference pitch; a coarser blade behaves like the reference blade at a
 * proportionally lower advance ratio, so  CT = s·CT_ref(J/s),  CP = s²·CP_ref(J/s).
 * The peak efficiency then moves to higher J as the pitch coarsens, as it does on a real
 * variable-pitch propeller. A governor (flyweights balancing a spring set by the rpm lever)
 * coarsens the blades when the rpm runs above the lever's setting and fines them when it
 * falls below, at a limited rate, between the fine and coarse stops. On the fine stop (low
 * power or speed) it behaves like a fixed-pitch propeller and the rpm falls below the setting.
 *
 * Negative g: a float carburettor and a wet-sump oil pickup only work with fuel and oil
 * pushed to the bottom. Under negative g they run dry after a moment: the engine loses
 * power (but keeps windmilling) and oil pressure falls, recovering once positive g returns.
 * Engines with inverted fuel and oil systems (aerobatic aircraft) carry on regardless.
 *
 * Vibration: a single-cylinder two-stroke fires once every revolution, about 100 Hz at
 * full power. That is above what a 120 Hz physics step can represent (anything above 60 Hz
 * would alias into a false low-frequency wobble), so we do not apply it as a force. It is
 * exposed as a frequency and level for camera shake and, in Stage 9, sound.
 */
export class Powerplant {
  /** Crankshaft speed, rad/s. */
  omega = 0;
  running = false;
  /** Throttle opening after the carburettor lag, 0..1. */
  throttleOpening = 0;
  /** Blade pitch scale (1 = reference pitch). */
  pitchScale: number;
  readonly out: PowerplantOutput = {
    thrust: 0,
    propTorque: 0,
    propPower: 0,
    enginePower: 0,
    chargeFlow: 0,
    engineRpm: 0,
    propRpm: 0,
    advanceRatio: 0,
    pitchScale: 1,
    governorRpm: 0,
    manifoldPressure: ISA_P0,
    slipstreamPressure: 0,
    fuelFlow: 0,
    fuelStarved: false,
    oilPressure: 0,
    vibrationHz: 0,
    vibration: 0,
  };
  readonly engine: EngineData;
  readonly prop: PropellerData;
  readonly ratio: number;
  readonly diameter: number;
  /** Inertia of the engine-side rotating parts and the propeller, kg m² (for gyroscopic effects). */
  readonly crankInertia: number;
  readonly propInertia: number;
  private readonly ratedPower: number;
  private readonly discArea: number;
  private readonly inertia: number;
  private readonly invertedSystems: boolean;
  private negativeGTime = 0;
  private positiveGTime = 0;
  private starved = false;
  private oil = 0;

  constructor(readonly data: AircraftData) {
    if (!data.engine || !data.propeller || !data.propulsion.propDiameter_m)
      throw new Error(`${data.id}: engine, propeller and propDiameter_m are needed for a powerplant`);
    this.engine = data.engine;
    this.prop = data.propeller;
    this.ratedPower = data.propulsion.ratedPowerW;
    this.ratio = data.propulsion.reductionRatio;
    this.diameter = data.propulsion.propDiameter_m;
    this.discArea = (Math.PI * this.diameter * this.diameter) / 4;
    this.crankInertia = this.engine.inertia_kgm2;
    this.propInertia = this.prop.inertia_kgm2;
    this.inertia = this.crankInertia + this.propInertia / (this.ratio * this.ratio);
    this.invertedSystems = data.limits.invertedSystems === true;
    this.pitchScale = this.prop.constantSpeed?.pitchScaleMin ?? 1;
  }

  get rpm(): number {
    return this.omega * RPM_PER_RAD_S;
  }

  /** Full-throttle brake power available at an engine rpm at sea level, W. */
  fullThrottlePower(rpm: number): number {
    return this.ratedPower * interp(this.engine.rpm, this.engine.powerFraction, rpm);
  }

  /** Fraction of sea-level power a normally aspirated engine makes at density ratio σ (Gagg–Ferrar). */
  static altitudeLapse(sigma: number): number {
    return Math.max(0, sigma - (1 - sigma) / 7.55);
  }

  /** Start the engine (recoil or electric starter): it catches and settles at its idle speed. */
  start(): void {
    this.running = true;
    this.omega = Math.max(this.omega, this.engine.idleRpm / RPM_PER_RAD_S);
    this.starved = false;
    this.negativeGTime = 0;
  }

  stop(): void {
    this.running = false;
  }

  /** Propeller thrust and shaft torque at a given prop speed (rev/s), airspeed and density. */
  propellerLoads(nRev: number, airspeed: number, density: number, pitchScale = this.pitchScale) {
    const D = this.diameter;
    if (nRev < MIN_PROP_REV_S) return { thrust: 0, torque: 0, power: 0, J: 0 };
    const J = Math.max(airspeed, 0) / (nRev * D);
    const s = pitchScale;
    const CT = s * interp(this.prop.J, this.prop.CT, J / s);
    const CP = s * s * interp(this.prop.J, this.prop.CP, J / s);
    const thrust = CT * density * nRev * nRev * D ** 4;
    const power = CP * density * nRev ** 3 * D ** 5;
    return { thrust, torque: power / (TWO_PI * nRev), power, J };
  }

  /** Advance the engine, governor and propeller by dt seconds. */
  step(dt: number, inp: PowerplantInputs): PowerplantOutput {
    const e = this.engine;
    if (inp.fuelAvailable === false) this.running = false;
    this.updateFeed(dt, inp.loadFactor ?? 1);

    // Carburettor lag: the opening follows the lever exponentially.
    const lag = e.throttleLag_s > 0 ? 1 - Math.exp(-dt / e.throttleLag_s) : 1;
    this.throttleOpening += (Math.min(1, Math.max(0, inp.throttle)) - this.throttleOpening) * lag;

    const rpm = this.rpm;
    const omega = Math.max(this.omega, 1e-3);
    // The idle bleed passes a fixed air flow per second, so per revolution it shrinks as rpm rises.
    const bleed = e.idleThrottle * Math.min(1, e.idleRpm / Math.max(rpm, 1));
    const opening = bleed + (1 - bleed) * this.throttleOpening;
    const frictionTorque = e.frictionTorque_Nm + e.frictionPerRpm_Nm * rpm;
    const lapse = Powerplant.altitudeLapse(inp.density / RHO0);
    const firing = this.running && !this.starved;
    const indicated = firing ? opening * ((this.fullThrottlePower(rpm) * lapse) / omega + frictionTorque) : 0;
    // Friction always opposes rotation; it is capped so it can stop the shaft but not reverse it.
    const friction = Math.min(frictionTorque, (this.omega * this.inertia) / dt + indicated);
    // Accessories (a prerotator drive) take their power straight off the crankshaft. Their
    // clutch slips rather than stall the engine, so the load torque is worked out at no less
    // than idle speed.
    const accessoryTorque = (inp.accessoryPower ?? 0) / Math.max(omega, e.idleRpm / RPM_PER_RAD_S);
    const engineTorque = indicated - friction - accessoryTorque;

    const governorRpm = this.governor(dt, inp.propLever ?? 1);

    const nRev = this.omega / (TWO_PI * this.ratio);
    const prop = this.propellerLoads(nRev, inp.airspeed, inp.density);
    // Propeller torque at the crank: divided by the ratio, and grossed up for belt losses
    // when the engine drives the prop (when windmilling, the belt loss works the other way).
    const eff = e.driveEfficiency;
    const loadAtCrank = (prop.torque / this.ratio) * (prop.torque >= 0 ? 1 / eff : eff);

    this.omega += ((engineTorque - loadAtCrank) * dt) / this.inertia;
    if (this.omega < 0) this.omega = 0;
    if (this.running && this.rpm < e.stallRpm) this.running = false; // lugged down: it dies

    // Oil pressure follows engine speed (normal once well above idle), and drains when starved.
    const oilTarget = this.running && !this.starved ? Math.min(1, this.rpm / (2 * e.idleRpm)) : this.running ? 0.1 : 0;
    this.oil += (oilTarget - this.oil) * Math.min(1, dt / FEED.oilLag_s);

    const enginePower = engineTorque * this.omega;
    const o = this.out;
    o.thrust = prop.thrust;
    o.propTorque = prop.torque;
    o.propPower = prop.power;
    o.enginePower = enginePower;
    o.engineRpm = this.rpm;
    o.propRpm = this.rpm / this.ratio;
    o.advanceRatio = prop.J;
    o.pitchScale = this.pitchScale;
    o.governorRpm = governorRpm;
    o.manifoldPressure = (inp.pressure ?? ISA_P0) * (firing ? MAP_CLOSED + (MAP_OPEN - MAP_CLOSED) * opening : 1);
    o.chargeFlow = firing ? (o.manifoldPressure / (ISA_P0 * MAP_OPEN)) * (this.rpm / this.data.propulsion.ratedRpm) : 0;
    o.slipstreamPressure = Math.max(prop.thrust, 0) / this.discArea;
    o.fuelFlow = firing ? (e.bsfc_kgPerkWh * Math.max(enginePower, 0)) / 3.6e6 : 0;
    o.fuelStarved = this.running && this.starved;
    o.oilPressure = this.oil;
    // Firing frequency: two-strokes fire every revolution, four-strokes every other.
    o.vibrationHz = firing ? (this.rpm / 60) * e.cylinders * (2 / e.strokes) : 0;
    // Fewer cylinders shake more; a single shakes most at idle, when firing is uneven.
    const roughIdle = firing ? 1 - Math.min(this.rpm / (3 * e.stallRpm), 1) : 0;
    const load = firing ? Math.min(enginePower / this.ratedPower, 1) : 0;
    o.vibration = Math.min(1, (0.5 * load + 0.5 * roughIdle + (firing ? 0.2 : 0)) / Math.sqrt(e.cylinders));
    return o;
  }

  /** Constant-speed governor: move the blade pitch towards the lever's rpm. Returns that rpm (0 if fixed pitch). */
  private governor(dt: number, lever: number): number {
    const cs = this.prop.constantSpeed;
    if (!cs) return 0;
    const target = cs.rpmMin + (cs.rpmMax - cs.rpmMin) * Math.min(1, Math.max(0, lever));
    // Over-speed coarsens the blades (more load), under-speed fines them; rate-limited like the oil-driven hub.
    const rate = Math.max(-cs.pitchRateMax, Math.min(cs.pitchRateMax, (cs.governorGain * (this.rpm - target)) / target));
    this.pitchScale = Math.max(cs.pitchScaleMin, Math.min(cs.pitchScaleMax, this.pitchScale + rate * dt));
    return target;
  }

  /** Track negative g for float carburettors and wet-sump oil pickups. */
  private updateFeed(dt: number, g: number): void {
    if (this.invertedSystems) {
      this.starved = false;
      return;
    }
    if (g < FEED.starveBelowG) {
      this.negativeGTime += dt;
      this.positiveGTime = 0;
      if (this.negativeGTime > FEED.starveAfter_s) this.starved = true;
    } else {
      this.positiveGTime += dt;
      if (this.positiveGTime > FEED.recoverAfter_s) {
        this.starved = false;
        this.negativeGTime = 0;
      }
    }
  }
}
