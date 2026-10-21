// Hydrodynamics of the board: Savitsky prismatic planing-hull equations for
// dynamic lift, trim and wetted area, blended with a displacement model
// (buoyancy + wave-making drag) below planing speed. Plus fin/daggerboard foils.
import { DEG, G, NU_WATER, RHO_WATER, clamp, lerp, smoothstep } from './math.js';

/** ITTC-57 friction line plus a roughness allowance. */
export function frictionCoefficient(v, length) {
  const re = Math.max(1e4, (Math.abs(v) * Math.max(length, 0.05)) / NU_WATER);
  const l = Math.log10(re) - 2;
  return 0.075 / (l * l) + 0.0002; // smooth, polished board
}

/** Wave-making resistance per unit buoyantly-supported weight vs length Froude number. */
export function waveDragCoefficient(fn) {
  const f = fn ** 4.5;
  return 0.2 * (f / (f + 0.6 ** 4.5));
}

/**
 * Solve the hull's running attitude.
 * v: forward speed through the water (m/s), W: vertical load (N),
 * xLoad: centre of vertical load in board x (m), board: gear definition.
 *
 * The planing fraction p is the share of the load carried by hydrodynamic
 * lift (Savitsky's dynamic term) at the trim the stance allows; the rest is
 * carried by buoyancy and pays wave-making drag. That gap is the planing hump.
 */
export function planingSolve(v, W, xLoad, board, chopHeight = 0) {
  const L = board.length;
  const wl = L * 0.94; // waterline length
  const V = board.volume / 1000;
  const xcb = -0.06 * L; // centre of buoyancy, a little aft of the middle
  const dLoad = xLoad - board.transomX; // load distance forward of the transom
  // Pitch stiffness of the floating hull (waterplane second moment).
  const kPitch = RHO_WATER * G * (board.width * wl ** 3) / 12 * 0.55;
  const staticTrim = clamp(((xcb - xLoad) * W) / kPitch, -4 * DEG, 10 * DEG);

  const res = {
    planing: 0, trim: staticTrim, lambda: 0, beam: board.width, wetArea: 0.8 * wl * board.width,
    dTrim: 0, dWave: 0, dFric: 0, dTail: 0, dNose: 0, dChop: 0, drag: 0,
    cp: xLoad, submerged: 0, sinking: 0, noseDive: 0, tailHeavy: 0, fn: 0, tauReq: 0,
  };
  const speed = Math.abs(v);
  const fn = speed / Math.sqrt(G * wl);
  res.fn = fn;

  // --- Dynamic lift (Savitsky). Riding on the narrow tail at speed.
  const b = lerp(board.width * 0.9, board.tailWidth, smoothstep(4, 13, speed));
  res.beam = b;
  let p = 0, tau = staticTrim, lambda = (0.9 * wl) / b;
  if (speed > 0.4) {
    const cv = speed / Math.sqrt(G * b);
    const cv2 = cv * cv;
    const lambdaMax = Math.min(4, (0.9 * wl) / b);
    const lp = (lam) => lam * b * (0.75 - 1 / ((5.21 * cv2) / (lam * lam) + 2.39));
    const dl = clamp(dLoad, lp(0.25), lp(lambdaMax));
    res.tailHeavy = smoothstep(0, 0.25, lp(0.25) - dLoad);
    let lo = 0.25, hi = lambdaMax;
    for (let i = 0; i < 28; i++) {
      const mid = 0.5 * (lo + hi);
      if (lp(mid) < dl) lo = mid; else hi = mid;
    }
    lambda = 0.5 * (lo + hi);
    const qb2 = 0.5 * RHO_WATER * speed * speed * b * b;
    // Savitsky's prismatic dynamic lift, with an efficiency factor for a modern
    // board's rocker line and bottom concaves (and 5° deadrise loss).
    const dynPerTau = qb2 * 0.012 * Math.sqrt(lambda) * (1.22 / 1.04); // N per degree^1.1
    const tauReq = Math.pow(W / dynPerTau, 1 / 1.1); // trim needed to plane fully (deg)
    const tauCap = board.maxTrim;
    p = tauReq <= tauCap ? 1 : Math.pow(tauCap / tauReq, 1.1);
    p *= smoothstep(0.6, 2.2, speed); // no meaningful hydrodynamic lift when barely moving
    const tauPlane = Math.min(tauReq, tauCap) * DEG;
    tau = lerp(staticTrim, tauPlane, smoothstep(0.15, 0.8, p));
    res.noseDive = p > 0.6 ? smoothstep(1.3, 0.5, tauReq) : 0;
    res.tauReq = tauReq;
  }
  res.planing = p;
  res.trim = tau;
  res.lambda = lambda;

  const wDyn = p * W;
  const wBuoy = (1 - p) * W;
  res.submerged = wBuoy / (RHO_WATER * G); // m^3 of displaced water
  res.sinking = Math.max(0, res.submerged - V);

  const fullWet = 0.78 * wl * board.width * clamp(0.55 + res.submerged / V, 0.55, 1.15);
  const planeWet = lambda * b * b;
  res.wetArea = lerp(fullWet, planeWet, p);
  const wetLen = lerp(wl * 0.85, lambda * b, p);
  const cf = frictionCoefficient(speed, wetLen);
  const q = 0.5 * RHO_WATER * speed * speed;

  res.dTrim = wDyn * Math.tan(Math.max(tau, 0.5 * DEG));
  res.dWave = wBuoy * waveDragCoefficient(fn);
  // Standing too far back before planing drags the tail through the water.
  const aft = Math.max(0, xcb - 0.15 - xLoad) / L;
  res.dTail = wBuoy * (aft * aft * 4.5) * clamp(W / (RHO_WATER * G * V), 0.4, 1.6) * smoothstep(0.3, 2, speed);
  res.dFric = q * res.wetArea * cf;
  res.dNose = res.noseDive * W * 0.35;
  res.dChop = chopHeight * q * res.wetArea * 0.004 * p;
  if (res.sinking > 0) res.dWave += res.sinking * 4000 * speed * speed;
  res.drag = res.dTrim + res.dWave + res.dTail + res.dFric + res.dNose + res.dChop;
  res.cp = board.transomX + (p > 0.5 ? clamp(dLoad, 0.1, L) : lerp(clamp(dLoad, 0.1, L), xcb - board.transomX, 0.3));
  return res;
}

/**
 * Lift/drag of a fin or daggerboard. alpha in radians (leeway at the foil).
 * Returns {cl, cd, stalled}.
 */
export function foilPolar(alpha, aspect, ventilated) {
  const a = Math.abs(alpha);
  const slope = (2 * Math.PI * aspect) / (aspect + 2);
  const aStall = 14 * DEG;
  let cl;
  let stalled = false;
  if (a <= aStall) cl = slope * a;
  else {
    stalled = true;
    const clMax = slope * aStall;
    const s = smoothstep(aStall, aStall + 20 * DEG, a);
    cl = lerp(clMax * 0.75, 1.15 * Math.sin(a) * Math.cos(a) * 2, s);
  }
  if (ventilated) cl *= 0.28;
  const cd = 0.009 + (cl * cl) / (Math.PI * aspect * 0.9) + (stalled ? 0.6 * Math.sin(a) ** 2 : 0);
  return { cl: Math.sign(alpha) * cl, cd };
}
