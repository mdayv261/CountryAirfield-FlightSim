import { mpsToFpm, mpsToKt, mToFt, radToDeg } from '../core/units';
import type { FixedWingAircraft } from '../physics/FixedWingAircraft';

/** Field elevation, ft, so the altimeter reads height above sea level (QNH). */
const FIELD_FT = 50;
/** Stall warning this many degrees below the stalling angle of attack. */
const STALL_MARGIN_DEG = 3;

/**
 * Minimal flight HUD down the left side: the numbers needed to fly a circuit until the
 * Stage 7 cockpit gauges arrive. Knots, feet and feet per minute, as in the aircraft.
 */
export class Hud {
  private readonly el: HTMLDivElement;
  private lastText = '';
  private readonly stallAlpha: number;
  visible = true;

  constructor(parent: HTMLElement, private readonly aircraft: FixedWingAircraft) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '64px',
      padding: '8px 12px',
      font: 'bold 15px/1.5 ui-monospace, Menlo, monospace',
      color: '#7dff9a',
      background: 'rgba(0, 0, 0, 0.35)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '10',
      textShadow: '0 0 3px #000',
    });
    parent.appendChild(this.el);
    const a = aircraft.data.aero!;
    this.stallAlpha = a.alpha_deg[a.CL.indexOf(Math.max(...a.CL))];
  }

  update(headingDeg: number): void {
    this.el.style.display = this.visible ? 'block' : 'none';
    if (!this.visible) return;
    const ac = this.aircraft;
    const s = ac.state;
    const pp = ac.powerplant;
    const alphaDeg = radToDeg(s.alpha);
    const airborne = ac.gear.states.every((g) => !g.inContact);
    const stall = s.ias > 5 && alphaDeg > this.stallAlpha - STALL_MARGIN_DEG && airborne;
    // Slip ball: sideslip shown as a ball offset, like the inclinometer.
    const ballPos = Math.round(Math.max(-3, Math.min(3, radToDeg(s.beta) / 3)));
    const ball = '(' + [-3, -2, -1, 0, 1, 2, 3].map((i) => (i === ballPos ? 'o' : i === 0 ? '|' : '-')).join('') + ')';
    const lines = [
      `IAS  ${mpsToKt(s.ias).toFixed(0).padStart(4)} kt`,
      `ALT  ${(mToFt(ac.body.position.y) + FIELD_FT).toFixed(0).padStart(4)} ft`,
      `AGL  ${mToFt(Math.max(0, s.heightAgl - 1)).toFixed(0).padStart(4)} ft`,
      `VSI  ${mpsToFpm(s.verticalSpeed).toFixed(0).padStart(5)} fpm`,
      `HDG   ${headingDeg.toFixed(0).padStart(3, '0')}°`,
      `RPM  ${pp.out.engineRpm.toFixed(0).padStart(5)}${pp.running ? '' : ' OFF'}`,
      `THR  ${(ac.pilot.throttle * 100).toFixed(0).padStart(4)} %`,
      `FUEL ${ac.fuelL.toFixed(1).padStart(5)} L`,
      `G    ${s.loadFactor.toFixed(1).padStart(5)}`,
      `AOA  ${alphaDeg.toFixed(0).padStart(4)}°`,
      `SLIP ${ball}`,
    ];
    if (stall) lines.push('** STALL **');
    const text = lines.join('\n');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.el.style.color = stall ? '#ff6b6b' : '#7dff9a';
      this.lastText = text;
    }
  }
}
