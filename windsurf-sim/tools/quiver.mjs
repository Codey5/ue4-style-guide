// Calibrates the gear advisor: for each board and sail, the wind (10 m, kn)
// at which a 75 kg sailor gets planing (beam reach, pumping) and the wind
// above which they're overpowered (sailing with the sail eased right off,
// mean angle of attack under 9.5°, or falling). Finds each with headless
// runs of the coach and prints the power-law fits for QUIVER_FIT in
// src/physics/quiver.js (the raw table goes to stderr).
// Run: node tools/quiver.mjs [boardId]   (a few minutes per board)
import { Sim, S } from '../src/physics/sim.js';
import { BOARDS, SAILS } from '../src/physics/gear.js';
import { DEG } from '../src/physics/math.js';
import { Autopilot } from './autopilot.mjs';

const DT = 1 / 240;
export const MASS = 75;

export function trial({ board, sail, mass = MASS, wind, seconds = 45 }) {
  const sim = new Sim({ boardId: board, sailArea: sail, sailorMass: mass, wind: { speedKn: wind, gustiness: 0, shifts: 0, chop: 1 }, start: 'sailing', assists: { autoHike: true } });
  const ap = new Autopilot(sim, 100, { pump: true, straps: true });
  let falls = 0, n = 0, p = 0, a = 0;
  for (let i = 0; i < seconds / DT; i++) {
    const c = ap.controls(DT);
    const was = sim.state;
    sim.step(DT, c);
    if (sim.state === S.FALLING && was !== S.FALLING) falls++;
    if (sim.state === S.WATER) sim.reset('sailing', sim.pos);
    if (sim.t > seconds * 0.6) { n++; p += sim.telemetry.planing; a += sim.telemetry.alpha / DEG; }
  }
  return { planing: p / n, alpha: a / n, falls };
}
export const planes = (r) => r.planing > 0.9;
export const overpowered = (r) => r.falls >= 2 || r.alpha < 9.5;

/**
 * The wind where test() first holds, scanning up from `from` in 2 kn steps
 * and then halving the last step twice (to about half a knot).
 */
export function threshold(from, to, test) {
  let lo = null;
  for (let w = from; w <= to; w += 2) {
    if (test(w)) {
      if (lo === null) return w;
      let a = lo, b = w;
      for (let i = 0; i < 2; i++) {
        const mid = (a + b) / 2;
        if (test(mid)) b = mid; else a = mid;
      }
      return Math.round(((a + b) / 2) * 2) / 2;
    }
    lo = w;
  }
  return Infinity;
}

/** Least-squares power law v = c · A^e through [area, value] points: [c, e]. */
export function fitPower(points) {
  const xs = points.map(([a]) => Math.log(a)), ys = points.map(([, v]) => Math.log(v));
  const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  const e = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return [Math.exp(my - e * mx), e];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  for (const b of BOARDS) {
    if (only && b.id !== only) continue;
    const row = [];
    for (const s of SAILS) {
      const plane = threshold(6, 32, (w) => planes(trial({ board: b.id, sail: s.area, wind: w })));
      const over = plane === Infinity ? Infinity : threshold(Math.ceil(plane) + 1, 40, (w) => overpowered(trial({ board: b.id, sail: s.area, wind: w })));
      row.push([s.area, plane, over]);
      console.error(`${b.id} ${s.area}: planes from ${plane} kn, overpowered above ${over} kn`);
    }
    console.error(`  ${b.id} table: ${JSON.stringify(row.map(([a, p, o]) => [a, Number.isFinite(p) ? p : null, Number.isFinite(o) ? o : null]))}`);
    // The fit for QUIVER_FIT (overpowered fitted from 4.7 m² up: the smallest
    // sails' limits are past what the coach was asked to sail).
    const [cp, ep] = fitPower(row.filter(([, p]) => Number.isFinite(p)).map(([a, p]) => [a, p]));
    const [co, eo] = fitPower(row.filter(([a, , o]) => Number.isFinite(o) && a >= 4.7).map(([a, , o]) => [a, o]));
    console.log(`  ${b.id}: [${cp.toFixed(2)}, ${ep.toFixed(3)}, ${co.toFixed(2)}, ${eo.toFixed(3)}],`);
  }
}
