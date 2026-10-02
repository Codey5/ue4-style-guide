// Ocean surface. Same wave trains and gust noise as the physics, so the chop
// you see is the chop the board rides and the dark patches are real gusts.
import * as THREE from 'three';
import { GUST_ADVECT, GUST_EVOLVE, GUST_SCALE } from '../physics/environment.js';

const NOISE_GLSL = /* glsl */ `
float hash3(ivec3 p) {
  uint h = uint(p.x) * 374761393u + uint(p.y) * 668265263u + uint(p.z) * 1440662683u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967295.0;
}
float fade1(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float noise3(vec3 x) {
  vec3 i = floor(x); vec3 f = x - i;
  ivec3 ii = ivec3(i);
  vec3 u = vec3(fade1(f.x), fade1(f.y), fade1(f.z));
  float c000 = hash3(ii), c100 = hash3(ii + ivec3(1,0,0));
  float c010 = hash3(ii + ivec3(0,1,0)), c110 = hash3(ii + ivec3(1,1,0));
  float c001 = hash3(ii + ivec3(0,0,1)), c101 = hash3(ii + ivec3(1,0,1));
  float c011 = hash3(ii + ivec3(0,1,1)), c111 = hash3(ii + ivec3(1,1,1));
  float x00 = mix(c000, c100, u.x), x10 = mix(c010, c110, u.x);
  float x01 = mix(c001, c101, u.x), x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 2.0 - 1.0;
}
float fbm3(vec3 p) {
  return (noise3(p) * 0.6 + noise3(p * vec3(2.03, 2.03, 1.7) + vec3(17.1, 5.3, 0.0)) * 0.28 +
    noise3(p * vec3(4.1, 4.1, 2.9) + vec3(31.7, 11.9, 0.0)) * 0.12) * 1.45;
}
`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec4 uWaveA[8];   // dirX, dirZ, k, omega
uniform vec2 uWaveB[8];   // amplitude, phase
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vDist;
void main() {
  vec3 p = position + vec3(uCenter.x, 0.0, uCenter.z);
  float dist = length(position.xz);
  float fadeW = 1.0 - smoothstep(250.0, 900.0, dist);
  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 a = uWaveA[i];
    float amp = uWaveB[i].x * fadeW;
    float th = a.z * (a.x * p.x + a.y * p.z) - a.w * uTime + uWaveB[i].y;
    float s = sin(th), c = cos(th);
    float q = 0.55 / (a.z * max(uWaveB[i].x, 1e-4) * 8.0 + 1e-3);
    q = min(q, 1.0);
    disp.x += q * amp * a.x * c;
    disp.z += q * amp * a.y * c;
    h += amp * s;
    float wa = a.z * amp;
    n.x -= a.x * wa * c;
    n.z -= a.y * wa * c;
    n.y -= q * wa * s;
  }
  p.xz += disp.xz;
  p.y = h;
  vHeight = h;
  vWorld = p;
  vNormal = normalize(n);
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform float uGustiness;
uniform float uHs;
uniform float uShoreZ;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vDist;
${NOISE_GLSL}
float gustFactor(vec2 xz) {
  if (uGustiness <= 0.0) return 1.0;
  float adv = uWindSpeed * ${GUST_ADVECT.toFixed(3)} * uTime;
  vec3 q = vec3((xz.x - uWindDir.x * adv) / ${GUST_SCALE.toFixed(1)}, (xz.y - uWindDir.y * adv) / ${GUST_SCALE.toFixed(1)}, uTime / ${GUST_EVOLVE.toFixed(1)});
  return 1.0 + 0.42 * uGustiness * clamp(fbm3(q), -1.2, 1.2);
}
vec3 skyColor(vec3 dir) {
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(t, 0.55));
  float sun = max(dot(dir, uSunDir), 0.0);
  c += uSunColor * pow(sun, 350.0) * 6.0 + uSunColor * pow(sun, 8.0) * 0.15;
  return c;
}
void main() {
  vec3 viewVec = cameraPosition - vWorld;
  float camDist = length(viewVec);
  vec3 V = viewVec / camDist;
  float g = gustFactor(vWorld.xz);
  // Wind ripples: small capillary waves running downwind, rougher in gusts.
  float rough = clamp((uWindSpeed * g) / 9.0, 0.05, 1.6);
  vec2 wd = uWindDir;
  vec2 wp = vec2(-wd.y, wd.x);
  vec2 xz = vWorld.xz;
  float detailFade = 1.0 - smoothstep(30.0, 260.0, camDist);
  vec2 r = vec2(0.0);
  r += wd * cos(dot(xz, wd) * 6.3 - uTime * 6.0) * 0.6;
  r += normalize(wd + wp * 0.6) * cos(dot(xz, normalize(wd + wp * 0.6)) * 9.1 - uTime * 7.3) * 0.45;
  r += normalize(wd - wp * 0.7) * cos(dot(xz, normalize(wd - wp * 0.7)) * 12.7 - uTime * 8.8) * 0.35;
  r += wp * cos(dot(xz, wp) * 17.0 + noise3(vec3(xz * 0.3, uTime * 0.4)) * 3.0 - uTime * 4.0) * 0.25;
  vec3 N = normalize(vNormal + vec3(r.x, 0.0, r.y) * 0.09 * rough * (0.35 + 0.65 * detailFade));

  float ndv = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Gusty water reflects less sky: that's why gusts look dark on the water.
  fresnel *= mix(1.0, 0.62, smoothstep(0.95, 1.35, g));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);
  // Shallow water near the beach.
  float shallow = smoothstep(uShoreZ + 160.0, uShoreZ + 20.0, vWorld.z);
  vec3 body = mix(uDeep, uShallow, shallow * 0.8 + clamp(vHeight / max(uHs, 0.05), 0.0, 1.0) * 0.12);
  body *= mix(1.0, 0.82, smoothstep(1.0, 1.35, g));
  float scatter = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.15;
  vec3 col = mix(body + uShallow * scatter, refl, fresnel);
  // Sun glitter.
  vec3 H = normalize(uSunDir + V);
  // Tight glitter: a sparkling path toward the sun rather than broad sheens.
  float shin = mix(2400.0, 700.0, clamp(rough, 0.0, 1.0));
  col += uSunColor * pow(max(dot(N, H), 0.0), shin) * (1.4 + rough * 0.6);
  // Whitecaps on crests once the wind gets up.
  // (Beaufort 4 brings the first white horses; they get frequent from Bft 5-6.)
  float capWind = smoothstep(7.0, 14.0, uWindSpeed * g);
  float crest = smoothstep(0.6, 1.0, vHeight / max(uHs * 0.55, 0.05));
  float foamNoise = noise3(vec3(xz * 1.7, uTime * 0.6)) * 0.5 + 0.5;
  float foam = capWind * crest * smoothstep(0.72 - 0.12 * capWind, 0.92, foamNoise) * (0.25 + 0.75 * detailFade);
  // Breaking shore line.
  float shoreFoam = smoothstep(uShoreZ + 6.0, uShoreZ + 1.0, vWorld.z) * (0.5 + 0.5 * sin(uTime * 0.8 + xz.x * 0.05));
  col = mix(col, vec3(0.92, 0.95, 0.97), clamp(foam * 0.7 + shoreFoam * 0.6, 0.0, 1.0));
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Radial grid: dense near the camera, coarse out to the horizon. */
function radialGrid(rings = 150, segments = 200, r0 = 0.6, rMax = 3200) {
  const positions = [0, 0, 0];
  const indices = [];
  const growth = Math.pow(rMax / r0, 1 / (rings - 1));
  for (let i = 0; i < rings; i++) {
    const r = r0 * Math.pow(growth, i);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segments; j++) indices.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = 1 + i * segments + j, b = 1 + i * segments + ((j + 1) % segments);
      const c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax * 2);
  return geo;
}

export class Water {
  constructor(scene, env) {
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWaveA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uWaveB: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) },
      uSunDir: { value: env.sunDir.clone() },
      uSunColor: { value: env.sunColor.clone() },
      uSkyTop: { value: env.skyTop.clone() },
      uSkyHorizon: { value: env.skyHorizon.clone() },
      uDeep: { value: new THREE.Color(0x0b3a52) },
      uShallow: { value: new THREE.Color(0x2a9a9a) },
      uFogColor: { value: env.fogColor.clone() },
      uFogDensity: { value: env.fogDensity },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWindSpeed: { value: 8 },
      uGustiness: { value: 0.4 },
      uHs: { value: 0.3 },
      uShoreZ: { value: -260 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    this.mesh = new THREE.Mesh(radialGrid(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  setWaves(waves, wind, shoreZ) {
    waves.components.forEach((c, i) => {
      this.uniforms.uWaveA.value[i].set(c.dx, c.dz, c.k, c.omega);
      this.uniforms.uWaveB.value[i].set(c.amp, c.phase);
    });
    const d = wind.dir;
    this.uniforms.uWindDir.value.set(d[0], d[2]);
    this.uniforms.uWindSpeed.value = wind.speed;
    this.uniforms.uGustiness.value = wind.gustiness;
    this.uniforms.uHs.value = waves.hs;
    this.uniforms.uShoreZ.value = shoreZ;
  }

  update(time, camera) {
    this.uniforms.uTime.value = time;
    // Snap the grid centre so the dense rings don't shimmer as the camera moves.
    const s = 0.5;
    this.uniforms.uCenter.value.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
  }
}
