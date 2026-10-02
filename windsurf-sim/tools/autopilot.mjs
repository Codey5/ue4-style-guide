// A simple "expert sailor" used for headless physics checks: holds a true
// wind angle with rig rake, trims the sheet for a target angle of attack,
// hikes to balance, gets into the straps and harness once planing.
import { DEG, clamp } from '../src/physics/math.js';
import { emptyControls, S } from '../src/physics/sim.js';

export class Autopilot {
  constructor(sim, twaDeg, opts = {}) {
    this.sim = sim;
    this.twa = twaDeg * DEG;
    this.sheet = 0.35;
    this.alphaTarget = (opts.alpha ?? 20) * DEG;
    this.pump = opts.pump ?? false;
    this.useStraps = opts.straps ?? true;
    this.rail = opts.rail ?? 0;
    this.lean = opts.lean ?? null;
    this.integ = 0;
    this.warmup = opts.warmup ?? 0;
  }

  controls(dt) {
    const sim = this.sim;
    const c = emptyControls();
    const side = sim.sailor.side;
    const t = sim.telemetry;
    if (!t) { c.sheet = 0.5; return c; }
    if (sim.state === S.SECURE) { c.sheet = 0.6; return c; }
    if (sim.state !== S.SAILING) return c;
    // Change course gradually after the warm-up, like a real bear-away.
    const goal = sim.t < this.warmup ? 100 * DEG : this.twa;
    this.cur = this.cur === undefined ? goal : this.cur + clamp(goal - this.cur, -6 * DEG * dt, 6 * DEG * dt);
    const target = side * this.cur;
    const e = sim.twa - target;
    this.integ = clamp(this.integ + e * dt, -2, 2);
    const steer = clamp(-side * (2.2 * e + 0.8 * sim.yawRate + 0.4 * this.integ), -1.5, 1.5);
    c.rake = clamp(steer, -1, 1);
    // Rig lean: to windward when planing (lift and balance), and further to
    // windward when the rig is already fully forward and we still need to bear away.
    const p = t.planing;
    const bearAway = Math.max(0, steer - 0.7) * 1.4;
    c.lean = this.lean ?? side * clamp(0.5 * p + bearAway, 0, 1);
    // Sheet for target AoA, but don't exceed what the sailor can hold.
    const a = t.alpha;
    const bal = sim.balance;
    // Depower when the pull approaches what body weight can counter.
    let over = 0;
    if (bal) {
      const L = sim.sailorHeight * 0.56 + (sim.sailor.hooked ? 0.08 : 0);
      const capacity = sim.sailorMass * 9.81 * L * Math.sin((sim.sailor.hooked ? 64 : 48) * DEG) + 0.4 * bal.tauMax;
      over = (bal.tauPull - capacity) / capacity;
    }
    const aTarget = this.alphaTarget - clamp(over, 0, 1) * 14 * DEG;
    // Don't sheet in faster than you can get your body out against it.
    const lag = sim.betaTarget !== undefined ? Math.max(0, sim.betaTarget - sim.sailor.beta) : 0;
    if (sim.sailor.gripLost > 0) this.sheet = Math.min(this.sheet, 0.3);
    else this.sheet = clamp(this.sheet + clamp(-(a - aTarget) * 2.2 - Math.max(0, over) * 1.5 - lag * 4, -1.5, 0.2) * dt, 0.05, 1);
    c.sheet = this.sheet;
    c.pump = this.pump && p < 0.85;
    c.rail = this.rail;
    // Stance: weight forward to get planing, back into the straps once going.
    const s = sim.sailor, b = sim.board;
    if (this.useStraps && p > 0.95 && t.speed > 5.5) {
      if (s.straps === 0 && s.x > b.frontStrapX + 0.18) c.weight = -1;
      else if (s.straps < 2 && !this.strapLock) { c.pressed.straps = true; this.strapLock = true; }
      else this.strapLock = false;
      if (!s.hooked && this.sheet > 0.45 && !this.hookLock) { c.pressed.hook = true; this.hookLock = true; }
    } else if (s.straps === 0) {
      c.weight = 0.2;
    }
    return c;
  }
}
