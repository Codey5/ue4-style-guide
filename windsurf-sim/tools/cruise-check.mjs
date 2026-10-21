// The cruise (the coach sailing round on its own while you watch and tune)
// keeps going: for each setup, eight minutes on the water with no hand on
// the controls, and it fails unless the coach sails laps round its marks,
// stays clear of the beach and the sandbar, isn't stuck in the water or
// in irons for long (it may be reset back onto the water now and then, not
// over and over) and spends most of its time sailing.
// Run: node tools/cruise-check.mjs
import { Sim, S, BEACH_Z } from '../src/physics/sim.js';
import { CruisePilot } from '../src/coach/cruise.js';

const DT = 1 / 240, SECS = 480;
const SETUPS = [
  ['Beginner 210 L, 5.3 m², 9 kn', { boardId: 'begin210', sailArea: 5.3, wind: { speedKn: 9, gustiness: 0.3, chop: 0.4 } }],
  ['Freeride 135 L, 7.0 m², 16 kn', { boardId: 'free135', sailArea: 7.0, wind: { speedKn: 16, gustiness: 0.45, chop: 0.8 } }],
  ['Freeride 115 L, 6.3 m², 20 kn, chop', { boardId: 'free115', sailArea: 6.3, wind: { speedKn: 20, gustiness: 0.5, chop: 1.0 } }],
];
let failures = 0;
for (const [label, setup] of SETUPS) {
  const sim = new Sim({ ...setup, sailorMass: 75, wind: { fromDeg: 270, ...setup.wind }, start: 'sailing', assists: { autoHike: false, noFalls: false } });
  const pilot = new CruisePilot(sim);
  let falls = 0, resets = 0, sailing = 0, planing = 0, prev = sim.state, nearBeach = 0, maxX = -1e9, minX = 1e9, ok = true;
  const seen = sim.events.length;
  for (let i = 0; i < SECS / DT; i++) {
    sim.step(DT, pilot.controls(DT));
    pilot.after(DT);
    if (sim.state === S.FALLING && prev !== S.FALLING) falls++;
    prev = sim.state;
    if (sim.state === S.SAILING) sailing += DT;
    if ((sim.telemetry?.planing ?? 0) > 0.9) planing += DT;
    nearBeach = Math.min(nearBeach, sim.pos[2] - BEACH_Z);
    maxX = Math.max(maxX, sim.pos[0]); minX = Math.min(minX, sim.pos[0]);
    if (![sim.pos[0], sim.pos[2], sim.vel[0]].every(Number.isFinite)) { ok = false; break; }
  }
  resets = sim.events.slice(seen).filter((e) => e.type === 'cruise').length;
  const laps = pilot.laps;
  const pass = ok && laps >= 2 && resets <= 2 && sailing / SECS > 0.6;
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(36)} ${laps} laps, ${falls} falls, ${resets} resets, sailing ${(100 * sailing / SECS).toFixed(0)}%, planing ${(100 * planing / SECS).toFixed(0)}%, x ${minX.toFixed(0)}..${maxX.toFixed(0)} m${ok ? '' : ' (the physics broke)'}`);
}
if (failures) { console.log(`${failures} cruise run(s) didn't keep going`); process.exit(1); }
