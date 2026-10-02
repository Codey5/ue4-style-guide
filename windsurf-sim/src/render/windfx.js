// Air particles drifting with the local wind around the camera: specks of
// spray and salt that show which way the wind is blowing, and how hard.
// Each one is a short camera-facing streak along its velocity, so a gust
// visibly speeds them up.
import * as THREE from 'three';

const BOX = { x: 80, y: 6, z: 80 };
const TRAIL = 0.22; // seconds of travel each streak shows
const WIDTH = 0.04; // metres

export class WindParticles {
  constructor(scene, count = 380) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 4 * 3);
    this.col = new Float32Array(count * 4 * 4);
    const idx = [];
    for (let i = 0; i < count; i++) {
      const v = i * 4;
      idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.seeded = false;
    this.enabled = true;
  }

  respawn(i, c, wind) {
    const o = i * 3;
    if (!wind) {
      this.p[o] = c.x + (Math.random() - 0.5) * BOX.x;
      this.p[o + 2] = c.z + (Math.random() - 0.5) * BOX.z;
    } else {
      // Re-enter on the upwind side of the box so the flow looks continuous.
      const along = (Math.random() - 0.5) * BOX.x;
      this.p[o] = c.x - wind[0] * BOX.x * 0.5 + wind[2] * along;
      this.p[o + 2] = c.z - wind[2] * BOX.z * 0.5 - wind[0] * along;
    }
    this.p[o + 1] = 0.3 + Math.pow(Math.random(), 1.4) * BOX.y;
  }

  update(dt, camera, wind, t, waterY) {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const c = camera.position;
    if (!this.seeded) {
      for (let i = 0; i < this.n; i++) this.respawn(i, c, null);
      this.seeded = true;
    }
    const d = wind.dir;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const v = wind.sample(this.p[o], Math.max(0.3, this.p[o + 1] - waterY), this.p[o + 2], t);
      // A little turbulence so the specks don't move like a grid.
      const jit = Math.sin(t * 1.7 + i * 12.9) * 0.4;
      const vx = v[0] + jit * d[2], vz = v[2] - jit * d[0], vy = Math.sin(t * 1.3 + i) * 0.15;
      this.p[o] += vx * dt; this.p[o + 1] += vy * dt; this.p[o + 2] += vz * dt;
      const dx = this.p[o] - c.x, dz = this.p[o + 2] - c.z;
      if (Math.abs(dx) > BOX.x / 2 || Math.abs(dz) > BOX.z / 2 || this.p[o + 1] < waterY + 0.2) this.respawn(i, c, d);
      // Streak quad from the head back along the velocity, facing the camera.
      const hx = this.p[o], hy = this.p[o + 1], hz = this.p[o + 2];
      const tx = hx - vx * TRAIL, ty = hy - vy * TRAIL, tz = hz - vz * TRAIL;
      let ax = hx - tx, ay = hy - ty, az = hz - tz;
      const vxC = hx - c.x, vyC = hy - c.y, vzC = hz - c.z;
      let sx = ay * vzC - az * vyC, sy = az * vxC - ax * vzC, sz = ax * vyC - ay * vxC;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const w = WIDTH / sl;
      sx *= w; sy *= w; sz *= w;
      const q = i * 12;
      this.pos[q] = hx + sx; this.pos[q + 1] = hy + sy; this.pos[q + 2] = hz + sz;
      this.pos[q + 3] = hx - sx; this.pos[q + 4] = hy - sy; this.pos[q + 5] = hz - sz;
      this.pos[q + 6] = tx + sx * 0.4; this.pos[q + 7] = ty + sy * 0.4; this.pos[q + 8] = tz + sz * 0.4;
      this.pos[q + 9] = tx - sx * 0.4; this.pos[q + 10] = ty - sy * 0.4; this.pos[q + 11] = tz - sz * 0.4;
      // Fade toward the edges of the box and right next to the lens.
      const r = Math.max(Math.abs(dx) / (BOX.x / 2), Math.abs(dz) / (BOX.z / 2));
      const near = Math.hypot(vxC, vyC, vzC);
      const nearFade = Math.min(1, Math.max(0, (near - 5) / 9));
      const a = (1 - r * r) * nearFade * Math.min(1, Math.hypot(vx, vz) / 3) * 0.4;
      const k = i * 16;
      for (let j = 0; j < 4; j++) {
        this.col[k + j * 4] = 1; this.col[k + j * 4 + 1] = 1; this.col[k + j * 4 + 2] = 1;
        this.col[k + j * 4 + 3] = j < 2 ? Math.max(0, a) : 0;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
