import * as THREE from 'three';
import { SKY } from './layout';

/** Unit vector pointing at the sun, from SKY azimuth (clockwise from north) and elevation. */
export function sunDirection(): THREE.Vector3 {
  const az = (SKY.sunAzimuthDeg * Math.PI) / 180;
  const el = (SKY.sunElevationDeg * Math.PI) / 180;
  // North is -Z, east is +X.
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/**
 * Sky dome: a gradient from pale hazy blue at the horizon to deep blue overhead, with a
 * sun disc and glow. The shader uses only the view direction, so the sky is effectively
 * infinitely far away and never needs to follow the camera. It is drawn first with no
 * depth test, so everything else paints over it.
 */
export function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color(SKY.zenith) },
      horizon: { value: new THREE.Color(SKY.horizon) },
      sunColour: { value: new THREE.Color(SKY.sunColour) },
      sunDir: { value: sunDirection() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Rotate the direction into view space but ignore camera position (w = 0).
        vec3 viewDir = (viewMatrix * vec4(position, 0.0)).xyz;
        gl_Position = projectionMatrix * vec4(viewDir, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 sunColour;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float e = max(dir.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(e, 0.45));
        float d = max(dot(dir, sunDir), 0.0);
        col += sunColour * (0.35 * pow(d, 400.0) + 0.12 * pow(d, 12.0));
        col = mix(col, sunColour * 1.6, smoothstep(0.99988, 0.99994, d));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}
