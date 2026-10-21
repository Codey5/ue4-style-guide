// The cruise: the coach sailing round on its own, for as long as you like,
// while you watch, change the conditions or the gear, or tune the feel. It
// sails reaches back and forth across the wind (out to sea and back toward
// the beach end), pointing a little higher when it's drifted downwind and
// a little lower when it's upwind, so it stays on its patch, clear of the
// beach and the sandbar. In a breeze it gets planing, into the straps and
// hooked in, jumps off the chop, gybes at the ends and every few laps puts
// on a freestyle show; in light wind it tacks. It gets back on after a fall,
// gives up a turn that isn't working (and tries the other kind), and if
// it's ever stuck it's put back on the water sailing.
import { S, BEACH_Z } from '../physics/sim.js';
import { clamp } from '../physics/math.js';
import { Coach } from './coach.js';
import { Pilot } from './pilot.js';

const KN = 1.943844;

export class CruisePilot extends Pilot {
  constructor(sim) {
    super(sim);
    this.x0 = clamp(sim.pos[0], -200, 120); // where across the wind it stays
    this.laps = 0;
    this.demo = null; // a lesson's demonstration in progress: a carve gybe, or a freestyle show
    this.stuck = 0;
    this.turnT = 0;
    this.avoid = null; // a turn that didn't work: try the other kind next
  }

  get windKn() { return this.sim.wind.speed * KN; }
  /** In a breeze: planing, gybing at the ends. */
  get windy() { return this.windKn >= 12 && this.sim.board.volume <= 170; }
  /** A board too small to tack slowly (it sinks). */
  get smallBoard() { return this.sim.board.volume < this.sim.totalMass + 40; }
  /** The ends of the reach (z): the beach end, and out at sea (a shorter run in light wind). */
  get ends() { return [BEACH_Z + 140, this.windy ? 330 : 120]; }

  controls(dt) {
    const sim = this.sim;
    this.refresh();
    this.unstick(dt);
    const up = this.recover(dt);
    if (up) { this.demo = null; return up; }
    // A demonstration in progress plays out (until the lesson's done, we fell, or it's taking too long).
    if (this.demo) {
      this.demo.t += dt;
      if (this.lesson && !this.lesson.done && this.demo.t < this.demo.max) return this.lessonControls(this.demo.id, dt);
      if (this.lesson && !this.lesson.done && this.demo.id === 'gybe') this.avoid = 'carve';
      this.demo = null;
      this.lesson = null;
      this.coach = new Coach(sim);
    }
    // A turn in progress finishes, unless it isn't working.
    if (this.turn) {
      this.turnT += dt;
      if (this.turnT < 25 && sim.state !== S.WATER) {
        const t = this.turning(dt);
        if (t) return t;
      } else {
        this.avoid = this.turn;
        this.turn = null;
        this.coach = new Coach(sim);
      }
    }
    if (sim.state !== S.SAILING) return this.coach.sail(dt, this.style());
    // At the end of the reach: turn for the way back (every third lap in a breeze, a show instead).
    const [zN, zS] = this.ends, side = sim.sailor.side, z = sim.pos[2];
    if ((side > 0 && z > zS) || (side < 0 && z < zN)) {
      this.laps += 0.5;
      if (this.windy && this.laps % 3 === 0 && this.windKn >= 15 && sim.board.volume <= 135) return this.startDemo('freestyle', 90, dt);
      // (planing fast enough, a carve gybe: the lesson's own)
      if (this.windy && sim.telemetry.planing > 0.9 && sim.telemetry.kn > 15.5 && this.avoid !== 'carve') { this.avoid = null; return this.startDemo('gybe', 40, dt); }
      return this.turnFor(dt);
    }
    // The reach: higher when downwind of its patch, lower when upwind. Well
    // off it (out of a gybe, or up out of a waterstart pointing downwind,
    // the boom eased right out over the water), head up onto it briskly.
    const base = this.windy ? 100 : 88;
    const twa = clamp(base - (sim.pos[0] - this.x0) * 0.12, 70, 125);
    const off = Math.abs(Math.abs(sim.twa) * 57.2958 - twa);
    return this.coach.sail(dt, { ...this.style(), twa, turnRate: off > 20 ? 18 : 6 });
  }

  startDemo(id, max, dt) {
    this.demo = { id, t: 0, max };
    this.lesson = null;
    return this.lessonControls(id, dt);
  }

  /** A gybe in a breeze (or on a small board), a tack in light wind; the other kind if that one just failed. */
  turnFor(dt) {
    let kind = this.windy || this.smallBoard ? 'gybe' : 'tack';
    if (this.avoid === kind) kind = kind === 'gybe' ? 'tack' : 'gybe';
    if (this.avoid !== 'carve') this.avoid = null;
    this.turnT = 0;
    return this.startTurn(kind, dt);
  }

  /** Tacking: unhooked and feet out of the straps first. */
  tack(dt) {
    const s = this.sim.sailor;
    if (this.sim.state === S.SAILING && (s.hooked || s.straps > 0) && this.tphase === 0) {
      const c = this.coach.sail(dt, { twa: 80, hike: 'auto' });
      if (s.hooked) this.coach.press(c, 'hook', 1.5);
      if (s.straps > 0) c.strapsHeld = true;
      return c;
    }
    return super.tack(dt);
  }

  /** Gybing: unhooked first (you can't flip the sail hooked in). */
  gybe(dt) {
    if (this.sim.state === S.SAILING && this.sim.sailor.hooked && this.tphase === 0) {
      const c = this.coach.sail(dt, { ...this.style(), hook: false, twa: 120 });
      this.coach.press(c, 'hook', 1.5);
      return c;
    }
    return super.gybe(dt);
  }

  /** How it sails a reach: planing, in the straps and hooked in, jumping off the chop, in a breeze (pumping only when it's marginal). */
  style() {
    const chop = this.sim.waves.hsAt(this.sim.pos[0], this.sim.pos[2]) > 0.35;
    return this.windy ? { pump: this.windKn < 16, straps: true, hook: true, hike: 'auto', jump: chop } : { pump: true, hike: 'auto' };
  }

  /** Stuck in irons or swimming for ages, or gone far off its patch: back on the water, sailing. */
  unstick(dt) {
    const sim = this.sim, sp = Math.hypot(sim.vel[0], sim.vel[2]);
    const going = sim.state === S.SAILING ? sp > 0.8 && Math.abs(sim.twa) > 0.6 : [S.TRICK, S.TACK, S.FLIP, S.FALLING].includes(sim.state);
    this.stuck = going ? Math.max(0, this.stuck - 2 * dt) : this.stuck + dt;
    const far = Math.abs(sim.pos[0] - this.x0) > 450 || sim.pos[2] < BEACH_Z + 50 || sim.pos[2] > 700;
    if (this.stuck > 40 || far) {
      sim.reset('sailing', far ? [this.x0, 0, 60] : [sim.pos[0], 0, sim.pos[2]]);
      this.coach = new Coach(sim);
      this.turn = null; this.lesson = null; this.demo = null; this.stuck = 0;
      sim.emit('cruise', 'The coach is back on the water.', 1);
    }
  }
}
