import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { AeroModel, type AeroInput } from '../src/physics/aero';
import { interp } from '../src/physics/table';

const data = AIRCRAFT.airbike103;
const g = data.geometry;
const model = new AeroModel(data.aero!, g.wingArea_m2!, g.span_m!, g.chord_m!);
const deg = Math.PI / 180;

/** Air velocity in body axes for an airspeed, angle of attack and sideslip. */
function flow(V: number, alphaDeg: number, betaDeg = 0): THREE.Vector3 {
  const a = alphaDeg * deg;
  const b = betaDeg * deg;
  return new THREE.Vector3(V * Math.sin(b), -V * Math.cos(b) * Math.sin(a), -V * Math.cos(b) * Math.cos(a));
}

function input(over: Partial<AeroInput> = {}): AeroInput {
  return {
    airVelocityBody: flow(20, 4),
    omegaBody: new THREE.Vector3(),
    density: 1.225,
    controls: { elevator: 0, aileron: 0, rudder: 0 },
    heightAboveGround: 500,
    slipstreamPressure: 0,
    ...over,
  };
}

describe('tables', () => {
  it('interpolates linearly and holds the end values', () => {
    expect(interp([0, 1, 2], [0, 10, 0], 0.25)).toBeCloseTo(2.5, 12);
    expect(interp([0, 1, 2], [0, 10, 0], 1.5)).toBeCloseTo(5, 12);
    expect(interp([0, 1, 2], [0, 10, 0], -5)).toBe(0);
    expect(interp([0, 1, 2], [0, 10, 0], 9)).toBe(0);
  });
});

describe('aerodynamics', () => {
  it('measures angle of attack and sideslip from the airflow', () => {
    const o = model.compute(input({ airVelocityBody: flow(20, 6, -3) }));
    expect(o.alpha / deg).toBeCloseTo(6, 6);
    expect(o.beta / deg).toBeCloseTo(-3, 6);
    expect(o.airspeed).toBeCloseTo(20, 9);
  });

  it('has a lift slope near 2πAR/(2 + √(AR²+4)) and a stall break', () => {
    const slope = (model.CLtable(8 * deg) - model.CLtable(0)) / (8 * deg);
    const AR = g.span_m! ** 2 / g.wingArea_m2!;
    expect(slope / ((2 * Math.PI * AR) / (2 + Math.sqrt(AR * AR + 4)))).toBeCloseTo(1, 1);
    const CLmax = Math.max(...data.aero!.CL);
    expect(model.CLtable(25 * deg)).toBeLessThan(0.8 * CLmax); // lift collapses past the stall
    expect(model.CDtable(40 * deg)).toBeGreaterThan(5 * model.CDtable(0));
  });

  it('lift is up and drag is back in straight flight', () => {
    const o = model.compute(input({ airVelocityBody: flow(20, 0) }));
    expect(o.force.y).toBeGreaterThan(0);
    expect(o.force.z).toBeGreaterThan(0); // drag pushes aft (+z)
    expect(Math.abs(o.force.x)).toBeLessThan(1e-9);
    expect(Math.abs(o.moment.y)).toBeLessThan(1e-9);
    expect(Math.abs(o.moment.z)).toBeLessThan(1e-9);
    const q = 0.5 * 1.225 * 400;
    expect(o.force.y).toBeCloseTo(o.CL * q * g.wingArea_m2!, 6);
  });

  it('is statically stable: pitching up makes a nose-down moment, sideslip yaws into wind', () => {
    const lo = model.compute(input({ airVelocityBody: flow(20, 2) })).moment.x;
    const hi = model.compute(input({ airVelocityBody: flow(20, 8) })).moment.x;
    expect(hi).toBeLessThan(lo);
    // Wind from the right (β > 0): nose yaws right (moment about −y), right wing rises (dihedral).
    const s = model.compute(input({ airVelocityBody: flow(20, 4, 5) }));
    expect(-s.moment.y).toBeGreaterThan(0);
    expect(-s.moment.z).toBeLessThan(0);
  });

  it('damps rotation in roll, pitch and yaw', () => {
    const roll = model.compute(input({ omegaBody: new THREE.Vector3(0, 0, -1) })); // rolling right
    expect(-roll.moment.z).toBeLessThan(0);
    const base = model.compute(input()).moment.x;
    const pitch = model.compute(input({ omegaBody: new THREE.Vector3(1, 0, 0) })); // pitching up
    expect(pitch.moment.x).toBeLessThan(base);
    const yaw = model.compute(input({ omegaBody: new THREE.Vector3(0, -1, 0) })); // yawing right
    expect(-yaw.moment.y).toBeLessThan(0);
  });

  it('controls move the aircraft the way the pilot expects', () => {
    const base = model.compute(input());
    const back = model.compute(input({ controls: { elevator: 1, aileron: 0, rudder: 0 } }));
    expect(back.moment.x).toBeGreaterThan(base.moment.x); // stick back: nose up
    const right = model.compute(input({ controls: { elevator: 0, aileron: 1, rudder: 0 } }));
    expect(-right.moment.z).toBeGreaterThan(0); // stick right: roll right
    expect(-right.moment.y).toBeLessThan(0); // with adverse yaw to the left
    const pedal = model.compute(input({ controls: { elevator: 0, aileron: 0, rudder: 1 } }));
    expect(-pedal.moment.y).toBeGreaterThan(0); // right pedal: nose right
  });

  it('slipstream makes the elevator work at walking pace', () => {
    const slow = { airVelocityBody: flow(3, 10), controls: { elevator: 1, aileron: 0, rudder: 0 } };
    const without = model.compute(input(slow)).moment.x - model.compute(input({ ...slow, controls: { elevator: 0, aileron: 0, rudder: 0 } })).moment.x;
    const withProp =
      model.compute(input({ ...slow, slipstreamPressure: 300 })).moment.x -
      model.compute(input({ ...slow, slipstreamPressure: 300, controls: { elevator: 0, aileron: 0, rudder: 0 } })).moment.x;
    expect(withProp).toBeGreaterThan(10 * without);
  });

  it('ground effect cuts induced drag near the ground', () => {
    const high = model.compute(input({ airVelocityBody: flow(15, 10) }));
    const low = model.compute(input({ airVelocityBody: flow(15, 10), heightAboveGround: 1 }));
    // At 1 m (h/b ≈ 0.12) McCormick's factor removes about a fifth of the induced drag.
    const induced = high.CL ** 2 / (Math.PI * data.aero!.oswald * (g.span_m! ** 2 / g.wingArea_m2!));
    expect(high.CD - low.CD).toBeGreaterThan(0.15 * induced);
    expect(model.groundEffect(1000)).toBeCloseTo(1, 4);
  });

  it('produces no force with no airflow', () => {
    const o = model.compute(input({ airVelocityBody: new THREE.Vector3() }));
    expect(o.force.length()).toBe(0);
    expect(o.moment.length()).toBe(0);
  });
});
