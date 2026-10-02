// Scripted maneuver checks: uphaul, tack, carve gybe with sail flip, waterstart.
// Run: node tools/maneuver-check.mjs
import { DEG, MS_TO_KN, clamp } from '../src/physics/math.js';
import { Sim, S, emptyControls } from '../src/physics/sim.js';
import { Autopilot } from './autopilot.mjs';

const DT = 1 / 240;
const run = (sim, seconds, fn) => {
  for (let i = 0; i < seconds / DT; i++) {
    const c = fn(sim) ?? emptyControls();
    sim.step(DT, c);
  }
};
let failures = 0;
const report = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const lastEvents = (sim, n = 6) => sim.events.slice(-n).map((e) => `[${e.t.toFixed(1)}] ${e.text}`).join(' | ');

// 1. Uphaul on the beginner board in light wind.
{
  const sim = new Sim({ boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 8, gustiness: 0, shifts: 0 }, start: 'water' });
  let pressed = false;
  run(sim, 8, (s) => {
    const c = emptyControls();
    if (s.state === S.WATER && !pressed) { c.pressed.climb = true; pressed = true; }
    if (s.state === S.UPHAUL) c.uphaul = true;
    return c;
  });
  report('uphaul to secure position', sim.state === S.SECURE, lastEvents(sim, 3));
}

// 2. Tack on the beginner board: sail close-hauled, head up, step round.
{
  const sim = new Sim({ boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 9, gustiness: 0, shifts: 0 }, start: 'secure' });
  const ap = new Autopilot(sim, 60, { straps: false });
  run(sim, 15, () => ap.controls(DT));
  const side0 = sim.sailor.side;
  let tacked = false;
  run(sim, 12, (s) => {
    if (s.state === S.SAILING && s.sailor.side === side0) {
      const c = ap.controls(DT);
      c.rake = -1; // rig back: head up into the wind
      c.sheet = 1; // stay sheeted in so the sail drives the turn
      if (Math.abs(s.twa) < 35 * DEG && !tacked) { c.pressed.tack = true; tacked = true; }
      return c;
    }
    if (s.state === S.TACK) { const c = emptyControls(); c.sheet = 0.5; return c; }
    if (s.sailor.side !== side0) { ap.sheet = 0.5; return ap.controls(DT); }
    return emptyControls();
  });
  report('tack (step round the mast)', sim.sailor.side === -side0 && sim.state === S.SAILING, `side ${side0}->${sim.sailor.side} state ${sim.state} twa ${(sim.twa / DEG).toFixed(0)} | ${lastEvents(sim, 4)}`);
}

// 3. Carve gybe on the plane: bear away with rail and rig, flip at dead downwind.
{
  const sim = new Sim({ boardId: 'free135', sailArea: 7, wind: { speedKn: 17, gustiness: 0, shifts: 0 }, start: 'sailing', assists: { autoHike: true } });
  const ap = new Autopilot(sim, 110);
  run(sim, 25, () => ap.controls(DT));
  const kn0 = sim.telemetry.kn;
  const side0 = sim.sailor.side;
  // Ease the sheet gradually, unhook and take the feet out of the straps.
  const sheet0 = ap.sheet;
  let tEase = 0;
  run(sim, 1.5, () => { tEase += DT; const c = ap.controls(DT); c.sheet = sheet0 - Math.min(1, tEase / 1.5) * 0.2; return c; });
  let unhooked = false;
  run(sim, 0.6, (s) => { const c = ap.controls(DT); c.sheet = sheet0 - 0.2; if (s.sailor.hooked && !unhooked) { c.pressed.hook = true; unhooked = true; } c.strapsHeld = true; return c; });
  let flipped = false, minKn = 99, maxTwa = 0;
  run(sim, 7, (s) => {
    if (s.state === S.SAILING && s.sailor.side === side0) {
      const c = emptyControls();
      c.sheet = 0.75;
      c.rake = 1;
      c.lean = side0 * 0.6;
      c.rail = -side0 * 1; // sink the leeward rail: toes
      c.weight = 0.3;
      maxTwa = Math.max(maxTwa, Math.abs(s.twa));
      if (Math.abs(s.twa) > 168 * DEG && !flipped) { c.pressed.flip = true; flipped = true; }
      minKn = Math.min(minKn, s.telemetry.kn);
      return c;
    }
    if (s.state === S.FLIP) { const c = emptyControls(); c.rail = -side0 * 0.8; c.sheet = 0; c.rake = 0.3; return c; }
    if (s.state === S.SAILING) {
      // Carve out of the gybe on the new tack.
      const c = emptyControls(); c.sheet = 0.7; c.rail = side0 * 0.3; c.rake = -0.2; c.lean = -side0 * 0.3;
      minKn = Math.min(minKn, s.telemetry.kn);
      return c;
    }
    return emptyControls();
  });
  report('carve gybe with sail flip', flipped && sim.sailor.side === -side0 && sim.state === S.SAILING,
    `entry ${kn0.toFixed(1)} kn, min ${minKn.toFixed(1)} kn, exit ${sim.telemetry.kn.toFixed(1)} kn, twa ${(sim.twa / DEG).toFixed(0)} state ${sim.state} | ${lastEvents(sim, 5)}`);
}

// 4. Waterstart in 16 kn.
{
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, wind: { speedKn: 16, gustiness: 0, shifts: 0 }, start: 'water', assists: { autoHike: true } });
  let maxLift = 0, rose = false;
  run(sim, 9, (s) => {
    const c = emptyControls();
    c.uphaul = true;
    if (s.state === S.WATERSTART && s.stateData.phase === 'power') {
      c.sheet = clamp(s.stateTime / 2, 0, 0.55);
      // Steer the board across the wind with the rig: forward bears away, back heads up.
      const side = s.sailor.side;
      c.rake = clamp(-side * (2 * (s.twa - side * 95 * DEG) + 0.8 * s.yawRate), -1, 1);
      maxLift = Math.max(maxLift, s.stateData.lift ?? 0);
    }
    if (s.state === S.RISING) rose = true;
    if (s.state === S.SAILING) { c.uphaul = false; c.sheet = 0.5; }
    return c;
  });
  report('waterstart', rose && sim.state === S.SAILING, `max lift ${maxLift.toFixed(0)} N, state ${sim.state} | ${lastEvents(sim, 4)}`);
}

// 5. Waterstart should fail in light wind.
{
  const sim = new Sim({ boardId: 'free135', sailArea: 7, wind: { speedKn: 6, gustiness: 0, shifts: 0 }, start: 'water' });
  run(sim, 10, (s) => { const c = emptyControls(); c.uphaul = true; c.sheet = 0.9; return c; });
  report('no waterstart in 6 kn', sim.state !== S.SAILING && sim.state !== S.RISING, `state ${sim.state} | ${lastEvents(sim, 2)}`);
}

// 6. Overpowered: sheeting in hard without hiking pulls you over.
{
  const sim = new Sim({ boardId: 'free135', sailArea: 7.8, wind: { speedKn: 22, gustiness: 0, shifts: 0 }, start: 'sailing' });
  run(sim, 4, () => { const c = emptyControls(); c.sheet = 1; c.hike = 0; return c; });
  report('overpowered without hiking -> pulled over / sail ripped out', sim.events.some((e) => e.type === 'fall' || e.type === 'grip'), lastEvents(sim, 3));
}

// 7. Sinker: a 95 L board can't be uphauled by an 85 kg sailor.
{
  const sim = new Sim({ boardId: 'move95', sailArea: 5.3, sailorMass: 85, wind: { speedKn: 10, gustiness: 0, shifts: 0 }, start: 'water' });
  run(sim, 2, (s) => { const c = emptyControls(); c.pressed.climb = s.t < 0.1; return c; });
  report('sinker refuses climb-on', sim.state === S.WATER && sim.events.some((e) => e.type === 'sinker'), lastEvents(sim, 1));
}
void MS_TO_KN;
if (failures) { console.log(`${failures} maneuver check(s) failed`); process.exit(1); }
