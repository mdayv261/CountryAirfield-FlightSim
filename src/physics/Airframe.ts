import * as THREE from 'three';
import type { AircraftData } from '../aircraft/schema';
import { GearSet, type GearControls } from './gear';
import type { PhysicsActor, PhysicsEnvironment } from './PhysicsWorld';
import { inertiaTensor, RigidBody } from './RigidBody';

/** Take-off mass: empty + pilot + fuel (fuelFraction of capacity), kg. */
export function loadedMass(data: AircraftData, fuelFraction = 1): number {
  const m = data.mass;
  return m.emptyKg + m.pilotKg + m.fuelCapacityL * m.fuelDensityKgPerL * fuelFraction;
}

/**
 * Inertia tensor at a given mass. The data gives values at maximum mass; for a lighter
 * load we scale in proportion, which assumes the extra mass is spread like the rest.
 */
export function aircraftInertia(data: AircraftData, mass: number): THREE.Matrix3 {
  const s = mass / data.mass.maxKg;
  const i = data.inertia;
  return inertiaTensor(i.roll_kgm2 * s, i.pitch_kgm2 * s, i.yaw_kgm2 * s, (i.rollYaw_kgm2 ?? 0) * s);
}

/**
 * An aircraft's rigid body and landing gear. Stage 3 has no aerodynamics or engine
 * yet; Stages 4–6 add those forces on top of applyForces().
 */
export class Airframe implements PhysicsActor {
  readonly body: RigidBody;
  readonly gear: GearSet;
  readonly controls: GearControls = { pedals: 0, brakeLeft: 0, brakeRight: 0 };

  constructor(readonly data: AircraftData, fuelFraction = 1) {
    const mass = loadedMass(data, fuelFraction);
    this.body = new RigidBody(mass, aircraftInertia(data, mass));
    this.gear = new GearSet(data.gear.legs);
  }

  applyForces(env: PhysicsEnvironment, dt: number): void {
    this.gear.apply(this.body, env.ground, this.controls, dt);
  }

  /**
   * Place the aircraft level at (x, z) facing headingDeg (true), with its lowest wheel
   * `clearance` m above the ground. The gear then settles it onto its resting attitude.
   */
  placeOnGround(x: number, z: number, headingDeg: number, groundY: number, clearance = 0.05): void {
    const lowest = Math.min(...this.data.gear.legs.filter((l) => l.kind === 'wheel').map((l) => l.position_m[1]));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-headingDeg * Math.PI) / 180);
    this.body.reset(new THREE.Vector3(x, groundY - lowest + clearance, z), q);
  }
}
