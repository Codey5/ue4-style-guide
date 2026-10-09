// Sail geometry and aerodynamics. The sail is split into horizontal strips;
// each strip sees its own apparent wind (wind gradient, sail twist, rig motion
// while pumping) and produces lift/drag from a soft-sail polar.
import { DEG, RHO_AIR, add, clamp, cross, dot, lerp, norm, scale, smoothstep, sub } from './math.js';
import { tw as tweaks } from '../tweaks.js';

export const TACK_HEIGHT = 0.14; // tack (bottom of luff) above the mast foot, along the mast
export const BOOM_HEIGHT = 1.42; // default boom height on the mast above the mast foot
export const CE_CHORD = 0.4; // centre of pressure of a cambered strip, fraction of chord

/** Build the sail outline and aero strips for a sail definition. */
export function buildSailGeometry(def, boomHeight = BOOM_HEIGHT) {
  const tack = TACK_HEIGHT;
  const hb = boomHeight;
  const head = def.luff + 0.02;
  const B = def.boom;
  const N = 400;
  const areaOf = (f) => {
    let a = 0;
    for (let i = 0; i < N; i++) a += f(tack + ((i + 0.5) / N) * (head - tack)) * ((head - tack) / N);
    return a;
  };
  // The force model's planform: a slim outline stretched to the sail's area
  // (what the aerodynamics, the gear chart and the coach were calibrated on).
  const slim = (h) => {
    if (h <= tack || h >= head) return 0;
    if (h <= hb) return B * Math.pow((h - tack) / (hb - tack), 0.55);
    const t = (h - hb) / (head - hb);
    return B * (1 - Math.pow(t, 1.6)) * (1 - 0.05 * t) + 0.1 * t;
  };
  const kSlim = def.area / areaOf(slim);
  const aeroChord = (h) => slim(h) * kSlim;
  // The sail as drawn, cut like a real one: the boom the length on the sail's
  // chart, a full foot sweeping from the tack out to the clew, and above the
  // boom as much roach (fullness in the leech, `p`) as makes up the area.
  // Its centre of effort is within 3 cm of the force model's on a 6.3 m²
  // sail and about 10 cm off at either end of the range.
  const cut = (p) => (h) => {
    if (h <= tack || h >= head) return 0;
    if (h <= hb) return B * Math.pow((h - tack) / (hb - tack), 0.3);
    const t = (h - hb) / (head - hb);
    return B * (1 - Math.pow(t, p)) * (1 - 0.05 * t) + 0.1 * t;
  };
  let lo = 1, hi = 12;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (areaOf(cut(m)) < def.area) lo = m; else hi = m; }
  const drawn = cut(lo);
  // (and if even the fullest roach falls short, the outline is scaled to the area)
  const kDrawn = def.area / areaOf(drawn);
  const chordAt = (h) => drawn(h) * kDrawn;

  const edges = [tack, hb, hb + 0.3 * (head - hb), hb + 0.62 * (head - hb), head];
  const strips = [];
  for (let s = 0; s < edges.length - 1; s++) {
    const h0 = edges[s], h1 = edges[s + 1];
    let area = 0, mh = 0, mc = 0;
    const n = 60;
    for (let i = 0; i < n; i++) {
      const h = h0 + ((i + 0.5) / n) * (h1 - h0);
      const c = aeroChord(h);
      const dA = c * ((h1 - h0) / n);
      area += dA; mh += h * dA; mc += c * CE_CHORD * dA;
    }
    strips.push({
      h: mh / area, // centroid height along the mast
      x: mc / area, // centre of pressure distance from the mast, along the chord
      area,
      twist: clamp((mh / area - hb) / (head - hb), 0, 1),
    });
  }
  let ceH = 0, ceX = 0;
  for (const s of strips) { ceH += s.h * s.area; ceX += s.x * s.area; }
  return {
    def, tack, boomHeight: hb, head, boomLength: chordAt(hb - 1e-4), chordAt, strips,
    // (the wishbone's curve where you hold it, as the hands and lines were calibrated on)
    tubeLength: aeroChord(hb - 1e-4),
    ceHeight: ceH / def.area, ceChord: ceX / def.area,
    aspect: (def.luff * def.luff) / def.area,
  };
}

/**
 * Rig axes in the board frame.
 * rake: mast top toward the bow (+) or tail (-). lean: mast top toward
 * starboard (+) or port (-). boom: boom angle from the tail, + to port.
 */
export function rigAxes(rake, lean, boom) {
  const m = [Math.sin(rake) * Math.cos(lean), Math.cos(rake) * Math.cos(lean), Math.sin(lean)];
  const a0 = [-1, 0, 0];
  const ap = norm(sub(a0, scale(m, dot(a0, m))));
  const qp = cross(ap, m); // port, perpendicular to the mast
  const c = add(scale(ap, Math.cos(boom)), scale(qp, Math.sin(boom)));
  return { m, ap, qp, c };
}

/** Chord direction for a given boom angle using precomputed mast axes. */
export const chordDir = (ax, boom) => add(scale(ax.ap, Math.cos(boom)), scale(ax.qp, Math.sin(boom)));

/**
 * Soft-sail lift/drag polar. alpha in radians; positive alpha = wind on the
 * intended windward side. Returns {cl, cd}.
 */
export function sailPolar(alpha, clMax, aspect, cd0 = 0.03) {
  const aDeg = alpha / DEG;
  const a = Math.abs(aDeg);
  const ALUFF = 5, ASTALL = 23;
  const flatPlate = (k) => {
    const cn = k * Math.sin(alpha);
    return { cl: cn * Math.cos(alpha), cd: cn * Math.sin(alpha) + 0.03 };
  };
  if (aDeg < 0) {
    // Backwinded: the wind hits the convex side and the camber inverts.
    const fp = flatPlate(1.1);
    return { cl: fp.cl, cd: Math.max(fp.cd, 0.05) };
  }
  const induced = (cl) => (cl * cl) / (Math.PI * aspect * 0.85);
  if (a <= ASTALL) {
    let cl;
    if (a < ALUFF) cl = 0.3 * (a / ALUFF); // luffing: the front of the sail collapses
    else cl = 0.3 + (clMax - 0.3) * Math.sin(((a - ALUFF) / (ASTALL - ALUFF)) * Math.PI * 0.5);
    const flap = a < ALUFF ? 0.05 * (1 - a / ALUFF) : 0;
    return { cl, cd: cd0 + induced(cl) + flap };
  }
  // Gentle soft-sail stall blending into flat-plate behaviour.
  const s = smoothstep(ASTALL, ASTALL + 32, a);
  const fp = flatPlate(1.32);
  const clAtt = clMax * (1 - 0.15 * smoothstep(ASTALL, ASTALL + 15, a));
  const cdAtt = cd0 + induced(clMax) + 0.25 * smoothstep(ASTALL, ASTALL + 25, a);
  return { cl: lerp(clAtt, fp.cl, s), cd: lerp(cdAtt, fp.cd, s) };
}

/**
 * Rig tuning, as set on the beach. outhaul: -1 loose (full, powerful,
 * draggy) .. +1 tight (flat: less power, less drag, faster at the top end).
 * downhaul: -1 too little (tight leech: more grunt, but the top doesn't
 * twist off and the draft blows back in gusts) .. +1 maximum (loose leech:
 * the top twists open early, less power, steady draft, easy in gusts).
 * Returns the polar's power and drag factors, the leech twist at the head
 * for the current load (q, Pa) and the draft position (fraction of chord).
 */
export function sailTune(t = {}, q = 30) {
  const o = clamp(t.outhaul ?? 0, -1, 1), d = clamp(t.downhaul ?? 0, -1, 1);
  const load = clamp(q / 90, 0, 1.4);
  // The draft sits further back in a full sail (and blows back as the load
  // builds past a planing breeze, unless the downhaul holds it forward).
  const draft = CE_CHORD - 0.03 * o - 0.01 * d + 0.035 * (1 - d) / 2 * clamp((q - 90) / 90, -0.5, 1);
  return {
    power: 1 - 0.1 * o - 0.05 * d,
    // Camber drag (what a flat sail saves at speed), and a draft blown aft
    // with a closed leech drags too.
    cd0: 0.03 * (1 - 0.35 * o) + 0.6 * Math.max(0, draft - CE_CHORD),
    twistTop: (4 + 3 * d + (10 + 5 * d) * load) * DEG,
    draft,
  };
}

/**
 * Aerodynamic force on the sail.
 * ctx: { R (board->world), pos (board origin, world), vel, yawRate, mastFoot
 * (board frame), rake, lean, boom, side (+1 clew to port), windAt(p) -> vec,
 * waterLevel, prevPoints (array of board-frame strip points or null), dt,
 * tune ({outhaul, downhaul}, see sailTune), cam (each strip's camber
 * direction, ±1: which way its battens are popped; default side) }
 * Each strip also reports press: the pressure (Pa) pushing on the convex
 * side of its camber once it's backwinded by more than a luff (4°), which
 * pops its battens through to the other side.
 */
export function sailForces(geo, ctx) {
  const { R, pos, vel, yawRate, rake, lean, boom, side, dt } = ctx;
  const ax = rigAxes(rake, lean, boom);
  const mw = mulR(R, ax.m);
  const tune = sailTune(ctx.tune, ctx.qEstimate ?? 30);
  const { twistTop, draft } = tune;
  const clMax = geo.def.clMax * tune.power;
  // Closing the gap between foot and deck raises the effective aspect ratio.
  const gap = clamp(1 - Math.abs(lean) / (22 * DEG), 0, 1) * clamp((-rake + 6 * DEG) / (16 * DEG), 0, 1);
  const aspect = geo.aspect * (1 + 0.6 * gap);

  const out = { force: [0, 0, 0], strips: [], alphaMid: 0, awMid: [0, 0, 0], qMean: 0, points: [], ceChord: 0, draft, twistTop };
  let wAlpha = 0, wq = 0, wCe = 0, wF = 0;
  for (let i = 0; i < geo.strips.length; i++) {
    const s = geo.strips[i];
    // The camber bulges (and the leech twists off) the way the battens are
    // popped: to leeward normally, the other way once the wind's got on the
    // wrong side hard enough to pop them through.
    const cs = ctx.cam ? (ctx.cam[i] >= 0 ? 1 : -1) : side;
    const c0 = chordDir(ax, boom);
    // The draft (and with it the centre of pressure) sits where the tuning puts it.
    const sx = s.x * (draft / CE_CHORD);
    // (where the strip's load acts: on the untwisted chord, which is also
    // the rig-motion reference point; twist is aeroelastic, not something
    // the sailor moves through the air)
    const pB = add(add(ctx.mastFoot, scale(ax.m, s.h)), scale(c0, sx));
    const pRig = pB;
    out.points.push(pRig);
    const pW = add(pos, mulR(R, pB));
    // Velocity of this point through the air.
    const rW = mulR(R, pB);
    let v = add(vel, [yawRate * rW[2], 0, -yawRate * rW[0]]);
    if (ctx.prevPoints && dt > 0) {
      // Rig motion (sheeting, pumping) through the air. Clamped so a state
      // change that teleports the rig doesn't produce a phantom gust.
      let rv = scale(sub(pRig, ctx.prevPoints[i]), 1 / dt);
      const rs = Math.hypot(rv[0], rv[1], rv[2]);
      if (rs > 5) rv = scale(rv, 5 / rs);
      v = add(v, mulR(R, rv));
    }
    const wind = ctx.windAt(pW, Math.max(0.3, pW[1] - ctx.waterLevel));
    const aw = sub(wind, v);
    const vPerp = sub(aw, scale(mw, dot(aw, mw)));
    const sp = Math.hypot(vPerp[0], vPerp[1], vPerp[2]);
    if (sp < 1e-4) {
      out.strips.push({ p: pW, f: [0, 0, 0], alpha: 0, q: 0, tw: 0, press: 0 });
      continue;
    }
    const u = scale(vPerp, 1 / sp);
    // The leech twists open with the load, but aeroelastically: only until
    // the strip stops carrying load (a couple of degrees of attack), never
    // past it into backwinding itself.
    const alpha0 = Math.atan2(dot(u, mulR(R, scale(cross(c0, ax.m), cs))), dot(u, mulR(R, c0)));
    const tw = clamp(s.twist * twistTop, 0, Math.max(0, alpha0 - 2 * DEG));
    const c = chordDir(ax, boom + cs * tw);
    const nLee = scale(cross(c, ax.m), cs);
    const cW = mulR(R, c), nW = mulR(R, nLee);
    const alpha = Math.atan2(dot(u, nW), dot(u, cW));
    const q = 0.5 * RHO_AIR * sp * sp * tweaks.physics.sailPower;
    const { cl, cd } = sailPolar(alpha, clMax, aspect, tune.cd0);
    const cn = cl * Math.cos(alpha) + cd * Math.sin(alpha);
    const ct = cd * Math.cos(alpha) - cl * Math.sin(alpha);
    const f = scale(add(scale(nW, cn), scale(cW, ct)), q * s.area);
    out.force = add(out.force, f);
    // Where along the chord the sail's load sits, weighted by its normal force.
    const fn = Math.abs(cn) * q * s.area;
    wCe += sx * fn; wF += fn;
    out.strips.push({ p: pW, f, alpha, q, cl, tw, press: q * Math.max(0, Math.sin(-alpha) - Math.sin(4 * DEG)) });
    if (i === 1 || i === 2) {
      wAlpha += alpha * s.area; wq += s.area;
      out.awMid = add(out.awMid, scale(aw, s.area));
    }
    out.qMean += q * s.area / geo.def.area;
  }
  out.ceChord = wF > 1e-6 ? wCe / wF : geo.ceChord * (draft / CE_CHORD);
  out.alphaMid = wq > 0 ? wAlpha / wq : 0;
  out.awMid = wq > 0 ? scale(out.awMid, 1 / wq) : out.awMid;
  out.aspect = aspect;
  out.mastWorld = mw;
  return out;
}

function mulR(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
