// Scripted maneuver checks: uphaul, tack, waterstart, overpowering, sinkers.
// The carve gybe and the other techniques are checked through the lessons.
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

// 3. The carve gybe is covered by the coach's lesson (tools/lesson-check.mjs).

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
