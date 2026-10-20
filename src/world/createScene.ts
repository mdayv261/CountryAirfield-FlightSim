import * as THREE from 'three';
import { createAirfield } from './airfield';
import { createBuildings, towerRoofTop, type Footprint } from './buildings';
import { createClouds } from './clouds';
import { SKY, TOWER } from './layout';
import { createSky, sunDirection } from './sky';
import { sunLight, sunPosition } from './sun';
import { createDamWater, createSkirt, createTerrainMesh, Heightfield } from './terrain';
import { createVegetation, generateTrees } from './vegetation';
import { Windsock } from './windsock';

// Builds the whole world: terrain, airfield, buildings, trees, sky and clouds.
// Axes: +X east, +Y up, +Z south (so north is -Z). Field level is y = 0.

export interface WorldScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Ground heights matching the rendered terrain (for the camera now, gear contact later). */
  heightfield: Heightfield;
  windsock: Windsock;
  footprints: Footprint[];
  axisMarker: THREE.Object3D;
  /** Move the sun to a time of day (hours, local solar time): light, shadows and sky glow. */
  setTimeOfDay(hour: number): void;
}

export function createScene(aspect: number, hour: number): WorldScene {
  const scene = new THREE.Scene();
  const horizon = new THREE.Color(SKY.horizon);
  scene.background = horizon;
  // Fog in the horizon colour blends distant ground into the sky's horizon band.
  scene.fog = new THREE.Fog(horizon, SKY.fogNear, SKY.fogFar);
  const sky = createSky(hour);
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(SKY.hemiSky, SKY.hemiGround, SKY.hemiIntensity);
  scene.add(hemi);
  const sun = createSun();
  scene.add(sun);
  const setTimeOfDay = (h: number) => {
    placeSun(sun, h);
    (sky.material as THREE.ShaderMaterial).uniforms.sunDir.value.copy(sunDirection(h));
    const light = sunLight(sunPosition(h).elevationDeg);
    sun.color.copy(light.colour);
    sun.intensity = light.intensity;
    hemi.intensity = SKY.hemiIntensity * light.hemiFactor;
  };
  setTimeOfDay(hour);

  const heightfield = new Heightfield();
  scene.add(createTerrainMesh(heightfield), createSkirt(), createDamWater());
  scene.add(createAirfield());

  const { mesh: buildings, footprints } = createBuildings();
  scene.add(buildings);
  // Windsock mast on the tower roof, at the north-west corner so the sock clears the roof edge.
  const inset = TOWER.size / 2 - 0.4;
  const windsock = new Windsock(towerRoofTop().add(new THREE.Vector3(-inset, 0, -inset)));
  scene.add(windsock.object);

  scene.add(createVegetation(generateTrees((x, z) => heightfield.heightAt(x, z))));
  scene.add(createClouds());

  const axisMarker = createAxisMarker();
  axisMarker.visible = false; // sits on the runway centre; toggle with X
  scene.add(axisMarker);

  const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 40000);
  return { scene, camera, heightfield, windsock, footprints, axisMarker, setTimeOfDay };
}

/** Directional sun from the northern sky, casting shadows over the airfield area. */
function createSun(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(SKY.sunColour, SKY.sunIntensity);
  const r = SKY.shadowHalfSize;
  sun.castShadow = true;
  sun.shadow.mapSize.set(SKY.shadowMapSize, SKY.shadowMapSize);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 4 * r });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.3;
  sun.add(sun.target); // keep the target in the scene graph so its matrix updates
  return sun;
}

/** Put the sun light up-sun of the shadowed area, aimed at its centre. */
function placeSun(sun: THREE.DirectionalLight, hour: number): void {
  const centre = new THREE.Vector3(...SKY.shadowCentre);
  sun.position.copy(centre).addScaledVector(sunDirection(hour), 2 * SKY.shadowHalfSize);
  sun.target.position.copy(centre).sub(sun.position); // target is a child of the light
}

/**
 * A 2 m box with coloured arms showing the world axes, to confirm orientation:
 * red = +X (east), green = +Y (up), blue = +Z (south).
 */
function createAxisMarker(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'axis-marker';
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
