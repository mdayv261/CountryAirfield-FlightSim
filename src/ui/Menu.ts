import { AIRCRAFT, type AircraftId } from '../aircraft';
import { SETTING_LIMITS, START_POSITIONS, type Settings } from '../core/settings';
import { WIND_PRESETS, type TurbulenceLevel } from '../physics/windPresets';

/** What changed, so the sim can apply just that (respawn only for aircraft and start position). */
export type MenuChange = 'aircraft' | 'start' | 'wind' | 'time' | 'units' | 'sound' | 'controls';

const STYLE = `
.menu { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgba(10, 16, 24, 0.55); z-index: 50; font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #e9eef3; }
.menu.open { display: flex; }
.menu .card { background: #1b2430; border: 1px solid #3a4a5c; border-radius: 10px; padding: 18px 22px;
  width: min(820px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.menu h1 { font-size: 18px; margin: 0 0 4px; }
.menu .sub { color: #9fb0c2; margin-bottom: 12px; font-size: 12px; }
.menu .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.menu fieldset { border: 1px solid #34465a; border-radius: 8px; padding: 8px 12px 10px; margin: 0; min-width: 0; }
.menu legend { color: #ffd479; padding: 0 4px; font-weight: 600; }
.menu label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 5px 0; }
.menu label.check { justify-content: flex-start; }
.menu label > select, .menu label > input[type=range] { flex: 1 1 auto; min-width: 0; max-width: 60%; }
.menu label > span:first-child { flex: 0 0 auto; }
.menu select, .menu button { background: #26323f; color: #e9eef3; border: 1px solid #46596e; border-radius: 5px; padding: 3px 6px; font: inherit; }
.menu button { cursor: pointer; padding: 6px 14px; }
.menu button.primary { background: #2f6fc0; border-color: #4b8de0; }
.menu .val { min-width: 64px; text-align: right; color: #ffd479; font-variant-numeric: tabular-nums; }
.menu .row { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
.menu .note { color: #8fa1b4; font-size: 12px; }
`;

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/**
 * The settings menu (Esc): aircraft, start position, wind, time of day, controls, units and
 * sound. Every change is applied at once and saved (the owner does both via onChange).
 */
export class Menu {
  private readonly el: HTMLDivElement;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly onChange: (what: MenuChange) => void,
    private readonly actions: { openControlMapping: () => void; resetDefaults: () => void },
  ) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'menu';
    // Clicks on the dark backdrop close the menu; clicks inside the card do not.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    parent.appendChild(this.el);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.render();
    this.el.classList.add('open');
  }

  close(): void {
    this.open = false;
    this.el.classList.remove('open');
  }

  /** Re-draw from the current settings (call after keys change something while it is open). */
  refresh(): void {
    if (this.open) this.render();
  }

  private render(): void {
    const s = this.settings;
    const ids = Object.keys(AIRCRAFT) as AircraftId[];
    const opt = (v: string, label: string, sel: boolean) => `<option value="${v}"${sel ? ' selected' : ''}>${label}</option>`;
    const range = (id: string, [lo, hi]: readonly [number, number], step: number, v: number) =>
      `<input type="range" id="${id}" min="${lo}" max="${hi}" step="${step}" value="${v}">`;
    const check = (id: string, label: string, v: boolean) => `<label class="check"><input type="checkbox" id="${id}"${v ? ' checked' : ''}> ${label}</label>`;
    const turb: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];
    this.el.innerHTML = `
      <div class="card" role="dialog" aria-label="Settings">
        <h1>Country Airfield Flight Sim</h1>
        <div class="sub">Settings are saved in this browser. Esc closes the menu.</div>
        <div class="grid">
          <fieldset><legend>Aircraft</legend>
            ${ids.map((id) => `<label class="check"><input type="radio" name="ac" value="${id}"${s.aircraft === id ? ' checked' : ''}> ${AIRCRAFT[id].name}</label>`).join('')}
          </fieldset>
          <fieldset><legend>Start position</legend>
            <label>Start at <select id="start">${START_POSITIONS.map((p) => opt(p, p === 'apron' ? 'Apron (engine running)' : `Threshold ${p}`, s.start === p)).join('')}</select></label>
            <div class="note">Changing the aircraft or start position puts you back on the ground there.</div>
          </fieldset>
          <fieldset><legend>Wind</legend>
            <label>Preset <select id="preset">${opt('-1', 'Custom', s.wind.preset < 0)}${WIND_PRESETS.map((p, i) => opt(String(i), p.name, s.wind.preset === i)).join('')}</select></label>
            <label>From ${range('wdir', [0, 350], 10, s.wind.fromDeg)} <span class="val" id="wdirv">${String(Math.round(s.wind.fromDeg)).padStart(3, '0')}°</span></label>
            <label>Speed ${range('wspd', SETTING_LIMITS.windSpeedKt, 1, s.wind.speedKt)} <span class="val" id="wspdv">${s.wind.speedKt} kt</span></label>
            <label>Gusts ${range('gust', SETTING_LIMITS.gustKt, 1, s.wind.gustKt)} <span class="val" id="gustv">+${s.wind.gustKt} kt</span></label>
            <label>Turbulence <select id="turb">${turb.map((t) => opt(t, t, s.wind.turbulence === t)).join('')}</select></label>
            <div class="note">Runways 36/18: wind from 090 or 270 is a direct crosswind.</div>
          </fieldset>
          <fieldset><legend>Time of day</legend>
            <label>Time ${range('time', SETTING_LIMITS.timeOfDay, 0.25, s.timeOfDay)} <span class="val" id="timev">${hhmm(s.timeOfDay)}</span></label>
            <div class="note">Daylight only. Local solar time: the sun is due north at 12:00.</div>
          </fieldset>
          <fieldset><legend>Controls</legend>
            ${check('kbd', 'Keyboard flight keys (K)', s.controls.keyboardFlight)}
            ${check('mouse', 'Mouse as stick (J)', s.controls.mouseStick)}
            ${check('arud', 'Auto-coordinated rudder (U)', s.controls.autoRudder)}
            <label><span>Joystick and pedals</span> <button id="mapping">Control mapping…</button></label>
          </fieldset>
          <fieldset><legend>Units (HUD)</legend>
            <label>Altitude <select id="u-alt">${opt('ft', 'feet', s.units.altitude === 'ft')}${opt('m', 'metres', s.units.altitude === 'm')}</select></label>
            <label>Vertical speed <select id="u-vs">${opt('fpm', 'ft/min', s.units.verticalSpeed === 'fpm')}${opt('m/s', 'm/s', s.units.verticalSpeed === 'm/s')}</select></label>
            <label>Temperature <select id="u-temp">${opt('C', '°C', s.units.temperature === 'C')}${opt('F', '°F', s.units.temperature === 'F')}</select></label>
            <label>Fuel <select id="u-fuel">${opt('L', 'litres', s.units.fuel === 'L')}${opt('USgal', 'US gallons', s.units.fuel === 'USgal')}</select></label>
            <label>Manifold pressure <select id="u-map">${opt('inHg', 'inHg', s.units.pressure === 'inHg')}${opt('hPa', 'hPa', s.units.pressure === 'hPa')}</select></label>
            <div class="note">Airspeed is always in knots. Panel gauges keep their own markings.</div>
          </fieldset>
          <fieldset><legend>Sound</legend>
            <label>Volume ${range('vol', SETTING_LIMITS.volume, 0.05, s.sound.volume)} <span class="val" id="volv">${Math.round(s.sound.volume * 100)} %</span></label>
            ${check('mute', 'Mute', s.sound.muted)}
            <div class="note">Sound starts with your first key press or click.</div>
          </fieldset>
        </div>
        <div class="row"><button id="defaults">Reset to defaults</button><button class="primary" id="fly">Fly</button></div>
      </div>`;
    this.wire();
  }

  private wire(): void {
    const s = this.settings;
    const $ = <T extends HTMLElement>(id: string) => this.el.querySelector<T>(`#${id}`)!;
    const on = (id: string, ev: 'input' | 'change', fn: (el: HTMLInputElement & HTMLSelectElement) => void) =>
      $<HTMLInputElement & HTMLSelectElement>(id).addEventListener(ev, (e) => fn(e.target as HTMLInputElement & HTMLSelectElement));
    this.el.querySelectorAll<HTMLInputElement>('input[name=ac]').forEach((r) =>
      r.addEventListener('change', () => {
        s.aircraft = r.value as AircraftId;
        this.onChange('aircraft');
      }),
    );
    on('start', 'change', (el) => {
      s.start = el.value as Settings['start'];
      this.onChange('start');
    });
    on('preset', 'change', (el) => {
      const i = Number(el.value);
      s.wind.preset = i;
      if (i >= 0) {
        const p = WIND_PRESETS[i];
        Object.assign(s.wind, { fromDeg: p.fromDeg % 360, speedKt: p.speedKt, gustKt: p.gustKt, turbulence: p.turbulence });
      }
      this.onChange('wind');
      this.render();
    });
    const custom = () => {
      s.wind.preset = -1;
      $<HTMLSelectElement>('preset').value = '-1';
      this.onChange('wind');
    };
    on('wdir', 'input', (el) => {
      s.wind.fromDeg = Number(el.value);
      $('wdirv').textContent = `${el.value.padStart(3, '0')}°`;
      custom();
    });
    on('wspd', 'input', (el) => {
      s.wind.speedKt = Number(el.value);
      $('wspdv').textContent = `${el.value} kt`;
      custom();
    });
    on('gust', 'input', (el) => {
      s.wind.gustKt = Number(el.value);
      $('gustv').textContent = `+${el.value} kt`;
      custom();
    });
    on('turb', 'change', (el) => {
      s.wind.turbulence = el.value as TurbulenceLevel;
      custom();
    });
    on('time', 'input', (el) => {
      s.timeOfDay = Number(el.value);
      $('timev').textContent = hhmm(s.timeOfDay);
      this.onChange('time');
    });
    on('kbd', 'change', (el) => {
      s.controls.keyboardFlight = el.checked;
      this.onChange('controls');
    });
    on('mouse', 'change', (el) => {
      s.controls.mouseStick = el.checked;
      this.onChange('controls');
    });
    on('arud', 'change', (el) => {
      s.controls.autoRudder = el.checked;
      this.onChange('controls');
    });
    $('mapping').addEventListener('click', () => {
      this.close();
      this.actions.openControlMapping();
    });
    const unit = (id: string, key: keyof Settings['units']) =>
      on(id, 'change', (el) => {
        (s.units as unknown as Record<string, string>)[key] = el.value;
        this.onChange('units');
      });
    unit('u-alt', 'altitude');
    unit('u-vs', 'verticalSpeed');
    unit('u-temp', 'temperature');
    unit('u-fuel', 'fuel');
    unit('u-map', 'pressure');
    on('vol', 'input', (el) => {
      s.sound.volume = Number(el.value);
      $('volv').textContent = `${Math.round(s.sound.volume * 100)} %`;
      this.onChange('sound');
    });
    on('mute', 'change', (el) => {
      s.sound.muted = el.checked;
      this.onChange('sound');
    });
    $('defaults').addEventListener('click', () => {
      this.actions.resetDefaults();
      this.render();
    });
    $('fly').addEventListener('click', () => this.close());
  }
}
