import * as THREE from 'three';

/** Fixed-point passes for the implicit-midpoint rotation update; 5 converges to ~1e-9 at 120 Hz. */
const MIDPOINT_ITERATIONS = 5;

/**
 * A rigid body with six degrees of freedom: three of position, three of attitude.
 *
 * Frames
 *  - World: +X east, +Y up, +Z south (SI units).
 *  - Body: origin at the centre of gravity, x right, y up, z aft (forward is -z).
 *    Identity orientation = level, nose pointing north.
 *
 * State
 *  - position, velocity: CG in world axes (m, m/s).
 *  - orientation: unit quaternion rotating body axes into world axes. Quaternions
 *    avoid the gimbal lock that Euler angles suffer at ±90° pitch (loops, spins).
 *  - angularVelocity: body axes (rad/s), so the inertia tensor stays constant.
 *
 * Each physics step, callers add forces (and torques), then call integrate(dt).
 */
export class RigidBody {
  mass: number;
  /** Inertia tensor about the CG, body axes, kg m². */
  readonly inertia = new THREE.Matrix3();
  readonly inverseInertia = new THREE.Matrix3();

  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly orientation = new THREE.Quaternion();
  readonly angularVelocity = new THREE.Vector3();

  /** State at the start of the last step, for smooth rendering between steps. */
  readonly prevPosition = new THREE.Vector3();
  readonly prevOrientation = new THREE.Quaternion();

  /** Net force this step, world axes (N). */
  private readonly force = new THREE.Vector3();
  /** Net torque about the CG this step, body axes (N m). */
  private readonly torque = new THREE.Vector3();

  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly invQ = new THREE.Quaternion();
  // Scratch vectors for integrate(), kept as fields so stepping does not allocate.
  private readonly w0 = new THREE.Vector3();
  private readonly w1 = new THREE.Vector3();
  private readonly wm = new THREE.Vector3();
  private readonly Iw = new THREE.Vector3();
  private readonly rhs = new THREE.Vector3();

  constructor(mass: number, inertia: THREE.Matrix3) {
    this.mass = mass;
    this.setInertia(inertia);
    this.prevPosition.copy(this.position);
  }

  setInertia(inertia: THREE.Matrix3): void {
    this.inertia.copy(inertia);
    this.inverseInertia.copy(inertia).invert();
  }

  /** Body-axis vector to world axes. */
  toWorld(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(v).applyQuaternion(this.orientation);
  }

  /** World-axis vector to body axes. */
  toBody(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.invQ.copy(this.orientation).invert();
    return out.copy(v).applyQuaternion(this.invQ);
  }

  /** World position of a point given in body axes relative to the CG. */
  pointToWorld(rBody: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return this.toWorld(rBody, out).add(this.position);
  }

  /** World velocity of a body point: CG velocity plus ω × r. */
  pointVelocity(rBody: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.tmpA.crossVectors(this.angularVelocity, rBody); // body axes
    return this.toWorld(this.tmpA, out).add(this.velocity);
  }

  /** Force (world axes) acting through the CG: no turning effect. */
  addForce(fWorld: THREE.Vector3): void {
    this.force.add(fWorld);
  }

  /**
   * Force (world axes) acting at a body point rBody (body axes, from the CG).
   * Pushes the CG like any force, and also turns the body with moment r × F.
   */
  addForceAtBodyPoint(fWorld: THREE.Vector3, rBody: THREE.Vector3): void {
    this.force.add(fWorld);
    const fBody = this.toBody(fWorld, this.tmpB);
    this.torque.add(this.tmpA.crossVectors(rBody, fBody));
  }

  /** Pure torque, body axes (N m). */
  addTorque(tBody: THREE.Vector3): void {
    this.torque.add(tBody);
  }

  /** Net force accumulated so far this step (world axes), for diagnostics and tests. */
  get netForce(): THREE.Vector3 {
    return this.force;
  }

  /**
   * Advance the state by dt seconds under the accumulated force and torque, then clear them.
   *
   * Translation: semi-implicit ("symplectic") Euler: update velocity from force first,
   * then move with the new velocity. For springs (landing gear) it does not pump energy
   * in the way plain Euler does, so stiff struts stay stable at 120 Hz.
   *
   * Rotation: Euler's equations for a spinning body, in body axes:
   *     I dω/dt = τ − ω × (I ω)
   * The ω × (Iω) term is the gyroscopic coupling that makes a tumbling body wobble even
   * with no torque applied. We solve it with the implicit midpoint rule (evaluate the
   * coupling at the average of old and new ω, found by a few fixed-point passes). For a
   * torque-free body this conserves both rotational energy and angular momentum exactly,
   * which keeps spins and tumbles honest.
   *
   * Attitude: rotate by the angle |ω| dt about the ω axis using the midpoint ω, applied in
   * body axes (post-multiply), then renormalise so the quaternion stays a pure rotation.
   */
  integrate(dt: number): void {
    this.prevPosition.copy(this.position);
    this.prevOrientation.copy(this.orientation);

    this.velocity.addScaledVector(this.force, dt / this.mass);
    this.position.addScaledVector(this.velocity, dt);

    const { w0, w1, wm, Iw, rhs } = this;
    w0.copy(this.angularVelocity);
    w1.copy(w0);
    for (let k = 0; k < MIDPOINT_ITERATIONS; k++) {
      wm.addVectors(w0, w1).multiplyScalar(0.5);
      Iw.copy(wm).applyMatrix3(this.inertia);
      rhs.crossVectors(wm, Iw).negate().add(this.torque).applyMatrix3(this.inverseInertia);
      w1.copy(w0).addScaledVector(rhs, dt);
    }
    wm.addVectors(w0, w1).multiplyScalar(0.5);
    this.angularVelocity.copy(w1);

    const angle = wm.length() * dt;
    if (angle > 1e-12) {
      this.tmpQ.setFromAxisAngle(wm.normalize(), angle);
      this.orientation.multiply(this.tmpQ).normalize();
    }

    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }

  /** Translational plus rotational kinetic energy, J. */
  kineticEnergy(): number {
    const Iw = this.angularVelocity.clone().applyMatrix3(this.inertia);
    return 0.5 * this.mass * this.velocity.lengthSq() + 0.5 * this.angularVelocity.dot(Iw);
  }

  /** Angular momentum about the CG in world axes, kg m²/s. */
  angularMomentumWorld(): THREE.Vector3 {
    return this.toWorld(this.angularVelocity.clone().applyMatrix3(this.inertia));
  }

  /** Teleport and stop the body (also resets the render interpolation history). */
  reset(position: THREE.Vector3, orientation = new THREE.Quaternion()): void {
    this.position.copy(position);
    this.prevPosition.copy(position);
    this.orientation.copy(orientation);
    this.prevOrientation.copy(orientation);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
  }
}

/**
 * Inertia tensor in body axes from principal values named the pilot's way.
 * Roll is about z (fore-aft), pitch about x (spanwise), yaw about y (vertical).
 * rollYaw is the product of inertia between the roll and yaw axes (zero for a
 * symmetric aircraft with its principal axes along the body axes).
 */
export function inertiaTensor(roll: number, pitch: number, yaw: number, rollYaw = 0): THREE.Matrix3 {
  // Matrix3.set takes row-major order. Products of inertia enter with a minus sign.
  return new THREE.Matrix3().set(
    pitch, 0, 0,
    0, yaw, -rollYaw,
    0, -rollYaw, roll,
  );
}
