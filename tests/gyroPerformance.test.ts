import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { mpsToFpm, mpsToKt } from '../src/core/units';
import type { Gyroplane } from '../src/physics/Gyroplane';
import { RUNWAYS } from '../src/world/layout';
import { prerotate, takeOff } from './helpers/gyroPilot';
import { attitude, fly, makeWorld, Pid, startInFlight, TestPilot } from './helpers/testPilot';

// Automated flight tests of the Bensen B-8M gyroplane against CLAUDE.md (±10 %).
// Test mass: empty 113.4 kg + pilot 90 kg + full fuel (20 L x 0.74) = 218 kg. ISA, calm.

const B = AIRCRAFT.bensenB8M;
const T = {
  cruiseKt: mpsToKt(B.targets.cruise_mps!),
  maxKt: mpsToKt(B.targets.maxSpeed_mps!),
  climbFpm: mpsToFpm(B.targets.climb_mps!),
  takeoffM: B.targets.takeoffRoll_m!,
};
const within10 = (value: number, target: number) => {
  expect(value).toBeGreaterThan(target * 0.9);
  expect(value).toBeLessThan(target * 1.1);
};
const LONG = 120_000;
/** Typical flight rotor speed to start airborne tests with, rad/s (~360 rpm). */
const FLIGHT_ROTOR = (360 / 60) * 2 * Math.PI;

function gyroInFlight(height: number, kt: number) {
  const { world, ac } = makeWorld(B);
  const gy = ac as Gyroplane;
  startInFlight(gy, height, kt, 0);
  gy.rotor.omega = FLIGHT_ROTOR;
  return { world, gy };
}

describe('Bensen B-8M ground handling and take-off', () => {
  it('prerotates the rotor to over 300 rpm within 40 s, and no further than its limit', () => {
    const { world, ac } = makeWorld(B);
    const gy = ac as Gyroplane;
    gy.placeOnGround(RUNWAYS.gravel.cx, 280, 0, 0, 0.02);
    gy.powerplant.start();
    const r = prerotate(world, gy);
    console.info(`prerotation: 300 rpm after ${r.reached300.toFixed(0)} s, ${r.rpm.toFixed(0)} rpm at release`);
    expect(r.reached300).toBeLessThan(40);
    expect(r.rpm).toBeLessThanOrEqual(B.rotor!.prerotator.maxRpm + 5);
    expect(gy.powerplant.running).toBe(true);
  }, LONG);

  it('prerotating at idle cannot stall the engine; adding power spins the rotor up faster', () => {
    const run = (throttle: number) => {
      const { world, ac } = makeWorld(B);
      const gy = ac as Gyroplane;
      gy.resetOnGround(RUNWAYS.gravel.cx, 280, 0, 0);
      fly(world, 20, () => {
        gy.pilot.prerotator = 1;
        gy.pilot.throttle = throttle;
      });
      return { rpm: gy.rotor.rpm, running: gy.powerplant.running };
    };
    const idle = run(0);
    const power = run(0.4);
    expect(idle.running).toBe(true);
    expect(idle.rpm).toBeGreaterThan(20); // turning, slowly
    expect(power.running).toBe(true);
    expect(power.rpm).toBeGreaterThan(250);
  }, LONG);

  it(`takes off in about ${T.takeoffM} m after prerotating`, () => {
    const { world, ac } = makeWorld(B);
    const gy = ac as Gyroplane;
    gy.placeOnGround(RUNWAYS.gravel.cx, 290, 0, 0, 0.02);
    gy.powerplant.start();
    prerotate(world, gy);
    const r = takeOff(world, gy);
    console.info(`take-off roll ${r.roll.toFixed(1)} m, lift-off ${r.liftoffKt.toFixed(0)} kt, rotor ${gy.rotor.rpm.toFixed(0)} rpm`);
    within10(r.roll, T.takeoffM);
    expect(Math.abs(gy.body.position.x - RUNWAYS.gravel.cx)).toBeLessThan(4); // kept straight
    // And keeps climbing away.
    const pilot = new TestPilot(gy);
    fly(world, 20, () => {
      gy.pilot.throttle = 1;
      pilot.holdSpeedWithPitch(45);
      pilot.bankTo(0);
    });
    expect(gy.state.heightAgl).toBeGreaterThan(50);
  }, LONG);
});

describe('Bensen B-8M performance', () => {
  it(`climbs ${T.climbFpm.toFixed(0)} fpm at full power`, () => {
    let best = 0;
    let vy = 0;
    for (const kt of [35, 40, 45, 50, 55]) {
      const { world, gy } = gyroInFlight(100, kt);
      const pilot = new TestPilot(gy);
      gy.pilot.throttle = 1;
      let vs = 0;
      let n = 0;
      fly(world, 40, (t) => {
        pilot.holdSpeedWithPitch(kt);
        pilot.bankTo(0);
        if (t > 25) {
          vs += gy.state.verticalSpeed;
          n++;
        }
      });
      if (mpsToFpm(vs / n) > best) [best, vy] = [mpsToFpm(vs / n), kt];
    }
    console.info(`best climb ${best.toFixed(0)} fpm at ${vy} kt (target ${T.climbFpm.toFixed(0)})`);
    within10(best, T.climbFpm);
  }, LONG);

  it(`cruises at ${T.cruiseKt.toFixed(0)} kt (65 mph) at 45 % power`, () => {
    const { world, gy } = gyroInFlight(300, 56);
    const pilot = new TestPilot(gy);
    fly(world, 90, () => {
      pilot.holdAltitude(300);
      pilot.bankTo(0);
      pilot.holdPower(0.45);
    });
    console.info(`cruise ${mpsToKt(gy.state.ias).toFixed(1)} kt at ${((gy.powerplant.out.enginePower / B.propulsion.ratedPowerW) * 100).toFixed(0)} % power, ${gy.powerplant.out.engineRpm.toFixed(0)} rpm, rotor ${gy.rotor.rpm.toFixed(0)}`);
    expect(Math.abs(gy.body.position.y - 300)).toBeLessThan(3);
    within10(mpsToKt(gy.state.ias), T.cruiseKt);
    expect(gy.rotor.rpm).toBeGreaterThan(B.limits.rotorRpmMin!);
    expect(gy.rotor.rpm).toBeLessThan(B.limits.rotorRpmMax!);
  }, LONG);

  it(`reaches ${T.maxKt.toFixed(0)} kt flat out in level flight`, () => {
    const { world, gy } = gyroInFlight(300, 70);
    const pilot = new TestPilot(gy);
    gy.pilot.throttle = 1;
    fly(world, 90, () => {
      pilot.holdAltitude(300);
      pilot.bankTo(0);
    });
    console.info(`max level speed ${mpsToKt(gy.state.ias).toFixed(1)} kt (target ${T.maxKt.toFixed(0)})`);
    within10(mpsToKt(gy.state.ias), T.maxKt);
  }, LONG);

  it('descends in a steady autorotation at idle, rotor rpm holding in its normal range', () => {
    const { world, gy } = gyroInFlight(1500, 40);
    const pilot = new TestPilot(gy);
    const rpm: number[] = [];
    const vs: number[] = [];
    let torque = 0;
    let n = 0;
    fly(world, 70, (t) => {
      gy.pilot.throttle = 0;
      pilot.holdSpeedWithPitch(40);
      pilot.bankTo(0);
      if (t > 40) {
        rpm.push(gy.rotor.rpm);
        vs.push(mpsToFpm(gy.state.verticalSpeed));
        torque += gy.rotor.out.aeroTorque;
        n++;
      }
    });
    const mean = (a: number[]) => a.reduce((x, y) => x + y) / a.length;
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    console.info(`autorotation at 40 kt idle: ${mean(vs).toFixed(0)} fpm, rotor ${mean(rpm).toFixed(0)} rpm (spread ${spread(rpm).toFixed(1)})`);
    expect(spread(rpm) / mean(rpm)).toBeLessThan(0.03); // rotor rpm steady
    expect(mean(rpm)).toBeGreaterThan(B.limits.rotorRpmMin!);
    expect(mean(rpm)).toBeLessThan(B.limits.rotorRpmMax!);
    expect(spread(vs)).toBeLessThan(150); // steady descent
    expect(mean(vs)).toBeLessThan(-700);
    expect(mean(vs)).toBeGreaterThan(-2000);
    // In steady autorotation the air drives the rotor exactly as hard as its drag holds it back.
    expect(Math.abs(torque / n)).toBeLessThan(5);
  }, LONG);
});

describe('Bensen B-8M low g', () => {
  /** From level cruise, push the stick sharply forward for `pushSeconds`, then recover. */
  function pushover(throttle: number, pushSeconds = 1.5) {
    const { world, gy } = gyroInFlight(600, 56);
    const pilot = new TestPilot(gy);
    const power = new Pid(0.15, 0.08, 0, 1, 0.5);
    fly(world, 20, () => {
      pilot.holdAltitude(600);
      pilot.bankTo(0);
      gy.pilot.throttle = power.update(0.45 - gy.powerplant.out.enginePower / B.propulsion.ratedPowerW);
    });
    const rpm0 = gy.rotor.rpm;
    let warned = false;
    let pushoverWarned = false;
    let minG = Infinity;
    let minRpm = Infinity;
    let worstNoseDownRate = 0;
    fly(world, pushSeconds, () => {
      gy.pilot.throttle = throttle;
      gy.pilot.elevator = -1; // sharp forward stick
      pilot.bankTo(0);
      warned ||= gy.warnings.lowG;
      pushoverWarned ||= gy.warnings.pushover;
      minG = Math.min(minG, gy.gMonitor.g);
      minRpm = Math.min(minRpm, gy.rotor.rpm);
      worstNoseDownRate = Math.min(worstNoseDownRate, gy.body.angularVelocity.x);
    });
    // Recovery: power off, gently ease the stick back to reload the rotor.
    let recovered = false;
    fly(world, 8, () => {
      gy.pilot.throttle = 0;
      gy.pilot.elevator = 0.3;
      pilot.bankTo(0);
      warned ||= gy.warnings.lowG;
      minRpm = Math.min(minRpm, gy.rotor.rpm);
      if (gy.gMonitor.g > 0.9 && attitude(gy).pitch > -0.5) recovered = true;
    });
    return { rpm0, minRpm, minG, warned, pushoverWarned, worstNoseDownRate, recovered };
  }

  it('a sharp pushover unloads the rotor: low-g warning, and the rotor rpm decays', () => {
    const r = pushover(0.55);
    console.info(`pushover: down to ${r.minG.toFixed(2)} g, rotor ${r.rpm0.toFixed(0)} → ${r.minRpm.toFixed(0)} rpm`);
    expect(r.minG).toBeLessThan(0.5);
    expect(r.warned).toBe(true);
    expect(r.minRpm).toBeLessThan(0.95 * r.rpm0); // rotor decay at low g
    expect(r.recovered).toBe(true);
  }, LONG);

  it('with power on, the high thrust line pitches the nose down harder (power pushover warning)', () => {
    const powered = pushover(1);
    const idle = pushover(0);
    expect(powered.pushoverWarned).toBe(true);
    expect(idle.pushoverWarned).toBe(false);
    expect(powered.worstNoseDownRate).toBeLessThan(idle.worstNoseDownRate);
  }, LONG);
});
