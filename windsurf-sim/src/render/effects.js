// Spray off the leeward rail, the foam wake and wipeout splashes.
// Spray is fine droplets, drawn as short motion streaks with a bright head,
// soft sheets of it thrown out from the rail and up off the tail at speed,
// and a little mist; the wind carries it all downwind. The wake is a strip of
// aerated foam lying on the same displaced chop the water draws, breaking up
// as it ages (faster in rough water).
import * as THREE from 'three';
import { tw } from '../tweaks.js';
import { clamp } from '../physics/math.js';
import { NOISE_GLSL } from './water.js';

const DROP = 0, MIST = 1, SHEET = 2; // (a sheet falls like a drop but draws soft, like mist)
const FOAM = new THREE.Color(0xf2f7fa);

const pointsVS = /* glsl */ `
uniform float uScale;
attribute float aSize;
attribute float aAlpha;
attribute float aKind;
varying float vAlpha;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aSize * uScale / max(-mv.z, 0.05);
  gl_PointSize = clamp(px, 1.5, 256.0);
  // (a droplet smaller than a pixel fades rather than staying a pixel big,
  // and spray right in front of the lens fades instead of blotting it)
  vAlpha = aAlpha * min(1.0, px / 1.5) * smoothstep(1.0, 3.5, -mv.z);
  // (soft spray blown up big right in front of the camera fades out too)
  if (aKind > 1.5) vAlpha *= 1.0 - smoothstep(12.0, 36.0, px);
  vKind = aKind;
}
`;
const pointsFS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  // Droplets are small hard dots; mist is a soft puff with no visible edge.
  float a = (vKind > 0.5 ? exp(-4.0 * r2) * (1.0 - r2) : 1.0 - smoothstep(0.3, 1.0, r2)) * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const streakVS = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vAlpha = aAlpha;
}
`;
const streakFS = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  if (vAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor, vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const wakeVS = /* glsl */ `
attribute vec4 aWake; // across (-1..1), age (0..1), strength, base x
attribute float aBaseZ;
varying vec4 vWake;
varying vec2 vBase;
void main() {
  vWake = aWake;
  vBase = vec2(aWake.w, aBaseZ);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const wakeFS = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying vec4 vWake;
varying vec2 vBase;
${NOISE_GLSL}
void main() {
  float across = vWake.x, age = vWake.y, k = vWake.z;
  // Densest down the middle, ragged at the edges.
  float n = noise3(vec3(vBase * 1.7, uTime * 0.35)) * 0.6 + noise3(vec3(vBase * 4.6, uTime * 0.8) + 3.1) * 0.4;
  float edge = 1.0 - smoothstep(0.15 + 0.45 * n, 1.0, abs(across));
  // Fresh foam is dense; as it ages only the densest patches survive.
  float cut = -0.75 + age * 1.5;
  float breakup = smoothstep(cut, cut + 0.25, n);
  // Aerated foam: bright clumps with darker gaps between them, and streaks
  // running back along the track from the churn under the tail.
  float f = noise3(vec3(vBase * 5.5, uTime * 0.9)) * 0.6 + noise3(vec3(vBase * 13.0, uTime * 1.6) + 5.7) * 0.4;
  float lace = mix(0.25, 1.0, smoothstep(-0.35 - 0.2 * (1.0 - age), 0.45, f));
  float streaks = 0.55 + 0.45 * smoothstep(-0.3, 0.4, noise3(vec3(across * 3.2, age * 26.0, uTime * 0.2) + 1.3));
  float a = k * edge * breakup * lace * streaks * 0.5 * pow(1.0 - age, 1.4) * smoothstep(0.0, 0.01, age);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Effects {
  constructor(scene) {
    this.max = 3200;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.size0 = new Float32Array(this.max);
    this.alpha0 = new Float32Array(this.max);
    this.kind = new Uint8Array(this.max);
    this.size = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.kindF = new Float32Array(this.max);
    this.next = 0;
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000;

    // Droplet heads and mist.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    pg.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    pg.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    pg.setAttribute('aKind', new THREE.BufferAttribute(this.kindF, 1));
    this.pointUniforms = { uScale: { value: 600 }, uColor: { value: FOAM.clone().multiplyScalar(1.1) } };
    this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.pointUniforms, vertexShader: pointsVS, fragmentShader: pointsFS, transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    // Droplet motion streaks: head at the droplet, tail where it was a moment ago.
    this.sPos = new Float32Array(this.max * 6);
    this.sAlpha = new Float32Array(this.max * 2);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('aAlpha', new THREE.BufferAttribute(this.sAlpha, 1));
    this.streaks = new THREE.LineSegments(sg, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: FOAM.clone() } }, vertexShader: streakVS, fragmentShader: streakFS, transparent: true, depthWrite: false,
    }));
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 2;
    scene.add(this.streaks);

    // Wake: a strip three vertices wide, sampled every few tens of centimetres of travel.
    this.trailN = 180;
    this.trail = [];
    this.wPos = new Float32Array(this.trailN * 3 * 3);
    this.wAttr = new Float32Array(this.trailN * 3 * 4);
    this.wBaseZ = new Float32Array(this.trailN * 3);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3));
    wg.setAttribute('aWake', new THREE.BufferAttribute(this.wAttr, 4));
    wg.setAttribute('aBaseZ', new THREE.BufferAttribute(this.wBaseZ, 1));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j, b = a + 1, c = a + 3, d = a + 4;
        idx.push(a, b, c, b, d, c);
      }
    }
    wg.setIndex(idx);
    this.wakeUniforms = { uTime: { value: 0 }, uColor: { value: FOAM.clone() } };
    this.wake = new THREE.Mesh(wg, new THREE.ShaderMaterial({
      uniforms: this.wakeUniforms, vertexShader: wakeVS, fragmentShader: wakeFS, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 1;
    scene.add(this.wake);
    this.emitAcc = 0;
    this.sheetAcc = 0;
    this.roosterAcc = 0;
    this.time = 0;
  }

  spawn(p, v, life, kind = DROP, size = 0.035, alpha = 0.9) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.kind[i] = kind;
    this.kindF[i] = kind;
    this.size0[i] = size;
    this.alpha0[i] = alpha;
  }

  /** A burst of water: a wipeout, or the board landing off a chop. */
  splash(at, strength = 1) {
    for (let i = 0; i < 160 * strength; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.8;
      this.spawn([at.x + (Math.random() - 0.5) * 0.6, at.y, at.z + (Math.random() - 0.5) * 0.6],
        [Math.cos(a) * r, 1.5 + Math.random() * 3.5 * strength, Math.sin(a) * r], 0.5 + Math.random() * 0.7,
        DROP, 0.008 + Math.random() * 0.018, 0.85);
    }
    for (let i = 0; i < 14 * strength; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
      this.spawn([at.x + (Math.random() - 0.5) * 0.8, at.y + 0.2, at.z + (Math.random() - 0.5) * 0.8],
        [Math.cos(a) * r, 0.8 + Math.random() * 1.2 * strength, Math.sin(a) * r], 0.9 + Math.random() * 0.8,
        MIST, 0.35 + Math.random() * 0.4, 0.2);
    }
  }

  /**
   * The board slapping down off a chop: water squirts out sideways from under
   * both rails in low, flat sheets, carried along with some of the board's speed.
   */
  slap(sim, boardObj, strength = 1) {
    const b = sim.board;
    const m = boardObj.matrixWorld;
    const speed = sim.telemetry?.speed ?? 0;
    const fwd = new THREE.Vector3(Math.cos(sim.yaw), 0, -Math.sin(sim.yaw));
    const right = new THREE.Vector3(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
    const cp = sim.hull?.cp ?? 0;
    for (let i = 0; i < 140 * strength; i++) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const w = new THREE.Vector3(cp - 0.6 + Math.random() * 1.1, 0, s * b.width * 0.48).applyMatrix4(m);
      const out = 1.5 + Math.random() * 3 * strength;
      const v = right.clone().multiplyScalar(s * out).addScaledVector(fwd, speed * (0.3 + Math.random() * 0.4));
      v.y = 0.6 + Math.random() * 2.2 * strength;
      this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.35 + Math.random() * 0.5, DROP, 0.006 + Math.random() * 0.014, 0.85);
    }
    for (let i = 0; i < 8 * strength; i++) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const w = new THREE.Vector3(cp - 0.4 + Math.random() * 0.8, 0.1, s * b.width * 0.7).applyMatrix4(m);
      const v = right.clone().multiplyScalar(s * (0.5 + Math.random())).addScaledVector(fwd, speed * 0.5);
      v.y = 0.4 + Math.random() * 0.6;
      this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.8 + Math.random() * 0.6, MIST, 0.3 + Math.random() * 0.3, 0.18);
    }
  }

  /**
   * The water surface the water shader draws at base point (x, z): the same
   * wave trains, displaced the same way, leaving out the waves too short for
   * the mesh to draw there (see water.js).
   */
  surface(x, z, t, waves, center, spacing) {
    const dist = Math.hypot(x - center.x, z - center.z);
    const sp = Math.max(0.1, dist * spacing);
    let dx = 0, dz = 0, h = 0;
    for (const c of waves.components) {
      const lambda = (2 * Math.PI) / c.k;
      const w = lambda <= 2.5 * sp ? 0 : lambda >= 5 * sp ? 1 : ((lambda - 2.5 * sp) / (2.5 * sp)) ** 2 * (3 - 2 * (lambda - 2.5 * sp) / (2.5 * sp));
      const amp = c.amp * w;
      const th = c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase;
      const q = Math.min(0.55 / (c.k * Math.max(c.amp, 1e-4) * 8 + 1e-3), 1);
      dx += q * amp * c.dx * Math.cos(th);
      dz += q * amp * c.dz * Math.cos(th);
      h += amp * Math.sin(th);
    }
    const k = waves.shelter(x, z);
    return [x + dx * k, h * k, z + dz * k];
  }

  /** view: { camera, height (drawing-buffer pixels), water, t (the time the water is drawn at) } */
  update(dt, sim, boardObj, waves, view = {}) {
    this.time += dt;
    const t = sim.telemetry;
    if (view.camera) {
      const cam = view.camera;
      this.pointUniforms.uScale.value = (view.height ?? 800) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    }
    // The wind where the board is, carrying the spray downwind.
    const wv = sim.wind.sample(sim.pos[0], 1.5, sim.pos[2], sim.t);
    if (t && sim.rig && dt > 0) {
      const speed = t.speed;
      const p = t.planing;
      // Rail spray once the board is moving: the leeward rail throws a sheet
      // of droplets out and back, more slapping over the chop; none in the air.
      const air = sim.airborne ? 0 : 1;
      const rate = (clamp((speed - 3) * 30, 0, 340) * (0.25 + 0.75 * p) + (sim.chopHit ?? 0) * 260) * air * tw.juice.spray;
      this.emitAcc += rate * dt;
      const b = sim.board;
      const side = sim.sailor.side;
      const m = boardObj.matrixWorld;
      const fwd = new THREE.Vector3(Math.cos(sim.yaw), 0, -Math.sin(sim.yaw));
      const lee = new THREE.Vector3(Math.sin(sim.yaw), 0, Math.cos(sim.yaw)).multiplyScalar(-side);
      while (this.emitAcc > 1) {
        this.emitAcc -= 1;
        const x = (sim.hull?.cp ?? 0) + 0.15 + Math.random() * 0.4 * (1 - p * 0.5);
        const local = new THREE.Vector3(x, 0.01, -side * (b.width * 0.36 * (p > 0.5 ? 0.7 : 1)));
        const w = local.applyMatrix4(m);
        const out = 1.0 + speed * (0.1 + Math.random() * 0.14);
        const v = lee.clone().multiplyScalar(out).addScaledVector(fwd, speed * (0.25 + Math.random() * 0.35));
        v.y = 0.6 + Math.random() * (0.5 + speed * 0.1);
        if (Math.random() < 0.06) {
          this.spawn([w.x, w.y + 0.05, w.z], [v.x * 0.6, v.y * 0.5, v.z * 0.6], 0.6 + Math.random() * 0.5, MIST, 0.14 + Math.random() * 0.16, 0.12);
        } else {
          this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.3 + Math.random() * 0.45, DROP, 0.005 + Math.random() * 0.012, 0.8);
        }
      }
      // Planing, the rail throws sheets of spray out and back, and above
      // about 16 knots the tail kicks up a rooster tail behind the fin.
      this.sheetAcc += clamp((speed - 4) * 28, 0, 340) * p * air * dt * tw.juice.spray;
      while (this.sheetAcc > 1) {
        this.sheetAcc -= 1;
        const x = (sim.hull?.cp ?? 0) + 0.05 + Math.random() * 0.5;
        const w = new THREE.Vector3(x, 0.02, -side * b.width * 0.3).applyMatrix4(m);
        const v = lee.clone().multiplyScalar(1.2 + speed * (0.08 + Math.random() * 0.1)).addScaledVector(fwd, speed * (0.35 + Math.random() * 0.3));
        v.y = 0.8 + Math.random() * (0.6 + speed * 0.08);
        this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.3 + Math.random() * 0.4, SHEET, 0.035 + Math.random() * 0.06, 0.22 + Math.random() * 0.16);
      }
      this.roosterAcc += clamp((speed - 7) * 30, 0, 280) * p * air * dt * tw.juice.spray;
      while (this.roosterAcc > 1) {
        this.roosterAcc -= 1;
        const w = new THREE.Vector3(b.transomX + 0.05, 0.02, (Math.random() - 0.5) * 0.25).applyMatrix4(m);
        const v = fwd.clone().multiplyScalar(speed * (0.35 + Math.random() * 0.25)).addScaledVector(lee, (Math.random() - 0.3) * 1.2);
        v.y = 1.2 + Math.random() * (0.8 + speed * 0.1);
        this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.35 + Math.random() * 0.45, SHEET, 0.03 + Math.random() * 0.06, 0.25 + Math.random() * 0.16);
      }
      // Wake: sample the tail every 0.3 m of travel (or a moment, when slow).
      const tail = new THREE.Vector3(b.transomX + 0.1, 0, 0).applyMatrix4(m);
      const prev = this.trail[0];
      if (prev && Math.hypot(prev.x - tail.x, prev.z - tail.z) > 6) this.trail.length = 0; // teleported
      if (!prev || Math.hypot(prev.x - tail.x, prev.z - tail.z) > 0.3 || this.time - prev.t > 0.12) {
        this.trail.unshift({ x: tail.x, z: tail.z, t: this.time, k: clamp((speed - 1) / 6, 0, 1) * (0.4 + 0.6 * p) * air });
        if (this.trail.length > this.trailN) this.trail.pop();
      }
    }

    // Droplets and mist.
    for (let i = 0; i < this.max; i++) {
      const o = i * 3, so = i * 6;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.sAlpha[i * 2] = this.sAlpha[i * 2 + 1] = 0;
        continue;
      }
      this.life[i] -= dt;
      const mist = this.kind[i] === MIST;
      // Gravity, and air drag toward the wind (mist rides the wind).
      const drag = (mist ? 3 : 1.1) * dt;
      this.vel[o] += (wv[0] - this.vel[o]) * drag;
      this.vel[o + 2] += (wv[2] - this.vel[o + 2]) * drag;
      this.vel[o + 1] -= (mist ? 1.2 : 9.81) * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      const age = 1 - this.life[i] / this.maxLife[i];
      if (this.life[i] <= 0 || (!mist && this.pos[o + 1] < waves.height(this.pos[o], this.pos[o + 2], sim.t) - 0.05)) {
        this.life[i] = 0;
        this.pos[o + 1] = -1000;
        this.alpha[i] = 0;
        this.sAlpha[i * 2] = this.sAlpha[i * 2 + 1] = 0;
        continue;
      }
      if (mist) {
        this.size[i] = this.size0[i] * (1 + 1.8 * age);
        this.alpha[i] = this.alpha0[i] * Math.sin(Math.PI * Math.min(1, age * 1.2 + 0.05));
        this.sAlpha[i * 2] = this.sAlpha[i * 2 + 1] = 0;
      } else if (this.kind[i] === SHEET) {
        // (spreading and thinning as it flies)
        this.size[i] = this.size0[i] * (1 + 1.2 * age);
        this.alpha[i] = this.alpha0[i] * Math.min(1, (1 - age) * 3) * Math.min(1, age * 8 + 0.2);
        this.sAlpha[i * 2] = this.sAlpha[i * 2 + 1] = 0;
      } else {
        const fade = Math.min(1, (1 - age) * 4);
        this.size[i] = this.size0[i];
        this.alpha[i] = this.alpha0[i] * fade;
        // The streak: where the droplet was 40 ms ago.
        this.sPos[so] = this.pos[o]; this.sPos[so + 1] = this.pos[o + 1]; this.sPos[so + 2] = this.pos[o + 2];
        this.sPos[so + 3] = this.pos[o] - this.vel[o] * 0.04;
        this.sPos[so + 4] = this.pos[o + 1] - this.vel[o + 1] * 0.04;
        this.sPos[so + 5] = this.pos[o + 2] - this.vel[o + 2] * 0.04;
        this.sAlpha[i * 2] = 0.55 * fade;
        this.sAlpha[i * 2 + 1] = 0;
      }
    }
    const pa = this.points.geometry.attributes;
    pa.position.needsUpdate = true;
    pa.aSize.needsUpdate = true;
    pa.aAlpha.needsUpdate = true;
    pa.aKind.needsUpdate = true;
    this.streaks.geometry.attributes.position.needsUpdate = true;
    this.streaks.geometry.attributes.aAlpha.needsUpdate = true;

    // Wake geometry, lying on the displaced chop surface.
    const wt = view.t ?? sim.t;
    this.wakeUniforms.uTime.value = wt;
    const center = view.water ? view.water.uniforms.uCenter.value : { x: sim.pos[0], z: sim.pos[2] };
    const spacing = view.water ? view.water.uniforms.uSpacing.value : 0.0475;
    const maxAge = 7 - 3.5 * clamp((waves.hsAt(sim.pos[0], sim.pos[2]) - 0.2) / 0.5, 0, 1); // chop breaks it up sooner
    const n = this.trail.length;
    for (let i = 0; i < this.trailN; i++) {
      const tp = this.trail[i];
      const o = i * 9, a = i * 12, bz = i * 3;
      const age = tp ? (this.time - tp.t) / maxAge : 1;
      if (!tp || age >= 1) {
        // Past the end: fold onto the previous vertices so nothing stretches.
        for (let j = 0; j < 3; j++) {
          this.wAttr[a + j * 4 + 2] = 0;
          if (i > 0) this.wPos.copyWithin(o + j * 3, o - 9 + j * 3, o - 9 + j * 3 + 3);
        }
        continue;
      }
      const nx = this.trail[Math.min(i + 1, n - 1)], pv = this.trail[Math.max(i - 1, 0)];
      let dx = pv.x - nx.x, dz = pv.z - nx.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const width = 0.24 + age * 1.4;
      for (let j = 0; j < 3; j++) {
        const s = j - 1;
        const x = tp.x - dz * width * s, z = tp.z + dx * width * s;
        const sp = this.surface(x, z, wt, waves, center, spacing);
        this.wPos.set([sp[0], sp[1] + 0.02, sp[2]], o + j * 3);
        this.wAttr.set([s, age, tp.k, x], a + j * 4);
        this.wBaseZ[bz + j] = z;
      }
    }
    const wa = this.wake.geometry.attributes;
    wa.position.needsUpdate = true;
    wa.aWake.needsUpdate = true;
    wa.aBaseZ.needsUpdate = true;
  }

  clearTrail() {
    this.trail.length = 0;
  }
}
