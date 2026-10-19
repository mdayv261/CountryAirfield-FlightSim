import type { Gyroplane } from '../../src/physics/Gyroplane';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { mpsToKt } from '../../src/core/units';
import { fly, TestPilot } from './testPilot';

/** Prerotate on the ground (held in place, engine about 2,700 rpm) until the prerotator stops gaining. */
export function prerotate(world: PhysicsWorld, gy: Gyroplane, seconds = 45) {
  let reached300 = Infinity;
  fly(world, seconds, (t) => {
    gy.pilot.prerotator = 1;
    gy.pilot.throttle = 0.65; // engine around 2,700 rpm: the clutch passes full torque
    gy.pilot.elevator = 0;
    // Hold the aircraft still (a pilot holds it with their feet on the ground / chocks).
    gy.body.velocity.set(0, gy.body.velocity.y, 0);
    if (reached300 === Infinity && gy.rotor.rpm >= 300) reached300 = t;
  });
  gy.pilot.prerotator = 0;
  return { rpm: gy.rotor.rpm, reached300 };
}

/**
 * Gyro take-off: release the prerotator, full power with the stick neutral (the disc flat,
 * least drag) until 12 kt, then full back stick to load the rotor until the nosewheel lifts,
 * then balance on the mains at 14° nose-up and let it fly off. Returns the ground roll, m.
 */
export function takeOff(world: PhysicsWorld, gy: Gyroplane) {
  const pilot = new TestPilot(gy);
  const z0 = gy.body.position.z;
  let noseUp = false;
  let roll = 0;
  let liftoffKt = 0;
  fly(world, 30, () => {
    gy.pilot.throttle = 1;
    pilot.steerOnGround(0);
    if (!gy.gear.states[0].inContact) noseUp = true;
    if (!noseUp) gy.pilot.elevator = mpsToKt(gy.state.ias) < 12 ? 0 : 1;
    else pilot.pitchTo((14 * Math.PI) / 180);
    if (gy.gear.states.every((s) => !s.inContact)) {
      roll = z0 - gy.body.position.z;
      liftoffKt = mpsToKt(gy.state.ias);
      return true;
    }
  });
  return { roll, liftoffKt };
}
