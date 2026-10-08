// Renderer, sky, light and the spot itself: a side-shore beach with a windsock,
// dunes, distant headlands and a few marker buoys out on the water.
import * as THREE from 'three';
import { BEACH_Z } from '../physics/sim.js';
import { SANDBAR, barPoint } from '../physics/spot.js';

/**
 * Times of day. The sun is out over the sea (sailing out you look into it,
 * with the glitter path ahead; sailing in, the beach is lit). Colours are
 * linear and the sun's can go past 1: the glow pass picks up what's brighter
 * than white.
 */
export const LIGHTS = {
  golden: {
    name: 'Golden hour', az: -22, el: 12,
    sun: [1.0, 0.72, 0.45], sunI: 3.4, exposure: 0.95,
    skyTop: 0x1d4c8c, skyHorizon: 0x98b3cb, skyGlow: [1.0, 0.62, 0.34],
    cloudLit: [1.2, 0.9, 0.7], cloudShade: [0.4, 0.44, 0.56],
    hemiSky: 0x9cb6d2, hemiGround: 0x3b4a50, hemiI: 0.95, fog: 0xb4bcc4, fogDensity: 0.00085,
  },
  afternoon: {
    name: 'Afternoon', az: -28, el: 30,
    sun: [1.0, 0.9, 0.76], sunI: 3.0, exposure: 1.0,
    skyTop: 0x2464b8, skyHorizon: 0xbcd6ea, skyGlow: [0.95, 0.88, 0.78],
    cloudLit: [1.12, 1.08, 1.02], cloudShade: [0.6, 0.66, 0.76],
    hemiSky: 0xc4dbf2, hemiGround: 0x2c5a6e, hemiI: 1.1, fog: 0xb8d0e2, fogDensity: 0.0011,
  },
  midday: {
    name: 'Midday', az: -30, el: 58,
    sun: [1.0, 0.96, 0.88], sunI: 2.8, exposure: 1.0,
    skyTop: 0x2f6fb5, skyHorizon: 0xbcd6e8, skyGlow: [0.82, 0.88, 0.94],
    cloudLit: [1.05, 1.05, 1.05], cloudShade: [0.7, 0.75, 0.82],
    hemiSky: 0xcfe3f5, hemiGround: 0x2c5a6e, hemiI: 1.2, fog: 0xb7d0e2, fogDensity: 0.0011,
  },
};
export const LIGHT_IDS = Object.keys(LIGHTS);

export function createEnvironment(id = 'golden') {
  const env = {
    sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), skyTop: new THREE.Color(), skyHorizon: new THREE.Color(),
    skyGlow: new THREE.Color(), cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), fogColor: new THREE.Color(),
    hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), fogDensity: 0.0011, sunI: 3, hemiI: 1, exposure: 1,
  };
  setEnvironment(env, id);
  return env;
}

/** Switch the time of day in place (every shader and light holds these same objects). */
export function setEnvironment(env, id) {
  const L = LIGHTS[id] ?? LIGHTS.golden;
  const az = L.az * Math.PI / 180, el = L.el * Math.PI / 180;
  env.id = LIGHTS[id] ? id : 'golden';
  env.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  env.sunColor.setRGB(...L.sun);
  env.skyTop.set(L.skyTop);
  env.skyHorizon.set(L.skyHorizon);
  env.skyGlow.setRGB(...L.skyGlow);
  env.cloudLit.setRGB(...L.cloudLit);
  env.cloudShade.setRGB(...L.cloudShade);
  env.fogColor.set(L.fog);
  env.hemiSky.set(L.hemiSky);
  env.hemiGround.set(L.hemiGround);
  env.fogDensity = L.fogDensity;
  env.sunI = L.sunI;
  env.hemiI = L.hemiI;
  env.exposure = L.exposure;
  return env;
}

/**
 * The sky's colour in a direction, shared by the sky dome and the water's
 * reflections so the two meet seamlessly at the horizon: blue overhead, pale
 * at the horizon, warmed toward the sun (most of all low down, at golden hour).
 */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
vec3 skyBase(vec3 d) {
  float t = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(t, 0.5));
  float toSun = max(dot(d, uSunDir), 0.0);
  vec2 h = d.xz / max(length(d.xz), 1e-4), hs = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float az = max(dot(h, hs), 0.0);
  // The warm band along the horizon under the sun, and the haze around it.
  col = mix(col, uSkyGlow, exp(-t * 9.0) * (0.08 + 0.92 * pow(az, 6.0)) * 0.75);
  col += uSkyGlow * pow(toSun, 12.0) * 0.35;
  return col;
}
`;

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const skyFragment = /* glsl */ `
${SKY_GLSL}
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
varying vec3 vDir;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
}
float clouds(vec2 p) {
  float v = 0.0, a = 0.55;
  for (int i = 0; i < 5; i++) { v += n2(p) * a; p *= 2.07; a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);
  if (d.y < 0.0) col = mix(uSkyHorizon, uSkyGlow, 0.3) * 0.92;
  float toSun = max(dot(d, uSunDir), 0.0);
  // Fair-weather cumulus drifting downwind: lit on the side toward the sun,
  // grey-blue underneath, and the thin edges near the sun glowing.
  float cover = 0.0;
  if (d.y > 0.01) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.4 - uWindDir * uTime * uWindSpeed * 0.0009;
    float raw = clouds(uv * 0.9);
    float c = smoothstep(0.56, 0.84, raw);
    vec2 sd = uSunDir.xz / max(length(uSunDir.xz), 1e-3);
    float toward = clouds(uv * 0.9 + sd * 0.07);
    float shade = clamp((toward - raw) * 5.0 + 0.45, 0.0, 1.0) * smoothstep(0.55, 0.95, raw);
    vec3 cc = mix(uCloudLit, uCloudShade, shade);
    cc += uSunColor * pow(toSun, 10.0) * (1.0 - c) * 2.5;
    cover = c * smoothstep(0.01, 0.12, d.y) * 0.94;
    col = mix(col, cc, cover);
  }
  // The sun: a disc bright enough to glow, and its halo (dimmed behind cloud).
  col += uSunColor * (pow(toSun, 1600.0) * 40.0 + pow(toSun, 90.0) * 0.5) * (1.0 - 0.85 * cover);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function createScene(env) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
  scene.background = env.fogColor.clone();

  const skyUniforms = {
    uSunDir: { value: env.sunDir }, uSunColor: { value: env.sunColor }, uSkyTop: { value: env.skyTop },
    uSkyHorizon: { value: env.skyHorizon }, uSkyGlow: { value: env.skyGlow }, uCloudLit: { value: env.cloudLit },
    uCloudShade: { value: env.cloudShade }, uTime: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindSpeed: { value: 8 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(env.sunColor, env.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  // (wide enough for the long shadow of the rig when the sun is low)
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const applyLight = (renderer) => {
    scene.fog.color.copy(env.fogColor);
    scene.fog.density = env.fogDensity;
    scene.background.copy(env.fogColor);
    hemi.color.copy(env.hemiSky);
    hemi.groundColor.copy(env.hemiGround);
    hemi.intensity = env.hemiI;
    sun.color.copy(env.sunColor);
    sun.intensity = env.sunI;
    if (renderer) renderer.toneMappingExposure = env.exposure;
  };
  return { scene, sky, skyUniforms, sun, hemi, applyLight };
}

/** Static scenery plus wind-reactive flags. */
export class World {
  constructor(scene, wind) {
    this.wind = wind;
    this.flags = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildShore();
    this.buildBuoys();
    this.buildSandbar(SANDBAR);
  }

  /**
   * The speed strip: a long low sandbar, awash at its edges, with a line of
   * small buoys marking the flat water in its lee and two tall orange flags
   * on it marking a 500 m course.
   */
  buildSandbar(bar) {
    const wd = this.wind.dir;
    const rnd = mulberry(11);
    const across = 2 * bar.halfWidth + 10;
    const geo = new THREE.PlaneGeometry(bar.length, across, 180, 10);
    const pos = geo.attributes.position;
    const colors = [];
    const dry = new THREE.Color(0xe6d3a3), wet = new THREE.Color(0xa38d64);
    for (let i = 0; i < pos.count; i++) {
      const s = pos.getX(i) + bar.length / 2, c = pos.getY(i);
      // A low hump, highest along the middle, rounded off at the ends and
      // sloping under the water at the edges.
      const end = Math.min(1, Math.min(s, bar.length - s) / 40);
      const r = Math.abs(c) / (bar.halfWidth * Math.max(0.15, end));
      const h = 0.28 * (1 - r * r) + 0.04 * Math.sin(s * 0.05 + rnd() * 0.5) - 0.12;
      pos.setZ(i, h);
      const k = THREE.MathUtils.smoothstep(h, -0.02, 0.12);
      const col = wet.clone().lerp(dry, k);
      colors.push(col.r, col.g, col.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    // Lay it along the bar: plane X along the bar, plane Y across it (toward downwind).
    mesh.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(mesh);
    const mid = barPoint(bar, wd[0], wd[2], bar.length / 2, 0);
    g.position.set(mid[0], 0, mid[1]);
    g.rotation.y = Math.atan2(-bar.lz, bar.lx);
    // (plane Y maps to -Z before the group turns; flip so +Y is to leeward)
    mesh.scale.y = -Math.sign(bar.lx * wd[2] - bar.lz * wd[0]) || 1;
    mesh.receiveShadow = true;
    this.group.add(g);

    // The 500 m course: a tall orange flag on the bar at each end.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide, roughness: 0.6 });
    for (const s of bar.course) {
      const [x, z] = barPoint(bar, wd[0], wd[2], s, bar.halfWidth * 0.4);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 8), poleMat);
      pole.position.set(x, 3.5, z);
      pole.castShadow = true;
      this.group.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3, 8, 1), flagMat);
      flag.geometry.translate(1.1, 0, 0);
      const pivot = new THREE.Group();
      pivot.position.set(x, 6.3, z);
      pivot.add(flag);
      this.group.add(pivot);
      this.flags.push({ group: null, pivot, flag, x, z, phase: rnd() * 6, fixed: true });
    }
    // Small buoys every 100 m along the outside of the flat water.
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.5 });
    this.laneBuoys = [];
    for (let s = 50; s <= bar.length - 50; s += 100) {
      const [x, z] = barPoint(bar, wd[0], wd[2], s, bar.halfWidth + bar.laneD + 35);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 10), buoyMat);
      b.position.set(x, 0.05, z);
      b.castShadow = true;
      this.group.add(b);
      this.laneBuoys.push({ mesh: b, x, z, phase: rnd() * 6 });
    }
  }

  buildShore() {
    const sand = new THREE.MeshStandardMaterial({ color: 0xe3cf9f, roughness: 0.95 });
    const wetSand = new THREE.MeshStandardMaterial({ color: 0xb59f72, roughness: 0.6 });
    const dune = new THREE.MeshStandardMaterial({ color: 0xcdb889, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x7c8f4e, roughness: 1 });
    const hill = new THREE.MeshStandardMaterial({ color: 0x587a58, roughness: 1, flatShading: true });

    // Beach: a gently sloping band that dips under the water line.
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(5000, 90, 200, 6), sand);
    beach.rotation.x = -Math.PI / 2;
    const pos = beach.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); // along -z after rotation
      const x = pos.getX(i);
      pos.setZ(i, (y + 45) / 90 * 2.2 - 0.35 + Math.sin(x * 0.01) * 0.15);
    }
    beach.geometry.computeVertexNormals();
    beach.position.set(0, 0, BEACH_Z - 40);
    beach.receiveShadow = true;
    this.group.add(beach);
    const wet = new THREE.Mesh(new THREE.PlaneGeometry(5000, 10), wetSand);
    wet.rotation.x = -Math.PI / 2;
    wet.position.set(0, -0.02, BEACH_Z - 3);
    this.group.add(wet);

    // Dunes and scrub.
    const rnd = mulberry(7);
    for (let i = 0; i < 70; i++) {
      const x = (rnd() - 0.5) * 3000;
      const z = BEACH_Z - 95 - rnd() * 80;
      const r = 14 + rnd() * 30;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), rnd() > 0.4 ? dune : grass);
      m.scale.set(1.6, 0.18 + rnd() * 0.12, 1);
      m.position.set(x, 1.5, z);
      this.group.add(m);
    }
    // Headlands and hills inland give you landmarks to steer by.
    for (let i = 0; i < 26; i++) {
      const x = (rnd() - 0.5) * 5200;
      const z = BEACH_Z - 450 - rnd() * 900;
      const h = 60 + rnd() * 220;
      const m = new THREE.Mesh(new THREE.ConeGeometry(160 + rnd() * 240, h, 7 + Math.floor(rnd() * 4)), hill);
      m.position.set(x, h / 2 - 8, z);
      m.rotation.y = rnd() * 6;
      this.group.add(m);
    }
    // An island far offshore.
    const island = new THREE.Mesh(new THREE.ConeGeometry(260, 70, 9), hill);
    island.position.set(900, 20, 1500);
    this.group.add(island);

    // Beach huts and racks of boards.
    const hutColors = [0xd85c48, 0x3f86c4, 0xf2c14e, 0x4fa37c, 0xe9e2d0];
    for (let i = 0; i < 9; i++) {
      const hut = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 2.6), new THREE.MeshStandardMaterial({ color: hutColors[i % hutColors.length], roughness: 0.8 }));
      body.position.y = 1.3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0x5b4a3c, roughness: 0.9 }));
      roof.position.y = 3.2; roof.rotation.y = Math.PI / 4;
      hut.add(body, roof);
      hut.position.set(-120 + i * 26 + rnd() * 6, 1.6, BEACH_Z - 52 - rnd() * 6);
      hut.traverse((o) => { o.castShadow = true; });
      this.group.add(hut);
    }

    // Windsock on the beach — the first thing any windsurfer looks at.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 8, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.set(30, 4 + 1.0, BEACH_Z - 18);
    this.group.add(pole);
    this.windsock = new THREE.Group();
    const sockGeo = new THREE.CylinderGeometry(0.18, 0.45, 2.6, 16, 6, true);
    sockGeo.rotateZ(-Math.PI / 2);
    sockGeo.translate(1.3, 0, 0);
    const colors = [];
    const sp = sockGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const band = Math.floor((sp.getX(i) / 2.6) * 5);
      const c = new THREE.Color(band % 2 === 0 ? 0xf05a28 : 0xf4f4f4);
      colors.push(c.r, c.g, c.b);
    }
    sockGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sock = new THREE.Mesh(sockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 }));
    this.windsock.add(this.sock);
    this.windsock.position.set(30, 8.8, BEACH_Z - 18);
    this.group.add(this.windsock);
  }

  buildBuoys() {
    const spots = [
      [-220, 130], [220, 130], [0, 420], [-420, 520], [420, 520], [0, 900], [-700, 260], [0, -150],
    ];
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xffb21e, roughness: 0.5 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xe8392b, side: THREE.DoubleSide, roughness: 0.6 });
    for (const [x, z] of spots) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.4, 16), buoyMat);
      b.position.y = 0.35;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 16), buoyMat);
      top.position.y = 1.35;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      stick.position.y = 2.3;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45, 6, 1), flagMat);
      flag.geometry.translate(0.35, 0, 0);
      const flagPivot = new THREE.Group();
      flagPivot.position.y = 2.85;
      flagPivot.add(flag);
      g.add(b, top, stick, flagPivot);
      g.position.set(x, 0, z);
      g.traverse((o) => { o.castShadow = true; });
      this.group.add(g);
      this.flags.push({ group: g, pivot: flagPivot, flag, x, z, phase: Math.random() * 6 });
    }
  }

  /**
   * The story's marks on the water: the school buoy (white) and the turning
   * marks (orange, with a flag), the one to head for ringed in yellow.
   */
  setMarks(marks) {
    for (const m of this.marks ?? []) this.group.remove(m.group);
    this.marks = marks.map((mk) => {
      const school = mk.name.includes('school');
      const g = new THREE.Group();
      const body = new THREE.MeshStandardMaterial({ color: school ? 0xf2f4f5 : 0xff6a1a, roughness: 0.45 });
      const band = new THREE.MeshStandardMaterial({ color: school ? 0x1f5fa8 : 0xf2f4f5, roughness: 0.5 });
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.6, 20), body);
      b.position.y = 0.4;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.77, 0.77, 0.3, 20), band);
      ring.position.y = 0.75;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
      pole.position.y = 2.6;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 6, 1), new THREE.MeshStandardMaterial({ color: school ? 0x1f5fa8 : 0xff6a1a, side: THREE.DoubleSide, roughness: 0.6 }));
      flag.geometry.translate(0.55, 0, 0);
      const pivot = new THREE.Group();
      pivot.position.y = 3.8;
      pivot.add(flag);
      g.add(b, ring, pole, pivot);
      g.traverse((o) => { o.castShadow = true; });
      // (the one to head for: a ring on the water around it)
      const halo = new THREE.Mesh(new THREE.TorusGeometry(4, 0.12, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffc531, transparent: true, opacity: 0.8 }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.05;
      halo.visible = false;
      g.add(halo);
      g.position.set(mk.at[0], 0, mk.at[1]);
      this.group.add(g);
      const f = { group: g, pivot, flag, x: mk.at[0], z: mk.at[1], phase: Math.random() * 6, mark: mk, halo };
      return f;
    });
  }

  update(t, waves, target = null) {
    for (const m of this.marks ?? []) {
      m.group.position.y = waves.height(m.x, m.z, t) - 0.25;
      m.group.rotation.z = Math.sin(t * 1.3 + m.phase) * 0.05;
      const wv = this.wind.sample(m.x, 3, m.z, t);
      m.pivot.rotation.y = Math.atan2(-wv[2], wv[0]) - m.group.rotation.y;
      m.flag.rotation.x = Math.sin(t * (4 + Math.hypot(wv[0], wv[2])) + m.phase) * 0.25;
      m.halo.visible = m.mark === target;
      if (m.halo.visible) {
        const k = 1 + 0.12 * Math.sin(t * 3);
        m.halo.scale.set(k, k, k);
        m.halo.position.y = 0.3;
      }
    }
    const w = this.wind;
    // Windsock: points downwind, droops in light air.
    const ws = w.sample(this.windsock.position.x, 9, this.windsock.position.z, t);
    const s = Math.hypot(ws[0], ws[2]);
    this.windsock.rotation.set(0, Math.atan2(-ws[2], ws[0]), 0);
    const droop = Math.max(0, 1 - s / 7.5) * 1.3 + Math.sin(t * 7) * 0.03;
    this.sock.rotation.z = -droop;
    for (const f of this.flags) {
      const wv = w.sample(f.x, 3, f.z, t);
      const sp = Math.hypot(wv[0], wv[2]);
      f.pivot.rotation.y = Math.atan2(-wv[2], wv[0]);
      f.flag.rotation.x = Math.sin(t * (4 + sp) + f.phase) * 0.25;
      f.flag.rotation.z = -Math.max(0, 1 - sp / 6) * 1.1;
      if (f.fixed) continue; // (the course flags stand on the sandbar)
      f.group.position.y = waves.height(f.x, f.z, t) - 0.2;
      f.group.rotation.z = Math.sin(t * 1.3 + f.phase) * 0.06;
    }
    for (const b of this.laneBuoys ?? []) b.mesh.position.y = waves.height(b.x, b.z, t) + 0.05 + Math.sin(t * 1.7 + b.phase) * 0.02;
  }
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
