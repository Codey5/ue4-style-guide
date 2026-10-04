// Story mode: a summer at the spot, from your first day on a board to speed
// week on the sandbar. Each chapter sets the gear and the conditions (Kai, who
// runs the school, picks them) and asks for a handful of things to do. They're
// spotted the way the game sees everything else: the sailor's state, the
// events the physics reports and the GPS. Progress is kept in this browser.
import { DEG, MS_TO_KN } from '../physics/math.js';
import { S } from '../physics/states.js';
import { adviseSail, SAILS, windRange } from '../physics/quiver.js';
import { GpsLogger } from './gps.js';

const KEY = 'beam-reach-story-v1';

/** Marks on the water (world x, z in metres; the wind blows toward +x, the beach is to the north). */
export const MARKS = {
  school: { at: [0, 0], name: 'the school buoy' },
  orange: { at: [0, 85], name: 'the orange buoy' },
  upwind: { at: [-70, 15], name: 'the upwind buoy' },
};

const ON_THE_BOARD = [S.UPHAUL, S.SECURE, S.SAILING, S.TACK, S.FLIP, S.TRICK];
const UP = [S.SECURE, S.SAILING, S.TACK, S.FLIP, S.TRICK];
const absTwa = (sim) => Math.abs(sim.twa) / DEG;
const planing = (sim) => sim.state === S.SAILING && !!sim.telemetry && sim.telemetry.planing > 0.95 && sim.telemetry.speed > 5.5;
const sailing = (sim) => sim.state === S.SAILING;
const trick = (kind, text, hint) => ({ id: kind, text, hint, lesson: 'freestyle', kind: 'event', type: 'trickdone', test: (e, sim) => sim.lastTrick?.kind === kind });

export const CHAPTERS = [
  {
    id: 'first-day',
    title: 'Day one',
    intro: "You've come to the spot for the summer, and you've never stood on a windsurf board. Kai, who runs the school on the beach, has rigged you the biggest, steadiest board there is and a little 4.2 m² sail. The wind is barely there: perfect for a first go.",
    outro: "You're sailing! Kai waves from the beach. Tomorrow: getting back again.",
    gear: { boardId: 'begin210', sailArea: 4.2 },
    wind: { speedKn: 7, gustiness: 0.05, shifts: 0.05, chop: 0.3 },
    start: 'water',
    goals: [
      { id: 'climb', text: 'Climb onto the board', hint: "You're in the water beside the board, with the rig lying downwind. Press {A} to climb on.", lesson: 'uphaul', kind: 'state', states: ON_THE_BOARD },
      { id: 'uphaul', text: 'Pull the rig out of the water', hint: 'Hold {LB} to pull up the uphaul rope, hand over hand, with your legs, not your back, until the rig is up.', lesson: 'uphaul', kind: 'state', states: UP },
      { id: 'go', text: 'Sheet in and get moving', hint: 'Turn the board across the wind with {LS} (rig toward the nose or the tail), then squeeze {RT} gently with the rig tilted a little forward ({LS} up). Pull in hard with the rig upright and the board turns into the wind: push the rig forward to turn it back.', lesson: 'uphaul', kind: 'distance', m: 20 },
      { id: 'sail100', text: 'Sail 100 m without falling in', hint: 'Keep the sail trimmed: ease {RT} if it pulls too hard, squeeze it if the front edge of the sail flutters.', lesson: 'uphaul', kind: 'distance', m: 100, noFall: true },
    ],
  },
  {
    id: 'there-and-back',
    title: 'There and back',
    intro: 'Sailing away is the easy part. Today you learn to steer with the rig and to turn round, so you can come back to where you started. A little more wind, and Kai has given you a 5.3 m² sail.',
    outro: 'Out and back under your own steam. Tomorrow, a bigger sail and a little more wind.',
    gear: { boardId: 'begin210', sailArea: 5.3 },
    wind: { speedKn: 9, gustiness: 0.1, shifts: 0.1, chop: 0.4 },
    start: 'secure',
    marks: ['school', 'orange'],
    goals: [
      { id: 'bearaway', text: 'Bear away: turn away from the wind', hint: 'Rake the rig toward the nose ({LS} up) and ease the sheet a little: the nose turns away from the wind.', lesson: 'steering', kind: 'hold', sec: 2, test: (sim) => sailing(sim) && absTwa(sim) > 120 },
      { id: 'headup', text: 'Head up toward the wind', hint: 'Rake the rig toward the tail ({LS} down) and sheet in: the nose turns up toward the wind.', lesson: 'steering', kind: 'hold', sec: 2, test: (sim) => sailing(sim) && absTwa(sim) < 65 },
      { id: 'tack', text: 'Turn round: tack', hint: 'Head right up, then press {B} as the nose nears the wind and step round the front of the mast. Bear away on the new side.', lesson: 'tack', kind: 'event', type: 'tackdone' },
      { id: 'outback', text: 'Sail out to the orange buoy and back to the school buoy', hint: 'Out on a beam reach, tack, and back. Aim a little upwind of the buoy: the board slips sideways as it sails.', lesson: 'steering', kind: 'visit', points: ['orange', 'school'] },
    ],
  },
  {
    id: 'upwind',
    title: 'Upwind',
    intro: "The wind pushes everything downwind, and nobody can sail straight into it. You zig-zag: close-hauled on one tack, tack, close-hauled on the other. Kai's rule: never sail further downwind than you can sail back. 11 knots and a 5.8 m² sail today.",
    outro: 'Upwind and back. You can go wherever you like on the water now.',
    gear: { boardId: 'begin210', sailArea: 5.8 },
    wind: { speedKn: 11, gustiness: 0.12, shifts: 0.15, chop: 0.5 },
    start: 'secure',
    marks: ['school', 'upwind'],
    goals: [
      { id: 'close', text: 'Sail close-hauled for 15 seconds', hint: "Head up until you're about 50° off the wind: rig back, sheet in hard. Any closer and the sail starts to flap.", lesson: 'tack', kind: 'hold', sec: 15, total: true, test: (sim) => sailing(sim) && absTwa(sim) < 60 },
      { id: 'upbuoy', text: 'Reach the upwind buoy', hint: 'Zig-zag toward it: close-hauled, tack ({B}), close-hauled on the other side.', lesson: 'tack', kind: 'visit', points: ['upwind'] },
      { id: 'gybe', text: 'Gybe: turn round downwind', hint: 'Bear away until the wind is right behind you, then press {Y}: let go with the back hand and the sail swings round the front of the mast.', lesson: 'gybe', kind: 'event', types: ['flipdone', 'switch'] },
      { id: 'home', text: 'Back downwind to the school buoy', hint: 'Sail back down to the school buoy. Downwind is easy: just don\'t overshoot.', lesson: 'steering', kind: 'visit', points: ['school'] },
    ],
  },
  {
    id: 'breeze',
    title: 'A proper breeze',
    intro: 'A proper breeze at last: 14 knots and gusty. Kai swaps you onto the Freeride 155, shorter and livelier than the school board but still wide and stable, with a sail rigged for your weight. The rig pulls hard now: you hold it with your weight, hanging out against it.',
    outro: 'Your first taste of planing. Tomorrow: more wind, the harness and the footstraps.',
    gear: { boardId: 'free155', toPlane: true },
    wind: { speedKn: 14, gustiness: 0.3, shifts: 0.2, chop: 0.6 },
    start: 'secure',
    goals: [
      { id: 'hike', text: 'Lean right out against the pull for 5 seconds', hint: 'Hold {LT} to hang your weight out over the water: the harder the sail pulls, the further you lean.', lesson: 'foreaft', kind: 'hold', sec: 5, test: (sim) => sailing(sim) && sim.sailor.beta > 20 * DEG },
      { id: 'gusts', text: 'Sail 300 m through the gusts without falling in', hint: 'Gusts show as dark patches on the water. As one hits, ease the sheet a touch and lean back; sheet in as it passes.', lesson: 'catapult', kind: 'distance', m: 300, noFall: true },
      { id: 'plane', text: 'Get planing', hint: 'Beam reach, sheet in, weight forward ({RS} up) and pump ({RB}) through the hump. The board lifts and the drag drops away.', lesson: 'planing', kind: 'hold', sec: 3, test: planing },
      { id: 'kn10', text: 'Hit 10 knots', hint: 'Planing, keep the sail sheeted in and the board flat. Bear away a touch in the lulls.', lesson: 'planing', kind: 'gps', key: 's2', kn: 10 },
    ],
  },
  {
    id: 'footstraps',
    title: 'Harness and straps',
    intro: '16 knots, and Kai rigs you a bigger sail. Planing, the rig pulls too hard to hold on your arms for long: hook into the harness and let your weight hold it. And the footstraps keep your feet on the board as it flies.',
    outro: "Planing hooked in and in the straps. You won't want to go back to the big board.",
    gear: { boardId: 'free155', sailArea: 'advise' },
    wind: { speedKn: 16, gustiness: 0.15, shifts: 0.15, chop: 0.6 },
    start: 'secure',
    goals: [
      { id: 'harness', text: 'Sail 15 seconds hooked into the harness', hint: 'Planing on a beam reach, sheet in and come in toward the boom (ease {LT}), then press {A} to hook into the lines. Hang your weight off them.', lesson: 'planing', kind: 'hold', sec: 15, total: true, test: (sim) => sailing(sim) && sim.sailor.hooked },
      { id: 'strap', text: 'Front foot in the strap while planing', hint: 'Planing, move back ({RS} down) and press {X} to step into the front strap.', lesson: 'planing', kind: 'hold', sec: 2, test: (sim) => planing(sim) && sim.sailor.straps >= 1 },
      { id: 'straps', text: 'Both feet in the straps', hint: 'Planing and hooked in, step into the front strap, then the back one ({X} twice).', lesson: 'planing', kind: 'hold', sec: 2, test: (sim) => planing(sim) && sim.sailor.straps === 2 },
      { id: 'plane20', text: 'Plane for 20 seconds without dropping off', hint: 'Hooked in ({A}), feet in the straps ({X}), sail sheeted in. Bear away a touch in the lulls to keep going.', lesson: 'planing', kind: 'hold', sec: 20, grace: 0.8, test: planing },
    ],
  },
  {
    id: 'hooked-in',
    title: 'Hooked in',
    intro: 'The Freeride 135 in 17 knots: hooked in, both feet in the straps, the board flying. Then the turn every windsurfer works at for years: the carve gybe.',
    outro: 'Your first carve gybes. Kai says a smaller board will make them easier, not harder.',
    gear: { boardId: 'free135', sailArea: 'advise', smaller: 1 },
    wind: { speedKn: 17, gustiness: 0.25, shifts: 0.2, chop: 0.8 },
    start: 'sailing',
    goals: [
      { id: 'cruise', text: 'Plane 30 seconds hooked in and in the straps', hint: 'Hang off the harness lines ({LT}) and let your weight hold the pull. Sheet out a touch when a gust hits.', lesson: 'planing', kind: 'hold', sec: 30, total: true, test: (sim) => planing(sim) && sim.sailor.hooked && sim.sailor.straps === 2 },
      { id: 'kn18', text: 'Hit 18 knots', hint: 'Bear away to a broad reach, about 120° off the wind, and sit back on the tail ({RS} down).', lesson: 'foreaft', kind: 'gps', key: 's2', kn: 18 },
      { id: 'upplane', text: 'Plane upwind for 10 seconds', hint: 'Planing, head up to a close reach (rig back, {LS} down) and press on your heels ({RS} away from the sail). Bear away a touch if the board slows.', lesson: 'foreaft', kind: 'hold', sec: 10, total: true, test: (sim) => planing(sim) && absTwa(sim) < 70 },
      { id: 'carve', text: 'Carve gybe: turn downwind at speed', hint: 'Unhook ({A}), feet out of the straps (hold {X}), carve on the inside rail ({RS} toward the sail) and flip the sail ({Y}) at dead downwind.', lesson: 'gybe', kind: 'gybe', minKn: 8 },
    ],
  },
  {
    id: 'small-board',
    title: 'Small board',
    intro: "The Freeride 115 sinks if you stand still on it, so there's no uphauling: you start in the water and let the sail lift you out. A waterstart.",
    outro: 'Waterstarts, planing gybes and 20 knots. Time for the chop out by the sandbar.',
    gear: { boardId: 'free115', sailArea: 'advise', smaller: 1 },
    wind: { speedKn: 18, gustiness: 0.25, shifts: 0.2, chop: 0.9 },
    start: 'water',
    goals: [
      { id: 'ws', text: 'Waterstart', hint: 'Hold {LB} to lift the rig out of the water, steer the board across the wind with {LS}, then sheet in ({RT}): the sail lifts you onto the board.', lesson: 'waterstart', kind: 'enter', from: S.RISING, to: S.SAILING },
      { id: 'plane30', text: 'Plane 30 seconds without stopping', hint: 'Hooked in, both feet in the straps, sail sheeted in.', lesson: 'planing', kind: 'hold', sec: 30, grace: 0.8, test: planing },
      { id: 'kn20', text: 'Hit 20 knots', hint: 'A broad reach, weight back on the tail, sheeted in hard.', lesson: 'foreaft', kind: 'gps', key: 's2', kn: 20 },
      { id: 'planegybe', text: 'Carve gybe and plane out of it', hint: 'Keep your speed through the turn: carve on the rail, flip the sail early, and sheet in as soon as you have the boom.', lesson: 'gybe', kind: 'gybe', minKn: 10, planeAfter: 4 },
    ],
  },
  {
    id: 'chop',
    title: 'Chop hop',
    intro: 'The wind is up and the chop is short and steep: every wave is a ramp. Keep the nose up through it, and when a good one comes, pop.',
    outro: 'Air! Kai has a challenge for the flat day tomorrow.',
    gear: { boardId: 'free115', sailArea: 'advise' },
    wind: { speedKn: 20, gustiness: 0.2, shifts: 0.15, chop: 1.5 },
    start: 'sailing',
    goals: [
      { id: 'chop60', text: 'Plane 60 seconds through the chop without falling in', hint: 'Weight back ({RS} down) keeps the nose up over the waves; a touch less sheet keeps it under control.', lesson: 'chop', kind: 'hold', sec: 60, total: true, noFall: true, test: planing },
      { id: 'jump', text: 'Pop a jump: 30 cm', hint: 'Hooked in and in the straps, hold {LB} to crouch as a steep chop comes and let go as the tail starts up it.', lesson: 'jump', kind: 'jump', m: 0.3 },
      { id: 'jump50', text: 'Get half a metre of air', hint: 'Time the pop: let go of {LB} just as the tail starts up the steepest face you can find.', lesson: 'jump', kind: 'jump', m: 0.5 },
      { id: 'land3', text: 'Land three jumps cleanly', hint: 'Weight back in the air ({RS} down) and stay sheeted in: land tail first or flat.', lesson: 'jump', kind: 'jump', m: 0.2, n: 3, clean: true },
    ],
  },
  {
    id: 'freestyle',
    title: 'Freestyle',
    intro: 'A flat-water day for tricks. Every move starts from a crouch (hold {LB}), and each goes wrong in its own way. Kai shows you four.',
    outro: 'Duck gybe, carving 360, spock and helitack. One week of the summer left: speed week.',
    gear: { boardId: 'free115', forMass: 6.0 },
    wind: { speedKn: 18, gustiness: 0.05, shifts: 0.05, chop: 0.5 },
    start: 'sailing',
    goals: [
      trick('duck', 'Duck gybe', 'Carving downwind on the plane, unhooked: {LB} + {Y} throws the rig over your head. Catch the boom on the new side and keep carving.'),
      trick('c360', 'Carving 360', 'Flat out on a reach, unhooked: {LB} + {X}, and sink the rail toward the sail ({RS}). Let the sail flag out, catch it as you come round.'),
      trick('spock', 'Spock', 'Planing, unhooked, weight forward ({RS} up): {LB} + {A} spins the board on its nose. Keep the weight forward until you are round.'),
      trick('heli', 'Helitack', 'Close reach, feet out of the straps and unhooked: {LB} + {B}. The board luffs through the wind and the sail spins round the mast.'),
    ],
  },
  {
    id: 'speed-week',
    title: 'Speed week',
    intro: "Speed week on the sandbar: 24 knots, the strip in its lee as flat as a lake, and everyone's GPS on their arm. Kai has put you on the Freemove 95. You start at the top of the strip.",
    outro: "That's your summer: from climbing onto a board to flying down the strip. Free sailing is all yours now, and your records are in the Speed tab.",
    gear: { boardId: 'move95', sailArea: 'advise' },
    wind: { speedKn: 24, gustiness: 0.2, shifts: 0.15, chop: 1.2 },
    start: 'strip',
    goals: [
      { id: 'kn25', text: 'Hit 25 knots', hint: 'Along the strip on a broad reach: hooked in, both feet in the straps, weight back, sheeted in hard. Stay close to the bar, where the water is flattest.', lesson: 'foreaft', kind: 'gps', key: 's2', kn: 25 },
      { id: 'm500', text: '500 m over 22 knots', hint: 'Hold your speed down the whole course, between the orange flags.', lesson: 'foreaft', kind: 'gps', key: 'm500', kn: 22 },
      { id: 'five10', text: '5 × 10 s over 22 knots', hint: 'Five 10-second runs averaging over 22 knots: hold your top speed all the way down the strip, then sail back up and do it again.', lesson: 'foreaft', kind: 'gps', key: 'five10', kn: 22 },
      { id: 'kn27', text: 'Hit 27 knots', hint: 'The fastest water is right in the lee of the bar. Bear away a little in the gusts and sit right back.', lesson: 'foreaft', kind: 'gps', key: 's2', kn: 27 },
    ],
  },
];

export const findChapter = (id) => CHAPTERS.find((c) => c.id === id);

/** The gear and conditions for a chapter: Kai rigs the sail for your weight once you're off the beginner board. */
export function chapterSetup(ch, mass) {
  let sailArea = ch.gear.sailArea;
  if (ch.gear.toPlane) {
    // (the smallest sail that will get you planing in this wind, at your weight)
    const ok = SAILS.find((x) => windRange(ch.gear.boardId, x.area, mass).plane <= ch.wind.speedKn - 1);
    sailArea = (ok ?? SAILS[SAILS.length - 1]).area;
  } else if (ch.gear.byWeight) {
    // (a size for each weight band: [up to kg, m²]…)
    sailArea = ch.gear.byWeight.find(([kg]) => mass <= kg)[1];
  } else if (ch.gear.forMass) {
    // (a manageable sail, scaled to your weight: about this size for 75 kg)
    const want = ch.gear.forMass * Math.sqrt(mass / 75);
    sailArea = SAILS.reduce((a, b) => (Math.abs(b.area - want) < Math.abs(a.area - want) ? b : a)).area;
  } else if (sailArea === 'advise') {
    // (a size smaller for gybing and tricks: easier to throw around)
    const i = SAILS.indexOf(adviseSail(ch.gear.boardId, mass, ch.wind.speedKn).sail);
    sailArea = SAILS[Math.max(0, i - (ch.gear.smaller ?? 0))].area;
  }
  return { boardId: ch.gear.boardId, sailArea, wind: { ...ch.wind }, start: ch.start === 'strip' ? 'sailing' : ch.start, tune: {} };
}

// ---------------------------------------------------------------------------
// Goals. Each tracker sees every physics step and reports progress 0..1 and
// a short label ("64 / 100 m").

class Tracker {
  constructor(g) { this.g = g; this.p = 0; this.label = ''; }
}

/** Being in one of these states (climbing on, the rig up…). */
class StateGoal extends Tracker {
  step({ sim }) { if (this.g.states.includes(sim.state)) this.p = 1; }
}

/** Metres sailed (since the last fall, with noFall). */
class DistanceGoal extends Tracker {
  constructor(g) { super(g); this.d = 0; this.last = null; }
  step({ sim, fell }) {
    if (fell && this.g.noFall) this.d = 0;
    const at = [sim.pos[0], sim.pos[2]];
    if (sim.state === S.SAILING && this.last) {
      const step = Math.hypot(at[0] - this.last[0], at[1] - this.last[1]);
      if (step < 5) this.d += step; // (not across a restart)
    }
    this.last = at;
    this.p = Math.min(1, this.d / this.g.m);
    this.label = `${Math.floor(this.d)} / ${this.g.m} m`;
  }
}

/**
 * Seconds a condition holds: in one go (riding out dips shorter than
 * `grace`), or in total with `total`. A fall starts it again with noFall.
 */
class HoldGoal extends Tracker {
  constructor(g) { super(g); this.t = 0; this.off = 0; }
  step({ sim, dt, fell }) {
    if (fell && (this.g.noFall || !this.g.total)) this.t = 0;
    if (this.g.test(sim)) { this.t += dt; this.off = 0; }
    else if (!this.g.total) {
      this.off += dt;
      if (this.off > (this.g.grace ?? 0.25)) this.t = 0;
    }
    this.p = Math.min(1, this.t / this.g.sec);
    this.label = this.g.sec >= 5 ? `${Math.floor(this.t)} / ${this.g.sec} s` : '';
  }
}

/** Events the physics reports (a tack done, a trick landed…), n of them. */
class EventGoal extends Tracker {
  constructor(g) { super(g); this.n = 0; this.types = g.types ?? [g.type]; }
  step({ sim, events, fell }) {
    if (fell && this.g.noFall) this.n = 0;
    for (const e of events) if (this.types.includes(e.type) && (!this.g.test || this.g.test(e, sim))) this.n++;
    const need = this.g.n ?? 1;
    this.p = Math.min(1, this.n / need);
    this.label = need > 1 ? `${this.n} / ${need}` : '';
  }
}

/** Going from one state straight into another (a waterstart: rising, then sailing). */
class EnterGoal extends Tracker {
  constructor(g) { super(g); this.prev = null; }
  step({ sim }) {
    if (this.prev === this.g.from && sim.state === this.g.to) this.p = 1;
    this.prev = sim.state;
  }
}

/** Your best GPS speed in a category. */
class GpsGoal extends Tracker {
  constructor(g) { super(g); this.v = 0; this.next = 0; }
  step({ sim, gps }) {
    // (the five best 10-second runs take some sorting out: twice a second)
    if (this.g.key === 'five10') {
      if (sim.t >= this.next) { this.next = sim.t + 0.5; const f = gps.five10(); this.v = f.n === 5 ? f.v : 0; }
    } else this.v = gps.best[this.g.key] ?? 0;
    const v = this.v * MS_TO_KN;
    this.p = Math.min(1, v / this.g.kn);
    this.label = `${v.toFixed(1)} / ${this.g.kn} kn`;
  }
}

/** Marks to reach in order (within `r` metres), sailing. */
class VisitGoal extends Tracker {
  constructor(g) { super(g); this.i = 0; this.r = g.r ?? 15; }
  get target() { return this.i < this.g.points.length ? MARKS[this.g.points[this.i]] : null; }
  step({ sim }) {
    const m = this.target;
    if (m && UP.includes(sim.state) && Math.hypot(sim.pos[0] - m.at[0], sim.pos[2] - m.at[1]) < this.r) this.i++;
    this.p = this.i / this.g.points.length;
    const t = this.target;
    this.label = t ? `${Math.round(Math.hypot(sim.pos[0] - t.at[0], sim.pos[2] - t.at[1]))} m to ${t.name}` : '';
  }
}

/** Popped jumps at least `m` high (n of them; clean: landed without falling in). */
class JumpGoal extends Tracker {
  constructor(g) { super(g); this.n = 0; this.seen = null; this.pending = null; }
  step({ sim, fell }) {
    const j = sim.jump;
    if (j && j !== this.seen) {
      this.seen = j;
      if (j.popped && j.height >= this.g.m && (!this.g.clean || j.how !== 'nose first!')) {
        if (this.g.clean) this.pending = j; else this.n++;
      }
    }
    // (a clean landing: still sailing a second later)
    if (this.pending) {
      if (fell) this.pending = null;
      else if (sim.t - this.pending.t > 1) { this.n++; this.pending = null; }
    }
    const need = this.g.n ?? 1;
    this.p = Math.min(1, this.n / need);
    this.label = need > 1 ? `${this.n} / ${need}` : sim.bestJump ? `best ${sim.bestJump.height.toFixed(2)} m` : '';
  }
}

/**
 * A carve gybe: the sail flipped with the board going at least minKn, then
 * sailing on without a fall (and planing again within planeAfter seconds).
 */
class GybeGoal extends Tracker {
  constructor(g) { super(g); this.armed = false; this.out = null; this.prev = null; }
  step({ sim, fell }) {
    const kn = Math.hypot(sim.vel[0], sim.vel[2]) * MS_TO_KN;
    if (sim.state === S.FLIP && this.prev !== S.FLIP) this.armed = kn >= this.g.minKn;
    if (this.prev === S.FLIP && sim.state === S.SAILING && this.armed) this.out = sim.t;
    if (sim.state !== S.FLIP && this.prev !== S.FLIP && sim.state !== S.SAILING) this.armed = false;
    this.prev = sim.state;
    if (fell) { this.armed = false; this.out = null; }
    if (this.out !== null) {
      const since = sim.t - this.out;
      if (this.g.planeAfter ? planing(sim) && since < this.g.planeAfter : since > 1.5) this.p = 1;
      else if (this.g.planeAfter && since >= this.g.planeAfter) this.out = null;
    }
  }
}

const KINDS = { state: StateGoal, distance: DistanceGoal, hold: HoldGoal, event: EventGoal, enter: EnterGoal, gps: GpsGoal, visit: VisitGoal, jump: JumpGoal, gybe: GybeGoal };

// ---------------------------------------------------------------------------

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * The chapters you've finished (kept in this browser). A chapter's goals are
 * done in order, in one go: a restart starts it afresh.
 */
export class Career {
  constructor(store = storage()) {
    this.store = store;
    this.data = this.load();
  }

  load() {
    try {
      const raw = this.store?.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { finished: Array.isArray(d.finished) ? d.finished : [], started: !!d.started || !!Object.keys(d.goals ?? {}).length };
      }
    } catch { /* unreadable: start afresh */ }
    return { finished: [], started: false };
  }

  save() {
    try { this.store?.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  finished(chId) { return this.data.finished.includes(chId); }
  unlocked(i) { return i === 0 || this.finished(CHAPTERS[i - 1].id); }
  get started() { return this.data.started; }
  markStarted() {
    if (this.data.started) return;
    this.data.started = true;
    this.save();
  }
  /** The chapter to play next: the first one not finished (the last one once all are). */
  get next() {
    const i = CHAPTERS.findIndex((c) => !this.finished(c.id));
    return i < 0 ? CHAPTERS.length - 1 : i;
  }

  /** A chapter's goals all done; true the first time. */
  finish(chId) {
    if (this.finished(chId)) return false;
    this.data.finished.push(chId);
    this.save();
    return true;
  }

  reset() {
    this.data = { finished: [], started: false };
    this.save();
  }
}

/** A chapter being sailed: its goals, one after another. */
export class ChapterRun {
  constructor(chapter, career, sim) {
    this.chapter = chapter;
    this.career = career;
    this.sim = sim;
    this.gps = new GpsLogger();
    this.goals = chapter.goals.map((g) => ({ goal: g, tracker: new KINDS[g.kind](g), done: false }));
    this.seen = new WeakSet(sim.events);
    this.lastState = sim.state;
    this.finished = false; // finished for the first time in this run
    this.fresh = 0; // goals done in this run
    career.markStarted?.();
  }

  /**
   * After each physics step: the goals completed by it. Only the goal
   * you're on counts (the next one starts once it's done, from the same
   * moment, so a jump that's high enough for both counts for both).
   */
  step(dt) {
    const sim = this.sim;
    this.gps.step(sim);
    const events = sim.events.filter((e) => !this.seen.has(e));
    for (const e of events) this.seen.add(e);
    const fell = sim.state === S.FALLING && this.lastState !== S.FALLING;
    this.lastState = sim.state;
    const ctx = { sim, dt, events, fell, gps: this.gps };
    const done = [];
    for (let g = this.current; g; g = this.current) {
      g.tracker.step(ctx);
      if (g.tracker.p < 1) break;
      g.done = true;
      this.fresh++;
      done.push(g.goal);
      // (the events that did one goal don't do the next)
      ctx.events = [];
    }
    if (done.length && this.complete && this.career.finish(this.chapter.id)) this.finished = true;
    return done;
  }

  get complete() { return this.goals.every((g) => g.done); }
  /** The goal to work on: the first not done. */
  get current() { return this.goals.find((g) => !g.done) ?? null; }
  /** The mark to head for, if the goal you're on wants one. */
  get target() { return this.current?.tracker.target ?? null; }
}
