import type { UnitSettings } from '../core/settings';
import { DEFAULT_SETTINGS } from '../core/settings';

// Display units for the HUD. The instruments (InstrumentReadings) work in ft, fpm, °C, L and
// inHg; these convert to the user's choice. Speeds stay in knots everywhere (CLAUDE.md).

const FT_TO_M = 0.3048;
const FPM_TO_MPS = 0.00508;
const L_PER_US_GAL = 3.785411784;
const HPA_PER_INHG = 33.8638866667;

export interface Shown {
  value: number;
  unit: string;
}

export function altitude(ft: number, u: UnitSettings = DEFAULT_SETTINGS.units): Shown {
  return u.altitude === 'm' ? { value: ft * FT_TO_M, unit: 'm' } : { value: ft, unit: 'ft' };
}

export function verticalSpeed(fpm: number, u: UnitSettings = DEFAULT_SETTINGS.units): Shown {
  return u.verticalSpeed === 'm/s' ? { value: fpm * FPM_TO_MPS, unit: 'm/s' } : { value: fpm, unit: 'fpm' };
}

export function temperature(c: number, u: UnitSettings = DEFAULT_SETTINGS.units): Shown {
  return u.temperature === 'F' ? { value: (c * 9) / 5 + 32, unit: '°F' } : { value: c, unit: '°C' };
}

export function fuel(litres: number, u: UnitSettings = DEFAULT_SETTINGS.units): Shown {
  return u.fuel === 'USgal' ? { value: litres / L_PER_US_GAL, unit: 'gal' } : { value: litres, unit: 'L' };
}

export function pressure(inHg: number, u: UnitSettings = DEFAULT_SETTINGS.units): Shown {
  return u.pressure === 'hPa' ? { value: inHg * HPA_PER_INHG, unit: 'hPa' } : { value: inHg, unit: 'inHg' };
}
