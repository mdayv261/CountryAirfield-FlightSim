import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { EngineTemps, type EngineTempsInput } from '../src/physics/engineTemps';
import type { Gyroplane } from '../src/physics/Gyroplane';
import { fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

const hirth = AIRCRAFT.airbike103.engine!.temps!;
const cond = (over: Partial<EngineTempsInput> = {}): EngineTempsInput => ({
  running: true,
  powerFraction: 1,
  airspeed: hirth.refCoolingSpeed_mps,
  slipstreamPressure: 0,
  density: 1.225,
  oat_C: 15,
  ...over,
});

describe('engine temperatures', () => {
  it('settles at the data file CHT at rated power with the reference cooling air', () => {
    const t = new EngineTemps(hirth);
    expect(t.equilibrium(cond()).cht).toBeCloseTo(hirth.chtClimb_C, 6);
    expect(t.equilibrium(cond()).egt).toBeCloseTo(hirth.egtFull_C, 6);
  });

  it('runs hotter with less cooling air or more power, and tracks a hot day', () => {
    const t = new EngineTemps(hirth);
    const base = t.equilibrium(cond()).cht;
    expect(t.equilibrium(cond({ airspeed: hirth.refCoolingSpeed_mps / 2 })).cht).toBeGreaterThan(base);
    expect(t.equilibrium(cond({ powerFraction: 0.5 })).cht).toBeLessThan(base);
    expect(t.equilibrium(cond({ oat_C: 35 })).cht).toBeCloseTo(base + 20, 6);
    // The slipstream cools a tractor engine on the ground.
    const still = t.equilibrium(cond({ airspeed: 0 })).cht;
    expect(t.equilibrium(cond({ airspeed: 0, slipstreamPressure: 500 })).cht).toBeLessThan(still);
  });

  it('heads warm with their time constant; exhaust follows power within seconds', () => {
    const t = new EngineTemps(hirth);
    t.settle(cond({ powerFraction: 0.1 }));
    const start = t.cht_C;
    const target = t.equilibrium(cond()).cht;
    for (let i = 0; i < hirth.chtTimeConstant_s * 120; i++) t.step(1 / 120, cond());
    // One time constant: 63 % of the way there.
    expect((t.cht_C - start) / (target - start)).toBeGreaterThan(0.6);
    expect((t.cht_C - start) / (target - start)).toBeLessThan(0.67);
    expect(t.egt_C).toBeGreaterThan(hirth.egtFull_C - 1);
  });

  it('cools towards the outside air once the engine stops', () => {
    const t = new EngineTemps(hirth);
    t.settle(cond());
    for (let i = 0; i < hirth.chtTimeConstant_s * 5 * 120; i++) t.step(1 / 120, cond({ running: false, powerFraction: 0, airspeed: 0 }));
    expect(t.cht_C).toBeLessThan(20);
    expect(t.egt_C).toBeLessThan(25);
  });

  for (const id of ['airbike103', 'decathlon8kcab', 'bensenB8M'] as const) {
    it(`${id}: CHT about 200 °C after a long full-power climb, cooler in a glide`, () => {
      const d = AIRCRAFT[id];
      const vyKt = (d.targets.vy_mps ?? 23) * 1.944;
      const { world, ac } = makeWorld(d);
      startInFlight(ac, 300, vyKt, 3);
      if (id === 'bensenB8M') (ac as Gyroplane).rotor.omega = 12 * Math.PI;
      const pilot = new TestPilot(ac);
      fly(world, 300, () => {
        pilot.holdSpeedWithPitch(vyKt);
        pilot.bankTo(0);
        ac.pilot.throttle = 1;
      });
      const climb = ac.temps!.cht_C;
      fly(world, 300, () => {
        pilot.holdSpeedWithPitch(vyKt * 1.2);
        pilot.bankTo(0);
        ac.pilot.throttle = 0;
      });
      console.info(`${id}: CHT ${climb.toFixed(0)} °C after a 5 min full-power climb, ${ac.temps!.cht_C.toFixed(0)} °C after a 5 min glide`);
      expect(climb).toBeGreaterThan(185);
      expect(climb).toBeLessThan(225);
      expect(ac.temps!.cht_C).toBeLessThan(climb - 80);
    }, 120_000);
  }

  it('a reset on the ground starts with a warmed-up engine', () => {
    const { world, ac } = makeWorld(AIRCRAFT.decathlon8kcab);
    ac.resetOnGround(0, 280, 0, 0);
    fly(world, 0.1, () => {});
    expect(ac.temps!.cht_C).toBeGreaterThan(80);
    expect(ac.temps!.cht_C).toBeLessThan(200);
  });
});
