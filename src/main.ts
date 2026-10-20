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
import { DecathlonModel } from './aircraft/models/decathlonModel';
import { GyroModel } from './aircraft/models/gyroModel';
import { Gyroplane } from './physics/Gyroplane';
import type { PoweredAircraft } from './physics/PoweredAircraft';
import type { AircraftModel } from './aircraft/models/AircraftModel';
import type { ControlState } from './input/controls';
import { AircraftCamera, CAMERA, type AircraftView } from './ui/AircraftCamera';
import { Instruments } from './cockpit/instruments';
import { Panel } from './cockpit/Panel';
import { Hud } from './ui/Hud';
import { APRON_SPAWN, RUNWAYS, WINDSOCK } from './world/layout';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, START_POSITIONS, type StartPosition } from './core/settings';
import type { AircraftId } from './aircraft';
import { SoundSystem } from './audio/SoundSystem';
import { outsideHearing } from './audio/soundModel';
import { Menu, type MenuChange } from './ui/Menu';

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

// Settings (menu, Esc) persist in browser storage; everything below starts from them.
const settings = loadSettings();
const saveNow = () => saveSettings(settings);

const world = createScene(window.innerWidth / window.innerHeight, settings.timeOfDay);
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
/** Set the wind model from the wind settings (a preset, or custom values). */
const applyWind = () => {
  const w = settings.wind;
  const p = WIND_PRESETS[w.preset];
  if (p) Object.assign(w, { fromDeg: p.fromDeg % 360, speedKt: p.speedKt, gustKt: p.gustKt, turbulence: p.turbulence });
  physics.wind.setSteady(w.fromDeg, w.speedKt);
  physics.wind.setGust(w.gustKt);
  physics.wind.turbulence = w.turbulence;
};
applyWind();
const WIND_STEP_KT = 1;
const GUST_STEP_KT = 1;
const GUST_MAX_KT = 20;
const WIND_STEP_DEG = 10;
const WIND_MAX_KT = 40;
const adjustWind = (dDeg: number, dKt: number) => {
  const w = settings.wind;
  w.fromDeg = (((Math.round(w.fromDeg + dDeg) % 360) + 360) % 360);
  w.speedKt = THREE.MathUtils.clamp(Math.round(w.speedKt + dKt), 0, WIND_MAX_KT);
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

// The aircraft (Tab switches). Spawn points on both runways, both directions (keys 7, 8, 9, 0).
const FLEET: Array<{ aircraft: PoweredAircraft; model: AircraftModel; panel?: Panel }> = [
  (() => {
    const ac = new FixedWingAircraft(AIRCRAFT.airbike103);
    return { aircraft: ac, model: new AirBikeModel(ac) };
  })(),
  (() => {
    const ac = new FixedWingAircraft(AIRCRAFT.decathlon8kcab);
    return { aircraft: ac, model: new DecathlonModel(ac) };
  })(),
  (() => {
    const ac = new Gyroplane(AIRCRAFT.bensenB8M);
    return { aircraft: ac, model: new GyroModel(ac) };
  })(),
];
// Each aircraft's instrument panel rides in its model, in body axes.
for (const f of FLEET) {
  if (!f.aircraft.data.panel) continue;
  f.panel = new Panel(f.aircraft.data.panel);
  f.model.object.add(f.panel.object);
}
const FLEET_IDS: AircraftId[] = ['airbike103', 'decathlon8kcab', 'bensenB8M'];
let fleetIndex = Math.max(0, FLEET_IDS.indexOf(settings.aircraft));
let aircraft = FLEET[fleetIndex].aircraft;
let aircraftModel = FLEET[fleetIndex].model;
scene.add(aircraftModel.object);
physics.add(aircraft);
const hud = new Hud(container, aircraft);
const instruments = new Instruments();
const windAtAircraft = new THREE.Vector3();
const aircraftCam = new AircraftCamera(camera, renderer.domElement, groundAt);
/** Start positions: the apron, or lined up a few metres inside each threshold. */
const SPAWN_INSET_M = 8;
const half = RUNWAYS.length / 2 - SPAWN_INSET_M;
const SPAWNS: Array<{ name: StartPosition; x: number; z: number; heading: number }> = [
  { name: 'apron', x: APRON_SPAWN.x, z: APRON_SPAWN.z, heading: APRON_SPAWN.headingDeg },
  { name: 'gravel 36', x: RUNWAYS.gravel.cx, z: half, heading: 0 },
  { name: 'grass 36', x: RUNWAYS.grass.cx, z: half, heading: 0 },
  { name: 'gravel 18', x: RUNWAYS.gravel.cx, z: -half, heading: 180 },
  { name: 'grass 18', x: RUNWAYS.grass.cx, z: -half, heading: 180 },
];
let spawnIndex = Math.max(0, START_POSITIONS.indexOf(settings.start));
const spawn = (i: number) => {
  spawnIndex = i;
  const s = SPAWNS[i];
  settings.start = s.name;
  aircraft.resetOnGround(s.x, s.z, s.heading, groundAt(s.x, s.z));
  input.keyboardControls.state.throttle = 0;
  aircraftCam.reset();
  instruments.reset();
};
spawn(spawnIndex);
const sound = new SoundSystem();
sound.setAircraft(aircraft.data.sound);
sound.setVolume(settings.sound.volume, settings.sound.muted);
/** Swap to another aircraft at the same spawn point. */
const selectAircraft = (i: number) => {
  physics.remove(aircraft);
  scene.remove(aircraftModel.object);
  fleetIndex = i;
  settings.aircraft = FLEET_IDS[i];
  ({ aircraft, model: aircraftModel } = FLEET[i]);
  physics.add(aircraft);
  scene.add(aircraftModel.object);
  hud.setAircraft(aircraft);
  sound.setAircraft(aircraft.data.sound);
  spawn(spawnIndex);
  if (view === 'flyby' || view === 'tower') aircraftCam.reset();
};
/**
 * Toe brakes. With separate left and right brake inputs (pedals), use them as they are.
 * With a single brake control (B key or joystick trigger), share it out with the rudder:
 * right rudder brakes the right wheel more, left the left, as most simulators do, so a
 * taildragger can still be steered by differential braking without pedals.
 */
function toeBrakes(c: ControlState): [number, number] {
  if (Math.abs(c.brakeLeft - c.brakeRight) > 1e-3) return [c.brakeLeft, c.brakeRight];
  const b = c.brakeLeft;
  return [b * Math.min(1, 1 - c.yaw), b * Math.min(1, 1 + c.yaw)];
}
type View = AircraftView | 'free';
/** View keys 1-5 (outside the free camera, whose own viewpoints use 1-6); V cycles. */
const VIEWS: View[] = ['cockpit', 'chase', 'tower', 'flyby', 'free'];
let view: View = 'chase';
const setView = (v: View) => {
  view = v;
  if (v !== 'free') aircraftCam.view = v;
  else {
    camera.fov = CAMERA.fov.chase;
    camera.updateProjectionMatrix();
  }
  aircraftCam.reset();
};
/** Controls and HUD units from the settings. */
const applyControls = () => {
  input.keyboardEnabled = settings.controls.keyboardFlight;
  input.mouse.enabled = settings.controls.mouseStick;
  input.setAutoRudder(settings.controls.autoRudder);
  syncInputModes();
};
applyControls();
hud.units = settings.units;

// The settings menu (Esc). It pauses the flight while open; keys go to it, not the sim.
const menu = new Menu(
  container,
  settings,
  (what: MenuChange) => {
    if (what === 'aircraft') selectAircraft(Math.max(0, FLEET_IDS.indexOf(settings.aircraft)));
    else if (what === 'start') spawn(Math.max(0, START_POSITIONS.indexOf(settings.start)));
    else if (what === 'wind') applyWind();
    else if (what === 'time') world.setTimeOfDay(settings.timeOfDay);
    else if (what === 'units') hud.units = settings.units;
    else if (what === 'sound') sound.setVolume(settings.sound.volume, settings.sound.muted);
    else if (what === 'controls') applyControls();
    saveNow();
  },
  {
    openControlMapping: () => {
      if (!calibration.visible) calibration.toggle();
    },
    resetDefaults: () => {
      Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
      applyWind();
      world.setTimeOfDay(settings.timeOfDay);
      hud.units = settings.units;
      sound.setVolume(settings.sound.volume, settings.sound.muted);
      applyControls();
      selectAircraft(Math.max(0, FLEET_IDS.indexOf(settings.aircraft)));
      spawn(Math.max(0, START_POSITIONS.indexOf(settings.start)));
      saveNow();
    },
  },
);
keyboard.blocked = () => menu.isOpen;
keyboard.onPress('Escape', () => menu.toggle());
// Browsers only allow sound after a user gesture: start it on the first key press or click.
for (const ev of ['keydown', 'pointerdown'] as const) window.addEventListener(ev, () => sound.unlock());
const toAircraft = new THREE.Vector3();
let lastDistance = 0;

let stepsThisFrame = 0;
let lastFrameMs = performance.now();
const loop = new GameLoop({
  step: (dt) => {
    if (menu.isOpen) return; // the flight waits while the menu is open
    const c = input.controls;
    if (view === 'free') {
      // In the free camera the controls drive the Stage 3 test block.
      Object.assign(block.controls, { throttle: c.throttle, pedals: c.yaw, brakeLeft: c.brakeLeft, brakeRight: c.brakeRight });
    } else {
      aircraft.autoRudderEnabled = input.aids.autoRudder;
      const [brakeLeft, brakeRight] = toeBrakes(c);
      Object.assign(aircraft.pilot, {
        elevator: c.pitch,
        aileron: c.roll,
        rudder: c.yaw,
        throttle: c.throttle,
        brakeLeft,
        brakeRight,
        propLever: c.propLever,
        prerotator: c.prerotator,
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
    else {
      aircraftCam.hat = input.gamepads.hat();
      aircraftCam.update(aircraftModel, dt);
    }
    // One set of instrument readings feeds both the panel gauges and the HUD.
    const readings = instruments.update(aircraft, physics.windAt(aircraft.body.position, windAtAircraft), loop.paused ? 0 : dt);
    FLEET[fleetIndex].panel?.update(readings, dt, view === 'cockpit');
    hud.visible = view !== 'free';
    hud.update(readings);
    // Sound: in the cockpit at full strength; outside, fading with distance and Doppler-shifted.
    toAircraft.subVectors(aircraftModel.object.position, camera.position);
    const distance = toAircraft.length();
    const closing = dt > 0 ? (lastDistance - distance) / dt : 0;
    lastDistance = distance;
    const outside = outsideHearing(distance, view === 'flyby' || view === 'tower' ? closing : 0);
    sound.setPaused(loop.paused || menu.isOpen);
    sound.update(aircraft, view === 'cockpit' ? { inCockpit: true, gain: 1, doppler: 1 } : { inCockpit: false, ...outside });
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
  const gust = w.gustAmplitude > 0 ? `, gusts +${mpsToKt(w.gustAmplitude).toFixed(0)} kt` : ', no gusts';
  const now = mpsToKt(windsockAir.length()).toFixed(0);
  const lines = [`wind preset: ${WIND_PRESETS[settings.wind.preset]?.name ?? 'custom'}${gust}, turbulence ${w.turbulence}, sock ${now} kt`];
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
keyboard.onPress('Tab', () => {
  selectAircraft((fleetIndex + 1) % FLEET.length);
  saveNow();
});
keyboard.onPress('KeyU', () => {
  settings.controls.autoRudder = !settings.controls.autoRudder;
  applyControls();
  saveNow();
});
keyboard.onPress('KeyV', () => setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]));
keyboard.onPress('KeyI', () => (hud.enabled = !hud.enabled));
// Digits pick the aircraft views, except in the free camera, where they keep its viewpoints.
for (let k = 0; k < 6; k++) {
  keyboard.onPress(`Digit${k + 1}`, () => {
    if (view === 'free') freeCam.setView(k);
    else if (k < VIEWS.length) setView(VIEWS[k]);
  });
}
keyboard.onPress('KeyE', () => (aircraft.powerplant.running ? aircraft.powerplant.stop() : aircraft.powerplant.start()));
keyboard.onPress('Backspace', () => spawn(spawnIndex));
// 7 8 9 0: the four thresholds (gravel 36, grass 36, gravel 18, grass 18); the apron is in the menu.
['Digit7', 'Digit8', 'Digit9', 'Digit0'].forEach((code, i) =>
  keyboard.onPress(code, () => {
    spawn(i + 1);
    saveNow();
  }),
);
keyboard.onPress('KeyM', () => measure.mark());
keyboard.onPress('KeyH', () => inspect.toggleHelp());
keyboard.onPress('KeyX', () => (world.axisMarker.visible = !world.axisMarker.visible));
keyboard.onPress('KeyT', throwBlock);
keyboard.onPress('KeyO', () => calibration.toggle());
keyboard.onPress('KeyK', () => {
  settings.controls.keyboardFlight = !settings.controls.keyboardFlight;
  applyControls();
  saveNow();
});
keyboard.onPress('KeyJ', () => {
  settings.controls.mouseStick = !settings.controls.mouseStick;
  applyControls();
  saveNow();
});
keyboard.onPress('KeyN', () => {
  settings.wind.preset = (Math.max(-1, settings.wind.preset) + 1) % WIND_PRESETS.length;
  applyWind();
  saveNow();
});
/** A wind key changed something: now custom wind, applied and saved. */
const windChanged = () => {
  settings.wind.preset = -1;
  applyWind();
  saveNow();
};
const customWind = (dDeg: number, dKt: number) => () => {
  adjustWind(dDeg, dKt);
  windChanged();
};
keyboard.onPress('BracketLeft', customWind(0, -WIND_STEP_KT));
keyboard.onPress('BracketRight', customWind(0, WIND_STEP_KT));
keyboard.onPress('Comma', customWind(-WIND_STEP_DEG, 0));
keyboard.onPress('Period', customWind(WIND_STEP_DEG, 0));
// Gusts (strongest gust above the mean wind) and turbulence level, next to the wind keys.
const adjustGust = (dKt: number) => () => {
  settings.wind.gustKt = THREE.MathUtils.clamp(Math.round(settings.wind.gustKt + dKt), 0, GUST_MAX_KT);
  windChanged();
};
keyboard.onPress('Semicolon', adjustGust(-GUST_STEP_KT));
keyboard.onPress('Quote', adjustGust(GUST_STEP_KT));
keyboard.onPress('Slash', () => {
  settings.wind.turbulence = physics.wind.nextTurbulence();
  windChanged();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
// Keep keys like arrows and PageUp from scrolling the page while flying.
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'Tab', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
});

// Handy for inspection from the browser console.
Object.assign(window, {
  sim: {
    scene, camera, heightfield, freeCam, measure, renderer, physics, block, input, throwBlock, spawn, setView, selectAircraft,
    settings, menu, sound,
    get aircraft() {
      return aircraft;
    },
  },
});

console.info('Aircraft data loaded:', Object.values(AIRCRAFT).map((a) => a.name).join(', '));
loop.start();
