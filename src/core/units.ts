// Unit conversions. Physics is SI throughout; use these only at the display / data-entry edge.

export const M_PER_FT = 0.3048;
export const MPS_PER_KT = 1852 / 3600; // 1 nautical mile = 1852 m exactly
export const M_PER_IN = 0.0254;
export const W_PER_HP = 745.699872; // mechanical horsepower
export const M3_PER_L = 0.001;

export const ftToM = (ft: number): number => ft * M_PER_FT;
export const mToFt = (m: number): number => m / M_PER_FT;
export const ktToMps = (kt: number): number => kt * MPS_PER_KT;
export const mpsToKt = (mps: number): number => mps / MPS_PER_KT;
export const fpmToMps = (fpm: number): number => (fpm * M_PER_FT) / 60;
export const mpsToFpm = (mps: number): number => (mps * 60) / M_PER_FT;
export const inToM = (inch: number): number => inch * M_PER_IN;
export const mToIn = (m: number): number => m / M_PER_IN;
export const hpToW = (hp: number): number => hp * W_PER_HP;
export const wToHp = (w: number): number => w / W_PER_HP;
export const lToM3 = (l: number): number => l * M3_PER_L;
export const m3ToL = (m3: number): number => m3 / M3_PER_L;
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
export const PA_PER_INHG = 3386.389;
export const paToInHg = (pa: number): number => pa / PA_PER_INHG;
