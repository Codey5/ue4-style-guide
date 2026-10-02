// The sailor's body on the board: where the feet go, where the hands and the
// harness hook attach to the rig, the posed joints and the centre of mass.
// The physics balances the sail's pull with this geometry and the renderer
// draws this exact pose, so the lean you see is the lean holding the rig.
import { DEG, add, addScaled, clamp, cross, dot, len, norm, scale, smoothstep, sub } from './math.js';
import { rigAxes } from './sail.js';
import { deckY } from './shape.js';
import { S } from './states.js';

// Segment lengths as fractions of body height (standard anthropometric ratios).
export const BODY = {
  leg: 0.49, // ankle to hip joint
  torso: 0.31, // hip joint to the base of the neck
  neckDrop: 0.028, // shoulder joints below the base of the neck
  shoulder: 0.11, // half the distance between the shoulder joints
  reach: 0.39, // shoulder joint to the grip of a closed hand (upper arm, forearm, hand)
};
export const ANKLE = 0.075; // ankle joint above the deck (m)
// Segment mass fractions (Winter): legs with feet, trunk, head and neck, arms.
const M_LEGS = 0.322, M_TRUNK = 0.497, M_HEAD = 0.081, M_ARMS = 0.1;
const UP = [0, 1, 0];

// ---------------------------------------------------------------------------
// The rig on the board

/** The rig's frame, board coordinates: origin at the mast foot, X along the boom, Y up the mast. */
export function rigFrame(board, rig) {
  const ax = rigAxes(rig.rake, rig.lean, rig.boom);
  return { o: [board.mastFootX, deckY(board, board.mastFootX), 0], X: ax.c, Y: ax.m, Z: cross(ax.c, ax.m) };
}
export const rigToBoard = (f, p) => add(f.o, add(add(scale(f.X, p[0]), scale(f.Y, p[1])), scale(f.Z, p[2])));

/** Half-width of the wishbone boom x metres back from the mast. */
export const tubeOffset = (geo, x) => 0.2 * Math.pow(Math.sin(Math.PI * clamp(x / geo.boomLength, 0, 1)), 0.7) + 0.02;
/** Point on the windward boom tube, rig frame. */
export const boomLocal = (geo, x, side) => [x, geo.boomHeight + (x / geo.boomLength) * 0.06, -side * tubeOffset(geo, x)];

/**
 * Where the hands hold the boom, and where the harness lines are tied on
 * (metres from the mast). With the sail eased right out the back hand slides
 * forward, or the boom would be out of reach to leeward.
 */
export function boomStations(geo, hooked, boom = 0) {
  const L = geo.def.boom; // the boom's nominal length, as on the sail's rig chart
  const front = 0.26 + (hooked ? 0.04 : 0);
  const back = L * (hooked ? 0.5 : 0.44);
  return { front, back: back + (front + 0.42 - back) * smoothstep(25 * DEG, 65 * DEG, Math.abs(boom)), lineA: 0.33 * L, lineB: 0.43 * L };
}

/** Hand and harness-line points on the windward boom tube, board frame. */
export function boomGrips(board, rig, geo, hooked) {
  const f = rigFrame(board, rig), st = boomStations(geo, hooked, rig.boom), side = rig.side;
  const at = (x) => rigToBoard(f, boomLocal(geo, x, side));
  return { f: at(st.front), b: at(st.back), lineA: at(st.lineA), lineB: at(st.lineB) };
}

// ---------------------------------------------------------------------------
// Stance

/** Ankle positions (board frame) and how much the knees are bent, for the state. */
export function stance(board, sailor, state, stateData = {}, stateTime = 0) {
  const side = sailor.side;
  let feetF, feetB, sit;
  if (state === S.SECURE || state === S.UPHAUL || state === S.CLIMB) {
    feetF = [board.mastFootX - 0.16, 0, side * 0.12];
    feetB = [board.mastFootX - 0.5, 0, side * 0.1];
    sit = state === S.UPHAUL ? 0.3 * (1 - (stateData.progress ?? 0)) + 0.06 : 0.06;
  } else if (state === S.TACK) {
    const k = stateData.switched ? 1 : clamp(stateTime / 0.6, 0, 1);
    feetF = [board.mastFootX + 0.12 * k, 0, side * (0.16 - 0.1 * k)];
    feetB = [board.mastFootX - 0.25 + 0.2 * k, 0, side * 0.12];
    sit = 0.08;
  } else {
    const strapZF = 0.29 * board.width, strapZB = 0.2 * board.width;
    if (sailor.straps === 2) {
      feetF = [board.frontStrapX, 0, side * strapZF];
      feetB = [board.backStrapX, 0, side * strapZB];
      sit = sailor.hooked ? 0.05 : 0.08;
    } else if (sailor.straps === 1) {
      feetF = [board.frontStrapX, 0, side * strapZF];
      feetB = [sailor.x - 0.32, 0, side * 0.04];
      sit = 0.1;
    } else {
      feetF = [sailor.x + 0.26, 0, side * 0.03];
      feetB = [sailor.x - 0.32, 0, side * 0.06];
      sit = sailor.hooked ? 0.08 : 0.07;
    }
    if (state === S.FLIP) sit = 0.16;
  }
  feetF[1] = deckY(board, feetF[0]) + ANKLE;
  feetB[1] = deckY(board, feetB[0]) + ANKLE;
  return { feetF, feetB, sit };
}

// ---------------------------------------------------------------------------
// The posed body

/**
 * Everything the pose needs except the lean angle.
 * hands: {f, b} grip points (board frame) or null; lines: {a, b} harness line
 * ends on the boom when hooked in; lineLength: the harness line loop (m).
 */
export function bodyContext({ H, stance: st, side, leanX = 0, hooked = false, hands = null, lines = null, lineLength = 0.45 * H, onBoom = false }) {
  const base = scale(add(st.feetF, st.feetB), 0.5);
  // Hooked in you hang under the harness lines; otherwise centred between the hands.
  const hangX = hooked && lines ? (lines.a[0] + lines.b[0]) / 2 : hands ? (hands.f[0] + hands.b[0]) / 2 : base[0];
  // Lean out to windward and back toward where you hang (weight on the back
  // foot leans you further back).
  const aft = onBoom ? clamp((hangX - base[0]) * 0.9, -0.6, 0.3) : -0.22;
  const leanDir = norm([aft - leanX * 0.8, 0, side]);
  let across = [1, 0, 0];
  if (onBoom && hands) {
    // Shoulders along the board, turning square to it as the boom is let out.
    const d = sub(hands.f, hands.b);
    d[1] = 0;
    if (dot(d, d) > 0.01) across = norm(d);
  }
  return {
    H, side, hooked, onBoom, hands, lines, lineLength, sit: st.sit, feetF: st.feetF, feetB: st.feetB, base,
    leanDir, facing: scale(leanDir, -1), across, half: scale(across, BODY.shoulder * H), hangX,
    reach: BODY.reach * H, hookFacing: norm([0.2, 0, -side]),
  };
}

/**
 * Joints for a lean angle beta (legs from vertical, out to windward). Hanging
 * in the harness the body is nearly straight; holding on with the arms the
 * torso stays a little more upright. On the boom the body hangs fore and aft
 * under the harness lines, or centred between the hands.
 */
export function poseBody(ctx, beta) {
  const { H, sit, base, leanDir, facing } = ctx;
  const bT = beta * (ctx.hooked ? 1 : 0.85);
  const legAxis = add(scale(UP, Math.cos(beta)), scale(leanDir, Math.sin(beta)));
  const torsoAxis = add(scale(UP, Math.cos(bT)), scale(leanDir, Math.sin(bT)));
  const pelvis = addScaled(addScaled(base, legAxis, BODY.leg * H * (1 - sit)), facing, sit * 0.3);
  const neck = addScaled(pelvis, torsoAxis, BODY.torso * H);
  if (ctx.onBoom) {
    const dx = clamp(ctx.hangX - neck[0], -0.3, 0.3);
    pelvis[0] += dx * 0.5;
    neck[0] += dx;
  }
  return bodyFrom(ctx, pelvis, neck);
}

/** Shoulders, hook and centre of mass for a pelvis and neck position. */
export function bodyFrom(ctx, pelvis, neck) {
  const H = ctx.H;
  const axis = norm(sub(neck, pelvis));
  const mid = addScaled(neck, axis, -BODY.neckDrop * H);
  const belt = addScaled(pelvis, sub(neck, pelvis), 0.22);
  const hook = addScaled(belt, ctx.hookFacing, 0.18);
  // Centre of mass from the segments.
  const legs = addScaled(ctx.base, sub(pelvis, ctx.base), 0.57);
  const trunk = addScaled(pelvis, sub(neck, pelvis), 0.4);
  const head = addScaled(neck, axis, 0.07 * H);
  let toHands = ctx.hands ? sub(scale(add(ctx.hands.f, ctx.hands.b), 0.5), mid) : [0, -0.3, 0];
  const l = len(toHands);
  if (l > ctx.reach) toHands = scale(toHands, ctx.reach / l);
  const arms = addScaled(mid, toHands, 0.4);
  const com = add(add(scale(legs, M_LEGS), scale(trunk, M_TRUNK)), add(scale(head, M_HEAD), scale(arms, M_ARMS)));
  return { pelvis, neck, mid, axis, shF: add(mid, ctx.half), shB: sub(mid, ctx.half), hook, com };
}

/** How far (m) the boom is beyond the arms, or the hook beyond the harness lines. <= 0 fits. */
export function overreach(ctx, body) {
  if (!ctx.hands) return -1;
  const r = ctx.reach * 0.97;
  let e = Math.max(len(sub(body.shF, ctx.hands.f)), len(sub(body.shB, ctx.hands.b))) - r;
  if (ctx.hooked && ctx.lines) {
    // The loop slides over the hook: hook-to-ends distances can't add up to more than the loop.
    e = Math.max(e, (len(sub(body.hook, ctx.lines.a)) + len(sub(body.hook, ctx.lines.b)) - ctx.lineLength) / 2);
  }
  return e;
}

/**
 * The range of lean over which the sailor can hold the boom (and hang in the
 * harness lines): betaMax is as far out as the arms and lines reach; betaMin
 * is how far out you must lean to reach a boom that's out over the water.
 * fits is false when the rig is out of reach at any lean.
 */
export function reachLimit(ctx, hi = 70 * DEG, lo = -20 * DEG) {
  const fitsAt = (b) => overreach(ctx, poseBody(ctx, b)) <= 0;
  const bisect = (inside, outside) => {
    for (let i = 0; i < 12; i++) {
      const m = (inside + outside) / 2;
      if (fitsAt(m)) inside = m; else outside = m;
    }
    return inside;
  };
  let betaMax = null, miss = hi, best = hi, bestEx = Infinity;
  for (let b = hi; b >= lo - 1e-9; b -= 3 * DEG) {
    const ex = overreach(ctx, poseBody(ctx, b));
    if (ex <= 0) { betaMax = b === hi ? hi : bisect(b, miss); break; }
    miss = b;
    if (ex < bestEx) { bestEx = ex; best = b; }
  }
  if (betaMax === null) return { betaMax: best, betaMin: best, fits: false, excess: bestEx };
  let betaMin = lo;
  for (let b = betaMax - 3 * DEG; b >= lo - 1e-9; b -= 3 * DEG) {
    if (!fitsAt(b)) { betaMin = bisect(Math.min(betaMax, b + 3 * DEG), b); break; }
  }
  return { betaMax, betaMin, fits: true };
}

// ---------------------------------------------------------------------------
// Lever tables for the balance

/**
 * Centre-of-mass offset to windward of the board's centreline (m) and its
 * distance from the feet, sampled over the lean range. The physics
 * interpolates in this between updates of the geometry.
 */
export function leverTable(ctx, lo, hi, n = 9) {
  const betas = [], levers = [], dists = [];
  for (let i = 0; i < n; i++) {
    const b = lo + ((hi - lo) * i) / (n - 1);
    const body = poseBody(ctx, b);
    betas.push(b);
    levers.push(Math.max(body.com[2] * ctx.side, i ? levers[i - 1] + 1e-4 : -Infinity));
    dists.push(len(sub(body.com, ctx.base)));
  }
  return { betas, levers, dists };
}

const lookup = (xs, ys, x) => {
  const n = xs.length;
  let i = 0;
  if (x <= xs[0]) i = 0;
  else if (x >= xs[n - 1]) i = n - 2;
  else while (x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * t; // extrapolates linearly past the ends
};
/** Lever (m) at a lean. */
export const leverAt = (tbl, beta) => lookup(tbl.betas, tbl.levers, beta);
/** Distance of the centre of mass from the feet (m) at a lean. */
export const comDistAt = (tbl, beta) => lookup(tbl.betas, tbl.dists, beta);
/** The lean that puts the centre of mass at a lever. */
export const leanFor = (tbl, lever) => lookup(tbl.levers, tbl.betas, lever);
