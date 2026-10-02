// Renderer, sky, light and the spot itself: a side-shore beach with a windsock,
// dunes, distant headlands and a few marker buoys out on the water.
import * as THREE from 'three';
import { BEACH_Z } from '../physics/sim.js';

export function createEnvironment() {
  const sunDir = new THREE.Vector3(-0.35, 0.55, 0.75).normalize();
  return {
    sunDir,
    sunColor: new THREE.Color(1.0, 0.94, 0.82),
    skyTop: new THREE.Color(0x2f6fb5),
    skyHorizon: new THREE.Color(0xbcd6e8),
    fogColor: new THREE.Color(0xb7d0e2),
    fogDensity: 0.0011,
  };
}

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const skyFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
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
  float t = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(t, 0.5));
  if (d.y < 0.0) col = uSkyHorizon * 0.92;
  float sun = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sun, 900.0) * 18.0 + pow(sun, 12.0) * 0.22);
  // Fair-weather cumulus drifting downwind.
  if (d.y > 0.01) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.4 - uWindDir * uTime * uWindSpeed * 0.0009;
    float c = smoothstep(0.58, 0.82, clouds(uv * 0.9));
    float shade = clouds(uv * 0.9 + uSunDir.xz * 0.05);
    vec3 cloudCol = mix(vec3(1.0), vec3(0.72, 0.77, 0.84), smoothstep(0.55, 0.9, shade));
    col = mix(col, cloudCol, c * smoothstep(0.01, 0.12, d.y) * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
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
    uSkyHorizon: { value: env.skyHorizon }, uTime: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindSpeed: { value: 8 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  sky.renderOrder = -2;
  sky.frustumCulled = false;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xcfe3f5, 0x2c5a6e, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  return { scene, sky, skyUniforms, sun };
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
  }

  buildShore() {
    const sand = new THREE.MeshStandardMaterial({ color: 0xe3cf9f, roughness: 0.95 });
    const wetSand = new THREE.MeshStandardMaterial({ color: 0xb59f72, roughness: 0.6 });
    const dune = new THREE.MeshStandardMaterial({ color: 0xcdb889, roughness: 1 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x7c8f4e, roughness: 1 });
    const hill = new THREE.MeshStandardMaterial({ color: 0x6b7d72, roughness: 1, flatShading: true });

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
      [-220, 130], [220, 130], [0, 420], [-420, 520], [420, 520], [0, 900], [-700, 260], [700, 260], [0, -150],
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

  update(t, waves) {
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
      f.group.position.y = waves.height(f.x, f.z, t) - 0.2;
      f.group.rotation.z = Math.sin(t * 1.3 + f.phase) * 0.06;
    }
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
