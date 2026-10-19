import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { fpmToMps, mpsToFpm, mpsToKt } from '../src/core/units';
import { RUNWAYS } from '../src/world/layout';
import { flyCircuit, type CircuitSpeeds } from './helpers/circuit';
import { attitude, fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

// Automated flight tests of the Air-Bike 103 against CLAUDE.md (±10 %).
// Test mass: empty 112 kg + pilot 90 kg + full fuel (19 L x 0.74 kg/L) = 216 kg.
// Speeds are indicated airspeeds. Calm air, ISA, field elevation 50 ft.

const a = AIRCRAFT.airbike103;
const T = {
  stallKt: mpsToKt(a.targets.stall_mps!),
  cruiseKt: mpsToKt(a.targets.cruise_mps!),
  climbFpm: mpsToFpm(a.targets.climb_mps!),
  takeoffM: a.targets.takeoffRoll_m!,
  landingM: a.targets.landingRoll_m!,
};
const within10 = (value: number, target: number) => {
  expect(value).toBeGreaterThan(target * 0.9);
  expect(value).toBeLessThan(target * 1.1);
};
// Fuselage attitude for the three-point lift-off/touchdown (wing about 1.6° higher, its rigging incidence).
const THREE_POINT = (10.4 * Math.PI) / 180;
const SPEEDS: CircuitSpeeds = { climbKt: 39, circuitKt: 45, approachKt: 33, threePointPitch: THREE_POINT };
const LONG = 120_000; // ms: these fly minutes of simulated time

describe('Air-Bike 103 performance', () => {
  it(`stalls at ${T.stallKt.toFixed(0)} kt (power idle, slowing 1 kt/s)`, () => {
    const { world, ac } = makeWorld();
    startInFlight(ac, 500, 40);
    const pilot = new TestPilot(ac);
    ac.pilot.throttle = 0;
    // The stall is where the wing passes its maximum-lift angle; record the speed there.
    const alphaStall = (a.aero!.alpha_deg[a.aero!.CL.indexOf(Math.max(...a.aero!.CL))] * Math.PI) / 180;
    let vs = 0;
    fly(world, 40, (t) => {
      pilot.holdSpeedWithPitch(Math.max(40 - t, 10));
      pilot.bankTo(0);
      if (ac.state.alpha > alphaStall) {
        vs = mpsToKt(ac.state.ias);
        return true;
      }
    });
    console.info(`stall ${vs.toFixed(1)} kt (target ${T.stallKt.toFixed(0)})`);
    within10(vs, T.stallKt);
  });

  it(`cruises at ${T.cruiseKt.toFixed(0)} kt at 75 % power`, () => {
    const { world, ac } = makeWorld();
    startInFlight(ac, 300, 47);
    const pilot = new TestPilot(ac);
    fly(world, 120, () => {
      pilot.holdAltitude(300);
      pilot.bankTo(0);
      pilot.holdPower(0.75);
    });
    expect(Math.abs(ac.body.position.y - 300)).toBeLessThan(2);
    expect(ac.powerplant.out.enginePower / a.propulsion.ratedPowerW).toBeCloseTo(0.75, 2);
    console.info(`cruise ${mpsToKt(ac.state.ias).toFixed(1)} kt (target ${T.cruiseKt.toFixed(0)})`);
    within10(mpsToKt(ac.state.ias), T.cruiseKt);
  }, LONG);

  it('stays under the Part 103 limit of 55 kt at full power in level flight', () => {
    const { world, ac } = makeWorld();
    startInFlight(ac, 300, 50);
    const pilot = new TestPilot(ac);
    ac.pilot.throttle = 1;
    fly(world, 120, () => {
      pilot.holdAltitude(300);
      pilot.bankTo(0);
    });
    console.info(`full-power level speed ${mpsToKt(ac.state.ias).toFixed(1)} kt (Part 103 limit 55)`);
    expect(mpsToKt(ac.state.ias)).toBeLessThan(55);
    expect(mpsToKt(ac.state.ias)).toBeGreaterThan(T.cruiseKt);
  }, LONG);

  it(`climbs at ${T.climbFpm.toFixed(0)} fpm at best-rate speed, full power`, () => {
    let best = 0;
    for (const kt of [30, 33, 36, 39, 42, 45]) {
      const { world, ac } = makeWorld();
      startInFlight(ac, 100, kt);
      const pilot = new TestPilot(ac);
      ac.pilot.throttle = 1;
      let sum = 0;
      let n = 0;
      fly(world, 35, (t) => {
        pilot.holdSpeedWithPitch(kt);
        pilot.bankTo(0);
        if (t > 20) {
          sum += ac.state.verticalSpeed;
          n++;
        }
      });
      best = Math.max(best, mpsToFpm(sum / n));
    }
    console.info(`best climb ${best.toFixed(0)} fpm (target ${T.climbFpm.toFixed(0)})`);
    within10(best, T.climbFpm);
  }, LONG);

  // Fuselage pitch attitudes in the three standard power conditions, flown as a pilot would
  // (user check, 2026-10-19): 0° in level flight at 75 % throttle, about +10° in the full-power
  // climb at best-rate speed, about −10° in an idle descent at 45 kt. Within ±2°. Flown at
  // 1,000 ft above the field: much higher, the engine's power falls off with the thinner air.
  const pitchAttitude = (throttle: number, hold: 'level' | number, startKt: number, startHeight = 300) => {
    const { world, ac } = makeWorld();
    startInFlight(ac, startHeight, startKt);
    const pilot = new TestPilot(ac);
    let sum = 0;
    let n = 0;
    fly(world, 150, (t) => {
      ac.pilot.throttle = throttle;
      if (hold === 'level') pilot.holdAltitude(300);
      else pilot.holdSpeedWithPitch(hold);
      pilot.bankTo(0);
      if (t > 90) {
        sum += attitude(ac).pitch;
        n++;
      }
    });
    const deg = (sum / n) * (180 / Math.PI);
    console.info(`pitch attitude ${deg.toFixed(1)}° at ${(throttle * 100).toFixed(0)} % throttle, ${mpsToKt(ac.state.ias).toFixed(0)} kt`);
    return deg;
  };
  it('pitch attitude: 0° level at 75 % throttle, +10° full-power climb, −10° idle descent', () => {
    expect(Math.abs(pitchAttitude(0.75, 'level', 47))).toBeLessThan(2);
    expect(Math.abs(pitchAttitude(1, 39, 39) - 10)).toBeLessThan(2);
    // The idle descent starts higher (it sinks ~1,000 fpm); at idle the thin-air power loss is irrelevant.
    expect(Math.abs(pitchAttitude(0, 45, 45, 1200) + 10)).toBeLessThan(2);
  }, LONG);

  for (const [name, x] of [['gravel', RUNWAYS.gravel.cx], ['grass', RUNWAYS.grass.cx]] as const) {
    it(`takes off in ${T.takeoffM} m on the ${name} runway (three-point technique)`, () => {
      const { world, ac } = makeWorld();
      ac.placeOnGround(x, 295, 0, 0, 0.02);
      ac.powerplant.start();
      fly(world, 3, () => {});
      const z0 = ac.body.position.z;
      const pilot = new TestPilot(ac);
      let roll = 0;
      fly(world, 40, () => {
        ac.pilot.throttle = 1;
        pilot.pitchTo(THREE_POINT);
        pilot.steerOnGround(0);
        if (ac.gear.states.every((s) => !s.inContact)) {
          roll = z0 - ac.body.position.z;
          return true;
        }
      });
      console.info(`take-off roll ${name} ${roll.toFixed(1)} m (target ${T.takeoffM})`);
      within10(roll, T.takeoffM);
      expect(Math.abs(ac.body.position.x - x)).toBeLessThan(3); // kept straight
    });
  }
});

describe('Air-Bike 103 circuits', () => {
  const cases = [
    { name: 'gravel runway 36', x: RUNWAYS.gravel.cx, dir: 1, rect: RUNWAYS.gravel },
    { name: 'grass runway 36', x: RUNWAYS.grass.cx, dir: 1, rect: RUNWAYS.grass },
    { name: 'grass runway 18', x: RUNWAYS.grass.cx, dir: -1, rect: RUNWAYS.grass },
    { name: 'gravel runway 18', x: RUNWAYS.gravel.cx, dir: -1, rect: RUNWAYS.gravel },
  ] as const;
  for (const c of cases) {
    it(`takes off, flies a 500 ft circuit and lands on ${c.name}`, () => {
      const { world, ac } = makeWorld();
      const r = flyCircuit(world, ac, { x: c.x, dir: c.dir }, SPEEDS);
      expect(r.maxHeight).toBeGreaterThan(145); // reached circuit height (500 ft)
      expect(r.phase).toBe('rollout');
      expect(r.stopped).toBe(true);
      expect(r.wingOrNoseStrike).toBe(false);
      expect(r.touchdownSink).toBeLessThan(fpmToMps(300)); // a firm but proper landing
      expect(r.touchdownLoad).toBeLessThan(3);
      expect(r.touchdownKt).toBeLessThan(T.stallKt * 1.25);
      // Stopped on the runway it landed on.
      expect(Math.abs(r.stopPoint.x - c.rect.cx)).toBeLessThan(c.rect.sizeX / 2);
      expect(Math.abs(r.stopPoint.z)).toBeLessThan(RUNWAYS.length / 2);
      expect(Math.abs(r.touchdownZ)).toBeLessThan(RUNWAYS.length / 2);
      console.info(`${c.name}: touchdown ${r.touchdownKt.toFixed(1)} kt, ${r.touchdownSink.toFixed(2)} m/s, landing roll ${r.landingRoll.toFixed(0)} m`);
    }, LONG);
  }
});
