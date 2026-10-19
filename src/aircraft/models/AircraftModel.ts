import * as THREE from 'three';
import type { FixedWingAircraft } from '../../physics/FixedWingAircraft';
import { ColouredMeshBuilder } from '../../world/meshBuilder';

// Shared parts and animation for the procedural aircraft models. Models are built in body
// axes (x right, y up, z aft, origin at the CG) so they line up with the physics.

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A round tube from a to b (low-poly cylinder). */
export function tube(b: ColouredMeshBuilder, from: THREE.Vector3, to: THREE.Vector3, r: number, colour: number): void {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  b.add(g, colour, m);
}

/** An axis-aligned box by centre and size. */
export function slab(b: ColouredMeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, colour: number) {
  b.box(cx, cy, cz, sx, sy, sz, colour);
}

/** A fuselage section: cross-section rectangle (width, bottom y, top y) at each end along z. */
export interface Section {
  z: number;
  w: number;
  yBot: number;
  yTop: number;
}

/** A tapered box between two cross-sections (a lofted fuselage segment). */
export function loft(b: ColouredMeshBuilder, a: Section, c: Section, colour: number): void {
  const corners = (s: Section) => [
    [-s.w / 2, s.yBot, s.z],
    [s.w / 2, s.yBot, s.z],
    [s.w / 2, s.yTop, s.z],
    [-s.w / 2, s.yTop, s.z],
  ];
  const [p0, p1, p2, p3] = corners(a);
  const [q0, q1, q2, q3] = corners(c);
  // Each face as two triangles, wound anticlockwise seen from outside (a is forward of c).
  const quads = [
    [p0, p3, p2, p1], // front cap
    [q0, q1, q2, q3], // rear cap
    [p0, p1, q1, q0], // bottom
    [p3, q3, q2, p2], // top
    [p0, q0, q3, p3], // left
    [p1, p2, q2, q1], // right
  ];
  const pos: number[] = [];
  for (const [w, x, y, z] of quads) pos.push(...w, ...x, ...y, ...w, ...y, ...z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.add(g, colour);
}

/** A control surface hinged along x at its leading edge (elevator, ailerons). */
export function hingedX(width: number, chord: number, thickness: number, colour: number): THREE.Group {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, chord), new THREE.MeshLambertMaterial({ color: colour }));
  m.position.z = chord / 2; // trailing edge aft of the hinge
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

/** A rudder hinged along y at its leading edge. */
export function hingedY(height: number, chord: number, thickness: number, colour: number): THREE.Group {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(thickness, height, chord), new THREE.MeshLambertMaterial({ color: colour }));
  m.position.set(0, height / 2, chord / 2);
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

/**
 * Base for an aircraft model: moves with the physics body (interpolated between steps),
 * deflects its control surfaces with the pilot's inputs and spins its propeller.
 * Subclasses build the airframe and set the moving parts and the camera positions.
 */
export abstract class AircraftModel {
  readonly object = new THREE.Group();
  /** Pilot's eye, body axes (cockpit view). */
  abstract readonly eye: THREE.Vector3;
  /** Chase camera distance behind and height above, m. */
  abstract readonly chase: { back: number; up: number };
  protected elevator = new THREE.Group();
  protected rudder = new THREE.Group();
  protected aileronL = new THREE.Group();
  protected aileronR = new THREE.Group();
  /** Rigging incidence of the wing, rad (ailerons sit at this angle when neutral). */
  protected wingIncidence = 0;
  protected readonly prop = new THREE.Group();
  private disc?: THREE.Mesh;
  private blades?: THREE.Object3D;
  private readonly q = new THREE.Quaternion();
  private propAngle = 0;

  constructor(readonly aircraft: FixedWingAircraft) {
    this.wingIncidence = ((aircraft.data.aero?.wingIncidence_deg ?? 0) * Math.PI) / 180;
  }

  /** Add the merged, vertex-coloured airframe mesh. */
  protected addBody(b: ColouredMeshBuilder): void {
    const body = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    body.castShadow = true;
    body.receiveShadow = true;
    this.object.add(body);
  }

  /** Build the propeller (blades plus a blur disc) at the data file's hub position. */
  protected addPropeller(blades: THREE.Object3D, discColour: number): void {
    const [px, py, pz] = this.aircraft.data.propeller!.position_m;
    const D = this.aircraft.data.propulsion.propDiameter_m!;
    this.blades = blades;
    this.disc = new THREE.Mesh(
      new THREE.CircleGeometry(D / 2, 24),
      new THREE.MeshBasicMaterial({ color: discColour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.prop.add(blades, this.disc);
    this.prop.position.set(px, py, pz - 0.02);
    this.object.add(this.prop);
  }

  /** Pose between the last two physics states and animate controls and propeller. */
  update(alpha: number, frameDt: number): void {
    const ac = this.aircraft;
    const body = ac.body;
    this.object.position.lerpVectors(body.prevPosition, body.position, alpha);
    this.object.quaternion.copy(this.q.slerpQuaternions(body.prevOrientation, body.orientation, alpha));

    const a = ac.data.aero!;
    const p = ac.pilot;
    const deg = Math.PI / 180;
    // Surfaces trail aft (+z) of their hinges. A negative rotation about x lifts the trailing
    // edge; a positive rotation about y swings it to the right.
    this.elevator.rotation.x = -p.elevator * a.elevatorMax_deg * deg; // stick back: trailing edge up
    this.rudder.rotation.y = ac.rudderApplied * a.rudderMax_deg * deg; // right pedal: trailing edge right
    this.aileronR.rotation.x = this.wingIncidence - p.aileron * a.aileronMax_deg * deg; // stick right: right aileron up
    this.aileronL.rotation.x = this.wingIncidence + p.aileron * a.aileronMax_deg * deg; // ... and left aileron down

    if (!this.blades || !this.disc) return;
    // +z points back at the pilot, so clockwise as the pilot sees it is a negative angle about z.
    const pp = ac.powerplant.out;
    const sense = ac.data.propeller!.rotation === 'clockwise' ? -1 : 1;
    this.propAngle = (this.propAngle + sense * (pp.propRpm / 60) * 2 * Math.PI * frameDt) % (2 * Math.PI);
    this.blades.rotation.z = this.propAngle;
    // From ~2 rev/s the blades blur (and at display frame rates would only strobe):
    // fade them out and the disc in, fully by ~6 rev/s.
    const blur = THREE.MathUtils.clamp((pp.propRpm - 120) / 240, 0, 1);
    (this.disc.material as THREE.MeshBasicMaterial).opacity = 0.25 * blur;
    this.blades.visible = blur < 0.95;
  }
}
