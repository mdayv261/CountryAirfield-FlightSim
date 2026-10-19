import * as THREE from 'three';
import type { GearLeg } from '../aircraft/schema';
import { GearSet, type GearControls } from './gear';
import { bluffBodyDrag, type PhysicsActor, type PhysicsEnvironment } from './PhysicsWorld';
import { inertiaTensor, RigidBody } from './RigidBody';

const SIZE = { x: 1.2, y: 0.6, z: 1.6 };
const MASS = 50;
const LEG_LENGTH = 0.25;

const wheel = (name: string, x: number, z: number, steerMax_rad = 0): GearLeg => ({
  name,
  kind: 'wheel',
  position_m: [x, -SIZE.y / 2 - LEG_LENGTH, z],
  spring_N_per_m: 6000,
  damper_Ns_per_m: 350,
  travel_m: 0.15,
  steerMax_rad,
  brake: true,
  tyreRadius_m: 0.12,
});

const corner = (sx: number, sy: number, sz: number): GearLeg => ({
  name: `corner ${sx}${sy}${sz}`,
  kind: 'skid',
  position_m: [(sx * SIZE.x) / 2, (sy * SIZE.y) / 2, (sz * SIZE.z) / 2],
  spring_N_per_m: 20000,
  damper_Ns_per_m: 600,
  travel_m: 0.05,
});

/**
 * Test rig for Stage 3: a 50 kg box (1.2 x 0.6 x 1.6 m) on a tricycle undercarriage,
 * with skid points on all eight corners so it can tumble, bounce and land any way up.
 * Struts are sized for ~3 cm static compression and roughly half critical damping.
 * The mains sit at the box edges and the legs are short, so it would take a sideways
 * friction coefficient above 1 to trip it over its wheels: it is hard to roll over.
 * It has drag (so the wind pushes it) and a test thrust, steerable nosewheel and
 * brakes, so the input system and ground friction can be tried in the browser.
 */
export const TEST_BLOCK = {
  size: SIZE,
  mass: MASS,
  legLength: LEG_LENGTH,
  /** Drag coefficient times frontal area for a tumbling box, m². */
  dragArea_m2: 0.8,
  /** Thrust at full throttle, N (about 0.5 g). */
  maxThrust_N: 250,
  legs: [
    wheel('nosewheel', 0, -0.7, 0.6),
    wheel('left main', -SIZE.x / 2, 0.55),
    wheel('right main', SIZE.x / 2, 0.55),
    ...[-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => corner(sx, sy, sz)))),
  ] as GearLeg[],
};

/** Solid box inertia: I = m (a² + b²) / 12 about each axis. */
function boxInertia(): THREE.Matrix3 {
  const { x, y, z } = SIZE;
  const k = MASS / 12;
  return inertiaTensor(k * (x * x + y * y), k * (y * y + z * z), k * (x * x + z * z));
}

export class TestBlock implements PhysicsActor {
  readonly body = new RigidBody(MASS, boxInertia());
  readonly gear = new GearSet(TEST_BLOCK.legs);
  readonly controls: GearControls & { throttle: number } = { pedals: 0, brakeLeft: 0, brakeRight: 0, throttle: 0 };
  private readonly air = new THREE.Vector3();
  private readonly f = new THREE.Vector3();

  applyForces(env: PhysicsEnvironment, dt: number): void {
    this.gear.apply(this.body, env.ground, this.controls, dt);
    const rho = env.air(this.body.position.y).density;
    env.windAt(this.body.position, this.air);
    this.body.addForce(bluffBodyDrag(this.body.velocity, this.air, rho, TEST_BLOCK.dragArea_m2, this.f));
    if (this.controls.throttle > 0) {
      this.body.addForce(this.body.toWorld(this.f.set(0, 0, -TEST_BLOCK.maxThrust_N * this.controls.throttle)));
    }
  }

  /** Launch from a point with a velocity (world) and spin (body axes, rad/s). */
  throw(from: THREE.Vector3, velocity: THREE.Vector3, spin: THREE.Vector3, orientation = new THREE.Quaternion()): void {
    this.body.reset(from, orientation);
    this.body.velocity.copy(velocity);
    this.body.angularVelocity.copy(spin);
  }

  /** True when the block has stopped (slower than the given speeds). */
  isSettled(maxSpeed = 0.02, maxRate = 0.02): boolean {
    return this.body.velocity.length() < maxSpeed && this.body.angularVelocity.length() < maxRate;
  }

  /** True when it is upright with its three wheels on the ground. */
  isOnItsGear(): boolean {
    const up = this.body.toWorld(new THREE.Vector3(0, 1, 0));
    return up.y > 0.95 && this.gear.states.slice(0, 3).every((s) => s.inContact);
  }
}
