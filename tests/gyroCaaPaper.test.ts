import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import type { Gyroplane } from '../src/physics/Gyroplane';
import { attitude, fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

// Regression checks against CAA Paper 2009/02, "The Aerodynamics of Gyroplanes" (University
// of Glasgow): trim trends and dynamic response measured in flight and simulated (RASCAL) for
// light gyroplanes. Ours is a Bensen-sized single seater with a modern centre-line-thrust
// layout (thrust line within 2 in of the CG, as the paper recommends), so we check the trends
// and the order of magnitude, not the paper's VPM M16 numbers.

const B = AIRCRAFT.bensenB8M;
const deg = 180 / Math.PI;
const mphToKt = (mph: number) => mph * 0.869;
const LONG = 600_000;
/** Typical flight rotor speed to start airborne tests with, rad/s (~360 rpm). */
const FLIGHT_ROTOR = 12 * Math.PI;

/** Head (shaft) tilt aft of the keel normal, degrees, for a stick position. */
const aftTilt = (stick: number) => (stick > 0 ? stick * B.rotor!.headPitchBackRange_deg! : stick * B.rotor!.headPitchRange_deg) + B.rotor!.headNeutralPitch_deg;

/**
 * Level flight at a speed, flown as a gyro pilot does: speed with the stick, height with the
 * throttle, straight with lateral stick (bank free), ball with rudder. Returns averages over
 * a minute (the test pilot's loops keep a little phugoid going, so a snapshot would mislead).
 */
function trim(mph: number) {
  const kt = mphToKt(mph);
  const { world, ac } = makeWorld(B);
  const gy = ac as Gyroplane;
  startInFlight(gy, 600, kt, 0);
  gy.rotor.omega = FLIGHT_ROTOR;
  const pilot = new TestPilot(gy);
  let throttle = 0.5;
  const fly1 = () => {
    pilot.holdSpeedWithPitch(kt);
    pilot.headingTo(0, 0.2);
    throttle = Math.max(0, Math.min(1, throttle + 0.0005 * (0.3 * (600 - gy.body.position.y) - gy.state.verticalSpeed)));
    gy.pilot.throttle = throttle;
  };
  fly(world, 150, fly1);
  const sum = { pitch: 0, tilt: 0, roll: 0, rpm: 0, teeter: 0 };
  let n = 0;
  fly(world, 60, () => {
    fly1();
    const a = attitude(gy);
    sum.pitch += a.pitch * deg;
    sum.tilt += aftTilt(gy.pilot.elevator);
    sum.roll += a.bank * deg;
    sum.rpm += gy.rotor.rpm;
    sum.teeter += gy.rotor.out.teeter * deg;
    n++;
  });
  return { pitch: sum.pitch / n, tilt: sum.tilt / n, roll: sum.roll / n, rpm: sum.rpm / n, teeter: sum.teeter / n };
}

/** Hands-off trim at cruise power (stick released): a steady state with the controls fixed. */
function handsOff() {
  const { world, ac } = makeWorld(B);
  const gy = ac as Gyroplane;
  startInFlight(gy, 800, 52, 0);
  gy.rotor.omega = FLIGHT_ROTOR;
  gy.pilot.throttle = 0.55;
  fly(world, 150, () => {});
  return { world, gy };
}

describe('CAA Paper 2009/02 comparisons', () => {
  it('trim from 30 to 70 mph: nose and rotor tilt come down with speed, left wing low, rotor rpm nearly constant, small teeter', () => {
    const t = [30, 50, 70].map(trim);
    for (const [i, mph] of [30, 50, 70].entries()) {
      console.info(`trim ${mph} mph: pitch ${t[i].pitch.toFixed(1)}°, aft head tilt ${t[i].tilt.toFixed(1)}°, roll ${t[i].roll.toFixed(1)}°, rotor ${t[i].rpm.toFixed(0)} rpm, teeter ${t[i].teeter.toFixed(1)}°`);
    }
    // Paper (VPM M16): pitch about 6° at low speed to 1° at high speed.
    expect(t[0].pitch).toBeGreaterThan(t[2].pitch + 4);
    expect(t[2].pitch).toBeGreaterThan(-3);
    // Speed stability: the rotor tilts forward (stick forward) as speed rises.
    expect(t[0].tilt).toBeGreaterThan(t[1].tilt);
    expect(t[1].tilt).toBeGreaterThan(t[2].tilt);
    // Sits left wing down at all speeds, by a degree or two (propeller torque).
    for (const r of t) {
      expect(r.roll).toBeLessThan(0);
      expect(r.roll).toBeGreaterThan(-4);
    }
    // "Only a slight increase in rotor speed for trim over the speed range."
    const rpms = t.map((r) => r.rpm);
    expect(Math.max(...rpms) / Math.min(...rpms)).toBeLessThan(1.05);
    // Flight-measured teeter in steady flight: about 2.5°, under 5°.
    for (const r of t) expect(r.teeter).toBeLessThan(5);
  }, LONG);

  it('1° of aft rotor tilt held for 5 s pitches the nose well up (the stick commands pitch rate)', () => {
    // Paper Figure 4.2: about 20° nose-up at 40 mph. The nose keeps rising while it is held.
    const { world, gy } = handsOff();
    const pitch0 = attitude(gy).pitch;
    let rise = 0;
    fly(world, 6, (t) => {
      gy.pilot.elevator = t >= 1 ? 1 / B.rotor!.headPitchBackRange_deg! : 0;
      rise = Math.max(rise, (attitude(gy).pitch - pitch0) * deg);
    });
    console.info(`1° aft tilt for 5 s: nose up ${rise.toFixed(1)}°`);
    expect(rise).toBeGreaterThan(6);
    expect(rise).toBeLessThan(35);
  }, LONG);

  it('phugoid with centre-line thrust: a slow speed/attitude oscillation that dies away (stable)', () => {
    const { world, gy } = handsOff();
    const v0 = gy.state.ias;
    const dev: number[] = [];
    const ts: number[] = [];
    fly(world, 90, (t) => {
      gy.pilot.elevator = t >= 1 && t < 2 ? 1 / B.rotor!.headPitchBackRange_deg! : 0; // 1° aft for 1 s
      if (t > 2) {
        dev.push(gy.state.ias - v0);
        ts.push(t);
      }
    });
    // Zero crossings of the airspeed deviation give the half-periods; the largest deviation in
    // each half-cycle gives the decay.
    const crossings: number[] = [];
    const halfPeaks: number[] = [];
    let peak = 0;
    for (let i = 1; i < dev.length; i++) {
      peak = Math.max(peak, Math.abs(dev[i]));
      if (Math.sign(dev[i]) !== Math.sign(dev[i - 1]) && dev[i] !== 0) {
        crossings.push(ts[i]);
        halfPeaks.push(peak);
        peak = 0;
      }
    }
    const period = 2 * ((crossings[3] - crossings[1]) / 2);
    const perCycle = halfPeaks[1] / halfPeaks[3];
    const ln = Math.log(perCycle);
    const zeta = ln / Math.sqrt(4 * Math.PI * Math.PI + ln * ln);
    console.info(`phugoid: period ${period.toFixed(1)} s, damping ratio ${zeta.toFixed(2)} (paper, VPM M16: 25–32 s, near neutral at 40 mph, stable faster)`);
    expect(period).toBeGreaterThan(12);
    expect(period).toBeLessThan(40);
    expect(zeta).toBeGreaterThan(0); // stable: the CG near the thrust line
    expect(zeta).toBeLessThan(0.6); // but only lightly damped, as gyros are
  }, LONG);

  it('a violent push-and-recover manoeuvre drives the teeter towards its limits (paper: 8° in flight)', () => {
    // Paper section 11.3: at 60 mph, a forward stick step (4° shaft tilt), then power chopped
    // and about 6° of aft tilt to recover. The flight-test rotor teetered to 8°, within 11°.
    const { world, gy } = handsOff();
    const stick0 = gy.pilot.elevator;
    const throttle0 = gy.pilot.throttle;
    let maxTeeter = 0;
    let atStop = false;
    fly(world, 15, (t) => {
      gy.pilot.elevator = t < 1 ? stick0 : t < 5 ? stick0 - 4 / B.rotor!.headPitchRange_deg : t < 8 ? stick0 + 6 / B.rotor!.headPitchBackRange_deg! : stick0;
      gy.pilot.throttle = t < 5 ? throttle0 : 0;
      maxTeeter = Math.max(maxTeeter, gy.rotor.out.teeter * deg);
      atStop ||= gy.rotor.out.teeterAtStop;
    });
    console.info(`push-and-recover: peak teeter ${maxTeeter.toFixed(1)}°`);
    expect(maxTeeter).toBeGreaterThan(5);
    expect(atStop).toBe(false);
  }, LONG);
});
