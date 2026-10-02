// Camera modes: chase (filming from behind and to windward), side views from
// windward and leeward, an overhead view for learning wind angles, and free orbit.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../physics/math.js';

export const CAMERA_MODES = [
  { id: 'chase', name: 'Chase' },
  { id: 'windward', name: 'Windward side' },
  { id: 'leeward', name: 'Leeward side' },
  { id: 'high', name: 'Overhead' },
  { id: 'free', name: 'Free orbit (drag)' },
];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.zoom = 1;
    this.yaw = null;
    this.orbit = { az: 0.6, el: 0.35, dist: 12 };
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.shake = 0;
  }

  get modeName() {
    return CAMERA_MODES[this.mode].name;
  }

  cycle(d) {
    this.mode = (this.mode + d + CAMERA_MODES.length) % CAMERA_MODES.length;
  }

  update(dt, sim, waves) {
    const p = sim.pos;
    const speed = Math.hypot(sim.vel[0], sim.vel[2]);
    // Follow the course over ground when moving, the heading when slow.
    const course = speed > 1.5 ? Math.atan2(-sim.vel[2], sim.vel[0]) : sim.yaw;
    if (this.yaw === null) this.yaw = course;
    this.yaw += wrapAngle(course - this.yaw) * (1 - Math.exp(-dt * 1.8));
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const stbd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const windward = stbd.clone().multiplyScalar(sim.sailor.side);
    const center = new THREE.Vector3(p[0], p[1] + 1.2, p[2]);
    const z = this.zoom;
    let target, look = center.clone();
    switch (CAMERA_MODES[this.mode].id) {
      case 'chase':
        target = center.clone().addScaledVector(fwd, -6.5 * z).addScaledVector(windward, 2.2 * z).add(new THREE.Vector3(0, 1.5 * z, 0));
        look.addScaledVector(fwd, 2.5);
        break;
      case 'windward':
        target = center.clone().addScaledVector(windward, 9 * z).addScaledVector(fwd, 1.5).add(new THREE.Vector3(0, 0.9 * z, 0));
        break;
      case 'leeward':
        target = center.clone().addScaledVector(windward, -10 * z).addScaledVector(fwd, -1).add(new THREE.Vector3(0, 1.5 * z, 0));
        break;
      case 'high':
        target = center.clone().addScaledVector(fwd, -8 * z).add(new THREE.Vector3(0, 24 * z, 0));
        break;
      default: {
        const o = this.orbit;
        const d = o.dist * z;
        target = center.clone().add(new THREE.Vector3(Math.cos(o.az) * Math.cos(o.el) * d, Math.sin(o.el) * d, Math.sin(o.az) * Math.cos(o.el) * d));
      }
    }
    // Smoothly chase the target, but never fall far behind a fast board.
    if (this.pos.lengthSq() === 0) this.pos.copy(target);
    const rate = CAMERA_MODES[this.mode].id === 'free' ? 12 : 4.5;
    this.pos.x = damp(this.pos.x, target.x, rate, dt);
    this.pos.y = damp(this.pos.y, target.y, rate, dt);
    this.pos.z = damp(this.pos.z, target.z, rate, dt);
    if (this.look.lengthSq() === 0) this.look.copy(look);
    else this.look.lerp(look, 1 - Math.exp(-dt * 8));
    const minY = waves.height(this.pos.x, this.pos.z, sim.t) + 0.5;
    if (this.pos.y < minY) this.pos.y = minY;
    // A little shake when the board slaps over chop at speed.
    this.shake = this.reducedMotion ? 0 : damp(this.shake, clamp((sim.chopHit ?? 0) * 0.5, 0, 0.08), 6, dt);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look);
  }

  drag(dx, dy) {
    this.orbit.az += dx * 0.005;
    this.orbit.el = clamp(this.orbit.el + dy * 0.004, 0.02, 1.4);
  }

  zoomBy(f) {
    this.zoom = clamp(this.zoom * f, 0.45, 3);
  }
}
