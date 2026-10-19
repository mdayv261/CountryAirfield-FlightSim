import * as THREE from 'three';
import { TEST_BLOCK, type TestBlock } from '../physics/testBlock';

const COLOURS = { box: 0xf2b134, stripe: 0x2b2b2b, leg: 0x8c8c8c, tyre: 0x1e1e1e };

/**
 * Visual model of the Stage 3 test block: a yellow box with a black nose stripe, three
 * legs and wheels. Wheels slide up their legs as the struts compress, and the nosewheel
 * turns with the pedals, so the gear model can be seen working.
 */
export class TestBlockMesh {
  readonly object = new THREE.Group();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly q = new THREE.Quaternion();

  constructor(private readonly block: TestBlock) {
    this.object.name = 'test-block';
    const { x, y, z } = TEST_BLOCK.size;
    const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c });
    const box = new THREE.Mesh(new THREE.BoxGeometry(x, y, z), mat(COLOURS.box));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(x * 1.01, y * 0.3, 0.15), mat(COLOURS.stripe));
    stripe.position.z = -z / 2 + 0.1; // front (−z) so you can see which way it faces
    this.object.add(box, stripe);

    TEST_BLOCK.legs.forEach((leg) => {
      if (leg.kind !== 'wheel') return;
      const [lx, ly, lz] = leg.position_m;
      const r = leg.tyreRadius_m ?? 0.1;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, TEST_BLOCK.legLength), mat(COLOURS.leg));
      strut.position.set(lx, -y / 2 - TEST_BLOCK.legLength / 2 + r, lz);
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.08, 12), mat(COLOURS.tyre));
      tyre.rotation.z = Math.PI / 2; // axle along x
      tyre.position.y = r; // contact point at the group origin
      wheel.add(tyre);
      wheel.position.set(lx, ly, lz);
      this.wheels.push(wheel);
      this.object.add(strut, wheel);
    });
    this.object.traverse((o) => (o.castShadow = true));
  }

  /** Place the model between the last two physics states (alpha 0..1). */
  update(alpha: number): void {
    const b = this.block.body;
    this.object.position.lerpVectors(b.prevPosition, b.position, alpha);
    this.object.quaternion.copy(this.q.slerpQuaternions(b.prevOrientation, b.orientation, alpha));
    let w = 0;
    TEST_BLOCK.legs.forEach((leg, i) => {
      if (leg.kind !== 'wheel') return;
      const wheel = this.wheels[w++];
      wheel.position.y = leg.position_m[1] + this.block.gear.states[i].compression;
      const steer = (leg.steerMax_rad ?? 0) * this.block.controls.pedals;
      wheel.rotation.y = -steer; // positive steer turns right (towards +x from −z)
    });
  }
}
