import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { AircraftDataError, validateAircraftData } from '../src/aircraft/schema';
import { fpmToMps, hpToW, ktToMps } from '../src/core/units';

// The data files store SI values converted from the CLAUDE.md figures.
// These tests check that the conversion was done right (to 0.1 %).
const close = (actual: number | undefined, expected: number) =>
  expect(actual! / expected).toBeCloseTo(1, 3);

describe('aircraft data files', () => {
  it('loads and validates all three aircraft', () => {
    expect(Object.keys(AIRCRAFT).sort()).toEqual(['airbike103', 'bensenB8M', 'decathlon8kcab']);
    for (const [key, a] of Object.entries(AIRCRAFT)) expect(a.id).toBe(key);
  });

  it('Air-Bike 103 matches CLAUDE.md', () => {
    const a = AIRCRAFT.airbike103;
    expect(a.type).toBe('fixedWing');
    expect(a.propulsion.layout).toBe('tractor');
    expect(a.propulsion.ratedPowerW).toBe(20600); // Hirth official 20.6 kW (28 HP DIN)
    expect(a.propulsion.ratedRpm).toBe(6500);
    expect(a.geometry.span_m).toBe(8.15);
    expect(a.geometry.wingArea_m2).toBe(11.15);
    close(a.geometry.chord_m, 54 * 0.0254);
    expect(a.mass).toMatchObject({ emptyKg: 112, maxKg: 227, fuelCapacityL: 19 });
    close(a.targets.stall_mps, ktToMps(24));
    close(a.targets.cruise_mps, ktToMps(47));
    close(a.limits.vne_mps, ktToMps(69));
    close(a.targets.climb_mps, fpmToMps(475));
    expect(a.targets).toMatchObject({ takeoffRoll_m: 76, landingRoll_m: 61 });
    expect(a.gear).toMatchObject({ layout: 'taildragger', brakes: false });
  });

  it('Super Decathlon matches CLAUDE.md', () => {
    const a = AIRCRAFT.decathlon8kcab;
    close(a.propulsion.ratedPowerW, hpToW(180));
    expect(a.propulsion.ratedRpm).toBe(2700);
    close(a.propulsion.propDiameter_m, 74 * 0.0254);
    expect(a.propulsion.constantSpeedProp).toBe(true);
    expect(a.geometry).toMatchObject({ span_m: 9.75, wingArea_m2: 15.7 });
    expect(a.mass).toMatchObject({ emptyKg: 592, maxKg: 816, fuelCapacityL: 151 });
    close(a.targets.stall_mps, ktToMps(49));
    close(a.targets.cruise_mps, ktToMps(122));
    close(a.targets.vx_mps, ktToMps(50));
    close(a.targets.vy_mps, ktToMps(71));
    close(a.limits.va_mps, ktToMps(93));
    close(a.limits.vno_mps, ktToMps(139));
    close(a.limits.vne_mps, ktToMps(173));
    close(a.targets.climb_mps, fpmToMps(1130));
    expect(a.limits).toMatchObject({ gMax: 6, gMin: -5, invertedSystems: true });
    expect(a.targets).toMatchObject({ takeoffRoll_m: 177, landingRoll_m: 152 });
    expect(a.gear.layout).toBe('taildragger');
  });

  it('Bensen B-8M matches CLAUDE.md', () => {
    const a = AIRCRAFT.bensenB8M;
    expect(a.type).toBe('gyroplane');
    expect(a.propulsion.layout).toBe('pusher');
    expect(a.propulsion.engineName).toBe('McCulloch 4318');
    close(a.propulsion.ratedPowerW, hpToW(65));
    expect(a.geometry).toMatchObject({ rotorDiameter_m: 6.15, rotorBlades: 2 });
    expect(a.mass).toMatchObject({ emptyKg: 113.4, maxKg: 249.5, fuelCapacityL: 20 });
    close(a.targets.cruise_mps, ktToMps(56));
    close(a.targets.maxSpeed_mps, ktToMps(82));
    close(a.targets.climb_mps, fpmToMps(1100));
    expect(a.targets.takeoffRoll_m).toBe(30);
    expect(a.limits).toMatchObject({ rotorRpmMin: 200, rotorRpmMax: 400 });
    expect(a.gear.layout).toBe('tricycle');
  });

  it('uses a 90 kg pilot for every aircraft', () => {
    for (const a of Object.values(AIRCRAFT)) expect(a.mass.pilotKg).toBe(90);
  });

  it('empty + pilot + full fuel does not exceed max weight', () => {
    for (const a of Object.values(AIRCRAFT)) {
      const loaded = a.mass.emptyKg + a.mass.pilotKg + a.mass.fuelCapacityL * a.mass.fuelDensityKgPerL;
      expect(loaded, a.name).toBeLessThanOrEqual(a.mass.maxKg);
    }
  });
});

describe('validateAircraftData', () => {
  const good = () => structuredClone(AIRCRAFT.airbike103) as unknown as Record<string, any>;

  it('rejects a non-object', () => {
    expect(() => validateAircraftData(42)).toThrow(AircraftDataError);
  });

  it('rejects a missing section', () => {
    const bad = good();
    delete bad.mass;
    expect(() => validateAircraftData(bad)).toThrow(/missing section "mass"/);
  });

  it('rejects max weight below empty weight', () => {
    const bad = good();
    bad.mass.maxKg = 100;
    expect(() => validateAircraftData(bad)).toThrow(/maxKg must exceed/);
  });

  it('catches a speed entered in knots instead of m/s', () => {
    const bad = good();
    bad.limits.vne_mps = 200; // obviously not m/s
    expect(() => validateAircraftData(bad)).toThrow(/vne_mps = 200/);
  });

  it('rejects a bad enum value', () => {
    const bad = good();
    bad.gear.layout = 'quadricycle';
    expect(() => validateAircraftData(bad)).toThrow(/gear.layout/);
  });

  it('requires wing geometry for fixed-wing aircraft', () => {
    const bad = good();
    delete bad.geometry.wingArea_m2;
    expect(() => validateAircraftData(bad)).toThrow(/span_m and geometry.wingArea_m2/);
  });

  it('lists every problem at once', () => {
    const bad = good();
    bad.name = '';
    bad.propulsion.ratedRpm = 'fast';
    try {
      validateAircraftData(bad);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/name/);
      expect((e as Error).message).toMatch(/ratedRpm/);
    }
  });
});
