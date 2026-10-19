import * as THREE from 'three';
import { ColouredMeshBuilder } from '../../world/meshBuilder';
import type { FixedWingAircraft } from '../../physics/FixedWingAircraft';
import { AIRCRAFT } from '..';
import { AircraftModel, hingedX, hingedY, slab, tube, v } from './AircraftModel';

// Procedural low-poly Air-Bike 103. Built in body axes (x right, y up, z aft, origin at the
// CG) so it lines up with the physics: gear contact points, propeller hub and wing all sit
// where the data file says they are.

const data = AIRCRAFT.airbike103;
const SPAN = data.geometry.span_m!;
const CHORD = data.geometry.chord_m!;
const C = {
  fabric: 0xf3c623, // yellow Dacron wing
  fabricTrim: 0xc0392b,
  tube: 0xb8bec4, // aluminium / painted steel tube
  black: 0x1c1c1c,
  seat: 0x2a2a2a,
  engine: 0x5b6066,
  head: 0x8a8f94,
  prop: 0x8b5a2b, // varnished wood
  pilotSuit: 0x2c4f7c,
  helmet: 0xe8e8e8,
  skin: 0xd9a066,
};
const WING = { y: 0.85, zLE: -0.38, thickness: 0.12, aileronChord: 0.3, aileronStart: 2.0 };
const TAIL = { z: 3.25, y: 0.22, stabSpan: 2.4, stabChord: 0.45, elevChord: 0.3, finHeight: 0.85, finChord: 0.45, rudderChord: 0.35 };
/** Wing rigging incidence, rad (leading edge up from the fuselage axis). */
const INCIDENCE = ((data.aero!.wingIncidence_deg ?? 0) * Math.PI) / 180;

export class AirBikeModel extends AircraftModel {
  /** Pilot's eye: just above the seat, behind the stick. */
  readonly eye = v(0, 0.38, -0.2);
  readonly chase = { back: 9, up: 2.6 };

  constructor(aircraft: FixedWingAircraft) {
    super(aircraft);
    this.object.name = 'airbike103';
    const b = new ColouredMeshBuilder();
    const wingMid = WING.zLE + CHORD / 2;

    // Wing: a thin slab with a red leading-edge stripe, cut back where the ailerons hinge.
    const fixedChord = CHORD - WING.aileronChord;
    // The wing is rigged at a small incidence: rotate its parts nose-up about the mid-chord.
    const rig = (z: number, y = WING.y) => {
      const dz = z - wingMid;
      return { y: y + dz * -Math.sin(INCIDENCE), z: wingMid + dz * Math.cos(INCIDENCE) };
    };
    const wingPart = (z: number, y: number, sx: number, sy: number, sz: number, colour: number) => {
      const p = rig(z, y);
      const m = new THREE.Matrix4().makeRotationX(INCIDENCE).setPosition(0, p.y, p.z);
      b.add(new THREE.BoxGeometry(sx, sy, sz), colour, m);
    };
    wingPart(WING.zLE + fixedChord / 2, WING.y, SPAN, WING.thickness, fixedChord, C.fabric);
    wingPart(WING.zLE + 0.08, WING.y + 0.005, SPAN + 0.01, WING.thickness, 0.16, C.fabricTrim);
    // Inboard of the ailerons the trailing edge is fixed.
    wingPart(WING.zLE + fixedChord + WING.aileronChord / 2, WING.y, WING.aileronStart * 2, WING.thickness * 0.6, WING.aileronChord, C.fabric);

    // Steel-tube fuselage: keel, tail boom, cabane posts to the wing, seat frame.
    const nose = v(0, -0.55, -1.25);
    const tail = v(0, TAIL.y - 0.05, TAIL.z + 0.2);
    tube(b, nose, v(0, -0.55, 0.4), 0.035, C.tube); // keel under the seat
    tube(b, v(0, -0.55, 0.4), tail, 0.03, C.tube); // lower boom to the tail
    tube(b, v(0, WING.y - 0.05, wingMid + 0.5), tail, 0.035, C.tube); // upper boom from the wing
    for (const x of [-0.25, 0.25]) {
      tube(b, v(x, -0.55, -0.6), v(x, WING.y - 0.05, WING.zLE + 0.15), 0.025, C.tube); // front cabane
      tube(b, v(x, -0.55, 0.4), v(x, WING.y - 0.05, wingMid + 0.5), 0.025, C.tube); // rear cabane
      // Wing struts (V-struts) from the keel area out to 60 % semi-span.
      tube(b, v(x, -0.5, -0.1), v(Math.sign(x) * 2.5, WING.y - 0.06, WING.zLE + 0.25), 0.022, C.tube);
      tube(b, v(x, -0.5, 0.3), v(Math.sign(x) * 2.5, WING.y - 0.06, WING.zLE + 0.95), 0.022, C.tube);
    }
    tube(b, nose, v(0, -0.45, -1.45), 0.03, C.tube); // engine mount

    // Open seat, and the pilot sitting on it.
    slab(b, 0, -0.42, -0.15, 0.45, 0.06, 0.45, C.seat);
    slab(b, 0, -0.15, 0.1, 0.45, 0.55, 0.06, C.seat);
    slab(b, 0, -0.1, -0.12, 0.38, 0.55, 0.26, C.pilotSuit); // torso
    slab(b, 0, -0.33, -0.45, 0.32, 0.14, 0.45, C.pilotSuit); // thighs
    for (const x of [-0.1, 0.1]) slab(b, x, -0.55, -0.68, 0.1, 0.4, 0.1, C.pilotSuit); // shins
    b.add(new THREE.SphereGeometry(0.12, 8, 6), C.helmet, new THREE.Matrix4().makeTranslation(0, 0.3, -0.13));
    slab(b, 0, 0.27, -0.24, 0.16, 0.06, 0.03, C.black); // visor
    tube(b, v(0, -0.5, -0.45), v(0, -0.1, -0.5), 0.015, C.black); // control stick

    // Hirth F-33 single cylinder with belt reduction drive, ahead of the pilot.
    // Mounted low on the keel so the pilot sees over it; a slim belt housing runs up to the prop hub.
    slab(b, 0, -0.32, -1.35, 0.28, 0.3, 0.32, C.engine);
    for (let i = 0; i < 4; i++) slab(b, 0, -0.15 + i * 0.035, -1.35, 0.3 - i * 0.04, 0.015, 0.22, C.head); // cooling fins
    slab(b, 0, -0.08, -1.6, 0.1, 0.5, 0.1, C.black); // belt drive housing
    tube(b, v(0, 0.15, -1.6), v(0, 0.15, -1.7), 0.05, C.engine); // prop shaft

    // Main gear: legs from the keel to each axle, wheels at the data file's contact points.
    for (const leg of data.gear.legs) {
      if (leg.kind !== 'wheel') continue;
      const [x, y, z] = leg.position_m;
      const r = leg.tyreRadius_m ?? 0.1;
      const axle = v(x, y + r, z);
      tube(b, x === 0 ? v(0, TAIL.y - 0.05, z - 0.1) : v(0, -0.55, z), axle, 0.025, C.tube);
      const wheel = new THREE.CylinderGeometry(r, r, Math.max(0.05, r * 0.4), 10);
      wheel.rotateZ(Math.PI / 2);
      b.add(wheel, C.black, new THREE.Matrix4().makeTranslation(axle.x, axle.y, axle.z));
    }

    // Tailplane and fin (fixed parts).
    slab(b, 0, TAIL.y, TAIL.z + TAIL.stabChord / 2, TAIL.stabSpan, 0.04, TAIL.stabChord, C.fabric);
    slab(b, 0, TAIL.y + TAIL.finHeight / 2, TAIL.z + TAIL.finChord / 2, 0.04, TAIL.finHeight, TAIL.finChord, C.fabric);
    slab(b, 0, TAIL.y + TAIL.finHeight * 0.8, TAIL.z + TAIL.finChord / 2, 0.045, 0.15, TAIL.finChord, C.fabricTrim);

    this.addBody(b);

    // Moving surfaces.
    this.elevator = hingedX(TAIL.stabSpan, TAIL.elevChord, 0.035, C.fabric);
    this.elevator.position.set(0, TAIL.y, TAIL.z + TAIL.stabChord);
    this.rudder = hingedY(TAIL.finHeight + 0.1, TAIL.rudderChord, 0.035, C.fabricTrim);
    this.rudder.position.set(0, TAIL.y - 0.1, TAIL.z + TAIL.finChord);
    const aileronSpan = SPAN / 2 - WING.aileronStart;
    this.aileronL = hingedX(aileronSpan, WING.aileronChord, WING.thickness * 0.6, C.fabric);
    this.aileronR = hingedX(aileronSpan, WING.aileronChord, WING.thickness * 0.6, C.fabric);
    const hinge = rig(WING.zLE + fixedChord);
    this.aileronL.position.set(-(WING.aileronStart + aileronSpan / 2), hinge.y, hinge.z);
    this.aileronR.position.set(WING.aileronStart + aileronSpan / 2, hinge.y, hinge.z);
    this.object.add(this.elevator, this.rudder, this.aileronL, this.aileronR);

    // Propeller: two wooden blades, plus a faint disc that shows when it is spinning fast.
    const blades = new THREE.Mesh(new THREE.BoxGeometry(data.propulsion.propDiameter_m!, 0.12, 0.03), new THREE.MeshLambertMaterial({ color: C.prop }));
    blades.castShadow = true;
    this.addPropeller(blades, 0x6b5030);
  }
}
