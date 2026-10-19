import { describe, expect, it } from 'vitest';
import { ktToMps } from '../src/core/units';
import { metFromWind, windFromMet } from '../src/physics/windVector';
import { Windsock, windsockPose } from '../src/world/windsock';
import * as THREE from 'three';

describe('wind vector', () => {
  it('converts met direction (blowing from) to an air velocity vector', () => {
    const north = windFromMet(0, 10); // from the north -> air moves south (+Z)
    expect(north.z).toBeCloseTo(ktToMps(10), 9);
    expect(north.x).toBeCloseTo(0, 9);
    const west = windFromMet(270, 10); // from the west -> air moves east (+X)
    expect(west.x).toBeCloseTo(ktToMps(10), 9);
  });

  it('round-trips', () => {
    const m = metFromWind(windFromMet(230, 12));
    expect(m.fromDeg).toBeCloseTo(230, 9);
    expect(m.speedKt).toBeCloseTo(12, 9);
  });
});

describe('windsock', () => {
  const sockDirection = (yaw: number) => new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));

  it('points downwind', () => {
    for (const from of [0, 45, 90, 180, 230, 315]) {
      const w = windFromMet(from, 10);
      const d = sockDirection(windsockPose(w).yaw);
      expect(d.x).toBeCloseTo(w.x / Math.hypot(w.x, w.z), 6);
      expect(d.z).toBeCloseTo(w.z / Math.hypot(w.x, w.z), 6);
    }
  });

  it('hangs straight down in calm air', () => {
    for (const d of windsockPose(windFromMet(0, 0)).droop) expect(d).toBeCloseTo(Math.PI / 2, 9);
  });

  it('flies fully horizontal at 15 kt and above', () => {
    for (const kt of [15, 25]) for (const d of windsockPose(windFromMet(90, kt)).droop) expect(d).toBeCloseTo(0, 9);
    // Just below 15 kt the tail band is not yet full.
    expect(windsockPose(windFromMet(90, 14)).droop.at(-1)!).toBeGreaterThan(0.05);
  });

  it('fills one band per 3 kt, mouth first', () => {
    const p = windsockPose(windFromMet(180, 6));
    expect(p.droop[0]).toBeCloseTo(0, 9);
    expect(p.droop[1]).toBeCloseTo(0, 9);
    expect(p.droop[2]).toBeCloseTo(Math.PI / 2, 9);
  });

  it('extends progressively as the wind rises', () => {
    let prev = Infinity;
    for (let kt = 0; kt <= 15; kt += 0.5) {
      const total = windsockPose(windFromMet(0, kt)).droop.reduce((a, b) => a + b, 0);
      expect(total).toBeLessThanOrEqual(prev + 1e-12);
      prev = total;
    }
  });

  it('builds a mast and five segments that animate', () => {
    const sock = new Windsock(new THREE.Vector3(0, 6.3, 0));
    sock.update(windFromMet(270, 15), 0);
    expect(sock.object.name).toBe('windsock');
    let meshes = 0;
    sock.object.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
    expect(meshes).toBe(6);
  });
});
