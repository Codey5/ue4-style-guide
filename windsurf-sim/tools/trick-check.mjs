// Freestyle and the living sail, checked headlessly: each move from its entry
// conditions (and the ways each goes wrong), and the battens (they stay put
// in steady sailing and pop through to the new side after a turn).
// Run: node tools/trick-check.mjs
import { Sim, S, emptyControls } from '../src/physics/sim.js';
import { Coach } from '../src/coach/coach.js';
import { DEG } from '../src/physics/math.js';
import { Autopilot } from './autopilot.mjs';

const DT = 1 / 240;
let failures = 0;
const report = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const BUTTON = { duck: 'flip', heli: 'tack', c360: 'straps', spock: 'hook' };

/**
 * Get going with the coach, set up for the move, then do it.
 * o: hooked (set up hooked in), duckAt (|twa| to duck at), spinWeight
 * (front foot during a spock), slow (try it off the plane).
 */
function attempt(kind, o = {}) {
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, sailorMass: 75, wind: { speedKn: 18, gustiness: 0, shifts: 0, chop: 0.6 }, start: 'sailing', assists: { autoHike: false } });
  const coach = new Coach(sim);
  let phase = 'setup', t0 = 0, pressed = false, turnSide = 0, side0 = 0, kIn = 0, started = false, done = null, fall = null;
  const hints = [];
  let seen = 0;
  for (let i = 0; i < 70 / DT; i++) {
    let c;
    const side = sim.sailor.side, atwa = Math.abs(sim.twa) / DEG, kn = sim.telemetry?.kn ?? 0;
    if (phase === 'setup') {
      const twa = kind === 'heli' ? 75 : kind === 'duck' ? 110 : 100;
      c = coach.sail(DT, { twa, pump: !o.slow, straps: kind !== 'heli' && !o.slow, hook: !!o.hooked, hike: 'auto' });
      if (o.slow) c.sheet = Math.min(c.sheet, 0.3);
      const ready = o.slow ? sim.t > 6 : kind === 'heli' ? kn > 7 : (sim.telemetry?.planing ?? 0) > 0.95 && kn > 15;
      if (sim.t > (o.slow ? 6 : 20) && ready && (!o.hooked || sim.sailor.hooked)) { phase = 'prep'; t0 = sim.t; }
    } else if (phase === 'prep') {
      c = coach.sail(DT, { twa: kind === 'heli' ? 70 : kind === 'duck' ? 115 : 100, straps: false, hook: !!o.hooked, hike: 'auto' });
      if (o.slow) c.sheet = Math.min(c.sheet, 0.3);
      if (kind !== 'c360') c.strapsHeld = true;
      if (kind === 'spock') c.weight = o.flat ? 0 : 0.8;
      if (sim.t - t0 > 1.5) { phase = kind === 'duck' ? 'carve' : 'go'; t0 = sim.t; turnSide = side; side0 = side; }
    } else if (phase === 'carve') {
      c = emptyControls();
      const k = Math.min(1, (sim.t - t0) / 0.8);
      c.rail = -side; c.rake = 0.7 * k; c.lean = side * (0.2 + 0.35 * k); c.weight = 0.35; c.sheet = 0.62; c.hike = coach.hikeFor(DT);
      if (atwa > (o.duckAt ?? 145)) { phase = 'go'; t0 = sim.t; }
    } else {
      c = emptyControls();
      c.sheet = 0.6; c.hike = coach.hikeFor(DT);
      if (kind === 'duck') { c.rail = -turnSide; c.rake = 0.4; c.weight = 0.3; c.sheet = 0.55; }
      if (kind === 'c360') { c.rail = -turnSide; c.sheet = 0.7; }
      if (kind === 'spock' && !o.flat) c.weight = sim.state === S.TRICK && (sim.stateData.turned ?? 0) > 0.3 ? o.spinWeight ?? 0.8 : 0.8;
      if (kind === 'heli') { c.rake = -1; c.sheet = 1; }
      if (!pressed) { kIn = kn; c.pop = true; c.pressed[BUTTON[kind]] = true; pressed = true; }
      if (sim.state === S.SAILING && started && sim.t - t0 > 0.3) c = coach.sail(DT, { twa: 100, hook: false, hike: 'auto', rail: kind === 'duck' ? -turnSide : undefined });
    }
    const was = sim.state;
    sim.step(DT, c);
    if (sim.state === S.TRICK) started = true;
    while (seen < sim.events.length) {
      const e = sim.events[seen++];
      if (e.type === 'trickdone') done = { t: sim.t, kn: sim.telemetry.kn, side: sim.sailor.side };
      if (e.type === 'hint' && pressed) hints.push(e.text);
    }
    if (sim.state === S.FALLING && was !== S.FALLING && pressed && !fall) fall = { type: sim.sailor.fallType, inTrick: was === S.TRICK, text: sim.events.at(-1)?.text };
    if (pressed && (fall || (done && sim.t - done.t > 1.5) || sim.t - t0 > 12)) break;
  }
  return { sim, started, done, fall, side0, kIn, hints, kOut: done?.kn ?? 0 };
}
const kn1 = (v) => v.toFixed(1);

// 1–4. Each move from its entry conditions.
{
  const r = attempt('duck');
  report('Duck gybe: carving downwind on the plane, ducked at 145° — out on the new side, still planing', !!r.done && !r.fall && r.done.side === -r.side0 && r.kOut > 10,
    `in ${kn1(r.kIn)} kn, out ${kn1(r.kOut)} kn${r.fall ? ' FELL ' + r.fall.text : ''}`);
}
{
  const r = attempt('c360');
  report('Carving 360: flat out on a reach — all the way round on the same side, slower', !!r.done && !r.fall && r.done.side === r.side0 && r.kOut < r.kIn - 3 && r.kOut > 4,
    `in ${kn1(r.kIn)} kn, out ${kn1(r.kOut)} kn${r.fall ? ' FELL ' + r.fall.text : ''}`);
}
{
  const r = attempt('spock');
  report('Spock: planing, weight forward — a full turn on the nose, out slow on the same side', !!r.done && !r.fall && r.done.side === r.side0 && r.kOut < 0.4 * r.kIn,
    `in ${kn1(r.kIn)} kn, out ${kn1(r.kOut)} kn${r.fall ? ' FELL ' + r.fall.text : ''}`);
}
{
  const r = attempt('heli');
  report('Helitack: close reach, feet out — luffs through the wind, spins the sail, out on the new tack', !!r.done && !r.fall && r.done.side === -r.side0,
    `in ${kn1(r.kIn)} kn, out ${kn1(r.kOut)} kn${r.fall ? ' FELL ' + r.fall.text : ''}`);
}

// 5–8. The ways they go wrong.
{
  const r = attempt('duck', { duckAt: 108 });
  report('Duck gybe too early (at 108°): the wind gets on the wrong side of the sail', r.fall?.type === 'backwind' && r.fall.inTrick, r.fall?.text ?? 'no fall');
}
{
  const r = attempt('spock', { hooked: true });
  report('Spock hooked in: catapulted', r.fall?.type === 'catapult' && !r.started, r.fall?.text ?? 'no fall');
}
{
  const r = attempt('spock', { spinWeight: -1 });
  report('Spock with the weight going back mid-spin: the nose lets go, in the water', !!r.fall && r.fall.inTrick && !r.done, r.fall?.text ?? 'no fall');
}
{
  const r = attempt('c360', { slow: true });
  const r2 = attempt('spock', { flat: true });
  report('Off the plane a carving 360 is refused; without the weight forward, a spock is too (with the reason)', !r.started && r.hints.length > 0 && !r2.started && r2.hints.length > 0,
    `"${r.hints[0] ?? ''}" / "${r2.hints[0] ?? ''}"`);
}

// 9. Battens: steady sailing never pops one, and after a helitack they all
// end up on the new side.
{
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, sailorMass: 75, wind: { speedKn: 17, gustiness: 0.3, shifts: 0.2, chop: 0.8 }, start: 'sailing', assists: { autoHike: true } });
  const ap = new Autopilot(sim, 100, { straps: true });
  let pops = 0, last = null, wrong = 0, n = 0;
  for (let i = 0; i < 80 / DT; i++) {
    sim.step(DT, ap.controls(DT));
    if (sim.t > 10) {
      if (sim.battenPop && sim.battenPop !== last) pops++;
      n++; wrong += sim.rig.cam.filter((c) => c !== sim.sailor.side).length ? 1 : 0;
    }
    last = sim.battenPop;
  }
  report('Battens: steady planing in gusts pops none, all on the leeward side', pops === 0 && wrong === 0 && sim.state === S.SAILING, `${pops} pops, ${(100 * wrong / n).toFixed(1)}% of the time one on the wrong side`);
  const h = attempt('heli');
  const cams = h.sim.rig.cam;
  report('Battens: after a helitack they have all popped through to the new side', !!h.done && cams.every((c) => c === h.sim.sailor.side), `cam [${cams.join(', ')}] side ${h.sim.sailor.side}`);
}

// 10. Twist: in a gust the head twists off further, but never past luffing
// (every strip still drawing).
{
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, sailorMass: 75, wind: { speedKn: 16, gustiness: 0.6, shifts: 0, chop: 0.6 }, start: 'sailing', assists: { autoHike: true } });
  const ap = new Autopilot(sim, 100, { straps: true });
  let lo = Infinity, hi = 0, minA = Infinity;
  for (let i = 0; i < 90 / DT; i++) {
    sim.step(DT, ap.controls(DT));
    if (sim.t > 15 && sim.state === S.SAILING && sim.aero) {
      const tw = sim.aero.twistTop;
      lo = Math.min(lo, tw); hi = Math.max(hi, tw);
      for (const s of sim.aero.strips) minA = Math.min(minA, s.alpha);
    }
  }
  report('Twist: the head opens in the gusts and closes in the lulls, never past luffing', hi > lo + 3 * DEG && minA > -1 * DEG,
    `head twist ${(lo / DEG).toFixed(1)}–${(hi / DEG).toFixed(1)}°, lowest strip angle of attack ${(minA / DEG).toFixed(1)}°`);
}

if (failures) { console.log(`${failures} freestyle/sail check(s) failed`); process.exit(1); }
