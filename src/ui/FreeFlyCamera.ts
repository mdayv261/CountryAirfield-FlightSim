import * as THREE from 'three';
import type { Keyboard } from '../input/keyboard';

/** Inspection viewpoints on keys 1-6: position and the point to look at, m. */
export const VIEWS: Array<{ name: string; pos: [number, number, number]; target: [number, number, number] }> = [
  { name: 'Overview', pos: [-520, 240, 760], target: [10, 0, 0] },
  { name: 'Runway 36 threshold', pos: [0, 2, 318], target: [0, 1.5, 0] },
  { name: 'Apron and hangars', pos: [-22, 14, 62], target: [-85, 3, -5] },
  { name: 'Tower and windsock', pos: [-48, 11, 60], target: [-66, 9, 44] },
  { name: 'Farm dam', pos: [400, 70, -560], target: [520, 0, -720] },
  { name: 'Altocumulus', pos: [0, 1800, 2500], target: [0, 3600, -3000] },
];

const LOOK_RAD_PER_PX = 0.0035;
const LOOK_RAD_PER_S = 1.2; // arrow keys
const FAST_FACTOR = 5;
const SPEED_STEP = 1.25; // per mouse-wheel notch
const SPEED_LIMITS: [number, number] = [1, 1500]; // m/s
const MIN_CLEARANCE = 1.0; // m above the ground

/**
 * Free-fly inspection camera. Drag with the mouse to look, WASD to move, R/F to rise and
 * fall, Shift to go 5x faster, mouse wheel to change speed, 1-6 to jump to a preset view.
 * Moves in real time, so it still works while the physics is paused.
 */
export class FreeFlyCamera {
  /** Base flying speed, m/s. */
  speed = 30;
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly keys: Keyboard,
    dom: HTMLElement,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    camera.rotation.order = 'YXZ'; // yaw about world up, then pitch: no roll creeps in
    dom.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.look((e.clientX - this.lastX) * LOOK_RAD_PER_PX, (e.clientY - this.lastY) * LOOK_RAD_PER_PX);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = e.deltaY < 0 ? SPEED_STEP : 1 / SPEED_STEP;
        this.speed = THREE.MathUtils.clamp(this.speed * f, SPEED_LIMITS[0], SPEED_LIMITS[1]);
      },
      { passive: false },
    );
    VIEWS.forEach((_, k) => keys.onPress(`Digit${k + 1}`, () => this.setView(k)));
  }

  setView(index: number): void {
    const v = VIEWS[index];
    this.camera.position.set(...v.pos);
    const dir = new THREE.Vector3(...v.target).sub(this.camera.position).normalize();
    // Camera looks along -Z when yaw = pitch = 0.
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.apply();
  }

  /** Compass heading the camera faces, degrees true (0 = north). */
  get headingDeg(): number {
    return (((-this.yaw * 180) / Math.PI) % 360 + 360) % 360;
  }

  /** Current speed including the Shift boost, m/s. */
  get currentSpeed(): number {
    return this.speed * (this.keys.isDown('ShiftLeft') || this.keys.isDown('ShiftRight') ? FAST_FACTOR : 1);
  }

  update(dt: number): void {
    const k = this.keys;
    const lookX = (k.isDown('ArrowRight') ? 1 : 0) - (k.isDown('ArrowLeft') ? 1 : 0);
    const lookY = (k.isDown('ArrowDown') ? 1 : 0) - (k.isDown('ArrowUp') ? 1 : 0);
    if (lookX || lookY) this.look(lookX * LOOK_RAD_PER_S * dt, lookY * LOOK_RAD_PER_S * dt);

    const fwd = (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0);
    const side = (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0);
    const up = (k.isDown('KeyR') ? 1 : 0) - (k.isDown('KeyF') ? 1 : 0);
    if (fwd || side || up) {
      const step = this.currentSpeed * dt;
      const forward = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
      const right = new THREE.Vector3(1, 0, 0).applyEuler(this.camera.rotation);
      this.camera.position
        .addScaledVector(forward, fwd * step)
        .addScaledVector(right, side * step)
        .addScaledVector(new THREE.Vector3(0, 1, 0), up * step);
    }
    const p = this.camera.position;
    p.y = Math.max(p.y, this.groundHeight(p.x, p.z) + MIN_CLEARANCE);
  }

  private look(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.apply();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
