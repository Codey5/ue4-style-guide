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
    this.shakeEnabled = true;
  }

  get modeName() {
    return CAMERA_MODES[this.mode].name;
  }

  cycle(d) {
    this.mode = (this.mode + d + CAMERA_MODES.length) % CAMERA_MODES.length;
  }

  /**
   * view: the interpolated board pose for this frame ({pos, yaw, t}).
   * The camera sits at the board plus a smoothed offset, so the board stays
   * steady in frame however the physics steps line up with the display.
   */
  update(dt, sim, waves, view) {
    const p = view.pos;
    const speed = Math.hypot(sim.vel[0], sim.vel[2]);
    // Follow the course over ground when moving, the heading when slow.
    const course = speed > 1.5 ? Math.atan2(-sim.vel[2], sim.vel[0]) : view.yaw;
    if (this.yaw === null) this.yaw = course;
    this.yaw += wrapAngle(course - this.yaw) * (1 - Math.exp(-dt * 1.6));
    // Ride the chop gently: don't copy every bounce of the board.
    this.boardY = this.boardY === undefined ? p[1] : damp(this.boardY, p[1], 2.2, dt);
    const fwd = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const stbd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.side = this.side === undefined ? sim.sailor.side : damp(this.side, sim.sailor.side, 2.5, dt);
    const windward = stbd.clone().multiplyScalar(this.side);
    const center = new THREE.Vector3(p[0], this.boardY + 1.2, p[2]);
    const z = this.zoom;
    let offset, lookOffset = new THREE.Vector3();
    switch (CAMERA_MODES[this.mode].id) {
      case 'chase':
        offset = fwd.clone().multiplyScalar(-6.5 * z).addScaledVector(windward, 2.2 * z).add(new THREE.Vector3(0, 1.5 * z, 0));
        lookOffset = fwd.clone().multiplyScalar(2.5);
        break;
      case 'windward':
        offset = windward.clone().multiplyScalar(9 * z).addScaledVector(fwd, 1.5).add(new THREE.Vector3(0, 0.9 * z, 0));
        break;
      case 'leeward':
        offset = windward.clone().multiplyScalar(-10 * z).addScaledVector(fwd, -1).add(new THREE.Vector3(0, 1.5 * z, 0));
        break;
      case 'high':
        offset = fwd.clone().multiplyScalar(-8 * z).add(new THREE.Vector3(0, 24 * z, 0));
        break;
      default: {
        const o = this.orbit;
        const d = o.dist * z;
        offset = new THREE.Vector3(Math.cos(o.az) * Math.cos(o.el) * d, Math.sin(o.el) * d, Math.sin(o.az) * Math.cos(o.el) * d);
      }
    }
    if (!this.offset || this.pos.lengthSq() === 0) {
      this.offset = offset.clone();
      this.lookOff = lookOffset.clone();
    } else {
      const rate = CAMERA_MODES[this.mode].id === 'free' ? 14 : 3.2;
      const k = 1 - Math.exp(-dt * rate);
      this.offset.lerp(offset, k);
      this.lookOff.lerp(lookOffset, 1 - Math.exp(-dt * 4));
    }
    this.pos.copy(center).add(this.offset);
    const minY = waves.height(this.pos.x, this.pos.z, view.t) + 0.5;
    if (this.pos.y < minY) this.pos.y = minY;
    this.look.copy(center).add(this.lookOff);
    // A gentle, smooth sway when slapping over chop at speed (optional).
    const want = this.reducedMotion || !this.shakeEnabled ? 0 : clamp((sim.chopHit ?? 0) * 0.25, 0, 0.035);
    this.shake = damp(this.shake, want, 3, dt);
    const t = view.t;
    const sx = this.shake * (Math.sin(t * 7.3) + 0.5 * Math.sin(t * 13.1 + 1.7));
    const sy = this.shake * (Math.sin(t * 9.1 + 0.4) + 0.5 * Math.sin(t * 15.7));
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
