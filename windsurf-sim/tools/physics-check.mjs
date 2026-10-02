// Headless physics checks: steady-state speeds and behaviours compared with
// real-world windsurfing numbers. Run: npm test  (or node tools/physics-check.mjs)
import { MS_TO_KN, DEG } from '../src/physics/math.js';
import { Sim, S } from '../src/physics/sim.js';
import { Autopilot } from './autopilot.mjs';

const DT = 1 / 240;

export function runSteady({ board = 'free135', sail = 7, mass = 75, wind = 16, twa = 100, seconds = 60, gust = 0, pump = false, straps = true, start = 'sailing', alpha }) {
  const sim = new Sim({ boardId: board, sailArea: sail, sailorMass: mass, wind: { speedKn: wind, gustiness: gust, shifts: 0, chop: 1 }, start, assists: { autoHike: true } });
  const ap = new Autopilot(sim, twa, { pump, straps, alpha, warmup: twa < 80 || twa > 120 ? 20 : 0 });
  let falls = 0, sumKn = 0, n = 0, sumP = 0, maxKn = 0;
  const fallTexts = [];
  for (let i = 0; i < seconds / DT; i++) {
    const c = ap.controls(DT);
    sim.step(DT, c);
    if (sim.state === S.FALLING && sim.stateTime < DT * 1.5) { falls++; fallTexts.push(sim.events.at(-1)?.text); }
    if (sim.state === S.WATER) { sim.reset('sailing', sim.pos); }
    if (i * DT > seconds * 0.6) { sumKn += sim.telemetry.kn; sumP += sim.telemetry.planing; n++; maxKn = Math.max(maxKn, sim.telemetry.kn); }
  }
  const t = sim.telemetry;
  return {
    kn: sumKn / n, maxKn, planing: sumP / n, falls, fallTexts,
    twa: sim.twa / DEG, leeway: t.leeway / DEG, trim: t.trim / DEG, alpha: t.alpha / DEG,
    sheet: ap.sheet, hand: sim.handForce, beta: sim.sailor.beta / DEG, straps: sim.sailor.straps, hooked: sim.sailor.hooked,
    drag: t.drag, rake: sim.rig.rake / DEG, finA: t.finAlpha / DEG, sim,
  };
}

const fmt = (r) =>
  `${r.kn.toFixed(1).padStart(5)} kn (max ${r.maxKn.toFixed(1)}) plane ${(r.planing * 100).toFixed(0).padStart(3)}% ` +
  `twa ${r.twa.toFixed(0).padStart(4)} lee ${r.leeway.toFixed(1).padStart(5)} trim ${r.trim.toFixed(1)} ` +
  `aoa ${r.alpha.toFixed(0)} sheet ${r.sheet.toFixed(2)} hands ${r.hand.toFixed(0).padStart(4)}N ` +
  `lean ${r.beta.toFixed(0)} rake ${r.rake.toFixed(0)} fin ${r.finA.toFixed(1)} straps ${r.straps}${r.hooked ? ' hooked' : ''} falls ${r.falls}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  if (!only || only === 'speed') {
    console.log('Freeride 135 L, 7.0 m², 75 kg — beam reach (100°) by wind strength');
    for (const wind of [6, 8, 10, 11, 12, 14, 16, 20, 24]) {
      const r = runSteady({ wind, twa: 100 });
      console.log(`  ${String(wind).padStart(2)} kn wind: ${fmt(r)}`);
    }
  }
  if (!only || only === 'polar') {
    const polar = {};
    for (const wind of [16, 22]) {
      console.log(`\nFreeride 135 L, 7.0 m², ${wind} kn — points of sail`);
      for (const twa of wind === 16 ? [45, 55, 70, 90, 110, 130, 140, 150] : [100, 130, 145]) {
        const r = runSteady({ wind, twa });
        polar[`${wind}/${twa}`] = r;
        console.log(`  TWA ${String(twa).padStart(3)}: ${fmt(r)}`);
      }
    }
    // A planing board is fastest on a broad reach once there's enough wind:
    // bearing away from a beam reach to 130° must not drop it off the plane.
    const checks = [
      ['16 kn: 130° keeps at least 90% of the beam-reach speed', polar['16/130'].kn >= 0.9 * polar['16/90'].kn && polar['16/130'].planing > 0.95],
      ['22 kn: 130° is faster than a beam reach', polar['22/130'].kn > polar['22/100'].kn],
      ['22 kn: still planing at 145°', polar['22/145'].planing > 0.95],
    ];
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (!ok) process.exitCode = 1;
    }
  }
  if (!only || only === 'gear') {
    console.log('\nGear check');
    const cases = [
      { board: 'begin210', sail: 5.3, wind: 8, twa: 90, straps: false },
      { board: 'begin210', sail: 5.3, wind: 8, twa: 55, straps: false },
      { board: 'free155', sail: 7.8, wind: 11, twa: 100 },
      { board: 'free115', sail: 6.3, wind: 18, twa: 110 },
      { board: 'move95', sail: 5.3, wind: 22, twa: 110 },
      { board: 'free135', sail: 7.0, wind: 11, twa: 100, pump: true },
    ];
    for (const c of cases) console.log(`  ${c.board} ${c.sail} m² ${c.wind} kn ${c.twa}°${c.pump ? ' pump' : ''}: ${fmt(runSteady(c))}`);
  }
}
