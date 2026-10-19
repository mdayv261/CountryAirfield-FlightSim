import * as THREE from 'three';
import type { AircraftModel } from '../aircraft/models/AircraftModel';

export type AircraftView = 'chase' | 'cockpit';

const CHASE = {
  /** How quickly the camera catches up with the aircraft's heading, 1/s. */
  headingFollow: 2.5,
  positionFollow: 6,
};
const COCKPIT_LOOK_DOWN = (6 * Math.PI) / 180;
const LOOK_RAD_PER_PX = 0.004;
/** Maximum head shake from engine vibration, m. */
const SHAKE_M = 0.004;

/**
 * Views that follow the aircraft.
 *  - chase: behind and above, following the heading smoothly but not the bank, so the
 *    horizon stays level and you can judge the aircraft's attitude from outside;
 *  - cockpit: the pilot's eye, fixed to the airframe, with engine vibration shaking it a
 *    little. Drag the mouse to look around (released, the view springs back ahead).
 */
export class AircraftCamera {
  view: AircraftView = 'chase';
  private heading = 0;
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private initialised = false;
  private lookYaw = 0;
  private lookPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Mouse drag looks around in the cockpit (off while the mouse is the stick). */
  mouseLook = true;
  private shakePhase = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.mouseLook || this.view !== 'cockpit') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.lookYaw -= (e.clientX - this.lastX) * LOOK_RAD_PER_PX;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - (e.clientY - this.lastY) * LOOK_RAD_PER_PX, -1.2, 1.2);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
  }

  reset(): void {
    this.initialised = false;
  }

  /** Place the camera for this frame, from the model's interpolated pose, eye point and chase distance. */
  update(model: AircraftModel, dt: number): void {
    if (this.view === 'chase') this.chase(model, dt);
    else this.cockpit(model, dt);
  }

  private chase(model: AircraftModel, dt: number): void {
    const pose = model.object;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
    const heading = Math.atan2(fwd.x, -fwd.z);
    if (!this.initialised) {
      this.heading = heading;
    } else {
      const err = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
      this.heading += err * Math.min(1, CHASE.headingFollow * dt);
    }
    const back = new THREE.Vector3(-Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(model.chase.back);
    const desired = pose.position.clone().add(back).add(new THREE.Vector3(0, model.chase.up, 0));
    if (!this.initialised) this.pos.copy(desired);
    else this.pos.lerp(desired, Math.min(1, CHASE.positionFollow * dt));
    this.initialised = true;
    this.camera.position.copy(this.pos);
    this.target.copy(pose.position).add(new THREE.Vector3(0, 0.8, 0));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }

  private cockpit(model: AircraftModel, dt: number): void {
    const pose = model.object;
    const aircraft = model.aircraft;
    if (!this.dragging) {
      // Spring the head back to looking ahead.
      const k = Math.min(1, 3 * dt);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    // Engine shake. The real firing frequency (~100 Hz) is far above the display rate, so we
    // show its effect as a small jitter whose size follows the vibration level.
    const pp = aircraft.powerplant.out;
    this.shakePhase += dt * 37;
    const s = SHAKE_M * pp.vibration;
    const shake = new THREE.Vector3(Math.sin(this.shakePhase * 1.7) * s, Math.sin(this.shakePhase * 2.3) * s, 0);

    this.camera.position.copy(model.eye).add(shake).applyQuaternion(pose.quaternion).add(pose.position);
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch - COCKPIT_LOOK_DOWN, this.lookYaw, 0, 'YXZ'));
    this.camera.quaternion.copy(pose.quaternion).multiply(look);
    this.initialised = false;
  }
}
