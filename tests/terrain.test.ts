import { describe, expect, it } from 'vitest';
import { APRON, DAM, RUNWAYS, TERRAIN } from '../src/world/layout';
import { Heightfield, terrainHeight } from '../src/world/terrain';
import { fbm, mulberry32, valueNoise } from '../src/world/noise';

const field = new Heightfield();

describe('noise', () => {
  it('is deterministic and in range', () => {
    expect(mulberry32(5)()).toBe(mulberry32(5)());
    for (let i = 0; i < 500; i++) {
      const v = valueNoise(i * 0.37, i * -0.61, 3);
      const f = fbm(i * 0.11, i * 0.07, 4, 9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('terrain', () => {
  it('covers 6 x 6 km', () => {
    expect((field.n - 1) * field.cell).toBe(6000);
    expect(field.origin).toBe(-3000);
  });

  it('is dead flat (y = 0) over the runways, apron and approaches', () => {
    const f = TERRAIN.flatZone;
    for (let x = f.minX; x <= f.maxX; x += 7) {
      for (let z = f.minZ; z <= f.maxZ; z += 11) expect(terrainHeight(x, z)).toBe(0);
    }
    for (const r of [RUNWAYS.gravel, RUNWAYS.grass, APRON]) {
      expect(field.heightAt(r.cx - r.sizeX / 2, r.cz - r.sizeZ / 2)).toBe(0);
      expect(field.heightAt(r.cx + r.sizeX / 2, r.cz + r.sizeZ / 2)).toBe(0);
    }
  });

  it('has gentle hills reaching (but not exceeding) 60 m above the field', () => {
    let max = 0;
    let maxSlope = 0;
    for (let j = 0; j < field.n; j++) {
      for (let i = 0; i < field.n; i++) {
        const h = field.node(i, j);
        max = Math.max(max, h);
        // Slope away from the dam (whose bank is deliberately steeper).
        const x = field.origin + i * field.cell;
        const z = field.origin + j * field.cell;
        if (i < field.n - 1 && Math.hypot(x - DAM.cx, z - DAM.cz) > DAM.levelRadius) {
          maxSlope = Math.max(maxSlope, Math.abs(field.node(i + 1, j) - h) / field.cell);
        }
      }
    }
    expect(max).toBeLessThanOrEqual(TERRAIN.hillMax);
    expect(max).toBeGreaterThan(0.9 * TERRAIN.hillMax);
    expect(maxSlope).toBeLessThan(0.16); // under ~9°: rolling farmland
  });

  it('fades to zero at the map edge to meet the outer skirt', () => {
    for (let k = 0; k < field.n; k++) {
      expect(field.node(k, 0)).toBeCloseTo(0, 6);
      expect(field.node(field.n - 1, k)).toBeCloseTo(0, 6);
    }
    expect(field.heightAt(5000, 5000)).toBe(0);
  });

  it('has a farm dam north-east of the field holding water', () => {
    expect(DAM.cx).toBeGreaterThan(0); // east
    expect(DAM.cz).toBeLessThan(0); // north
    expect(field.heightAt(DAM.cx, DAM.cz)).toBeLessThan(DAM.waterLevel - 1);
    expect(DAM.waterLevel).toBeLessThan(0);
    // The bank rises above field level all round, so the water is contained.
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
      const r = DAM.radius + DAM.bankWidth * 0.3;
      expect(terrainHeight(DAM.cx + r * Math.cos(a), DAM.cz + r * Math.sin(a))).toBeGreaterThan(1);
    }
  });

  it('heightAt matches grid nodes and interpolates on the mesh triangles', () => {
    for (const [i, j] of [[10, 10], [200, 77], [350, 260]]) {
      const x = field.origin + i * field.cell;
      const z = field.origin + j * field.cell;
      expect(field.heightAt(x, z)).toBeCloseTo(field.node(i, j), 4);
    }
    // Centre of a cell lies on the split diagonal: mean of the two diagonal corners.
    const i = 300, j = 120;
    const x = field.origin + (i + 0.5) * field.cell;
    const z = field.origin + (j + 0.5) * field.cell;
    expect(field.heightAt(x, z)).toBeCloseTo((field.node(i + 1, j) + field.node(i, j + 1)) / 2, 4);
  });
});
