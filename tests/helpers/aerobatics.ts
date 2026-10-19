import * as THREE from 'three';
import { ktToMps, mpsToKt } from '../../src/core/units';
import type { PoweredAircraft } from '../../src/physics/PoweredAircraft';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { dt, fly, Pid } from './testPilot';

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
const deg = Math.PI / 180;

/** Body axes in world space, and the rates in the pilot's sense. */
function axes(ac: PoweredAircraft) {
  const b = ac.body;
  const fwd = b.toWorld(new THREE.Vector3(0, 0, -1));
  const right = b.toWorld(new THREE.Vector3(1, 0, 0));
  const up = b.toWorld(new THREE.Vector3(0, 1, 0));
  return {
    fwd,
    right,
    up,
    pitch: Math.asin(clamp(fwd.y)),
    heading: Math.atan2(fwd.x, -fwd.z),
    p: -b.angularVelocity.z,
    q: b.angularVelocity.x,
    r: -b.angularVelocity.y,
  };
}

/** Result of a manoeuvre: whatever was measured, plus the common safety checks. */
export interface ManoeuvreResult {
  completed: boolean;
  duration: number;
  maxG: number;
  minG: number;
  minIasKt: number;
  altitudeChange: number;
  headingChangeDeg: number;
  overstressed: boolean;
  engineAlways: boolean;
  log: string[];
  [k: string]: unknown;
}

/** Start straight and level at a speed (IAS-ish), full power, heading north. */
export function setUp(ac: PoweredAircraft, height: number, kt: number) {
  ac.body.reset(new THREE.Vector3(0, height, 0));
  ac.body.velocity.set(0, 0, -ktToMps(kt));
  ac.powerplant.start();
  ac.powerplant.omega = ((0.95 * ac.data.propulsion.ratedRpm) / 60) * 2 * Math.PI;
  ac.pilot.propLever = 1;
  ac.resetGMonitor();
}

/** Fly level at a speed to settle before a manoeuvre (simple autopilot, throttle by speed). */
export function settle(world: PhysicsWorld, ac: PoweredAircraft, kt: number, seconds = 8) {
  const h0 = ac.body.position.y;
  const speed = new Pid(0.08, 0.04, 0, 1, 0.8);
  const pitch = new Pid(3, 1.5);
  fly(world, seconds, () => {
    const a = axes(ac);
    const vs = ac.state.verticalSpeed;
    ac.pilot.elevator = pitch.update(clamp(0.02 * (h0 - ac.body.position.y) - 0.03 * vs, -0.2, 0.2) - a.pitch + 0.03, -0.8 * a.q);
    ac.pilot.aileron = clamp(3 * Math.asin(clamp(a.right.y)) - 0.5 * a.p);
    ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
    ac.pilot.throttle = speed.update(kt - mpsToKt(ac.state.ias));
  });
  ac.resetGMonitor();
}

/** Track common measurements while a manoeuvre runs. */
function tracker(ac: PoweredAircraft) {
  const r: ManoeuvreResult = {
    completed: false, duration: 0, maxG: -Infinity, minG: Infinity, minIasKt: Infinity,
    altitudeChange: 0, headingChangeDeg: 0, overstressed: false, engineAlways: true, log: [],
  };
  const h0 = ac.body.position.y;
  const psi0 = axes(ac).heading;
  let lastLog = -1;
  return {
    r,
    sample(t: number, label = '') {
      r.maxG = Math.max(r.maxG, ac.gMonitor.g);
      r.minG = Math.min(r.minG, ac.gMonitor.g);
      r.minIasKt = Math.min(r.minIasKt, mpsToKt(ac.state.ias));
      if (!ac.powerplant.running || ac.powerplant.out.fuelStarved) r.engineAlways = false;
      if (t - lastLog >= 0.5) {
        lastLog = t;
        const a = axes(ac);
        r.log.push(`${t.toFixed(1)}s ${label} ias${mpsToKt(ac.state.ias).toFixed(0)} pitch${(a.pitch / deg).toFixed(0)} g${ac.gMonitor.g.toFixed(1)} h${ac.body.position.y.toFixed(0)} a${(ac.state.alpha / deg).toFixed(0)} r${(a.r / deg).toFixed(0)}`);
      }
    },
    finish(t: number) {
      r.duration = t;
      r.altitudeChange = ac.body.position.y - h0;
      const d = axes(ac).heading - psi0;
      r.headingChangeDeg = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) / deg;
      r.overstressed = ac.gMonitor.overstressed;
      return r;
    },
  };
}

/** Keep the wings level about the longitudinal axis whatever the pitch (right wing horizontal). */
function wingsLevel(ac: PoweredAircraft, inverted = false) {
  const a = axes(ac);
  const err = Math.asin(clamp(a.right.y)) * (inverted ? -1 : 1);
  ac.pilot.aileron = clamp(3 * err - 0.5 * a.p);
}

/**
 * Pull towards a target G, limited so the wing never asks for more than it can give: the
 * G target is capped by speed (load factor available ∝ IAS²), and back pressure is relaxed
 * whenever the wing gets within 4° of its stalling angle, as a pilot feels the buffet.
 */
function pullG(ac: PoweredAircraft, loop: Pid, targetG: number, vsKt: number) {
  const available = 0.9 * (mpsToKt(ac.state.ias) / vsKt) ** 2;
  const command = loop.update(Math.min(targetG, available) - ac.gMonitor.g);
  const aero = ac.data.aero!;
  const alphaStall = (aero.alpha_deg[aero.CL.indexOf(Math.max(...aero.CL))] * Math.PI) / 180;
  const margin = alphaStall - 4 * deg - ac.state.alpha;
  ac.pilot.elevator = margin < 0 ? Math.min(command, 4 * margin) : command;
}

/** Inside loop: pull through 360° of pitch at up to `pullG` g, wings level, full power. */
export function loop(world: PhysicsWorld, ac: PoweredAircraft, vsKt: number, targetG = 4) {
  const tr = tracker(ac);
  const gLoop = new Pid(0.25, 0.6, -0.3, 1, 0.3);
  let pitched = 0;
  const t = fly(world, 40, (time) => {
    const a = axes(ac);
    ac.pilot.throttle = 1;
    pullG(ac, gLoop, targetG, vsKt);
    wingsLevel(ac, Math.abs(pitched) > Math.PI / 2 && Math.abs(pitched) < 1.5 * Math.PI);
    ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
    pitched += a.q * dt;
    tr.sample(time, 'loop');
    if (pitched >= 2 * Math.PI - 0.05) {
      tr.r.completed = true;
      return true;
    }
  });
  return tr.finish(t);
}

/** Aileron roll: nose up 15°, full aileron to the right through 360°, then level the wings. */
export function aileronRoll(world: PhysicsWorld, ac: PoweredAircraft) {
  const tr = tracker(ac);
  const pitchLoop = new Pid(3, 0.5);
  let phase: 'raise' | 'roll' | 'stop' = 'raise';
  let rolled = 0;
  let rollTime = 0;
  const t = fly(world, 20, (time) => {
    const a = axes(ac);
    ac.pilot.throttle = 1;
    ac.pilot.rudder = 0;
    if (phase === 'raise') {
      ac.pilot.elevator = pitchLoop.update(15 * deg - a.pitch, -0.6 * a.q);
      wingsLevel(ac);
      if (a.pitch > 14 * deg) phase = 'roll';
    } else if (phase === 'roll') {
      ac.pilot.aileron = 1;
      ac.pilot.elevator = 0.05; // a touch of back pressure, then let it roll
      rolled += a.p * dt;
      rollTime += dt;
      if (rolled >= 2 * Math.PI - 0.15) phase = 'stop';
    } else {
      wingsLevel(ac);
      ac.pilot.elevator = pitchLoop.update(0 - a.pitch, -0.6 * a.q);
      if (Math.abs(a.p) < 5 * deg && Math.abs(a.right.y) < 0.05) {
        tr.r.completed = true;
        return true;
      }
    }
    tr.sample(time, phase);
  });
  const r = tr.finish(t);
  r.rollTime = rollTime;
  return r;
}

/**
 * Stall turn (hammerhead): pull to the vertical, hold it as the speed decays, then full
 * rudder to cartwheel the nose through 180°, and pull out of the resulting dive.
 */
export function stallTurn(
  world: PhysicsWorld,
  ac: PoweredAircraft,
  vsKt: number,
  rudderAtKt = 60,
  /** Yaw still to go (rad) when opposite rudder starts checking the rotation, and when the power comes off. */
  brakeAt = 2.4,
  powerOffAt = 0.1,
) {
  const tr = tracker(ac);
  const gLoop = new Pid(0.25, 0.6, -0.3, 1, 0.3);
  const pitchLoop = new Pid(4, 1);
  let phase: 'pull' | 'vertical' | 'pivot' | 'dive' | 'pullout' = 'pull';
  let minForward = Infinity;
  let yawed = 0; // body yaw angle turned in the pivot (left positive), rad
  let verticalTime = 0;
  const t = fly(world, 40, (time) => {
    const a = axes(ac);
    // Forward airspeed along the nose: negative would mean sliding backwards (a tail slide).
    const vb = ac.body.toBody(ac.body.velocity.clone());
    if (phase === 'vertical' || phase === 'pivot') minForward = Math.min(minForward, -vb.z);
    switch (phase) {
      case 'pull':
        ac.pilot.throttle = 1;
        pullG(ac, gLoop, 4, vsKt);
        wingsLevel(ac);
        ac.pilot.rudder = 0;
        if (a.pitch > 85 * deg) phase = 'vertical';
        break;
      case 'vertical':
        ac.pilot.elevator = pitchLoop.update(88 * deg - a.pitch, -0.5 * a.q);
        ac.pilot.aileron = clamp(-0.6 * a.p);
        ac.pilot.rudder = clamp(-0.3 * a.r);
        verticalTime += dt;
        // Establish a true vertical line first, then rudder as the speed decays.
        if (verticalTime > 0.5 && mpsToKt(ac.state.ias) < rudderAtKt) phase = 'pivot';
        break;
      case 'pivot': {
        // Full left rudder (helped by the torque of a clockwise prop), power on to keep the
        // slipstream on the rudder; then check the rotation with opposite rudder so it stops
        // with the nose straight down, after 180° of yaw.
        yawed += -a.r * dt;
        const remaining = Math.PI - yawed;
        const wantedRate = -Math.min(100 * deg, 2.0 * remaining); // left yaw is negative r
        ac.pilot.rudder = remaining > brakeAt ? -1 : clamp(2.0 * (wantedRate - a.r));
        ac.pilot.throttle = remaining > powerOffAt ? 1 : 0;
        ac.pilot.aileron = clamp(-0.8 * a.p); // stop it rolling
        // Forward stick against the propeller's gyroscopic pitch-up, keeping it in the vertical plane.
        ac.pilot.elevator = clamp(-3.0 * a.q);
        if (remaining < 0.15 && Math.abs(a.r) < 25 * deg) phase = 'dive';
        break;
      }
      case 'dive':
        ac.pilot.rudder = clamp(-0.4 * a.r);
        ac.pilot.throttle = 0;
        ac.pilot.aileron = clamp(-0.8 * a.p);
        ac.pilot.elevator = 0;
        if (mpsToKt(ac.state.ias) > vsKt * 1.5) phase = 'pullout';
        break;
      case 'pullout':
        // Power back on once the nose comes up through the horizon.
        ac.pilot.throttle = a.pitch > -10 * deg ? 1 : 0;
        pullG(ac, gLoop, 3.5, vsKt);
        wingsLevel(ac);
        ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
        if (a.pitch > 0 && ac.state.verticalSpeed > -1) {
          tr.r.completed = true;
          return true;
        }
        break;
    }
    tr.sample(time, phase);
  });
  const r = tr.finish(t);
  r.minForwardSpeed = minForward;
  r.pivotDeg = yawed / deg;
  return r;
}

/**
 * Spin to the left: idle, slow to the stall wings level, then full back stick and full left
 * rudder. Let it wind up for `turns`, then recover the standard way (PARE): power idle,
 * ailerons neutral, full opposite rudder, stick forward until the rotation stops, then
 * centralise the rudder and pull out of the dive.
 */
export function spin(world: PhysicsWorld, ac: PoweredAircraft, vsKt: number, turns = 2) {
  const tr = tracker(ac);
  const speedLoop = new Pid(0.04, 0.012, -0.35, 0.45);
  const pitchLoop = new Pid(3, 1.5);
  const gLoop = new Pid(0.25, 0.6, -0.3, 1, 0.3);
  const alphaStall = (ac.data.aero!.alpha_deg[ac.data.aero!.CL.indexOf(Math.max(...ac.data.aero!.CL))] * Math.PI) / 180;
  let phase: 'slow' | 'spin' | 'recover' | 'dive' | 'pullout' = 'slow';
  let yawed = 0;
  let spinTime = 0;
  let spinRateSum = 0;
  let spinAlphaSum = 0;
  let n = 0;
  let recoverYaw = 0;
  let hRecover = 0;
  const t = fly(world, 90, (time) => {
    const a = axes(ac);
    // Rotation about the vertical (world up): what counts turns in a spin.
    const yawRateWorld = ac.body.toWorld(ac.body.angularVelocity.clone()).y;
    ac.pilot.throttle = 0;
    switch (phase) {
      case 'slow': {
        const err = mpsToKt(ac.state.ias) - (vsKt - 5);
        ac.pilot.elevator = pitchLoop.update(speedLoop.update(err) - a.pitch, -0.8 * a.q);
        wingsLevel(ac);
        ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
        if (ac.state.alpha > alphaStall) phase = 'spin';
        break;
      }
      case 'spin':
        ac.pilot.elevator = 1;
        ac.pilot.rudder = -1;
        ac.pilot.aileron = 0;
        yawed += yawRateWorld * dt;
        if (Math.abs(yawed) > 2 * Math.PI * 0.5) {
          spinTime += dt;
          spinRateSum += Math.abs(yawRateWorld);
          spinAlphaSum += ac.state.alpha;
          n++;
        }
        if (Math.abs(yawed) >= 2 * Math.PI * turns) {
          phase = 'recover';
          hRecover = ac.body.position.y;
        }
        break;
      case 'recover':
        ac.pilot.rudder = 1; // full opposite rudder
        ac.pilot.aileron = 0;
        ac.pilot.elevator = -0.3; // stick briskly forward of neutral
        recoverYaw += Math.abs(yawRateWorld) * dt;
        if (Math.abs(yawRateWorld) < 15 * deg) phase = 'dive';
        break;
      case 'dive':
        ac.pilot.rudder = 0;
        ac.pilot.elevator = 0;
        wingsLevel(ac);
        if (mpsToKt(ac.state.ias) > vsKt * 1.3) phase = 'pullout';
        break;
      case 'pullout':
        ac.pilot.throttle = a.pitch > -10 * deg ? 1 : 0;
        pullG(ac, gLoop, 3.5, vsKt);
        wingsLevel(ac);
        ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
        if (a.pitch > 0) {
          tr.r.completed = true;
          return true;
        }
        break;
    }
    tr.sample(time, phase);
  });
  const r = tr.finish(t);
  r.spinRateDegS = n ? spinRateSum / n / deg : 0;
  r.spinAlphaDeg = n ? spinAlphaSum / n / deg : 0;
  r.spinTime = spinTime;
  r.recoveryTurns = recoverYaw / (2 * Math.PI);
  r.recoveryHeightLoss = hRecover - ac.body.position.y;
  return r;
}

/**
 * Half-roll to inverted, then hold altitude upside down for `seconds` at full power.
 * Upside down the stick works the other way round: push to raise the nose.
 */
export function invertedFlight(world: PhysicsWorld, ac: PoweredAircraft, seconds = 20) {
  const tr = tracker(ac);
  const h0 = ac.body.position.y;
  const pitchLoop = new Pid(3, 1.5);
  const vsLoop = new Pid(0.05, 0.03, -0.3, 0.3);
  let phase: 'roll' | 'inverted' = 'roll';
  let rolled = 0;
  let invertedTime = 0;
  let worstHeightError = 0;
  let minPower = Infinity;
  const t = fly(world, seconds + 10, (time) => {
    const a = axes(ac);
    ac.pilot.throttle = 1;
    ac.pilot.rudder = clamp(3 * ac.state.beta - 0.3 * a.r);
    if (phase === 'roll') {
      ac.pilot.aileron = 1;
      ac.pilot.elevator = 0.1;
      rolled += a.p * dt;
      if (rolled >= Math.PI - 0.2) phase = 'inverted';
    } else {
      wingsLevel(ac, true);
      const vsCmd = clamp(0.3 * (h0 - ac.body.position.y), -2, 2);
      const pitchCmd = vsLoop.update(vsCmd - ac.state.verticalSpeed);
      ac.pilot.elevator = -pitchLoop.update(pitchCmd - a.pitch, 0.8 * a.q);
      invertedTime += dt;
      if (invertedTime > 5) {
        worstHeightError = Math.max(worstHeightError, Math.abs(ac.body.position.y - h0));
        minPower = Math.min(minPower, ac.powerplant.out.enginePower / ac.data.propulsion.ratedPowerW);
      }
      if (invertedTime >= seconds) {
        tr.r.completed = true;
        return true;
      }
    }
    tr.sample(time, phase);
  });
  const r = tr.finish(t);
  r.worstHeightError = worstHeightError;
  r.minPowerFraction = minPower;
  r.upsideDown = axes(ac).up.y < -0.9;
  r.oilPressure = ac.powerplant.out.oilPressure;
  return r;
}
