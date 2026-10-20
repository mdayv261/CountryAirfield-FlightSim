import { AIRCRAFT, type AircraftId } from '../../src/aircraft';
import { mpsToFpm, mpsToKt } from '../../src/core/units';
import type { Gyroplane } from '../../src/physics/Gyroplane';
import type { PoweredAircraft } from '../../src/physics/PoweredAircraft';
import { RUNWAYS } from '../../src/world/layout';
import { flyCircuit, type CircuitSpeeds } from '../helpers/circuit';
import { prerotate, takeOff } from '../helpers/gyroPilot';
import { attitude, fly, makeWorld, startInFlight, TestPilot } from '../helpers/testPilot';
import type { WindModel } from '../../src/physics/wind';

// The automated test pilot: flies each aircraft through the CLAUDE.md test points and
// reports measured against target. Conditions: ISA, calm, field elevation 50 ft, pilot
// 90 kg, full fuel. Speeds indicated unless a row says TAS. Pass = within ±10 %.

export interface FlightTestRow {
  aircraft: string;
  test: string;
  /** Target from CLAUDE.md, or null where it gives none (measured for information). */
  target: number | null;
  measured: number;
  unit: string;
  /** How it was flown. */
  method: string;
  /** A deviation the user has accepted, with the reason (reported, not failed). */
  accepted?: string;
}

/**
 * Deviations from CLAUDE.md the user has accepted, keyed "aircraft id/test". Each says why,
 * so the report explains it rather than hiding it.
 */
export const ACCEPTED_DEVIATIONS: Record<string, string> = {
  'airbike103/Landing roll':
    'accepted 2026-10-19, reconfirmed 2026-10-20: no brakes, so only drag, rolling resistance and the windmilling prop slow it ' +
    '(0.06–0.08 g); 61 m from a 26 kt touchdown would need about 0.14 g. About 110 m on grass, 160 m on gravel.',
};

export const TOLERANCE = 0.1;
export const withinTolerance = (r: FlightTestRow) => r.target === null || Math.abs(r.measured - r.target) <= TOLERANCE * Math.abs(r.target);
/** Within tolerance, or an accepted deviation that still completed. */
export const passes = (r: FlightTestRow) => withinTolerance(r) || (r.accepted !== undefined && !Number.isNaN(r.measured));

/** How the test pilot flies each aircraft (technique, not aircraft data). */
interface Technique {
  /** Wing attitude at the stall break is found from the data; speed reduced from here at 1 kt/s. */
  stallEntryKt?: number;
  cruise: { heightM: number; power: number; startKt: number; tas?: boolean };
  /** Climb: speeds swept at full power, the best rate reported. */
  climbSweepKt: number[];
  /** Fixed-wing three-point attitude, rad; gyro uses its own take-off technique. */
  threePoint?: number;
  circuit?: CircuitSpeeds;
}

const deg = Math.PI / 180;
export const TECHNIQUE: Record<AircraftId, Technique> = {
  airbike103: {
    stallEntryKt: 40,
    cruise: { heightM: 300, power: 0.75, startKt: 47 },
    climbSweepKt: [30, 33, 36, 39, 42, 45],
    threePoint: 10.4 * deg,
    circuit: { climbKt: 39, circuitKt: 45, approachKt: 33, threePointPitch: 10.4 * deg },
  },
  decathlon8kcab: {
    stallEntryKt: 80,
    // 75 % power at 7,500 ft, where a 180 hp engine can still make it: the published cruise.
    cruise: { heightM: 2286, power: 0.75, startKt: 110, tas: true },
    climbSweepKt: [44, 46, 48, 50, 52, 54, 56, 60, 64, 68, 70, 72, 74, 76, 80, 84, 88],
    threePoint: 11 * deg,
    circuit: {
      climbKt: 71,
      circuitKt: 90,
      approachKt: 60,
      threePointPitch: 11 * deg,
      rolloutBrakes: 0.5,
      flareHeight: 5,
      flareThrottle: 0.2,
      circuitHeight: 152,
      downwindOffset: 900,
      baseDistance: 2000,
    },
  },
  bensenB8M: {
    cruise: { heightM: 300, power: 0.45, startKt: 56 },
    climbSweepKt: [35, 40, 45, 50, 55],
  },
};

/** Typical flight rotor speed to start airborne gyro tests with, rad/s (~360 rpm). */
export const FLIGHT_ROTOR = (360 / 60) * 2 * Math.PI;

function airborne(id: AircraftId, heightM: number, kt: number) {
  const { world, ac } = makeWorld(AIRCRAFT[id]);
  startInFlight(ac, heightM, kt, id === 'bensenB8M' ? 0 : 3);
  if (id === 'bensenB8M') (ac as Gyroplane).rotor.omega = FLIGHT_ROTOR;
  return { world, ac, pilot: new TestPilot(ac) };
}

/** Stall: power idle, wings level, slow down 1 kt/s; the stall is where alpha passes CLmax. */
function stall(id: AircraftId, entryKt: number): number {
  const d = AIRCRAFT[id];
  const { world, ac, pilot } = airborne(id, 500, entryKt);
  const alphaStall = d.aero!.alpha_deg[d.aero!.CL.indexOf(Math.max(...d.aero!.CL))] * deg;
  let vs = NaN;
  ac.pilot.throttle = 0;
  fly(world, 90, (t) => {
    pilot.holdSpeedWithPitch(Math.max(entryKt - t, 5));
    pilot.bankTo(0);
    if (ac.state.alpha > alphaStall) {
      vs = mpsToKt(ac.state.ias);
      return true;
    }
  });
  return vs;
}

/** Level flight at a set fraction of rated power: the speed it settles at. */
function cruise(id: AircraftId, c: Technique['cruise']): number {
  const { world, ac, pilot } = airborne(id, c.heightM, c.startKt);
  ac.pilot.propLever = 1;
  fly(world, 150, () => {
    pilot.holdAltitude(c.heightM);
    pilot.bankTo(0);
    pilot.holdPower(c.power);
  });
  return mpsToKt(c.tas ? ac.state.tas : ac.state.ias);
}

/** Full-power climbs at each speed: best rate (Vy), and best angle (Vx). */
function climb(id: AircraftId, speeds: number[]) {
  let best = 0;
  let vy = 0;
  let bestAngle = 0;
  let vx = 0;
  for (const kt of speeds) {
    const { world, ac, pilot } = airborne(id, 100, kt);
    ac.pilot.throttle = 1;
    let vs = 0;
    let tas = 0;
    let n = 0;
    fly(world, 40, (t) => {
      pilot.holdSpeedWithPitch(kt);
      pilot.bankTo(0);
      if (t > 25) {
        vs += ac.state.verticalSpeed;
        tas += ac.state.tas;
        n++;
      }
    });
    const fpm = mpsToFpm(vs / n);
    if (fpm > best) [best, vy] = [fpm, kt];
    if (vs / tas > bestAngle) [bestAngle, vx] = [vs / tas, kt];
  }
  return { fpm: best, vy, vx };
}

/** Fixed-wing three-point take-off on the gravel runway: ground roll to lift-off. */
function takeoffFixedWing(id: AircraftId, threePoint: number): number {
  const { world, ac } = makeWorld(AIRCRAFT[id]);
  ac.placeOnGround(RUNWAYS.gravel.cx, 295, 0, 0, 0.02);
  ac.powerplant.start();
  fly(world, 3, () => {});
  const z0 = ac.body.position.z;
  const pilot = new TestPilot(ac);
  let roll = NaN;
  fly(world, 60, () => {
    ac.pilot.throttle = 1;
    pilot.pitchTo(threePoint);
    pilot.steerOnGround(0);
    if (ac.gear.states.every((s) => !s.inContact)) {
      roll = z0 - ac.body.position.z;
      return true;
    }
  });
  return roll;
}

/** Gyro take-off: prerotate on the brakes, then full power, stick back as it accelerates. */
function takeoffGyro(): number {
  const { world, ac } = makeWorld(AIRCRAFT.bensenB8M);
  const gy = ac as Gyroplane;
  gy.placeOnGround(RUNWAYS.gravel.cx, 290, 0, 0, 0.02);
  gy.powerplant.start();
  prerotate(world, gy);
  return takeOff(world, gy).roll;
}

/** Fixed wing: a full 500 ft circuit, three-point landing; roll from touchdown to stop. */
function landingFixedWing(id: AircraftId, speeds: CircuitSpeeds): number {
  const { world, ac } = makeWorld(AIRCRAFT[id]);
  const r = flyCircuit(world, ac, { x: RUNWAYS.gravel.cx, dir: 1 }, speeds);
  return r.stopped && !r.wingOrNoseStrike ? r.landingRoll : NaN;
}

export interface GyroLanding {
  /** Roll from touchdown to stop, m (NaN if it never stopped). */
  roll: number;
  /** Distance right of the centreline and sideways speed at touchdown (m, m/s). */
  touchdownOffset: number;
  touchdownDrift: number;
  /** Farthest from the centreline on the roll-out, m. */
  maxRolloutOffset: number;
}

/**
 * Gyro landing on runway 36: a power-off final at 45 kt, flare from 8 m holding the sink
 * down with the stick until the speed has bled off, touch down on the mains, then stick
 * fully back (the rotor is a big air brake), power idle and the brakes on. In a crosswind
 * the lateral stick holds the gyro over the centreline with no drift (the disc tilted into
 * wind, the gyro's equivalent of the wing-low method) while the pedals keep the nose straight.
 */
export function landingGyro(wind?: WindModel): GyroLanding {
  const { world, ac } = makeWorld(AIRCRAFT.bensenB8M, 1, wind);
  startInFlight(ac, 60, 45, 0);
  (ac as Gyroplane).rotor.omega = FLIGHT_ROTOR;
  const pilot = new TestPilot(ac);
  ac.body.position.set(RUNWAYS.gravel.cx, 60, 650);
  const gear = -Math.min(...ac.data.gear.legs.map((l) => l.position_m[1]));
  const res: GyroLanding = { roll: NaN, touchdownOffset: NaN, touchdownDrift: NaN, maxRolloutOffset: 0 };
  let phase: 'final' | 'flare' | 'rollout' = 'final';
  let zTouch = 0;
  const holdCentreline = () => {
    const b = ac.body;
    const a = attitude(ac);
    const bankCmd = Math.max(-0.26, Math.min(0.26, -0.12 * b.velocity.x - 0.02 * (b.position.x - RUNWAYS.gravel.cx)));
    ac.pilot.aileron = Math.max(-1, Math.min(1, 2.0 * (bankCmd - a.bank) + 0.6 * b.angularVelocity.z));
    ac.pilot.rudder = Math.max(-1, Math.min(1, 2.5 * Math.atan2(Math.sin(-a.heading), Math.cos(a.heading)) + 0.8 * b.angularVelocity.y));
  };
  fly(world, 120, () => {
    const h = ac.state.heightAgl - gear;
    ac.pilot.throttle = 0;
    if (phase === 'final') {
      pilot.holdSpeedWithPitch(45);
      holdCentreline();
      if (h < 8) phase = 'flare';
    } else if (phase === 'flare') {
      pilot.holdVerticalSpeed(-(0.3 + 0.25 * Math.max(h, 0)));
      holdCentreline();
      if (ac.gear.states.some((s) => s.inContact)) {
        phase = 'rollout';
        zTouch = ac.body.position.z;
        res.touchdownOffset = ac.body.position.x - RUNWAYS.gravel.cx;
        res.touchdownDrift = ac.body.velocity.x;
      }
    } else {
      ac.pilot.elevator = 1;
      ac.pilot.brakeLeft = ac.pilot.brakeRight = 0.5;
      pilot.steerOnGround(-Math.max(-0.15, Math.min(0.15, 0.03 * (ac.body.position.x - RUNWAYS.gravel.cx))));
      // Stick into wind while the rotor runs down, so the crosswind cannot tip the disc and
      // push the gyro sideways (as on the take-off roll).
      ac.pilot.aileron = Math.max(-1, Math.min(1, -0.25 * ac.body.velocity.x - 0.05 * (ac.body.position.x - RUNWAYS.gravel.cx)));
      res.maxRolloutOffset = Math.max(res.maxRolloutOffset, Math.abs(ac.body.position.x - RUNWAYS.gravel.cx));
      if (ac.body.velocity.length() < 0.3) {
        res.roll = zTouch - ac.body.position.z;
        return true;
      }
    }
  });
  return res;
}

/** Full power, holding height: the fastest level speed. */
function maxLevelSpeed(id: AircraftId): number {
  const { world, ac, pilot } = airborne(id, 300, 70);
  ac.pilot.throttle = 1;
  fly(world, 120, () => {
    pilot.holdAltitude(300);
    pilot.bankTo(0);
  });
  return mpsToKt(ac.state.ias);
}

/** Fly the whole programme for one aircraft. */
export function flightTest(id: AircraftId): FlightTestRow[] {
  const d = AIRCRAFT[id];
  const t = d.targets;
  const tech = TECHNIQUE[id];
  const name = d.name;
  const kt = (v?: number) => (v === undefined ? null : mpsToKt(v));
  const rows: FlightTestRow[] = [];
  const row = (test: string, target: number | null, measured: number, unit: string, method: string) =>
    rows.push({ aircraft: name, test, target, measured, unit, method, accepted: ACCEPTED_DEVIATIONS[`${id}/${test}`] });

  if (d.aero && tech.stallEntryKt) row('Stall speed', kt(t.stall_mps), stall(id, tech.stallEntryKt), 'kt', 'idle, wings level, slowing 1 kt/s');
  const c = tech.cruise;
  row(`Cruise${c.tas ? ' (TAS)' : ''}`, kt(t.cruise_mps), cruise(id, c), 'kt', `level at ${c.power * 100} % power, ${Math.round(c.heightM * 3.281)} ft`);
  const cl = climb(id, tech.climbSweepKt);
  row('Climb rate', t.climb_mps === undefined ? null : mpsToFpm(t.climb_mps), cl.fpm, 'fpm', `full power, best of ${tech.climbSweepKt[0]}–${tech.climbSweepKt.at(-1)} kt`);
  if (t.vy_mps) row('Vy (best rate)', kt(t.vy_mps), cl.vy, 'kt', 'speed of best climb rate');
  if (t.vx_mps) row('Vx (best angle)', kt(t.vx_mps), cl.vx, 'kt', 'speed of best climb gradient');
  if (t.maxSpeed_mps) row('Max level speed', kt(t.maxSpeed_mps), maxLevelSpeed(id), 'kt', 'full power, 1,000 ft');
  const to = d.type === 'gyroplane' ? takeoffGyro() : takeoffFixedWing(id, tech.threePoint!);
  row('Take-off roll', t.takeoffRoll_m ?? null, to, 'm', d.type === 'gyroplane' ? 'prerotated to ~330 rpm, gravel' : 'three-point, full power, gravel');
  const ld = d.type === 'gyroplane' ? landingGyro().roll : landingFixedWing(id, tech.circuit!);
  row('Landing roll', t.landingRoll_m ?? null, ld, 'm', d.type === 'gyroplane' ? 'power-off flare, stick back, half brakes' : `500 ft circuit, three-point${tech.circuit!.rolloutBrakes ? ', brakes' : ', no brakes'}`);
  return rows;
}

/** The results as a Markdown table. */
export function reportTable(rows: FlightTestRow[]): string {
  const fmt = (v: number | null, unit: string) => (v === null ? '—' : Number.isNaN(v) ? 'FAILED' : `${unit === 'fpm' || unit === 'm' ? v.toFixed(0) : v.toFixed(1)} ${unit}`);
  const lines = ['| Aircraft | Test | Target | Measured | Error | Result | Method |', '|---|---|---|---|---|---|---|'];
  const notes: string[] = [];
  for (const r of rows) {
    const err = r.target === null ? '—' : `${(((r.measured - r.target) / r.target) * 100).toFixed(1)} %`;
    let result = r.target === null ? 'info' : withinTolerance(r) ? 'PASS' : 'FAIL';
    if (result === 'FAIL' && passes(r)) {
      notes.push(`${r.aircraft} ${r.test.toLowerCase()}: ${r.accepted}`);
      result = `ACCEPTED (note ${notes.length})`;
    }
    lines.push(`| ${r.aircraft} | ${r.test} | ${fmt(r.target, r.unit)} | ${fmt(r.measured, r.unit)} | ${err} | ${result} | ${r.method} |`);
  }
  if (notes.length) lines.push('', 'Accepted deviations:', ...notes.map((n, i) => `${i + 1}. ${n}`));
  return lines.join('\n');
}

/** For tests that need the aircraft object itself. */
export type { PoweredAircraft };
