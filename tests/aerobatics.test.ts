import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { mpsToKt } from '../src/core/units';
import { Powerplant } from '../src/physics/powerplant';
import { aileronRoll, invertedFlight, loop, settle, setUp, spin, stallTurn } from './helpers/aerobatics';
import { dt, fly, makeWorld, Pid } from './helpers/testPilot';

// Aerobatics in the Super Decathlon, flown by an automated pilot (CLAUDE.md: loop, aileron
// roll, stall turn and spin recovery must be flyable; +6/−5 g limits; inverted systems).

const D = AIRCRAFT.decathlon8kcab;
const VS = mpsToKt(D.targets.stall_mps!);
const LONG = 120_000;

function decathlonAt(height: number, kt: number) {
  const { world, ac } = makeWorld(D);
  setUp(ac, height, kt);
  settle(world, ac, kt);
  return { world, ac };
}

describe('Super Decathlon aerobatics', () => {
  it('flies an inside loop at 4 g without over-stressing', () => {
    const { world, ac } = decathlonAt(1500, 125);
    const r = loop(world, ac, VS);
    console.info(`loop: ${r.duration.toFixed(1)} s, max ${r.maxG.toFixed(1)} g, top ${r.minIasKt.toFixed(0)} kt, height ${r.altitudeChange.toFixed(0)} m`);
    expect(r.completed).toBe(true);
    expect(r.overstressed).toBe(false);
    expect(r.maxG).toBeLessThan(6);
    expect(r.minIasKt).toBeGreaterThan(30); // still flying over the top
    expect(Math.abs(r.altitudeChange)).toBeLessThan(60); // comes out where it went in
    expect(r.headingChangeDeg).toBeLessThan(10);
    expect(r.engineAlways).toBe(true);
  }, LONG);

  it('flies an aileron roll in under 5 s', () => {
    const { world, ac } = decathlonAt(1500, 115);
    const r = aileronRoll(world, ac);
    console.info(`aileron roll: 360° in ${(r.rollTime as number).toFixed(2)} s, height ${r.altitudeChange.toFixed(0)} m`);
    expect(r.completed).toBe(true);
    expect(r.rollTime as number).toBeLessThan(5);
    expect(r.overstressed).toBe(false);
    expect(Math.abs(r.altitudeChange)).toBeLessThan(60);
    expect(r.headingChangeDeg).toBeLessThan(20);
    expect(r.engineAlways).toBe(true); // inverted fuel and oil keep it running through the roll
  }, LONG);

  it('flies a stall turn: vertical, pivot through 180°, dive and pull out', () => {
    const { world, ac } = decathlonAt(1500, 140);
    const r = stallTurn(world, ac, VS);
    console.info(`stall turn: pivot ${(r.pivotDeg as number).toFixed(0)}°, heading change ${r.headingChangeDeg.toFixed(0)}°, slowest ${r.minIasKt.toFixed(0)} kt, height ${r.altitudeChange.toFixed(0)} m`);
    expect(r.completed).toBe(true);
    expect(r.pivotDeg as number).toBeGreaterThan(150);
    expect(r.pivotDeg as number).toBeLessThan(230);
    expect(r.headingChangeDeg).toBeGreaterThan(140); // reversed direction
    expect(r.minForwardSpeed as number).toBeGreaterThan(-3); // no real tail slide
    expect(r.overstressed).toBe(false);
    expect(Math.abs(r.altitudeChange)).toBeLessThan(80);
  }, LONG);

  it('enters a developed spin and recovers within 1.5 turns', () => {
    const { world, ac } = makeWorld(D);
    setUp(ac, 1800, 70);
    settle(world, ac, 70, 4);
    const r = spin(world, ac, VS, 2);
    console.info(
      `spin: ${(r.spinRateDegS as number).toFixed(0)} °/s at ${(r.spinAlphaDeg as number).toFixed(0)}° alpha, ` +
        `recovered in ${(r.recoveryTurns as number).toFixed(2)} turns, total height loss ${(-r.altitudeChange).toFixed(0)} m`,
    );
    expect(r.completed).toBe(true);
    expect(r.spinRateDegS as number).toBeGreaterThan(120); // autorotating, not a spiral
    expect(r.spinAlphaDeg as number).toBeGreaterThan(25); // wing stalled
    expect(r.recoveryTurns as number).toBeLessThan(1.5);
    expect(-r.altitudeChange).toBeLessThan(500);
    expect(r.overstressed).toBe(false);
  }, LONG);

  it('flies inverted for 20 s on its inverted fuel and oil systems', () => {
    const { world, ac } = decathlonAt(1500, 110);
    const r = invertedFlight(world, ac, 20);
    console.info(`inverted: held height to ${(r.worstHeightError as number).toFixed(0)} m, power ${((r.minPowerFraction as number) * 100).toFixed(0)}%, oil ${((r.oilPressure as number) * 100).toFixed(0)}%, ${r.minG.toFixed(1)} g`);
    expect(r.completed).toBe(true);
    expect(r.upsideDown).toBe(true);
    expect(r.minG).toBeLessThan(-0.7);
    expect(r.worstHeightError as number).toBeLessThan(40);
    expect(r.minPowerFraction as number).toBeGreaterThan(0.6); // engine kept running at power
    expect(r.oilPressure as number).toBeGreaterThan(0.8);
    expect(r.engineAlways).toBe(true);
  }, LONG);
});

describe('G limits and over-stress', () => {
  /**
   * A short, sharp pull (or push) from 150 kt towards a target load factor, held about a
   * second: long enough to register on the G-meter, short enough not to bleed the speed away.
   * Records whether the warning came on at any moment, as the pilot would see it.
   */
  function pull(target: number) {
    const { world, ac } = makeWorld(D);
    setUp(ac, 1500, 150);
    const gLoop = new Pid(0.08, 0.4, -1, 1, 0); // gentle: no overshoot past the target
    let warned = false;
    fly(world, 1.2, () => {
      ac.pilot.throttle = 1;
      ac.pilot.elevator = gLoop.update(target - ac.gMonitor.g);
      if (ac.gMonitor.warning) warned = true;
    });
    return { ...ac.gMonitor, warned };
  }

  it('reads about 1 g level and 2 g in a 60° banked level turn', () => {
    const { world, ac } = decathlonAt(1500, 110);
    expect(ac.gMonitor.g).toBeCloseTo(1, 1);
    const gLoop = new Pid(0.25, 0.8, -1, 1, 0.3);
    fly(world, 6, () => {
      ac.pilot.throttle = 1;
      // Hold a 60° bank (cos 60° = 0.5) and the load factor that keeps it level: 1 / cos(bank) = 2 g.
      const right = ac.body.toWorld(ac.body.angularVelocity.clone().set(1, 0, 0));
      const bank = Math.atan2(-right.y, ac.body.toWorld(right.clone().set(0, 1, 0)).y);
      ac.pilot.aileron = Math.max(-1, Math.min(1, 2 * ((60 * Math.PI) / 180 - bank) + 0.5 * ac.body.angularVelocity.z));
      ac.pilot.elevator = gLoop.update(2 - ac.gMonitor.g);
    });
    expect(ac.gMonitor.g).toBeCloseTo(2, 0);
    expect(ac.gMonitor.warning).toBe(false);
  }, LONG);

  it('warns within 10 % of +6 g and flags over-stress beyond it', () => {
    const at4 = pull(4.3);
    expect(at4.max).toBeGreaterThan(4);
    expect(at4.warned).toBe(false);
    expect(at4.overstressed).toBe(false);
    const near = pull(5.6);
    expect(near.max).toBeGreaterThan(5.4);
    expect(near.max).toBeLessThan(6);
    expect(near.warned).toBe(true);
    expect(near.overstressed).toBe(false);
    const over = pull(6.8);
    expect(over.max).toBeGreaterThan(6);
    expect(over.overstressed).toBe(true);
  }, LONG);

  it('flags over-stress beyond −5 g and over-speed beyond Vne', () => {
    const neg = pull(-5.5);
    expect(neg.overstressed).toBe(true);
    expect(neg.min).toBeLessThan(-5);
    const { world, ac } = decathlonAt(2500, 150);
    const pitch = new Pid(3, 1);
    fly(world, 40, () => {
      ac.pilot.throttle = 1;
      // Hold a 40° dive at full power until well past Vne.
      const fwd = ac.body.toWorld(ac.body.velocity.clone().set(0, 0, -1));
      ac.pilot.elevator = pitch.update((-40 * Math.PI) / 180 - Math.asin(fwd.y), -0.5 * ac.body.angularVelocity.x);
    });
    expect(ac.gMonitor.overspeedLatched).toBe(true);
  }, LONG);
});

describe('negative g and engine feed', () => {
  const settle = (pp: Powerplant, seconds: number, loadFactor: number) => {
    for (let i = 0; i < seconds / dt; i++) pp.step(dt, { throttle: 1, airspeed: 25, density: 1.2, loadFactor });
    return pp.out;
  };

  it('the Air-Bike (float carb, no inverted systems) starves under negative g, then recovers', () => {
    const pp = new Powerplant(AIRCRAFT.airbike103);
    pp.start();
    const normal = settle(pp, 5, 1).enginePower;
    const starved = settle(pp, 2, -1);
    expect(starved.fuelStarved).toBe(true);
    expect(starved.enginePower).toBeLessThan(0.05 * normal);
    expect(starved.oilPressure).toBeLessThan(0.5);
    expect(pp.running).toBe(true); // still turning; picks up again
    const back = settle(pp, 3, 1);
    expect(back.fuelStarved).toBe(false);
    expect(back.enginePower).toBeGreaterThan(0.8 * normal);
  });

  it('the Decathlon (inverted fuel and oil) keeps full power at −2 g', () => {
    const pp = new Powerplant(AIRCRAFT.decathlon8kcab);
    pp.start();
    const normal = settle(pp, 8, 1).enginePower;
    const inverted = settle(pp, 5, -2);
    expect(inverted.fuelStarved).toBe(false);
    expect(inverted.enginePower).toBeGreaterThan(0.95 * normal);
    expect(inverted.oilPressure).toBeGreaterThan(0.9);
  });
});
