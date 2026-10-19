import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { createScene } from './world/createScene';
import { FpsOverlay } from './ui/FpsOverlay';
import { InspectOverlay } from './ui/InspectOverlay';
import { FreeFlyCamera } from './ui/FreeFlyCamera';
import { MeasureTool } from './ui/measure';
import { Keyboard } from './input/keyboard';
import { AIRCRAFT } from './aircraft';
import { metFromWind, windFromMet } from './world/wind';

const container = document.getElementById('app')!;

// Logarithmic depth keeps precision from 0.1 m (cockpit) out to clouds tens of km away,
// so distant runway surfaces and terrain don't flicker against each other.
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
// Cap pixel ratio at 2: Retina at 3x costs a lot of fill rate for little visible gain.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const world = createScene(window.innerWidth / window.innerHeight);
const { scene, camera, heightfield, windsock } = world;
const groundAt = (x: number, z: number) => heightfield.heightAt(x, z);
const overlay = new FpsOverlay(container);
const inspect = new InspectOverlay(container);
const keyboard = new Keyboard();
const freeCam = new FreeFlyCamera(camera, keyboard, renderer.domElement, groundAt);
freeCam.setView(0);
const measure = new MeasureTool(camera, groundAt);
scene.add(measure.object);

// Inspection wind (Stage 3 replaces this with the full wind model). Met convention: from.
const WIND_STEP_KT = 1;
const WIND_STEP_DEG = 10;
const WIND_MAX_KT = 40;
const windMet = { fromDeg: 230, speedKt: 8 };
let wind = windFromMet(windMet.fromDeg, windMet.speedKt);
const setWind = (dDeg: number, dKt: number) => {
  windMet.fromDeg = (windMet.fromDeg + dDeg + 360) % 360;
  windMet.speedKt = THREE.MathUtils.clamp(windMet.speedKt + dKt, 0, WIND_MAX_KT);
  wind = windFromMet(windMet.fromDeg, windMet.speedKt);
};

let stepsThisFrame = 0;
let lastFrameMs = performance.now();
const loop = new GameLoop({
  step: () => {
    // Physics goes here from Stage 3. Counting steps proves the 120 Hz rate.
    stepsThisFrame++;
  },
  render: () => {
    // Inspection camera and scenery animate in real time, independent of physics pause.
    const now = performance.now();
    const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
    lastFrameMs = now;
    freeCam.update(dt);
    windsock.update(wind, now / 1000);

    renderer.render(scene, camera);
    overlay.frame(stepsThisFrame, loop.paused);
    stepsThisFrame = 0;
    const met = metFromWind(wind);
    inspect.update({
      ...camera.position,
      headingDeg: freeCam.headingDeg,
      speedMps: freeCam.currentSpeed,
      windFromDeg: met.fromDeg,
      windKt: met.speedKt,
      measure: measure.points,
      measureDistance: measure.distance,
    });
  },
});

keyboard.onPress('KeyP', () => loop.togglePause());
keyboard.onPress('KeyM', () => measure.mark());
keyboard.onPress('KeyH', () => inspect.toggleHelp());
keyboard.onPress('KeyX', () => (world.axisMarker.visible = !world.axisMarker.visible));
keyboard.onPress('BracketLeft', () => setWind(0, -WIND_STEP_KT));
keyboard.onPress('BracketRight', () => setWind(0, WIND_STEP_KT));
keyboard.onPress('Comma', () => setWind(-WIND_STEP_DEG, 0));
keyboard.onPress('Period', () => setWind(WIND_STEP_DEG, 0));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Handy for inspection from the browser console.
Object.assign(window, { sim: { scene, camera, heightfield, freeCam, measure, renderer, setWind } });

console.info('Aircraft data loaded:', Object.values(AIRCRAFT).map((a) => a.name).join(', '));
loop.start();
