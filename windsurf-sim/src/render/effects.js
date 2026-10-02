// Spray off the leeward rail, the foam wake and wipeout splashes.
import * as THREE from 'three';
import { clamp } from '../physics/math.js';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.max = 1400;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.alpha = new Float32Array(this.max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.16, map: dotTexture(), transparent: true, depthWrite: false, opacity: 0.85, color: 0xf4f8fb,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -1000;

    // Wake ribbon.
    this.trailN = 120;
    this.trail = [];
    this.trailTimer = 0;
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(this.trailN * 2 * 3);
    this.tCol = new Float32Array(this.trailN * 2 * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 4));
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tg.setIndex(idx);
    this.wake = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.wake.frustumCulled = false;
    this.wake.renderOrder = 1;
    scene.add(this.wake);
    this.emitAcc = 0;
  }

  spawn(p, v, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set(p, i * 3);
    this.vel.set(v, i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  splash(at, strength = 1) {
    for (let i = 0; i < 180 * strength; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2.5;
      this.spawn([at.x + (Math.random() - 0.5) * 0.6, at.y, at.z + (Math.random() - 0.5) * 0.6],
        [Math.cos(a) * r, 2 + Math.random() * 3.5 * strength, Math.sin(a) * r], 0.6 + Math.random() * 0.8);
    }
  }

  update(dt, sim, boardObj, waves) {
    const t = sim.telemetry;
    if (t && sim.rig) {
      const speed = t.speed;
      const p = t.planing;
      // Rail spray once the board is moving: the leeward rail throws a sheet of water.
      const rate = clamp((speed - 3) * 22, 0, 260) * (0.25 + 0.75 * p) + (sim.chopHit ?? 0) * 200;
      this.emitAcc += rate * dt;
      const b = sim.board;
      const side = sim.sailor.side;
      const m = boardObj.matrixWorld;
      const fwd = new THREE.Vector3(Math.cos(sim.yaw), 0, -Math.sin(sim.yaw));
      const lee = new THREE.Vector3(Math.sin(sim.yaw), 0, Math.cos(sim.yaw)).multiplyScalar(-side);
      while (this.emitAcc > 1) {
        this.emitAcc -= 1;
        const x = (sim.hull?.cp ?? 0) + 0.15 + Math.random() * 0.35 * (1 - p * 0.5);
        const local = new THREE.Vector3(x, 0.01, -side * (b.width * 0.36 * (p > 0.5 ? 0.7 : 1)));
        const w = local.applyMatrix4(m);
        const out = 1.2 + speed * (0.12 + Math.random() * 0.12);
        const v = lee.clone().multiplyScalar(out).addScaledVector(fwd, speed * (0.15 + Math.random() * 0.25));
        v.y = 0.8 + Math.random() * (0.6 + speed * 0.12);
        this.spawn([w.x, w.y, w.z], [v.x, v.y, v.z], 0.35 + Math.random() * 0.45);
      }
      // Wake: sample the tail position.
      this.trailTimer += dt;
      if (this.trailTimer > 0.06) {
        this.trailTimer = 0;
        const tail = new THREE.Vector3(b.transomX + 0.1, 0, 0).applyMatrix4(m);
        const prev = this.trail[0];
        if (prev && Math.hypot(prev.x - tail.x, prev.z - tail.z) > 4) this.trail.length = 0; // teleported
        this.trail.unshift({ x: tail.x, z: tail.z, k: clamp((speed - 1) / 6, 0, 1) });
        if (this.trail.length > this.trailN) this.trail.pop();
      }
    }
    // Particles.
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.vel[o + 1] -= 9.81 * dt;
      this.vel[o] *= 1 - dt * 0.8;
      this.vel[o + 2] *= 1 - dt * 0.8;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.life[i] <= 0 || this.pos[o + 1] < waves.height(this.pos[o], this.pos[o + 2], sim.t) - 0.1) {
        this.life[i] = 0;
        this.pos[o + 1] = -1000;
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;

    // Wake ribbon geometry.
    const n = this.trail.length;
    for (let i = 0; i < this.trailN; i++) {
      const tp = this.trail[Math.min(i, n - 1)];
      const o = i * 6, c = i * 8;
      if (!tp || i >= n) {
        this.tCol.fill(0, c, c + 8);
        continue;
      }
      const nx = this.trail[Math.min(i + 1, n - 1)], pv = this.trail[Math.max(i - 1, 0)];
      let dx = pv.x - nx.x, dz = pv.z - nx.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const width = 0.14 + (i / this.trailN) * 0.9;
      const y = waves.height(tp.x, tp.z, sim.t) + 0.04;
      this.tPos.set([tp.x - dz * width, y, tp.z + dx * width, tp.x + dz * width, y, tp.z - dx * width], o);
      const age = i / this.trailN;
      const a = Math.min(1, i / 4) * (1 - age) * (1 - age) * 0.18 * tp.k;
      this.tCol.set([0.93, 0.96, 0.98, a, 0.93, 0.96, 0.98, a], c);
    }
    this.wake.geometry.attributes.position.needsUpdate = true;
    this.wake.geometry.attributes.color.needsUpdate = true;
  }

  clearTrail() {
    this.trail.length = 0;
  }
}
