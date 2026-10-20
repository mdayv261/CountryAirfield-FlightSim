import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, sanitiseSettings, saveSettings, SETTINGS_KEY } from '../src/core/settings';
import * as units from '../src/ui/units';

/** An in-memory stand-in for localStorage. */
function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('settings', () => {
  it('survive a reload: what is saved is what loads', () => {
    const store = memoryStore();
    const s = structuredClone(DEFAULT_SETTINGS);
    s.aircraft = 'bensenB8M';
    s.start = 'apron';
    s.wind = { preset: -1, fromDeg: 270, speedKt: 12, gustKt: 7, turbulence: 'moderate' };
    s.timeOfDay = 16.25;
    s.units.altitude = 'm';
    s.units.verticalSpeed = 'm/s';
    s.sound = { volume: 0.4, muted: true };
    s.controls.autoRudder = true;
    expect(saveSettings(s, store)).toBe(true);
    expect(store.data.has(SETTINGS_KEY)).toBe(true);
    expect(loadSettings(store)).toEqual(s);
  });

  it('start from the defaults when nothing is saved, or storage is unavailable', () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false);
  });

  it('a damaged or old save cannot break the sim: bad values fall back, numbers are clamped', () => {
    const store = memoryStore();
    store.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    const s = sanitiseSettings({
      aircraft: 'concorde',
      start: 'moon',
      wind: { preset: 2.5, fromDeg: 450, speedKt: 99, gustKt: -4, turbulence: 'hurricane' },
      timeOfDay: 23,
      units: { altitude: 'furlongs' },
      sound: { volume: 3 },
    });
    expect(s.aircraft).toBe(DEFAULT_SETTINGS.aircraft);
    expect(s.start).toBe(DEFAULT_SETTINGS.start);
    expect(s.wind.preset).toBe(DEFAULT_SETTINGS.wind.preset);
    expect(s.wind.fromDeg).toBe(90);
    expect(s.wind.speedKt).toBe(40);
    expect(s.wind.gustKt).toBe(0);
    expect(s.wind.turbulence).toBe(DEFAULT_SETTINGS.wind.turbulence);
    expect(s.timeOfDay).toBe(17); // daylight only
    expect(s.units.altitude).toBe('ft');
    expect(s.sound.volume).toBe(1);
    expect(s.controls).toEqual(DEFAULT_SETTINGS.controls);
  });
});

describe('display units', () => {
  const metric = { ...DEFAULT_SETTINGS.units, altitude: 'm', verticalSpeed: 'm/s', temperature: 'F', fuel: 'USgal', pressure: 'hPa' } as const;
  it('convert from the instrument units (ft, fpm, °C, L, inHg)', () => {
    expect(units.altitude(1000, metric).value).toBeCloseTo(304.8, 6);
    expect(units.verticalSpeed(1000, metric).value).toBeCloseTo(5.08, 6);
    expect(units.temperature(100, metric).value).toBeCloseTo(212, 6);
    expect(units.fuel(151, metric).value).toBeCloseTo(39.89, 2); // the Decathlon's 40 US gal
    expect(units.pressure(29.92, metric).value).toBeCloseTo(1013.2, 1);
  });
  it('leave the defaults alone', () => {
    expect(units.altitude(1000)).toEqual({ value: 1000, unit: 'ft' });
    expect(units.verticalSpeed(500)).toEqual({ value: 500, unit: 'fpm' });
    expect(units.temperature(20)).toEqual({ value: 20, unit: '°C' });
  });
});
