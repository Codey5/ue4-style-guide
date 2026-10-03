// The coach: an expert sailor that produces the same controls a player would
// (sticks, triggers, button presses). Used by the in-game lessons and by the
// headless physics checks.
import { DEG, clamp, damp, smoothstep } from '../physics/math.js';
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
    const sim = this.sim;
    const betaMax = sim.betaMax ?? 30 * DEG; // as far out as the arms and lines reach
    const eq = sim.betaEq ?? 0;
    // Coming in to hook in: no further out than the harness lines reach.
    const lean = Math.min(eq, this.hookCap ?? Infinity);
    const want = betaMax > 5 * DEG ? clamp((lean - 4 * DEG) / (betaMax - 4 * DEG), 0, 1) : 0;
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
    // Broad reaches: the apparent wind is light and the sail no longer
    // overpowers you, so sheet in toward maximum lift and sit back on the tail.
    const deep = smoothstep(105 * DEG, 140 * DEG, this.cur);
    const p = t.planing;
    // How close the pull is to what the body can hold, hanging as far out as
    // the arms and lines reach.
    const bal = sim.balance;
    let over = 0;
    if (bal) {
      const capacity = sim.sailorMass * 9.81 * (bal.leverMax ?? 0.5) + 0.6 * bal.tauMax;
      over = (bal.tauPull - capacity) / capacity;
      // Unhooked, the hands are the limit: ease off before the grip goes.
      if (!sim.sailor.hooked) {
        const grip = 250 + 400 * sim.sailor.stamina;
        over = Math.max(over, (sim.handForce - 0.8 * grip) / grip * 3);
      }
      // Fore and aft: ease off before the pull is more than leaning back on your toes can hold.
      const pb = sim.pitchBalance;
      if (pb && pb.tipMax > 50) {
        over = Math.max(over, (pb.tip - 0.75 * pb.tipMax) / pb.tipMax * 2);
        if (pb.tipNow > 50) over = Math.max(over, (pb.tip - 0.85 * pb.tipNow) / pb.tipNow * 2);
      }
    }
    // Rig lean: a little to windward when planing on a reach. More whenever
    // you need to hang further out than your arms (or harness lines) reach:
    // leaning the rig brings the boom out over the water to you, and the
    // centre of effort over the board. On a broad reach, only as much as that
    // takes: the sail's force points forward there, and leaning it more just
    // tips it upward. Further to windward when the rig is already fully
    // forward and we still need to bear away.
    const bearAway = Math.max(0, steer - 0.7) * 1.4;
    const headUp = Math.max(0, -steer - 0.5) * 1.2;
    // How far beyond reach the balanced lean is: the arms, or the harness
    // lines when hooked in or about to hook in (lean the rig out to bring them to you).
    const s0 = sim.sailor;
    const wantHook = !!(o.hook ?? o.straps) && !s0.hooked && p > 0.95 && t.speed > 5.5 && sim.hookReach?.fits;
    const reach = wantHook ? sim.hookReach.betaMax : (sim.betaMax ?? 0);
    this.hookCap = wantHook ? sim.hookReach.betaMax : undefined;
    const short = (sim.betaEq ?? 0) - reach;
    // (felt over a second or two, not snapped to every gust)
    // Past about 15° of lean the sail loses more drive than the extra hang
    // gains, so beyond that you sheet out instead.
    this.reachLean = damp(this.reachLean ?? 0, smoothstep(-10 * DEG, 4 * DEG, short) * 0.22, 0.8, dt);
    c.lean = o.lean ?? side * clamp(0.25 * p * (1 - deep) + this.reachLean + bearAway - headUp, -0.2, 1);
    const aTarget = (o.alpha ?? 20 + 4 * deep) * DEG - clamp(over, 0, 1) * 14 * DEG;
    // Don't sheet in faster than you can get your body out and back against
    // it (a few degrees short of full stretch is just your legs and core
    // holding you; leaning back, only short of what holds the pull at all).
    const fa = sim.pitchBalance;
    const lag = (sim.betaTarget !== undefined ? Math.max(0, sim.betaTarget - sim.sailor.beta - 6 * DEG) : 0) +
      (fa ? 2 * Math.max(0, fa.phiNeed - sim.sailor.phi) + 4 * fa.excess : 0);
    if (sim.sailor.gripLost > 0) this.sheet = Math.min(this.sheet, 0.3);
    else this.sheet = clamp(this.sheet + clamp(-(t.alpha - aTarget) * 2.2 - Math.max(0, over) * 1.5 - lag * 4, -1.5, 0.2) * dt, 0.05, 1);
    c.sheet = this.sheet;
    c.pump = !!o.pump && p < 0.85;
    // On the plane, steer with the feet too: toes (leeward rail) bear away,
    // heels (windward rail) head up. Off the wind a little steady heel
    // pressure stops the eased sail's drive turning the board further downwind.
    const heel = p > 0.9 ? side * 0.3 * deep : 0;
    const carve = p > 0.9 && Math.abs(steer) > 0.35 ? -side * steer * 0.6 : 0;
    c.rail = o.rail ?? clamp(heel + carve, -0.8, 0.8);
    c.hike = o.hike === 'auto' ? this.hikeFor(dt) : 0;
    // Stance: weight forward to get planing, back toward the straps once going,
    // then onto the tail at speed so the board rides on less water (furthest
    // back on a broad reach, where the fin is lightly loaded and won't spin out).
    const s = sim.sailor, b = sim.board;
    const going = p > 0.95 && t.speed > 5.5;
    const wantBack = going && (o.straps || o.moveBack);
    // (walk right back first, so the front foot only has a short step back
    // into its strap: a long step back while leaning against the pull drops
    // you forward over your toes)
    if (wantBack && s.straps === 0 && s.x > b.frontStrapX - 0.1) c.weight = -1;
    else if (o.straps && going && s.straps < 2) this.press(c, 'straps', 0.6);
    else if (s.straps === 0) c.weight = o.weight ?? 0.2;
    else if (s.straps === 2 && going) c.weight = o.weight ?? -(0.35 + 0.55 * deep) * smoothstep(6, 9, t.speed);
    // Hook in once sheeted in enough that the lines reach where you need to hang.
    const lines = sim.hookReach;
    if ((o.hook ?? o.straps) && going && !s.hooked && this.sheet > 0.45 && lines?.fits &&
      (sim.assists.autoHike || lines.betaMax >= s.beta - 4 * DEG)) this.press(c, 'hook', 1.2);
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
