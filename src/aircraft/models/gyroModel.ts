import * as THREE from 'three';
import { ColouredMeshBuilder } from '../../world/meshBuilder';
import type { Gyroplane } from '../../physics/Gyroplane';
import { AIRCRAFT } from '..';
import { AircraftModel, hingedY, slab, tube, v } from './AircraftModel';

// Procedural low-poly Bensen B-8M: square aluminium keel and mast, open seat with the pilot,
// rudder bar and nosewheel at the front, McCulloch engine and pusher propeller behind the
// mast, tricycle gear, fin and rudder at the tail, and a two-blade teetering rotor whose
// disc tilts with the head (and with blowback) and spins at the rotor's real speed.

const data = AIRCRAFT.bensenB8M;
const R = data.geometry.rotorDiameter_m! / 2;
const HUB = data.rotor!.hubPosition_m;
const C = {
  alu: 0xc8ccd0,
  yellow: 0xf2c31b,
  red: 0xc0262d,
  black: 0x1c1c1c,
  engine: 0x4f5459,
  seat: 0x2a2a2a,
  pilot: 0x2c4f7c,
  helmet: 0xe8e8e8,
  blade: 0xd8dadc,
  prop: 0x8b5a2b,
};
const KEEL_Y = -0.55;

export class GyroModel extends AircraftModel {
  /** Pilot's eye: at the front of the helmet, in the open seat ahead of the mast. */
  readonly eye = v(0, 0.3, -0.45);
  readonly chase = { back: 10, up: 3.2 };
  /** Rotor group: oriented along the disc axis, spun about its own up axis. */
  private readonly rotorGroup = new THREE.Group();
  private readonly rotorSpin = new THREE.Group();
  private readonly rotorDisc: THREE.Mesh;
  private rotorAngle = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly gyro: Gyroplane) {
    super(gyro);
    this.object.name = 'bensenB8M';
    const b = new ColouredMeshBuilder();

    // Keel (square tube, drawn as a slim box), mast, axle and seat frame.
    slab(b, 0, KEEL_Y, 0.4, 0.06, 0.06, 4.1, C.alu); // keel from nosewheel to tail
    slab(b, 0, (KEEL_Y + HUB[1]) / 2, HUB[2], 0.06, HUB[1] - KEEL_Y, 0.06, C.alu); // mast
    tube(b, v(0, KEEL_Y, HUB[2] + 0.25), v(0, HUB[1] - 0.6, HUB[2]), 0.02, C.alu); // mast brace
    slab(b, 0, KEEL_Y - 0.08, 0.25, 1.5, 0.05, 0.05, C.alu); // axle tube

    // Seat, pilot and controls.
    slab(b, 0, -0.38, -0.3, 0.42, 0.06, 0.42, C.red);
    slab(b, 0, -0.1, -0.08, 0.42, 0.5, 0.06, C.red);
    slab(b, 0, -0.08, -0.3, 0.36, 0.5, 0.26, C.pilot); // torso
    slab(b, 0, -0.3, -0.62, 0.32, 0.14, 0.5, C.pilot); // thighs
    for (const x of [-0.1, 0.1]) slab(b, x, -0.52, -0.92, 0.1, 0.36, 0.1, C.pilot); // shins to the rudder bar
    b.add(new THREE.SphereGeometry(0.12, 8, 6), C.helmet, new THREE.Matrix4().makeTranslation(0, 0.3, -0.3));
    slab(b, 0, 0.28, -0.42, 0.16, 0.06, 0.03, C.black); // visor
    tube(b, v(0, KEEL_Y, -0.55), v(0, -0.1, -0.6), 0.015, C.black); // control stick (to the head via push rods)
    // Push rods from the stick base aft along the keel, then up beside the mast to the head.
    tube(b, v(0.05, KEEL_Y + 0.05, -0.55), v(0.05, KEEL_Y + 0.05, HUB[2]), 0.01, C.alu);
    tube(b, v(0.05, KEEL_Y + 0.05, HUB[2]), v(0.05, HUB[1] - 0.1, HUB[2]), 0.01, C.alu);
    slab(b, 0, KEEL_Y + 0.05, -1.05, 0.7, 0.04, 0.05, C.black); // rudder bar
    slab(b, 0, -0.25, 0.2, 0.36, 0.3, 0.22, C.yellow); // fuel tank behind the seat

    // McCulloch flat-four behind the mast, prop shaft aft.
    slab(b, 0, 0.12, 0.55, 0.5, 0.26, 0.42, C.engine);
    for (const s of [-1, 1]) slab(b, s * 0.3, 0.12, 0.55, 0.1, 0.18, 0.36, C.black); // cylinder banks
    tube(b, v(0, KEEL_Y, 0.45), v(0, 0, 0.55), 0.025, C.alu); // engine mount

    // Gear: mains on the axle, nosewheel in a fork at the front, and the keel's tail skid.
    for (const leg of data.gear.legs) {
      const [x, y, z] = leg.position_m;
      if (leg.kind !== 'wheel') {
        tube(b, v(x, KEEL_Y, z), v(x, y + 0.02, z + 0.1), 0.02, C.alu);
        continue;
      }
      const r = leg.tyreRadius_m ?? 0.1;
      const axle = v(x, y + r, z);
      tube(b, x === 0 ? v(0, KEEL_Y, z + 0.05) : v(x * 0.7, KEEL_Y - 0.08, z), axle, 0.02, C.alu);
      const wheel = new THREE.CylinderGeometry(r, r, Math.max(0.06, r * 0.45), 10);
      wheel.rotateZ(Math.PI / 2);
      b.add(wheel, C.black, new THREE.Matrix4().makeTranslation(axle.x, axle.y, axle.z));
    }

    // Tail: the fin (fixed part) and the small tailplane, at the data file's surfaces.
    for (const s of data.airframeAero!.surfaces) {
      const [x, y, z] = s.position_m;
      if (s.plane === 'pitch') {
        const span = Math.sqrt(s.area_m2 * s.aspectRatio);
        slab(b, x, y, z, span, 0.03, s.area_m2 / span, C.yellow);
      } else {
        const h = Math.sqrt(s.area_m2 * s.aspectRatio);
        slab(b, x, y, z - 0.1, 0.03, h, (s.area_m2 / h) * 0.5, C.yellow);
      }
    }
    this.addBody(b);

    // Rudder: the aft half of the fin, swinging with the pedals.
    const fin = data.airframeAero!.surfaces.find((s) => s.plane === 'yaw')!;
    const finH = Math.sqrt(fin.area_m2 * fin.aspectRatio);
    const rudderChord = (fin.area_m2 / finH) * 0.5;
    this.rudder = hingedY(finH, rudderChord, 0.03, C.red);
    this.rudder.position.set(fin.position_m[0], fin.position_m[1] - finH / 2, fin.position_m[2] + 0.02);
    this.object.add(this.rudder);

    // Pusher propeller behind the engine.
    const blades = new THREE.Mesh(new THREE.BoxGeometry(data.propulsion.propDiameter_m!, 0.1, 0.03), new THREE.MeshLambertMaterial({ color: C.prop }));
    blades.castShadow = true;
    this.addPropeller(blades, 0x6b5030);

    // Rotor: teeter head block and two blades, plus a faint disc when spinning fast.
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), new THREE.MeshLambertMaterial({ color: C.alu }));
    const bladeMat = new THREE.MeshLambertMaterial({ color: C.blade });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.03, data.rotor!.bladeChord_m), bladeMat);
    blade.castShadow = true;
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.032, data.rotor!.bladeChord_m), new THREE.MeshLambertMaterial({ color: C.red }));
      tip.position.x = s * (R - 0.125);
      this.rotorSpin.add(tip);
    }
    this.rotorSpin.add(blade);
    this.rotorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(R, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xbfc4c8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.rotorGroup.add(head, this.rotorSpin, this.rotorDisc);
    this.rotorGroup.position.set(...HUB);
    this.object.add(this.rotorGroup);
  }

  protected override animate(frameDt: number): void {
    const a = this.gyro;
    this.rudder.rotation.y = a.rudderApplied * ((data.airframeAero!.surfaces.find((s) => s.plane === 'yaw')?.rudderMax_deg ?? 25) * Math.PI) / 180;
    // Tilt the rotor to its disc axis (head tilt + blowback + lag), then spin it about that axis.
    this.rotorGroup.quaternion.setFromUnitVectors(this.up, a.rotor.discAxis);
    const sense = data.rotor!.rotation === 'anticlockwise' ? 1 : -1;
    this.rotorAngle = (this.rotorAngle + sense * a.rotor.omega * frameDt) % (2 * Math.PI);
    this.rotorSpin.rotation.y = this.rotorAngle;
    // The real blades strobe at display frame rates; above ~2 rev/s show a translucent disc too.
    const blur = THREE.MathUtils.clamp((a.rotor.rpm - 120) / 180, 0, 1);
    (this.rotorDisc.material as THREE.MeshBasicMaterial).opacity = 0.18 * blur;
  }
}
