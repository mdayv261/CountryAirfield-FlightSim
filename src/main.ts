import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { createScene } from './world/createScene';
import { FpsOverlay } from './ui/FpsOverlay';
import { InspectOverlay } from './ui/InspectOverlay';
import { FreeFlyCamera } from './ui/FreeFlyCamera';
import { MeasureTool } from './ui/measure';
import { CalibrationScreen } from './ui/CalibrationScreen';
import { Keyboard } from './input/keyboard';
import { InputManager } from './input/InputManager';
import { AIRCRAFT } from './aircraft';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { surfaceAt } from './physics/surfaces';
import { TestBlock } from './physics/testBlock';
import { WIND_PRESETS } from './physics/windPresets';
import { TestBlockMesh } from './world/testBlockMesh';
import { mpsToKt } from './core/units';
import { FixedWingAircraft } from './physics/FixedWingAircraft';
import { AirBikeModel } from './aircraft/models/airbike103Model';
import { AircraftCamera, type AircraftView } from './ui/AircraftCamera';
import { Hud } from './ui/Hud';
import { RUNWAYS } from './world/layout';
import { WINDSOCK } from './world/layout';

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

// Physics: ground, atmosphere and wind, stepped at the fixed 120 Hz rate.
const physics = new PhysicsWorld({ heightAt: groundAt, surfaceAt });
const DEFAULT_PRESET = 1; // light northerly: a gentle headwind on runway 36 for first flights
let presetIndex = DEFAULT_PRESET;
physics.wind.applyPreset(WIND_PRESETS[presetIndex]);
const WIND_STEP_KT = 1;
const WIND_STEP_DEG = 10;
const WIND_MAX_KT = 40;
const adjustWind = (dDeg: number, dKt: number) => {
  const r = physics.wind.reported;
  physics.wind.setSteady(r.fromDeg + dDeg, THREE.MathUtils.clamp(Math.round(r.speedKt + dKt), 0, WIND_MAX_KT));
};
const windsockAir = new THREE.Vector3();
const windsockTop = windsock.object.position.clone().add(new THREE.Vector3(0, WINDSOCK.mastHeight, 0));

// Input: keyboard, mouse stick and joysticks/pedals merged into one control state.
const input = new InputManager(keyboard);
const calibration = new CalibrationScreen(container, input);
const syncInputModes = () => {
  freeCam.arrowLook = !input.keyboardEnabled;
  freeCam.mouseLook = !input.mouse.enabled;
};

// Stage 3 test block: thrown from the camera with T; drivable with throttle/pedals/brakes.
const block = new TestBlock();
const blockMesh = new TestBlockMesh(block);
const THROW = { ahead: 4, speed: 10, lift: 3, spin: 1.5 };
const throwBlock = () => {
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const from = camera.position.clone().addScaledVector(fwd, THROW.ahead);
  from.y = Math.max(from.y, groundAt(from.x, from.z) + 1.5);
  const v = fwd.multiplyScalar(THROW.speed).add(new THREE.Vector3(0, THROW.lift, 0));
  const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(THROW.spin);
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-fwd.x, -fwd.z));
  block.throw(from, v, spin, heading);
  physics.add(block);
  if (!blockMesh.object.parent) scene.add(blockMesh.object);
};

// The Air-Bike 103. Spawn points on both runways, both directions (keys 7, 8, 9, 0).
const aircraft = new FixedWingAircraft(AIRCRAFT.airbike103);
const aircraftModel = new AirBikeModel(aircraft);
scene.add(aircraftModel.object);
physics.add(aircraft);
const hud = new Hud(container, aircraft);
const aircraftCam = new AircraftCamera(camera, renderer.domElement);
/** Lined up a few metres inside each threshold. */
const SPAWN_INSET_M = 8;
const half = RUNWAYS.length / 2 - SPAWN_INSET_M;
const SPAWNS = [
  { name: 'gravel 36', x: RUNWAYS.gravel.cx, z: half, heading: 0 },
  { name: 'grass 36', x: RUNWAYS.grass.cx, z: half, heading: 0 },
  { name: 'gravel 18', x: RUNWAYS.gravel.cx, z: -half, heading: 180 },
  { name: 'grass 18', x: RUNWAYS.grass.cx, z: -half, heading: 180 },
];
let spawnIndex = 0;
const spawn = (i: number) => {
  spawnIndex = i;
  const s = SPAWNS[i];
  aircraft.resetOnGround(s.x, s.z, s.heading, groundAt(s.x, s.z));
  input.keyboardControls.state.throttle = 0;
  aircraftCam.reset();
};
spawn(0);
type View = AircraftView | 'free';
const VIEWS: View[] = ['chase', 'cockpit', 'free'];
let view: View = 'chase';
const setView = (v: View) => {
  view = v;
  if (v !== 'free') aircraftCam.view = v;
  aircraftCam.reset();
};
// Keyboard flight keys on from the start; arrows fly rather than look.
input.keyboardEnabled = true;
syncInputModes();

let stepsThisFrame = 0;
let lastFrameMs = performance.now();
const loop = new GameLoop({
  step: (dt) => {
    const c = input.controls;
    if (view === 'free') {
      // In the free camera the controls drive the Stage 3 test block.
      Object.assign(block.controls, { throttle: c.throttle, pedals: c.yaw, brakeLeft: c.brakeLeft, brakeRight: c.brakeRight });
    } else {
      Object.assign(aircraft.pilot, {
        elevator: c.pitch,
        aileron: c.roll,
        rudder: c.yaw,
        throttle: c.throttle,
        brakeLeft: c.brakeLeft,
        brakeRight: c.brakeRight,
      });
      Object.assign(block.controls, { throttle: 0, pedals: 0, brakeLeft: 0, brakeRight: 0 });
    }
    physics.step(dt);
    stepsThisFrame++;
  },
  render: (alpha) => {
    // Camera, input and overlays run in real time, independent of physics pause.
    const now = performance.now();
    const dt = Math.min((now - lastFrameMs) / 1000, 0.1);
    lastFrameMs = now;
    input.update(dt);
    calibration.update();
    aircraftModel.update(alpha, loop.paused ? 0 : dt);
    if (view === 'free') freeCam.update(dt);
    else aircraftCam.update(aircraft, aircraftModel.object, dt);
    hud.visible = view !== 'free';
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraftModel.object.quaternion);
    hud.update(((Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI + 360) % 360);
    // The windsock feels the same wind as everything else, at its mast-top height.
    windsock.update(physics.windAt(windsockTop, windsockAir), now / 1000);
    if (blockMesh.object.parent) blockMesh.update(alpha);

    renderer.render(scene, camera);
    overlay.frame(stepsThisFrame, loop.paused);
    stepsThisFrame = 0;
    inspect.update({
      ...camera.position,
      headingDeg: freeCam.headingDeg,
      speedMps: freeCam.currentSpeed,
      windFromDeg: physics.wind.reported.fromDeg,
      windKt: physics.wind.reported.speedKt,
      extra: statusLines(),
      measure: measure.points,
      measureDistance: measure.distance,
    });
  },
});

function statusLines(): string[] {
  const w = physics.wind;
  const gust = w.gustAmplitude > 0 ? ` gusts +${mpsToKt(w.gustAmplitude).toFixed(0)} kt` : '';
  const now = mpsToKt(windsockAir.length()).toFixed(0);
  const lines = [`wind preset: ${WIND_PRESETS[presetIndex]?.name ?? 'custom'}${gust}, turbulence ${w.turbulence}, sock ${now} kt`];
  const c = input.controls;
  const s = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
  const src = [...new Set(Object.values(input.source))].join('/');
  const modes = `${input.keyboardEnabled ? 'KBD ' : ''}${input.mouse.enabled ? 'MOUSE ' : ''}`;
  lines.push(
    `controls ${modes}pitch ${s(c.pitch)} roll ${s(c.roll)} yaw ${s(c.yaw)} thr ${(c.throttle * 100).toFixed(0)}% brk ${c.brakeLeft.toFixed(1)}/${c.brakeRight.toFixed(1)} [${src}]`,
  );
  const ac = aircraft.state;
  lines.push(
    `${aircraft.data.name} (${SPAWNS[spawnIndex].name}) view ${view}: ${mpsToKt(ac.ias).toFixed(0)} kt, ${aircraft.powerplant.out.engineRpm.toFixed(0)} rpm, fuel ${aircraft.fuelL.toFixed(1)} L`,
  );
  if (blockMesh.object.parent) {
    const wheels = block.gear.states.slice(0, 3);
    const down = wheels.filter((st) => st.inContact).length;
    const surf = wheels.find((st) => st.surface)?.surface ?? 'air';
    lines.push(
      `test block ${mpsToKt(block.body.velocity.length()).toFixed(1)} kt, ${down}/3 wheels down on ${surf}${block.isSettled() ? ', at rest' : ''}${block.isOnItsGear() ? ', on its gear' : ''}`,
    );
  }
  return lines;
}

keyboard.onPress('KeyP', () => loop.togglePause());
keyboard.onPress('KeyV', () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]));
keyboard.onPress('KeyE', () => (aircraft.powerplant.running ? aircraft.powerplant.stop() : aircraft.powerplant.start()));
keyboard.onPress('Backspace', () => spawn(spawnIndex));
['Digit7', 'Digit8', 'Digit9', 'Digit0'].forEach((code, i) => keyboard.onPress(code, () => spawn(i)));
keyboard.onPress('KeyM', () => measure.mark());
keyboard.onPress('KeyH', () => inspect.toggleHelp());
keyboard.onPress('KeyX', () => (world.axisMarker.visible = !world.axisMarker.visible));
keyboard.onPress('KeyT', throwBlock);
keyboard.onPress('KeyO', () => calibration.toggle());
keyboard.onPress('KeyK', () => {
  input.keyboardEnabled = !input.keyboardEnabled;
  syncInputModes();
});
keyboard.onPress('KeyJ', () => {
  input.mouse.enabled = !input.mouse.enabled;
  syncInputModes();
});
keyboard.onPress('KeyN', () => {
  presetIndex = (presetIndex + 1) % WIND_PRESETS.length;
  physics.wind.applyPreset(WIND_PRESETS[presetIndex]);
});
const customWind = (dDeg: number, dKt: number) => () => {
  adjustWind(dDeg, dKt);
  presetIndex = -1;
};
keyboard.onPress('BracketLeft', customWind(0, -WIND_STEP_KT));
keyboard.onPress('BracketRight', customWind(0, WIND_STEP_KT));
keyboard.onPress('Comma', customWind(-WIND_STEP_DEG, 0));
keyboard.onPress('Period', customWind(WIND_STEP_DEG, 0));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
// Keep keys like arrows and PageUp from scrolling the page while flying.
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Space'].includes(e.code)) e.preventDefault();
});

// Handy for inspection from the browser console.
Object.assign(window, { sim: { scene, camera, heightfield, freeCam, measure, renderer, physics, block, input, throwBlock, aircraft, spawn, setView } });

console.info('Aircraft data loaded:', Object.values(AIRCRAFT).map((a) => a.name).join(', '));
loop.start();
