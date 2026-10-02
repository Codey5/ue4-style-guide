// Lessons: each is a sequence of steps. In "watch" mode the coach sails it
// with real controller inputs; in "try" mode the player does, and the same
// checks tick the steps off. Captions use {TOKENS} that the UI turns into the
// right button glyphs for the player's controller or keyboard.
import { DEG, MS_TO_KN, clamp, smoothstep } from '../physics/math.js';
import { S, emptyControls } from '../physics/sim.js';
import { Coach } from './coach.js';

const kn = (sim) => (sim.telemetry ? sim.telemetry.kn : 0);
const absTwa = (sim) => Math.abs(sim.twa) / DEG;
const planing = (sim) => !!sim.telemetry && sim.telemetry.planing > 0.95 && sim.telemetry.speed > 5.5;
/** Hold the board on a true wind angle with the rig while in secure position or the water. */
function rigSteer(sim, twaDeg) {
  const side = sim.sailor.side;
  const e = sim.twa - side * twaDeg * DEG;
  return clamp(-side * (2 * e + 0.8 * sim.yawRate), -1, 1);
}

export const LESSONS = [
  {
    id: 'uphaul',
    title: 'Uphaul and first reach',
    summary: 'Climb on, pull the rig out of the water, find the secure position and sail off on a beam reach.',
    setup: { boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 9, gustiness: 0.1, shifts: 0.15, chop: 0.6 }, start: 'water' },
    steps: [
      {
        say: "You've fallen in. That happens a lot! The rig lies downwind of the board. Press {A} to climb on.",
        wait: 2.5,
        run: (x) => { const c = emptyControls(); x.coach.press(c, 'climb', 5); return c; },
        done: (sim) => sim.state === S.UPHAUL,
      },
      {
        say: 'Hold {LB} to pull the rig up by the uphaul rope. Bend your knees and lift with your legs, not your back.',
        wait: 1.5,
        run: () => { const c = emptyControls(); c.uphaul = true; return c; },
        done: (sim) => sim.state === S.SECURE,
      },
      {
        say: 'Secure position: the sail streams downwind like a flag. Tilt the rig toward the nose or the tail ({LS}) to turn the board until the wind blows straight across it.',
        run: (x) => { const c = emptyControls(); c.rake = rigSteer(x.sim, 90); return c; },
        done: (sim, x) => sim.state === S.SECURE ? Math.abs(absTwa(sim) - 90) < 15 && x.t > 3 : sim.state === S.SAILING,
      },
      {
        say: 'Squeeze {RT}: front hand on the boom, then sheet in with the back hand until the flutter along the luff stops.',
        wait: 1,
        minTime: 3.5,
        run: (x) => x.coach.sail(x.dt, { twa: 90, alpha: 17, hike: 'auto' }),
        done: (sim) => sim.state === S.SAILING && kn(sim) > 3,
      },
      {
        say: 'You are sailing a beam reach. Keep the angle of attack around 15–20°: sheet out if the sail feels heavy, in if the luff flutters.',
        run: (x) => x.coach.sail(x.dt, { twa: 90, alpha: 17, hike: 'auto' }),
        done: (sim, x) => (x.m.ok = (x.m.ok ?? 0) + (sim.state === S.SAILING && Math.abs(absTwa(sim) - 90) < 25 ? x.dt : 0)) > 8,
      },
    ],
  },
  {
    id: 'steering',
    title: 'Steering with the rig',
    summary: 'Below planing speed the rig is your rudder. Rake it forward to bear away, back to head up.',
    setup: { boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 10, gustiness: 0.1, shifts: 0.1, chop: 0.6 }, start: 'sailing' },
    steps: [
      {
        say: 'Settle on a beam reach first: rig upright, sail trimmed with {RT}.',
        run: (x) => x.coach.sail(x.dt, { twa: 90, hike: 'auto' }),
        done: (sim, x) => x.t > 4 && Math.abs(absTwa(sim) - 90) < 15,
      },
      {
        say: 'Rake the rig toward the nose ({LS} up). The sail\'s centre of effort moves ahead of the daggerboard and the nose turns away from the wind: you bear away. Ease the sheet as you turn.',
        run: (x) => x.coach.sail(x.dt, { twa: 140, turnRate: 12, hike: 'auto' }),
        done: (sim) => absTwa(sim) > 128,
      },
      {
        say: 'Now rake the rig toward the tail ({LS} down) and sheet in. The nose comes up toward the wind: you head up.',
        run: (x) => x.coach.sail(x.dt, { twa: 52, turnRate: 12, hike: 'auto' }),
        done: (sim) => absTwa(sim) < 62,
      },
      {
        say: 'Bring the rig back upright and settle on a beam reach. Small rig movements, small course changes.',
        run: (x) => x.coach.sail(x.dt, { twa: 90, turnRate: 10, hike: 'auto' }),
        done: (sim, x) => x.t > 4 && Math.abs(absTwa(sim) - 90) < 12,
      },
    ],
  },
  {
    id: 'planing',
    title: 'Getting planing',
    summary: 'Push through the hump, then move back, hook in and get into the straps.',
    setup: { boardId: 'free135', sailArea: 7.0, wind: { speedKn: 16, gustiness: 0.12, shifts: 0.15, chop: 0.8 }, start: 'sailing' },
    steps: [
      {
        say: 'Bear away to a beam reach. Keep the board flat and your front foot by the mast foot, weight forward ({RS} up).',
        run: (x) => x.coach.sail(x.dt, { twa: 100, hike: 'auto', weight: 0.3 }),
        done: (sim, x) => x.t > 3 && Math.abs(absTwa(sim) - 100) < 15,
      },
      {
        say: 'Sheet in, lean the rig a little to windward and pump ({RB}) to push through the hump drag. Hike out ({LT}) as the pull builds.',
        minTime: 4,
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, hike: 'auto', weight: 0.3 }),
        done: (sim) => planing(sim) && kn(sim) > 11,
      },
      {
        say: 'Planing! The board lifts onto the water and the drag drops. Move your weight back ({RS} down), come in toward the boom and hook into the harness ({A}).',
        wait: 1,
        minTime: 3.5,
        run: (x) => x.coach.sail(x.dt, { twa: 105, moveBack: true, hook: true, hike: 'auto' }),
        done: (sim) => sim.sailor.hooked && sim.sailor.x <= sim.board.frontStrapX + 0.22,
      },
      {
        say: 'Step into the front strap ({X}), then the back strap ({X}). Only once you\'re planing, or you\'ll sink the tail.',
        wait: 1,
        minTime: 3.5,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim) => sim.sailor.straps === 2,
      },
      {
        say: 'Hang off the harness lines with {LT} and let your weight counter the pull. To hang further out, lean the rig to windward ({LS}). Watch the balance needle, and sheet out a touch when a gust hits.',
        run: (x) => x.coach.sail(x.dt, { twa: 108, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 9 && planing(sim),
      },
    ],
  },
  {
    id: 'tack',
    title: 'Tack',
    summary: 'Turn through the wind: head up with the rig back, step round the front of the mast, bear away on the new side.',
    setup: { boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 10, gustiness: 0.1, shifts: 0.1, chop: 0.6 }, start: 'sailing' },
    steps: [
      {
        say: 'Head up to close-hauled, about 55° to the wind: rake the rig back ({LS} down) and sheet in.',
        run: (x) => x.coach.sail(x.dt, { twa: 55, turnRate: 10, hike: 'auto' }),
        done: (sim, x) => x.t > 3 && absTwa(sim) < 64,
      },
      {
        say: 'Keep the sail sheeted in and rake the rig right back over the tail. The board turns into the wind.',
        minTime: 2,
        run: (x) => { const c = emptyControls(); c.rake = -1; c.sheet = 1; c.hike = x.coach.hikeFor(x.dt); return c; },
        done: (sim) => absTwa(sim) < 34 || sim.state === S.TACK,
      },
      {
        say: 'Nose close to the wind: press {B} and step round the front of the mast, holding it as you go.',
        wait: 0.6,
        run: (x) => { const c = emptyControls(); c.rake = -1; c.sheet = 1; x.coach.press(c, 'tack', 3); return c; },
        done: (sim) => sim.state === S.TACK,
      },
      {
        say: 'Wait for the nose to pass through the wind, then change sides and swing the rig forward to bear away on the new tack.',
        run: () => { const c = emptyControls(); c.sheet = 0.5; return c; },
        done: (sim, x) => sim.state === S.SAILING && sim.sailor.side !== x.lesson.side0,
      },
      {
        say: 'Sheet in ({RT}) and sail away on the new tack. That\'s a tack!',
        run: (x) => x.coach.sail(x.dt, { twa: 85, turnRate: 8, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && kn(sim) > 2,
      },
    ],
    begin: (sim, lesson) => { lesson.side0 = sim.sailor.side; },
  },
  {
    id: 'gybe',
    title: 'Carve gybe',
    summary: 'Turn downwind on the plane: unhook, carve on the inside rail, flip the sail at dead downwind, power out.',
    setup: { boardId: 'free135', sailArea: 7.0, wind: { speedKn: 17, gustiness: 0.1, shifts: 0.1, chop: 0.8 }, start: 'sailing' },
    steps: [
      {
        say: 'Get planing on a broad reach, hooked in and in both straps.',
        run: (x) => x.coach.sail(x.dt, { twa: 112, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && planing(sim) && sim.sailor.hooked && sim.sailor.straps === 2 && kn(sim) > 15,
      },
      {
        say: 'Ease the sheet a touch, unhook ({A}) and take your feet out of the straps (hold {X}). Keep your speed up.',
        wait: 0.5,
        minTime: 3,
        run: (x) => {
          const c = x.coach.sail(x.dt, { twa: 115, hike: 'auto' });
          c.sheet = Math.max(0.3, c.sheet - Math.min(1, x.t / 1.2) * 0.15);
          if (x.t > 1.2 && x.sim.sailor.hooked) x.coach.press(c, 'hook', 2);
          if (x.t > 1.6) c.strapsHeld = true;
          return c;
        },
        done: (sim) => !sim.sailor.hooked && sim.sailor.straps === 0,
      },
      {
        say: 'Carve: sink the leeward rail with your toes ({RS} toward the sail), rake the rig forward and to windward, and keep the sail sheeted in.',
        run: (x) => {
          const sim = x.sim, side = sim.sailor.side;
          x.lesson.turnSide = side;
          const c = emptyControls();
          // Move the rig into the carve over a moment rather than throwing it:
          // a rig snapped forward pumps a burst of apparent wind into the sail.
          const k = smoothstep(0, 0.8, x.t);
          c.rail = -side;
          c.rake = 0.7 * k;
          c.lean = side * (0.2 + 0.35 * k);
          c.weight = 0.35;
          x.coach.sheet = clamp(x.coach.sheet + (0.62 - x.coach.sheet) * x.dt * 2, 0, 1);
          c.sheet = x.coach.sheet;
          c.hike = x.coach.hikeFor(x.dt);
          return c;
        },
        done: (sim) => absTwa(sim) > 163,
      },
      {
        say: 'Dead downwind: flip the sail ({Y}). Let go with the back hand and the clew swings round the front of the mast.',
        wait: 0.15,
        run: (x) => {
          const c = emptyControls(), side = x.lesson.turnSide;
          c.rail = -side; c.rake = 0.4; c.sheet = 0.5; c.weight = 0.3;
          x.coach.press(c, 'flip', 3);
          return c;
        },
        done: (sim) => sim.state === S.FLIP,
      },
      {
        say: 'Grab the boom on the new side and keep carving on the same rail until the board is across the wind again.',
        run: (x) => {
          const sim = x.sim, side = x.lesson.turnSide;
          const rail = -side * (absTwa(sim) > 135 ? 1 : 0.5);
          if (sim.state === S.FLIP) {
            const c = emptyControls();
            c.rail = rail; c.rake = 0.4; c.sheet = 0; c.lean = sim.sailor.side * 0.3;
            x.coach.sheet = 0.2; // catch the new side gently
            x.coach.cur = undefined;
            return c;
          }
          // New side: keep the carve going while sheeting in against your body weight.
          return x.coach.sail(x.dt, { twa: 118, turnRate: 30, hike: 'auto', rail });
        },
        done: (sim) => sim.state === S.SAILING && sim.sailor.side !== undefined && absTwa(sim) < 128,
      },
      {
        say: 'Sheet in, power up and step back into the straps. Gybe complete!',
        run: (x) => x.coach.sail(x.dt, { twa: 110, turnRate: 10, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 6 && sim.state === S.SAILING,
      },
    ],
  },
  {
    id: 'waterstart',
    title: 'Waterstart',
    summary: 'Let the wind lift you out of the water. Needs about 12 knots or more.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 16, gustiness: 0.1, shifts: 0.1, chop: 0.8 }, start: 'water' },
    steps: [
      {
        say: 'In the water with the rig downwind of you. Hold {LB} to clear the sail out of the water and lift it up into the wind.',
        wait: 2,
        run: () => { const c = emptyControls(); c.uphaul = true; return c; },
        done: (sim) => sim.state === S.WATERSTART && sim.stateData.phase === 'power',
      },
      {
        say: 'Keep holding {LB}. Steer the board across the wind with the rig ({LS}): forward bears the nose away, back brings it up.',
        run: (x) => { const c = emptyControls(); c.uphaul = true; c.rake = rigSteer(x.sim, 95); c.sheet = 0.12; return c; },
        done: (sim, x) => x.t > 2.5 && sim.state === S.WATERSTART && Math.abs(absTwa(sim) - 95) < 18,
      },
      {
        say: 'Sheet in ({RT}) until the sail fills, and let it pull you up over the board. Too little and it flaps; too much and it stalls. Stay close to the board.',
        minTime: 2.5,
        run: (x) => {
          if (x.sim.state === S.SAILING) return x.coach.sail(x.dt, { twa: 100, hike: 'auto' });
          const c = emptyControls(); c.uphaul = true; c.rake = rigSteer(x.sim, 95);
          c.sheet = clamp(0.12 + x.t * 0.25, 0, 0.5);
          x.coach.sheet = c.sheet;
          return c;
        },
        done: (sim) => sim.state === S.RISING || sim.state === S.SAILING,
      },
      {
        say: 'You\'re up! Hike out ({LT}) against the pull, sheet in and sail away.',
        run: (x) => x.coach.sail(x.dt, { twa: 100, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && sim.state === S.SAILING,
      },
    ],
  },
];

export const findLesson = (id) => LESSONS.find((l) => l.id === id);

/**
 * Runs a lesson against a sim. mode: 'watch' (coach drives) or 'try' (player drives).
 */
export class LessonRunner {
  constructor(lesson, mode, sim) {
    this.lesson = lesson;
    this.mode = mode;
    this.sim = sim;
    this.coach = new Coach(sim);
    this.step = 0;
    this.t = 0;
    this.mem = {};
    this.done = false;
    this.failed = null;
    this.fallTime = 0;
    this.prev = emptyControls();
    lesson.begin?.(sim, this);
  }

  get current() {
    return this.lesson.steps[this.step];
  }

  ctx(dt) {
    return { sim: this.sim, coach: this.coach, dt, t: this.t, m: this.mem, lesson: this };
  }

  /** Coach controls for one physics step (watch mode). */
  controls(dt) {
    const st = this.current;
    if (!st || this.done) {
      // After the last step the coach keeps sailing.
      return this.coach.sail(dt, { twa: 100, hike: 'auto', straps: this.lesson.id === 'planing' || this.lesson.id === 'gybe', hook: true });
    }
    // A short lead-in so the viewer can read the caption: keep doing what we were doing.
    if (this.t < (st.wait ?? 0)) return { ...this.prev, pressed: {} };
    const c = st.run(this.ctx(dt));
    this.prev = c;
    return c;
  }

  /** Advance the lesson after a physics step. Returns 'step' | 'complete' | 'fell' | null. */
  update(dt) {
    if (this.done) return null;
    this.t += dt;
    const sim = this.sim;
    const st = this.current;
    if (sim.state === S.FALLING || sim.state === S.WATER) {
      // A step that starts in the water is fine; otherwise a fall stalls the lesson.
      if (!st.done(sim, this.ctx(dt)) && this.lesson.setup.start !== 'water') {
        this.fallTime += dt;
        if (this.mode === 'watch' && this.fallTime > 2.5) { this.failed = 'fell'; return 'fell'; }
      }
    } else this.fallTime = 0;
    // Once a step's goal is reached it stays reached. Watching, a step stays on
    // screen long enough to read while the coach carries on doing it.
    if (!this.mem.reached && st.done(sim, this.ctx(dt))) this.mem.reached = true;
    const minT = this.mode === 'watch' ? Math.max((st.wait ?? 0) + 0.25, st.minTime ?? 0) : 0.25;
    if (this.mem.reached && this.t >= minT) {
      this.step++;
      this.t = 0;
      this.mem = {};
      if (this.step >= this.lesson.steps.length) {
        this.done = true;
        return 'complete';
      }
      return 'step';
    }
    if (this.mode === 'watch' && this.t > 45) { this.failed = 'timeout'; return 'fell'; }
    return null;
  }
}

export { MS_TO_KN };
