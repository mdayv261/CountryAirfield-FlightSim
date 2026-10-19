import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { createScene } from './world/createScene';
import { FpsOverlay } from './ui/FpsOverlay';
import { Keyboard } from './input/keyboard';
import { AIRCRAFT } from './aircraft';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
// Cap pixel ratio at 2: Retina at 3x costs a lot of fill rate for little visible gain.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const { scene, camera } = createScene(window.innerWidth / window.innerHeight);
const overlay = new FpsOverlay(container);

let stepsThisFrame = 0;
const loop = new GameLoop({
  step: () => {
    // Physics goes here from Stage 3. Counting steps proves the 120 Hz rate.
    stepsThisFrame++;
  },
  render: () => {
    renderer.render(scene, camera);
    overlay.frame(stepsThisFrame, loop.paused);
    stepsThisFrame = 0;
  },
});

const keyboard = new Keyboard();
keyboard.onPress('KeyP', () => loop.togglePause());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

console.info('Aircraft data loaded:', Object.values(AIRCRAFT).map((a) => a.name).join(', '));
loop.start();
