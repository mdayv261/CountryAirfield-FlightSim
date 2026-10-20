import * as THREE from 'three';
import { SKY } from './layout';

const DEG = Math.PI / 180;

/**
 * Sun position for a local solar time (hours), from the field's latitude and the sun's
 * declination (spherical astronomy):
 *   hour angle H = 15° per hour from solar noon,
 *   sin(elevation) = sin φ sin δ + cos φ cos δ cos H,
 *   azimuth (from north, clockwise) = atan2(−sin H, tan δ cos φ − sin φ cos H).
 * In the southern hemisphere the noon sun is due north.
 */
export function sunPosition(hour: number): { azimuthDeg: number; elevationDeg: number } {
  const phi = SKY.latitudeDeg * DEG;
  const dec = SKY.declinationDeg * DEG;
  const H = (hour - 12) * 15 * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { azimuthDeg: ((az / DEG) % 360 + 360) % 360, elevationDeg: el / DEG };
}

/** Unit vector pointing at the sun (world axes: +X east, +Y up, north is −Z). */
export function sunVector(hour: number, out = new THREE.Vector3()): THREE.Vector3 {
  const { azimuthDeg, elevationDeg } = sunPosition(hour);
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/**
 * How the light changes with sun height: full white sunlight above SKY.lowSunDeg, warming
 * and dimming towards the low-sun colour and intensity as the sun nears the horizon (a
 * longer path through the air scatters the blue away).
 */
export function sunLight(elevationDeg: number): { colour: THREE.Color; intensity: number; hemiFactor: number } {
  const t = THREE.MathUtils.clamp(elevationDeg / SKY.lowSunDeg, 0, 1); // 0 at the horizon, 1 high
  const s = t * t * (3 - 2 * t);
  return {
    colour: new THREE.Color(SKY.lowSunColour).lerp(new THREE.Color(SKY.sunColour), s),
    intensity: SKY.lowSunIntensity + (SKY.sunIntensity - SKY.lowSunIntensity) * s,
    hemiFactor: SKY.lowSunHemiFraction + (1 - SKY.lowSunHemiFraction) * s,
  };
}
