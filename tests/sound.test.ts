import { describe, expect, it } from 'vitest';
import { AIRCRAFT, type AircraftId } from '../src/aircraft';
import { CABIN, engineSound, outsideHearing, rotorSound, stallHorn, windSound } from '../src/audio/soundModel';
import { mpsToKt } from "../src/core/units";
import type { Gyroplane } from '../src/physics/Gyroplane';
import { fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

const IDS: AircraftId[] = ['airbike103', 'decathlon8kcab', 'bensenB8M'];

/** Each aircraft cruising level at 75 % power (gyro 45 %), its engine sound parameters. */
function cruising(id: AircraftId) {
  const d = AIRCRAFT[id];
  const { world, ac } = makeWorld(d);
  startInFlight(ac, 300, mpsToKt(d.targets.cruise_mps!), id === "bensenB8M" ? 0 : 3);
  if (id === 'bensenB8M') (ac as Gyroplane).rotor.omega = 12 * Math.PI;
  const pilot = new TestPilot(ac);
  fly(world, 30, () => {
    pilot.holdAltitude(300);
    pilot.bankTo(0);
    pilot.holdPower(id === 'bensenB8M' ? 0.45 : 0.75);
  });
  return { ac, e: engineSound(ac, d.sound!) };
}

/** How alike two harmonic mixes are (cosine similarity, 1 = identical tone colour). */
function similarity(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / Math.sqrt(na * nb);
}

describe('engine sounds are distinct', () => {
  it('each engine has its own note: firing frequency from rpm, cylinders and strokes', () => {
    const r = Object.fromEntries(IDS.map((id) => [id, cruising(id)]));
    for (const id of IDS) console.info(`${id}: firing ${r[id].e.firingHz.toFixed(0)} Hz at ${r[id].ac.powerplant.rpm.toFixed(0)} rpm, prop ${r[id].e.propHz.toFixed(0)} Hz, belt ${r[id].e.beltHz.toFixed(0)} Hz`);
    // Single-cylinder two-stroke: one firing per turn.
    expect(r.airbike103.e.firingHz).toBeCloseTo(r.airbike103.ac.powerplant.rpm / 60, 6);
    // Four-cylinder four-stroke: two firings per turn.
    expect(r.decathlon8kcab.e.firingHz).toBeCloseTo((r.decathlon8kcab.ac.powerplant.rpm / 60) * 2, 6);
    // Four-cylinder two-stroke: four firings per turn.
    expect(r.bensenB8M.e.firingHz).toBeCloseTo((r.bensenB8M.ac.powerplant.rpm / 60) * 4, 6);
    // Every pair differs clearly in pitch (20 %) or in brightness (the low-pass at power, 50 %):
    // the Hirth and the Lycoming fire at similar rates in cruise (~100 and ~90 Hz) but one is a
    // bright crackling two-stroke with belt whine, the other a dark, throaty four-stroke.
    const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);
    for (let i = 0; i < IDS.length; i++)
      for (let j = i + 1; j < IDS.length; j++) {
        const [a, b] = [r[IDS[i]].e, r[IDS[j]].e];
        expect(ratio(a.firingHz, b.firingHz) > 1.2 || ratio(a.cutoffHz, b.cutoffHz) > 1.5, `${IDS[i]} vs ${IDS[j]}`).toBe(true);
      }
    // Multi-cylinder engines throb at crank rate; the Lycoming (four-stroke flat-4) the most.
    expect(r.decathlon8kcab.e.throbHz).toBeCloseTo(r.decathlon8kcab.e.firingHz / 2, 6);
    expect(r.decathlon8kcab.e.throbLevel).toBeGreaterThan(r.bensenB8M.e.throbLevel);
    expect(r.airbike103.e.throbLevel).toBe(0);
    // Only the belt-drive Hirth whines.
    expect(r.airbike103.e.beltHz).toBeGreaterThan(1000);
    expect(r.decathlon8kcab.e.beltLevel).toBe(0);
    expect(r.bensenB8M.e.beltLevel).toBe(0);
  });

  it('their tone colours (harmonic mixes) differ, and the Lycoming is the darkest', () => {
    const h = IDS.map((id) => AIRCRAFT[id].sound!.engine.harmonics);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(similarity(h[i], h[j])).toBeLessThan(0.995);
    const bright = (id: AircraftId) => AIRCRAFT[id].sound!.engine.brightnessHz[1];
    expect(bright('decathlon8kcab')).toBeLessThan(bright('bensenB8M'));
    expect(bright('decathlon8kcab')).toBeLessThan(bright('airbike103'));
  });

  it('louder and brighter with power; silent when the engine stops', () => {
    const { world, ac } = makeWorld(AIRCRAFT.airbike103);
    ac.resetOnGround(0, 280, 0, 0);
    fly(world, 3, () => void (ac.pilot.throttle = 0));
    const idle = engineSound(ac, AIRCRAFT.airbike103.sound!);
    fly(world, 3, () => {
      ac.pilot.throttle = 1;
      ac.pilot.brakeLeft = ac.pilot.brakeRight = 1;
    });
    const full = engineSound(ac, AIRCRAFT.airbike103.sound!);
    expect(full.level).toBeGreaterThan(idle.level * 1.5);
    expect(full.cutoffHz).toBeGreaterThan(idle.cutoffHz);
    expect(full.firingHz).toBeGreaterThan(idle.firingHz);
    ac.powerplant.stop();
    fly(world, 10, () => void (ac.pilot.throttle = 0));
    expect(engineSound(ac, AIRCRAFT.airbike103.sound!).level).toBe(0);
  });
});

describe('wind, rotor and horn', () => {
  it('wind noise grows with airspeed squared and rises in pitch; a cabin keeps most of it out', () => {
    const open = AIRCRAFT.airbike103.sound!;
    const closed = AIRCRAFT.decathlon8kcab.sound!;
    expect(windSound(0, open).level).toBe(0);
    expect(windSound(20, open).level).toBeCloseTo(4 * windSound(10, open).level, 6);
    expect(windSound(20, open).centreHz).toBeGreaterThan(windSound(10, open).centreHz);
    expect(windSound(20, closed).level).toBeCloseTo(CABIN.windFactor * windSound(20, open).level, 6);
  });

  it('rotor swish beats at the blade-passing rate (2 blades x rpm / 60)', () => {
    const { ac } = makeWorld(AIRCRAFT.bensenB8M);
    (ac as Gyroplane).rotor.omega = 12 * Math.PI; // 360 rpm
    const r = rotorSound(ac, AIRCRAFT.bensenB8M.sound!);
    expect(r.swishHz).toBeCloseTo(12, 6);
    expect(r.level).toBeGreaterThan(0);
    // Fixed-wing aircraft have no rotor sound.
    expect(rotorSound(makeWorld(AIRCRAFT.airbike103).ac, AIRCRAFT.airbike103.sound!).level).toBe(0);
  });

  it('the Decathlon stall horn sounds approaching the stall, and only the Decathlon has one', () => {
    const d = AIRCRAFT.decathlon8kcab;
    const { world, ac } = makeWorld(d);
    startInFlight(ac, 500, 80);
    const pilot = new TestPilot(ac);
    expect(stallHorn(ac, d.sound!).on).toBe(false);
    let horn = false;
    fly(world, 60, (t) => {
      ac.pilot.throttle = 0;
      pilot.holdSpeedWithPitch(Math.max(80 - t, 20));
      pilot.bankTo(0);
      if (stallHorn(ac, d.sound!).on) {
        horn = true;
        return true;
      }
    });
    expect(horn).toBe(true);
    expect(AIRCRAFT.airbike103.sound!.stallHorn).toBeUndefined();
    expect(AIRCRAFT.bensenB8M.sound!.stallHorn).toBeUndefined();
  });

  it('heard from outside: quieter with distance, higher pitched approaching (Doppler)', () => {
    expect(outsideHearing(4, 0).gain).toBe(1);
    expect(outsideHearing(80, 0).gain).toBeCloseTo(0.1, 6);
    expect(outsideHearing(50, 30).doppler).toBeGreaterThan(1.09); // 30 m/s towards: about +10 %
    expect(outsideHearing(50, -30).doppler).toBeLessThan(0.93);
  });
});
