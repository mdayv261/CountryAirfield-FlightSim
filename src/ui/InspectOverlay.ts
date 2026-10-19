import { mpsToKt } from '../core/units';

const fmt = (v: number, w = 7, d = 1) => v.toFixed(d).padStart(w);

export interface InspectInfo {
  x: number;
  y: number;
  z: number;
  headingDeg: number;
  /** Camera speed, m/s (shown in knots). */
  speedMps: number;
  windFromDeg: number;
  windKt: number;
  /** Extra status lines (wind preset, controls, test block). */
  extra: string[];
  measure: Array<{ x: number; z: number }>;
  measureDistance: number | null;
}

const HELP =
  'FLY: Tab aircraft · arrows stick · Z/C rudder · U auto-rudder · +/- throttle · Home/End prop rpm · B brakes · E engine · V view (chase/cockpit/free) · 7 8 9 0 spawn gravel36/grass36/gravel18/grass18 · Bksp reset\n' +
  'FREE CAM: drag look · WASD move · R/F up/down · Shift fast · wheel speed · 1-6 views · M measure · T throw test block\n' +
  '[ ] wind speed · , . wind dir · N wind preset · K keyboard flight · J mouse stick · O controls · X axes · P pause · H help';

/** Bottom-left readout for the inspection camera, plus a centre crosshair for measuring. */
export class InspectOverlay {
  private readonly el: HTMLDivElement;
  private showHelp = true;
  private lastText = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      padding: '6px 10px',
      font: '12px/1.4 ui-monospace, Menlo, monospace',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.45)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      zIndex: '10',
    });
    parent.appendChild(this.el);

    const cross = document.createElement('div');
    Object.assign(cross.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: '14px',
      height: '14px',
      marginLeft: '-7px',
      marginTop: '-7px',
      pointerEvents: 'none',
      zIndex: '10',
      background:
        'linear-gradient(#fff,#fff) center/2px 100% no-repeat, linear-gradient(#fff,#fff) center/100% 2px no-repeat',
      mixBlendMode: 'difference',
    });
    parent.appendChild(cross);
  }

  toggleHelp(): void {
    this.showHelp = !this.showHelp;
  }

  update(i: InspectInfo): void {
    const lines = [
      `pos x${fmt(i.x)}  y${fmt(i.y)}  z${fmt(i.z)} m   hdg ${fmt(i.headingDeg, 3, 0)}°`,
      `fly speed ${fmt(mpsToKt(i.speedMps), 4, 0)} kt    wind ${fmt(i.windFromDeg, 3, 0).replace(/ /g, '0')}° / ${fmt(i.windKt, 2, 0)} kt`,
    ];
    lines.push(...i.extra);
    if (i.measure.length) {
      const pts = i.measure.map((p) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).join(' → ');
      const d = i.measureDistance === null ? '' : `  =  ${i.measureDistance.toFixed(1)} m`;
      lines.push(`measure ${pts}${d}`);
    }
    if (this.showHelp) lines.push(HELP);
    const text = lines.join('\n');
    if (text !== this.lastText) {
      this.el.textContent = text;
      this.lastText = text;
    }
  }
}
