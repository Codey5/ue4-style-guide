// A pilot: the coach sailing on its own through the same controls a player
// uses, with the skills to keep going. It gets back on after a fall
// (climbing on and uphauling a big board, waterstarting a small one),
// heads for a mark (zig-zagging upwind), tacks and gybes, and borrows the
// lessons' own demonstrations for carve gybes and tricks. The story's
// autopilot (tools/storypilot.mjs, for the headless checks) and the cruise
// (the coach sailing round while you watch) are built on it.
import { DEG, clamp } from '../physics/math.js';
import { S, emptyControls } from '../physics/sim.js';
import { Coach } from './coach.js';
import { LessonRunner, findLesson } from './lessons.js';

export const absTwa = (sim) => Math.abs(sim.twa) / DEG;
/** Hold the board on a true wind angle with the rig (secure position, waterstart). */
export function rigSteer(sim, twaDeg) {
  const e = sim.twa - sim.sailor.side * twaDeg * DEG;
  return clamp(-sim.sailor.side * (2 * e + 0.8 * sim.yawRate), -1, 1);
}
export const CLOSE = 50; // close-hauled, degrees off the wind
const FETCH = 56; // a mark this far off the wind can be reached close-hauled (with leeway)

export class Pilot {
  constructor(sim) {
    this.sim = sim;
    this.coach = new Coach(sim);
    this.turn = null; // a tack or gybe in progress
    this.lesson = null;
    this.prevState = sim.state;
    this.wsT = 0;
  }

  /** Each step, first: back up and sailing, a fresh coach (from the trim we got going with); a fall ends a turn or a demo. */
  refresh() {
    const sim = this.sim;
    if (sim.state === S.SAILING && this.prevState !== S.SAILING && ![S.TACK, S.FLIP, S.TRICK].includes(this.prevState)) {
      const sheet = this.coach.sheet;
      this.coach = new Coach(sim);
      this.coach.sheet = Math.max(0.2, Math.min(sheet, 0.6));
      this.turn = null;
    }
    if (sim.state === S.FALLING || sim.state === S.WATER) { this.lesson = null; this.turn = null; }
    this.prevState = sim.state;
  }

  /** Getting back on and going: climb on and uphaul a big board, waterstart a small one. */
  recover(dt) {
    const sim = this.sim, c = emptyControls();
    const waterstart = sim.board.volume < 140;
    switch (sim.state) {
      case S.WATER:
        if (waterstart) { c.uphaul = true; this.wsT = 0; } else this.coach.press(c, 'climb', 4);
        return c;
      case S.FALLING: case S.CLIMB:
        return c;
      case S.UPHAUL:
        c.uphaul = true;
        return c;
      case S.SECURE:
        c.rake = rigSteer(sim, 90);
        if (Math.abs(absTwa(sim) - 90) < 20) c.sheet = 0.6;
        this.coach.sheet = 0.35;
        return c;
      case S.WATERSTART: case S.RISING:
        c.uphaul = true;
        c.rake = rigSteer(sim, 95);
        // (sheet in once the board's across the wind, or near enough after a few seconds of trying)
        if (sim.stateData.phase === 'power') this.wsPower = (this.wsPower ?? 0) + dt; else this.wsPower = 0;
        if (sim.state === S.RISING || (sim.stateData.phase === 'power' && (Math.abs(absTwa(sim) - 95) < 18 || (this.wsPower > 3 && absTwa(sim) > 50)))) this.wsT += dt;
        c.sheet = this.wsT > 0 ? clamp(0.12 + this.wsT * 0.25, 0, 0.5) : 0.12;
        this.coach.sheet = c.sheet;
        return c;
      default:
        return null;
    }
  }

  /** A lesson's own coach demonstrating the move (started afresh whenever it finishes or we fell). */
  lessonControls(id, dt) {
    if (!this.lesson || this.lesson.done) this.lesson = new LessonRunner(findLesson(id), 'watch', this.sim);
    const c = this.lesson.controls(dt);
    this.lessonPending = true;
    return c;
  }

  /** After each physics step (the lesson's own bookkeeping). */
  after(dt) {
    if (this.lesson && this.lessonPending) {
      const r = this.lesson.update(dt);
      if (r === 'fell') this.lesson = null;
    }
    this.lessonPending = false;
  }

  /** Head for a mark: straight there if we can point at it, otherwise beat up to it. style: the coach's options under way. */
  goTo(mark, dt, style = { hike: 'auto' }) {
    const sim = this.sim, side = sim.sailor.side;
    if (!mark) return this.coach.sail(dt, { ...style, twa: 100 });
    const dx = mark.at[0] - sim.pos[0], dz = mark.at[1] - sim.pos[2];
    const dist = Math.hypot(dx, dz);
    const off = Math.acos(clamp(-dx / dist, -1, 1)) / DEG; // the mark's angle off the wind
    const tack = dz >= 0 ? 1 : -1; // the tack that points at it
    if (off < FETCH && (tack === side || off < CLOSE - 5)) return this.coach.sail(dt, { ...style, twa: CLOSE, turnRate: 10 });
    if (tack !== side) {
      // On the wrong tack for it: tack if it's upwind of abeam, gybe if it's clearly downwind.
      if (off < 110) return this.startTurn('tack', dt);
      if (Math.abs(dz) / dist > 0.25) return this.startTurn('gybe', dt);
      return this.coach.sail(dt, { ...style, twa: 150, turnRate: 12 });
    }
    return this.coach.sail(dt, { ...style, twa: clamp(off, CLOSE, 150), turnRate: 12 });
  }

  startTurn(kind, dt) {
    this.turn = kind;
    this.tside = this.sim.sailor.side;
    this.tphase = 0;
    return kind === 'tack' ? this.tack(dt) : this.gybe(dt);
  }

  /** A turn in progress (null once it's done). */
  turning(dt) {
    return this.turn ? (this.turn === 'tack' ? this.tack(dt) : this.gybe(dt)) : null;
  }

  /** Head up, rig right back, step round the mast at the wind, bear away on the new side. */
  tack(dt) {
    const sim = this.sim, coach = this.coach, c = emptyControls();
    if (sim.state === S.TACK) { c.sheet = 0.5; this.tphase = 2; return c; }
    if (this.tphase === 2 || sim.sailor.side !== this.tside) {
      if (sim.state === S.SAILING) { this.turn = null; coach.cur = undefined; coach.sheet = 0.4; return null; }
      return c;
    }
    if (absTwa(sim) > 64 && this.tphase === 0) return coach.sail(dt, { twa: 52, turnRate: 15, hike: 'auto' });
    this.tphase = 1;
    c.rake = -1; c.sheet = 1; c.hike = coach.hikeFor(dt);
    if (absTwa(sim) < 34) coach.press(c, 'tack', 3);
    return c;
  }

  /** Bear away until the wind is behind, flip the sail, sheet in on the new side. */
  gybe(dt) {
    const sim = this.sim, coach = this.coach, c = emptyControls();
    if (sim.state === S.FLIP) { c.sheet = 0; c.rake = 0.3; this.tphase = 2; coach.cur = undefined; coach.sheet = 0.2; return c; }
    if (this.tphase === 2 || sim.sailor.side !== this.tside) {
      if (sim.state === S.SAILING) { this.turn = null; return null; }
      return c;
    }
    const cc = coach.sail(dt, { twa: 170, turnRate: 25, hike: 'auto' });
    if (absTwa(sim) > 166) coach.press(cc, 'flip', 3);
    return cc;
  }
}
