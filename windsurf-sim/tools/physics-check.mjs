// Headless physics checks: steady-state speeds and behaviours compared with
// real-world windsurfing numbers. Run: npm test  (or node tools/physics-check.mjs)
import { MS_TO_KN, DEG } from '../src/physics/math.js';
import { Sim, S } from '../src/physics/sim.js';
import { Autopilot } from './autopilot.mjs';

const DT = 1 / 240;

export function runSteady({ board = 'free135', sail = 7, mass = 75, wind = 16, twa = 100, seconds = 60, gust = 0, chop = 1, pump = false, straps = true, start = 'sailing', alpha, tune, weight }) {
  const sim = new Sim({ boardId: board, sailArea: sail, sailorMass: mass, wind: { speedKn: wind, gustiness: gust, shifts: 0, chop }, start, assists: { autoHike: true }, tune });
  const ap = new Autopilot(sim, twa, { pump, straps, alpha, weight, warmup: twa < 80 || twa > 120 ? 20 : 0 });
  let falls = 0, sumKn = 0, n = 0, sumP = 0, maxKn = 0, sumTrim = 0, front = 0, back = 0, air = 0;
  const fallTexts = [];
  for (let i = 0; i < seconds / DT; i++) {
    const c = ap.controls(DT);
    const was = sim.state;
    sim.step(DT, c);
    if (sim.state === S.FALLING && was !== S.FALLING) { falls++; fallTexts.push(sim.events.at(-1)?.text); }
    if (sim.state === S.WATER) { sim.reset('sailing', sim.pos); }
    if (i * DT > seconds * 0.6) {
      sumKn += sim.telemetry.kn; sumP += sim.telemetry.planing; n++; maxKn = Math.max(maxKn, sim.telemetry.kn);
      sumTrim += sim.telemetry.trim; front += sim.hands?.front ?? 0; back += sim.hands?.back ?? 0; air += sim.airborne ? 1 : 0;
    }
  }
  const t = sim.telemetry;
  return {
    kn: sumKn / n, maxKn, planing: sumP / n, falls, fallTexts, meanTrim: sumTrim / n / DEG, front: front / n, back: back / n, air: air / n,
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
  if (!only || only === 'tune') {
    // Rig tuning, 135 L / 7.0 m², 75 kg: each setting's trade-off, as sailors describe it.
    console.log('\nRig tuning');
    const T = (o) => { const r = runSteady(o); console.log(`  ${JSON.stringify(o.tune)} ${o.wind} kn${o.gust ? ' gusty' : ''}: ${fmt(r)} trim ${r.meanTrim.toFixed(1)} hands ${r.front.toFixed(0)}/${r.back.toFixed(0)} N`); return r; };
    const full12 = T({ wind: 12, tune: { outhaul: -1 } }), flat12 = T({ wind: 12, tune: { outhaul: 1 } });
    const full16 = T({ wind: 16, tune: { outhaul: -1 } }), norm16 = T({ wind: 16, tune: {} });
    const dhLo = T({ wind: 22, gust: 0.6, tune: { downhaul: -1 } }), dhHi = T({ wind: 22, gust: 0.6, tune: { downhaul: 1 } });
    const dhLo12 = T({ wind: 12, tune: { downhaul: -1 } }), dhHi12 = T({ wind: 12, tune: { downhaul: 1 } });
    const mastBack = T({ wind: 22, chop: 0.3, tune: { mastPos: -0.1 } }), mastFwd = T({ wind: 22, chop: 0.3, tune: { mastPos: 0.1 } });
    const linesFwd = T({ wind: 16, tune: { linesPos: -0.1 } }), linesBack = T({ wind: 16, tune: { linesPos: 0.1 } });
    const checks = [
      ['Outhaul: a full sail planes in 12 kn, a flat one doesn\'t', full12.planing > 0.95 && flat12.planing < 0.9],
      ['Outhaul: a full sail is back-hand heavy once planing', full16.back > norm16.back + 25],
      ['Downhaul: maximum is faster in a gusty 22 kn', dhHi.kn > dhLo.kn + 0.8 && dhHi.falls === 0],
      ['Downhaul: light is more powerful in 12 kn', dhLo12.kn > dhHi12.kn + 1],
      ['Mast foot: back is faster in 22 kn on flat water, forward rides nose-down', mastBack.kn > mastFwd.kn + 0.3 && mastFwd.meanTrim < mastBack.meanTrim],
      ['Harness lines: forward loads the back hand, back loads the front hand', linesFwd.back > linesFwd.front + 40 && linesBack.front > linesBack.back + 40],
    ];
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (!ok) process.exitCode = 1;
    }
  }
  if (!only || only === 'chop') {
    // Chop at speed: the board skims and skips, slamming costs speed, and the
    // nose wants to be kept up (135 L / 7.0 m², beam reach).
    console.log('\nChop');
    const C = (o) => { const r = runSteady(o); console.log(`  ${o.wind} kn chop ${o.chop}${o.weight !== undefined ? ` weight ${o.weight}` : ''}: ${fmt(r)} airborne ${(r.air * 100).toFixed(0)}%`); return r; };
    const flat = C({ wind: 16, chop: 0.2 }), chop16 = C({ wind: 16, chop: 1 }), chop22 = C({ wind: 22, chop: 1 });
    const fwd = C({ wind: 22, chop: 1.4, weight: 0.6 }), back = C({ wind: 22, chop: 1.4, weight: -1 });
    const checks = [
      ['Chop: flat water is faster than a 16 kn chop', flat.kn > chop16.kn + 1],
      ['Chop: the board skips off the chop at speed, not on flat water', flat.air < 0.005 && chop22.air > 0.03 && chop22.air < 0.4],
      ['Chop: the coach sails through normal chop without falling', chop16.falls === 0 && chop22.falls === 0],
      ['Chop: weight back beats weight forward in rough water', back.kn > fwd.kn + 2],
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
