import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { mpsToFpm, mpsToKt } from '../src/core/units';
import { RUNWAYS } from '../src/world/layout';
import { flyCircuit } from './helpers/circuit';
import { fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

// Automated flight tests of the Super Decathlon against CLAUDE.md (±10 %).
// Test mass: empty 592 kg + pilot 90 kg + full fuel (151 L x 0.72 kg/L) = 791 kg.
// Speeds are indicated unless stated. Calm air, ISA, field elevation 50 ft.

const D = AIRCRAFT.decathlon8kcab;
const T = {
  stallKt: mpsToKt(D.targets.stall_mps!),
  vyKt: mpsToKt(D.targets.vy_mps!),
  vxKt: mpsToKt(D.targets.vx_mps!),
  climbFpm: mpsToFpm(D.targets.climb_mps!),
  cruiseKt: mpsToKt(D.targets.cruise_mps!),
  takeoffM: D.targets.takeoffRoll_m!,
  landingM: D.targets.landingRoll_m!,
};
const within10 = (value: number, target: number) => {
  expect(value).toBeGreaterThan(target * 0.9);
  expect(value).toBeLessThan(target * 1.1);
};
const THREE_POINT = (11 * Math.PI) / 180;
const LONG = 180_000;

describe('Super Decathlon performance', () => {
  it(`stalls at ${T.stallKt.toFixed(0)} kt (power idle, slowing 1 kt/s)`, () => {
    const { world, ac } = makeWorld(D);
    startInFlight(ac, 500, 80);
    const pilot = new TestPilot(ac);
    ac.pilot.throttle = 0;
    const alphaStall = (D.aero!.alpha_deg[D.aero!.CL.indexOf(Math.max(...D.aero!.CL))] * Math.PI) / 180;
    let vs = 0;
    fly(world, 60, (t) => {
      pilot.holdSpeedWithPitch(Math.max(80 - t, 20));
      pilot.bankTo(0);
      if (ac.state.alpha > alphaStall) {
        vs = mpsToKt(ac.state.ias);
        return true;
      }
    });
    console.info(`stall ${vs.toFixed(1)} kt (target ${T.stallKt.toFixed(0)})`);
    within10(vs, T.stallKt);
  });

  it(`climbs ${T.climbFpm.toFixed(0)} fpm at Vy ${T.vyKt.toFixed(0)} kt (full power, 2700 rpm, sea level)`, () => {
    let best = 0;
    let vy = 0;
    let bestAngle = 0;
    let vx = 0;
    for (let kt = 52; kt <= 88; kt += 2) {
      const { world, ac } = makeWorld(D);
      startInFlight(ac, 100, kt);
      const pilot = new TestPilot(ac);
      ac.pilot.throttle = 1;
      let vs = 0;
      let tas = 0;
      let n = 0;
      fly(world, 40, (t) => {
        pilot.holdSpeedWithPitch(kt);
        pilot.bankTo(0);
        if (t > 25) {
          vs += ac.state.verticalSpeed;
          tas += ac.state.tas;
          n++;
        }
      });
      const fpm = mpsToFpm(vs / n);
      if (fpm > best) [best, vy] = [fpm, kt];
      if (vs / tas > bestAngle) [bestAngle, vx] = [vs / tas, kt];
    }
    console.info(`best climb ${best.toFixed(0)} fpm at Vy ${vy} kt; best angle at Vx ${vx} kt (targets ${T.climbFpm.toFixed(0)} fpm, Vy ${T.vyKt.toFixed(0)}, Vx ${T.vxKt.toFixed(0)})`);
    within10(best, T.climbFpm);
    within10(vy, T.vyKt);
  }, LONG);

  it(`cruises at ${T.cruiseKt.toFixed(0)} kt TAS at 75 % power (7,500 ft, 2700 rpm)`, () => {
    const { world, ac } = makeWorld(D);
    const h = 2286; // 7,500 ft: about the highest a 180 hp engine still makes 75 %
    startInFlight(ac, h, 110);
    const pilot = new TestPilot(ac);
    ac.pilot.propLever = 1;
    fly(world, 150, () => {
      pilot.holdAltitude(h);
      pilot.bankTo(0);
      pilot.holdPower(0.75);
    });
    expect(ac.powerplant.out.enginePower / D.propulsion.ratedPowerW).toBeCloseTo(0.75, 2);
    console.info(`cruise ${mpsToKt(ac.state.tas).toFixed(1)} kt TAS, ${mpsToKt(ac.state.ias).toFixed(1)} kt IAS (target ${T.cruiseKt.toFixed(0)} kt)`);
    within10(mpsToKt(ac.state.tas), T.cruiseKt);
  }, LONG);

  it(`takes off in ${T.takeoffM} m on the gravel runway (three-point technique)`, () => {
    const { world, ac } = makeWorld(D);
    ac.placeOnGround(RUNWAYS.gravel.cx, 295, 0, 0, 0.02);
    ac.powerplant.start();
    fly(world, 3, () => {});
    const z0 = ac.body.position.z;
    const pilot = new TestPilot(ac);
    let roll = 0;
    let vlof = 0;
    fly(world, 40, () => {
      ac.pilot.throttle = 1;
      pilot.pitchTo(THREE_POINT);
      pilot.steerOnGround(0);
      if (ac.gear.states.every((s) => !s.inContact)) {
        roll = z0 - ac.body.position.z;
        vlof = mpsToKt(ac.state.ias);
        return true;
      }
    });
    console.info(`take-off roll ${roll.toFixed(0)} m, lift-off ${vlof.toFixed(0)} kt (target ${T.takeoffM} m)`);
    within10(roll, T.takeoffM);
    expect(Math.abs(ac.body.position.x - RUNWAYS.gravel.cx)).toBeLessThan(4);
  });

  it(`flies a circuit and lands on gravel 36, stopping in about ${T.landingM} m with brakes`, () => {
    const { world, ac } = makeWorld(D);
    const r = flyCircuit(world, ac, { x: RUNWAYS.gravel.cx, dir: 1 }, {
      climbKt: 71,
      circuitKt: 90,
      approachKt: 60, // 1.3 Vs
      threePointPitch: THREE_POINT,
      rolloutBrakes: 0.5, // steady braking with the stick held back
      flareHeight: 5,
      flareThrottle: 0.2, // a whisker of power: the idling constant-speed prop is a big air brake
      circuitHeight: 152, // 500 ft
      downwindOffset: 900,
      baseDistance: 2000, // a 1.75 km final: right for a 5° approach from 500 ft
    });
    console.info(`landing: touchdown ${r.touchdownKt.toFixed(0)} kt, ${r.touchdownSink.toFixed(2)} m/s, roll ${r.landingRoll.toFixed(0)} m (target ${T.landingM} m)`);
    expect(r.stopped).toBe(true);
    expect(r.wingOrNoseStrike).toBe(false);
    expect(r.touchdownSink).toBeLessThan(1.6);
    expect(r.touchdownLoad).toBeLessThan(3);
    expect(r.touchdownKt).toBeLessThan(T.stallKt * 1.15); // a three-point landing near the stall
    expect(Math.abs(r.stopPoint.x - RUNWAYS.gravel.cx)).toBeLessThan(RUNWAYS.gravel.sizeX / 2);
    expect(Math.abs(r.touchdownZ)).toBeLessThan(RUNWAYS.length / 2); // touched down on the runway
    expect(Math.abs(r.stopPoint.z)).toBeLessThan(RUNWAYS.length / 2); // and stopped on it
    within10(r.landingRoll, T.landingM);
  }, LONG);
});
