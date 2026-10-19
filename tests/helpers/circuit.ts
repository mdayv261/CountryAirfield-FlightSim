import * as THREE from 'three';
import { ktToMps, mpsToKt } from '../../src/core/units';
import type { FixedWingAircraft } from '../../src/physics/FixedWingAircraft';
import { surfaceAt, type SurfaceType } from '../../src/physics/surfaces';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { attitude, dt, fly, Pid, TestPilot } from './testPilot';

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v));
/** Throttle held through the flare, then closed at touchdown. */
const FLARE_THROTTLE = 0.2;
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface RunwayEnd {
  /** Centreline x of the runway, m. */
  x: number;
  /** +1 = runway 36 (take off northwards from z = +300), −1 = runway 18. */
  dir: 1 | -1;
}

export interface CircuitSpeeds {
  climbKt: number;
  circuitKt: number;
  approachKt: number;
  /** Pitch attitude to hold for the three-point lift-off and touchdown, rad. */
  threePointPitch: number;
}

export interface CircuitResult {
  phase: string;
  maxHeight: number;
  touchdownSink: number;
  /** Indicated airspeed at touchdown, kt. */
  touchdownKt: number;
  touchdownLoad: number;
  landingRoll: number;
  stopped: boolean;
  stopPoint: THREE.Vector3;
  stopSurface: SurfaceType;
  wingOrNoseStrike: boolean;
  log: string[];
}

/**
 * Fly a standard left-hand circuit at 500 ft and land, as an instructor would demonstrate:
 * three-point take-off, climb straight ahead, crosswind, downwind, base and a 5° final,
 * power to hold the glide path and pitch to hold speed, flare over the threshold, then a
 * three-point touchdown and roll-out with the stick held back.
 */
export function flyCircuit(world: PhysicsWorld, ac: FixedWingAircraft, rw: RunwayEnd, s: CircuitSpeeds): CircuitResult {
  const pilot = new TestPilot(ac);
  const north = rw.dir; // +1: heading north is "upwind"
  const runwayHeading = rw.dir === 1 ? 0 : Math.PI;
  const thresholdZ = 300 * rw.dir; // start of the take-off run / landing threshold
  const aimZ = thresholdZ - 60 * rw.dir; // touchdown aim point, 60 m in
  const circuitHeight = 152; // 500 ft
  const side = -1 * rw.dir; // left-hand circuit: downwind is on the left (west of 36, east of 18)
  const downwindX = rw.x + side * 600;
  const turnZ = { crosswind: -700 * north, base: 1100 * north };
  const glide = Math.tan((5 * Math.PI) / 180);
  const throttleForPath = new Pid(0.08, 0.03, 0, 1, 0.3);

  // Line up and settle.
  ac.placeOnGround(rw.x, thresholdZ - 3 * rw.dir, rw.dir === 1 ? 0 : 180, 0, 0.02);
  ac.powerplant.start();
  ac.pilot.throttle = 0;
  fly(world, 3, () => {});

  const res: CircuitResult = {
    phase: 'takeoff', maxHeight: 0, touchdownSink: 0, touchdownKt: 0, touchdownLoad: 0, landingRoll: 0,
    stopped: false, stopPoint: new THREE.Vector3(), stopSurface: 'grass', wingOrNoseStrike: false, log: [],
  };
  let touchdownZ = 0;
  let flarePitch = 0;
  let lastLog = -10;
  const along = () => (thresholdZ - ac.body.position.z) * rw.dir; // distance flown past the take-off threshold
  /**
   * Follow a straight leg: a heading and a point on the line. Cross-track error is how far
   * we are left of the line (turn right to correct); the heading correction grows with it.
   */
  const followLeg = (heading: number, px: number, pz: number) => {
    const p = ac.body.position;
    const leftOf = -((p.x - px) * Math.cos(heading) + (p.z - pz) * Math.sin(heading));
    pilot.headingTo(wrapPi(heading + clamp(0.004 * leftOf, -0.6, 0.6)), 0.4);
  };
  /** Climb at best-rate speed and full power to circuit height, then level at circuit power. */
  const climbOrCruise = () => {
    if (ac.body.position.y < circuitHeight - 15) {
      ac.pilot.throttle = 1;
      pilot.holdSpeedWithPitch(s.climbKt);
    } else {
      pilot.holdAltitude(circuitHeight, 1.5);
      pilot.holdPower(0.65);
    }
  };
  const legs = {
    upwind: runwayHeading,
    crosswind: runwayHeading - Math.PI / 2, // left turns throughout
    downwind: runwayHeading + Math.PI,
    base: runwayHeading + Math.PI / 2,
  };

  fly(world, 480, (t) => {
    const p = ac.body.position;
    const h = p.y;
    res.maxHeight = Math.max(res.maxHeight, h);
    const skidHit = ac.gear.states.some((st, i) => st.inContact && ac.gear.legs[i].kind === 'skid');
    if (skidHit) res.wingOrNoseStrike = true;
    if (t - lastLog >= 10) {
      lastLog = t;
      res.log.push(`${t.toFixed(0)}s ${res.phase} x${p.x.toFixed(0)} z${p.z.toFixed(0)} h${h.toFixed(0)} ${mpsToKt(ac.state.ias).toFixed(0)}kt`);
    }
    switch (res.phase) {
      case 'takeoff':
        ac.pilot.throttle = 1;
        pilot.pitchTo(s.threePointPitch);
        pilot.steerOnGround(runwayHeading);
        if (h > 3) res.phase = 'climb';
        break;
      case 'climb':
        ac.pilot.throttle = 1;
        pilot.holdSpeedWithPitch(s.climbKt);
        followLeg(legs.upwind, rw.x, 0);
        if (along() > 1000) res.phase = 'crosswind';
        break;
      case 'crosswind':
        climbOrCruise();
        followLeg(legs.crosswind, rw.x, turnZ.crosswind);
        if (Math.abs(p.x - downwindX) < 80) res.phase = 'downwind';
        break;
      case 'downwind':
        climbOrCruise();
        followLeg(legs.downwind, downwindX, 0);
        if ((p.z - turnZ.base) * north > -80) res.phase = 'base';
        break;
      case 'base':
      case 'final': {
        const dist = (p.z - aimZ) * north; // distance to go to the aim point
        const pathH = clamp(glide * dist, 0, circuitHeight);
        pilot.holdSpeedWithPitch(s.approachKt);
        // Power for the glide path: height error plus a sink-rate term towards the path's sink rate.
        const pathSink = -glide * ktToMps(s.approachKt);
        ac.pilot.throttle = throttleForPath.update(0.15 * (pathH - h) + (pathSink - ac.state.verticalSpeed));
        if (res.phase === 'base') {
          followLeg(legs.base, 0, turnZ.base);
          if (Math.abs(p.x - rw.x) < 80) res.phase = 'final';
        } else {
          followLeg(legs.upwind, rw.x, 0);
          if (h < 3.5) {
            res.phase = 'flare';
            flarePitch = attitude(ac).pitch;
          }
        }
        break;
      }
      case 'flare':
        // Hold off: keep a little power (a draggy ultralight bleeds speed fast), and keep
        // easing the nose up to hold a gentle sink until the three-point attitude settles it.
        ac.pilot.throttle = FLARE_THROTTLE;
        {
          // Target sink shrinks as the wheels near the ground: about 1.2 m/s at 4 m, 0.2 m/s at the bottom.
          const targetSink = 0.15 + 0.3 * Math.max(0, h - 1);
          flarePitch = Math.min(s.threePointPitch, flarePitch + dt * 1.5 * Math.max(0, -ac.state.verticalSpeed - targetSink));
        }
        pilot.pitchTo(flarePitch);
        pilot.bankTo(0);
        if (ac.gear.states.some((st, i) => st.inContact && ac.gear.legs[i].kind === 'wheel')) {
          res.touchdownSink = -ac.state.verticalSpeed;
          res.touchdownKt = mpsToKt(ac.state.ias);
          touchdownZ = p.z;
          res.phase = 'rollout';
        }
        break;
      case 'rollout':
        ac.pilot.throttle = 0;
        ac.pilot.elevator = 1; // stick fully back: tail firmly down
        pilot.steerOnGround(runwayHeading);
        res.touchdownLoad = Math.max(res.touchdownLoad, ac.state.loadFactor);
        if (ac.body.velocity.length() < 0.3) {
          res.stopped = true;
          res.landingRoll = Math.abs(p.z - touchdownZ);
          res.stopPoint.copy(p);
          res.stopSurface = surfaceAt(p.x, p.z);
          return true;
        }
        break;
    }
  });
  return res;
}
