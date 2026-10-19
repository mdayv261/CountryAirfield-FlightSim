import { mpsToFpm, mpsToKt, mToFt, paToInHg, radToDeg } from '../core/units';
import { Gyroplane } from '../physics/Gyroplane';
import type { PoweredAircraft } from '../physics/PoweredAircraft';

/** Field elevation, ft, so the altimeter reads height above sea level (QNH). */
const FIELD_FT = 50;
/** Stall warning this many degrees below the stalling angle of attack. */
const STALL_MARGIN_DEG = 3;
const COLOUR = { normal: '#7dff9a', warning: '#ff6b6b' };

/**
 * Minimal flight HUD down the left side: the numbers needed to fly until the Stage 7
 * cockpit gauges arrive. Knots, feet, feet per minute and inches of mercury, as in the
 * aircraft. Warnings (stall, G limit, over-stress, over-speed, engine feed) turn it red.
 */
export class Hud {
  private readonly el: HTMLDivElement;
  private lastText = '';
  private stallAlpha = 0;
  visible = true;

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

  update(headingDeg: number): void {
    this.el.style.display = this.visible ? 'block' : 'none';
    if (!this.visible) return;
    const ac = this.aircraft;
    const s = ac.state;
    const pp = ac.powerplant;
    const g = ac.gMonitor;
    const cs = ac.data.propeller?.constantSpeed;
    const alphaDeg = radToDeg(s.alpha);
    const airborne = ac.gear.states.every((w) => !w.inContact);
    const stall = s.ias > 5 && alphaDeg > this.stallAlpha - STALL_MARGIN_DEG && airborne;
    // Slip ball: sideslip shown as a ball offset, like the inclinometer.
    const ballPos = Math.round(Math.max(-3, Math.min(3, radToDeg(s.beta) / 3)));
    const ball = '(' + [-3, -2, -1, 0, 1, 2, 3].map((i) => (i === ballPos ? 'o' : i === 0 ? '|' : '-')).join('') + ')';
    const lines = [
      ac.data.name,
      `IAS  ${mpsToKt(s.ias).toFixed(0).padStart(4)} kt`,
      `ALT  ${(mToFt(ac.body.position.y) + FIELD_FT).toFixed(0).padStart(4)} ft`,
      `AGL  ${mToFt(Math.max(0, s.heightAgl - 1)).toFixed(0).padStart(4)} ft`,
      `VSI  ${mpsToFpm(s.verticalSpeed).toFixed(0).padStart(5)} fpm`,
      `HDG   ${headingDeg.toFixed(0).padStart(3, '0')}°`,
      `RPM  ${pp.out.engineRpm.toFixed(0).padStart(5)}${pp.running ? '' : ' OFF'}`,
    ];
    const gyro = ac instanceof Gyroplane ? ac : null;
    if (gyro) {
      lines.push(`ROTOR${gyro.rotor.rpm.toFixed(0).padStart(5)} rpm${gyro.rotor.out.prerotatorTorque > 0 ? '  PREROTATING' : ''}`);
    }
    if (cs) {
      lines.push(`MAP  ${paToInHg(pp.out.manifoldPressure).toFixed(1).padStart(5)} inHg`);
      lines.push(`PROP ${pp.out.governorRpm.toFixed(0).padStart(5)} rpm set`);
    }
    lines.push(
      `THR  ${(ac.pilot.throttle * 100).toFixed(0).padStart(4)} %`,
      `FUEL ${ac.fuelL.toFixed(1).padStart(5)} L`,
      `G    ${g.g.toFixed(1).padStart(5)}  (${g.max.toFixed(1)} / ${g.min.toFixed(1)})`,
      `AOA  ${alphaDeg.toFixed(0).padStart(4)}°`,
      `SLIP ${ball}`,
    );
    const warnings: string[] = [];
    if (stall) warnings.push('** STALL **');
    if (g.warning) warnings.push('** G LIMIT **');
    if (g.overstressed) warnings.push('OVER-STRESS (Bksp resets)');
    if (g.overspeed) warnings.push('** VNE **');
    else if (g.overspeedLatched) warnings.push('OVERSPEED RECORDED');
    if (gyro) {
      if (gyro.warnings.pushover) warnings.push('** PUSHOVER: POWER OFF, EASE BACK **');
      else if (gyro.warnings.lowG) warnings.push('** LOW G **');
      if (gyro.warnings.lowRotorRpm) warnings.push('** LOW ROTOR RPM **');
      if (gyro.warnings.rotorOverspeed) warnings.push('ROTOR OVERSPEED');
    }
    if (pp.out.fuelStarved) warnings.push('FUEL STARVED (negative g)');
    if (pp.running && pp.out.oilPressure < 0.3 && pp.rpm > 1.5 * ac.data.engine!.idleRpm) warnings.push('LOW OIL PRESSURE');
    if (ac.autoRudderEnabled) lines.push('AUTO-RUDDER');
    lines.push(...warnings);
    const text = lines.join('\n');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.el.style.color = warnings.length ? COLOUR.warning : COLOUR.normal;
      this.lastText = text;
    }
  }
}
