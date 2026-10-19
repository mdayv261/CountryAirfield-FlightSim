import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/aircraft';
import { GAUGE_KINDS } from '../src/aircraft/schema';
import { altimeterAngles, dialAngle, dialScale, gaugeValue, lcdText, slipBallPosition, vsiAngle } from '../src/cockpit/gauges';
import { bearingDeg, INSTRUMENT_LAG, Instruments } from '../src/cockpit/instruments';
import { FIELD_ELEVATION_M } from '../src/core/constants';
import { mpsToFpm, mpsToKt, mToFt } from '../src/core/units';
import type { Gyroplane } from '../src/physics/Gyroplane';
import { hudFlightLines } from '../src/ui/Hud';
import { attitude, fly, makeWorld, startInFlight, TestPilot } from './helpers/testPilot';

const calm = new THREE.Vector3();
const DT = 1 / 60;

/** Numbers in a HUD line, in order. */
const numbers = (line: string) => (line.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('instruments', () => {
  it('read the flight state: airspeed, altitude, vertical speed, heading, attitude', () => {
    const { world, ac } = makeWorld(AIRCRAFT.decathlon8kcab);
    startInFlight(ac, 500, 100, 2, 90);
    const pilot = new TestPilot(ac);
    fly(world, 5, () => pilot.holdAltitude(500));
    const ins = new Instruments();
    const r = ins.update(ac, calm, DT);
    expect(r.iasKt).toBeCloseTo(mpsToKt(ac.state.ias), 6);
    expect(r.altitudeFt).toBeCloseTo(mToFt(ac.body.position.y + FIELD_ELEVATION_M), 6);
    expect(r.vsiFpm).toBeCloseTo(mpsToFpm(ac.state.verticalSpeed), 6);
    expect(r.headingDeg).toBeCloseTo(90, 0);
    const a = attitude(ac);
    expect(r.pitchDeg).toBeCloseTo((a.pitch * 180) / Math.PI, 6);
    expect(r.bankDeg).toBeCloseTo((a.bank * 180) / Math.PI, 6);
    expect(r.chtC).not.toBeNull();
    expect(r.rotorRpm).toBeNull();
  });

  it('the VSI and wet compass lag a little; the DG does not', () => {
    const { world, ac } = makeWorld(AIRCRAFT.decathlon8kcab);
    startInFlight(ac, 500, 100, 2, 0);
    const ins = new Instruments();
    ins.update(ac, calm, DT);
    ac.body.velocity.y = 5; // a sudden climb
    ac.state.verticalSpeed = 5;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-30 * Math.PI) / 180); // turn to 030
    ac.body.orientation.premultiply(q);
    const r = ins.update(ac, calm, INSTRUMENT_LAG.vsi_s / 10);
    expect(r.headingDeg).toBeCloseTo(30, 3);
    expect(r.compassDeg).toBeGreaterThan(0);
    expect(r.compassDeg).toBeLessThan(30);
    expect(r.vsiFpm).toBeGreaterThan(0);
    expect(r.vsiFpm).toBeLessThan(mpsToFpm(5) * 0.2);
    for (let i = 0; i < 600; i++) ins.update(ac, calm, DT);
    expect(r.vsiFpm).toBeCloseTo(mpsToFpm(5), 0);
    expect(r.compassDeg).toBeCloseTo(30, 1);
    void world;
  });

  it('wind is reported as the direction it blows from', () => {
    const { ac } = makeWorld(AIRCRAFT.airbike103);
    const ins = new Instruments();
    // A northerly blows towards the south (+z) — 10 m/s.
    const r = ins.update(ac, new THREE.Vector3(0, 0, 10), DT);
    expect(r.windFromDeg).toBeCloseTo(0, 6);
    expect(r.windKt).toBeCloseTo(mpsToKt(10), 6);
    expect(ins.update(ac, new THREE.Vector3(-10, 0, 0), DT).windFromDeg).toBeCloseTo(90, 6);
    expect(bearingDeg(0, 1)).toBeCloseTo(180, 6);
  });

  it('the slip ball is centred in balanced flight and swings out in a skid', () => {
    const { world, ac } = makeWorld(AIRCRAFT.decathlon8kcab);
    startInFlight(ac, 500, 100, 2, 0);
    const pilot = new TestPilot(ac);
    fly(world, 10, () => {
      pilot.holdAltitude(500);
      pilot.bankTo(0);
    });
    const ins = new Instruments();
    expect(Math.abs(ins.update(ac, calm, DT).slipDeg)).toBeLessThan(1);
    // Full right rudder, wings held level: the nose yaws right of the flight path, so the air
    // strikes the left side of the fuselage and fin and pushes the aircraft right. The ball
    // rolls left, the way the pilot is thrown ("step on the ball": left rudder to centre it).
    fly(world, 2, () => {
      pilot.holdAltitude(500);
      pilot.bankTo(0);
      ac.pilot.rudder = 1;
    });
    expect(ins.update(ac, calm, DT).slipDeg).toBeLessThan(-2);
  });

  it('a gyroplane reports its rotor rpm', () => {
    const { ac } = makeWorld(AIRCRAFT.bensenB8M);
    (ac as Gyroplane).rotor.omega = 12 * Math.PI;
    expect(new Instruments().update(ac, calm, DT).rotorRpm).toBeCloseTo(360, 6);
  });
});

describe('gauges agree with the HUD', () => {
  for (const id of ['airbike103', 'decathlon8kcab', 'bensenB8M'] as const) {
    it(`${id}: every HUD flight number matches what its panel gauge shows`, () => {
      const { world, ac } = makeWorld(AIRCRAFT[id]);
      startInFlight(ac, 300, mpsToKt(AIRCRAFT[id].targets.cruise_mps!), 2, 45);
      if (id === 'bensenB8M') (ac as Gyroplane).rotor.omega = 12 * Math.PI;
      ac.pilot.throttle = 0.7;
      const ins = new Instruments();
      const wind = new THREE.Vector3(3, 0, 4);
      fly(world, 3, () => void ins.update(ac, wind, 1 / 120));
      const r = ins.update(ac, wind, DT);
      const [ias, alt, hdg, vsi, g, windLine] = hudFlightLines(r);
      const kinds = new Set(AIRCRAFT[id].panel!.gauges.map((gg) => gg.kind));
      // Speed, altitude and vertical speed are on every panel.
      expect(numbers(ias)[0]).toBe(Math.round(gaugeValue('asi', r)));
      expect(numbers(alt)[0]).toBe(Math.round(gaugeValue('altimeter', r)));
      expect(numbers(vsi)[0]).toBe(Math.round(gaugeValue('vsi', r)));
      // Heading: the DG if fitted, otherwise the wet compass (which may trail by its damping).
      const headingGauge = kinds.has('dg') ? gaugeValue('dg', r) : gaugeValue('compass', r);
      const dh = ((numbers(hdg)[0] - headingGauge + 540) % 360) - 180;
      expect(Math.abs(dh)).toBeLessThan(kinds.has('dg') ? 0.51 : 2);
      if (kinds.has('gmeter')) expect(numbers(g)[0]).toBeCloseTo(gaugeValue('gmeter', r), 1);
      expect(numbers(windLine)[0]).toBe(Math.round(r.windFromDeg));
      expect(numbers(windLine)[1]).toBe(Math.round(r.windKt));
    });
  }

  it('every panel carries the stage 7 instruments', () => {
    const base = ['asi', 'altimeter', 'vsi', 'tacho', 'slip', 'fuel'];
    const extra = {
      airbike103: ['compass', 'egt', 'cht'],
      bensenB8M: ['compass', 'rotorTacho', 'cht', 'egt'],
      // The Decathlon's DG takes the wet compass's place (user, 2026-10-20).
      decathlon8kcab: ['attitude', 'dg', 'map', 'gmeter'],
    };
    for (const [id, more] of Object.entries(extra)) {
      const kinds = AIRCRAFT[id as keyof typeof extra].panel!.gauges.map((g) => g.kind);
      for (const k of [...base, ...more]) expect(kinds, `${id} ${k}`).toContain(k);
      expect(kinds.every((k) => (GAUGE_KINDS as readonly string[]).includes(k))).toBe(true);
    }
  });

  it('panel layout: flight instruments across the top, slip under the ASI, heading gauge left of it, engine gauges right', () => {
    const flight = ['asi', 'altimeter', 'vsi', 'attitude', 'gmeter'];
    for (const ac of Object.values(AIRCRAFT)) {
      const gs = ac.panel!.gauges;
      const at = (k: string) => gs.find((g) => g.kind === k)!.at_m;
      const top = at('asi')[1];
      for (const g of gs) if (flight.includes(g.kind)) expect(g.at_m[1], `${ac.id} ${g.kind}`).toBe(top);
      // Centre gauge: the AI where fitted (Decathlon), else the ASI; ALT left of it, VSI right of the ASI.
      const centre = gs.some((g) => g.kind === 'attitude') ? 'attitude' : 'asi';
      expect(at(centre)[0], ac.id).toBe(0);
      expect(at('altimeter')[0]).toBeLessThan(0);
      expect(at('asi')[0]).toBeGreaterThanOrEqual(0);
      expect(at('vsi')[0]).toBeGreaterThan(at('asi')[0]);
      const slip = at('slip');
      expect(slip[0]).toBe(at('asi')[0]);
      expect(slip[1]).toBeLessThan(top);
      const heading = gs.some((g) => g.kind === 'compass') ? 'compass' : 'dg';
      expect(at(heading)[0]).toBeLessThan(slip[0]);
      expect(at(heading)[1]).toBeLessThan(top);
      // Air-Bike (user, 2026-10-20): EGT left of the compass with CHT above it, top row.
      const leftColumn = ac.id === 'airbike103' ? ['egt', 'cht'] : [];
      // Gyro (user, 2026-10-20): engine tacho then rotor LCD on the top row, right of the VSI.
      const topRight = ac.id === 'bensenB8M' ? ['tacho', 'rotorTacho'] : [];
      for (const k of topRight) {
        expect(at(k)[1], `${ac.id} ${k}`).toBe(top);
        expect(at(k)[0], `${ac.id} ${k}`).toBeGreaterThan(at('vsi')[0]);
      }
      for (const g of gs)
        if (![...flight, ...leftColumn, ...topRight, 'slip', heading].includes(g.kind)) {
          expect(g.at_m[0], `${ac.id} ${g.kind}`).toBeGreaterThan(slip[0]);
          expect(g.at_m[1], `${ac.id} ${g.kind}`).toBeLessThan(top);
        }
    }
    const deca = AIRCRAFT.decathlon8kcab.panel!;
    expect(deca.gauges.map((g) => g.kind)).not.toContain('compass');
    expect(deca.size_m[0]).toBeLessThan(0.74);
    const bike = (k: string) => AIRCRAFT.airbike103.panel!.gauges.find((g) => g.kind === k)!;
    expect(bike('egt').at_m[0]).toBeLessThan(bike('compass').at_m[0]);
    expect(bike('egt').at_m[1]).toBe(bike('compass').at_m[1]);
    expect(bike('cht').at_m[0]).toBe(bike('egt').at_m[0]);
    expect(bike('cht').at_m[1]).toBe(bike('asi').at_m[1]);
    expect(bike('tacho').diameter_m).toBe(bike('asi').diameter_m);
    const gyro = (k: string) => AIRCRAFT.bensenB8M.panel!.gauges.find((g) => g.kind === k)!;
    expect(gyro('rotorTacho').at_m[0]).toBeGreaterThan(gyro('tacho').at_m[0]);
    expect(gyro('fuel').at_m[0]).toBeGreaterThan(gyro('slip').at_m[0]);
    expect(gyro('egt').at_m[0]).toBeGreaterThan(gyro('fuel').at_m[0]);
    expect(gyro('cht').at_m[0]).toBeGreaterThan(gyro('egt').at_m[0]);
    expect(AIRCRAFT.bensenB8M.panel!.size_m[0]).toBeLessThan(0.6);
    expect(gyro('rotorTacho').style).toBe('lcd');
    expect(lcdText(362.6)).toBe('363');
  });

  it('no two gauges on a panel overlap, and all sit on the panel face', () => {
    for (const ac of Object.values(AIRCRAFT)) {
      const p = ac.panel!;
      const gs = p.gauges;
      for (const g of gs) {
        expect(Math.abs(g.at_m[0]) + g.diameter_m / 2, `${ac.id} ${g.kind}`).toBeLessThanOrEqual(p.size_m[0] / 2 + 1e-9);
        expect(Math.abs(g.at_m[1]) + g.diameter_m / 2, `${ac.id} ${g.kind}`).toBeLessThanOrEqual(p.size_m[1] / 2 + 1e-9);
      }
      for (let i = 0; i < gs.length; i++)
        for (let j = i + 1; j < gs.length; j++) {
          const d = Math.hypot(gs[i].at_m[0] - gs[j].at_m[0], gs[i].at_m[1] - gs[j].at_m[1]);
          expect(d, `${ac.id} ${gs[i].kind}/${gs[j].kind}`).toBeGreaterThanOrEqual((gs[i].diameter_m + gs[j].diameter_m) / 2);
        }
    }
  });
});

describe('gauge geometry', () => {
  it('dial needles sweep linearly between their stops and stop at the ends', () => {
    expect(dialAngle(0, 0, 100, -150, 150)).toBeCloseTo((-150 * Math.PI) / 180, 9);
    expect(dialAngle(50, 0, 100, -150, 150)).toBeCloseTo(0, 9);
    expect(dialAngle(500, 0, 100, -150, 150)).toBeCloseTo((150 * Math.PI) / 180, 9);
    const asi = AIRCRAFT.decathlon8kcab.panel!.gauges.find((g) => g.kind === 'asi')!;
    expect(dialScale(asi).max).toBe(200);
  });

  it('the altimeter hands turn once per 1,000, 10,000 and 100,000 ft', () => {
    const a = altimeterAngles(2500);
    expect(a.hundreds).toBeCloseTo(Math.PI, 9); // 500 ft: pointing at 5
    expect(a.thousands).toBeCloseTo(0.25 * 2 * Math.PI, 9);
    expect(a.tenThousands).toBeCloseTo(0.025 * 2 * Math.PI, 9);
  });

  it('the VSI reads zero at 9 o\'clock, climbs swing the needle up', () => {
    expect(vsiAngle(0, 2000)).toBeCloseTo(-Math.PI / 2, 9);
    expect(vsiAngle(1000, 2000)).toBeGreaterThan(vsiAngle(0, 2000));
    expect(vsiAngle(-5000, 2000)).toBeCloseTo(vsiAngle(-2000, 2000), 9);
    expect(slipBallPosition(100)).toBe(1);
    expect(slipBallPosition(0)).toBe(0);
  });
});
