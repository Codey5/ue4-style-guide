// The story autopilot: the coach plays a chapter of the story, working on
// whichever goal is next, through the same controls a player uses. It gets
// back on after a fall (climbing on and uphauling a big board, waterstarting
// a small one), navigates to marks (zig-zagging upwind), tacks and gybes,
// and borrows the lessons' own demonstrations for carve gybes and tricks.
// Used by tools/career-check.mjs.
import { DEG, clamp } from '../src/physics/math.js';
import { S, emptyControls } from '../src/physics/sim.js';
import { Coach } from '../src/coach/coach.js';
import { LessonRunner, findLesson } from '../src/coach/lessons.js';
import { Career, ChapterRun, chapterSetup, findChapter } from '../src/game/career.js';
import { Sim } from '../src/physics/sim.js';
import { DEFAULT_SAILOR } from '../src/physics/gear.js';
import { SANDBAR, barCoords, placeAtStrip } from '../src/physics/spot.js';

const DT = 1 / 240;
const LIMIT = 420; // seconds on the water allowed for a chapter

const absTwa = (sim) => Math.abs(sim.twa) / DEG;
/** Hold the board on a true wind angle with the rig (secure position, waterstart). */
function rigSteer(sim, twaDeg) {
  const e = sim.twa - sim.sailor.side * twaDeg * DEG;
  return clamp(-sim.sailor.side * (2 * e + 0.8 * sim.yawRate), -1, 1);
}
const CLOSE = 50; // close-hauled, degrees off the wind
const FETCH = 56; // a mark this far off the wind can be reached close-hauled (with leeway)

const PLANE = { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' };
const LESSON_FOR = { carve: 'gybe', planegybe: 'gybe', duck: 'freestyle', c360: 'freestyle', spock: 'freestyle', heli: 'freestyle' };

export class StoryPilot {
  constructor(run, sim) {
    this.run = run;
    this.sim = sim;
    this.coach = new Coach(sim);
    this.goalId = null;
    this.turn = null; // a tack or gybe in progress
    this.lesson = null;
    this.prevState = sim.state;
    this.wsT = 0;
    this.leg = 'out';
  }

  controls(dt) {
    const sim = this.sim;
    // Back up and sailing: a fresh coach, from the trim we got going with.
    if (sim.state === S.SAILING && this.prevState !== S.SAILING && ![S.TACK, S.FLIP, S.TRICK].includes(this.prevState)) {
      const sheet = this.coach.sheet;
      this.coach = new Coach(sim);
      this.coach.sheet = Math.max(0.2, Math.min(sheet, 0.6));
      this.turn = null;
    }
    if (sim.state === S.FALLING || sim.state === S.WATER) { this.lesson = null; this.turn = null; }
    this.prevState = sim.state;
    const g = this.run.current?.goal;
    if (g && g.id !== this.goalId) {
      this.goalId = g.id;
      if (this.lesson && this.lesson.lesson.id !== LESSON_FOR[g.id]) this.lesson = null;
    }
    const up = this.recover(dt);
    if (up) return up;
    if (!g) return this.coach.sail(dt, { twa: 100, hike: 'auto' });
    return this.drive(g, dt);
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

  drive(g, dt) {
    const sim = this.sim, coach = this.coach;
    // A turn in progress finishes first.
    if (this.turn) { const c = this.turn === 'tack' ? this.tack(dt) : this.gybe(dt); if (c) return c; }
    const lid = LESSON_FOR[g.id];
    if (lid) return this.lessonControls(lid, dt);
    switch (g.id) {
      case 'bearaway': return coach.sail(dt, { twa: 140, turnRate: 15, hike: 'auto' });
      case 'headup': return coach.sail(dt, { twa: 52, turnRate: 15, hike: 'auto' });
      case 'close': return coach.sail(dt, { twa: CLOSE, turnRate: 10, hike: 'auto' });
      case 'tack': return this.startTurn('tack', dt);
      case 'gybe': return this.startTurn('gybe', dt);
      case 'outback': case 'upbuoy': case 'home': return this.goTo(this.run.target, dt);
      case 'hike': return coach.sail(dt, { twa: 85, hike: 'auto' });
      case 'go': case 'sail100': case 'gusts': return coach.sail(dt, { twa: 95, hike: 'auto' });
      case 'upplane': return coach.sail(dt, { ...PLANE, twa: 62, pump: false });
      case 'kn18': case 'kn20': return coach.sail(dt, { ...PLANE, twa: 120, pump: false });
      case 'jump': case 'jump50': case 'land3': return coach.sail(dt, { ...PLANE, pump: false, jump: true });
      case 'kn25': case 'm500': case 'kn27': case 'five10': return this.strip(dt);
      default: return coach.sail(dt, PLANE);
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

  /** Head for a mark: straight there if we can point at it, otherwise beat up to it. */
  goTo(mark, dt) {
    const sim = this.sim, side = sim.sailor.side;
    if (!mark) return this.coach.sail(dt, { twa: 100, hike: 'auto' });
    const dx = mark.at[0] - sim.pos[0], dz = mark.at[1] - sim.pos[2];
    const dist = Math.hypot(dx, dz);
    const off = Math.acos(clamp(-dx / dist, -1, 1)) / DEG; // the mark's angle off the wind
    const tack = dz >= 0 ? 1 : -1; // the tack that points at it
    if (off < FETCH && (tack === side || off < CLOSE - 5)) return this.coach.sail(dt, { twa: CLOSE, turnRate: 10, hike: 'auto' });
    if (tack !== side) {
      // On the wrong tack for it: tack if it's upwind of abeam, gybe if it's clearly downwind.
      if (off < 110) return this.startTurn('tack', dt);
      if (Math.abs(dz) / dist > 0.25) return this.startTurn('gybe', dt);
      return this.coach.sail(dt, { twa: 150, turnRate: 12, hike: 'auto' });
    }
    return this.coach.sail(dt, { twa: clamp(off, CLOSE, 150), turnRate: 12, hike: 'auto' });
  }

  startTurn(kind, dt) {
    this.turn = kind;
    this.tside = this.sim.sailor.side;
    this.tphase = 0;
    return kind === 'tack' ? this.tack(dt) : this.gybe(dt);
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

  /** Speed week: down the strip in its flat lee, and back to the top for another run. */
  strip(dt) {
    const sim = this.sim, w = sim.wind.dir;
    const [along, d] = barCoords(SANDBAR, w[0], w[2], sim.pos[0], sim.pos[2]);
    if (along > SANDBAR.length - 60 || d > 220) {
      // (a sailor would walk or sail back up; we start the next run at the top)
      placeAtStrip(sim);
      this.coach = new Coach(sim);
    }
    // Stay close to the bar, on the course line.
    const lane = SANDBAR.halfWidth + SANDBAR.laneD;
    return this.coach.sail(dt, { ...PLANE, pump: false, twa: clamp(120 - (d - lane) * 0.4, 110, 135) });
  }
}

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

/** Sail one chapter; returns when each goal was done, the falls and how it ended. */
export function playChapter(id, mass, verbose = false) {
  const ch = findChapter(id);
  const setup = chapterSetup(ch, mass);
  const sim = new Sim({
    boardId: setup.boardId, sailArea: setup.sailArea, sailorMass: mass, sailorHeight: DEFAULT_SAILOR.height,
    wind: { fromDeg: 270, ...setup.wind }, start: setup.start, assists: { autoHike: false, noFalls: false }, spot: { bar: SANDBAR },
  });
  if (ch.start === 'strip') placeAtStrip(sim);
  const run = new ChapterRun(ch, new Career(memoryStore()), sim);
  const pilot = new StoryPilot(run, sim);
  const times = {};
  let falls = 0, prev = sim.state, nextLog = 0;
  for (let i = 0; i < LIMIT / DT && !run.complete; i++) {
    sim.step(DT, pilot.controls(DT));
    pilot.after(DT);
    for (const g of run.step(DT)) times[g.id] = sim.t;
    if (sim.state === S.FALLING && prev !== S.FALLING) falls++;
    prev = sim.state;
    if (verbose && sim.t >= nextLog) {
      nextLog += 5;
      const cur = run.current;
      console.log(`   ${mass} kg t ${sim.t.toFixed(0)} ${cur?.goal.id ?? 'done'} ${cur?.tracker.label ?? ''} | ${sim.state} kn ${(sim.telemetry?.kn ?? 0).toFixed(1)} twa ${(sim.twa * 57.3).toFixed(0)} pos ${sim.pos[0].toFixed(0)},${sim.pos[2].toFixed(0)} side ${sim.sailor.side} ${pilot.turn ?? ''}${pilot.lesson ? ' lesson ' + pilot.lesson.lesson.id + ' ' + pilot.lesson.step : ''}`);
    }
  }
  return {
    id, mass, sail: setup.sailArea, board: setup.boardId, complete: run.complete, t: sim.t, falls, times,
    missing: run.goals.filter((g) => !g.done).map((g) => `${g.goal.id}${g.tracker.label ? ` (${g.tracker.label})` : ''}`),
  };
}

