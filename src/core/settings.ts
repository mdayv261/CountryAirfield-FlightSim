// User settings: everything the menu sets, saved in browser storage so it survives a reload.
// Stored as JSON under one key; anything missing or invalid falls back to its default, so an
// old or hand-edited save can never break the sim.

import type { AircraftId } from '../aircraft';
import type { TurbulenceLevel } from '../physics/windPresets';
import type { GraphicsSetting } from '../ui/quality';

export const SETTINGS_KEY = 'cfs.settings.v1';

export const START_POSITIONS = ['apron', 'gravel 36', 'grass 36', 'gravel 18', 'grass 18'] as const;
export type StartPosition = (typeof START_POSITIONS)[number];

/** Display units. Speeds are always knots (CLAUDE.md); these cover the rest of the HUD. */
export interface UnitSettings {
  altitude: 'ft' | 'm';
  verticalSpeed: 'fpm' | 'm/s';
  temperature: 'C' | 'F';
  fuel: 'L' | 'USgal';
  pressure: 'inHg' | 'hPa';
}

export interface Settings {
  aircraft: AircraftId;
  start: StartPosition;
  wind: {
    /** Index into WIND_PRESETS, or -1 for custom values. */
    preset: number;
    fromDeg: number;
    speedKt: number;
    gustKt: number;
    turbulence: TurbulenceLevel;
  };
  /** Local solar time, hours (daylight only: see SKY.dayStartHour / dayEndHour). */
  timeOfDay: number;
  units: UnitSettings;
  sound: { volume: number; muted: boolean };
  /** Graphics quality: auto steps down by itself if the machine cannot hold 60 fps. */
  graphics: GraphicsSetting;
  controls: { keyboardFlight: boolean; mouseStick: boolean; autoRudder: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  aircraft: 'airbike103',
  start: 'gravel 36',
  wind: { preset: 1, fromDeg: 0, speedKt: 8, gustKt: 0, turbulence: 'light' },
  timeOfDay: 11,
  units: { altitude: 'ft', verticalSpeed: 'fpm', temperature: 'C', fuel: 'L', pressure: 'inHg' },
  sound: { volume: 0.8, muted: false },
  graphics: 'auto',
  controls: { keyboardFlight: true, mouseStick: false, autoRudder: false },
};

const AIRCRAFT_IDS: AircraftId[] = ['airbike103', 'decathlon8kcab', 'bensenB8M'];
const TURBULENCE: TurbulenceLevel[] = ['none', 'light', 'moderate', 'severe'];
/** Allowed range of each number setting (the menu uses the same limits). */
export const SETTING_LIMITS = {
  windSpeedKt: [0, 40],
  gustKt: [0, 20],
  timeOfDay: [7, 17],
  volume: [0, 1],
} as const;

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Turn anything (a parsed save, possibly old or damaged) into complete, valid settings. */
export function sanitiseSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = isObj(raw) ? raw : {};
  const w = isObj(r.wind) ? r.wind : {};
  const u = isObj(r.units) ? r.units : {};
  const s = isObj(r.sound) ? r.sound : {};
  const c = isObj(r.controls) ? r.controls : {};
  return {
    aircraft: oneOf(r.aircraft, AIRCRAFT_IDS, d.aircraft),
    start: oneOf(r.start, START_POSITIONS, d.start),
    wind: {
      preset: typeof w.preset === 'number' && Number.isInteger(w.preset) && w.preset >= -1 ? w.preset : d.wind.preset,
      fromDeg: typeof w.fromDeg === 'number' && Number.isFinite(w.fromDeg) ? ((w.fromDeg % 360) + 360) % 360 : d.wind.fromDeg,
      speedKt: num(w.speedKt, SETTING_LIMITS.windSpeedKt, d.wind.speedKt),
      gustKt: num(w.gustKt, SETTING_LIMITS.gustKt, d.wind.gustKt),
      turbulence: oneOf(w.turbulence, TURBULENCE, d.wind.turbulence),
    },
    timeOfDay: num(r.timeOfDay, SETTING_LIMITS.timeOfDay, d.timeOfDay),
    units: {
      altitude: oneOf(u.altitude, ['ft', 'm'] as const, d.units.altitude),
      verticalSpeed: oneOf(u.verticalSpeed, ['fpm', 'm/s'] as const, d.units.verticalSpeed),
      temperature: oneOf(u.temperature, ['C', 'F'] as const, d.units.temperature),
      fuel: oneOf(u.fuel, ['L', 'USgal'] as const, d.units.fuel),
      pressure: oneOf(u.pressure, ['inHg', 'hPa'] as const, d.units.pressure),
    },
    sound: { volume: num(s.volume, SETTING_LIMITS.volume, d.sound.volume), muted: bool(s.muted, d.sound.muted) },
    graphics: oneOf(r.graphics, ['auto', 'high', 'medium', 'low'] as const, d.graphics),
    controls: {
      keyboardFlight: bool(c.keyboardFlight, d.controls.keyboardFlight),
      mouseStick: bool(c.mouseStick, d.controls.mouseStick),
      autoRudder: bool(c.autoRudder, d.controls.autoRudder),
    },
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked (private window, file:// in some browsers)
  }
}

/** Read the saved settings (defaults for anything missing or invalid). */
export function loadSettings(store: Store | null = defaultStore()): Settings {
  try {
    const text = store?.getItem(SETTINGS_KEY);
    return sanitiseSettings(text ? JSON.parse(text) : {});
  } catch {
    return sanitiseSettings({});
  }
}

/** Save settings. Returns false if storage is unavailable (they then last for this session). */
export function saveSettings(s: Settings, store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
