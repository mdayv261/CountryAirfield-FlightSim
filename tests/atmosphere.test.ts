import { describe, expect, it } from 'vitest';
import { isa } from '../src/physics/atmosphere';

// Reference values from the ICAO standard atmosphere table.
describe('ISA atmosphere', () => {
  const rel = (a: number, b: number) => Math.abs(a / b - 1);

  it('matches the table at sea level', () => {
    const a = isa(0);
    expect(a.temperature).toBeCloseTo(288.15, 6);
    expect(a.pressure).toBeCloseTo(101325, 3);
    expect(a.density).toBeCloseTo(1.225, 3);
    expect(a.speedOfSound).toBeCloseTo(340.29, 1);
  });

  it.each([
    [1000, 281.65, 89874.6, 1.11164],
    [3000, 268.65, 70108.5, 0.909122],
    [5000, 255.65, 54019.9, 0.736116],
    [11000, 216.65, 22632.1, 0.363918],
  ])('matches the table at %i m', (h, T, p, rho) => {
    const a = isa(h);
    expect(a.temperature).toBeCloseTo(T, 6);
    expect(rel(a.pressure, p)).toBeLessThan(2e-4);
    expect(rel(a.density, rho)).toBeLessThan(2e-4);
  });

  it('a hot day thins the air but leaves pressure unchanged', () => {
    const std = isa(15);
    const hot = isa(15, 15);
    expect(hot.pressure).toBe(std.pressure);
    expect(hot.density / std.density).toBeCloseTo(std.temperature / hot.temperature, 9);
  });
});
