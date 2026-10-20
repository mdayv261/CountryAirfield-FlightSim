import * as THREE from 'three';
import type { PanelData } from '../aircraft/schema';
import { drawGauge } from './gauges';
import type { InstrumentReadings } from './instruments';

/** Canvas resolution of the panel face, pixels per metre (a 3 1/8 in dial is about 190 px across). */
const PIXELS_PER_M = 2400;
/** Panel thickness behind the face, m. */
const PANEL_DEPTH_M = 0.03;
/** Pod mounting post: aluminium tube radius, m, and colour. */
const POST_RADIUS_M = 0.015;
const POST_COLOUR = 0xb8bec4;
/**
 * Redraw rates, Hz: in the cockpit 30 (needles move smoothly; redrawing every display frame
 * cost about 0.6 ms of CPU for no visible gain), and a few times a second from outside.
 */
const CLOSE_REDRAW_HZ = 30;
const FAR_REDRAW_HZ = 4;

/**
 * An instrument panel (or pod) in the cockpit: a box in the panel colour whose face carries
 * the gauges, drawn into a canvas and shown as a texture. The face is unlit (like
 * instruments with good contrast in daylight) so it reads the same in any sun angle.
 * Built in body axes, so it is added to the aircraft model's group.
 */
export class Panel {
  readonly object = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private sinceDraw = Infinity;

  constructor(readonly data: PanelData) {
    const [w, h] = data.size_m;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * PIXELS_PER_M);
    this.canvas.height = Math.round(h * PIXELS_PER_M);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, PANEL_DEPTH_M), new THREE.MeshLambertMaterial({ color: data.colour }));
    box.position.z = -PANEL_DEPTH_M / 2 - 0.001;
    box.castShadow = true;
    const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    // The face looks aft (+z) at the pilot; its top leans forward by the tilt.
    const mount = new THREE.Group();
    mount.add(box, faceMesh);
    mount.rotation.x = (-data.tilt_deg * Math.PI) / 180;
    mount.position.set(...data.position_m);
    this.object.add(mount);
    if (data.postTo_m) {
      // A tube from under the pod down to the airframe (open cockpits).
      const top = new THREE.Vector3(data.position_m[0], data.position_m[1] - h / 2, data.position_m[2] - PANEL_DEPTH_M);
      const foot = new THREE.Vector3(...data.postTo_m);
      const len = top.distanceTo(foot);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS_M, POST_RADIUS_M, len, 6), new THREE.MeshLambertMaterial({ color: POST_COLOUR }));
      post.position.copy(top).add(foot).multiplyScalar(0.5);
      post.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      this.object.add(post);
    }
  }

  /** Redraw the gauges: 30 times a second when close (cockpit view), a few times a second otherwise. */
  update(r: InstrumentReadings, dt: number, close: boolean): void {
    this.sinceDraw += dt;
    if (this.sinceDraw < 1 / (close ? CLOSE_REDRAW_HZ : FAR_REDRAW_HZ)) return;
    this.sinceDraw = 0;
    this.draw(r);
  }

  draw(r: InstrumentReadings): void {
    const c = this.ctx;
    const { width, height } = this.canvas;
    c.fillStyle = this.data.colour;
    c.fillRect(0, 0, width, height);
    for (const g of this.data.gauges) {
      const cx = width / 2 + g.at_m[0] * PIXELS_PER_M;
      const cy = height / 2 - g.at_m[1] * PIXELS_PER_M;
      const R = (g.diameter_m / 2) * PIXELS_PER_M;
      // Screw holes at the corners of each instrument's mounting square.
      c.fillStyle = 'rgba(0, 0, 0, 0.35)';
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        c.beginPath();
        c.arc(cx + sx * R * 0.95, cy + sy * R * 0.95, R * 0.05, 0, 2 * Math.PI);
        c.fill();
      }
      drawGauge(c, g, r, cx, cy, R);
    }
    this.texture.needsUpdate = true;
  }
}
