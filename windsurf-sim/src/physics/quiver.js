// The gear advisor: the wind range each sail works in on each board, for
// your weight. Fitted to headless runs of the coach (tools/quiver.mjs) with
// a 75 kg sailor on a beam reach in moderate chop: the wind (10 m, knots)
// where it gets planing, pumping, and the wind above which it's overpowered
// (sailing with the sail eased right off, or being pulled over).
//   plane = cp · A^ep,   overpowered = co · A^eo   (A: sail area, m²)
// Heavier sailors need more wind to plane (with the square root of the total
// weight to carry) and can hold more (about weight^0.3).
import { BOARDS, SAILS, findBoard, findSail } from './gear.js';

export const QUIVER_FIT = {
  begin210: [27.88, -0.363, 142.93, -0.982],
  free155: [27.63, -0.401, 260.77, -1.231],
  free135: [21.7, -0.246, 267.23, -1.24],
  free115: [26.04, -0.354, 231.71, -1.224],
  move95: [27.27, -0.375, 222.3, -1.232],
};
const REF_MASS = 75;

/** Wind range (knots at 10 m) for this board, sail area and sailor weight: { plane, over }. */
export function windRange(boardId, area, mass = REF_MASS) {
  const b = findBoard(boardId), sail = findSail(area);
  const [cp, ep, co, eo] = QUIVER_FIT[b.id] ?? QUIVER_FIT.free135;
  const carry = (m) => m + b.mass + sail.rigMass;
  return {
    plane: cp * area ** ep * Math.sqrt(carry(mass) / carry(REF_MASS)),
    over: co * area ** eo * (mass / REF_MASS) ** 0.3,
  };
}

/**
 * The sail to rig for a wind: the one you'd be well powered on, as sailors
 * rig, with some room left before it overpowers you (the wind about two
 * thirds of the way up its range), or the nearest miss if none fits.
 */
export function adviseSail(boardId, mass, windKn) {
  let best = null;
  for (const s of SAILS) {
    const r = windRange(boardId, s.area, mass);
    if (r.over <= r.plane) continue;
    const sweet = r.plane * (r.over / r.plane) ** 0.65;
    const fits = windKn > r.plane && windKn < r.over;
    const miss = fits ? 0 : windKn <= r.plane ? r.plane - windKn : windKn - r.over;
    const score = fits ? Math.abs(Math.log(windKn / sweet)) : 10 + miss;
    if (!best || score < best.score) best = { sail: s, range: r, fits, score };
  }
  return best;
}

/** How a sail suits the wind: 'under' (won't plane), 'over' (overpowered), or 'good'. */
export function suitability(boardId, area, mass, windKn) {
  const r = windRange(boardId, area, mass);
  return windKn < r.plane ? 'under' : windKn > r.over ? 'over' : 'good';
}

export { BOARDS, SAILS };
