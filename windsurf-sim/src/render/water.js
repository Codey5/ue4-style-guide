// Ocean surface. Same wave trains and gust noise as the physics, so the chop
// you see is the chop the board rides and the dark patches are real gusts.
import * as THREE from 'three';
import { GUST_ADVECT, GUST_EVOLVE, GUST_SCALE } from '../physics/environment.js';
import { SHELTER_GLSL } from '../physics/spot.js';
import { SKY_GLSL } from './scene.js';

export const NOISE_GLSL = /* glsl */ `
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
uniform float uSpacing;   // vertex spacing of the radial grid per metre of distance
uniform vec4 uWaveA[8];   // dirX, dirZ, k, omega
uniform vec2 uWaveB[8];   // amplitude, phase
uniform vec2 uWindDir;
varying vec3 vWorld;
varying vec2 vBase;
varying float vHeight;
${SHELTER_GLSL}
void main() {
  vec3 p = position + vec3(uCenter.x, 0.0, uCenter.z);
  vBase = p.xz;
  float dist = length(position.xz);
  // Only displace the mesh with waves it has enough vertices to draw; the
  // rest are drawn per pixel as normals. Stops the far water swimming.
  float spacing = max(0.1, dist * uSpacing);
  float far = 1.0 - smoothstep(600.0, 1400.0, dist);
  float shel = shelterAt(p.xz, uWindDir);
  vec2 disp = vec2(0.0);
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 a = uWaveA[i];
    float lambda = 6.2831853 / a.z;
    float amp = uWaveB[i].x * smoothstep(2.5 * spacing, 5.0 * spacing, lambda) * far * shel;
    float th = a.z * (a.x * p.x + a.y * p.z) - a.w * uTime + uWaveB[i].y;
    float q = min(0.55 / (a.z * max(uWaveB[i].x, 1e-4) * 8.0 + 1e-3), 1.0);
    disp += q * amp * a.xy * cos(th);
    h += amp * sin(th);
  }
  p.xz += disp;
  p.y = h;
  vHeight = h;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
${SKY_GLSL}
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform float uGustiness;
uniform float uHs;
uniform float uShoreZ;
uniform vec4 uWaveA[8];
uniform vec2 uWaveB[8];
varying vec3 vWorld;
varying vec2 vBase;
varying float vHeight;
${NOISE_GLSL}
${SHELTER_GLSL}
float gustFactor(vec2 xz) {
  if (uGustiness <= 0.0) return 1.0;
  float adv = uWindSpeed * ${GUST_ADVECT.toFixed(3)} * uTime;
  vec3 q = vec3((xz.x - uWindDir.x * adv) / ${GUST_SCALE.toFixed(1)}, (xz.y - uWindDir.y * adv) / ${GUST_SCALE.toFixed(1)}, uTime / ${GUST_EVOLVE.toFixed(1)});
  return 1.0 + 0.42 * uGustiness * clamp(fbm3(q), -1.2, 1.2);
}
vec3 skyColor(vec3 dir) {
  float sun = max(dot(dir, uSunDir), 0.0);
  return skyBase(dir) + uSunColor * pow(sun, 350.0) * 6.0;
}
// How much of a pattern with wavelength lambda survives at this pixel size:
// the procedural equivalent of mip-mapping. Detail smaller than a few pixels
// is faded out instead of aliasing into shimmer.
float keep(float lambda, float fp) { return 1.0 - smoothstep(lambda / 8.0, lambda / 3.0, fp); }

void main() {
  vec3 viewVec = cameraPosition - vWorld;
  float camDist = length(viewVec);
  vec3 V = viewVec / camDist;
  vec2 xz = vWorld.xz;
  float fp = max(length(fwidth(vBase)), 1e-4); // metres per pixel
  float g = gustFactor(xz);
  float rough = clamp((uWindSpeed * g) / 9.0, 0.05, 1.6);
  vec2 wd = uWindDir;
  vec2 wp = vec2(-wd.y, wd.x);

  // Wind lanes: long bands of rougher and slicker water lined up with the wind.
  float along = dot(xz, wd), across = dot(xz, wp);
  float drift = uTime * uWindSpeed * 0.035;
  float windy = smoothstep(4.5, 9.0, uWindSpeed * g);
  float lane = noise3(vec3((along - drift) / 140.0, across / 9.0, uTime * 0.01)) * keep(18.0, fp);
  rough *= 1.0 + 0.3 * lane * windy;

  // Chop: the same wave trains as the physics, as per-pixel normals. Also the
  // surface height and its slope along the wind, for the whitecaps.
  vec3 n = vec3(0.0, 1.0, 0.0);
  float lost = 0.0;
  float hp = 0.0, slopeDown = 0.0, ampSum = 0.0, kAmp = 0.0, ampAll = 0.0;
  // (in the lee of the sandbar the chop is sheltered, to flat right behind it)
  float shel = shelterAt(vBase, wd);
  for (int i = 0; i < 8; i++) {
    vec4 a = uWaveA[i];
    float amp = uWaveB[i].x * shel;
    float w = keep(6.2831853 / a.z, fp);
    float th = a.z * (a.x * vBase.x + a.y * vBase.y) - a.w * uTime + uWaveB[i].y;
    float q = min(0.55 / (a.z * max(amp, 1e-4) * 8.0 + 1e-3), 1.0);
    float wa = a.z * amp;
    n.x -= a.x * wa * cos(th) * w;
    n.z -= a.y * wa * cos(th) * w;
    n.y -= q * wa * sin(th) * w;
    lost += (1.0 - w) * wa;
    // (only the wave trains big enough to see here, or the crests sparkle)
    hp += amp * sin(th) * w;
    slopeDown += wa * cos(th) * dot(a.xy, wd) * w;
    ampSum += amp * w;
    ampAll += amp;
    kAmp += wa * w;
  }
  // Capillary ripples running downwind, rougher in gusts.
  vec2 d2 = normalize(wd + wp * 0.6), d3 = normalize(wd - wp * 0.7);
  float k1 = keep(1.0, fp), k2 = keep(0.69, fp), k3 = keep(0.49, fp), k4 = keep(0.37, fp);
  vec2 r = vec2(0.0);
  r += wd * cos(dot(xz, wd) * 6.3 - uTime * 6.0) * 0.6 * k1;
  r += d2 * cos(dot(xz, d2) * 9.1 - uTime * 7.3) * 0.45 * k2;
  r += d3 * cos(dot(xz, d3) * 12.7 - uTime * 8.8) * 0.35 * k3;
  r += wp * cos(dot(xz, wp) * 17.0 + noise3(vec3(xz * 0.3, uTime * 0.4)) * 3.0 - uTime * 4.0) * 0.25 * k4;
  float rippleAmp = 0.09 * rough;
  lost += rippleAmp * ((1.0 - k1) * 0.6 + (1.0 - k2) * 0.45 + (1.0 - k3) * 0.35 + (1.0 - k4) * 0.25);
  vec3 N = normalize(n + vec3(r.x, 0.0, r.y) * rippleAmp);

  float ndv = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  // Gusty water reflects less sky: that's why gusts look dark on the water.
  fresnel *= mix(1.0, 0.62, smoothstep(0.95, 1.35, g));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);
  float shallow = smoothstep(uShoreZ + 160.0, uShoreZ + 20.0, vWorld.z);
  vec3 body = mix(uDeep, uShallow, shallow * 0.8);
  // Shallow, sandy water either side of the sandbar.
  vec2 barSD = barCoords(vBase, wd);
  float barNear = uBar2.z * barAlong(barSD.x);
  body = mix(body, vec3(0.2, 0.46, 0.44), barNear * (1.0 - smoothstep(uBar2.y, uBar2.y + 70.0, abs(barSD.y))) * 0.6);
  body *= mix(1.0, 0.82, smoothstep(1.0, 1.35, g));
  // Light and shade on the chop: how high the water is here, from -1 in a
  // trough to +1 on a crest (only the waves big enough to see from here,
  // and less of it in near-flat water). Troughs look down into deep water
  // and go dark; crests are thin water the light shines through, brighter
  // and a little greener, most of all looking toward the sun.
  float hRel = clamp(hp / max(ampSum * 0.75, 1e-3), -1.3, 1.3);
  float seen = clamp(ampSum / max(ampAll, 1e-3), 0.0, 1.0) * smoothstep(0.04, 0.25, uHs * shel);
  float lift = smoothstep(-1.0, 1.0, hRel);
  body *= mix(1.0, mix(0.6, 1.2, lift), seen);
  float sunward = pow(max(dot(-V, uSunDir), 0.0), 2.0);
  vec3 glow = mix(uShallow, vec3(0.2, 0.62, 0.58), 0.4) * smoothstep(0.15, 1.1, hRel) * seen * (0.12 + 0.5 * sunward);
  float scatter = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.15;
  vec3 col = mix(body + uShallow * scatter + glow, refl, fresnel);
  // (and on the whole surface, reflections too, so the shape still reads at a low angle)
  col *= mix(1.0, mix(0.84, 1.08, lift), seen);
  // Sun glitter. Slopes too small to draw widen the highlight instead of
  // sparkling on and off (keeps the far water calm).
  vec3 H = normalize(uSunDir + V);
  float shin = mix(2400.0, 700.0, clamp(rough, 0.0, 1.0));
  float shinEff = max(shin / (1.0 + lost * lost * shin * 0.6), 160.0);
  float nh = max(dot(N, H), 0.0);
  float low = 1.0 - smoothstep(0.15, 0.7, uSunDir.y); // a low sun lays a long, bright path
  col += uSunColor * pow(nh, shinEff) * (2.2 + rough * 0.8 + 3.0 * low) * pow(shinEff / shin, 0.7);
  // ...and the path itself: the sheen of a thousand facets too small to see.
  col += uSunColor * pow(nh, 90.0) * (0.12 + 0.35 * low) * fresnel * 4.0;
  // Whitecaps: the tops of the chop breaking. They sit on the crests where
  // the wave trains stack up, spill down the front (downwind) face, and lie
  // across the wind along the crest, travelling downwind with the waves.
  // Only some crests break at a time; more of them as the wind gets up
  // (the first white horses at Bft 3-4, many by Bft 5).
  float capWind = smoothstep(3.5, 10.0, uWindSpeed * g) * smoothstep(0.25, 0.7, shel);
  float crestN = hp / max(ampSum, 1e-3);
  float crest = smoothstep(0.0, 0.35, crestN);
  float front = smoothstep(0.15, -0.45, slopeDown / max(kAmp, 1e-4));
  float c0 = uWaveA[0].w / uWaveA[0].z; // the dominant chop's speed
  float alongWave = along - c0 * uTime;
  float breakN = noise3(vec3(alongWave / 2.2, across / 9.0, uTime / 2.5)) * 0.65 +
    noise3(vec3(alongWave / 0.9, across / 3.5, uTime / 1.3) + 7.3) * 0.35;
  // A few per cent of the sea breaking at Bft 5, more as it blows harder.
  float more = 0.46 * capWind + 0.15 * smoothstep(9.0, 16.0, uWindSpeed * g);
  float breaking = smoothstep(0.62 - more, 0.8 - more, breakN);
  float density = capWind * breaking * crest * mix(0.45, 1.0, front);
  // The foam's grain runs with the wind: spilling water tears into streaks
  // down the face (long along the wind, a hand's width across), and finer
  // streaks within those. Finer than a few pixels it averages out to an even
  // white instead of sparkling.
  float s1 = noise3(vec3(alongWave / 0.9, across / 0.16, uTime * 0.35)) * keep(0.5, fp);
  float s2 = noise3(vec3(alongWave / 0.35, across / 0.07, uTime * 0.6) + 3.7) * keep(0.25, fp);
  float iso = noise3(vec3(alongWave / 0.45, across / 0.6, uTime * 0.5) + 8.2) * keep(0.6, fp);
  float iso2 = noise3(vec3(alongWave / 0.17, across / 0.2, uTime * 0.9) + 2.4) * keep(0.25, fp);
  float tex = 0.5 + 0.5 * (0.25 * s1 + 0.15 * s2 + 0.4 * iso + 0.2 * iso2);
  // (soft-edged: foam thins out into the water, it has no outline)
  float soft = clamp(fp * 1.5, 0.16, 0.4);
  // The breaking lip along the front of the crest: solid, brightest...
  float lipD = density * smoothstep(0.2, 0.55, crestN) * mix(0.3, 1.0, front);
  float lip = smoothstep(0.32 - soft, 0.32 + soft, lipD * (0.5 + 0.9 * tex));
  // ...and the foam spilling down the face from it: mottled, broken into
  // clumps and streaks with the darker water showing through.
  float mottle = smoothstep(0.32, 0.72, tex);
  float spill = smoothstep(0.48 - soft, 0.48 + soft, density * (0.12 + 1.0 * mottle)) * (0.55 + 0.45 * mottle);
  float kc = keep(2.5, fp);
  // Far off, the white horses blur into a flecked, paler sea.
  float foam = mix(0.05 * capWind * capWind, max(spill, lip), kc);
  // What a breaker leaves behind as the crest runs on: a fading web on its
  // back, drawn out downwind into streaks.
  float trailN = noise3(vec3((alongWave + 1.4) / 2.2, across / 9.0, uTime / 2.5 - 0.35)) * 0.65 +
    noise3(vec3((alongWave + 1.4) / 0.9, across / 3.5, uTime / 1.3 - 0.4) + 7.3) * 0.35;
  float trailD = capWind * smoothstep(0.62 - more, 0.8 - more, trailN) * smoothstep(-0.15, 0.3, crestN) * (1.0 - front);
  float t1 = 0.5 + 0.5 * (0.35 * noise3(vec3(alongWave / 2.4, across / 0.14, uTime * 0.12) + 5.1) * keep(0.4, fp) + 0.45 * iso + 0.2 * iso2);
  float trail = smoothstep(0.38 - soft, 0.38 + soft, trailD * (0.15 + 1.0 * t1)) * (0.1 + 0.3 * smoothstep(0.45, 0.8, t1)) * kc;
  // Foam lines: in a breeze the foam is blown into long thin streaks along
  // the wind, a few metres apart, more and brighter the harder it blows.
  float lines = smoothstep(6.0, 12.0, uWindSpeed * g) * smoothstep(0.25, 0.7, shel);
  float ln = noise3(vec3((along - drift * 0.4) / 22.0, across / 0.5, uTime * 0.01));
  float lnBreak = 0.5 + 0.5 * noise3(vec3((along - drift * 0.4) / 2.5, across / 0.4, uTime * 0.03) + 11.0);
  float streak = smoothstep(0.6, 0.85, ln) * smoothstep(0.5, 0.85, lnBreak) * lines * keep(1.2, fp) * 0.3;
  float shoreFoam = smoothstep(uShoreZ + 6.0, uShoreZ + 1.0, vWorld.z) * (0.5 + 0.5 * sin(uTime * 0.8 + xz.x * 0.05));
  // The chop breaking on the sandbar's windward edge, and lapping its lee edge.
  float hw = uBar2.y;
  float breakers = barNear * smoothstep(-hw - 15.0, -hw - 8.0, barSD.y) * (1.0 - smoothstep(-hw - 1.0, -hw + 1.0, barSD.y)) *
    smoothstep(0.4, 0.75, noise3(vec3(barSD.x / 3.0, barSD.y / 1.5, uTime * 0.9)) * 0.5 + 0.5) * smoothstep(0.08, 0.35, uHs);
  float lap = barNear * (1.0 - smoothstep(0.3, 1.6, abs(barSD.y - hw))) * (0.35 + 0.25 * sin(uTime * 1.3 + barSD.x * 0.4));
  // (foam is lit: the sun's colour on its tops, the sky's in its shade)
  vec3 foamCol = mix(uSkyHorizon * 0.85, vec3(0.95), 0.6) + uSunColor * 0.25 * max(uSunDir.y, 0.15);
  col = mix(col, foamCol, clamp(foam + trail + shoreFoam * 0.6 + streak + breakers * 0.85 + lap * 0.5, 0.0, 1.0));
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
  // Far off, the sea fades into the sky at the horizon behind it (warm toward the sun).
  vec3 haze = skyBase(normalize(vec3(-V.x, 0.0, -V.z)));
  col = mix(col, mix(uFogColor, haze, 0.75), fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Radial grid: dense near the camera, coarse out to the horizon. */
function radialGrid(rings = 190, segments = 256, r0 = 0.5, rMax = 3200) {
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
  geo.userData.spacing = Math.max(growth - 1, (2 * Math.PI) / segments);
  return geo;
}

export class Water {
  constructor(scene, env) {
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uWaveA: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uWaveB: { value: Array.from({ length: 8 }, () => new THREE.Vector2()) },
      // (the environment's own objects: a change of light reaches the water too)
      uSunDir: { value: env.sunDir },
      uSunColor: { value: env.sunColor },
      uSkyTop: { value: env.skyTop },
      uSkyHorizon: { value: env.skyHorizon },
      uSkyGlow: { value: env.skyGlow },
      uDeep: { value: new THREE.Color(0x0b3a52) },
      uShallow: { value: new THREE.Color(0x2a9a9a) },
      uFogColor: { value: env.fogColor },
      uFogDensity: { value: env.fogDensity },
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uWindSpeed: { value: 8 },
      uGustiness: { value: 0.4 },
      uHs: { value: 0.3 },
      uShoreZ: { value: -260 },
      uBar: { value: new THREE.Vector4() },
      uBar2: { value: new THREE.Vector3() },
      uSpacing: { value: 0.06 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader });
    const grid = radialGrid();
    this.uniforms.uSpacing.value = grid.userData.spacing;
    this.mesh = new THREE.Mesh(grid, this.material);
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
    const bar = waves.bar;
    if (bar) {
      this.uniforms.uBar.value.set(bar.ax, bar.az, bar.lx, bar.lz);
      this.uniforms.uBar2.value.set(bar.length, bar.halfWidth, 1);
    } else this.uniforms.uBar2.value.set(1, 1, 0);
  }

  update(time, camera) {
    this.uniforms.uTime.value = time;
    // Snap the grid centre so the dense rings don't shimmer as the camera moves.
    const s = 0.5;
    this.uniforms.uCenter.value.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
  }
}
