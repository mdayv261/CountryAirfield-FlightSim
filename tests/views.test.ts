import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { decodeHatAxis } from '../src/input/GamepadInput';
import { CAMERA, flyByPassed, flyByPoint, towerEye, towerFov } from '../src/ui/AircraftCamera';
import { TOWER } from '../src/world/layout';

const flat = () => 0;

describe('camera views', () => {
  it('the tower view stands at the cab, on the runway side, at eye height', () => {
    const e = towerEye(0);
    expect(e.x).toBeGreaterThan(TOWER.cx + TOWER.size / 2);
    expect(e.z).toBe(TOWER.cz);
    expect(e.y).toBeGreaterThan(TOWER.storeyHeight * (TOWER.storeys - 1));
    expect(e.y).toBeLessThan(TOWER.storeyHeight * TOWER.storeys);
  });

  it('the tower view zooms in on distant aircraft, within its limits', () => {
    expect(towerFov(2000)).toBeLessThan(towerFov(200));
    expect(towerFov(1)).toBe(CAMERA.fov.towerMax);
    expect(towerFov(1e6)).toBe(CAMERA.fov.towerMin);
  });

  it('the fly-by camera waits ahead of the aircraft, off to the side and above the ground', () => {
    const pos = new THREE.Vector3(0, 100, 0);
    const vel = new THREE.Vector3(0, 0, -30); // flying north at 30 m/s
    const p = flyByPoint(pos, vel, 0, flat);
    expect(p.z).toBeCloseTo(-30 * CAMERA.flyby.lead_s, 6); // 4 s ahead
    expect(Math.abs(p.x)).toBeCloseTo(CAMERA.flyby.side_m, 6);
    expect(p.y).toBeGreaterThan(pos.y);
    // Slow on the ground: at least the minimum lead, along the nose, never below ground.
    const g = flyByPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), Math.PI / 2, () => 5);
    expect(g.x).toBeCloseTo(CAMERA.flyby.minLead_m, 6);
    expect(g.y).toBeGreaterThanOrEqual(5 + CAMERA.flyby.minAgl_m);
  });

  it('the fly-by camera moves on only once the aircraft is past and well beyond it', () => {
    const vel = new THREE.Vector3(0, 0, -30);
    const cam = flyByPoint(new THREE.Vector3(0, 100, 0), vel, 0, flat);
    const setup = cam.distanceTo(new THREE.Vector3(0, 100, 0));
    expect(flyByPassed(cam, new THREE.Vector3(0, 100, -60), vel, setup)).toBe(false); // approaching
    expect(flyByPassed(cam, new THREE.Vector3(0, 100, -140), vel, setup)).toBe(false); // just past
    expect(flyByPassed(cam, new THREE.Vector3(0, 100, -400), vel, setup)).toBe(true);
  });

  it('decodes a joystick hat switch reported as one axis', () => {
    expect(decodeHatAxis(-1)).toEqual({ x: 0, y: 1 }); // up
    expect(decodeHatAxis(-1 + 4 / 7)).toEqual({ x: 1, y: 0 }); // right
    expect(decodeHatAxis(1 / 7)).toEqual({ x: 0, y: -1 }); // down
    expect(decodeHatAxis(5 / 7)).toEqual({ x: -1, y: 0 }); // left
    expect(decodeHatAxis(1)).toEqual({ x: -1, y: 1 }); // up-left
    expect(decodeHatAxis(1.2857)).toEqual({ x: 0, y: 0 }); // centred
  });
});
