import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import type { AircraftData } from '../src/aircraft/schema';
import { PHYSICS_DT } from '../src/core/constants';
import { ktToMps } from '../src/core/units';
import { FixedWingAircraft } from '../src/physics/FixedWingAircraft';
import { Powerplant } from '../src/physics/powerplant';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const D = AIRCRAFT.decathlon8kcab;
const deg = Math.PI / 180;

describe('constant-speed propeller', () => {
  const run = (pp: Powerplant, throttle: number, lever: number, kt: number, seconds = 10) => {
    for (let i = 0; i < seconds / PHYSICS_DT; i++) pp.step(PHYSICS_DT, { throttle, propLever: lever, airspeed: ktToMps(kt), density: 1.2 });
    return pp.out;
  };

  it('governs the engine to the rpm lever setting', () => {
    const pp = new Powerplant(D);
    pp.start();
    expect(run(pp, 1, 1, 100).engineRpm).toBeCloseTo(2700, -1.5);
    expect(run(pp, 1, 0, 100).engineRpm).toBeCloseTo(2000, -1.5);
    // Coarser blades at the lower rpm, to absorb the same power.
    const fine = run(pp, 1, 1, 100).pitchScale;
    expect(run(pp, 1, 0, 100).pitchScale).toBeGreaterThan(fine);
  });

  it('coarsens the blades as speed rises, and sits on the fine stop at low power', () => {
    const pp = new Powerplant(D);
    pp.start();
    const slow = run(pp, 1, 1, 70).pitchScale;
    expect(run(pp, 1, 1, 140).pitchScale).toBeGreaterThan(slow);
    const idle = run(pp, 0, 1, 60);
    expect(idle.pitchScale).toBeCloseTo(D.propeller!.constantSpeed!.pitchScaleMin, 6);
    expect(idle.engineRpm).toBeLessThan(2000); // below the governed range: like a fixed-pitch prop
  });
});

describe('propeller effects on the airframe (clockwise prop, seen from the cockpit)', () => {
  /** One physics step of an aircraft at a given attitude and rates, far above the ground. */
  function oneStep(data: AircraftData, alphaDeg: number, omega: THREE.Vector3) {
    const world = new PhysicsWorld({ heightAt: () => -10000, surfaceAt: () => 'grass' });
    const ac = new FixedWingAircraft(data);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), alphaDeg * deg);
    ac.body.reset(new THREE.Vector3(0, 1000, 0), q);
    ac.body.velocity.set(0, 0, -ktToMps(60)); // flying level north: alpha = body pitch
    ac.body.angularVelocity.copy(omega);
    ac.powerplant.start();
    ac.powerplant.omega = (2700 / 60) * 2 * Math.PI;
    ac.powerplant.pitchScale = 0.9;
    ac.pilot.throttle = 1;
    world.add(ac);
    world.step(PHYSICS_DT);
    world.step(PHYSICS_DT); // second step: the spool-up term (dH/dt) has a previous value
    return ac.body.angularVelocity.clone();
  }
  const without = (patch: (d: AircraftData) => void): AircraftData => {
    const copy = structuredClone(D) as AircraftData;
    patch(copy);
    return copy;
  };

  it('P-factor yaws the nose left when nose-high at full power', () => {
    const withPf = oneStep(D, 12, new THREE.Vector3());
    const noPf = oneStep(without((d) => (d.propeller!.pFactor = 0)), 12, new THREE.Vector3());
    // Left yaw is a positive rotation about +y (yaw right is about −y).
    expect(withPf.y - noPf.y).toBeGreaterThan(0);
  });

  it('gyroscopic precession: pitching up swings the nose right, pitching down swings it left', () => {
    const rate = new THREE.Vector3(0.5, 0, 0); // pitching up at 0.5 rad/s
    const gyro = oneStep(D, 0, rate);
    const none = oneStep(without((d) => {
      d.propeller!.inertia_kgm2 = 1e-3;
      d.engine!.inertia_kgm2 = 1e-3;
    }), 0, rate);
    expect(gyro.y - none.y).toBeLessThan(0); // yaw right
    const down = oneStep(D, 0, new THREE.Vector3(-0.5, 0, 0));
    const downNone = oneStep(without((d) => {
      d.propeller!.inertia_kgm2 = 1e-3;
      d.engine!.inertia_kgm2 = 1e-3;
    }), 0, new THREE.Vector3(-0.5, 0, 0));
    expect(down.y - downNone.y).toBeGreaterThan(0); // yaw left: the tail-up swing on take-off
  });

  it('opening the throttle rolls the aircraft left (torque reaction)', () => {
    const w = oneStep(D, 0, new THREE.Vector3());
    const idle = (() => {
      const world = new PhysicsWorld({ heightAt: () => -10000, surfaceAt: () => 'grass' });
      const ac = new FixedWingAircraft(D);
      ac.body.reset(new THREE.Vector3(0, 1000, 0));
      ac.body.velocity.set(0, 0, -ktToMps(60));
      world.add(ac);
      world.step(PHYSICS_DT);
      world.step(PHYSICS_DT);
      return ac.body.angularVelocity.clone();
    })();
    // Roll left (right wing up) is positive about +z.
    expect(w.z - idle.z).toBeGreaterThan(0);
  });
});
