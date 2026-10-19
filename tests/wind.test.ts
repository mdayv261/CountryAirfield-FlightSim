import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHYSICS_DT } from '../src/core/constants';
import { ktToMps, mpsToKt } from '../src/core/units';
import type { Ground } from '../src/physics/gear';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { TestBlock } from '../src/physics/testBlock';
import { WindModel } from '../src/physics/wind';
import { TURBULENCE_SIGMA_MPS, WIND_PRESETS } from '../src/physics/windPresets';

const dt = PHYSICS_DT;
const flat: Ground = { heightAt: () => 0, surfaceAt: () => 'grass' };

describe('steady wind', () => {
  it('blows from the set direction at the set speed at 10 m', () => {
    const w = new WindModel();
    w.setSteady(270, 20); // westerly: air moves east (+X)
    const v = w.steadyAt(10);
    expect(v.x).toBeCloseTo(ktToMps(20), 9);
    expect(v.z).toBeCloseTo(0, 9);
    expect(w.reported.fromDeg).toBeCloseTo(270, 9);
    expect(w.reported.speedKt).toBeCloseTo(20, 9);
  });

  it('is lighter near the ground and stronger aloft (boundary layer shear)', () => {
    expect(WindModel.shearFactor(10)).toBeCloseTo(1, 12);
    expect(WindModel.shearFactor(2)).toBeLessThan(0.82);
    expect(WindModel.shearFactor(100)).toBeGreaterThan(1.3);
    expect(WindModel.shearFactor(5000)).toBe(WindModel.shearFactor(300)); // constant above the layer
  });

  it('splits into headwind and crosswind for a runway', () => {
    const w = new WindModel();
    w.applyPreset(WIND_PRESETS.find((p) => p.name.startsWith('Crosswind from east'))!);
    const c36 = w.components(360);
    expect(mpsToKt(c36.cross)).toBeCloseTo(10, 9); // from the right on runway 36
    expect(c36.head).toBeCloseTo(0, 9);
    w.applyPreset(WIND_PRESETS.find((p) => p.name.startsWith('Light northerly'))!);
    expect(mpsToKt(w.components(360).head)).toBeCloseTo(8, 9);
    expect(mpsToKt(w.components(180).head)).toBeCloseTo(-8, 9); // tailwind on 18
  });
});

describe('drift in wind', () => {
  it('a draggy body released aloft ends up moving with the air mass', () => {
    const world = new PhysicsWorld(flat);
    world.wind.setSteady(270, 20);
    const block = new TestBlock();
    block.throw(new THREE.Vector3(0, 3000, 0), new THREE.Vector3(), new THREE.Vector3());
    world.add(block);
    for (let i = 0; i < 30 / dt; i++) world.step(dt);
    const air = world.wind.steadyAt(block.body.position.y);
    expect(block.body.position.y).toBeGreaterThan(300); // still above the shear layer
    expect(block.body.velocity.x / air.x).toBeCloseTo(1, 2);
    expect(Math.abs(block.body.velocity.z)).toBeLessThan(0.01);
    expect(block.body.position.x).toBeGreaterThan(0.8 * air.x * 30); // has drifted downwind
  });
});

describe('gusts and turbulence', () => {
  it('gusts come and go, never exceeding the gust amplitude', () => {
    const w = new WindModel(7);
    w.setSteady(180, 12);
    w.gustAmplitude = ktToMps(6);
    let maxF = 0;
    let calm = 0;
    for (let i = 0; i < 300 / dt; i++) {
      w.update(dt);
      const { factor } = w.gustState();
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
      maxF = Math.max(maxF, factor);
      if (factor === 0) calm++;
      const speed = w.velocityAt(10).length();
      expect(speed).toBeLessThanOrEqual(ktToMps(18) + 1e-9);
      expect(speed).toBeGreaterThanOrEqual(ktToMps(12) - 1e-9);
    }
    expect(maxF).toBeGreaterThan(0.6);
    expect(calm).toBeGreaterThan(0); // lulls between gusts
  });

  it('is repeatable for the same seed', () => {
    const run = () => {
      const w = new WindModel(42);
      w.applyPreset(WIND_PRESETS[5]);
      for (let i = 0; i < 1000; i++) w.update(dt, 30);
      return w.velocityAt(20).toArray();
    };
    expect(run()).toEqual(run());
  });

  it('turbulence has zero mean and the RMS of its level', () => {
    const w = new WindModel(3);
    w.turbulence = 'moderate';
    const n = Math.round(4000 / dt);
    let sum = 0;
    let sumSq = 0;
    let sumW = 0;
    for (let i = 0; i < n; i++) {
      w.update(dt, 40);
      sum += w.turb.x;
      sumSq += w.turb.x ** 2;
      sumW += w.turb.z ** 2;
    }
    const sigma = TURBULENCE_SIGMA_MPS.moderate;
    expect(Math.abs(sum / n)).toBeLessThan(0.1 * sigma);
    expect(Math.sqrt(sumSq / n) / sigma).toBeGreaterThan(0.9);
    expect(Math.sqrt(sumSq / n) / sigma).toBeLessThan(1.1);
    expect(Math.sqrt(sumW / n)).toBeLessThan(Math.sqrt(sumSq / n)); // vertical is weaker
  });

  it('calm preset is truly calm', () => {
    const w = new WindModel();
    w.applyPreset(WIND_PRESETS[0]);
    for (let i = 0; i < 1000; i++) w.update(dt);
    expect(w.velocityAt(10).length()).toBe(0);
  });
});
