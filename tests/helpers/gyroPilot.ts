import type { Gyroplane } from '../../src/physics/Gyroplane';
import type { PhysicsWorld } from '../../src/physics/PhysicsWorld';
import { mpsToKt } from '../../src/core/units';
import { attitude, fly, TestPilot } from './testPilot';

/** Prerotate on the ground (held in place, engine about 2,700 rpm) until the prerotator stops gaining. */
export function prerotate(world: PhysicsWorld, gy: Gyroplane, seconds = 45) {
  let reached300 = Infinity;
  const pilot = new TestPilot(gy);
  const heading = attitude(gy).heading;
  fly(world, seconds, (t) => {
    gy.pilot.prerotator = 1;
    gy.pilot.throttle = 0.65; // engine around 2,700 rpm: the clutch passes full torque
    gy.pilot.elevator = 0;
    // On the brakes, pedals keeping it straight against the prerotator's torque reaction and
    // any crosswind on the fin; then held still as if chocked (the brakes alone slip at times).
    gy.pilot.brakeLeft = gy.pilot.brakeRight = 1;
    pilot.steerOnGround(heading);
    gy.body.velocity.set(0, gy.body.velocity.y, 0);
    if (reached300 === Infinity && gy.rotor.rpm >= 300) reached300 = t;
  });
  gy.pilot.prerotator = 0;
  gy.pilot.brakeLeft = gy.pilot.brakeRight = 0;
  return { rpm: gy.rotor.rpm, reached300 };
}

/**
 * Gyro take-off (runway 36): release the prerotator, full power with the stick neutral in
 * pitch (the disc flat, least drag) and into any crosswind laterally until 12 kt, then full back stick to load the rotor until the nosewheel lifts,
 * then balance on the mains at 14° nose-up and let it fly off. Returns the ground roll, m.
 */
export function takeOff(world: PhysicsWorld, gy: Gyroplane, centrelineX = gy.body.position.x) {
  const pilot = new TestPilot(gy);
  const z0 = gy.body.position.z;
  let noseUp = false;
  let roll = 0;
  let liftoffKt = 0;
  fly(world, 30, () => {
    gy.pilot.throttle = 1;
    pilot.steerAlongCentreline(0, centrelineX);
    // Crosswind: hold the stick into wind so the disc does not blow over and drag the gyro
    // sideways: lateral stick against any sideways drift (and back towards the centreline).
    const drift = gy.body.velocity.x;
    gy.pilot.aileron = Math.max(-1, Math.min(1, -0.25 * drift - 0.05 * (gy.body.position.x - centrelineX)));
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
