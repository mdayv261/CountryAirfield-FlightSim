import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { GRAVITY, PHYSICS_DT } from '../src/core/constants';
import { Airframe } from '../src/physics/Airframe';
import { GearSet, type Ground } from '../src/physics/gear';
import { PhysicsWorld, type PhysicsActor } from '../src/physics/PhysicsWorld';
import { inertiaTensor, RigidBody } from '../src/physics/RigidBody';
import { surfaceAt, SURFACES, type SurfaceType } from '../src/physics/surfaces';
import { TEST_BLOCK, TestBlock } from '../src/physics/testBlock';
import { Heightfield } from '../src/world/terrain';

const dt = PHYSICS_DT;
const flat = (surface: SurfaceType = 'gravel'): Ground => ({ heightAt: () => 0, surfaceAt: () => surface });
const simulate = (world: PhysicsWorld, seconds: number, each?: () => void) => {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    world.step(dt);
    each?.();
  }
};
const pitchDeg = (b: RigidBody) => {
  const fwd = b.toWorld(new THREE.Vector3(0, 0, -1));
  return (Math.asin(fwd.y) * 180) / Math.PI;
};
const headingDeg = (b: RigidBody) => {
  const fwd = b.toWorld(new THREE.Vector3(0, 0, -1));
  return ((Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI + 360) % 360;
};

/** Test block without drag or thrust: just a body on its gear. */
class Cart implements PhysicsActor {
  readonly body = new RigidBody(TEST_BLOCK.mass, inertiaTensor(12, 12, 16));
  readonly gear = new GearSet(TEST_BLOCK.legs);
  readonly controls = { pedals: 0, brakeLeft: 0, brakeRight: 0 };
  applyForces(env: PhysicsWorld, step: number): void {
    this.gear.apply(this.body, env.ground, this.controls, step);
  }
}

describe('surfaces', () => {
  it('uses the CLAUDE.md friction: gravel 0.6, grass 0.4', () => {
    expect(SURFACES.gravel.mu).toBe(0.6);
    expect(SURFACES.grass.mu).toBe(0.4);
  });
  it('maps the runways, apron and taxiways', () => {
    expect(surfaceAt(0, 0)).toBe('gravel'); // gravel runway
    expect(surfaceAt(30, 0)).toBe('grass'); // grass runway
    expect(surfaceAt(-60, 0)).toBe('gravel'); // apron
    expect(surfaceAt(-45, -200)).toBe('gravel'); // taxiway
    expect(surfaceAt(520, -720)).toBe('water'); // dam
    expect(surfaceAt(-1000, 900)).toBe('grass');
  });
});

describe('aircraft at rest on gear', () => {
  for (const data of Object.values(AIRCRAFT)) {
    it(`${data.name} settles and sits still on its wheels`, () => {
      const world = new PhysicsWorld(flat());
      const a = new Airframe(data);
      a.placeOnGround(0, 0, 0, 0, 0.1);
      world.add(a);
      simulate(world, 15);
      const b = a.body;
      expect(b.velocity.length()).toBeLessThan(1e-3);
      expect(b.angularVelocity.length()).toBeLessThan(1e-3);

      const wheels = a.gear.states.filter((_, i) => a.gear.legs[i].kind === 'wheel');
      const skids = a.gear.states.filter((_, i) => a.gear.legs[i].kind === 'skid');
      expect(wheels.every((s) => s.inContact)).toBe(true);
      expect(skids.some((s) => s.inContact)).toBe(false);
      // The wheels carry the whole weight.
      const load = wheels.reduce((n, s) => n + s.normalForce, 0);
      expect(load / (b.mass * GRAVITY)).toBeCloseTo(1, 3);
      // Each strut compresses by load / spring rate, and stays inside its travel.
      a.gear.legs.forEach((leg, i) => {
        const s = a.gear.states[i];
        if (leg.kind !== 'wheel') return;
        expect(s.compression).toBeCloseTo(s.normalForce / leg.spring_N_per_m, 4);
        expect(s.compression).toBeLessThan(leg.travel_m);
      });
      // Taildraggers sit nose-up; the tricycle gyro sits nearly level. No sliding off.
      if (data.gear.layout === 'taildragger') {
        expect(pitchDeg(b)).toBeGreaterThan(8);
        expect(pitchDeg(b)).toBeLessThan(14);
      } else {
        expect(Math.abs(pitchDeg(b))).toBeLessThan(3);
      }
      expect(Math.hypot(b.position.x, b.position.z)).toBeLessThan(0.3);
      expect(Math.abs(headingDeg(b) - 0) % 360).toBeLessThan(0.1);
    });
  }
});

describe('static friction', () => {
  it('a parked aircraft under a steady yaw torque stays put (no creep)', () => {
    const world = new PhysicsWorld(flat('gravel'));
    const a = new Airframe(AIRCRAFT.bensenB8M);
    a.placeOnGround(0, 0, 0, 0, 0.05);
    world.add(a);
    simulate(world, 3);
    const h0 = headingDeg(a.body);
    const p0 = a.body.position.clone();
    // 140 N m about the vertical for half a minute: a gyro prerotator's reaction torque.
    simulate(world, 30, () => a.body.addTorque(new THREE.Vector3(0, 140, 0)));
    // Only the static-friction springs' small elastic give, no creep.
    const turned = Math.abs(((headingDeg(a.body) - h0 + 540) % 360) - 180);
    expect(turned).toBeLessThan(1);
    expect(a.body.position.distanceTo(p0)).toBeLessThan(0.05);
  });

  it('it still breaks free when the torque exceeds the grip', () => {
    const world = new PhysicsWorld(flat('gravel'));
    const a = new Airframe(AIRCRAFT.bensenB8M);
    a.placeOnGround(0, 0, 0, 0, 0.05);
    world.add(a);
    simulate(world, 3);
    const h0 = headingDeg(a.body);
    simulate(world, 3, () => a.body.addTorque(new THREE.Vector3(0, 3000, 0)));
    expect(Math.abs(((headingDeg(a.body) - h0 + 540) % 360) - 180)).toBeGreaterThan(10);
  });
});

describe('tyre friction', () => {
  const stopDistance = (surface: SurfaceType, speed: number, brake: number) => {
    const world = new PhysicsWorld(flat(surface));
    const cart = new Cart();
    cart.body.reset(new THREE.Vector3(0, 0.85, 0));
    world.add(cart);
    simulate(world, 2); // settle on the struts
    cart.body.velocity.set(0, 0, -speed);
    cart.controls.brakeLeft = cart.controls.brakeRight = brake;
    const z0 = cart.body.position.z;
    let t = 0;
    while (cart.body.velocity.length() > 0.05 && t < 60) {
      world.step(dt);
      t += dt;
    }
    return z0 - cart.body.position.z;
  };

  it('full brakes stop in v²/(2 μ g): gravel μ 0.6, grass μ 0.4', () => {
    const v = 10;
    const gravel = stopDistance('gravel', v, 1);
    const grass = stopDistance('grass', v, 1);
    expect(gravel / ((v * v) / (2 * 0.6 * GRAVITY))).toBeCloseTo(1, 1);
    expect(grass / ((v * v) / (2 * 0.4 * GRAVITY))).toBeCloseTo(1, 1);
    expect(grass).toBeGreaterThan(gravel * 1.4);
  });

  it('free-rolling wheels coast further on gravel than on grass', () => {
    const v = 5;
    const gravel = stopDistance('gravel', v, 0);
    const grass = stopDistance('grass', v, 0);
    expect(gravel / ((v * v) / (2 * SURFACES.gravel.rolling * GRAVITY))).toBeCloseTo(1, 1);
    expect(grass / ((v * v) / (2 * SURFACES.grass.rolling * GRAVITY))).toBeCloseTo(1, 1);
  });

  it('a skid slides to a stop with Coulomb friction μ g', () => {
    const world = new PhysicsWorld(flat('gravel'));
    const body = new RigidBody(20, inertiaTensor(1e6, 1e6, 1e6)); // too stiff to tip over
    const gear = new GearSet([
      { name: 'pad', kind: 'skid', position_m: [0, -0.2, 0], spring_N_per_m: 50000, damper_Ns_per_m: 1500, travel_m: 0.1 },
    ]);
    const actor: PhysicsActor = { body, applyForces: (env, step) => gear.apply(body, env.ground, { pedals: 0, brakeLeft: 0, brakeRight: 0 }, step) };
    body.reset(new THREE.Vector3(0, 0.196, 0));
    world.add(actor);
    simulate(world, 1);
    body.velocity.set(6, 0, 0);
    const x0 = body.position.x;
    simulate(world, 3);
    expect((body.position.x - x0) / (36 / (2 * 0.6 * GRAVITY))).toBeCloseTo(1, 1);
  });
});

describe('steering', () => {
  it('nosewheel: right pedal turns right on a radius of wheelbase / tan(steer)', () => {
    const world = new PhysicsWorld(flat('gravel'));
    const cart = new Cart();
    cart.body.reset(new THREE.Vector3(0, 0.85, 0));
    world.add(cart);
    simulate(world, 2);
    // Walking pace, gentle steering: little sideways load, so tyre slip is small and the
    // path should follow the no-slip geometry. (Faster, the tyres slip and it understeers.)
    cart.body.velocity.set(0, 0, -2);
    cart.controls.pedals = 0.3;
    const steer = 0.3 * TEST_BLOCK.legs[0].steerMax_rad!;
    const wheelbase = TEST_BLOCK.legs[1].position_m[2] - TEST_BLOCK.legs[0].position_m[2];
    const h0 = headingDeg(cart.body);
    let dist = 0;
    const prev = cart.body.position.clone();
    simulate(world, 8, () => {
      dist += cart.body.position.distanceTo(prev);
      prev.copy(cart.body.position);
    });
    const turned = ((headingDeg(cart.body) - h0 + 360) % 360) * (Math.PI / 180);
    expect(turned).toBeGreaterThan(0.3); // turned right (heading increased)
    // Kinematic (no-slip) curvature tan(δ)/L, referenced to the rear axle; within 15 %.
    expect(Math.abs(turned / dist / (Math.tan(steer) / wheelbase) - 1)).toBeLessThan(0.15);
  });

  it('tailwheel: right pedal also turns a taildragger right', () => {
    const world = new PhysicsWorld(flat('gravel'));
    const a = new Airframe(AIRCRAFT.decathlon8kcab);
    a.placeOnGround(0, 0, 0, 0, 0.05);
    world.add(a);
    simulate(world, 5);
    a.body.velocity.set(0, 0, -4);
    a.controls.pedals = 1;
    simulate(world, 2);
    const h = headingDeg(a.body);
    expect(h).toBeGreaterThan(5);
    expect(h).toBeLessThan(90);
  });
});

describe('test block', () => {
  it('can be thrown, bounces, and settles on its gear', () => {
    const field = new Heightfield();
    const world = new PhysicsWorld({ heightAt: (x, z) => field.heightAt(x, z), surfaceAt });
    const block = new TestBlock();
    world.add(block);
    // An underarm toss: up and forward with a little tumble and yaw.
    block.throw(new THREE.Vector3(-20, 4, 100), new THREE.Vector3(2, 5, -8), new THREE.Vector3(0.3, 1.0, -0.2));
    let maxHeight = 0;
    let bounced = false;
    let wasAirborne = true;
    simulate(world, 25, () => {
      maxHeight = Math.max(maxHeight, block.body.position.y);
      const airborne = block.gear.states.every((s) => !s.inContact);
      if (airborne && !wasAirborne) bounced = true;
      wasAirborne = airborne;
    });
    expect(maxHeight).toBeGreaterThan(5); // it really was thrown up
    expect(bounced).toBe(true);
    expect(block.isSettled()).toBe(true);
    expect(block.isOnItsGear()).toBe(true);
    // Resting height: box bottom + legs above ground, less static strut compression.
    const restY = TEST_BLOCK.size.y / 2 + TEST_BLOCK.legLength;
    expect(block.body.position.y).toBeGreaterThan(restY - 0.1);
    expect(block.body.position.y).toBeLessThan(restY);
  });

  it('a block that lands upside down also comes fully to rest (no contact chatter)', () => {
    const world = new PhysicsWorld(flat('grass'));
    const block = new TestBlock();
    world.add(block);
    // Dropped upside down with a slide and a twist: it ends up resting on four box corners,
    // the case that used to chatter before the friction gain limit.
    const flipped = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    block.throw(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(2, 0, -3), new THREE.Vector3(0, 1.0, 0), flipped);
    simulate(world, 20);
    expect(block.isOnItsGear()).toBe(false);
    expect(block.isSettled(0.005, 0.005)).toBe(true);
  });
});
