import * as THREE from 'three';
import type { AircraftModel } from '../aircraft/models/AircraftModel';
import { TOWER } from '../world/layout';

export type AircraftView = 'cockpit' | 'chase' | 'tower' | 'flyby';

export const CAMERA = {
  /** Field of view per view, degrees (vertical). The tower view zooms within its limits. */
  fov: { cockpit: 70, chase: 60, flyby: 45, towerMin: 4, towerMax: 60 },
  chase: {
    /** How quickly the camera catches up with the aircraft's heading, 1/s. */
    headingFollow: 2.5,
    positionFollow: 6,
  },
  cockpit: {
    /** Default look-down when the panel data gives none, degrees. */
    lookDown_deg: 6,
    lookRadPerPx: 0.004,
    /** Mouse look limits, rad. */
    maxPitch: 1.2,
    /** Head turn towards the hat direction, 1/s; release springs back at the same rate. */
    hatRate: 6,
    /** Spring back to straight ahead after a mouse look, 1/s. */
    returnRate: 3,
    /** Hat: sideways look 90°, up 25°, back 160°, degrees. */
    hatSide_deg: 90,
    hatUp_deg: 25,
    hatBack_deg: 160,
    /** Maximum head shake from engine vibration, m. */
    shake_m: 0.004,
  },
  tower: {
    /** Standing eye height above the top storey's floor, m. */
    eyeHeight: 1.6,
    /** The camera stands just outside the cab glass, on the runway side, m. */
    outside: 0.4,
    /** Zoom so the aircraft (taken as this many metres across) fills this fraction of the view. */
    subjectSize_m: 10,
    fill: 0.25,
  },
  flyby: {
    /** Camera set up this far ahead along the flight path, s (at least minLead_m). */
    lead_s: 4,
    minLead_m: 40,
    /** Off to one side of the path and above it, m (never below this height above ground). */
    side_m: 15,
    up_m: 3,
    minAgl_m: 1.5,
    /** Move on once the aircraft is past and this far away, as a multiple of the set-up distance. */
    resetDistance: 1.5,
  },
};

/** The tower view's eye point: just outside the cab glass on the runway (east) side. */
export function towerEye(groundY: number): THREE.Vector3 {
  const t = CAMERA.tower;
  return new THREE.Vector3(TOWER.cx + TOWER.size / 2 + t.outside, groundY + TOWER.storeyHeight * (TOWER.storeys - 1) + t.eyeHeight, TOWER.cz);
}

/** Tower zoom: a vertical field of view (degrees) that keeps the aircraft a steady size. */
export function towerFov(distance: number): number {
  const t = CAMERA.tower;
  const deg = (2 * Math.atan(t.subjectSize_m / t.fill / 2 / Math.max(distance, 1)) * 180) / Math.PI;
  return THREE.MathUtils.clamp(deg, CAMERA.fov.towerMin, CAMERA.fov.towerMax);
}

/**
 * Where a fly-by camera waits: ahead of the aircraft along its track, off to the side and a
 * little above, so it streaks past. Sideways to the right of the track unless told otherwise.
 */
export function flyByPoint(position: THREE.Vector3, velocity: THREE.Vector3, heading: number, groundAt: (x: number, z: number) => number, side = 1): THREE.Vector3 {
  const f = CAMERA.flyby;
  const horiz = new THREE.Vector3(velocity.x, 0, velocity.z);
  const speed = horiz.length();
  // Along the track when moving; along the nose when (nearly) still.
  const dir = speed > 2 ? horiz.divideScalar(speed) : new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
  const lead = Math.max(speed * f.lead_s, f.minLead_m);
  const right = new THREE.Vector3(-dir.z, 0, dir.x);
  const p = position.clone().addScaledVector(dir, lead).addScaledVector(right, side * f.side_m);
  p.y = Math.max(position.y + velocity.y * f.lead_s + f.up_m, groundAt(p.x, p.z) + f.minAgl_m);
  return p;
}

/** True once the aircraft has gone past the fly-by camera and is well beyond it. */
export function flyByPassed(camera: THREE.Vector3, position: THREE.Vector3, velocity: THREE.Vector3, setupDistance: number): boolean {
  const toCam = camera.clone().sub(position);
  const behind = toCam.dot(velocity) < 0;
  return behind && toCam.length() > CAMERA.flyby.resetDistance * setupDistance;
}

/**
 * Views that follow the aircraft.
 *  - cockpit: the pilot's eye, fixed to the airframe and looking down a little so the panel
 *    shows, with engine vibration shaking it slightly. Drag the mouse or use the joystick
 *    hat to look around; released, the head turns back to straight ahead.
 *  - chase: behind and above, following the heading smoothly but not the bank, so the
 *    horizon stays level and you can judge the aircraft's attitude from outside.
 *  - tower: from the control tower, turning to follow the aircraft and zooming to keep it a
 *    steady size, like a spectator with binoculars.
 *  - fly-by: a fixed camera set up ahead of the aircraft; it flashes past, and once it is
 *    well beyond, the camera moves ahead again.
 */
export class AircraftCamera {
  view: AircraftView = 'chase';
  /** Joystick hat direction this frame (x right, y up). */
  hat = { x: 0, y: 0 };
  /** Mouse drag looks around in the cockpit (off while the mouse is the stick). */
  mouseLook = true;
  private heading = 0;
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private initialised = false;
  private lookYaw = 0;
  private lookPitch = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private shakePhase = 0;
  private flyBySide = 1;
  private flyByDistance = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.mouseLook || this.view !== 'cockpit') return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const c = CAMERA.cockpit;
      this.lookYaw -= (e.clientX - this.lastX) * c.lookRadPerPx;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - (e.clientY - this.lastY) * c.lookRadPerPx, -c.maxPitch, c.maxPitch);
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
    else if (this.view === 'cockpit') this.cockpit(model, dt);
    else if (this.view === 'tower') this.tower(model);
    else this.flyBy(model);
  }

  private setFov(deg: number): void {
    if (Math.abs(this.camera.fov - deg) < 1e-3) return;
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  private chase(model: AircraftModel, dt: number): void {
    this.setFov(CAMERA.fov.chase);
    const pose = model.object;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion);
    const heading = Math.atan2(fwd.x, -fwd.z);
    const c = CAMERA.chase;
    if (!this.initialised) {
      this.heading = heading;
    } else {
      const err = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
      this.heading += err * Math.min(1, c.headingFollow * dt);
    }
    const back = new THREE.Vector3(-Math.sin(this.heading), 0, Math.cos(this.heading)).multiplyScalar(model.chase.back);
    const desired = pose.position.clone().add(back).add(new THREE.Vector3(0, model.chase.up, 0));
    if (!this.initialised) this.pos.copy(desired);
    else this.pos.lerp(desired, Math.min(1, c.positionFollow * dt));
    this.initialised = true;
    this.camera.position.copy(this.pos);
    this.target.copy(pose.position).add(new THREE.Vector3(0, 0.8, 0));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }

  private cockpit(model: AircraftModel, dt: number): void {
    this.setFov(CAMERA.fov.cockpit);
    const c = CAMERA.cockpit;
    const pose = model.object;
    const aircraft = model.aircraft;
    const hatOn = this.hat.x !== 0 || this.hat.y !== 0;
    if (hatOn) {
      // Look the way the hat points: sideways, up, or back over a shoulder.
      const d = Math.PI / 180;
      let yaw = -this.hat.x * c.hatSide_deg * d;
      let pitch = 0;
      if (this.hat.y > 0) {
        pitch = c.hatUp_deg * d;
        yaw /= 2;
      } else if (this.hat.y < 0) {
        yaw = this.hat.x === 0 ? c.hatBack_deg * d : -this.hat.x * ((c.hatSide_deg + c.hatBack_deg) / 2) * d;
      }
      const k = Math.min(1, c.hatRate * dt);
      this.lookYaw += (yaw - this.lookYaw) * k;
      this.lookPitch += (pitch - this.lookPitch) * k;
    } else if (!this.dragging) {
      // Spring the head back to looking ahead.
      const k = Math.min(1, c.returnRate * dt);
      this.lookYaw -= this.lookYaw * k;
      this.lookPitch -= this.lookPitch * k;
    }
    // Engine shake. The real firing frequency (~100 Hz) is far above the display rate, so we
    // show its effect as a small jitter whose size follows the vibration level.
    const pp = aircraft.powerplant.out;
    this.shakePhase += dt * 37;
    const s = c.shake_m * pp.vibration;
    const shake = new THREE.Vector3(Math.sin(this.shakePhase * 1.7) * s, Math.sin(this.shakePhase * 2.3) * s, 0);

    this.camera.position.copy(model.eye).add(shake).applyQuaternion(pose.quaternion).add(pose.position);
    const lookDown = ((aircraft.data.panel?.lookDown_deg ?? c.lookDown_deg) * Math.PI) / 180;
    const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch - lookDown, this.lookYaw, 0, 'YXZ'));
    this.camera.quaternion.copy(pose.quaternion).multiply(look);
    this.initialised = false;
  }

  private tower(model: AircraftModel): void {
    const eye = towerEye(this.groundAt(TOWER.cx, TOWER.cz));
    const p = model.object.position;
    this.setFov(towerFov(eye.distanceTo(p)));
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p);
    this.initialised = false;
  }

  private flyBy(model: AircraftModel): void {
    this.setFov(CAMERA.fov.flyby);
    const ac = model.aircraft;
    const p = model.object.position;
    const v = ac.body.velocity;
    const passed = this.initialised && flyByPassed(this.pos, p, v, this.flyByDistance);
    // Too far away (aircraft turned off elsewhere) also calls for a new set-up.
    const lost = this.initialised && this.pos.distanceTo(p) > 4 * Math.max(this.flyByDistance, CAMERA.flyby.minLead_m);
    if (!this.initialised || passed || lost) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(model.object.quaternion);
      this.flyBySide = -this.flyBySide; // alternate sides for variety
      this.pos.copy(flyByPoint(p, v, Math.atan2(fwd.x, -fwd.z), this.groundAt, this.flyBySide));
      this.flyByDistance = this.pos.distanceTo(p);
      this.initialised = true;
    }
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p);
  }
}
