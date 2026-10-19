import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects many simple coloured parts (boxes, prisms...) and merges them into one
 * vertex-coloured geometry, so a whole group of buildings costs a single draw call.
 */
export class ColouredMeshBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Add a geometry in one flat colour, optionally moved/rotated by a matrix. */
  add(geometry: THREE.BufferGeometry, colour: THREE.ColorRepresentation, matrix?: THREE.Matrix4): this {
    // Non-indexed so every face keeps its own normal and colour (crisp low-poly look).
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(colour);
    const count = g.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    this.parts.push(g);
    return this;
  }

  /** Axis-aligned box given its centre and full sizes. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, colour: THREE.ColorRepresentation): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), colour, new THREE.Matrix4().makeTranslation(cx, cy, cz));
  }

  /** Merge everything added so far into one geometry. */
  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts);
    if (!merged) throw new Error('ColouredMeshBuilder: nothing to merge');
    merged.computeBoundingSphere();
    return merged;
  }
}

/**
 * Triangular prism lying along X, base on y = 0, apex ridge at y = height, base width
 * along Z. Used for gable roofs and runway gable markers. Faces wound anticlockwise
 * seen from outside, so normals point outwards.
 */
export function prismGeometry(length: number, width: number, height: number): THREE.BufferGeometry {
  const l = length / 2;
  const w = width / 2;
  const A0 = [-l, 0, -w], B0 = [-l, 0, w], C0 = [-l, height, 0];
  const A1 = [l, 0, -w], B1 = [l, 0, w], C1 = [l, height, 0];
  const tris = [
    A0, B0, C0, // west end
    A1, C1, B1, // east end
    A0, A1, B1, A0, B1, B0, // base
    B0, B1, C1, B0, C1, C0, // south slope
    A0, C0, C1, A0, C1, A1, // north slope
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}
