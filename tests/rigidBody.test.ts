import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GRAVITY, PHYSICS_DT } from '../src/core/constants';
import { GearSet, type Ground } from '../src/physics/gear';
import { inertiaTensor, RigidBody } from '../src/physics/RigidBody';

const dt = PHYSICS_DT;
const flat: Ground = { heightAt: () => 0, surfaceAt: () => 'gravel' };
const run = (seconds: number, stepFn: () => void) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepFn();
};

describe('rigid body: free fall', () => {
  it('falls under gravity as ½ g t²', () => {
    const b = new RigidBody(100, inertiaTensor(10, 10, 10));
    b.reset(new THREE.Vector3(0, 500, 0));
    const t = 3;
    run(t, () => {
      b.addForce(new THREE.Vector3(0, -GRAVITY * b.mass, 0));
      b.integrate(dt);
    });
    expect(b.velocity.y).toBeCloseTo(-GRAVITY * t, 9);
    // Semi-implicit Euler lands within g t dt / 2 of the exact parabola (here 12 cm in 44 m).
    expect(Math.abs(b.position.y - (500 - 0.5 * GRAVITY * t * t))).toBeLessThan(GRAVITY * t * dt);
    expect(b.position.x).toBe(0);
    expect(b.orientation.equals(new THREE.Quaternion())).toBe(true);
  });

  it('a horizontal throw keeps its horizontal velocity', () => {
    const b = new RigidBody(5, inertiaTensor(1, 1, 1));
    b.velocity.set(12, 0, -7);
    run(2, () => {
      b.addForce(new THREE.Vector3(0, -GRAVITY * b.mass, 0));
      b.integrate(dt);
    });
    expect(b.velocity.x).toBeCloseTo(12, 12);
    expect(b.position.z).toBeCloseTo(-14, 9);
  });
});

describe('rigid body: rotation', () => {
  it('a steady yaw rate turns the heading by ω t (right-handed about +Y)', () => {
    const b = new RigidBody(1, inertiaTensor(1, 1, 1));
    b.angularVelocity.set(0, Math.PI / 4, 0); // 45°/s
    run(2, () => b.integrate(dt));
    const fwd = b.toWorld(new THREE.Vector3(0, 0, -1));
    // +90° about +Y turns north-facing (−Z) to west-facing (−X): a left turn seen from above.
    expect(fwd.x).toBeCloseTo(-1, 6);
    expect(fwd.z).toBeCloseTo(0, 6);
  });

  it('a force off the CG produces moment r × F', () => {
    const roll = 200;
    const b = new RigidBody(100, inertiaTensor(roll, 300, 400));
    // 100 N upward at the right wingtip (x = +4 m) rolls the right wing up (about +z).
    b.addForceAtBodyPoint(new THREE.Vector3(0, 100, 0), new THREE.Vector3(4, 0, 0));
    b.integrate(dt);
    expect(b.angularVelocity.z).toBeCloseTo((400 / roll) * dt, 9);
    expect(b.velocity.y).toBeCloseTo((100 / 100) * dt, 12);
  });

  it('pointVelocity adds ω × r', () => {
    const b = new RigidBody(1, inertiaTensor(1, 1, 1));
    b.angularVelocity.set(0, 1, 0);
    const v = b.pointVelocity(new THREE.Vector3(0, 0, -2)); // nose, 2 m ahead
    expect(v.x).toBeCloseTo(-2, 12); // yawing left swings the nose west
  });
});

describe('energy conservation', () => {
  it('a tumbling body keeps its energy and angular momentum (no torque)', () => {
    const b = new RigidBody(50, inertiaTensor(3, 6, 8));
    // Spin mostly about the intermediate axis: the unstable "tennis racket" flip.
    b.angularVelocity.set(4, 0.05, 0.05);
    const e0 = b.kineticEnergy();
    const L0 = b.angularMomentumWorld();
    let flipped = false;
    run(60, () => {
      b.integrate(dt);
      if (b.angularVelocity.x < 0) flipped = true;
    });
    expect(flipped).toBe(true); // the wobble really happens
    expect(Math.abs(b.kineticEnergy() / e0 - 1)).toBeLessThan(1e-6);
    // Angular momentum in world axes also depends on the attitude update; 0.1 % after a
    // minute of violent tumbling is far below anything a pilot could notice.
    expect(b.angularMomentumWorld().distanceTo(L0) / L0.length()).toBeLessThan(1e-3);
  });

  it('a body bouncing on an undamped strut does not gain or lose energy', () => {
    const k = 20000;
    const b = new RigidBody(100, inertiaTensor(50, 50, 50));
    const gear = new GearSet([
      { name: 'strut', kind: 'skid', position_m: [0, -0.5, 0], spring_N_per_m: k, damper_Ns_per_m: 0, travel_m: 1 },
    ]);
    b.reset(new THREE.Vector3(0, 2, 0));
    const controls = { pedals: 0, brakeLeft: 0, brakeRight: 0 };
    // While the strut is compressed, a fixed-step integrator shows a small energy ripple
    // (a few % at this stiffness) that comes back out on rebound. The honest check is the
    // height of each bounce: all energy is potential at the top, so if no energy is gained
    // or lost every bounce returns to the 2 m release height.
    const apexes: number[] = [];
    let top = -Infinity;
    let bounces = 0;
    let wasDown = false;
    run(30, () => {
      b.addForce(new THREE.Vector3(0, -GRAVITY * b.mass, 0));
      gear.apply(b, flat, controls, dt);
      b.integrate(dt);
      const down = gear.states[0].inContact;
      if (down && !wasDown) bounces++;
      if (!down) top = Math.max(top, b.position.y);
      if (down && !wasDown && top > -Infinity) {
        apexes.push(top);
        top = -Infinity;
      }
      wasDown = down;
    });
    expect(bounces).toBeGreaterThan(10);
    for (const h of apexes.slice(1)) expect(Math.abs(h - 2)).toBeLessThan(0.02);
});
});
