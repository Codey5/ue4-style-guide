// GPS speed sessions and the speed strip, checked headlessly: the logger's
// numbers against tracks with known answers, the flat water in the lee of
// the sandbar against open chop, running aground, and the gear advisor.
// Run: node tools/gps-check.mjs
import { GpsLogger } from '../src/game/gps.js';
import { SessionBook, GearVerdict } from '../src/game/sessions.js';
import { S } from '../src/physics/states.js';
import { Sim } from '../src/physics/sim.js';
import { SANDBAR, barCoords, barPoint } from '../src/physics/spot.js';
import { adviseSail, windRange } from '../src/physics/quiver.js';
import { SAILS } from '../src/physics/gear.js';
import { MS_TO_KN } from '../src/physics/math.js';
import { Autopilot } from './autopilot.mjs';

let failures = 0;
const report = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const kn = (v) => (v * MS_TO_KN).toFixed(2);

/** Feed a logger a track: fn(t) -> { x, z, v, gybing }, at 240 Hz like the physics. */
function track(seconds, fn, log = new GpsLogger()) {
  const fake = { t: 0, pos: [0, 0, 0], vel: [0, 0, 0], state: S.SAILING };
  for (let i = 1; i <= seconds * 240; i++) {
    fake.t += 1 / 240;
    const p = fn(fake.t);
    fake.pos = [p.x, 0, p.z];
    fake.vel = [p.v, 0, 0];
    fake.state = p.gybing ? S.FLIP : S.SAILING;
    log.step(fake);
  }
  return log;
}

// 1. A steady 10 m/s in a straight line: every category reads 10 m/s, no alpha.
{
  const g = track(240, (t) => ({ x: 10 * t, z: 0, v: 10 }));
  const r = g.results();
  report('GPS: steady 10 m/s reads 10 m/s in every category', ['s2', 's10', 'five10', 'm500', 'nm'].every((k) => near(r[k], 10, 0.02)) && r.alpha === 0,
    `2 s ${r.s2.toFixed(3)} 10 s ${r.s10.toFixed(3)} 5×10 ${r.five10.toFixed(3)} 500 m ${r.m500.toFixed(3)} NM ${r.nm.toFixed(3)} α ${r.alpha}`);
  report('GPS: distance and duration', near(r.distance, 2400, 2) && near(r.duration, 240, 0.2), `${r.distance.toFixed(1)} m in ${r.duration.toFixed(1)} s`);
}

// 2. A burst: 8 m/s with 3 s at 12 m/s. The 2 s peak catches the burst, 10 s averages it in, 500 m less still.
{
  const v = (t) => (t > 60 && t < 63 ? 12 : 8);
  let x = 0, last = 0;
  const g = track(300, (t) => { x += v(t) * (t - last); last = t; return { x, z: 0, v: v(t) }; });
  const r = g.results();
  const expect10 = (3 * 12 + 7 * 8) / 10;
  report('GPS: a 3 s burst — 2 s peak 12, 10 s averages it in, 500 m and NM less', near(r.s2, 12, 0.05) && near(r.s10, expect10, 0.12) && r.m500 < r.s10 && r.nm < r.m500 && r.nm > 8,
    `2 s ${r.s2.toFixed(2)} 10 s ${r.s10.toFixed(2)} (expect ${expect10.toFixed(2)}) 500 m ${r.m500.toFixed(2)} NM ${r.nm.toFixed(3)}`);
}

// 3. Runs at different speeds: 5×10 s averages the five best 10-second windows
// that don't overlap (two can come from one long fast run).
{
  const speeds = [9, 6, 11, 6, 10, 6, 12, 12, 6, 13, 6, 8];
  const v = (t) => speeds[Math.floor(t / 10)] ?? 6;
  let x = 0, last = 0;
  const g = track(120, (t) => { x += v(t) * (t - last); last = t; return { x, z: 0, v: v(t) }; });
  const r = g.results();
  report('GPS: 5×10 s is the average of the five best non-overlapping 10-second windows', near(r.five10, (13 + 12 + 12 + 11 + 10) / 5, 0.1) && r.five10n === 5, `5×10 ${r.five10.toFixed(2)} from ${r.five10n}`);
}

// 4. Alpha 500: out 230 m, a gybe round a 20 m turn, back 230 m: counted; the same without the gybe isn't.
{
  const out = 230, R = 10, V = 10, turn = Math.PI * R / V;
  const path = (t, gybe) => {
    if (t < out / V) return { x: V * t, z: 0, v: V };
    if (t < out / V + turn) { const a = (t - out / V) * V / R; return { x: out + R * Math.sin(a), z: R - R * Math.cos(a), v: V, gybing: gybe && a > 1 && a < 2 }; }
    return { x: out - V * (t - out / V - turn), z: 2 * R, v: V };
  };
  const len = (2 * out + Math.PI * R) / V;
  const g = track(len + 0.5, (t) => path(t, true));
  const h = track(len + 0.5, (t) => path(t, false));
  report('GPS: alpha 500 counts an out-and-back run through a gybe, not one without', near(g.best.alpha, V, 0.1) && h.best.alpha === 0, `α ${g.best.alpha.toFixed(2)} vs ${h.best.alpha}`);
}

// 5. A restart somewhere else breaks the track: no run spans the jump.
{
  const g = track(30, (t) => (t < 15 ? { x: 10 * t, z: 0, v: 10 } : { x: 5000 + 10 * t, z: 0, v: 10 }));
  report('GPS: a restart elsewhere breaks the track', near(g.results().distance, 300, 3) && near(g.best.s10, 10, 0.02), `${g.results().distance.toFixed(0)} m`);
}

// 6. Personal bests: only from 10 knots, only when beaten, kept in storage.
{
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const book = new SessionBook(store);
  book.begin({ board: 'free115', sail: 6.3, wind: 22, mass: 75 });
  const slow = book.beats('s2', 4), first = book.beats('s2', 12);
  book.claim('s2', 12); book.save();
  const again = new SessionBook(store);
  report('Sessions: records from 10 kn, beaten or not, saved between visits', !slow && first && !again.beats('s2', 11.9) && again.beats('s2', 12.1) && again.bests.s2.board === 'free115');
}

// 7. The speed strip: the same broad reach is flatter and faster in the sandbar's lee.
const DT = 1 / 240;
function stripRun(spot, d) {
  const w = [1, 0];
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, wind: { speedKn: 22, gustiness: 0, shifts: 0, chop: 1.4 }, start: 'sailing', assists: { autoHike: true }, spot });
  const at = barPoint(SANDBAR, w[0], w[1], 40, d);
  sim.reset('sailing', [at[0], 0, at[1]]);
  sim.yaw = Math.atan2(-SANDBAR.lz, SANDBAR.lx);
  sim.vel = [SANDBAR.lx * 6, 0, SANDBAR.lz * 6];
  const ap = new Autopilot(sim, 120, { straps: true });
  const g = new GpsLogger();
  let air = 0, n = 0, falls = 0, hs = 0, minD = Infinity;
  for (let i = 0; i < 80 / DT; i++) {
    const was = sim.state;
    sim.step(DT, ap.controls(DT));
    if (sim.state === S.FALLING && was !== S.FALLING) falls++;
    if (sim.t > 20) { g.step(sim); n++; air += sim.airborne ? 1 : 0; hs += sim.waves.hsAt(sim.pos[0], sim.pos[2]); minD = Math.min(minD, barCoords(SANDBAR, 1, 0, sim.pos[0], sim.pos[2])[1]); }
  }
  return { s10: g.best.s10, m500: g.best.m500, air: air / n, falls, hs: hs / n, minD };
}
{
  const strip = stripRun({ bar: SANDBAR }, SANDBAR.halfWidth + 30);
  const open = stripRun(null, SANDBAR.halfWidth + 30);
  console.log(`  strip: 10 s ${kn(strip.s10)} kn, 500 m ${kn(strip.m500)} kn, chop ${strip.hs.toFixed(2)} m, airborne ${(strip.air * 100).toFixed(0)}%, closest ${strip.minD.toFixed(0)} m from the bar, falls ${strip.falls}`);
  console.log(`  open:  10 s ${kn(open.s10)} kn, 500 m ${kn(open.m500)} kn, chop ${open.hs.toFixed(2)} m, airborne ${(open.air * 100).toFixed(0)}%, falls ${open.falls}`);
  report('Speed strip: flat water in the lee of the sandbar is faster than open chop', strip.hs < 0.4 * open.hs && strip.s10 > open.s10 + 0.5 && strip.m500 > 0 && strip.air < open.air && strip.falls === 0);
}

// 8. Sailing onto the sandbar: you run aground and end up back in the water beside it.
{
  const sim = new Sim({ boardId: 'free115', sailArea: 6.3, wind: { speedKn: 20, gustiness: 0, shifts: 0, chop: 1 }, start: 'sailing', assists: { autoHike: true }, spot: { bar: SANDBAR } });
  const at = barPoint(SANDBAR, 1, 0, 300, -60);
  sim.reset('sailing', [at[0], 0, at[1]]);
  // (a broad reach on starboard closes on the bar from its windward side)
  const ap = new Autopilot(sim, 145, { straps: false });
  let aground = false;
  for (let i = 0; i < 40 / DT && !aground; i++) {
    sim.step(DT, ap.controls(DT));
    if (sim.sailor.fallType === 'aground') aground = true;
  }
  const d = barCoords(SANDBAR, 1, 0, sim.pos[0], sim.pos[2])[1];
  report('Speed strip: sailing onto the sandbar runs you aground, back in the water beside it', aground && Math.abs(d) > SANDBAR.halfWidth, `d ${d.toFixed(1)} m`);
}

// 9. The gear advisor: bigger sails plane earlier and overpower sooner; it rigs smaller as the wind rises.
{
  const ranges = SAILS.map((s) => windRange('free135', s.area, 75));
  const mono = ranges.every((r, i) => i === 0 || (r.plane <= ranges[i - 1].plane + 0.01 && r.over < ranges[i - 1].over));
  const a12 = adviseSail('free135', 75, 13), a18 = adviseSail('free135', 75, 18), a25 = adviseSail('free135', 75, 25);
  const heavy = windRange('free135', 7, 95), light = windRange('free135', 7, 60);
  report('Gear advisor: wind ranges ordered by sail size, smaller sails as it blows harder, heavier sailors need more wind',
    mono && a12.sail.area > a18.sail.area && a18.sail.area > a25.sail.area && a25.fits && heavy.plane > light.plane && heavy.over > light.over,
    `13 kn: ${a12.sail.name}, 18 kn: ${a18.sail.name}, 25 kn: ${a25.sail.name}`);
}

// 10. The gear verdict reads overpowered off a session sailed with the sail eased right off.
{
  const v = new GearVerdict();
  const fake = { state: S.SAILING, twa: 1.8, telemetry: { planing: 1, speed: 9, alpha: 0.1 }, feel: {}, lastControls: { sheet: 0.5 } };
  for (let i = 0; i < 60 * 10; i++) v.step(fake, 0.1);
  const u = new GearVerdict();
  const slow = { state: S.SAILING, twa: 1.7, telemetry: { planing: 0.3, speed: 3, alpha: 0.3 }, feel: {}, lastControls: { sheet: 0.9 } };
  for (let i = 0; i < 60 * 10; i++) u.step(slow, 0.1);
  report('Gear verdict: overpowered and underpowered sessions read as such', v.result(null, 6.3).kind === 'over' && u.result(null, 6.3).kind === 'under');
}

if (failures) { console.log(`${failures} GPS/strip check(s) failed`); process.exit(1); }
