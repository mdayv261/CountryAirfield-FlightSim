import type { GaugeData, GaugeKind } from '../aircraft/schema';
import type { InstrumentReadings } from './instruments';

// Round instruments drawn with the 2D canvas: black dials, white markings, coloured arcs,
// as in a light aircraft. Angles are measured clockwise from 12 o'clock, in radians.

const DEG = Math.PI / 180;
const COLOURS = {
  face: '#141414',
  bezel: '#3a3a3a',
  marks: '#f2f2f2',
  needle: '#ffffff',
  tellTale: '#ff9a2e',
  green: '#2fbf4a',
  yellow: '#f3d23a',
  red: '#e0302a',
  white: '#f2f2f2',
  sky: '#3d7fc4',
  ground: '#8a5a2b',
  symbol: '#ffb21e',
};

/** Needle sweep (start and end angle, degrees from 12 o'clock) and default scale of each dial. */
const DIALS: Partial<Record<GaugeKind, { start: number; end: number; min: number; max: number; label: string }>> = {
  asi: { start: -150, end: 150, min: 0, max: 100, label: 'KNOTS' },
  tacho: { start: -135, end: 135, min: 0, max: 7000, label: 'RPM' },
  rotorTacho: { start: -135, end: 135, min: 0, max: 500, label: 'ROTOR RPM' },
  fuel: { start: -60, end: 60, min: 0, max: 20, label: 'FUEL L' },
  egt: { start: -120, end: 120, min: 200, max: 800, label: 'EGT °C' },
  cht: { start: -120, end: 120, min: 50, max: 300, label: 'CHT °C' },
  map: { start: -150, end: 150, min: 10, max: 35, label: 'MAN PRESS' },
  gmeter: { start: -150, end: 150, min: -5, max: 10, label: 'G UNITS' },
};
/** Dials smaller than this radius (canvas px) get fewer scale numbers so they stay legible. */
const SMALL_DIAL_PX = 65;
/** VSI: zero at 9 o'clock, full scale up or down this many degrees either side. */
const VSI_SWEEP_DEG = 170;
/** The inclinometer tube shows apparent gravity up to this angle either side, degrees. */
const SLIP_TUBE_DEG = 16;
/** Attitude indicator: pitch ladder scale, fraction of the dial radius per degree of pitch. */
const ADI_PITCH_PER_DEG = 0.025;
/** Wet compass: degrees of card visible either side of the lubber line. */
const COMPASS_WINDOW_DEG = 35;

/** Angle of a dial needle for a value, clamped to the scale's stops. */
export function dialAngle(value: number, min: number, max: number, startDeg: number, endDeg: number): number {
  const f = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return (startDeg + f * (endDeg - startDeg)) * DEG;
}

/** The scale (min, max, sweep) a gauge uses: the data file's values over the defaults. */
export function dialScale(g: GaugeData) {
  const d = DIALS[g.kind] ?? { start: -150, end: 150, min: 0, max: 1, label: '' };
  return { ...d, min: g.min ?? d.min, max: g.max ?? d.max };
}

/** The value a gauge's main needle (or card, or ball) indicates, in its display units. */
export function gaugeValue(kind: GaugeKind, r: InstrumentReadings): number {
  switch (kind) {
    case 'asi': return r.iasKt;
    case 'altimeter': return r.altitudeFt;
    case 'vsi': return r.vsiFpm;
    case 'tacho': return r.engineRpm;
    case 'rotorTacho': return r.rotorRpm ?? 0;
    case 'slip': return r.slipDeg;
    case 'compass': return r.compassDeg;
    case 'fuel': return r.fuelL;
    case 'egt': return r.egtC ?? 0;
    case 'cht': return r.chtC ?? 0;
    case 'attitude': return r.bankDeg;
    case 'dg': return r.headingDeg;
    case 'map': return r.mapInHg;
    case 'gmeter': return r.g;
  }
}

/** Altimeter hands: 100 ft (one turn per 1,000 ft), 1,000 ft and 10,000 ft hands. */
export function altimeterAngles(ft: number): { hundreds: number; thousands: number; tenThousands: number } {
  return {
    hundreds: ((ft / 1000) % 1) * 2 * Math.PI,
    thousands: ((ft / 10000) % 1) * 2 * Math.PI,
    tenThousands: ((ft / 100000) % 1) * 2 * Math.PI,
  };
}

/** VSI needle angle: zero at 9 o'clock, climb swings it up (clockwise). */
export function vsiAngle(fpm: number, maxFpm: number): number {
  const f = Math.max(-1, Math.min(1, fpm / maxFpm));
  return (-90 + f * VSI_SWEEP_DEG) * DEG;
}

/** Slip ball position across the tube, −1 (left stop) .. 1 (right stop). */
export function slipBallPosition(slipDeg: number): number {
  return Math.max(-1, Math.min(1, slipDeg / SLIP_TUBE_DEG));
}

const polar = (cx: number, cy: number, r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

/** A tidy step for scale numbers (1, 2, 2.5 or 5 times a power of ten) giving about n labels. */
function niceStep(range: number, n: number): number {
  const raw = range / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function face(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.fillStyle = COLOURS.bezel;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.92, 0, 2 * Math.PI);
  ctx.fillStyle = COLOURS.face;
  ctx.fill();
}

function needle(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number, a: number, width: number, colour = COLOURS.needle): void {
  const [x, y] = polar(cx, cy, len, a);
  const [tx, ty] = polar(cx, cy, len * 0.18, a + Math.PI);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function hub(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.07, 0, 2 * Math.PI);
  ctx.fillStyle = '#555';
  ctx.fill();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, colour = COLOURS.marks): void {
  ctx.fillStyle = colour;
  ctx.font = `bold ${Math.max(6, Math.round(size))}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

/** A coloured band along the scale, between two values. */
function arc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, width: number, a0: number, a1: number, colour: string): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  // Canvas measures from 3 o'clock; ours from 12 o'clock.
  ctx.arc(cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2);
  ctx.stroke();
}

/** A conventional dial: arcs, ticks, numbers, label and one needle. */
function dial(ctx: CanvasRenderingContext2D, g: GaugeData, value: number, cx: number, cy: number, R: number, divisor = 1): void {
  const sc = dialScale(g);
  const ang = (v: number) => dialAngle(v, sc.min, sc.max, sc.start, sc.end);
  face(ctx, cx, cy, R);
  const band = R * 0.08;
  const rBand = R * 0.84;
  if (g.white) arc(ctx, cx, cy, rBand - band, band * 0.7, ang(g.white[0]), ang(g.white[1]), COLOURS.white);
  if (g.green) arc(ctx, cx, cy, rBand, band, ang(g.green[0]), ang(g.green[1]), COLOURS.green);
  if (g.yellow) arc(ctx, cx, cy, rBand, band, ang(g.yellow[0]), ang(g.yellow[1]), COLOURS.yellow);
  if (g.redline !== undefined) {
    const a = ang(g.redline);
    ctx.strokeStyle = COLOURS.red;
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.92, a));
    ctx.lineTo(...polar(cx, cy, R * 0.68, a));
    ctx.stroke();
  }
  const step = niceStep((sc.max - sc.min) / divisor, R < SMALL_DIAL_PX ? 3 : 5) * divisor;
  ctx.strokeStyle = COLOURS.marks;
  for (let v = Math.ceil(sc.min / (step / 2)) * (step / 2); v <= sc.max + 1e-9; v += step / 2) {
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const a = ang(v);
    ctx.lineWidth = major ? R * 0.035 : R * 0.02;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.9, a));
    ctx.lineTo(...polar(cx, cy, R * (major ? 0.74 : 0.8), a));
    ctx.stroke();
    if (major) {
      const [x, y] = polar(cx, cy, R * 0.58, a);
      text(ctx, `${Math.round((v / divisor) * 10) / 10}`, x, y, R * 0.17);
    }
  }
  text(ctx, sc.label + (divisor > 1 ? ` x${divisor}` : ''), cx, cy + R * 0.38, R * 0.12);
  needle(ctx, cx, cy, R * 0.82, ang(value), R * 0.05);
  hub(ctx, cx, cy, R);
}

function altimeter(ctx: CanvasRenderingContext2D, ft: number, cx: number, cy: number, R: number): void {
  face(ctx, cx, cy, R);
  ctx.strokeStyle = COLOURS.marks;
  for (let i = 0; i < 50; i++) {
    const a = (i / 50) * 2 * Math.PI;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? R * 0.035 : R * 0.018;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.9, a));
    ctx.lineTo(...polar(cx, cy, R * (major ? 0.74 : 0.82), a));
    ctx.stroke();
    if (major) text(ctx, `${i / 5}`, ...polar(cx, cy, R * 0.6, a), R * 0.18);
  }
  text(ctx, 'ALT', cx, cy - R * 0.3, R * 0.12);
  text(ctx, 'FEET', cx, cy + R * 0.3, R * 0.1);
  const h = altimeterAngles(Math.max(ft, 0));
  needle(ctx, cx, cy, R * 0.4, h.tenThousands, R * 0.03);
  needle(ctx, cx, cy, R * 0.55, h.thousands, R * 0.07);
  needle(ctx, cx, cy, R * 0.84, h.hundreds, R * 0.045);
  hub(ctx, cx, cy, R);
}

function vsi(ctx: CanvasRenderingContext2D, fpm: number, maxFpm: number, cx: number, cy: number, R: number): void {
  face(ctx, cx, cy, R);
  const step = niceStep(maxFpm, 2);
  ctx.strokeStyle = COLOURS.marks;
  for (let v = -maxFpm; v <= maxFpm + 1e-9; v += step / 2) {
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const a = vsiAngle(v, maxFpm);
    ctx.lineWidth = major ? R * 0.035 : R * 0.02;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.9, a));
    ctx.lineTo(...polar(cx, cy, R * (major ? 0.74 : 0.8), a));
    ctx.stroke();
    if (major) text(ctx, `${Math.abs(v) / 100}`, ...polar(cx, cy, R * 0.58, a), R * 0.17);
  }
  text(ctx, 'UP', cx - R * 0.25, cy - R * 0.38, R * 0.11);
  text(ctx, 'DN', cx - R * 0.25, cy + R * 0.38, R * 0.11);
  text(ctx, 'FPM x100', cx + R * 0.18, cy + R * 0.12, R * 0.1);
  needle(ctx, cx, cy, R * 0.82, vsiAngle(fpm, maxFpm), R * 0.05);
  hub(ctx, cx, cy, R);
}

/** Inclinometer: a curved glass tube with a black ball, between two reference wires. */
function slip(ctx: CanvasRenderingContext2D, slipDeg: number, cx: number, cy: number, R: number): void {
  const w = R * 2;
  const h = R * 0.7;
  ctx.fillStyle = COLOURS.bezel;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  // The tube is an arc of a circle centred above it.
  const rc = R * 2.4;
  const ccy = cy - rc + h * 0.15;
  const half = Math.asin((w * 0.42) / rc);
  ctx.strokeStyle = '#d8d0b0';
  ctx.lineWidth = h * 0.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, ccy, rc, Math.PI / 2 - half, Math.PI / 2 + half);
  ctx.stroke();
  ctx.strokeStyle = '#111';
  ctx.lineWidth = R * 0.04;
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 + s * h * 0.28 / rc;
    ctx.beginPath();
    ctx.moveTo(cx + (rc - h * 0.3) * Math.cos(a), ccy + (rc - h * 0.3) * Math.sin(a));
    ctx.lineTo(cx + (rc + h * 0.3) * Math.cos(a), ccy + (rc + h * 0.3) * Math.sin(a));
    ctx.stroke();
  }
  // Ball to the right means a positive position; angles grow clockwise, i.e. to the left at the bottom.
  const a = Math.PI / 2 - slipBallPosition(slipDeg) * half * 0.92;
  ctx.beginPath();
  ctx.arc(cx + rc * Math.cos(a), ccy + rc * Math.sin(a), h * 0.2, 0, 2 * Math.PI);
  ctx.fillStyle = '#0b0b0b';
  ctx.fill();
}

/**
 * Wet (whiskey) compass: a card floating in fluid, seen edge-on through a window. The card is
 * read from behind, so the numbers run the "wrong" way: turning right, the card appears to
 * move right, with higher headings to the left of the lubber line, as in the real thing.
 */
function compass(ctx: CanvasRenderingContext2D, hdg: number, cx: number, cy: number, R: number): void {
  face(ctx, cx, cy, R);
  const w = R * 1.5;
  const h = R * 0.7;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - w / 2, cy - h / 2, w, h);
  ctx.clip();
  ctx.fillStyle = '#e8e2cf';
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  const pxPerDeg = w / 2 / COMPASS_WINDOW_DEG;
  const base = Math.floor((hdg - COMPASS_WINDOW_DEG) / 5) * 5;
  ctx.strokeStyle = '#111';
  for (let d = base; d <= hdg + COMPASS_WINDOW_DEG + 5; d += 5) {
    const x = cx - (d - hdg) * pxPerDeg;
    const major = d % 30 === 0;
    ctx.lineWidth = major ? R * 0.03 : R * 0.015;
    ctx.beginPath();
    ctx.moveTo(x, cy + h / 2);
    ctx.lineTo(x, cy + h / 2 - (major ? h * 0.35 : h * 0.2));
    ctx.stroke();
    if (major) {
      const n = ((d % 360) + 360) % 360;
      const name = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[n] ?? `${n / 10}`;
      text(ctx, name, x, cy - h * 0.12, R * 0.22, '#111');
    }
  }
  ctx.restore();
  ctx.strokeStyle = COLOURS.red;
  ctx.lineWidth = R * 0.04;
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2 - R * 0.05);
  ctx.lineTo(cx, cy + h / 2 + R * 0.05);
  ctx.stroke();
  text(ctx, 'COMPASS', cx, cy + R * 0.6, R * 0.11);
}

function attitude(ctx: CanvasRenderingContext2D, pitchDeg: number, bankDeg: number, cx: number, cy: number, R: number): void {
  face(ctx, cx, cy, R);
  const r = R * 0.88;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.clip();
  ctx.translate(cx, cy);
  // Right wing down: the horizon tilts the other way (anticlockwise on the dial).
  ctx.rotate(-bankDeg * DEG);
  const dy = pitchDeg * ADI_PITCH_PER_DEG * R;
  ctx.fillStyle = COLOURS.sky;
  ctx.fillRect(-2 * r, -2 * r + dy, 4 * r, 2 * r);
  ctx.fillStyle = COLOURS.ground;
  ctx.fillRect(-2 * r, dy, 4 * r, 2 * r);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = R * 0.025;
  ctx.beginPath();
  ctx.moveTo(-2 * r, dy);
  ctx.lineTo(2 * r, dy);
  ctx.stroke();
  for (const p of [-20, -10, 10, 20]) {
    const y = dy - p * ADI_PITCH_PER_DEG * R;
    const half = Math.abs(p) === 10 ? R * 0.22 : R * 0.32;
    ctx.lineWidth = R * 0.018;
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(half, y);
    ctx.stroke();
    text(ctx, `${Math.abs(p)}`, half + R * 0.1, y, R * 0.1, '#fff');
  }
  ctx.restore();
  // Bank scale (fixed) at 10, 20, 30, 60 degrees, and the pointer that turns with the horizon.
  ctx.strokeStyle = '#fff';
  for (const b of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) {
    ctx.lineWidth = b % 30 === 0 ? R * 0.03 : R * 0.018;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.9, b * DEG));
    ctx.lineTo(...polar(cx, cy, R * (b % 30 === 0 ? 0.76 : 0.82), b * DEG));
    ctx.stroke();
  }
  const pa = -bankDeg * DEG;
  ctx.fillStyle = COLOURS.symbol;
  ctx.beginPath();
  ctx.moveTo(...polar(cx, cy, R * 0.74, pa));
  ctx.lineTo(...polar(cx, cy, R * 0.62, pa - 0.08));
  ctx.lineTo(...polar(cx, cy, R * 0.62, pa + 0.08));
  ctx.fill();
  // Miniature aircraft.
  ctx.strokeStyle = COLOURS.symbol;
  ctx.lineWidth = R * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx - R * 0.45, cy);
  ctx.lineTo(cx - R * 0.15, cy);
  ctx.lineTo(cx, cy + R * 0.08);
  ctx.lineTo(cx + R * 0.15, cy);
  ctx.lineTo(cx + R * 0.45, cy);
  ctx.stroke();
}

/** Directional gyro: a compass card that turns under a fixed lubber line. */
function dg(ctx: CanvasRenderingContext2D, hdg: number, cx: number, cy: number, R: number): void {
  face(ctx, cx, cy, R);
  ctx.strokeStyle = COLOURS.marks;
  for (let d = 0; d < 360; d += 5) {
    const a = (d - hdg) * DEG;
    const major = d % 10 === 0;
    ctx.lineWidth = major ? R * 0.03 : R * 0.016;
    ctx.beginPath();
    ctx.moveTo(...polar(cx, cy, R * 0.88, a));
    ctx.lineTo(...polar(cx, cy, R * (major ? 0.76 : 0.81), a));
    ctx.stroke();
    if (d % 30 === 0) {
      const name = ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[d] ?? `${d / 10}`;
      ctx.save();
      ctx.translate(...polar(cx, cy, R * 0.62, a));
      ctx.rotate(a);
      text(ctx, name, 0, 0, R * 0.17);
      ctx.restore();
    }
  }
  ctx.fillStyle = COLOURS.symbol;
  ctx.beginPath();
  ctx.moveTo(cx, cy - R * 0.74);
  ctx.lineTo(cx - R * 0.06, cy - R * 0.92);
  ctx.lineTo(cx + R * 0.06, cy - R * 0.92);
  ctx.fill();
  ctx.strokeStyle = COLOURS.symbol;
  ctx.lineWidth = R * 0.045;
  ctx.beginPath();
  ctx.moveTo(cx, cy - R * 0.3);
  ctx.lineTo(cx, cy + R * 0.3);
  ctx.moveTo(cx - R * 0.25, cy - R * 0.05);
  ctx.lineTo(cx + R * 0.25, cy - R * 0.05);
  ctx.moveTo(cx - R * 0.1, cy + R * 0.25);
  ctx.lineTo(cx + R * 0.1, cy + R * 0.25);
  ctx.stroke();
}

/** Draw one gauge, centred at (cx, cy) with radius R in canvas pixels. */
export function drawGauge(ctx: CanvasRenderingContext2D, g: GaugeData, r: InstrumentReadings, cx: number, cy: number, R: number): void {
  switch (g.kind) {
    case 'altimeter':
      return altimeter(ctx, r.altitudeFt, cx, cy, R);
    case 'vsi':
      return vsi(ctx, r.vsiFpm, g.max ?? 2000, cx, cy, R);
    case 'slip':
      return slip(ctx, r.slipDeg, cx, cy, R);
    case 'compass':
      return compass(ctx, r.compassDeg, cx, cy, R);
    case 'attitude':
      return attitude(ctx, r.pitchDeg, r.bankDeg, cx, cy, R);
    case 'dg':
      return dg(ctx, r.headingDeg, cx, cy, R);
    case 'tacho': {
      const max = dialScale(g).max;
      return dial(ctx, g, r.engineRpm, cx, cy, R, max > 5000 ? 1000 : 100);
    }
    case 'rotorTacho':
      return dial(ctx, g, r.rotorRpm ?? 0, cx, cy, R, 100);
    case 'gmeter': {
      dial(ctx, g, r.g, cx, cy, R);
      const sc = dialScale(g);
      // Tell-tale needles left at the highest and lowest g since the last reset.
      needle(ctx, cx, cy, R * 0.7, dialAngle(r.gMax, sc.min, sc.max, sc.start, sc.end), R * 0.03, COLOURS.tellTale);
      needle(ctx, cx, cy, R * 0.7, dialAngle(r.gMin, sc.min, sc.max, sc.start, sc.end), R * 0.03, COLOURS.tellTale);
      needle(ctx, cx, cy, R * 0.82, dialAngle(r.g, sc.min, sc.max, sc.start, sc.end), R * 0.05);
      return hub(ctx, cx, cy, R);
    }
    default:
      return dial(ctx, g, gaugeValue(g.kind, r), cx, cy, R);
  }
}
