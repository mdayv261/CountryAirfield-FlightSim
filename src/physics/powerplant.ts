import type { AircraftData, EngineData, PropellerData } from '../aircraft/schema';
import { interp } from './table';

const TWO_PI = 2 * Math.PI;
const RPM_PER_RAD_S = 60 / TWO_PI;
/** Below this propeller speed (rev/s) we treat the propeller as stopped. */
const MIN_PROP_REV_S = 0.5;

export interface PowerplantOutput {
  /** Thrust along the propeller axis (forward), N. Negative when windmilling. */
  thrust: number;
  /** Torque the propeller takes from the shaft, N m (reacts on the airframe). */
  propTorque: number;
  /** Shaft power delivered to the propeller, W. */
  propPower: number;
  /** Engine brake power, W. */
  enginePower: number;
  engineRpm: number;
  propRpm: number;
  advanceRatio: number;
  /** Extra dynamic pressure in the slipstream, Pa (momentum theory: thrust / disc area). */
  slipstreamPressure: number;
  /** Fuel burn, kg/s. */
  fuelFlow: number;
  /** Firing frequency, Hz, and a 0..1 vibration level for camera shake and sound. */
  vibrationHz: number;
  vibration: number;
}

/**
 * Piston engine driving a propeller through a belt reduction (or direct drive).
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
 * Propeller: thrust and absorbed power from its CT and CP curves against advance ratio
 * J = V / (n D): the distance flown per revolution in diameters. At J = 0 (standing still)
 * the blades work at high angle and give maximum thrust; as J rises the blade angle of
 * attack falls, until thrust reaches zero and then reverses (windmilling) in a dive.
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
  readonly out: PowerplantOutput = {
    thrust: 0,
    propTorque: 0,
    propPower: 0,
    enginePower: 0,
    engineRpm: 0,
    propRpm: 0,
    advanceRatio: 0,
    slipstreamPressure: 0,
    fuelFlow: 0,
    vibrationHz: 0,
    vibration: 0,
  };
  private readonly engine: EngineData;
  private readonly prop: PropellerData;
  private readonly ratedPower: number;
  private readonly ratio: number;
  private readonly diameter: number;
  private readonly discArea: number;
  private readonly inertia: number;

  constructor(readonly data: AircraftData) {
    if (!data.engine || !data.propeller || !data.propulsion.propDiameter_m)
      throw new Error(`${data.id}: engine, propeller and propDiameter_m are needed for a powerplant`);
    this.engine = data.engine;
    this.prop = data.propeller;
    this.ratedPower = data.propulsion.ratedPowerW;
    this.ratio = data.propulsion.reductionRatio;
    this.diameter = data.propulsion.propDiameter_m;
    this.discArea = (Math.PI * this.diameter * this.diameter) / 4;
    this.inertia = this.engine.inertia_kgm2 + this.prop.inertia_kgm2 / (this.ratio * this.ratio);
  }

  get rpm(): number {
    return this.omega * RPM_PER_RAD_S;
  }

  /** Full-throttle brake power available at an engine rpm, W. */
  fullThrottlePower(rpm: number): number {
    return this.ratedPower * interp(this.engine.rpm, this.engine.powerFraction, rpm);
  }

  /** Start the engine (the recoil starter pull): it catches at its stall rpm and runs up. */
  start(): void {
    this.running = true;
    this.omega = Math.max(this.omega, (this.engine.stallRpm * 1.3) / RPM_PER_RAD_S);
  }

  stop(): void {
    this.running = false;
  }

  /** Propeller thrust and shaft torque at a given prop speed (rev/s), airspeed and density. */
  propellerLoads(nRev: number, airspeed: number, density: number): { thrust: number; torque: number; power: number; J: number } {
    const D = this.diameter;
    if (nRev < MIN_PROP_REV_S) return { thrust: 0, torque: 0, power: 0, J: 0 };
    const J = Math.max(airspeed, 0) / (nRev * D);
    const CT = interp(this.prop.J, this.prop.CT, J);
    const CP = interp(this.prop.J, this.prop.CP, J);
    const thrust = CT * density * nRev * nRev * D ** 4;
    const power = CP * density * nRev ** 3 * D ** 5;
    return { thrust, torque: power / (TWO_PI * nRev), power, J };
  }

  /**
   * Advance by dt. throttle 0..1; airspeed is the flow speed along the propeller axis
   * (m/s, forward); density kg/m³; fuelAvailable false starves the engine.
   */
  step(dt: number, throttle: number, airspeed: number, density: number, fuelAvailable = true): PowerplantOutput {
    const e = this.engine;
    if (!fuelAvailable) this.running = false;

    // Carburettor lag: the opening follows the lever exponentially.
    const lag = e.throttleLag_s > 0 ? 1 - Math.exp(-dt / e.throttleLag_s) : 1;
    this.throttleOpening += (Math.min(1, Math.max(0, throttle)) - this.throttleOpening) * lag;

    const rpm = this.rpm;
    const omega = Math.max(this.omega, 1e-3);
    // The idle bleed passes a fixed air flow per second, so per revolution it shrinks as rpm rises.
    const bleed = e.idleThrottle * Math.min(1, e.idleRpm / Math.max(rpm, 1));
    const opening = bleed + (1 - bleed) * this.throttleOpening;
    const frictionTorque = e.frictionTorque_Nm + e.frictionPerRpm_Nm * rpm;
    const indicated = this.running ? opening * (this.fullThrottlePower(rpm) / omega + frictionTorque) : 0;
    // Friction always opposes rotation; it is capped so it can stop the shaft but not reverse it.
    const friction = Math.min(frictionTorque, (this.omega * this.inertia) / dt + indicated);
    const engineTorque = indicated - friction;

    const nRev = this.omega / (TWO_PI * this.ratio);
    const prop = this.propellerLoads(nRev, airspeed, density);
    // Propeller torque at the crank: divided by the ratio, and grossed up for belt losses
    // when the engine drives the prop (when windmilling, the belt loss works the other way).
    const eff = e.driveEfficiency;
    const loadAtCrank = (prop.torque / this.ratio) * (prop.torque >= 0 ? 1 / eff : eff);

    this.omega += ((engineTorque - loadAtCrank) * dt) / this.inertia;
    if (this.omega < 0) this.omega = 0;
    if (this.running && this.rpm < e.stallRpm) this.running = false; // lugged down: it dies

    const enginePower = engineTorque * this.omega;
    const o = this.out;
    o.thrust = prop.thrust;
    o.propTorque = prop.torque;
    o.propPower = prop.power;
    o.enginePower = enginePower;
    o.engineRpm = this.rpm;
    o.propRpm = this.rpm / this.ratio;
    o.advanceRatio = prop.J;
    o.slipstreamPressure = Math.max(prop.thrust, 0) / this.discArea;
    o.fuelFlow = this.running ? (e.bsfc_kgPerkWh * Math.max(enginePower, 0)) / 3.6e6 : 0;
    // Firing frequency: two-strokes fire every revolution, four-strokes every other.
    o.vibrationHz = this.running ? (this.rpm / 60) * e.cylinders * (2 / e.strokes) : 0;
    // Fewer cylinders shake more; a single shakes most at idle, when firing is uneven.
    const roughIdle = this.running ? 1 - Math.min(this.rpm / (3 * e.stallRpm), 1) : 0;
    const load = this.running ? Math.min(enginePower / this.ratedPower, 1) : 0;
    o.vibration = Math.min(1, (0.5 * load + 0.5 * roughIdle + (this.running ? 0.2 : 0)) / Math.sqrt(e.cylinders));
    return o;
  }
}
