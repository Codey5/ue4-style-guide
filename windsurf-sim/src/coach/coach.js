// The coach: an expert sailor that produces the same controls a player would
// (sticks, triggers, button presses). Used by the in-game lessons and by the
// headless physics checks.
import { DEG, clamp } from '../physics/math.js';
import { emptyControls, S } from '../physics/sim.js';

export class Coach {
  constructor(sim) {
    this.sim = sim;
    this.sheet = 0.35;
    this.integ = 0;
    this.cur = undefined;
    this.hike = 0;
    this.lastPress = {};
  }

  /** One-shot button press, at most every `gap` seconds. */
  press(c, name, gap = 0.8) {
    const t = this.sim.t;
    if (t - (this.lastPress[name] ?? -99) < gap) return;
    this.lastPress[name] = t;
    c.pressed[name] = true;
  }

  /** LT value that balances the current pull (what a good sailor does by feel). */
  hikeFor(dt) {
    const sim = this.sim, s = sim.sailor;
    const betaMax = (s.hooked ? 74 : 56) * DEG;
    const eq = sim.betaEq ?? 0;
    const want = clamp((eq - 4 * DEG) / (betaMax - 4 * DEG), 0, 1);
    this.hike += (want - this.hike) * clamp(dt * 8, 0, 1);
    return this.hike;
  }

  /** Rig steering toward a true wind angle (degrees, always positive). */
  steer(dt, twaDeg, turnRate = 6) {
    const sim = this.sim;
    const side = sim.sailor.side;
    const goal = twaDeg * DEG;
    this.cur = this.cur === undefined ? Math.abs(sim.twa) : this.cur + clamp(goal - this.cur, -turnRate * DEG * dt, turnRate * DEG * dt);
    const e = sim.twa - side * this.cur;
    this.integ = clamp(this.integ + e * dt, -2, 2);
    return clamp(-side * (2.2 * e + 0.8 * sim.yawRate + 0.4 * this.integ), -1.5, 1.5);
  }

  /**
   * Sail a course. Options:
   *  twa (deg), alpha (target angle of attack, deg), turnRate (deg/s),
   *  pump, straps, hook, moveBack, weight, lean, rail, hike ('auto' = drive LT).
   */
  sail(dt, o = {}) {
    const sim = this.sim;
    const c = emptyControls();
    const side = sim.sailor.side;
    const t = sim.telemetry;
    if (!t) { c.sheet = 0.5; return c; }
    if (sim.state === S.SECURE) { c.sheet = 0.6; return c; }
    if (sim.state !== S.SAILING) return c;
    const steer = this.steer(dt, o.twa ?? 100, o.turnRate ?? 6);
    c.rake = clamp(steer, -1, 1);
    // Rig lean: to windward when planing (lift and balance), and further to
    // windward when the rig is already fully forward and we still need to bear away.
    const p = t.planing;
    const bearAway = Math.max(0, steer - 0.7) * 1.4;
    const headUp = Math.max(0, -steer - 0.5) * 1.2;
    c.lean = o.lean ?? side * clamp(0.5 * p + bearAway - headUp, -0.2, 1);
    // Sheet for the target angle of attack, but never more power than the body can hold.
    const bal = sim.balance;
    let over = 0;
    if (bal) {
      const L = sim.sailorHeight * 0.56 + (sim.sailor.hooked ? 0.08 : 0);
      const capacity = sim.sailorMass * 9.81 * L * Math.sin((sim.sailor.hooked ? 64 : 48) * DEG) + 0.4 * bal.tauMax;
      over = (bal.tauPull - capacity) / capacity;
      // Unhooked, the hands are the limit: ease off before the grip goes.
      if (!sim.sailor.hooked) {
        const grip = 250 + 400 * sim.sailor.stamina;
        over = Math.max(over, (sim.handForce - 0.8 * grip) / grip * 3);
      }
    }
    const aTarget = (o.alpha ?? 20) * DEG - clamp(over, 0, 1) * 14 * DEG;
    // Don't sheet in faster than you can get your body out against it.
    const lag = sim.betaTarget !== undefined ? Math.max(0, sim.betaTarget - sim.sailor.beta) : 0;
    if (sim.sailor.gripLost > 0) this.sheet = Math.min(this.sheet, 0.3);
    else this.sheet = clamp(this.sheet + clamp(-(t.alpha - aTarget) * 2.2 - Math.max(0, over) * 1.5 - lag * 4, -1.5, 0.2) * dt, 0.05, 1);
    c.sheet = this.sheet;
    c.pump = !!o.pump && p < 0.85;
    // On the plane, steer with the feet too: toes (leeward rail) bear away,
    // heels (windward rail) head up.
    c.rail = o.rail ?? (p > 0.9 && Math.abs(steer) > 0.35 ? clamp(-side * steer * 0.6, -0.8, 0.8) : 0);
    c.hike = o.hike === 'auto' ? this.hikeFor(dt) : 0;
    // Stance: weight forward to get planing, back toward the straps once going.
    const s = sim.sailor, b = sim.board;
    const going = p > 0.95 && t.speed > 5.5;
    const wantBack = going && (o.straps || o.moveBack);
    if (wantBack && s.straps === 0 && s.x > b.frontStrapX + 0.18) c.weight = -1;
    else if (o.straps && going && s.straps < 2) this.press(c, 'straps', 0.6);
    else if (s.straps === 0) c.weight = o.weight ?? 0.2;
    if ((o.hook ?? o.straps) && going && !s.hooked && this.sheet > 0.45) this.press(c, 'hook', 1.2);
    return c;
  }
}

/** Steady-course autopilot used by the physics checks (autoHike assist on). */
export class Autopilot {
  constructor(sim, twaDeg, opts = {}) {
    this.coach = new Coach(sim);
    this.sim = sim;
    this.twa = twaDeg;
    this.opts = opts;
    this.warmup = opts.warmup ?? 0;
  }

  get sheet() { return this.coach.sheet; }
  set sheet(v) { this.coach.sheet = v; }

  controls(dt) {
    const o = this.opts;
    const twa = this.sim.t < this.warmup ? 100 : this.twa;
    return this.coach.sail(dt, { twa, alpha: o.alpha, pump: o.pump, straps: o.straps ?? true, lean: o.lean ?? undefined, rail: o.rail });
  }
}
