import { describe, expect, it } from 'vitest';
import { ktToMps, mpsToKt } from '../src/core/units';
import { PHYSICS_DT } from '../src/core/constants';
import { AutoRudder } from '../src/physics/autoRudder';
import { attitude, fly, makeWorld, Pid, startInFlight, TestPilot } from './helpers/testPilot';

const deg = Math.PI / 180;

describe('auto-coordinated rudder', () => {
  const step = (aid: AutoRudder, input: Parameters<AutoRudder['update']>[1], seconds = 0.5) => {
    for (let t = 0; t < seconds; t += PHYSICS_DT) aid.update(PHYSICS_DT, input);
    return aid.output;
  };

  it('applies right rudder for airflow from the right, more the longer it persists', () => {
    const aid = new AutoRudder();
    const first = step(aid, { beta: 0.02, yawRate: 0, ias: ktToMps(40), onGround: false }, PHYSICS_DT);
    expect(first).toBeGreaterThan(0.1); // immediate proportional response
    expect(step(aid, { beta: 0.02, yawRate: 0, ias: ktToMps(40), onGround: false }, 3)).toBeGreaterThan(first + 0.1); // integral builds
    expect(step(aid, { beta: 1, yawRate: 0, ias: ktToMps(40), onGround: false })).toBe(1); // limited to full throw
  });

  it('damps sudden yaw but not the steady yaw rate of a turn (washout)', () => {
    const aid = new AutoRudder();
    step(aid, { beta: 0, yawRate: 0, ias: ktToMps(40), onGround: false });
    const jolt = step(aid, { beta: 0, yawRate: 0.3, ias: ktToMps(40), onGround: false }, PHYSICS_DT);
    expect(jolt).toBeLessThan(-0.1); // opposes a sudden swing right
    expect(Math.abs(step(aid, { beta: 0, yawRate: 0.3, ias: ktToMps(40), onGround: false }, 15))).toBeLessThan(0.01);
  });

  it('does nothing on the ground or below about 15 kt, and fades in by 25 kt', () => {
    const input = (ias: number, onGround = false) => ({ beta: 0.02, yawRate: 0, ias: ktToMps(ias), onGround });
    expect(step(new AutoRudder(), input(40, true))).toBe(0);
    expect(step(new AutoRudder(), input(14))).toBe(0);
    const mid = step(new AutoRudder(), input(20), PHYSICS_DT);
    const full = step(new AutoRudder(), input(26), PHYSICS_DT);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(full);
  });

  /**
   * Roll into a 30° bank with ailerons only (feet off the pedals) and record the worst sideslip.
   * The test pilot holds the bank with a PI loop (a high wing overbanks in a turn) and holds
   * 45 kt with the throttle, so the turn stays steady rather than running down towards the stall.
   */
  function aileronOnlyTurn(aid: boolean): number {
    const { world, ac } = makeWorld();
    startInFlight(ac, 300, 45);
    ac.autoRudderEnabled = aid;
    const pilot = new TestPilot(ac);
    const bankLoop = new Pid(2, 1.5);
    const speedLoop = new Pid(0.08, 0.05, 0, 1, 0.6);
    let worst = 0;
    fly(world, 25, (t) => {
      const bank = t > 3 ? 30 * deg : 0;
      const p = -ac.body.angularVelocity.z;
      ac.pilot.aileron = bankLoop.update(bank - attitude(ac).bank, -0.6 * p);
      ac.pilot.rudder = 0;
      pilot.holdAltitude(300);
      ac.pilot.throttle = speedLoop.update(45 - mpsToKt(ac.state.ias));
      if (t > 3) worst = Math.max(worst, Math.abs(ac.state.beta));
    });
    return worst;
  }

  it('keeps the slip ball centred in an aileron-only turn', () => {
    const off = aileronOnlyTurn(false);
    const on = aileronOnlyTurn(true);
    expect(off).toBeGreaterThan(5 * deg); // adverse yaw really shows without it
    expect(on).toBeLessThan(0.35 * off);
    expect(on).toBeLessThan(3 * deg);
  });

  it('leaves ground steering entirely to the pilot', () => {
    const { world, ac } = makeWorld();
    ac.placeOnGround(0, 250, 0, 0, 0.02);
    ac.powerplant.start();
    ac.autoRudderEnabled = true;
    ac.pilot.rudder = 0.4;
    fly(world, 3, () => {
      ac.pilot.throttle = 0.5;
    });
    expect(ac.rudderApplied).toBe(0.4);
  });
});
