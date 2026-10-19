import { describe, expect, it } from 'vitest';
import { generateCloudLobes } from '../src/world/clouds';
import { CLOUDS, DAM, VEGETATION } from '../src/world/layout';
import { sunDirection } from '../src/world/sky';
import { Heightfield } from '../src/world/terrain';
import { generateTrees, treeExcluded } from '../src/world/vegetation';
import { rayGroundHit } from '../src/ui/measure';
import * as THREE from 'three';

const field = new Heightfield();
const heightAt = (x: number, z: number) => field.heightAt(x, z);

describe('trees', () => {
  const trees = generateTrees(heightAt);

  it('has tree lines and gum clusters', () => {
    expect(trees.filter((t) => t.kind === 'line').length).toBeGreaterThan(500);
    expect(trees.filter((t) => t.kind === 'gum').length).toBeGreaterThan(400);
  });

  it('keeps trees off the airfield, approaches and dam', () => {
    for (const t of trees) {
      expect(treeExcluded(t.x, t.z)).toBe(false);
      const c = VEGETATION.clearZone;
      expect(t.x > c.minX && t.x < c.maxX && t.z > c.minZ && t.z < c.maxZ).toBe(false);
      expect(Math.hypot(t.x - DAM.cx, t.z - DAM.cz)).toBeGreaterThan(DAM.radius + DAM.bankWidth);
    }
  });

  it('stands trees on the ground', () => {
    for (const t of trees.slice(0, 200)) expect(t.y).toBeCloseTo(heightAt(t.x, t.z), 6);
  });
});

describe('altocumulus layer', () => {
  const lobes = generateCloudLobes();

  it('stays inside 3,000-4,500 m', () => {
    expect(lobes.length).toBeGreaterThan(1000);
    for (const l of lobes) {
      expect(l.y - l.ry).toBeGreaterThanOrEqual(CLOUDS.baseMin - 1e-6);
      expect(l.y + l.ry).toBeLessThanOrEqual(CLOUDS.topMax + 1e-6);
    }
  });

  it('is made of rounded, flattened cloudlets', () => {
    for (const l of lobes) {
      expect(l.ry).toBeLessThan(l.rx);
      expect(l.rx).toBeLessThanOrEqual(CLOUDS.radius[1] + 1e-6);
    }
  });

  it('is arranged in rows across the configured axis', () => {
    // Project lobe centres onto the across-row axis: they bunch near multiples of rowSpacing.
    const az = (CLOUDS.rowAzimuthDeg * Math.PI) / 180;
    const across = { x: Math.cos(az), z: Math.sin(az) };
    let near = 0;
    for (const l of lobes) {
      const c = l.x * across.x + l.z * across.z;
      const off = Math.abs(c / CLOUDS.rowSpacing - Math.round(c / CLOUDS.rowSpacing)) * CLOUDS.rowSpacing;
      if (off < CLOUDS.rowSpacing * 0.2) near++;
    }
    expect(near / lobes.length).toBeGreaterThan(0.9);
  });
});

describe('sky and measuring', () => {
  it('puts the sun in the northern sky, well up', () => {
    const s = sunDirection();
    expect(s.length()).toBeCloseTo(1, 9);
    expect(s.z).toBeLessThan(0); // north
    expect(s.y).toBeGreaterThan(0.5);
  });

  it('ray-ground hit measures the runway length exactly', () => {
    const down = new THREE.Vector3(0, -1, 0);
    const a = rayGroundHit(new THREE.Vector3(0, 50, -300), down, heightAt)!;
    const b = rayGroundHit(new THREE.Vector3(0, 50, 300), down, heightAt)!;
    expect(a.y).toBeCloseTo(0, 2);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(600, 6);
    // Slanted ray finds the same ground point it was aimed at.
    const target = new THREE.Vector3(120, 0, -250);
    const from = new THREE.Vector3(-50, 80, 100);
    const hit = rayGroundHit(from, target.clone().sub(from).normalize(), heightAt)!;
    expect(hit.distanceTo(target)).toBeLessThan(0.01);
  });
});
