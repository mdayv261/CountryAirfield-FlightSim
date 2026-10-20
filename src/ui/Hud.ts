import type { InstrumentReadings } from '../cockpit/instruments';
import { radToDeg } from '../core/units';
import { Gyroplane } from '../physics/Gyroplane';
import type { PoweredAircraft } from '../physics/PoweredAircraft';

/** Stall warning this many degrees below the stalling angle of attack. */
const STALL_MARGIN_DEG = 3;
/** Below this rotor rpm, while prerotating at low engine rpm, remind the pilot to add power. */
const AIRCRAFT_PREROT_HINT_RPM = 300;
const COLOUR = { normal: '#7dff9a', warning: '#ff6b6b' };

const pad = (v: number, n: number) => v.toFixed(0).padStart(n);

/**
 * The HUD's flight lines: airspeed, altitude, heading, vertical speed, G and wind. Made from
 * the same instrument readings as the panel gauges, so the two always agree.
 */
export function hudFlightLines(r: InstrumentReadings): string[] {
  return [
    `IAS  ${pad(r.iasKt, 4)} kt`,
    `ALT  ${pad(r.altitudeFt, 5)} ft   AGL ${pad(r.aglFt, 4)} ft`,
    `HDG   ${Math.round(r.headingDeg % 360).toString().padStart(3, '0')}°`,
    `VSI  ${pad(r.vsiFpm, 5)} fpm`,
    `G    ${r.g.toFixed(1).padStart(5)}  (${r.gMax.toFixed(1)} / ${r.gMin.toFixed(1)})`,
    `WIND ${Math.round(r.windFromDeg % 360).toString().padStart(3, '0')}° / ${pad(r.windKt, 2)} kt`,
  ];
}

/**
 * Flight HUD down the left side (I toggles it): the flight lines above, then engine and
 * rotor numbers. Warnings (stall, G limit, over-stress, over-speed, engine feed, gyro low g
 * and rotor rpm) turn it red, and stay on screen even with the HUD switched off.
 */
export class Hud {
  private readonly el: HTMLDivElement;
  private lastText = '';
  private stallAlpha = 0;
  /** Shown in the current view (outside views and the cockpit; not the free camera). */
  visible = true;
  /** The pilot's HUD switch. */
  enabled = true;

  constructor(parent: HTMLElement, private aircraft: PoweredAircraft) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '64px',
      padding: '8px 12px',
      font: 'bold 15px/1.5 ui-monospace, Menlo, monospace',
      color: COLOUR.normal,
      background: 'rgba(0, 0, 0, 0.35)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '10',
      textShadow: '0 0 3px #000',
    });
    parent.appendChild(this.el);
    this.setAircraft(aircraft);
  }

  setAircraft(aircraft: PoweredAircraft): void {
    this.aircraft = aircraft;
    const a = aircraft.data.aero;
    // Gyroplanes have no wing to stall: no stall warning.
    this.stallAlpha = a ? a.alpha_deg[a.CL.indexOf(Math.max(...a.CL))] : Infinity;
    this.lastText = '';
  }

  /** Warning messages for the current state (also shown with the HUD switched off). */
  warnings(): string[] {
    const ac = this.aircraft;
    const s = ac.state;
    const pp = ac.powerplant;
    const g = ac.gMonitor;
    const airborne = ac.gear.states.every((w) => !w.inContact);
    const out: string[] = [];
    if (s.ias > 5 && radToDeg(s.alpha) > this.stallAlpha - STALL_MARGIN_DEG && airborne) out.push('** STALL **');
    if (g.warning) out.push('** G LIMIT **');
    if (g.overstressed) out.push('OVER-STRESS (Bksp resets)');
    if (g.overspeed) out.push('** VNE **');
    else if (g.overspeedLatched) out.push('OVERSPEED RECORDED');
    if (ac instanceof Gyroplane) {
      if (ac.warnings.pushover) out.push('** PUSHOVER: POWER OFF, EASE BACK **');
      else if (ac.warnings.lowG) out.push('** LOW G **');
      if (ac.warnings.lowRotorRpm) out.push('** LOW ROTOR RPM **');
      if (ac.warnings.rotorOverspeed) out.push('ROTOR OVERSPEED');
      if (ac.warnings.teeter) out.push('** ROTOR TEETER: EASE CONTROLS **');
    }
    if (pp.out.fuelStarved) out.push('FUEL STARVED (negative g)');
    if (pp.running && pp.out.oilPressure < 0.3 && pp.rpm > 1.5 * ac.data.engine!.idleRpm) out.push('LOW OIL PRESSURE');
    return out;
  }

  update(r: InstrumentReadings): void {
    const warnings = this.visible ? this.warnings() : [];
    const show = this.visible && (this.enabled || warnings.length > 0);
    this.el.style.display = show ? 'block' : 'none';
    if (!show) return;
    const ac = this.aircraft;
    const pp = ac.powerplant;
    const cs = ac.data.propeller?.constantSpeed;
    const lines: string[] = [];
    if (this.enabled) {
      lines.push(ac.data.name, ...hudFlightLines(r), `RPM  ${pad(r.engineRpm, 5)}${pp.running ? '' : ' OFF'}`);
      if (ac instanceof Gyroplane) {
        const prerotating = ac.pilot.prerotator > 0 && pp.running;
        const lowPower = prerotating && ac.prerotatorEngagement() < 0.8 && ac.rotor.rpm < AIRCRAFT_PREROT_HINT_RPM;
        lines.push(`ROTOR${pad(r.rotorRpm ?? 0, 5)} rpm${prerotating ? '  PREROTATING' : ''}`);
        if (lowPower) lines.push('  add power: ~2600 engine rpm');
        if (ac.pilot.prerotator > 0 && !pp.running) lines.push('  engine off: press E to start');
      }
      if (cs) {
        lines.push(`MAP  ${r.mapInHg.toFixed(1).padStart(5)} inHg`);
        lines.push(`PROP ${pad(pp.out.governorRpm, 5)} rpm set`);
      }
      lines.push(`THR  ${pad(r.throttle * 100, 4)} %`, `FUEL ${r.fuelL.toFixed(1).padStart(5)} L`);
      if (r.chtC !== null) lines.push(`CHT  ${pad(r.chtC, 4)} °C   EGT ${pad(r.egtC ?? 0, 4)} °C`);
      // Slip ball as text, like the inclinometer: the ball sits where apparent gravity points.
      const ballPos = Math.round(Math.max(-3, Math.min(3, r.slipDeg / 3)));
      const ball = '(' + [-3, -2, -1, 0, 1, 2, 3].map((i) => (i === ballPos ? 'o' : i === 0 ? '|' : '-')).join('') + ')';
      lines.push(`AOA  ${pad(radToDeg(ac.state.alpha), 4)}°`, `SLIP ${ball}`);
      if (ac.autoRudderEnabled) lines.push('AUTO-RUDDER');
    }
    lines.push(...warnings);
    const text = lines.join('\n');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.el.style.color = warnings.length ? COLOUR.warning : COLOUR.normal;
      this.lastText = text;
    }
  }
}
