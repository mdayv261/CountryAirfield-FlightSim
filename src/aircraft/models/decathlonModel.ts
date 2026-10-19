import * as THREE from 'three';
import { ColouredMeshBuilder } from '../../world/meshBuilder';
import type { FixedWingAircraft } from '../../physics/FixedWingAircraft';
import { AIRCRAFT } from '..';
import { AircraftModel, hingedX, hingedY, loft, slab, tube, v, type Section } from './AircraftModel';

// Procedural low-poly Super Decathlon 8KCAB: tube-and-fabric fuselage with a tandem
// two-seat cabin, strut-braced high wing, spring-steel main gear and a steerable tailwheel.
// White with the classic red sunburst trim. Body axes, origin at the CG.

const data = AIRCRAFT.decathlon8kcab;
const SPAN = data.geometry.span_m!;
const CHORD = data.geometry.chord_m!;
const C = {
  white: 0xf2f1ec,
  red: 0xc0262d,
  glass: 0x2a3b4c,
  frame: 0x9aa0a6,
  black: 0x1c1c1c,
  metal: 0xb9bfc5,
  tip: 0xf2f1ec,
  pilot: 0x2c4f7c,
  helmet: 0xe8e8e8,
};
const WING = { y: 0.86, zLE: -0.4, thickness: 0.19, aileronChord: 0.38, aileronStart: 2.3, strutX: 2.9 };
/** Cabin glazing opacity: a light tint, so the pilot sees out through windscreen and side windows. */
const GLASS_OPACITY = 0.2;
const TAIL = { z: 3.95, y: 0.22, stabSpan: 3.0, stabChord: 0.62, elevChord: 0.42, finHeight: 0.85, finChord: 0.55, rudderChord: 0.45 };

/** Fuselage cross-sections from the spinner to the tail post. */
const FUSELAGE: Section[] = [
  { z: -2.0, w: 0.55, yBot: -0.25, yTop: 0.3 }, // cowl front
  { z: -1.15, w: 0.86, yBot: -0.42, yTop: 0.38 }, // firewall: cowl top level with the panel top
  { z: -0.4, w: 0.86, yBot: -0.48, yTop: 0.84 }, // cabin under the wing
  { z: 1.0, w: 0.82, yBot: -0.46, yTop: 0.84 }, // rear of cabin
  { z: 2.6, w: 0.45, yBot: -0.25, yTop: 0.5 },
  { z: 4.35, w: 0.12, yBot: 0.02, yTop: 0.3 }, // tail post
];

export class DecathlonModel extends AircraftModel {
  /** Front-seat pilot's eye (the Decathlon is flown solo from the front). */
  readonly eye = v(0, 0.52, -0.62);
  readonly chase = { back: 11, up: 3 };

  constructor(aircraft: FixedWingAircraft) {
    super(aircraft);
    this.object.name = 'decathlon8kcab';
    const b = new ColouredMeshBuilder();
    const inc = this.wingIncidence;
    const wingMid = WING.zLE + CHORD / 2;
    const rig = (z: number, y = WING.y) => {
      const dz = z - wingMid;
      return { y: y - dz * Math.sin(inc), z: wingMid + dz * Math.cos(inc) };
    };
    const wingPart = (x: number, z: number, y: number, sx: number, sy: number, sz: number, colour: number) => {
      const p = rig(z, y);
      b.add(new THREE.BoxGeometry(sx, sy, sz), colour, new THREE.Matrix4().makeRotationX(inc).setPosition(x, p.y, p.z));
    };

    // Fuselage: lofted segments, red cowl, white elsewhere, red cheat-line down each side.
    for (let i = 0; i < FUSELAGE.length - 1; i++) loft(b, FUSELAGE[i], FUSELAGE[i + 1], i === 0 ? C.red : C.white);
    for (const s of [-1, 1]) slab(b, s * 0.43, -0.05, 0.3, 0.02, 0.1, 2.6, C.red);

    // Cabin glazing: sloping windscreen and side windows for the tandem seats, built as a
    // separate see-through mesh so the pilot can look out.
    const glass = new ColouredMeshBuilder();
    // Windscreen: lies along the fuselage top from the firewall up to the wing's leading edge.
    const [fw, wr] = [FUSELAGE[1], FUSELAGE[2]];
    const rise = wr.yTop - fw.yTop;
    const run = wr.z - fw.z;
    const screen = new THREE.Matrix4()
      .makeRotationX(-Math.atan2(rise, run)) // front edge down
      .setPosition(0, (fw.yTop + wr.yTop) / 2 + 0.012, (fw.z + wr.z) / 2);
    glass.add(new THREE.BoxGeometry(fw.w * 0.92, 0.02, Math.hypot(rise, run)), C.glass, screen);
    for (const s of [-1, 1]) {
      slab(glass, s * 0.435, 0.42, -0.55, 0.02, 0.42, 0.7, C.glass); // front seat window
      slab(glass, s * 0.425, 0.42, 0.35, 0.02, 0.42, 0.75, C.glass); // rear seat window
      slab(b, s * 0.44, 0.42, -0.12, 0.03, 0.46, 0.06, C.frame); // door pillar
    }
    // Pilot in the front seat.
    b.add(new THREE.SphereGeometry(0.12, 8, 6), C.helmet, new THREE.Matrix4().makeTranslation(0, 0.5, -0.5));
    slab(b, 0, 0.12, -0.45, 0.36, 0.5, 0.26, C.pilot);

    // Spinner.
    const spinner = new THREE.ConeGeometry(0.14, 0.32, 10);
    spinner.rotateX(-Math.PI / 2);
    b.add(spinner, C.red, new THREE.Matrix4().makeTranslation(0, 0.05, -2.18));

    // Wing at its rigging incidence: white with red sunburst bands and red tips.
    const fixedChord = CHORD - WING.aileronChord;
    wingPart(0, WING.zLE + fixedChord / 2, WING.y, SPAN, WING.thickness, fixedChord, C.white);
    wingPart(0, WING.zLE + fixedChord + WING.aileronChord / 2, WING.y, WING.aileronStart * 2, WING.thickness * 0.6, WING.aileronChord, C.white);
    for (const s of [-1, 1]) {
      // Painted bands stand a few cm proud so they never fight the white skin for depth.
      wingPart(s * (SPAN / 2 - 0.25), wingMid, WING.y, 0.5, WING.thickness + 0.04, CHORD + 0.02, C.red);
      wingPart(s * 1.4, WING.zLE + 0.35, WING.y, 0.28, WING.thickness + 0.04, 0.7, C.red);
    }

    // V-struts from the lower fuselage to the wing, each with a jury strut.
    for (const s of [-1, 1]) {
      const front = rig(WING.zLE + 0.3, WING.y - WING.thickness / 2);
      const rear = rig(WING.zLE + 1.2, WING.y - WING.thickness / 2);
      tube(b, v(s * 0.42, -0.4, -0.35), v(s * WING.strutX, front.y, front.z), 0.03, C.metal);
      tube(b, v(s * 0.42, -0.4, 0.45), v(s * WING.strutX, rear.y, rear.z), 0.03, C.metal);
    }

    // Spring-steel main legs and wheels at the data file's contact points; tailwheel spring.
    for (const leg of data.gear.legs) {
      if (leg.kind !== 'wheel') continue;
      const [x, y, z] = leg.position_m;
      const r = leg.tyreRadius_m ?? 0.1;
      const axle = v(x, y + r, z);
      if (x !== 0) tube(b, v(Math.sign(x) * 0.3, -0.42, z), axle, 0.035, C.metal);
      else tube(b, v(0, 0.05, z - 0.35), axle, 0.03, C.metal);
      const wheel = new THREE.CylinderGeometry(r, r, Math.max(0.07, r * 0.45), 12);
      wheel.rotateZ(Math.PI / 2);
      b.add(wheel, C.black, new THREE.Matrix4().makeTranslation(axle.x, axle.y, axle.z));
    }

    // Tailplane and fin (fixed parts), red trimmed.
    slab(b, 0, TAIL.y, TAIL.z + TAIL.stabChord / 2, TAIL.stabSpan, 0.05, TAIL.stabChord, C.white);
    for (const s of [-1, 1]) slab(b, s * (TAIL.stabSpan / 2 - 0.2), TAIL.y, TAIL.z + TAIL.stabChord / 2, 0.4, 0.08, TAIL.stabChord + 0.02, C.red);
    slab(b, 0, TAIL.y + TAIL.finHeight / 2, TAIL.z + TAIL.finChord / 2, 0.05, TAIL.finHeight, TAIL.finChord, C.white);
    this.addBody(b);
    const glazing = new THREE.Mesh(
      glass.build(),
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: GLASS_OPACITY, depthWrite: false }),
    );
    glazing.renderOrder = 1; // after the opaque parts, so they show through it
    this.object.add(glazing);

    // Moving surfaces.
    this.elevator = hingedX(TAIL.stabSpan, TAIL.elevChord, 0.04, C.white);
    this.elevator.position.set(0, TAIL.y, TAIL.z + TAIL.stabChord);
    this.rudder = hingedY(TAIL.finHeight + 0.3, TAIL.rudderChord, 0.045, C.red);
    this.rudder.position.set(0, TAIL.y - 0.2, TAIL.z + TAIL.finChord);
    const aileronSpan = SPAN / 2 - WING.aileronStart;
    this.aileronL = hingedX(aileronSpan, WING.aileronChord, WING.thickness * 0.6, C.white);
    this.aileronR = hingedX(aileronSpan, WING.aileronChord, WING.thickness * 0.6, C.white);
    const hinge = rig(WING.zLE + fixedChord);
    this.aileronL.position.set(-(WING.aileronStart + aileronSpan / 2), hinge.y, hinge.z);
    this.aileronR.position.set(WING.aileronStart + aileronSpan / 2, hinge.y, hinge.z);
    this.object.add(this.elevator, this.rudder, this.aileronL, this.aileronR);

    // Two-blade metal propeller with white-and-red painted tips.
    const D = data.propulsion.propDiameter_m!;
    const blades = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(D, 0.11, 0.025), new THREE.MeshLambertMaterial({ color: C.black }));
    blades.add(blade);
    for (const s of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.115, 0.03), new THREE.MeshLambertMaterial({ color: s > 0 ? C.tip : C.red }));
      tip.position.x = s * (D / 2 - 0.06);
      blades.add(tip);
    }
    blades.traverse((o) => (o.castShadow = true));
    this.addPropeller(blades, 0x8a8f94);
  }
}
