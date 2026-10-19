import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { PHYSICS_DT } from '../src/core/constants';
import { FixedWingAircraft } from '../src/physics/FixedWingAircraft';
import { Powerplant } from '../src/physics/powerplant';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const data = AIRCRAFT.airbike103;
const settle = (pp: Powerplant, throttle: number, airspeed: number, seconds = 8) => {
  for (let i = 0; i < seconds / PHYSICS_DT; i++) pp.step(PHYSICS_DT, throttle, airspeed, 1.225);
  return pp.out;
};

describe('Hirth F-33 and propeller', () => {
  it('full-throttle power curve peaks at the rated 20.6 kW at 6500 rpm', () => {
    const pp = new Powerplant(data);
    expect(pp.fullThrottlePower(6500)).toBe(20600);
    for (const rpm of [3000, 5000, 6000, 7000]) expect(pp.fullThrottlePower(rpm)).toBeLessThan(20600);
  });

  it('static full power: about 5300 engine rpm through the 2.5:1 belt', () => {
    const pp = new Powerplant(data);
    pp.start();
    const o = settle(pp, 1, 0);
    expect(o.engineRpm).toBeGreaterThan(5000);
    expect(o.engineRpm).toBeLessThan(5800);
    expect(o.propRpm).toBeCloseTo(o.engineRpm / 2.5, 6);
    expect(o.thrust).toBeGreaterThan(550);
    expect(o.enginePower).toBeLessThan(20600);
  });

  it('idles steadily well below full rpm, and opening the throttle spools it up', () => {
    const pp = new Powerplant(data);
    pp.start();
    const idle = settle(pp, 0, 0).engineRpm;
    expect(pp.running).toBe(true);
    expect(idle).toBeGreaterThan(1200);
    expect(idle).toBeLessThan(2200);
    expect(settle(pp, 0.5, 0, 4).engineRpm).toBeGreaterThan(idle + 1000);
  });

  it('spools idle to full in about 1.1 s and back in about 1.3 s (static, to 90 % of the change)', () => {
    const pp = new Powerplant(data);
    pp.start();
    const idle = settle(pp, 0, 0, 20).engineRpm;
    const full = settle(pp, 1, 0, 20).engineRpm;
    const time = (from: number, to: number, throttle: number) => {
      let t = 0;
      while (Math.abs(pp.rpm - from) < 0.9 * Math.abs(to - from) && t < 30) {
        pp.step(PHYSICS_DT, throttle, 0, 1.225);
        t += PHYSICS_DT;
      }
      return t;
    };
    settle(pp, 0, 0, 20);
    const up = time(idle, full, 1);
    settle(pp, 1, 0, 20);
    const down = time(full, idle, 0);
    expect(up).toBeGreaterThan(0.9);
    expect(up).toBeLessThan(1.35);
    expect(down).toBeGreaterThan(1.0);
    expect(down).toBeLessThan(1.5);
  });

  it('the propeller unloads with airspeed and windmills (negative thrust) in a fast glide', () => {
    const pp = new Powerplant(data);
    pp.start();
    const staticT = settle(pp, 1, 0).thrust;
    const cruiseT = settle(pp, 1, 25).thrust;
    expect(cruiseT).toBeLessThan(staticT);
    expect(settle(pp, 0, 30).thrust).toBeLessThan(0);
  });

  it('burns fuel in proportion to power, and stops when stopped', () => {
    const pp = new Powerplant(data);
    pp.start();
    const o = settle(pp, 1, 20);
    const litresPerHour = (o.fuelFlow * 3600) / data.mass.fuelDensityKgPerL;
    expect(litresPerHour).toBeGreaterThan(8);
    expect(litresPerHour).toBeLessThan(14);
    pp.stop();
    const off = settle(pp, 1, 0, 10);
    expect(off.engineRpm).toBeLessThan(1);
    expect(off.fuelFlow).toBe(0);
  });

  it('single-cylinder two-stroke fires once per revolution', () => {
    const pp = new Powerplant(data);
    pp.start();
    const o = settle(pp, 1, 20);
    expect(o.vibrationHz).toBeCloseTo(o.engineRpm / 60, 6);
    expect(o.vibration).toBeGreaterThan(0);
  });

  it('a clockwise propeller rolls the aircraft left (torque reaction)', () => {
    const world = new PhysicsWorld({ heightAt: () => -1000, surfaceAt: () => 'grass' });
    const ac = new FixedWingAircraft(data);
    ac.body.reset(new THREE.Vector3(0, 500, 0));
    ac.powerplant.start();
    ac.pilot.throttle = 1;
    world.add(ac);
    // Freeze everything but the propeller: no airflow, no gravity effects on attitude.
    for (let i = 0; i < 60; i++) {
      ac.body.velocity.set(0, 0, 0);
      ac.body.angularVelocity.set(0, 0, 0);
      world.step(PHYSICS_DT);
    }
    const p = -ac.body.angularVelocity.z; // roll rate, right wing down positive
    expect(p).toBeLessThan(0);
  });
});
