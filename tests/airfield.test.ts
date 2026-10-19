import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { conePositions, createAirfield, gablePositions } from '../src/world/airfield';
import { createBuildings, towerRoofTop } from '../src/world/buildings';
import { APRON, MARKERS, RUNWAYS, TAXIWAYS, TOWER } from '../src/world/layout';

const airfield = createAirfield();
const box = (name: string) => new THREE.Box3().setFromObject(airfield.getObjectByName(name)!);

describe('runways', () => {
  it('gravel runway measures 600 x 18 m along Z (18/36)', () => {
    const b = box('runway-gravel');
    expect(b.max.z - b.min.z).toBeCloseTo(600, 3);
    expect(b.max.x - b.min.x).toBeCloseTo(18, 3);
    expect(b.min.z).toBeCloseTo(-300, 3);
  });

  it('grass runway measures 600 x 30 m, parallel, centreline 30 m east of the gravel', () => {
    const g = box('runway-grass');
    const r = box('runway-gravel');
    expect(g.max.z - g.min.z).toBeCloseTo(600, 3);
    expect(g.max.x - g.min.x).toBeCloseTo(30, 3);
    expect((g.min.x + g.max.x) / 2 - (r.min.x + r.max.x) / 2).toBeCloseTo(30, 3);
    expect(g.min.x - r.max.x).toBeCloseTo(6, 3); // grass between the runways
    expect(g.min.z).toBeCloseTo(r.min.z, 3);
  });

  it('has edge cones every 50 m along both edges of both runways', () => {
    const cones = conePositions();
    expect(cones).toHaveLength(2 * 2 * 13);
    const gravelWest = cones.filter((c) => c.x < RUNWAYS.gravel.cx).map((c) => c.z);
    expect(gravelWest[0]).toBe(-300);
    expect(gravelWest.at(-1)).toBe(300);
    for (let k = 1; k < gravelWest.length; k++) expect(gravelWest[k] - gravelWest[k - 1]).toBe(MARKERS.coneSpacing);
    expect((airfield.getObjectByName('edge-cones') as THREE.InstancedMesh).count).toBe(52);
  });

  it('has threshold markers across both ends of both runways', () => {
    const g = gablePositions();
    const n = MARKERS.gablesPerThreshold;
    expect(g).toHaveLength(2 * (n.gravel + n.grass));
    for (const p of g) expect(Math.abs(Math.abs(p.z) - 300)).toBeLessThan(2);
    expect(g.filter((p) => p.z < 0)).toHaveLength(n.gravel + n.grass);
  });
});

describe('apron and taxiways', () => {
  it('apron is 60 x 40 m', () => {
    const b = box('apron');
    expect((b.max.x - b.min.x) * (b.max.z - b.min.z)).toBeCloseTo(2400, 3);
  });

  it('two taxiways join the apron to each threshold of the gravel runway', () => {
    // Union of taxiway rectangles must contain a continuous path from apron edge to runway edge.
    const inside = (x: number, z: number) =>
      TAXIWAYS.some((t) => Math.abs(x - t.cx) <= t.sizeX / 2 + 1e-9 && Math.abs(z - t.cz) <= t.sizeZ / 2 + 1e-9);
    for (const end of [-1, 1]) {
      const legX = TAXIWAYS[0].cx;
      // Leg starts at the apron edge and runs to the threshold stub.
      for (let s = 0; s <= 1; s += 0.01) {
        const z = end * (APRON.sizeZ / 2 + s * (300 - 5 - APRON.sizeZ / 2));
        expect(inside(legX, z)).toBe(true);
      }
      // Stub runs east to the gravel runway's west edge at the threshold.
      const edge = RUNWAYS.gravel.cx - RUNWAYS.gravel.sizeX / 2;
      for (let x = legX; x <= edge; x += 0.5) expect(inside(x, end * 295)).toBe(true);
    }
    expect(TAXIWAYS).toHaveLength(4); // two L-shaped taxiways
  });

  it('surfaces do not overlap one another (no depth fighting)', () => {
    const rects = [RUNWAYS.gravel, RUNWAYS.grass, APRON, ...TAXIWAYS];
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const A = rects[a], B = rects[b];
        const ox = A.sizeX / 2 + B.sizeX / 2 - Math.abs(A.cx - B.cx);
        const oz = A.sizeZ / 2 + B.sizeZ / 2 - Math.abs(A.cz - B.cz);
        expect(ox <= 1e-9 || oz <= 1e-9).toBe(true);
      }
    }
  });
});

describe('buildings', () => {
  const { footprints, mesh } = createBuildings();

  it('has three hangars, a clubroom and the tower', () => {
    expect(footprints.map((f) => f.name)).toEqual(['hangar-1', 'hangar-2', 'hangar-3', 'clubroom', 'tower']);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('keeps buildings off the runways, taxiways and apron', () => {
    const rects = [RUNWAYS.gravel, RUNWAYS.grass, APRON, ...TAXIWAYS];
    for (const f of footprints) {
      for (const r of rects) {
        const clearX = f.maxX <= r.cx - r.sizeX / 2 || f.minX >= r.cx + r.sizeX / 2;
        const clearZ = f.maxZ <= r.cz - r.sizeZ / 2 || f.minZ >= r.cz + r.sizeZ / 2;
        expect(clearX || clearZ).toBe(true);
      }
    }
  });

  it('tower is two storeys with the windsock mast on its roof', () => {
    const tower = footprints.find((f) => f.name === 'tower')!;
    expect(TOWER.storeys).toBe(2);
    expect(towerRoofTop().y).toBeCloseTo(tower.height, 6);
    expect(tower.height).toBeGreaterThan(2 * TOWER.storeyHeight);
  });
});
