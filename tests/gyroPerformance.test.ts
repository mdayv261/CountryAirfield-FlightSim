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

  it('the brakes hold it still while prerotating with power on, on gravel and on grass', () => {
    const run = (x: number, throttle: number) => {
      const { world, ac } = makeWorld(B);
      const gy = ac as Gyroplane;
      gy.resetOnGround(x, 280, 0, 0);
      const z0 = gy.body.position.z;
      fly(world, 20, () => {
        gy.pilot.brakeLeft = gy.pilot.brakeRight = 1;
        gy.pilot.prerotator = 1;
        gy.pilot.throttle = throttle;
      });
      return { moved: Math.abs(gy.body.position.z - z0), rpm: gy.powerplant.out.engineRpm };
    };
    // Gravel grips better: it holds at 65 % throttle (~2,800 engine rpm with the prerotator
    // loading the engine). Grass holds at the ~2,500 rpm a pilot uses to prerotate.
    const gravel = run(RUNWAYS.gravel.cx, 0.65);
    const grass = run(RUNWAYS.grass.cx, 0.55);
    console.info(`braked prerotation: gravel ${gravel.moved.toFixed(2)} m at ${gravel.rpm.toFixed(0)} rpm, grass ${grass.moved.toFixed(2)} m at ${grass.rpm.toFixed(0)} rpm`);
    expect(gravel.rpm).toBeGreaterThan(2750);
    expect(grass.rpm).toBeGreaterThan(2450);
    expect(gravel.moved).toBeLessThan(0.5);
    expect(grass.moved).toBeLessThan(0.5);
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

  it('flies itself hands-off: level at cruise power, climbing with more, descending with less, wings level', () => {
    const run = (throttle: number) => {
      const { world, gy } = gyroInFlight(800, 53);
      gy.pilot.throttle = throttle;
      let maxBank = 0;
      fly(world, 120, (t) => {
        if (t > 20) maxBank = Math.max(maxBank, Math.abs(attitude(gy).bank));
      });
      const y0 = gy.body.position.y;
      const psi0 = attitude(gy).heading;
      fly(world, 30, () => {
        maxBank = Math.max(maxBank, Math.abs(attitude(gy).bank));
      });
      const deg = 180 / Math.PI;
      return {
        fpm: mpsToFpm((gy.body.position.y - y0) / 30),
        bank: maxBank * deg,
        turn: Math.abs(attitude(gy).heading - psi0) * deg,
        kt: mpsToKt(gy.state.ias),
      };
    };
    const cruise = run(0.55); // 45 % power, the agreed cruise setting
    const full = run(1);
    const idle = run(0);
    for (const [name, r] of Object.entries({ cruise, full, idle })) {
      console.info(`hands-off ${name}: ${r.fpm.toFixed(0)} fpm, ${r.kt.toFixed(0)} kt, max bank ${r.bank.toFixed(1)}°, turned ${r.turn.toFixed(1)}° in 30 s`);
    }
    expect(Math.abs(cruise.fpm)).toBeLessThan(100);
    within10(cruise.kt, T.cruiseKt);
    expect(cruise.bank).toBeLessThan(3);
    expect(cruise.turn).toBeLessThan(5);
    expect(full.fpm).toBeGreaterThan(400);
    expect(idle.fpm).toBeLessThan(-500);
    expect(full.bank).toBeLessThan(5);
    expect(idle.bank).toBeLessThan(3);
  }, LONG);

  it('rolls at a gentle, proportional rate: about 30°/s at half stick, 60°/s at full', () => {
    const rate = (stick: number) => {
      const { world, gy } = gyroInFlight(800, 53);
      gy.pilot.throttle = 0.55;
      fly(world, 60, () => {});
      let pMax = 0;
      fly(world, 3, () => {
        gy.pilot.aileron = stick;
        pMax = Math.max(pMax, -gy.body.angularVelocity.z);
      });
      return (pMax * 180) / Math.PI;
    };
    const half = rate(0.5);
    const full = rate(1);
    console.info(`roll rate: half stick ${half.toFixed(0)}°/s, full stick ${full.toFixed(0)}°/s`);
    expect(half).toBeGreaterThan(20);
    expect(half).toBeLessThan(40);
    expect(full).toBeGreaterThan(45);
    expect(full).toBeLessThan(75);
  }, LONG);

  it('centring the stick in a 30° bank lets it ease back level gently, not snap level (user report 2026-10-20)', () => {
    const { world, gy } = gyroInFlight(800, 53);
    gy.pilot.throttle = 0.55;
    fly(world, 60, () => {});
    const deg = 180 / Math.PI;
    // Roll into about 30° of bank with 30 % stick, then let the stick go.
    fly(world, 4, () => {
      gy.pilot.aileron = 0.3;
      return attitude(gy).bank * deg >= 30;
    });
    const bank0 = attitude(gy).bank * deg;
    let maxBackRate = 0;
    fly(world, 20, () => {
      gy.pilot.aileron = 0;
      maxBackRate = Math.max(maxBackRate, gy.body.angularVelocity.z * deg); // rolling left (back towards level)
    });
    const bank20 = attitude(gy).bank * deg;
    console.info(`stick centred at ${bank0.toFixed(0)}° bank: rolls back at most ${maxBackRate.toFixed(1)}°/s, ${bank20.toFixed(1)}° after 20 s`);
    expect(bank0).toBeGreaterThan(25);
    expect(maxBackRate).toBeLessThan(12); // was ~50°/s: a snap that whipped the cockpit view round
    expect(Math.abs(bank20)).toBeLessThan(5); // but it does come back level hands-off
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

  it('centre-line thrust: full power barely changes the pushover; low g with power is still flagged', () => {
    // With the propeller thrust line within 2 in of the CG (CAA Paper 2009/02), the propeller
    // has almost no lever arm to bunt the nose over when the rotor unloads. The original
    // high-thrust-line Bensen (7 in) pitched down much harder with power on.
    const powered = pushover(1);
    const idle = pushover(0);
    const deg = 180 / Math.PI;
    console.info(`pushover nose-down rate: full power ${(powered.worstNoseDownRate * deg).toFixed(1)}°/s, idle ${(idle.worstNoseDownRate * deg).toFixed(1)}°/s`);
    expect(powered.pushoverWarned).toBe(true);
    expect(idle.pushoverWarned).toBe(false);
    expect(Math.abs(powered.worstNoseDownRate - idle.worstNoseDownRate)).toBeLessThan(0.25 * Math.abs(idle.worstNoseDownRate));
  }, LONG);
});
