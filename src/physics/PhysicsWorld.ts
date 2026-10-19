import * as THREE from 'three';
import { FIELD_ELEVATION_M, GRAVITY } from '../core/constants';
import { isa, type AirState } from './atmosphere';
import type { Ground } from './gear';
import { WindModel } from './wind';

/** Everything an object needs to know about its surroundings during a physics step. */
export interface PhysicsEnvironment {
  ground: Ground;
  wind: WindModel;
  /** Air at a world height y (m above field level). */
  air(y: number): AirState;
  /** Air velocity at a world position (m/s), including shear, gusts and turbulence. */
  windAt(p: THREE.Vector3, out?: THREE.Vector3): THREE.Vector3;
}

/** Something the world steps: it adds its own forces, then the world integrates it. */
export interface PhysicsActor {
  readonly body: import('./RigidBody').RigidBody;
  applyForces(env: PhysicsEnvironment, dt: number): void;
}

/**
 * Owns the environment (ground, atmosphere, wind) and steps every actor at the fixed
 * physics rate: advance the wind, add gravity, let each actor add its forces, integrate.
 */
export class PhysicsWorld implements PhysicsEnvironment {
  readonly actors: PhysicsActor[] = [];
  readonly wind: WindModel;
  private readonly gravity = new THREE.Vector3();

  constructor(
    readonly ground: Ground,
    wind = new WindModel(),
    /** Field elevation above sea level, m; world y = 0 is field level. */
    readonly fieldElevation = FIELD_ELEVATION_M,
  ) {
    this.wind = wind;
  }

  air(y: number): AirState {
    return isa(this.fieldElevation + y);
  }

  windAt(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return this.wind.velocityAt(p.y - this.ground.heightAt(p.x, p.z), out);
  }

  add(actor: PhysicsActor): void {
    if (!this.actors.includes(actor)) this.actors.push(actor);
  }

  remove(actor: PhysicsActor): void {
    const i = this.actors.indexOf(actor);
    if (i >= 0) this.actors.splice(i, 1);
  }

  step(dt: number): void {
    // Turbulence time scale follows the fastest actor (the aircraft, once there is one).
    const speed = this.actors.reduce((m, a) => Math.max(m, a.body.velocity.length()), 0);
    this.wind.update(dt, speed);
    for (const a of this.actors) {
      a.body.addForce(this.gravity.set(0, -GRAVITY * a.body.mass, 0));
      a.applyForces(this, dt);
      a.body.integrate(dt);
    }
  }
}

/**
 * Aerodynamic drag of a blunt object: F = ½ ρ V² Cd A, opposite to the motion through
 * the air. V is the velocity relative to the air, so in a steady wind a draggy object
 * is pushed along until it moves with the air mass.
 */
export function bluffBodyDrag(
  velocity: THREE.Vector3,
  air: THREE.Vector3,
  density: number,
  dragArea_m2: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.subVectors(velocity, air);
  const v = out.length();
  return out.multiplyScalar(-0.5 * density * v * dragArea_m2);
}
