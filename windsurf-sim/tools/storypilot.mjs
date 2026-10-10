// The story autopilot: the coach plays a chapter of the story, working on
// whichever goal is next, through the same controls a player uses: a pilot
// (src/coach/pilot.js: getting back on after a fall, heading for marks,
// tacking and gybing, the lessons' own demonstrations for carve gybes and
// tricks) given the story's goals. Used by tools/career-check.mjs.
import { clamp } from '../src/physics/math.js';
import { S } from '../src/physics/sim.js';
import { Coach } from '../src/coach/coach.js';
import { CLOSE, Pilot } from '../src/coach/pilot.js';
import { Career, ChapterRun, chapterSetup, findChapter } from '../src/game/career.js';
import { Sim } from '../src/physics/sim.js';
import { DEFAULT_SAILOR } from '../src/physics/gear.js';
import { SANDBAR, barCoords, placeAtStrip } from '../src/physics/spot.js';

const DT = 1 / 240;
const LIMIT = 420; // seconds on the water allowed for a chapter

const PLANE = { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' };
const LESSON_FOR = { carve: 'gybe', planegybe: 'gybe', duck: 'freestyle', c360: 'freestyle', spock: 'freestyle', heli: 'freestyle' };

export class StoryPilot extends Pilot {
  constructor(run, sim) {
    super(sim);
    this.run = run;
    this.goalId = null;
    this.leg = 'out';
  }

  controls(dt) {
    this.refresh();
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

  drive(g, dt) {
    const coach = this.coach;
    // A turn in progress finishes first.
    const t = this.turning(dt);
    if (t) return t;
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

