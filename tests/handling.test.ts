import { describe, expect, it } from 'vitest';
import { AIRCRAFT, type AircraftId } from '../src/aircraft';
import { GRAVITY } from '../src/core/constants';
import { mpsToKt } from '../src/core/units';
import type { Gyroplane } from '../src/physics/Gyroplane';
import { WindModel } from '../src/physics/wind';
import { RUNWAYS } from '../src/world/layout';
import { FLIGHT_ROTOR, landingGyro, TECHNIQUE } from './flightTest/programme';
import { flyCircuit } from './helpers/circuit';
import { prerotate, takeOff } from './helpers/gyroPilot';
import { oneMinusCos, ScriptedWind } from './helpers/scriptedWind';
import { attitude, fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

// Stage 8 handling checks: gust response against theory, and crosswind take-offs and
// landings flown with proper technique.
//
// Crosswind test values: at least the FAR 23.233 demonstration minimum of 0.2 x stall
// speed (Air-Bike 4.8, Decathlon 9.8 kt), rounded up; the gyro (no stall speed) at 10 kt.
// No published demonstrated crosswind for any of the three; these are assumed.

const deg = Math.PI / 180;
const LONG = 300_000;
const CROSSWIND_KT: Record<AircraftId, number> = { airbike103: 6, decathlon8kcab: 12, bensenB8M: 10 };
const IDS: AircraftId[] = ['airbike103', 'decathlon8kcab', 'bensenB8M'];
/** Vertical gust used for the gust-load check, m/s (about 6 kt). */
const GUST_MPS = 3;

/** Trimmed level flight at a moderate cruise, then the controls are held fixed. */
function trimmedCruise(id: AircraftId, wind: WindModel) {
  const d = AIRCRAFT[id];
  const gyro = d.type === 'gyroplane';
  const kt = mpsToKt(d.targets.cruise_mps!) * (id === 'decathlon8kcab' ? 0.85 : 1);
  const { world, ac } = makeWorld(d, 1, wind);
  startInFlight(ac, 300, kt, gyro ? 0 : 3);
  if (gyro) (ac as Gyroplane).rotor.omega = FLIGHT_ROTOR;
  const pilot = new TestPilot(ac);
  fly(world, 40, () => {
    pilot.holdAltitude(300);
    pilot.bankTo(0);
    pilot.holdPower(gyro ? 0.45 : 0.65);
  });
  return { world, ac };
}

describe('gust response', () => {
  for (const id of IDS) {
    it(`${id}: a ${GUST_MPS} m/s vertical "1 − cos" gust gives the load factor theory predicts, and it settles`, () => {
      const d = AIRCRAFT[id];
      const wind = new ScriptedWind();
      const { world, ac } = trimmedCruise(id, wind);
      const V = ac.state.tas;
      const chord = d.geometry.chord_m ?? d.rotor!.bladeChord_m;
      // Standard gust shape: gradient distance 12.5 chords (a 25-chord "1 − cos" gust).
      const start = wind.time + 1;
      wind.extra = (t, o) => o.set(0, oneMinusCos(t, start, (25 * chord) / V, GUST_MPS), 0);
      const pitch0 = attitude(ac).pitch;
      let peak = 0;
      fly(world, 6, () => void (peak = Math.max(peak, ac.state.loadFactor - 1)));
      fly(world, 15, () => {});
      let expected: number;
      let basis: string;
      if (d.aero) {
        // Pratt–Walker (FAR 23.341): Δn = Kg ρ0 U V a / (2 W/S), Kg = 0.88 μ / (5.3 + μ),
        // μ = 2 (W/S) / (ρ c a g). a = lift slope of the wing from the data table.
        const i0 = d.aero.alpha_deg.indexOf(0);
        const i8 = d.aero.alpha_deg.indexOf(8);
        const a = (d.aero.CL[i8] - d.aero.CL[i0]) / (8 * deg);
        const ws = (ac.body.mass * GRAVITY) / d.geometry.wingArea_m2!;
        const mu = (2 * ws) / (1.225 * chord * a * GRAVITY);
        const kg = (0.88 * mu) / (5.3 + mu);
        expected = (kg * 1.225 * GUST_MPS * ac.state.ias * a) / (2 * ws);
        basis = 'Pratt';
      } else {
        // Rotor, quasi-static blade element: ΔCT = (σa/4)·Δλ with Δλ = U/ΩR, so
        // Δn = σ a ρ A ΩR U / (4 W). Inflow feedback reduces this; the gust also speeds the
        // rotor up a little (more up-flow drives it), which adds a few percent back.
        const gy = ac as Gyroplane;
        const r = d.rotor!;
        const R = d.geometry.rotorDiameter_m! / 2;
        const sigma = (d.geometry.rotorBlades! * r.bladeChord_m) / (Math.PI * R);
        expected = (sigma * r.liftSlope * 1.225 * Math.PI * R * R * gy.rotor.omega * R * GUST_MPS) / (4 * ac.body.mass * GRAVITY);
        basis = 'rotor estimate';
      }
      console.info(`${id}: gust Δn ${peak.toFixed(3)} g vs ${basis} ${expected.toFixed(3)} g (ratio ${(peak / expected).toFixed(2)})`);
      if (d.aero) {
        expect(peak / expected).toBeGreaterThan(0.75);
        expect(peak / expected).toBeLessThan(1.25);
      } else {
        expect(peak / expected).toBeGreaterThan(0.6);
        expect(peak / expected).toBeLessThan(1.15);
      }
      // Hands off afterwards it does not diverge in pitch.
      expect(Math.abs(attitude(ac).pitch - pitch0)).toBeLessThan(5 * deg);
    }, LONG);

    it(`${id}: a ${GUST_MPS} m/s side gust rocks it gently and it recovers, controls fixed`, () => {
      const wind = new ScriptedWind();
      const { world, ac } = trimmedCruise(id, wind);
      const start = wind.time + 1;
      wind.extra = (t, o) => o.set(oneMinusCos(t, start, 2, GUST_MPS), 0, 0);
      let maxBank = 0;
      fly(world, 4, () => void (maxBank = Math.max(maxBank, Math.abs(attitude(ac).bank))));
      fly(world, 10, () => {});
      const bankAfter = Math.abs(attitude(ac).bank);
      console.info(`${id}: side gust max bank ${(maxBank / deg).toFixed(1)}°, ${(bankAfter / deg).toFixed(1)}° 10 s later`);
      expect(maxBank).toBeLessThan(6 * deg);
      expect(bankAfter).toBeLessThan(3 * deg);
    }, LONG);

    it(`${id}: holds cruise in moderate turbulence (test pilot flying)`, () => {
      const d = AIRCRAFT[id];
      const gyro = d.type === 'gyroplane';
      const wind = new WindModel();
      wind.setSteady(0, 10);
      wind.turbulence = 'moderate';
      const { world, ac } = trimmedCruise(id, wind);
      const pilot = new TestPilot(ac);
      let sumBank2 = 0;
      let maxDn = 0;
      let maxDh = 0;
      let n = 0;
      fly(world, 90, () => {
        pilot.holdAltitude(300);
        pilot.bankTo(0);
        pilot.holdPower(gyro ? 0.45 : 0.65);
        sumBank2 += attitude(ac).bank ** 2;
        maxDn = Math.max(maxDn, Math.abs(ac.state.loadFactor - 1));
        maxDh = Math.max(maxDh, Math.abs(ac.body.position.y - 300));
        n++;
      });
      const rmsBank = Math.sqrt(sumBank2 / n) / deg;
      console.info(`${id}: moderate turbulence: RMS bank ${rmsBank.toFixed(1)}°, peak Δn ${maxDn.toFixed(2)} g, max height error ${maxDh.toFixed(1)} m`);
      expect(rmsBank).toBeLessThan(5);
      expect(maxDn).toBeLessThan(1);
      expect(maxDh).toBeLessThan(15);
    }, LONG);
  }
});

describe('crosswind handling', () => {
  for (const id of IDS) {
    for (const from of [270, 90]) {
      const kt = CROSSWIND_KT[id];
      it(`${id}: takes off straight in a ${kt} kt crosswind from ${from === 270 ? 'the left' : 'the right'} (runway 36)`, () => {
        const d = AIRCRAFT[id];
        const wind = new WindModel();
        wind.setSteady(from, kt);
        const { world, ac } = makeWorld(d, 1, wind);
        ac.placeOnGround(RUNWAYS.gravel.cx, 290, 0, 0, 0.02);
        ac.powerplant.start();
        let maxOff = 0;
        let maxRudder = 0;
        let strike = false;
        if (d.type === 'gyroplane') {
          prerotate(world, ac as Gyroplane);
          takeOff(world, ac as Gyroplane, RUNWAYS.gravel.cx);
          maxOff = Math.abs(ac.body.position.x - RUNWAYS.gravel.cx);
          maxRudder = Math.abs(ac.pilot.aileron);
        } else {
          fly(world, 3, () => {});
          const pilot = new TestPilot(ac);
          fly(world, 60, () => {
            ac.pilot.throttle = 1;
            pilot.pitchTo(TECHNIQUE[id].threePoint!);
            pilot.steerAlongCentreline(0, RUNWAYS.gravel.cx);
            maxOff = Math.max(maxOff, Math.abs(ac.body.position.x - RUNWAYS.gravel.cx));
            maxRudder = Math.max(maxRudder, Math.abs(ac.pilot.rudder));
            strike ||= ac.gear.states.some((s, i) => s.inContact && ac.gear.legs[i].kind === 'skid');
            return ac.gear.states.every((s) => !s.inContact);
          });
        }
        console.info(`${id}: ${kt} kt crosswind take-off from ${from}°: max ${maxOff.toFixed(2)} m off the centreline, control used ${(maxRudder * 100).toFixed(0)} %`);
        expect(ac.gear.states.every((s) => !s.inContact)).toBe(true); // got airborne
        expect(maxOff).toBeLessThan(3);
        expect(maxRudder).toBeLessThan(0.8); // a margin of control left
        expect(strike).toBe(false);
      }, LONG);

      it(`${id}: lands on the runway in a ${kt} kt crosswind from ${from === 270 ? 'the left' : 'the right'}`, () => {
        const d = AIRCRAFT[id];
        const wind = new WindModel();
        wind.setSteady(from, kt);
        const half = RUNWAYS.gravel.sizeX / 2;
        if (d.type === 'gyroplane') {
          const r = landingGyro(wind);
          console.info(`${id}: crosswind landing from ${from}°: touchdown ${r.touchdownOffset.toFixed(1)} m off, drift ${r.touchdownDrift.toFixed(2)} m/s, roll ${r.roll.toFixed(0)} m, max ${r.maxRolloutOffset.toFixed(1)} m off`);
          expect(Number.isNaN(r.roll)).toBe(false);
          expect(Math.abs(r.touchdownOffset)).toBeLessThan(half);
          expect(Math.abs(r.touchdownDrift)).toBeLessThan(1);
          expect(r.maxRolloutOffset).toBeLessThan(half);
          return;
        }
        const { world, ac } = makeWorld(d, 1, wind);
        const r = flyCircuit(world, ac, { x: RUNWAYS.gravel.cx, dir: 1 }, TECHNIQUE[id].circuit!);
        console.info(`${id}: crosswind circuit from ${from}°: touchdown ${r.touchdownOffset.toFixed(1)} m off, drift ${r.touchdownDrift.toFixed(2)} m/s, ${r.touchdownKt.toFixed(0)} kt, roll ${r.landingRoll.toFixed(0)} m, max ${r.maxRolloutOffset.toFixed(1)} m off`);
        expect(r.stopped).toBe(true);
        expect(r.wingOrNoseStrike).toBe(false);
        expect(Math.abs(r.touchdownOffset)).toBeLessThan(half);
        expect(Math.abs(r.touchdownDrift)).toBeLessThan(1);
        expect(r.maxRolloutOffset).toBeLessThan(half);
        expect(Math.abs(r.stopPoint.z)).toBeLessThan(RUNWAYS.length / 2);
      }, LONG);
    }
  }
});
