import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { PHYSICS_DT } from '../src/core/constants';
import { ktToMps } from '../src/core/units';
import { Rotor, type RotorInput } from '../src/physics/rotor';

const B = AIRCRAFT.bensenB8M;
const newRotor = () => new Rotor(B.rotor!, B.geometry.rotorDiameter_m!, B.geometry.rotorBlades!);
const input = (over: Partial<RotorInput> = {}): RotorInput => ({
  airVelocityBody: new THREE.Vector3(0, 0, -ktToMps(50)),
  omegaBody: new THREE.Vector3(),
  density: 1.225,
  stickPitch: 0,
  stickRoll: 0,
  prerotator: 0,
  engineRunning: true,
  ...over,
});

describe('gyroplane rotor', () => {
  it('a stopped rotor makes no force', () => {
    const r = newRotor();
    const o = r.step(PHYSICS_DT, input());
    expect(o.thrust).toBe(0);
  });

  it('thrust grows with rotor speed and with air coming up through the disc', () => {
    const r = newRotor();
    expect(r.thrustCoefficient(0.03, 0.2)).toBeGreaterThan(r.thrustCoefficient(0.01, 0.2));
    r.omega = 30;
    const slow = r.step(PHYSICS_DT, input()).thrust;
    const r2 = newRotor();
    r2.omega = 40;
    const fast = r2.step(PHYSICS_DT, input()).thrust;
    expect(fast).toBeGreaterThan(slow * 1.3);
  });

  it('autorotates: up-flow speeds the rotor up, blade drag alone slows it down', () => {
    const r = newRotor();
    // Strong up-flow: the driving term wins.
    expect(r.torqueCoefficient(0.05, 0.2, r.thrustCoefficient(0.05, 0.2))).toBeLessThan(0);
    // No up-flow: only profile drag, which slows the rotor.
    expect(r.torqueCoefficient(0, 0.2, r.thrustCoefficient(0, 0.2))).toBeGreaterThan(0);
  });

  it('settles at a steady rotor speed in steady flight (the autorotation balance)', () => {
    const r = newRotor();
    r.omega = 20; // well below flight rpm
    // Level flight at 50 kt, keel 1.5° nose-down to the airflow: with the head's neutral tilt
    // (plus blowback) the disc meets the air at a few degrees, as in cruise.
    const a = (-(2.5 - 0.95 + B.rotor!.headNeutralPitch_deg) * Math.PI) / 180;
    const v = new THREE.Vector3(0, -ktToMps(50) * Math.sin(a), -ktToMps(50) * Math.cos(a));
    for (let i = 0; i < 60 / PHYSICS_DT; i++) r.step(PHYSICS_DT, input({ airVelocityBody: v }));
    const settled = r.rpm;
    for (let i = 0; i < 5 / PHYSICS_DT; i++) r.step(PHYSICS_DT, input({ airVelocityBody: v }));
    expect(Math.abs(r.rpm - settled)).toBeLessThan(1);
    expect(settled).toBeGreaterThan(250);
    expect(settled).toBeLessThan(450);
  });

  it('back stick tilts the thrust back (nose-up moment about the CG); right stick rolls right', () => {
    const r = newRotor();
    r.omega = 38;
    const neutral = r.step(PHYSICS_DT, input()).moment.clone();
    const r2 = newRotor();
    r2.omega = 38;
    const back = r2.step(PHYSICS_DT, input({ stickPitch: 1 })).moment.clone();
    expect(back.x).toBeGreaterThan(neutral.x); // nose up
    const r3 = newRotor();
    r3.omega = 38;
    const right = r3.step(PHYSICS_DT, input({ stickRoll: 1 })).moment.clone();
    expect(-right.z).toBeGreaterThan(-neutral.z); // roll right
  });

  it('the prerotator spins it up on the ground only to its limit', () => {
    const r = newRotor();
    const still = input({ airVelocityBody: new THREE.Vector3(), prerotator: 1 });
    for (let i = 0; i < 60 / PHYSICS_DT; i++) r.step(PHYSICS_DT, still);
    expect(r.rpm).toBeGreaterThan(300);
    expect(r.rpm).toBeLessThanOrEqual(B.rotor!.prerotator.maxRpm + 1);
    // Engine off: no drive.
    const r2 = newRotor();
    for (let i = 0; i < 10 / PHYSICS_DT; i++) r2.step(PHYSICS_DT, { ...still, engineRunning: false });
    expect(r2.rpm).toBe(0);
  });

  it('ground effect reduces the induced flow near the ground', () => {
    const free = newRotor();
    const low = newRotor();
    free.omega = low.omega = 36;
    const slow = new THREE.Vector3(0, -1, -ktToMps(20));
    let tFree = 0;
    let tLow = 0;
    for (let i = 0; i < 120; i++) {
      tFree = free.step(PHYSICS_DT, input({ airVelocityBody: slow })).thrust;
      tLow = low.step(PHYSICS_DT, input({ airVelocityBody: slow, hubHeight: 2 })).thrust;
    }
    expect(tLow).toBeGreaterThan(tFree);
  });

  it('dynamic inflow: a sudden up-gust meets the old wake, so thrust overshoots then settles', () => {
    const r = newRotor();
    r.omega = 38;
    // Vertical flow only (no forward speed, so no blowback to confuse the picture).
    const still = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 2 / PHYSICS_DT; i++) {
      r.omega = 38;
      r.step(PHYSICS_DT, input({ airVelocityBody: still }));
    }
    // Air suddenly coming up through the disc at 3 m/s (the aircraft sinking into it).
    const gust = new THREE.Vector3(0, -3, 0);
    // Rotor speed held fixed, so only the wake's response is seen.
    const first = r.step(PHYSICS_DT, input({ airVelocityBody: gust })).thrust;
    let later = 0;
    for (let i = 0; i < 0.3 / PHYSICS_DT; i++) {
      r.omega = 38;
      later = r.step(PHYSICS_DT, input({ airVelocityBody: gust })).thrust;
    }
    // The wake's induced flow takes a few hundredths of a second to build: thrust peaks first.
    expect(first).toBeGreaterThan(later * 1.02);
  });

  it('teeter: the disc flaps a little relative to the shaft in cruise, and stops at the teeter stop', () => {
    const r = newRotor();
    r.omega = 38;
    let o = r.step(PHYSICS_DT, input());
    for (let i = 0; i < 1 / PHYSICS_DT; i++) o = r.step(PHYSICS_DT, input());
    const deg = 180 / Math.PI;
    expect(o.teeter * deg).toBeGreaterThan(0.5); // blowback at 50 kt
    expect(o.teeter * deg).toBeLessThan(5); // small in steady flight (CAA Paper 2009/02: ~2.5°)
    expect(o.teeterAtStop).toBe(false);
    // A violent roll rate leaves the disc far behind the shaft: held at the stop.
    o = r.step(PHYSICS_DT, input({ omegaBody: new THREE.Vector3(0, 0, -4) }));
    expect(o.teeterAtStop).toBe(true);
    expect(o.teeter * deg).toBeCloseTo(B.rotor!.teeterStop_deg!, 6);
  });
});
