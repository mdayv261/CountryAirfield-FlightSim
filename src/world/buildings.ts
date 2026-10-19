import * as THREE from 'three';
import { CLUBROOM, HANGAR, TOWER } from './layout';
import { ColouredMeshBuilder, prismGeometry } from './meshBuilder';

export interface Footprint {
  name: string;
  /** Ground rectangle the building covers (walls, plus veranda for the clubroom). */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Highest point, m. */
  height: number;
}

const t = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Hangar: walls, gable roof with the ridge running east-west, big doors facing east. */
function addHangar(b: ColouredMeshBuilder, k: number, cz: number): Footprint {
  const { cx, depth, width, wallHeight, ridgeRise } = HANGAR;
  const eave = 0.4;
  b.box(cx, wallHeight / 2, cz, depth, wallHeight, width, HANGAR.walls[k]);
  b.add(prismGeometry(depth + eave, width + eave, ridgeRise), HANGAR.roofs[k], t(cx, wallHeight, cz));
  // Two door leaves with a narrow gap, proud of the east wall.
  const doorW = width * HANGAR.doorWidthFraction;
  const doorH = wallHeight * HANGAR.doorHeightFraction;
  const leaf = doorW / 2 - 0.05;
  const doorX = cx + depth / 2 + 0.06;
  for (const s of [-1, 1]) b.box(doorX, doorH / 2, cz + (s * doorW) / 4, 0.1, doorH, leaf, HANGAR.door);
  return {
    name: `hangar-${k + 1}`,
    minX: cx - depth / 2,
    maxX: cx + depth / 2,
    minZ: cz - width / 2,
    maxZ: cz + width / 2,
    height: wallHeight + ridgeRise,
  };
}

/** Clubroom: weatherboard box, red iron gable roof, veranda along the south (apron) side. */
function addClubroom(b: ColouredMeshBuilder): Footprint {
  const c = CLUBROOM;
  const south = c.cz + c.sizeZ / 2;
  b.box(c.cx, c.wallHeight / 2, c.cz, c.sizeX, c.wallHeight, c.sizeZ, c.walls);
  b.add(prismGeometry(c.sizeX + 0.6, c.sizeZ + 0.6, c.roofRise), c.roof, t(c.cx, c.wallHeight, c.cz));

  // Windows and door on the veranda wall.
  const winY = 1.6;
  for (const dx of [-4.5, -1.5, 2.5, 5]) b.box(c.cx + dx, winY, south + 0.04, 1.4, 1.1, 0.08, c.window);
  b.box(c.cx + 0.5, 1.05, south + 0.04, 1.0, 2.1, 0.08, c.window);

  // Veranda: deck, posts, a handrail, and a skillion roof sloping down away from the wall.
  const vz = south + c.verandaDepth / 2;
  b.box(c.cx, 0.15, vz, c.sizeX, 0.3, c.verandaDepth, c.deck);
  const postZ = south + c.verandaDepth - 0.15;
  for (let k = 0; k < c.verandaPosts; k++) {
    const x = c.cx - c.sizeX / 2 + 0.15 + (k * (c.sizeX - 0.3)) / (c.verandaPosts - 1);
    b.box(x, c.verandaPostHeight / 2, postZ, 0.15, c.verandaPostHeight, 0.15, c.trim);
  }
  b.box(c.cx, 1.0, postZ, c.sizeX, 0.08, 0.08, c.trim);
  const drop = c.wallHeight - c.verandaPostHeight;
  const slope = Math.atan2(drop, c.verandaDepth);
  const roofLen = Math.hypot(drop, c.verandaDepth) + 0.3;
  const roofM = t(c.cx, (c.wallHeight + c.verandaPostHeight) / 2 + 0.05, vz).multiply(
    new THREE.Matrix4().makeRotationX(slope),
  );
  b.add(new THREE.BoxGeometry(c.sizeX + 0.4, 0.06, roofLen), c.roof, roofM);

  return {
    name: 'clubroom',
    minX: c.cx - c.sizeX / 2,
    maxX: c.cx + c.sizeX / 2,
    minZ: c.cz - c.sizeZ / 2,
    maxZ: south + c.verandaDepth,
    height: c.wallHeight + c.roofRise,
  };
}

/** Two-storey tower: plain ground storey, glazed upper cab, flat roof, outside stair. */
function addTower(b: ColouredMeshBuilder): Footprint {
  const T = TOWER;
  const s = T.size;
  const h1 = T.storeyHeight;
  b.box(T.cx, h1 / 2, T.cz, s, h1, s, T.walls);
  // Ground-floor windows and door facing the apron (north).
  b.box(T.cx - 1, 1.6, T.cz - s / 2 - 0.04, 1.2, 1.0, 0.08, T.glass);
  b.box(T.cx + 1.3, 1.05, T.cz - s / 2 - 0.04, 0.9, 2.1, 0.08, T.glass);

  // Upper storey: solid sill, then a glazed band set slightly in, then the roof slab.
  const sill = T.storeyHeight - T.windowBand;
  b.box(T.cx, h1 + sill / 2, T.cz, s, sill, s, T.walls);
  b.box(T.cx, h1 + sill + T.windowBand / 2, T.cz, s - 0.2, T.windowBand, s - 0.2, T.glass);
  // Corner mullions so the glazing reads as windows.
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      b.box(T.cx + (dx * (s - 0.2)) / 2, h1 + sill + T.windowBand / 2, T.cz + (dz * (s - 0.2)) / 2, 0.2, T.windowBand, 0.2, T.walls);
    }
  }
  const top = h1 * T.storeys;
  const roofS = s + 2 * T.roofOverhang;
  b.box(T.cx, top + T.roofThickness / 2, T.cz, roofS, T.roofThickness, roofS, T.roof);

  // External stair up the east side to a landing at first-floor level.
  const run = 4;
  const stairM = t(T.cx + s / 2 + 0.6, h1 / 2, T.cz + 0.5).multiply(
    new THREE.Matrix4().makeRotationX(-Math.atan2(h1, run)),
  );
  b.add(new THREE.BoxGeometry(1.0, 0.15, Math.hypot(h1, run)), T.stair, stairM);

  return {
    name: 'tower',
    minX: T.cx - s / 2,
    maxX: T.cx + s / 2,
    minZ: T.cz - s / 2,
    maxZ: T.cz + s / 2,
    height: top + T.roofThickness,
  };
}

/** Top of the tower roof (where the windsock mast stands). */
export function towerRoofTop(): THREE.Vector3 {
  return new THREE.Vector3(TOWER.cx, TOWER.storeyHeight * TOWER.storeys + TOWER.roofThickness, TOWER.cz);
}

/** All airfield buildings, merged into one vertex-coloured mesh (one draw call). */
export function createBuildings(): { mesh: THREE.Mesh; footprints: Footprint[] } {
  const b = new ColouredMeshBuilder();
  const footprints = [
    ...HANGAR.centresZ.map((cz, k) => addHangar(b, k, cz)),
    addClubroom(b),
    addTower(b),
  ];
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'buildings';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, footprints };
}
