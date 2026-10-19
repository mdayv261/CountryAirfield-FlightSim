import { describe, expect, it } from 'vitest';
import * as u from '../src/core/units';

describe('unit conversions', () => {
  it('matches known reference values', () => {
    expect(u.ktToMps(1)).toBeCloseTo(0.514444, 6);
    expect(u.ftToM(1)).toBe(0.3048);
    expect(u.fpmToMps(1000)).toBeCloseTo(5.08, 6);
    expect(u.inToM(74)).toBeCloseTo(1.8796, 6);
    expect(u.hpToW(180)).toBeCloseTo(134226, 0);
    expect(u.lToM3(151)).toBeCloseTo(0.151, 9);
    expect(u.degToRad(180)).toBeCloseTo(Math.PI, 12);
  });

  it('round-trips every pair', () => {
    const pairs: Array<[(x: number) => number, (x: number) => number]> = [
      [u.ftToM, u.mToFt],
      [u.ktToMps, u.mpsToKt],
      [u.fpmToMps, u.mpsToFpm],
      [u.inToM, u.mToIn],
      [u.hpToW, u.wToHp],
      [u.lToM3, u.m3ToL],
      [u.degToRad, u.radToDeg],
    ];
    for (const [to, from] of pairs) {
      for (const x of [0, 1, 57.3, 1130, -5]) expect(from(to(x))).toBeCloseTo(x, 9);
    }
  });
});
