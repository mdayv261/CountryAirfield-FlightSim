// Auto-coordinated rudder: a pilot aid that does what the pilot's feet would, keeping the
// slip ball centred in flight.

export const AUTO_RUDDER = {
  /** Rudder per radian of sideslip: wind from the right (β > 0) needs right rudder. */
  betaGain: 6,
  /** Rudder per radian-second of accumulated sideslip: trims out any steady slip. */
  integralGain: 4,
  /** Most rudder the integral may hold, fraction of full throw. */
  integralLimit: 0.5,
  /** Rudder per rad/s of change in yaw rate (yaw damper), opposing it. */
  yawRateGain: 0.4,
  /**
   * Washout time constant, s. The yaw damper only reacts to changes in yaw rate quicker than
   * this; a steady turn's yaw rate passes through untouched, so the aid never fights a turn.
   */
  washout_s: 1.5,
  /** Fades in between these indicated airspeeds, m/s (about 15 and 25 kt). */
  fadeInFrom_mps: 7.7,
  fullAt_mps: 12.9,
};

export interface AutoRudderInput {
  /** Sideslip, rad (positive = airflow from the right). */
  beta: number;
  /** Yaw rate, rad/s (positive = nose moving right). */
  yawRate: number;
  /** Indicated airspeed, m/s. */
  ias: number;
  /** True while any wheel is touching the ground. */
  onGround: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Rudder (fraction of full throw) the aid adds to the pilot's own, updated every physics step.
 *
 * In a turn the down-going aileron makes more drag and pulls the nose the wrong way
 * (adverse yaw), and propeller torque yaws the aircraft too; either way the airflow
 * starts to arrive from one side (sideslip). The aid is a small PI controller on that
 * sideslip (the proportional part reacts at once, the integral part removes the steady
 * slip that a proportional controller alone always leaves), plus a washed-out yaw damper
 * that calms the nose without resisting a steady rate of turn.
 *
 * It does nothing on the ground (the pedals also steer the tailwheel, and an automatic
 * input there would fight the pilot and could start a ground loop) and fades in with
 * airspeed, so take-off and landing steering stay entirely the pilot's.
 */
export class AutoRudder {
  private integral = 0;
  /** Slowly-following copy of the yaw rate; yaw rate minus this is the "change" the damper sees. */
  private yawRateLow = 0;
  output = 0;

  reset(): void {
    this.integral = 0;
    this.yawRateLow = 0;
    this.output = 0;
  }

  update(dt: number, i: AutoRudderInput): number {
    const k = AUTO_RUDDER;
    this.yawRateLow += (i.yawRate - this.yawRateLow) * Math.min(1, dt / k.washout_s);
    const fade = clamp((i.ias - k.fadeInFrom_mps) / (k.fullAt_mps - k.fadeInFrom_mps), 0, 1);
    if (i.onGround || fade === 0) {
      this.reset();
      this.yawRateLow = i.yawRate;
      return 0;
    }
    this.integral = clamp(this.integral + k.integralGain * i.beta * dt, -k.integralLimit, k.integralLimit);
    const cmd = k.betaGain * i.beta + this.integral - k.yawRateGain * (i.yawRate - this.yawRateLow);
    this.output = fade * clamp(cmd, -1, 1);
    return this.output;
  }
}
