import { AxisCalibrator, detectMovedInput } from '../input/axis';
import { BIPOLAR, CHANNEL_LABELS, CHANNELS, type Channel } from '../input/controls';
import { GamepadInput, shortName } from '../input/GamepadInput';
import { GAMEPAD } from '../input/inputConfig';
import type { InputManager } from '../input/InputManager';

type Mode =
  | { kind: 'idle' }
  | { kind: 'bind'; channel: Channel; baselines: Map<string, number[]> }
  | { kind: 'calibrate'; channel: Channel; calibrator: AxisCalibrator };

const CSS = `
.cal { position: fixed; inset: 5vh 50% auto auto; transform: translateX(50%); width: min(760px, 94vw);
  max-height: 88vh; overflow: auto; z-index: 20; padding: 14px 18px; border-radius: 8px;
  background: rgba(20, 26, 34, 0.94); color: #e8edf2; font: 13px/1.45 system-ui, sans-serif; }
.cal h2 { font-size: 16px; margin: 0 0 6px; } .cal h3 { font-size: 13px; margin: 14px 0 6px; color: #9fb3c8; }
.cal .hint { color: #aab6c2; margin: 4px 0; } .cal .status { color: #ffd166; min-height: 1.4em; margin: 6px 0; }
.cal table { width: 100%; border-collapse: collapse; } .cal td { padding: 3px 4px; vertical-align: middle; }
.cal .bar { position: relative; display: inline-block; vertical-align: middle; height: 10px; width: 120px; background: #33404d; border-radius: 3px; }
.cal .fill { position: absolute; top: 0; bottom: 0; background: #4fb3ff; border-radius: 3px; }
.cal .mid { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: #8899aa; }
.cal button { background: #2f4b66; color: #fff; border: 0; border-radius: 4px; padding: 3px 8px; cursor: pointer; font: inherit; }
.cal button:hover { background: #3d6286; } .cal button.on { background: #b5651d; }
.cal .dev { margin: 4px 0 8px; } .cal .axes { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.cal .ax { display: flex; align-items: center; gap: 4px; font: 11px ui-monospace, Menlo, monospace; }
.cal .ax .bar { width: 70px; } .cal .muted { color: #7f8c99; } .cal input[type=range] { width: 80px; }
`;

/**
 * Controls and calibration screen (key O). Shows every connected joystick, yoke and pedal
 * set with live axis bars, and lets you, for each control channel:
 *  - Bind: move the control you want and the screen picks the axis that moved most;
 *  - Calibrate: sweep it through its full range, release it to rest, press Done;
 *  - set the dead zone and invert it, or clear the binding.
 * Bindings are saved in the browser and restored next time.
 */
export class CalibrationScreen {
  private readonly el: HTMLDivElement;
  private mode: Mode = { kind: 'idle' };
  private layoutKey = '';
  private status = '';

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'cal';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    // Keep camera drag and the mouse stick from reacting to clicks inside the panel.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(): void {
    this.el.style.display = this.visible ? 'none' : 'block';
    this.mode = { kind: 'idle' };
    this.status = '';
    this.layoutKey = '';
  }

  /** Call every frame; cheap when hidden. */
  update(): void {
    if (!this.visible) return;
    const g = this.input.gamepads;
    this.runMode(g);
    const key = JSON.stringify([g.devices.map((d) => [d.id, d.axes.length, d.buttons.length]), g.bindings, this.mode.kind, this.input.mouse.enabled, this.input.keyboardEnabled, this.input.aids]);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.render();
    }
    this.refreshLive();
  }

  private runMode(g: GamepadInput): void {
    const m = this.mode;
    if (m.kind === 'bind') {
      for (const d of g.devices) {
        const base = m.baselines.get(d.id);
        if (!base) {
          m.baselines.set(d.id, GamepadInput.inputs(d));
          continue;
        }
        const moved = detectMovedInput(base, GamepadInput.inputs(d), GAMEPAD.bindThreshold);
        if (moved !== null) {
          g.bind(m.channel, d, moved);
          this.status = `${CHANNEL_LABELS[m.channel]} bound to ${shortName(d.id)} ${moved < d.axes.length ? `axis ${moved}` : `button ${moved - d.axes.length}`}. Now calibrate it.`;
          this.mode = { kind: 'idle' };
          return;
        }
      }
    } else if (m.kind === 'calibrate') {
      const b = g.bindings[m.channel];
      const raw = b ? g.raw(b) : undefined;
      if (raw !== undefined) m.calibrator.sample(raw);
    }
  }

  private finishCalibration(channel: Channel): void {
    const g = this.input.gamepads;
    const b = g.bindings[channel];
    const m = this.mode;
    if (!b || m.kind !== 'calibrate') return;
    const raw = g.raw(b);
    // Unipolar controls (throttle, brakes) have no centre; keep the low end as "rest".
    const rest = raw ?? b.cal.centre;
    const before = b.cal;
    b.cal = m.calibrator.finish(BIPOLAR[channel] ? rest : before.centre, before);
    g.save();
    this.status = b.cal === before ? 'That control hardly moved; calibration unchanged.' : `${CHANNEL_LABELS[channel]} calibrated.`;
    this.mode = { kind: 'idle' };
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    const action = t.dataset.action!;
    const ch = t.dataset.channel as Channel | undefined;
    const g = this.input.gamepads;
    switch (action) {
      case 'close':
        this.toggle();
        break;
      case 'bind':
        this.mode = { kind: 'bind', channel: ch!, baselines: new Map() };
        this.status = `Move the control for ${CHANNEL_LABELS[ch!]} firmly…`;
        break;
      case 'cancel':
        this.mode = { kind: 'idle' };
        this.status = '';
        break;
      case 'calibrate':
        this.mode = { kind: 'calibrate', channel: ch!, calibrator: new AxisCalibrator() };
        this.status = BIPOLAR[ch!]
          ? `Move ${CHANNEL_LABELS[ch!]} to both ends of its travel, let it return to centre, then press Done.`
          : `Move ${CHANNEL_LABELS[ch!]} from closed/released to fully open/pressed, then press Done.`;
        break;
      case 'done':
        this.finishCalibration(ch!);
        break;
      case 'clear':
        g.clear(ch!);
        this.status = `${CHANNEL_LABELS[ch!]} now uses the keyboard.`;
        break;
      case 'defaults':
        g.resetToDefaults();
        this.status = 'Bindings reset to defaults.';
        break;
      case 'mouse':
        this.input.mouse.enabled = !this.input.mouse.enabled;
        break;
      case 'autoRudder':
        this.input.setAutoRudder(!this.input.aids.autoRudder);
        break;
      case 'keyboard':
        this.input.keyboardEnabled = !this.input.keyboardEnabled;
        break;
    }
    this.layoutKey = '';
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const ch = t.dataset.channel as Channel;
    const b = this.input.gamepads.bindings[ch];
    if (!b) return;
    if (t.dataset.action === 'invert') b.cal.invert = t.checked;
    if (t.dataset.action === 'deadzone') b.cal.deadzone = Number(t.value);
    this.input.gamepads.save();
  }

  private render(): void {
    const g = this.input.gamepads;
    const m = this.mode;
    const devices = g.devices.length
      ? g.devices
          .map(
            (d) => `<div class="dev"><b>${esc(shortName(d.id))}</b> <span class="muted">${d.mapping || 'raw'} · ${d.axes.length} axes · ${d.buttons.length} buttons</span>
            <div class="axes">${d.axes
              .map((_, i) => `<span class="ax">a${i} <span class="bar"><span class="mid"></span><span class="fill" data-dev="${esc(d.id)}" data-axis="${i}"></span></span></span>`)
              .join('')}</div></div>`,
          )
          .join('')
      : `<p class="hint">No joystick or pedals detected. Plug them in and press any button on each.</p>`;

    const rows = CHANNELS.map((ch) => {
      const b = g.bindings[ch];
      const dev = b && g.device(b.deviceId);
      const where = b
        ? `${esc(shortName(b.deviceId))} ${b.kind} ${b.index}${dev ? '' : ' <span class="muted">(not connected)</span>'}`
        : '<span class="muted">keyboard</span>';
      const busy = m.kind !== 'idle' && m.channel === ch;
      const buttons = busy
        ? m.kind === 'calibrate'
          ? `<button data-action="done" data-channel="${ch}" class="on">Done</button> <button data-action="cancel">Cancel</button>`
          : `<button data-action="cancel" class="on">Cancel</button>`
        : `<button data-action="bind" data-channel="${ch}">Bind</button>` +
          (b ? ` <button data-action="calibrate" data-channel="${ch}">Calibrate</button> <button data-action="clear" data-channel="${ch}">Clear</button>` : '');
      const options = b
        ? `<label><input type="checkbox" data-action="invert" data-channel="${ch}" ${b.cal.invert ? 'checked' : ''}> invert</label>
           <label>dead zone <input type="range" min="0" max="0.3" step="0.01" value="${b.cal.deadzone}" data-action="deadzone" data-channel="${ch}"></label>`
        : '';
      return `<tr><td>${CHANNEL_LABELS[ch]}</td>
        <td><span class="bar">${BIPOLAR[ch] ? '<span class="mid"></span>' : ''}<span class="fill" data-out="${ch}"></span></span></td>
        <td>${where}</td><td>${buttons}</td><td>${options}</td></tr>`;
    }).join('');

    this.el.innerHTML = `
      <h2>Controls and calibration <button data-action="close" style="float:right">Close (O)</button></h2>
      <p class="hint">Bars show live output. Joystick axes override the mouse and keyboard for any channel they are bound to.</p>
      <h3>Devices</h3>${devices}
      <h3>Control channels</h3><table>${rows}</table>
      <div class="status">${esc(this.status)}</div>
      <p><button data-action="defaults">Reset joystick bindings</button>
         <button data-action="keyboard" class="${this.input.keyboardEnabled ? 'on' : ''}">Keyboard flight keys: ${this.input.keyboardEnabled ? 'ON' : 'off'} (K)</button>
         <button data-action="mouse" class="${this.input.mouse.enabled ? 'on' : ''}">Mouse stick: ${this.input.mouse.enabled ? 'ON' : 'off'} (J)</button>
         <button data-action="autoRudder" class="${this.input.aids.autoRudder ? 'on' : ''}">Auto-coordinated rudder: ${this.input.aids.autoRudder ? 'ON' : 'off'} (U)</button></p>
      <p class="hint">Auto-rudder keeps the slip ball centred in flight. It adds to your own rudder, and is inactive on the ground and below about 15 kt.</p>
      <p class="hint">Keyboard: arrows = stick, Z/C = rudder, +/− or PgUp/PgDn = throttle, Home/End = prop lever, B = brakes.
      Mouse stick: pointer offset from screen centre; down = stick back.</p>`;
  }

  /** Update the bars without rebuilding the panel. */
  private refreshLive(): void {
    const g = this.input.gamepads;
    this.el.querySelectorAll<HTMLElement>('.fill[data-axis]').forEach((f) => {
      const d = g.device(f.dataset.dev!);
      const v = d ? d.axes[Number(f.dataset.axis)] : 0;
      setBar(f, v, true);
    });
    this.el.querySelectorAll<HTMLElement>('.fill[data-out]').forEach((f) => {
      const ch = f.dataset.out as Channel;
      setBar(f, this.input.controls[ch], BIPOLAR[ch]);
    });
  }
}

/** Fill a bar: bipolar bars grow from the middle, unipolar from the left. */
function setBar(f: HTMLElement, v: number, bipolar: boolean): void {
  const c = Math.max(-1, Math.min(1, v || 0));
  if (bipolar) {
    f.style.left = `${50 + Math.min(c, 0) * 50}%`;
    f.style.width = `${Math.abs(c) * 50}%`;
  } else {
    f.style.left = '0';
    f.style.width = `${Math.max(0, c) * 100}%`;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
