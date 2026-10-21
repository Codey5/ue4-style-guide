// A GPS speedsurfing logger, the way real speedsurfers measure themselves
// (the GPS Team Challenge categories): it samples speed and position ten
// times a second, like a doppler GPS, and keeps the best
//   2 s      peak: best average speed over any 2 seconds
//   10 s     best average over any 10 seconds (and 5×10 s: the average of
//            the five best 10-second runs that don't overlap)
//   500 m    best average over any 500 metres
//   NM       best average over a nautical mile (1852 m)
//   α 500    alpha: best average over a run of at most 500 m that includes
//            a gybe and ends within 50 m of where it started
// All speeds in m/s; distances in metres.
import { S } from '../physics/states.js';

export const RATE = 10; // samples per second
const DT = 1 / RATE;
const W2 = 2 * RATE, W10 = 10 * RATE;
export const CATEGORIES = [
  { key: 's2', label: '2 s', long: '2-second peak' },
  { key: 's10', label: '10 s', long: 'best 10 seconds' },
  { key: 'five10', label: '5×10 s', long: 'five best 10-second runs' },
  { key: 'm500', label: '500 m', long: 'best 500 metres' },
  { key: 'nm', label: 'NM', long: 'nautical mile' },
  { key: 'alpha', label: 'α 500', long: 'alpha 500 (out and back through a gybe)' },
];

export class GpsLogger {
  constructor() {
    this.t = []; this.x = []; this.z = []; this.v = []; this.cum = []; this.gybes = []; this.seg = [];
    this.avg10 = [];
    this.next = 0;
    this.segStart = 0;
    this.sum2 = 0; this.sum10 = 0;
    this.i500 = 0; this.iNm = 0; this.iAlpha = 0;
    this.best = { s2: 0, s10: 0, m500: 0, nm: 0, alpha: 0 };
    this.at = {}; // when (sample time) each best was set
    this.gybeCount = 0;
    this.wasFlip = false;
    this.maxV = 0;
  }

  get samples() { return this.t.length; }
  get distance() { return this.cum.length ? this.cum[this.cum.length - 1] : 0; }
  get duration() { return this.t.length ? this.t[this.t.length - 1] - this.t[0] : 0; }

  /** Call after every physics step: samples at 10 Hz on the simulation clock. */
  step(sim) {
    // Count a gybe once the sail has been flipped (between samples too).
    const flip = sim.state === S.FLIP;
    if (flip && !this.wasFlip) this.gybeCount++;
    this.wasFlip = flip;
    if (sim.t + 1e-9 < this.next) return;
    this.next = (this.next || sim.t) + DT;
    if (this.next < sim.t) this.next = sim.t + DT;
    this.add(sim.t, sim.pos[0], sim.pos[2], Math.hypot(sim.vel[0], sim.vel[2]));
  }

  add(t, x, z, v) {
    const n = this.t.length;
    // A jump in position (restarted somewhere else) starts a new track: no run spans it.
    if (n && (Math.hypot(x - this.x[n - 1], z - this.z[n - 1]) > 30 + 3 * (v + this.v[n - 1]) * (t - this.t[n - 1]) || t - this.t[n - 1] > 1)) {
      this.segStart = n;
      this.sum2 = 0; this.sum10 = 0;
      this.i500 = n; this.iNm = n; this.iAlpha = n;
    }
    const cum = n && this.segStart < n ? this.cum[n - 1] + 0.5 * (v + this.v[n - 1]) * (t - this.t[n - 1]) : (n ? this.cum[n - 1] : 0);
    this.t.push(t); this.x.push(x); this.z.push(z); this.v.push(v); this.cum.push(cum); this.gybes.push(this.gybeCount); this.seg.push(this.segStart);
    this.maxV = Math.max(this.maxV, v);
    const j = n, s0 = this.segStart;
    // 2 s and 10 s: running sums of the doppler speed.
    this.sum2 += v; if (j - W2 >= s0) this.sum2 -= this.v[j - W2];
    this.sum10 += v; if (j - W10 >= s0) this.sum10 -= this.v[j - W10];
    if (j - s0 + 1 >= W2) this.record('s2', this.sum2 / W2, t);
    if (j - s0 + 1 >= W10) {
      const a = this.sum10 / W10;
      this.avg10[j] = a;
      this.record('s10', a, t);
    }
    // Distance runs: the shortest run ending here that covers the distance.
    const run = (key, ptr, dist) => {
      let i = Math.max(this[ptr], s0);
      while (i + 1 < j && this.cum[j] - this.cum[i + 1] >= dist) i++;
      this[ptr] = i;
      if (this.cum[j] - this.cum[i] >= dist && this.t[j] > this.t[i]) this.record(key, (this.cum[j] - this.cum[i]) / (this.t[j] - this.t[i]), t);
    };
    run('m500', 'i500', 500);
    run('nm', 'iNm', 1852);
    // Alpha 500: back over the last 500 m, a start within 50 m of here with a gybe in between.
    let ia = Math.max(this.iAlpha, s0);
    while (ia < j && this.cum[j] - this.cum[ia] > 500) ia++;
    this.iAlpha = ia;
    if (this.gybes[j] > this.gybes[ia]) {
      for (let i = ia; i < j; i++) {
        if (this.gybes[j] === this.gybes[i]) break; // (no gybe after this start)
        const d = this.cum[j] - this.cum[i];
        if (d < 150) break;
        if (Math.hypot(this.x[j] - this.x[i], this.z[j] - this.z[i]) <= 50) this.record('alpha', d / (this.t[j] - this.t[i]), t);
      }
    }
  }

  record(key, v, t) {
    if (v > this.best[key]) { this.best[key] = v; this.at[key] = t; }
  }

  /** Average of the five best non-overlapping 10-second runs (fewer if the session is short). */
  five10() {
    const idx = [];
    for (let j = 0; j < this.avg10.length; j++) if (this.avg10[j] !== undefined) idx.push(j);
    idx.sort((a, b) => this.avg10[b] - this.avg10[a]);
    const picked = [];
    for (const j of idx) {
      if (picked.every((k) => Math.abs(k - j) >= W10 || this.seg[k] !== this.seg[j])) picked.push(j);
      if (picked.length === 5) break;
    }
    return picked.length ? { v: picked.reduce((s, j) => s + this.avg10[j], 0) / picked.length, n: picked.length } : { v: 0, n: 0 };
  }

  /** Everything, for the session log. */
  results() {
    const f = this.five10();
    return { ...this.best, five10: f.v, five10n: f.n, max: this.maxV, distance: this.distance, duration: this.duration };
  }
}
