import * as THREE from 'three';

// Placeholder world for Stage 1. Stage 2 replaces the flat ground with terrain and the airfield.
// Axes: +X east, +Y up, +Z south (so north is -Z).

const SKY_COLOUR = 0x87b5e0;
const GROUND_COLOUR = 0x6f8f4a;
const GROUND_SIZE_M = 6000;
const FOG_NEAR_M = 1500;
const FOG_FAR_M = 6000;

export interface WorldScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createScene(aspect: number): WorldScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOUR);
  // Fog in the sky colour hides the ground plane's edge as a hazy horizon.
  scene.fog = new THREE.Fog(SKY_COLOUR, FOG_NEAR_M, FOG_FAR_M);

  // Sky/ground ambient light plus a directional "sun" from the north (southern hemisphere).
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a5a30, 1.2));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
  sun.position.set(300, 600, -400);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE_M, GROUND_SIZE_M),
    new THREE.MeshLambertMaterial({ color: GROUND_COLOUR }),
  );
  ground.rotation.x = -Math.PI / 2; // PlaneGeometry is built in XY; lay it flat in XZ.
  scene.add(ground);

  scene.add(createAxisMarker());

  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 20000);
  camera.position.set(12, 6, 18);
  camera.lookAt(0, 1, 0);

  return { scene, camera };
}

/**
 * A 2 m box with coloured arms showing the world axes, to confirm orientation:
 * red = +X (east), green = +Y (up), blue = +Z (south).
 */
function createAxisMarker(): THREE.Group {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshLambertMaterial({ color: 0xd8d2c0 }),
  );
  box.position.y = 1;
  group.add(box);

  const armLength = 5;
  const arms: Array<[THREE.Vector3, number]> = [
    [new THREE.Vector3(1, 0, 0), 0xd03030],
    [new THREE.Vector3(0, 1, 0), 0x30a030],
    [new THREE.Vector3(0, 0, 1), 0x3050d0],
  ];
  for (const [dir, colour] of arms) {
    group.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 1, 0), armLength, colour, 0.8, 0.4));
  }
  return group;
}
