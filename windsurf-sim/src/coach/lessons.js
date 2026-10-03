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
/** Seconds a condition has held (accumulated in the step's memory under `key`). */
const held = (x, key, cond) => (x.m[key] = cond ? (x.m[key] ?? 0) + x.dt : 0);
/**
 * A scripted gust: once you're planing, `at` seconds into the step it sweeps
 * in, building over 0.6 s to `size` (a fraction of the wind), holds for
 * `hold` seconds and fades over 1.5 s. Sets x.m.gustOn while it's building
 * and x.m.gustPassed once it has gone through.
 */
function gust(x, size, { at = 3, hold = 3.5 } = {}) {
  const m = x.m, sim = x.sim;
  if (m.gustT === undefined) {
    if (x.t < at || !planing(sim)) { sim.wind.boost = 0; return; }
    m.gustT = x.t;
    sim.emit('gust', `Gust! ${Math.round(sim.wind.speedKn * (1 + size))} knots coming through`, 2);
  }
  const g = x.t - m.gustT;
  const k = g < 0.6 ? smoothstep(0, 0.6, g) : g < 0.6 + hold ? 1 : 1 - smoothstep(0.6 + hold, 2.1 + hold, g);
  sim.wind.boost = size * k;
  m.gustOn = g < 0.6;
  m.gustPassed = g > 2.1 + hold;
}
/** Jumps you popped and landed (at least 0.3 s in the air) during this step, passing `ok`. */
function jumps(sim, x, ok = () => true) {
  const m = x.m;
  m.since ??= sim.t - x.t;
  if (sim.jump && sim.jump !== m.lastJump) {
    m.lastJump = sim.jump;
    if (sim.jump.t > m.since && sim.jump.popped && sim.jump.air >= 0.3 && sim.state === S.SAILING && ok(sim.jump)) m.jumps = (m.jumps ?? 0) + 1;
  }
  return m.jumps ?? 0;
}
const strapsReady = (sim, x, minKn) => x.t > 4 && planing(sim) && sim.sailor.hooked && sim.sailor.straps === 2 && kn(sim) > minKn;

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
  {
    id: 'foreaft',
    title: 'Lean back against the pull',
    summary: 'The sail tips you forward as well as sideways. Balance it fore and aft with your weight and your lean back.',
    setup: { boardId: 'free135', sailArea: 7.0, wind: { speedKn: 15, gustiness: 0.1, shifts: 0.1, chop: 0.8 }, start: 'sailing' },
    steps: [
      {
        say: 'Get planing on a beam reach, hooked in and in both straps.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 14),
      },
      {
        say: 'The rig is pinned at the mast foot and its drive tips it forward. You hold it back through the harness, so it tips you forward too, over your front foot. You balance that by leaning back. Watch the stance panel: the grey bar is where your feet can press, heel to toes; the line is where they press now; the ring is your centre of mass, held back behind them by the pull.',
        minTime: 9,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 9,
      },
      {
        say: 'Weight forward ({RS} up, gently). You stand taller and press through the front foot, and more of your weight hangs on the boom into the mast foot. The nose goes down: more grip in chop, but more drag.',
        minTime: 4,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', weight: 0.6 }),
        done: (sim, x) => held(x, 'fwd', sim.state === S.SAILING && sim.sailor.leanX > 0.05) > 2.5,
      },
      {
        say: 'Now weight back ({RS} down). Sink your hips back over the tail and press through the back foot. The nose lifts and the board frees up.',
        minTime: 4,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', weight: -0.8 }),
        done: (sim, x) => held(x, 'back', sim.state === S.SAILING && sim.sailor.leanX < -0.08) > 2.5,
      },
      {
        say: 'Bear away to a broad reach (rig forward, {LS} up). The sail\'s pull swings forward: less of it pulls you out sideways, more of it tips you forward. Hang out less and sink back over the back foot.',
        minTime: 5,
        run: (x) => x.coach.sail(x.dt, { twa: 132, turnRate: 8, straps: true, hook: true, hike: 'auto', weight: -0.8 }),
        done: (sim, x) => held(x, 'broad', sim.state === S.SAILING && absTwa(sim) > 122) > 3,
      },
      {
        say: 'Head back up to a beam reach (rig back, {LS} down). The pull swings out to the side again: hang further out and stand a little taller.',
        minTime: 4,
        run: (x) => x.coach.sail(x.dt, { twa: 100, turnRate: 8, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => held(x, 'beam', sim.state === S.SAILING && absTwa(sim) < 110) > 2,
      },
    ],
  },
  {
    id: 'catapult',
    title: 'Gusts and catapults',
    summary: 'Why a gust launches you over the boom when you\'re hooked in, and how to ride it out instead.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 16, gustiness: 0, shifts: 0.1, chop: 0.8 }, start: 'sailing' },
    steps: [
      {
        say: 'Get planing on a beam reach, hooked in and in both straps.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 16),
      },
      {
        say: 'Hooked in, the harness lines hold the rig with your hips, and nothing gives. Now the wrong way: weight forward, sail locked in. A gust is coming. Watch the stance panel go red as its pull tips the coach over the front foot…',
        watchOnly: true,
        expectFall: true,
        run: (x) => {
          const c = x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' });
          if (x.m.lock === undefined) x.m.lock = c.sheet;
          c.sheet = x.coach.sheet = x.m.lock;
          c.weight = 0.5;
          return c;
        },
        tick: (x) => gust(x, 0.5),
        done: (sim) => (sim.state === S.FALLING && sim.stateTime > 1.6) || sim.state === S.WATER,
      },
      {
        say: 'Catapult! Launched over the boom by the harness lines. Back on the board: get planing again, hooked in and in both straps.',
        enter: (sim, run) => run.resetToSailing(),
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 16),
      },
      {
        say: 'Another gust is coming. This time, as it hits: sink your weight back ({RS} down) and ease the sheet ({RT}) to spill the extra power. Sheet back in as it passes.',
        retryOnFall: 'Catapulted! Back on the board. Try again: weight back and ease the sheet the moment the gust hits.',
        run: (x) => {
          const c = x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', weight: x.sim.wind.boost > 0.02 ? -1 : -0.3 });
          // (eased a touch more while the gust builds: you feel it coming)
          if (x.m.gustOn) c.sheet = x.coach.sheet = Math.max(0.4, c.sheet - 0.25 * x.dt);
          return c;
        },
        tick: (x) => gust(x, 0.45),
        done: (sim, x) => !!x.m.gustPassed && sim.state === S.SAILING,
      },
      {
        say: 'You rode it out. Gusts show as dark patches on the water upwind: get your weight back and be ready on the sheet before they reach you.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && sim.state === S.SAILING,
      },
    ],
  },
  {
    id: 'tuning',
    title: 'Tuning the rig',
    summary: 'Harness lines over the draft, and downhaul for a windy day. The lesson retunes your rig as you sail so you can feel each change.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 16, gustiness: 0.15, shifts: 0.1, chop: 0.8 }, start: 'sailing', tune: { linesPos: -0.1 } },
    steps: [
      {
        say: 'Your harness lines are set 10 cm too far forward. Get planing on a beam reach, hooked in and in both straps.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 15),
      },
      {
        say: 'Watch the Hands bar. The sail\'s pull sits at its draft, behind your lines, so your back hand does the work the harness should. Over a long run, or in the gusts, that\'s what tires your forearms.',
        minTime: 7,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 7,
      },
      {
        say: 'On the beach you\'d move the lines back over the draft. Done: both hands go light and the harness takes the pull.',
        enter: (sim) => sim.setTune({ linesPos: 0 }),
        minTime: 6,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 6 && sim.sailor.hooked && Math.abs(sim.hands?.couple ?? 99) < 30,
      },
      {
        say: 'The wind is building to 22 knots and gusty. On normal downhaul the gusts blow the draft back: the back hand loads up and the pull jerks you forward.',
        enter: (sim) => sim.setWind({ speedKn: 22, gustiness: 0.6 }),
        minTime: 8,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 8,
      },
      {
        say: 'Maximum downhaul. The top of the sail twists open and spills the gusts, and the draft stays put: steadier, and faster when it\'s windy. In light wind you\'d ease it off again for power.',
        enter: (sim) => sim.setTune({ downhaul: 1 }),
        minTime: 8,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 8 && sim.state === S.SAILING,
      },
    ],
  },
  {
    id: 'chop',
    title: 'Sailing through chop',
    summary: 'Rough water at speed: keep the nose up, let your legs soak up the slaps, and pick your angle to the waves.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 20, gustiness: 0.1, shifts: 0.1, chop: 1.5 }, start: 'sailing' },
    steps: [
      {
        say: 'Rough water today. Get planing on a beam reach, hooked in and in both straps.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 15),
      },
      {
        say: 'At speed every chop throws the board up and slaps it down. Your legs soak up most of it, but the board skips off the tops and flies off the steeper ones. Feel the slaps through the controller; in the air it goes quiet.',
        minTime: 7,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 7,
      },
      {
        say: 'Weight forward ({RS} up) and the nose sits low: it rides into the backs of the waves and digs in, and the board slows. Bury it properly and it stops dead and throws you over the front.',
        minTime: 6,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', weight: 0.5 }),
        done: (sim, x) => held(x, 'fwd', sim.state === S.SAILING && sim.sailor.leanX > 0.05) > 4,
      },
      {
        say: 'Weight back ({RS} down) and a touch less sheet. The nose stays up over the chop: the board skims and hops off the tops instead of digging in. Keep it there in the air and land flat or tail first.',
        minTime: 6,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', weight: -1 }),
        done: (sim, x) => held(x, 'back', sim.state === S.SAILING && sim.sailor.leanX < -0.1) > 4,
      },
      {
        say: 'Bear away to a broad reach (rig forward, {LS} up). Sailing with the waves you meet them less often and the ride smooths out; heading up into them is the roughest.',
        minTime: 5,
        run: (x) => x.coach.sail(x.dt, { twa: 128, turnRate: 8, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => held(x, 'broad', sim.state === S.SAILING && absTwa(sim) > 118) > 3,
      },
      {
        say: 'Back to a beam reach. In chop: weight back, knees soft, a little less sheet, and keep the nose up.',
        run: (x) => x.coach.sail(x.dt, { twa: 100, turnRate: 8, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && sim.state === S.SAILING,
      },
    ],
  },
  {
    id: 'jump',
    title: 'Jumping off the chop',
    summary: 'Use a chop face as a ramp: crouch, pop as the tail climbs it, fly with the nose up and land tail first.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 20, gustiness: 0.1, shifts: 0.1, chop: 1.5 }, start: 'sailing' },
    steps: [
      {
        say: 'Good jumping weather: 20 knots and a short, steep chop. Get planing on a beam reach, hooked in and in both straps (they\'re how you take the board with you).',
        run: (x) => x.coach.sail(x.dt, { twa: 105, pump: true, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => strapsReady(sim, x, 15),
      },
      {
        say: 'Watch the water just ahead. As a steep face comes, hold {LB} to crouch: knees bent, loading up. As the tail starts up the face, let go: your legs drive the board off the water, and stiff legs take the whole kick of the face on top of yours.',
        minTime: 6,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', jump: true }),
        done: (sim, x) => jumps(sim, x) >= 1,
      },
      {
        say: 'In the air: weight back ({RS} down) keeps the nose up, the sail sheeted in ({RT}) holds you up, and you pull your knees up under you. Land tail first, or flat, and let your knees soak it up.',
        minTime: 7,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', jump: true }),
        done: (sim, x) => jumps(sim, x, (j) => j.how !== 'nose first!') >= 2,
      },
      {
        say: 'Nose first is the one to avoid: weight forward in the air drops the nose, it digs in and stops the board dead, and you go over the front. The steeper the face and the faster you hit it, the higher you fly: pick the steep ones.',
        minTime: 8,
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto', jump: true }),
        done: (sim, x) => jumps(sim, x) >= 2,
      },
      {
        say: 'On flat water a pop is only a little hop: the chop is your ramp. Every landing costs a little speed, so speed sailors keep the board on the water; the rest of us go looking for ramps.',
        run: (x) => x.coach.sail(x.dt, { twa: 105, straps: true, hook: true, hike: 'auto' }),
        done: (sim, x) => x.t > 5 && sim.state === S.SAILING,
      },
    ],
  },
  {
    id: 'freestyle',
    title: 'Freestyle',
    summary: 'Four moves off the plane: the duck gybe, the carving 360, the spock and the helitack.',
    setup: { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 18, gustiness: 0.05, shifts: 0.05, chop: 0.5 }, start: 'sailing' },
    steps: [
      {
        say: 'Freestyle: tricks are all started the same way. Hold {LB} to crouch, then press a button. First get planing on a broad reach, unhooked, front foot in the strap.',
        run: (x) => x.coach.sail(x.dt, { twa: 110, pump: true, straps: true, hook: false, hike: 'auto' }),
        done: (sim, x) => x.t > 4 && planing(sim) && kn(sim) > 15 && !sim.sailor.hooked,
      },
      {
        say: 'Duck gybe. Carve downwind on the leeward rail ({RS} toward the sail). As the board heads downwind, {LB} + {Y}: you throw the rig across and duck under it, and the clew goes over your head instead of round the front. Catch the boom on the new side and keep carving.',
        retryOnFall: 'Wiped out! Duck as the board goes through downwind: too early and the wind fills the sail from the wrong side. Again.',
        run: (x) => {
          const sim = x.sim, m = x.m;
          if (m.turnSide === undefined) { m.turnSide = sim.sailor.side; m.since = sim.t; }
          const ts = m.turnSide;
          if (sim.state === S.TRICK) {
            const c = emptyControls();
            c.rail = -ts; c.rake = 0.4; c.sheet = 0.55; c.weight = 0.3; c.hike = x.coach.hikeFor(x.dt);
            x.coach.cur = undefined;
            x.coach.sheet = 0.5;
            return c;
          }
          if (sim.lastTrick && sim.lastTrick.t > m.since) {
            // Out of it on the new side: keep carving onto the new reach,
            // holding the sail in close (let right out this deep, the boom
            // goes out over the water beyond your reach).
            const c = x.coach.sail(x.dt, { twa: 118, turnRate: 30, hook: false, hike: 'auto', rail: -ts * (absTwa(sim) > 135 ? 1 : 0.5) });
            if (absTwa(sim) > 140) { x.coach.sheet = 0.5; c.sheet = 0.5; }
            return c;
          }
          // Off the plane (back from a wipeout, or slowed in the carve): get
          // going again on a broad reach first.
          if (!m.carving && !(planing(sim) && kn(sim) > 15)) {
            m.turnSide = sim.sailor.side;
            return x.coach.sail(x.dt, { twa: 110, pump: true, straps: true, hook: false, hike: 'auto' });
          }
          if (!m.carving) { m.carving = sim.t; m.turnSide = sim.sailor.side; }
          if (sim.telemetry.planing < 0.75 && absTwa(sim) < 140) { m.carving = 0; return x.coach.sail(x.dt, { twa: 110, hook: false, hike: 'auto' }); }
          // The carve in, as for a carve gybe, and the duck through downwind.
          const c = emptyControls();
          const k = smoothstep(0, 0.8, sim.t - m.carving);
          c.rail = -ts; c.rake = 0.7 * k; c.lean = ts * (0.2 + 0.35 * k); c.weight = 0.35;
          x.coach.sheet = clamp(x.coach.sheet + (0.6 - x.coach.sheet) * x.dt * 2, 0, 1);
          c.sheet = x.coach.sheet; c.hike = x.coach.hikeFor(x.dt);
          if (absTwa(sim) > 145) x.coach.trick(c, 'duck');
          return c;
        },
        done: (sim, x) => !!sim.lastTrick && sim.lastTrick.kind === 'duck' && sim.lastTrick.t > (x.m.since ?? 0) && sim.state === S.SAILING && absTwa(sim) < 128,
      },
      {
        say: 'Power up again on a beam reach.',
        run: (x) => x.coach.sail(x.dt, { twa: 100, pump: true, straps: true, hook: false, hike: 'auto' }),
        done: (sim, x) => x.t > 3 && planing(sim) && kn(sim) > 16,
      },
      {
        say: 'Carving 360. At full speed, {LB} + {X} and sink the rail hard ({RS} toward the sail): the board carves right round, downwind and back up through the wind. Let the sail go as it streams out like a flag, and catch it again as you come round.',
        retryOnFall: 'Stalled in the turn! Go in faster and keep that rail down. Again.',
        run: (x) => {
          const sim = x.sim, m = x.m;
          if (m.since === undefined) m.since = sim.t;
          if (sim.state === S.TRICK) {
            const c = emptyControls();
            // (easing a touch coming out of it, so the new pull doesn't drag you forward)
            const out = smoothstep(290, 340, (sim.stateData.turned ?? 0) / DEG);
            c.rail = -sim.sailor.side; c.sheet = 0.6 - 0.15 * out; c.hike = x.coach.hikeFor(x.dt);
            x.coach.cur = undefined; x.coach.sheet = c.sheet;
            return c;
          }
          const c = x.coach.sail(x.dt, { twa: 100, straps: true, hook: false, hike: 'auto' });
          if (!(sim.lastTrick?.t > m.since) && planing(sim) && kn(sim) > 17) x.coach.trick(c, 'c360');
          return c;
        },
        done: (sim, x) => !!sim.lastTrick && sim.lastTrick.kind === 'c360' && sim.lastTrick.t > (x.m.since ?? 0) && x.t > 2,
      },
      {
        say: 'Power up again.',
        run: (x) => x.coach.sail(x.dt, { twa: 100, pump: true, straps: true, hook: false, hike: 'auto' }),
        done: (sim, x) => x.t > 3 && planing(sim) && kn(sim) > 15,
      },
      {
        say: 'Spock. Weight on your front foot ({RS} up) so the nose bites, then {LB} + {A}: the board spins a full turn on its nose, the rig held still above it. Sheet in and go.',
        retryOnFall: 'Fell in! Keep the weight on the nose through the spin. Again.',
        run: (x) => {
          const sim = x.sim, m = x.m;
          if (m.since === undefined) m.since = sim.t;
          if (sim.state === S.TRICK) {
            const c = emptyControls();
            c.weight = 0.8; c.sheet = 0.3;
            x.coach.cur = undefined; x.coach.sheet = 0.3;
            return c;
          }
          const c = x.coach.sail(x.dt, { twa: 100, straps: true, hook: false, hike: 'auto', weight: 0.8 });
          if (sim.sailor.straps === 2) c.weight = 0.8;
          if (!(sim.lastTrick?.t > m.since) && planing(sim) && kn(sim) > 14 && sim.sailor.leanX > 0.04) x.coach.trick(c, 'spock');
          return c;
        },
        done: (sim, x) => !!sim.lastTrick && sim.lastTrick.kind === 'spock' && sim.lastTrick.t > (x.m.since ?? 0) && x.t > 2,
      },
      {
        say: 'Helitack. Off the plane on a close reach, feet out of the straps, then {LB} + {B}: the rig goes right back and the board luffs up through the wind, then sails backwards while the sail spins round the mast, and you come out on the new tack without stepping round the front.',
        retryOnFall: 'In the water! Go in with a bit more speed and keep the rig moving round. Again.',
        run: (x) => {
          const sim = x.sim, m = x.m;
          if (m.since === undefined) m.since = sim.t;
          if (sim.state === S.TRICK) {
            const c = emptyControls();
            c.rake = -0.6; c.sheet = 0.9;
            x.coach.cur = undefined; x.coach.sheet = 0.25;
            return c;
          }
          if (sim.lastTrick?.t > m.since) return x.coach.sail(x.dt, { twa: 75, turnRate: 6, hook: false, hike: 'auto' });
          const c = x.coach.sail(x.dt, { twa: 72, turnRate: 12, hook: false, hike: 'auto' });
          if (sim.sailor.straps > 0) c.strapsHeld = true;
          if (sim.sailor.straps === 0 && absTwa(sim) < 78 && kn(sim) > 7) x.coach.trick(c, 'heli');
          return c;
        },
        done: (sim, x) => !!sim.lastTrick && sim.lastTrick.kind === 'heli' && sim.lastTrick.t > (x.m.since ?? 0) && sim.state === S.SAILING && sim.t - sim.lastTrick.t > 2,
      },
      {
        say: 'That\'s freestyle. Every move starts from {LB} held: {Y} duck gybe, {X} carving 360, {A} spock, {B} helitack. Let go of {LB} without a button and you pop instead.',
        run: (x) => x.coach.sail(x.dt, { twa: 100, hook: false, hike: 'auto' }),
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
    this.expectedFalls = []; // falls a step meant to show: {t, type}
    this.noFalls = sim.assists.noFalls;
    sim.wind.boost = 0;
    lesson.begin?.(sim, this);
    this.enterStep();
  }

  /** Set up the current step: its own start, and no "no falls" assist for a fall it shows or retries. */
  enterStep() {
    const st = this.current;
    this.sim.assists.noFalls = st?.expectFall || st?.retryOnFall ? false : this.noFalls;
    if (st?.watchOnly && this.mode !== 'watch') {
      // The coach takes over from you mid-run, from your trim.
      this.coach = new Coach(this.sim);
      this.coach.sheet = this.sim.lastControls?.sheet ?? this.coach.sheet;
    }
    st?.enter?.(this.sim, this);
  }

  get current() {
    return this.lesson.steps[this.step];
  }

  /** Back on the board, sailing off where you fell in (and a fresh coach, sheet eased). */
  resetToSailing() {
    this.sim.reset('sailing', this.sim.pos);
    this.sim.wind.boost = 0;
    this.coach = new Coach(this.sim);
  }

  /** Whether the coach has the controls: watching, or a step only the coach demonstrates. */
  get coachDriving() {
    return this.mode === 'watch' || (!this.done && !!this.current?.watchOnly);
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
    st.tick?.(this.ctx(dt));
    if (sim.state === S.FALLING || sim.state === S.WATER) {
      if (st.expectFall) {
        // The fall this step demonstrates.
        if (sim.state === S.FALLING && sim.stateTime <= dt * 1.5) this.expectedFalls.push({ t: sim.t, type: sim.sailor.fallType });
      } else if (!st.done(sim, this.ctx(dt)) && this.lesson.setup.start !== 'water') {
        // A step that starts in the water is fine; otherwise a fall stalls the lesson.
        this.fallTime += dt;
        if (this.mode === 'watch' && this.fallTime > 2.5) { this.failed = 'fell'; return 'fell'; }
        if (st.retryOnFall && this.fallTime > 2) {
          // Straight back on the board to have another go at this step.
          this.resetToSailing();
          sim.emit('lesson', st.retryOnFall, 2);
          this.t = 0;
          this.mem = {};
          this.fallTime = 0;
          return 'retry';
        }
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
      sim.wind.boost = 0;
      if (this.step >= this.lesson.steps.length) {
        this.done = true;
        sim.assists.noFalls = this.noFalls;
        return 'complete';
      }
      this.enterStep();
      return 'step';
    }
    if (this.mode === 'watch' && this.t > 45) { this.failed = 'timeout'; return 'fell'; }
    return null;
  }
}

export { MS_TO_KN };
