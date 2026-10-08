// The windsurfing simulation: board + rig + sailor.
//
// Horizontal motion (surge, sway, yaw) is integrated from real forces: sail
// strips, planing hull drag, fin and daggerboard lift, hull side force, rail
// carving and sailor windage. Trim, heave and roll follow quasi-static
// equilibria from the planing solution. The sailor's lean is a balanced
// inverted pendulum fighting the sail's heeling moment — sheet out, hike or
// get pulled over. How far out you can hang, and how much your weight
// counters, comes from the posed body (body.js): feet in the straps, hands on
// the boom, hook in the harness lines.
import {
  DEG, G, MS_TO_KN, RHO_AIR, RHO_WATER, add, approach, boardMatrix, clamp, cross, damp,
  dot, lerp, mulMtV, mulMV, norm, scale, smoothstep, sub, wrapAngle,
} from './math.js';
import { Wind, Waves } from './environment.js';
import { barCoords, barPoint, onBar } from './spot.js';
import { BOARDS, BOOM_RATIO, DEFAULT_SAILOR, LINES_RATIO, findBoard, findSail } from './gear.js';
import { buildSailGeometry, rigAxes, sailForces } from './sail.js';
import { foilPolar, planingSolve } from './hull.js';
import {
  bodyContext, boomGrips, comDistAt, comDistPhi, comFwdAt, leanFor, leverAt, leverTable, phiForFwd, pitchTable, poseBody, reachLimit,
  boomStations, gripCenterX, reachPhi, stance,
} from './body.js';
import { S } from './states.js';

export { S };

/** Smooth proportional servo with a rate cap — how hands move a rig. */
const servo = (x, target, gain, maxRate, dt) => x + clamp((target - x) * gain * dt, -maxRate * dt, maxRate * dt);

const ON_BOARD = new Set([S.SAILING, S.SECURE, S.TACK, S.FLIP, S.UPHAUL, S.TRICK]);
const HOLDS_BOOM = new Set([S.SAILING, S.TACK, S.FLIP, S.TRICK]);
/** Freestyle moves: names, and the button you press with LB held (crouched) to start each. */
export const TRICKS = {
  duck: { name: 'Duck gybe', button: 'Y' },
  heli: { name: 'Helitack', button: 'B' },
  c360: { name: 'Carving 360', button: 'X' },
  spock: { name: 'Spock', button: 'A' },
};

export const BEACH_Z = -260; // the shoreline runs east-west, north of the start

/** Share of the chop's vertical kick that gets past your legs to the whole board-rig-sailor system. */
const LEGS = 0.4;
/**
 * The pop: legs driving the board off the water. POP_T is how long the
 * extension lasts, POP_ACC the extra upward push it gives the whole system
 * while the board is still on the water (a full crouch: about 1.5 m/s).
 */
const POP_T = 0.15, POP_ACC = 10;
/** Yaw torque (N·m) your feet put into turning a slow board, at full rig rake. */
const FEET_STEER = 16;
/** How long holding the pop button takes to crouch fully (s). */
const CROUCH_T = 0.3;
/**
 * Battens: the pressure (Pa) on the convex side of a strip's camber that
 * pops its battens through to the other side, and how long the snap takes.
 */
const BATTEN_PRESS = 4, BATTEN_T = 0.06;
/** Standard harness line centre, as a fraction of the boom from the mast (see body.js). */
const LINES_AT = 0.38;
/** Typical ratio of the loaded sail's centre of pressure to its area centroid (calibrates handLoads). */
const CE_REF = 1.02;
/**
 * Rig tuning. linesPos: harness lines' centre, metres back along the boom
 * from the standard spot; mastPos: mast foot, metres forward in its track
 * from the middle; downhaul and outhaul: -1..1 (see sail.js sailTune).
 */
export function normTune(t = {}) {
  return {
    linesPos: clamp(t.linesPos ?? 0, -0.1, 0.1), mastPos: clamp(t.mastPos ?? 0, -0.1, 0.1),
    downhaul: clamp(t.downhaul ?? 0, -1, 1), outhaul: clamp(t.outhaul ?? 0, -1, 1),
  };
}

/** Normalised controls the sim consumes (see ui/input.js for the mapping). */
export function emptyControls() {
  return {
    rake: 0, lean: 0, weight: 0, rail: 0, sheet: 0, hike: 0, pump: false, uphaul: false, pop: false, strapsHeld: false,
    pressed: { hook: false, straps: false, tack: false, flip: false, climb: false, drop: false },
  };
}

const finite = (v, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : 0);
function sanitize(c) {
  return {
    ...c,
    rake: finite(c.rake, -1, 1), lean: finite(c.lean, -1, 1), weight: finite(c.weight, -1, 1), rail: finite(c.rail, -1, 1),
    sheet: finite(c.sheet, 0, 1), hike: finite(c.hike, 0, 1), pressed: c.pressed ?? {},
  };
}

export class Sim {
  constructor(opts = {}) {
    this.wind = new Wind(opts.wind);
    // (the spot: a sandbar sheltering a speed strip, or open water)
    this.spot = opts.spot ?? null;
    this.waves = new Waves(this.wind, this.spot?.bar ?? null);
    this.assists = { autoHike: false, noFalls: false, ...(opts.assists ?? {}) };
    this.events = [];
    this.t = 0;
    this.tune = normTune(opts.tune);
    this.setGear(opts.boardId ?? 'free135', opts.sailArea ?? 7, opts.sailorMass ?? DEFAULT_SAILOR.mass,
      opts.sailorHeight ?? DEFAULT_SAILOR.height, opts.boomHeight, opts.harnessLines);
    this.reset(opts.start ?? 'secure');
  }

  /**
   * boomHeight: above the deck; defaults to between chest and shoulder height (BOOM_RATIO × body height).
   * harnessLines: loop length (m); defaults to 0.45 × body height (32" for a 183 cm sailor).
   */
  setGear(boardId, sailArea, sailorMass, sailorHeight = DEFAULT_SAILOR.height, boomHeight, harnessLines) {
    this.baseBoard = findBoard(boardId);
    this.sail = findSail(sailArea);
    this.sailorMass = sailorMass;
    this.sailorHeight = clamp(sailorHeight, 1.5, 2.05);
    this.boomHeight = clamp(boomHeight ?? BOOM_RATIO * this.sailorHeight, 1.0, 1.75);
    this.harnessLines = clamp(harnessLines ?? LINES_RATIO * this.sailorHeight, 0.5, 1.0);
    this.sailGeo = buildSailGeometry(this.sail, this.boomHeight);
    this.setTune(this.tune);
    this.daggerDown = !!this.board.dagger;
    this.prevPoints = null;
  }

  /**
   * Rig tuning (see normTune): where the mast foot sits in its track and the
   * harness lines on the boom, and the downhaul and outhaul on the sail.
   */
  setTune(t) {
    this.tune = normTune({ ...this.tune, ...t });
    this.board = { ...this.baseBoard, mastFootX: this.baseBoard.mastFootX + this.tune.mastPos };
    this.sailGeo.linesPos = this.tune.linesPos;
    this.bodyGeo = null;
  }

  get totalMass() {
    return this.board.mass + this.sailorMass + this.sail.rigMass;
  }

  setWind(opts) {
    Object.assign(this.wind, opts);
    this.waves.rebuild();
  }

  /** Put the sailor back near the start. mode: 'secure' | 'sailing' | 'water'. */
  reset(mode = 'secure', at = null) {
    const d = this.wind.dir;
    // Starboard tack, beam reach, heading away from the beach.
    const side = 1;
    this.yaw = Math.atan2(-d[0] * side, -d[2] * side);
    this.pos = at ? [at[0], 0, at[2]] : [0, 0, 0];
    this.vel = [0, 0, 0];
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0; this.rollRate = 0; this.pitchRate = 0;
    this.heave = 0; this.heaveVel = 0;
    this.airborne = false; this.airTime = 0; this.airHeight = 0; this.contact = 1; this.noseDrag = 0; this.slamDrag = 0;
    this.impact = 0; this.finAir = 0; this.landing = null; this.aLong = 0;
    this.popT = undefined; this.popK = 0; this.jump = null; this.takeoff = null;
    this.rig = { rake: 0, lean: 0, boom: side * 80 * DEG, side, up: 1, cam: [side, side, side, side], camTo: [side, side, side, side] };
    this.sailor = {
      side, x: this.board.mastFootX - 0.35, leanX: 0, beta: 4 * DEG, betaRate: 0, hang: 0, hangTime: 0, phi: 0, phiRate: 0,
      hooked: false, straps: 0, stamina: 1, gripLost: 0, hookTimer: 0, strapsHoldTime: 0,
      pumpPhase: 0, fallType: null, crouch: 0, knees: 0, backOff: 0, regrab: 1,
    };
    this.twa = side * Math.PI / 2;
    this.pullFelt = undefined;
    this.hangDown = 0;
    this.copX = undefined;
    this.pitchBalance = null;
    this.lastBase = undefined;
    this.bodyGeo = null;
    this.finVentilated = false;
    this.spinoutTime = 0;
    this.sinkTime = 0;
    this.prevPoints = null;
    this.hull = null;
    this.maxSpeed = 0;
    this.planingTime = 0;
    this.setState(mode === 'water' ? S.WATER : mode === 'sailing' ? S.SAILING : S.SECURE);
    if (mode === 'sailing') {
      const f = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
      this.vel = scale(f, 4.5);
      this.rig.boom = side * 62 * DEG; // eased: you sheet in from here
      this.sailor.beta = 12 * DEG;
    }
    if (mode === 'water') this.rig.up = 0;
  }

  setState(s, data = {}) {
    // Coming up onto the board (or out of a turn) you're already set against the pull.
    // (against the pull there is now, not the one you last felt before it)
    if (s === S.SAILING && this.state !== S.SAILING) { this.pitchSettle = true; this.pullFelt = undefined; }
    this.state = s;
    this.stateTime = 0;
    this.stateData = data;
    this.bodyGeo = null; // new stance: re-solve the body
  }

  emit(type, text, priority = 1) {
    const last = this.events.findLast?.((e) => e.type === type);
    if (last && this.t - last.t < 2.5) return;
    this.events.push({ type, text, t: this.t, priority });
    if (this.events.length > 40) this.events.shift();
  }

  // ---------------------------------------------------------------------------

  step(dt, ctl) {
    ctl = sanitize(ctl);
    this.lastControls = ctl;
    this.t += dt;
    this.stateTime += dt;
    const b = this.board;
    const sailor = this.sailor;
    const rig = this.rig;

    const fwd = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    const stbd = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
    const u = dot(this.vel, fwd);
    const w = dot(this.vel, stbd);
    const speed = Math.hypot(this.vel[0], this.vel[2]);
    const waterY = this.waves.height(this.pos[0], this.pos[2], this.t);
    const windHere = this.wind.sample(this.pos[0], 6, this.pos[2], this.t);
    const windFrom = scale(norm(windHere), -1);
    const twa = Math.atan2(dot(windFrom, stbd), dot(windFrom, fwd)); // + = wind from starboard
    this.twa = twa;
    const p = this.hull ? this.hull.planing : 0;

    this.handleButtons(ctl, twa, speed);
    this.updateStateMachine(dt, ctl, twa, speed);
    this.updateRig(dt, ctl, twa);
    this.updateStance(dt, ctl);

    // ---- Board attitude and sail aerodynamics
    const R = boardMatrix(this.yaw, this.pitch, this.roll);
    const mastFoot = [b.mastFootX, b.thickness, 0];
    const deckY = b.thickness;
    const rigFlying = rig.up > 0.6 && this.state !== S.FALLING;
    let aero = null;
    if (rigFlying) {
      aero = sailForces(this.sailGeo, {
        R, pos: this.pos, vel: this.vel, yawRate: this.yawRate, mastFoot,
        rake: rig.rake, lean: rig.lean, boom: rig.boom, side: rig.side, dt,
        prevPoints: this.prevPoints, waterLevel: waterY, qEstimate: this.lastQ ?? 30, tune: this.tune, cam: rig.cam,
        windAt: (pt, h) => this.wind.sample(pt[0], h, pt[2], this.t),
      });
      this.prevPoints = aero.points;
      this.lastQ = damp(this.lastQ ?? aero.qMean, aero.qMean, 4, dt);
    } else {
      this.prevPoints = null;
    }
    this.aero = aero;
    this.updateBattens(dt, aero);

    const sailorOnBoard = ON_BOARD.has(this.state) || this.state === S.RISING;
    const mS = this.sailorMass, mB = b.mass, mR = this.sail.rigMass;

    // ---- Forces on the sailor: roll moment about the board centreline at deck level.
    let tauAero = 0, tipAero = 0, aeroUp = 0, aeroFwd = 0, aeroBoard = [0, 0, 0];
    if (aero) {
      for (const st of aero.strips) {
        const pB = mulMtV(R, sub(st.p, this.pos));
        const fB = mulMtV(R, st.f);
        tauAero += (pB[1] - deckY) * fB[2] - pB[2] * fB[1];
        // Pitch about the mast foot: drive high up, and lift behind the mast, tip the rig forward.
        tipAero += (pB[1] - deckY) * fB[0] - (pB[0] - b.mastFootX) * fB[1];
      }
      aeroBoard = mulMtV(R, aero.force);
      aeroUp = aero.force[1];
      aeroFwd = aeroBoard[0];
    }
    const transmit = this.state === S.SAILING ? 1 : this.state === S.FLIP ? 0.35 : this.state === S.TACK ? 0.3 :
      this.state === S.TRICK ? this.trickTransmit() : 0;
    const tauPull = -sailor.side * tauAero * transmit; // + pulls the sailor toward the rig
    this.tipAero = tipAero * transmit;
    const handForce = Math.max(0, tauPull) / (this.boomHeight + deckY);
    this.handForce = handForce;
    this.hands = this.handLoads(handForce);

    // ---- Vertical load and its fore/aft centre (drives planing trim).
    const rigOnBoard = mR * rig.up;
    let W, xLoad;
    if (sailorOnBoard) {
      // Weight hung through the harness and boom into the mast foot.
      const mfp = Math.max((sailor.hooked ? 0.22 : 0.08) * handForce, this.state === S.SAILING ? this.hangDown ?? 0 : 0);
      const up = Math.max(0, aeroUp);
      W = (mB + mS + rigOnBoard) * G - aeroUp;
      const feetLoad = Math.max(0.05 * mS * G, mS * G - mfp - up);
      // The sail's drive reaches the board through the feet and the mast foot,
      // at deck level (the sailor leans back against it), so it only pitches
      // the nose down with the deck's height above the planing surface.
      xLoad = (mB * G * -0.05 + (rigOnBoard * G + mfp) * b.mastFootX + feetLoad * this.feetLoadX()) /
        Math.max(1, mB * G * 1 + rigOnBoard * G + mfp + feetLoad) + (aeroFwd * (deckY + 0.05)) / Math.max(200, W);
    } else {
      W = (mB + mS * 0.12 + rigOnBoard * 0.4) * G - Math.max(0, aeroUp) * 0.3;
      xLoad = b.mastFootX - 0.3;
    }
    W = Math.max(W, 0.25 * mB * G);
    const chop = this.waves.hsAt(this.pos[0], this.pos[2]);
    const hull = planingSolve(u, W, xLoad, b, chop);
    this.hull = hull;

    // ---- Horizontal forces & yaw moments about the system CG.
    const cgX = this.cgX(sailorOnBoard);
    const cgW = add(this.pos, mulMV(R, [cgX, deckY + 0.5, 0]));
    let F = [0, 0, 0];
    let N = 0;
    const applyAt = (pointWorld, f) => {
      F = add(F, [f[0], 0, f[2]]);
      const r = sub(pointWorld, cgW);
      N += r[2] * f[0] - r[0] * f[2];
    };
    const boardPoint = (x, y, z = 0) => add(this.pos, mulMV(R, [x, y, z]));

    // In a waterstart the sailor in the water takes most of the sail's pull;
    // only part of it reaches the board through the mast foot.
    const aeroShare = this.state === S.WATERSTART ? 0.3 : 1;
    if (aero) for (const st of aero.strips) applyAt(st.p, scale(st.f, aeroShare));

    // Sailor windage.
    if (sailorOnBoard) {
      const bodyP = boardPoint(sailor.x, deckY + 1.05, sailor.side * 0.3);
      const aw = sub(this.wind.sample(bodyP[0], 1.1, bodyP[2], this.t), this.vel);
      const awS = Math.hypot(aw[0], aw[2]);
      applyAt(bodyP, scale(aw, 0.5 * RHO_AIR * awS * 0.55));
    }

    // Hull drag along the direction of travel (none while the board flies),
    // and a nose dug into a chop.
    const contact = this.contact ?? 1;
    if (speed > 1e-3) {
      const vdir = scale(this.vel, 1 / speed);
      const fwdShare = Math.abs(u) / speed;
      applyAt(boardPoint(hull.cp, 0.02), scale(vdir, -hull.drag * fwdShare * contact));
      if (this.noseDrag) applyAt(boardPoint(b.length * 0.5 - 0.35, 0.02), scale(vdir, -this.noseDrag));
      if (this.slamDrag) applyAt(boardPoint(hull.cp, 0.02), scale(vdir, -this.slamDrag));
    }

    // Hull side force: cross-flow drag on the immersed hull plus planing rail grip.
    const leeway = Math.atan2(w, Math.max(Math.abs(u), 0.3));
    const draft = clamp(hull.submerged / (0.75 * b.length * b.width), 0.02, 0.2);
    const latArea = b.length * 0.9 * (draft + 0.03);
    // (a skip of a tenth of a second barely unloads the rails: the grip goes as the board stays out)
    this.contactLat = damp(this.contactLat ?? 1, contact, contact > (this.contactLat ?? 1) ? 30 : 5, dt);
    const hullSide = -(0.5 * RHO_WATER * w * Math.abs(w) * latArea * 1.1 + w * 18 + p * W * 0.9 * Math.sin(leeway)) * this.contactLat;
    const hullLatX = lerp(-0.1, hull.cp, p);
    applyAt(boardPoint(hullLatX, 0), scale(stbd, hullSide));

    // Fin (ventilation = spin-out) and daggerboard.
    const finDepth = b.finDepth;
    // Flying, only the tip of the fin is still in the water.
    const finIn = clamp(1 - (this.airborne ? Math.max(0, (this.airHeight ?? 0) - 0.05) : 0) / finDepth, 0.15, 1);
    const fin = this.foilForce(dt, boardPoint(b.finX, -finDepth * 0.45), b.finArea * finIn, (finDepth * finDepth / b.finArea) * 1.4, true, fwd, stbd, hull);
    applyAt(fin.point, fin.f);
    this.fin = fin;
    let dagger = null;
    if (b.dagger && this.daggerDown) {
      dagger = this.foilForce(dt, boardPoint(b.dagger.x, -b.dagger.depth * 0.45), b.dagger.area,
        (b.dagger.depth ** 2 / b.dagger.area) * 1.3, false, fwd, stbd, hull);
      applyAt(dagger.point, dagger.f);
    }

    // Rail carving: the tilted planing surface pushes the board toward the
    // sunk rail. In displacement mode a heeled hull turns the other way.
    const carve = p * W * Math.tan(this.roll) * 0.85 * this.contactLat;
    applyAt(cgW, scale(stbd, carve));
    N += -carve * 0.32;
    N += this.roll * u * Math.abs(u) * 26 * (1 - p);

    // Rig and sailor in the water act as sea anchors: the rig lies to leeward,
    // the sailor hangs on near the tail on the windward side.
    if (!rigFlying || !sailorOnBoard) {
      const anchorAt = (pt, cdA) => {
        const r = sub(pt, this.pos);
        const v = add(this.vel, [this.yawRate * r[2], 0, -this.yawRate * r[0]]);
        const sp = Math.hypot(v[0], v[2]);
        applyAt(pt, scale(v, -0.5 * RHO_WATER * sp * cdA));
      };
      if (rig.up < 0.6) anchorAt(boardPoint(b.mastFootX - 0.2, 0, -sailor.side * 1.4), 0.6);
      if (!sailorOnBoard) anchorAt(boardPoint(b.backStrapX + 0.2, 0, sailor.side * 0.6), 0.35);
      // Swimming/holding the board, it settles across the wind with the rig to leeward.
      if (!sailorOnBoard || this.state === S.UPHAUL) {
        const d = this.wind.dir;
        const target = Math.atan2(-d[0] * sailor.side, -d[2] * sailor.side);
        const strength = this.state === S.WATERSTART ? 0 : 1;
        N += strength * (wrapAngle(target - this.yaw) * 45 - this.yawRate * 30);
        const drift = scale(d, 0.25 * this.wind.speed / 8);
        F = add(F, scale(sub(drift, this.vel), 40 * strength));
      }
    }

    // Waterstart: you steer the board by pushing it through the mast foot —
    // rig toward the nose pushes the nose away from the wind. Your body in the
    // water and your back foot on the board damp the turning.
    if (this.state === S.WATERSTART && this.stateData.phase === 'power') {
      N += sailor.side * ctl.rake * 70 - this.yawRate * 90;
    }

    // In irons: stopped, pointing into the wind, the sail flapping (told once, after a moment).
    const irons = this.state === S.SAILING && Math.abs(this.twa) < 38 * DEG && speed < 1;
    this.ironsT = irons ? (this.ironsT ?? 0) + dt : 0;
    if (this.ironsT > 2 && !this.inIrons) this.emit('irons', 'In irons: pointing into the wind, the sail can\'t fill. Ease the sheet and push the rig toward the nose: your feet turn the board away from the wind.', 2);
    this.inIrons = this.ironsT > 2 || (this.inIrons && irons);

    // Slogging, you steer with your feet as much as with the rig: pushing the
    // board round under you through the mast foot (rig forward bears away),
    // even in irons with the sail flapping. It fades as the board gets going
    // and the fin and daggerboard take over.
    if (this.state === S.SAILING && !this.airborne) {
      N += sailor.side * ctl.rake * FEET_STEER * (1 - smoothstep(1.2, 3, speed));
    }

    // Tacking: the feet push the board round through the wind.
    if (this.state === S.TACK) {
      const d = this.stateData;
      const turn = -d.fromSide; // heading up from the old tack = turning toward the old windward side
      N += turn * (d.switched ? 20 : 38) * clamp(1 - Math.abs(this.yawRate) / 0.9, 0, 1) * 1.6;
    }

    // Hull yaw damping (the fin adds most of it at speed).
    N -= this.yawRate * (22 + 14 * Math.abs(u)) + this.yawRate * Math.abs(this.yawRate) * 40;

    // ---- Integrate horizontal motion.
    const m = mB + mS + mR;
    const sailorLat = sailorOnBoard ? this.sailorHeight * 0.56 * Math.sin(Math.max(0, sailor.beta)) + 0.1 : 0.8;
    const Iz = mB * b.length ** 2 / 12 + mS * (0.08 + (sailor.x - cgX) ** 2 + sailorLat ** 2) +
      mR * (0.6 + (b.mastFootX - cgX) ** 2);
    // Flying, there's no water to turn the board: your feet in the straps
    // keep it pointing where it's going (it would land sliding sideways
    // otherwise), and twisting it on its rail with them turns it.
    if (this.airborne && sailorOnBoard && speed > 2) {
      // (the sail carries you downwind in the air, so where you're going turns too)
      const travel = Math.atan2(-this.vel[2], this.vel[0]);
      const a0 = this.accel ?? [0, 0, 0];
      const travelRate = (this.vel[2] * a0[0] - this.vel[0] * a0[2]) / (speed * speed);
      // (only once properly flying: skipping over the tops, the fin still has it)
      N += Iz * smoothstep(0.08, 0.25, this.airTime ?? 0) * (30 * wrapAngle(travel - this.yaw) + 8 * (travelRate - this.yawRate) - 4 * this.roll);
    }
    // Freestyle: the feet and the rig turning the board through the move.
    if (this.state === S.TRICK) N += this.trickTorque(Iz, speed);

    const acc = scale(F, 1 / (m * (1 + 0.08 * (1 - p))));
    this.vel = add(this.vel, scale(acc, dt));
    this.vel[1] = 0;
    this.pos = add(this.pos, scale(this.vel, dt));
    // (in a helitack, a carving 360 or a spock your feet and the rail turn the board, not the fin)
    const carved = this.state === S.TRICK && this.stateData.kind !== 'duck';
    if (!carved) this.yawRate += (N / Iz) * dt;
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    if (this.state === S.TRICK) this.trickMotion(dt);
    this.accel = acc;
    // (felt through the legs over a moment, not at every physics step)
    this.aLong = damp(this.aLong ?? 0, dot(acc, fwd), 15, dt);

    // ---- Attitude: heave, trim and roll follow the water and the planing solution.
    this.updateAttitude(dt, ctl, hull, waterY, sailorOnBoard, u, aeroUp);

    // ---- Sailor balance.
    this.updateBalance(dt, ctl, tauPull, handForce, p, speed, sailorOnBoard);
    this.updateFeel(dt, speed);

    // ---- Running aground on the sandbar: the fin digs into the sand.
    const bar = this.spot?.bar;
    if (bar && sailorOnBoard && this.state !== S.FALLING && onBar(bar, this.wind.dir[0], this.wind.dir[2], this.pos[0], this.pos[2])) {
      const wd = this.wind.dir;
      const [s, d] = barCoords(bar, wd[0], wd[2], this.pos[0], this.pos[2]);
      this.fall('aground', 'your fin hit the sand. Keep off the sandbar: the flat water is just to leeward of it.');
      // (you walk the board off it, back into the water on the side you came from)
      const out = barPoint(bar, wd[0], wd[2], s, Math.sign(d || 1) * (bar.halfWidth + 6));
      this.pos[0] = out[0]; this.pos[2] = out[1];
      this.vel = [0, 0, 0];
    }

    // ---- Sinking boards.
    if (sailorOnBoard && hull.sinking > 0.012 && this.state !== S.FALLING) {
      this.sinkTime += dt;
      if (this.sinkTime > 1.6) this.fall('sink', 'The board sank under you — not enough volume at this speed.');
    } else this.sinkTime = Math.max(0, this.sinkTime - dt);

    // ---- Failsafe: never let a numerical blow-up freeze the game.
    if (![this.vel[0], this.vel[2], this.pos[0], this.pos[1], this.pos[2], this.yaw, this.yawRate, this.pitch, this.roll, sailor.beta, rig.boom].every(Number.isFinite)) {
      const at = this.lastGood ?? [0, 0, 0];
      this.reset('secure', at);
      this.emit('reset', 'Physics reset', 2);
      return;
    }
    if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) this.lastGood = [this.pos[0], 0, this.pos[2]];

    // ---- Bookkeeping and telemetry.
    const kn = speed * MS_TO_KN;
    if (this.state === S.SAILING) this.maxSpeed = Math.max(this.maxSpeed, kn);
    if (p > 0.92 && speed > 4.5 && this.state === S.SAILING) {
      if (this.planingTime === 0) this.emit('planing', 'Planing!');
      this.planingTime += dt;
    } else if (p < 0.7) {
      if (this.planingTime > 1.5 && this.state === S.SAILING) this.emit('offplane', 'Dropped off the plane');
      this.planingTime = 0;
    }
    this.telemetry = {
      speed, kn, twa, u, w, leeway, planing: p, trim: hull.trim, wet: hull.wetArea, drag: hull.drag,
      dragParts: hull, W, xLoad, aero, aeroFwd, aeroSide: aeroBoard[2], aeroUp, tauPull, handForce,
      finAlpha: fin.alpha, finLoad: fin.load, dagger, carve,
      awSpeed: aero ? Math.hypot(...aero.awMid) : 0,
      alpha: aero ? aero.alphaMid : 0,
    };
  }

  /**
   * How the rig's pull is shared between the hands and the harness lines.
   * The sail's load sits at its draft, part way back along the boom; held at
   * a different point, the hands have to add a twisting couple. Harness
   * lines forward of that balance point leave the back hand pulling (and
   * the front hand pushing); lines behind it load the front hand and the
   * sail wants to sheet in. Gusts blow the draft back (less so with more
   * downhaul), so a rig balanced in a lull gets back-hand heavy in a gust.
   * Returns {front, back} (N, pulling), the balance point and the lines (m
   * from the mast) and the couple's hand force (+ = back hand).
   */
  handLoads(P) {
    const geo = this.sailGeo, s = this.sailor, L = geo.def.boom;
    const hooked = s.hooked && this.state === S.SAILING;
    const st = this.bodyGeo?.stations ?? boomStations(geo, hooked, this.rig.boom);
    const span = Math.max(0.3, st.back - st.front);
    // The balance point moves with the sail's centre of pressure; the
    // standard harness line position (a third of the way along) is where it
    // sits sailing powered up with a normal tune.
    const ce = this.aero ? this.aero.ceChord : geo.ceChord * CE_REF;
    const balance = LINES_AT * L * (ce / (geo.ceChord * CE_REF));
    const lines = 0.5 * (st.lineA + st.lineB);
    if (!hooked) {
      const back = P * clamp((balance - st.front) / span, 0, 1);
      return { front: P - back, back, balance, lines, couple: 0 };
    }
    const couple = (P * (balance - lines)) / span;
    return { front: Math.max(0, -couple) + 0.07 * P, back: Math.max(0, couple) + 0.07 * P, balance, lines, couple };
  }

  /**
   * What you feel through the rig and the board, 0..1 each (drives the
   * controller rumble): the pull nearing what leaning back on your toes can
   * hold, sideways load at the limit of your hike, the fin close to letting
   * go, a hand close to losing its grip, and a gust arriving in the sail.
   */
  updateFeel(dt, speed) {
    const s = this.sailor, sailing = this.state === S.SAILING;
    const pb = sailing ? this.pitchBalance : null;
    let pitch = 0;
    if (pb && pb.toe > 0.05) {
      const copNeed = pb.comX + pb.tip / (this.sailorMass * G);
      pitch = clamp((copNeed - 0.45 * pb.toe) / (0.55 * pb.toe), 0, 1.5);
    }
    const bal = this.balance;
    // (sideways: the pull past what your weight, hanging as far out as you reach, and your core can hold)
    const capacity = bal ? this.sailorMass * G * Math.max(0.1, bal.leverMax ?? 0.5) + 0.6 * bal.tauMax : 1;
    const lateral = sailing && bal ? clamp((bal.tauPull / capacity - 1.2) / 0.3, 0, 1) : 0;
    const fin = sailing && speed > 4 ? (this.finVentilated ? 1 : smoothstep(0.75, 1, this.finMargin ?? 0)) : 0;
    const grip = 250 + 400 * s.stamina;
    const h = this.hands;
    const handLoad = h ? (s.hooked ? Math.max(h.back, h.front) * 2.2 : h.back * 1.25) : 0;
    const hand = sailing ? smoothstep(0.6, 1, handLoad / grip) : 0;
    // (a gust: the sail's load rising faster than a moment ago, ~3 s average)
    const q = this.aero ? this.aero.qMean : 0;
    this.feelQ = damp(this.feelQ ?? q, q, 3, dt);
    const gust = sailing && this.stateTime > 2 ? clamp((q - this.feelQ) / 20, 0, 1) : 0;
    this.feel = { pitch, lateral, fin, hand, gust };
  }

  /** Where the sailor's weight goes through the feet, board x. */
  feetLoadX() {
    const s = this.sailor;
    if (this.state === S.SECURE || this.state === S.UPHAUL) return this.board.mastFootX - 0.12;
    // Sailing, wherever your feet are actually pressing (see updatePitch).
    if (this.state === S.SAILING && this.copX !== undefined) return this.copX;
    return s.x + s.leanX;
  }

  cgX(sailorOnBoard) {
    const b = this.board;
    const mS = sailorOnBoard ? this.sailorMass : 0;
    return (b.mass * -0.05 + this.sail.rigMass * (b.mastFootX - 0.35) + mS * this.feetLoadX()) /
      (b.mass + this.sail.rigMass + mS);
  }

  foilForce(dt, point, area, aspect, isFin, fwd, stbd, hull) {
    const r = sub(point, this.pos);
    const v = add(this.vel, [this.yawRate * r[2], 0, -this.yawRate * r[0]]);
    const uf = dot(v, fwd), wf = dot(v, stbd);
    const sp = Math.hypot(uf, wf);
    const out = { point, f: [0, 0, 0], alpha: 0, load: 0 };
    if (sp < 0.05) return out;
    const alpha = Math.atan2(wf, Math.abs(uf));
    out.alpha = alpha;
    // Spin-out: the fin ventilates when overloaded, worse with the tail light,
    // high trim or the board rolled to windward.
    if (isFin) {
      const slope = (2 * Math.PI * aspect) / (aspect + 2);
      const demand = slope * Math.abs(alpha);
      const windwardRoll = this.roll * this.sailor.side / DEG;
      const tauDeg = hull.trim / DEG;
      // A board pressed onto its windward rail in a straight line loads the fin
      // badly; in a carve the board turns with the rail and it doesn't.
      const carving = smoothstep(0.2, 0.5, Math.abs(this.yawRate));
      const vent = 0.92 - 0.07 * Math.max(0, tauDeg - 4.5) - Math.min(0.3, 0.015 * Math.max(0, windwardRoll - 6)) * (1 - carving) -
        0.1 * this.waves.hsAt(this.pos[0], this.pos[2]) - (this.sailor.straps === 2 && this.sailor.leanX < -0.08 ? 0.08 : 0) -
        // (air dragged down the fin by a tail-first or high landing)
        0.35 * clamp((this.finAir ?? 0) / 0.45, 0, 1);
      this.finMargin = demand / Math.max(0.2, vent);
      // (spinning or carving a freestyle move the fin isn't what's gripping)
      const freestyle = this.state === S.TRICK && this.stateData.kind !== 'duck';
      if (!this.finVentilated && sp > 5 && demand > vent && HOLDS_BOOM.has(this.state) && !freestyle) {
        this.finVentilated = true;
        this.spinoutTime = 0;
        this.emit('spinout', 'Spin-out! The fin ventilated — sheet out and push on the front foot.', 2);
      }
      if (this.finVentilated) {
        this.spinoutTime += dt;
        if ((Math.abs(alpha) < 5 * DEG && this.spinoutTime > 0.35) || sp < 3) this.finVentilated = false;
      }
    }
    const { cl, cd } = foilPolar(alpha, aspect, isFin && this.finVentilated);
    const q = 0.5 * RHO_WATER * sp * sp;
    const vdir = [v[0] / sp, 0, v[2] / sp];
    // Lift perpendicular to the flow, opposing the sideways slip.
    let lift = [-vdir[2], 0, vdir[0]];
    if (dot(lift, stbd) * wf > 0) lift = scale(lift, -1);
    out.f = add(scale(lift, q * area * Math.abs(cl)), scale(vdir, -q * area * cd));
    out.load = q * area * Math.abs(cl);
    out.cl = cl;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Controls and state machine

  handleButtons(ctl, twa, speed) {
    const pr = ctl.pressed;
    const s = this.sailor;
    const st = this.state;
    // Crouched (LB held) a face button starts a freestyle move instead.
    if (st === S.SAILING && ctl.pop && !this.popBlock && (pr.flip || pr.tack || pr.straps || pr.hook)) {
      this.startTrick(pr.flip ? 'duck' : pr.tack ? 'heli' : pr.straps ? 'c360' : 'spock', twa, speed);
      return;
    }
    if (st === S.SAILING) {
      if (pr.hook) {
        if (s.hooked) { s.hooked = false; this.emit('hook', 'Unhooked'); }
        else if (ctl.sheet > 0.4) {
          const r = this.hookReach ?? this.solveBody().hookReach;
          if (!r.fits) this.emit('hookfail', "Can't reach the harness lines: sheet in, or lengthen the lines / lower the boom (Gear)");
          else if (s.beta > r.betaMax + 6 * DEG && !this.assists.autoHike) this.emit('hookfail', 'Too far out to reach the lines: come in a little (ease LT) to hook in');
          else {
            s.hooked = true;
            this.bodyGeo = null;
            this.emit('hook', 'Hooked in — hang your weight off the harness lines');
          }
        }
        else this.emit('hookfail', 'Sheet in to bring the harness lines within reach');
      }
      if (pr.straps) this.stepIntoStraps();
      if (pr.tack) this.startTack(twa, speed);
      if (pr.flip) this.startFlip();
      if (pr.drop) this.dropRig();
    } else if (st === S.SECURE) {
      if (pr.tack) this.startTack(twa, speed);
      if (pr.flip) {
        if (Math.abs(twa) > 115 * DEG) {
          s.side *= -1; this.rig.side *= -1; this.rig.boom = -this.rig.boom;
          this.emit('switch', 'Walked round the back of the mast — now on the other tack');
        } else this.emit('hint', 'Turn the board downwind first (rig forward) to swap sides');
      }
      if (pr.drop) this.dropRig();
    } else if (st === S.WATER) {
      if (pr.climb) {
        if (this.board.volume < this.totalMass * 0.98) {
          this.emit('sinker', 'This board is a sinker for you — it can\'t float you while standing still. Waterstart (hold LB).', 2);
        } else this.setState(S.CLIMB);
      }
    }
  }

  stepIntoStraps() {
    const s = this.sailor, b = this.board;
    if (s.straps >= 2) return;
    if (s.straps === 0) {
      if (s.x > b.frontStrapX + 0.22) {
        this.emit('straps', 'Move back toward the footstraps first (right stick down)');
        return;
      }
      s.straps = 1;
      s.x = (b.frontStrapX + b.backStrapX) / 2 + 0.1;
      this.emit('straps', 'Front foot in the strap');
    } else {
      s.straps = 2;
      s.x = (b.frontStrapX + b.backStrapX) / 2;
      this.emit('straps', 'Back foot in the strap');
    }
  }

  startTack(twa, speed) {
    const s = this.sailor;
    if (s.hooked) return this.emit('hint', 'Unhook before tacking (A)');
    if (s.straps > 0) return this.emit('hint', 'Take your feet out of the straps before tacking (hold X)');
    if (Math.abs(twa) > 70 * DEG) return this.emit('hint', 'Head up toward the wind first — rake the rig back');
    this.setState(S.TACK, { fromSide: s.side, switched: false, speed0: speed });
    this.emit('tack', 'Tacking — stepping round the front of the mast');
  }

  startFlip() {
    const s = this.sailor;
    if (s.hooked) {
      this.fall('leeward', 'You tried to flip the sail while hooked in. Wipeout!');
      return;
    }
    const r = this.rig;
    const d0 = r.boom;
    this.setState(S.FLIP, { d0, d1: r.side * 2 * Math.PI - d0, switched: false, T: 0.75 });
    s.straps = 0;
    this.emit('flip', 'Sail flip — clew round the front');
  }

  dropRig(why = 'Dropped the rig. Hold LB to uphaul') {
    this.sailor.hooked = false;
    this.sailor.straps = 0;
    this.setState(S.UPHAUL, { progress: 0 });
    this.rig.up = 0;
    this.emit('drop', why, 2);
  }

  fall(type, text) {
    if (this.assists.noFalls && type !== 'sink') return;
    if (this.state === S.FALLING || this.state === S.WATER) return;
    const s = this.sailor;
    s.hooked = false;
    s.straps = 0;
    s.fallType = type;
    this.finVentilated = false;
    this.setState(S.FALLING, { type, rig0: { ...this.rig } });
    const titles = { catapult: 'Catapult!', leeward: 'Pulled over', windward: 'Fell in to windward', sink: 'Sank', backwind: 'Backwinded', aground: 'Aground' };
    this.emit('fall', `${titles[type] ?? 'Wipeout'} — ${text}`, 3);
  }

  updateStateMachine(dt, ctl, twa, speed) {
    const s = this.sailor, r = this.rig, b = this.board;
    switch (this.state) {
      case S.SECURE:
        if (ctl.sheet > 0.3) {
          this.setState(S.SAILING);
          s.x = b.mastFootX - 0.38;
          s.beta = 4 * DEG;
          this.emit('sheet', 'Hands on the boom — sheeting in');
        }
        break;
      case S.TACK: {
        // Phase 1: rig back, sail sheeted in, feet pushing the board round until
        // the nose passes through the wind. Then step round and bear away.
        const d = this.stateData;
        const windSide = Math.sign(twa);
        const crossed = windSide !== d.fromSide || Math.abs(twa) < 6 * DEG;
        if (!d.switched) {
          if (crossed && this.stateTime > 0.45) {
            if (b.volume < this.totalMass + 10 && speed < 1.6) {
              this.fall('sink', 'Too little volume to tack slowly — this board needs a gybe.');
              return;
            }
            d.switched = true;
            d.switchTime = this.stateTime;
            s.side *= -1;
            r.side *= -1;
            r.boom = -r.boom;
            this.prevPoints = null;
            this.emit('tackstep', 'Nose through the wind — stepping round');
          } else if (this.stateTime > 3.2) {
            this.fall('windward', 'You stalled head to wind (in irons) and lost your balance. Keep the sail sheeted in and the rig back.');
            return;
          }
        } else if (this.stateTime - d.switchTime > 0.9) {
          this.setState(ctl.sheet > 0.3 ? S.SAILING : S.SECURE);
          s.x = b.mastFootX - 0.38;
          this.emit('tackdone', 'Tack complete');
        }
        break;
      }
      case S.FLIP: {
        const d = this.stateData;
        const ph = clamp(this.stateTime / d.T, 0, 1);
        const e = ph * ph * (3 - 2 * ph);
        r.boom = lerp(d.d0, d.d1, e);
        if (!d.switched && ph >= 0.5) {
          d.switched = true;
          s.side *= -1;
          r.side *= -1;
          s.beta = clamp(-0.5 * s.beta, -12 * DEG, 12 * DEG); // lean is measured from the new windward side now
          s.betaRate = 0;
          s.x = Math.min(s.x, b.frontStrapX + 0.1);
        }
        if (ph >= 1) {
          r.boom = wrapAngle(r.boom);
          this.setState(S.SAILING);
          this.emit('flipdone', 'Sail flipped — sheet in on the new tack');
        }
        break;
      }
      case S.FALLING: {
        const T = 0.9;
        r.up = Math.max(0, 1 - this.stateTime / T);
        if (this.stateTime >= T) {
          r.up = 0;
          this.setState(S.WATER);
        }
        break;
      }
      case S.WATER:
        r.up = 0;
        if (ctl.uphaul) {
          this.setState(S.WATERSTART, { phase: 'clear', progress: 0, lift: 0, weak: 0 });
          this.emit('ws', 'Waterstart: clearing the rig…');
        }
        break;
      case S.CLIMB:
        if (this.stateTime > 1.4) {
          this.setState(S.UPHAUL, { progress: 0 });
          s.x = b.mastFootX - 0.15;
          this.emit('climb', 'On the board. Hold LB to pull up the uphaul');
        }
        break;
      case S.UPHAUL: {
        const d = this.stateData;
        const kn = this.wind.speedKn;
        const rate = (0.42 / Math.sqrt(this.sail.area / 6)) * (1 - 0.35 * smoothstep(16, 28, kn));
        if (ctl.uphaul) d.progress += rate * dt;
        else d.progress = Math.max(0, d.progress - 0.5 * dt);
        r.up = d.progress;
        if (d.progress >= 1) {
          this.setState(S.SECURE);
          r.up = 1;
          this.emit('secure', 'Secure position. Sheet in (RT) to start sailing');
        }
        break;
      }
      case S.WATERSTART: {
        const d = this.stateData;
        if (!ctl.uphaul) {
          this.setState(S.WATER);
          break;
        }
        if (d.phase === 'clear') {
          const clearTime = 0.9 + this.sail.area * 0.12;
          d.progress += dt / clearTime;
          r.up = 0.6 * d.progress;
          if (d.progress >= 1) {
            d.phase = 'power';
            r.up = 1;
            this.emit('ws', 'Rig clear. Steer the board across the wind, then sheet in to get lifted');
          }
        } else {
          r.up = 1;
          // Held up into the wind, the sail works like a kite: its pull tows you
          // and levers you up over the board. That needs the sail filled (not
          // luffing, not backwinded) and the board across the wind.
          const wv = this.wind.sample(this.pos[0], 2.2, this.pos[2], this.t);
          const q = 0.5 * RHO_AIR * (wv[0] * wv[0] + wv[2] * wv[2]);
          const aDeg = this.aero ? this.aero.alphaMid / DEG : 0;
          const fill = smoothstep(5, 25, aDeg) * (1 - smoothstep(80, 115, aDeg));
          const across = smoothstep(35, 60, Math.abs(twa) / DEG) * (1 - smoothstep(140, 165, Math.abs(twa) / DEG));
          const lift = q * this.sail.area * 0.7 * fill * across;
          const need = 0.11 * this.sailorMass * G;
          d.lift = lift;
          if (lift > need) d.liftProgress = (d.liftProgress ?? 0) + dt / 0.6;
          else d.liftProgress = Math.max(0, (d.liftProgress ?? 0) - dt * 0.6);
          if (ctl.sheet > 0.85 && lift < need * 0.6) d.weak += dt;
          if (d.weak > 3.5) {
            this.emit('wsweak', 'Not enough wind to waterstart. Press A to climb on and uphaul instead.', 2);
            d.weak = 0;
          }
          if (d.liftProgress >= 1) {
            this.setState(S.RISING);
            this.emit('ws', 'The sail lifts you out of the water');
          }
        }
        break;
      }
      case S.TRICK:
        this.updateTrick(dt, ctl, twa, speed);
        break;
      case S.RISING:
        if (this.stateTime > 0.7) {
          this.setState(S.SAILING);
          s.x = b.mastFootX - 0.55;
          s.beta = 22 * DEG;
          s.betaRate = 0;
        }
        break;
      default:
        break;
    }
  }

  updateRig(dt, ctl, twa) {
    const r = this.rig, s = this.sailor, st = this.state;
    const rateRake = 115 * DEG * dt;
    const boomOpen = (sheet) => (3 + 92 * Math.pow(1 - clamp(sheet, 0, 1), 1.25)) * DEG;
    const flagAngle = (tipped = false) => {
      // Boom angle at which the sail streams like a flag in the apparent wind
      // (board motion only; the rig's own motion is ignored here). With the
      // rig thrown well forward (the sail let go in a carving 360) the boom
      // turns about a tipped mast, so it's the wind across the mast that
      // counts, at the middle of the sail wherever that's gone.
      const R = boardMatrix(this.yaw, this.pitch, this.roll);
      const ax = tipped ? rigAxes(r.rake, r.lean, 0) : null;
      const ceB = tipped ? add([this.board.mastFootX, 0, 0], add(scale(ax.m, 2.2), scale(ax.ap, 0.6))) : [this.board.mastFootX - 0.6, 2.2, 0];
      const ce = add(this.pos, mulMV(R, ceB));
      const rC = sub(ce, this.pos);
      const vCe = add(this.vel, [this.yawRate * rC[2], 0, -this.yawRate * rC[0]]);
      const awB = mulMtV(R, sub(this.wind.sample(ce[0], tipped ? Math.max(0.5, ce[1]) : 2.3, ce[2], this.t), vCe));
      return tipped ? Math.atan2(dot(awB, ax.qp), dot(awB, ax.ap)) : Math.atan2(-awB[2], -awB[0]);
    };
    if (st === S.SAILING) {
      // Hooked in and hanging off the harness lines in the straps, the stance
      // itself pulls the rig back toward the tail; that is the neutral position.
      const neutral = -3 - 9 * (s.hooked ? 1 : 0.35) * (s.straps / 2);
      // (the rig sits on a universal joint: you hold it steady while the
      // board pitches over the waves underneath it)
      const wavePitch = (this.pitch - (this.hull?.trim ?? this.pitch)) * smoothstep(0.6, 1, this.hull?.planing ?? 0);
      const rakeCmd = (neutral + ctl.rake * (ctl.rake > 0 ? 34 : 24)) * DEG + clamp((s.give ?? 0) / 250, 0, 1) * 22 * DEG - 0.8 * wavePitch;
      // Hanging on the boom with more weight than the sail is pulling brings
      // the rig over toward you; a rig leaned out of reach comes back in; and
      // a rig pulling forward harder than you can hold tips forward.
      const leanCmd = ctl.lean * 34 * DEG + s.side * (clamp(s.hang / 900, 0, 1) * 45 * DEG - (s.reachIn ?? 0) * 1.5);
      let sheet = ctl.sheet;
      if (s.gripLost > 0) sheet *= 0.45; // the back hand slips: the sail opens and dumps power
      // (back hand off the boom: the sail flags out; taking hold again, you sheet back in over a second)
      if (s.backOff > 0) sheet = 0;
      else if (s.regrab < 1) sheet = Math.min(sheet, 0.15 + 0.85 * s.regrab);
      // Hooked in with the lines off the balance point, the hands can't hold
      // the boom quite where you want it: a heavy back hand lets the sail
      // open, a heavy front hand lets it sheet in on you.
      const c = s.hooked ? this.hands?.couple ?? 0 : 0;
      if (c) sheet = clamp(sheet - (c > 0 ? 0.3 : 0.2) * c / (250 + 400 * s.stamina), 0, 1);
      let open = boomOpen(sheet);
      let rakePump = 0;
      if (ctl.pump && s.stamina > 0.05) {
        s.pumpPhase += dt * 2 * Math.PI * 1.35;
        const k = clamp(s.stamina * 1.6, 0.3, 1);
        open = Math.max(2 * DEG, open - k * 18 * DEG * (0.5 - 0.5 * Math.cos(s.pumpPhase)));
        rakePump = -k * 5 * DEG * Math.sin(s.pumpPhase);
      }
      // The back hand works like a sheet rope: it limits how far the boom can
      // open, the wind pushes it out to that limit (or to where it flags).
      const fa = flagAngle();
      if (Math.sign(fa) === r.side) open = Math.min(open, Math.abs(fa));
      const target = r.side * open;
      const load = clamp(this.handForce / 900, 0, 0.75);
      const inRate = (110 * (1 - load) + (ctl.pump ? 120 : 0)) * DEG;
      const outRate = (s.gripLost > 0 ? 260 : 150) * DEG;
      const sheetingIn = Math.abs(target) < Math.abs(r.boom);
      r.boom = servo(r.boom, target, ctl.pump ? 16 : 7, sheetingIn ? inRate : outRate, dt);
      r.rake = servo(r.rake, rakeCmd + rakePump, ctl.pump ? 14 : 6, 115 * DEG * (ctl.pump ? 2 : 1), dt);
      r.lean = servo(r.lean, leanCmd, 6, 115 * DEG, dt);
      r.up = 1;
    } else if (st === S.SECURE) {
      r.rake = servo(r.rake, ctl.rake * 26 * DEG, 5, 115 * DEG, dt);
      r.lean = servo(r.lean, -s.side * 6 * DEG + ctl.lean * 12 * DEG, 5, 115 * DEG, dt);
      const fa = flagAngle();
      r.boom = servo(r.boom, fa, 6, 200 * DEG, dt);
      r.side = r.boom >= 0 ? 1 : -1;
      r.up = 1;
    } else if (st === S.TACK) {
      if (!this.stateData.switched) {
        // Rig swept back over the tail and held sheeted in: the sail drives the
        // nose up through the wind while you move to the front of the mast.
        r.rake = servo(r.rake, (-26 + ctl.rake * 8) * DEG, 5, 115 * DEG, dt);
        r.boom = servo(r.boom, r.side * 6 * DEG, 6, 200 * DEG, dt);
      } else {
        // (held back until you've stepped back behind the mast, then forward to bear away)
        const back = smoothstep(0.3, 0.65, this.stateTime - (this.stateData.switchTime ?? 0));
        r.rake = servo(r.rake, lerp(-10, 18 + ctl.rake * 10, back) * DEG, 5, 115 * DEG, dt);
        let open = boomOpen(Math.max(ctl.sheet, 0.25));
        const fa = flagAngle();
        if (Math.sign(fa) === r.side) open = Math.min(open, Math.abs(fa));
        r.boom = servo(r.boom, r.side * open, 6, 200 * DEG, dt);
      }
      r.lean = servo(r.lean, 0, 5, 115 * DEG, dt);
    } else if (st === S.FLIP) {
      r.rake = servo(r.rake, (8 + ctl.rake * 16) * DEG, 5, 115 * DEG, dt);
      r.lean = servo(r.lean, ctl.lean * 30 * DEG, 5, 115 * DEG, dt);
    } else if (st === S.FALLING) {
      const r0 = this.stateData.rig0;
      const k = 1 - r.up;
      r.lean = lerp(r0.lean, -s.side * 86 * DEG, k);
      r.rake = lerp(r0.rake, 0, k);
    } else if (st === S.WATER || st === S.CLIMB) {
      r.lean = approach(r.lean, -s.side * 86 * DEG, 90 * DEG * dt);
      r.rake = approach(r.rake, 0, 60 * DEG * dt);
      r.boom = approach(r.boom, 0, 60 * DEG * dt);
    } else if (st === S.UPHAUL) {
      r.lean = -s.side * 86 * DEG * (1 - this.stateData.progress);
      r.rake = approach(r.rake, 0, rateRake);
      r.boom = approach(r.boom, r.side * 70 * DEG, 90 * DEG * dt);
    } else if (st === S.WATERSTART) {
      const d = this.stateData;
      if (d.phase === 'clear') {
        r.lean = lerp(-s.side * 86 * DEG, s.side * 44 * DEG, d.progress);
        r.boom = approach(r.boom, r.side * 80 * DEG, 120 * DEG * dt);
      } else {
        r.lean = servo(r.lean, s.side * 44 * DEG + ctl.lean * 16 * DEG, 5, 115 * DEG, dt);
        r.rake = servo(r.rake, ctl.rake * 30 * DEG, 5, 115 * DEG, dt);
        r.boom = servo(r.boom, r.side * boomOpen(ctl.sheet), 6, 150 * DEG, dt);
      }
    } else if (st === S.RISING) {
      r.lean = approach(r.lean, s.side * 10 * DEG, 80 * DEG * dt);
    } else if (st === S.TRICK) {
      this.trickRig(dt, ctl, flagAngle, boomOpen);
    }
    void twa;
  }

  updateStance(dt, ctl) {
    const s = this.sailor, b = this.board;
    this.updateKnees(dt, ctl);
    if (this.state !== S.SAILING) {
      // (in the middle of a freestyle move you can still shift your weight, not step)
      const shift = this.state === S.TRICK ? ctl.weight * (s.straps === 2 ? 0.2 : 0.14) : 0;
      s.leanX = damp(s.leanX, shift, this.state === S.TRICK ? 8 : 6, dt);
      return;
    }
    // Small stick deflection = shift weight; past ~55% = step along the board.
    s.leanX = damp(s.leanX, ctl.weight * (s.straps === 2 ? 0.2 : 0.14), 8, dt);
    if (s.straps === 0 && Math.abs(ctl.weight) > 0.55) {
      const v = Math.sign(ctl.weight) * ((Math.abs(ctl.weight) - 0.55) / 0.45) * 0.9;
      s.x = clamp(s.x + v * dt, b.backStrapX + 0.02, b.mastFootX - 0.22);
    }
    if (ctl.strapsHeld) {
      s.strapsHoldTime += dt;
      if (s.strapsHoldTime > 0.1 && s.straps > 0) {
        s.straps = 0;
        this.emit('straps', 'Feet out of the straps');
      }
    } else s.strapsHoldTime = 0;
  }

  // ---------------------------------------------------------------------------
  // Freestyle

  /**
   * Start a freestyle move (LB held, plus a face button). Each needs the
   * right speed, course and stance; without them you're told why instead.
   *   duck  — duck gybe: carving downwind, the rig is thrown across over your
   *           head (the clew passes behind you) instead of round the front.
   *   heli  — helitack: luff up through the wind, the board sails backwards
   *           while the sail spins round the mast, and you sail off on the
   *           new tack without stepping round the front of the mast.
   *   c360  — carving 360: a full carved circle on the rail, through
   *           downwind and back up through the wind, with the sail let go.
   *   spock — the board spins a full turn on its nose, you and the rig
   *           turning with it.
   */
  startTrick(kind, twa, speed) {
    const s = this.sailor, p = this.hull?.planing ?? 0, at = Math.abs(twa) / DEG;
    const no = (msg) => { this.emit('hint', msg); };
    let data;
    if (kind === 'duck') {
      if (s.hooked) return this.fall('leeward', 'you tried to duck the sail while hooked in. Unhook first (A).');
      if (p < 0.7 || speed < 5) return no('Duck gybes are done on the plane: carve in at full speed, then duck.');
      if (at < 105) return no("Carve away from the wind first: duck the sail once you're heading well downwind.");
      if (at > 172) return no('Too late to duck: flip the sail instead (Y).');
      data = { kind, d0: this.rig.boom, fromSide: s.side, switched: false };
    } else if (kind === 'heli') {
      if (s.hooked) return no('Unhook first (A): a helitack is sailed with your hands on the boom.');
      if (s.straps > 0) return no('Feet out of the straps first (hold X).');
      if (at > 80) return no('Head up to a close reach first (rig back): a helitack starts by luffing up through the wind.');
      if (speed < 2.5) return no('A helitack needs some speed to carry the board through the wind.');
      data = { kind, phase: 'luff', fromSide: s.side, switched: false, turn: -s.side };
    } else if (kind === 'c360') {
      if (s.hooked) return no('Unhook first (A): you need to let the sail go in the turn.');
      if (p < 0.85 || speed < 6) return no('Carving 360s need full speed on the plane going in.');
      if (at < 70 || at > 140) return no('Start a carving 360 from a reach.');
      data = { kind, dir: s.side, turned: 0, bank: 18 * DEG, v0: speed };
    } else {
      if (s.hooked) return this.fall('catapult', 'a spock while hooked in: the rig yanked you over the front. Unhook first (A).');
      if (p < 0.8 || speed < 5.5) return no('A spock needs speed: plane in, then spin.');
      if (at > 120) return no('Start a spock from a beam or close reach.');
      if (s.leanX < 0.02) return no('Weight on your front foot (right stick up): the nose has to bite for the board to spin on it.');
      const nx = this.board.length * 0.5 - 0.3;
      const fwd = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
      data = {
        kind, turn: -s.side, turned: 0, nx, v0: speed, boom0: this.rig.boom, yaw0: this.yaw,
        nose: [this.pos[0] + fwd[0] * nx, this.pos[2] + fwd[2] * nx], omega0: clamp(speed / 1.6, 3.2, 6.5),
      };
    }
    s.crouch = 0;
    if (kind !== 'c360') s.straps = 0;
    this.setState(S.TRICK, data);
    this.emit('trick', `${TRICKS[kind].name}…`, 1);
  }

  /** How much of the sail's pull reaches you during a move. */
  trickTransmit() {
    const d = this.stateData;
    if (d.kind === 'duck') return 0.3;
    if (d.kind === 'heli') return d.phase === 'luff' ? 0.3 : 0.1;
    if (d.kind === 'c360') return d.turned < 75 * DEG || d.turned > 300 * DEG ? 0.6 : 0.1;
    return 0;
  }

  /** The yaw moment (N·m) your feet and the rig put on the board through a move. */
  trickTorque(Iz, speed) {
    const d = this.stateData, ctl = this.lastControls ?? {};
    void Iz;
    if (d.kind === 'c360') {
      // Carving: the sunk rail holds a radius; the harder it's sunk, the tighter.
      const rail = clamp(-(ctl.rail ?? 0) * d.dir, 0, 1);
      d.bank = (12 + 16 * rail) * DEG;
      d.radius = 5 + 7 * (1 - rail);
    }
    return 0;
  }

  /** Motion a move takes over from the forces: a carve's grip, a spin on the nose. */
  trickMotion(dt) {
    const d = this.stateData;
    const fwd = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    if (d.kind === 'heli') {
      // Luffing up, carving on the windward rail with the rig right back and
      // sheeted in; then, sailing backwards, the rig pushed round and your
      // feet keep the board spinning.
      const sp = Math.hypot(this.vel[0], this.vel[2]);
      const rate = d.phase === 'luff' ? Math.max(0.8, Math.min(1.4, sp / 6)) : 1.3;
      this.yawRate = damp(this.yawRate, d.turn * rate, 6, dt);
    } else if (d.kind === 'c360') {
      // The rail grips: the board goes where it points, and the turn costs speed.
      const sp = Math.hypot(this.vel[0], this.vel[2]);
      if (sp < 0.1) return;
      // The rail holds the board on its radius: it turns at its speed over
      // the radius (the water, not the fin, steering it now).
      this.yawRate = damp(this.yawRate, d.dir * sp / (d.radius ?? 8), 20, dt);
      const k = 1 - Math.exp(-dt / 0.08);
      const vx = lerp(this.vel[0] / sp, fwd[0], k), vz = lerp(this.vel[2] / sp, fwd[2], k);
      const n = Math.hypot(vx, vz) || 1;
      const sp2 = Math.max(0, sp - 0.07 * sp * sp / (d.radius ?? 8) * dt);
      this.vel = [vx / n * sp2, 0, vz / n * sp2];
      d.turned += Math.max(0, this.yawRate * d.dir) * dt;
    } else if (d.kind === 'spock') {
      // Pivoting on the nose: it bites and holds; the tail swings round it,
      // slowing as the spin bleeds off the speed it started with.
      const om = d.omega0 * Math.sqrt(Math.max(0.08, 1 - d.turned / (2 * Math.PI * 1.15)));
      d.turned = Math.min(2 * Math.PI, d.turned + om * dt);
      this.yaw = wrapAngle(d.yaw0 + d.turn * d.turned);
      this.yawRate = d.turn * om;
      const f = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
      this.pos[0] = d.nose[0] - f[0] * d.nx;
      this.pos[2] = d.nose[1] - f[2] * d.nx;
      // (the middle of the board swinging round the nose)
      this.vel = [-this.yawRate * f[2] * d.nx, 0, this.yawRate * f[0] * d.nx];
    }
  }

  /** The rig through a move. */
  trickRig(dt, ctl, flagAngle, boomOpen) {
    const d = this.stateData, r = this.rig, t = this.stateTime;
    if (d.kind === 'duck') {
      // Thrown forward and across: the boom sweeps through the middle,
      // over your head, to the new side; then you catch it and sheet in.
      if (t < 0.85) {
        const e = smoothstep(0.08, 0.8, t);
        r.boom = lerp(d.d0, -0.85 * d.d0, e);
      } else r.boom = servo(r.boom, r.side * boomOpen(ctl.sheet), 6, 160 * DEG, dt);
      // (raked well forward as it goes over, so the boom passes high over your head)
      r.rake = servo(r.rake, (t < 0.8 ? 30 : 10) * DEG, 6, 140 * DEG, dt);
      r.lean = servo(r.lean, ctl.lean * 20 * DEG, 5, 115 * DEG, dt);
    } else if (d.kind === 'heli') {
      if (d.phase === 'luff') {
        // Rig back and sheeted in: the sail drives the nose up through the wind.
        r.rake = servo(r.rake, (-26 + ctl.rake * 8) * DEG, 5, 115 * DEG, dt);
        r.boom = servo(r.boom, r.side * 8 * DEG, 6, 200 * DEG, dt);
      } else {
        // The helicopter: the sail spins round the mast, clew round the front.
        const e = smoothstep(0, 1, (t - d.spinT) / 1.1);
        r.boom = lerp(d.boom0, d.fromSide * (2 * Math.PI - 60 * DEG), e);
        if (e >= 1) r.boom = wrapAngle(r.boom);
        r.rake = servo(r.rake, 12 * DEG, 4, 115 * DEG, dt);
      }
      r.lean = servo(r.lean, 0, 5, 115 * DEG, dt);
    } else if (d.kind === 'c360') {
      // Powered into the turn; the back hand lets go through downwind and up
      // through the wind (the sail streams like a flag, the rig held up by
      // the mast and thrown forward so the boom swings high over your head);
      // then you catch it again.
      const free = d.turned > 75 * DEG && d.turned < 300 * DEG;
      const fa = flagAngle(free);
      const target = free ? r.boom + wrapAngle(fa - r.boom) : r.side * boomOpen(ctl.sheet);
      r.boom = servo(r.boom, target, free ? 10 : 6, (free ? 300 : 160) * DEG, dt);
      if (!free) r.boom = wrapAngle(r.boom);
      // (thrown forward while it's free, back up to catch it as you come up through the wind)
      const rake = d.turned < 75 * DEG ? 15 : free ? lerp(36, 5, smoothstep(240 * DEG, 300 * DEG, d.turned)) : 5;
      r.rake = servo(r.rake, rake * DEG, 4, 115 * DEG, dt);
      r.lean = servo(r.lean, r.side * (free ? -12 : 12) * DEG, 4, 115 * DEG, dt); // (let go, it leans into the turn, away from you)
    } else {
      // Held as it was going in, turning with you as the board spins under you both.
      r.boom = servo(r.boom, d.boom0, 6, 200 * DEG, dt);
      r.rake = servo(r.rake, 12 * DEG, 5, 115 * DEG, dt);
      r.lean = servo(r.lean, 0, 5, 115 * DEG, dt);
    }
    r.up = 1;
  }

  /** Phases, the way out, and what goes wrong. */
  updateTrick(dt, ctl, twa, speed) {
    const d = this.stateData, s = this.sailor, r = this.rig, t = this.stateTime, at = Math.abs(twa) / DEG;
    const b = this.board;
    const done = (msg) => {
      r.boom = wrapAngle(r.boom);
      if (d.kind === 'spock') {
        const f = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
        const v = Math.max(1.2, 0.2 * d.v0);
        this.vel = [f[0] * v, 0, f[2] * v];
        this.yawRate = 0;
      }
      if (d.kind === 'heli' || d.kind === 'spock') s.x = b.mastFootX - 0.42;
      else s.x = Math.min(s.x, b.frontStrapX + 0.1);
      this.setState(S.SAILING);
      this.lastTrick = { kind: d.kind, t: this.t, kn: Math.hypot(this.vel[0], this.vel[2]) * MS_TO_KN };
      this.emit('trickdone', msg, 2);
    };
    const flipSides = () => {
      d.switched = true;
      s.side *= -1;
      r.side *= -1;
      s.beta = clamp(-0.4 * s.beta, -10 * DEG, 10 * DEG);
      s.betaRate = 0;
    };
    if (d.kind === 'duck') {
      if (!d.switched && Math.sign(r.boom) !== Math.sign(d.d0)) {
        // The clew passes over your head. Downwind, the wind's behind the
        // sail as it comes over; too early, it fills from the wrong side.
        const still = Math.sign(twa) === d.fromSide;
        if (still && at < 125) return this.fall('backwind', 'you ducked too early: the board wasn\'t far enough downwind, so the wind filled the sail from the wrong side as it came over. Carve deeper before you duck.');
        if (!still && at < 140) return this.fall('backwind', 'you ducked too late: already heading up on the new tack, the sail was backwinded before you got under it. Duck as the board goes through downwind.');
        flipSides();
      }
      if (t > 1.05) done(`Duck gybe! Out at ${(speed * MS_TO_KN).toFixed(1)} knots`);
    } else if (d.kind === 'heli') {
      if (d.phase === 'luff') {
        const crossed = Math.sign(twa) !== d.fromSide || at < 8;
        if (crossed && t > 0.3) { d.phase = 'spin'; d.spinT = t; d.boom0 = r.boom; }
        else if (t > 3) return this.fall('windward', 'you stalled head to wind: a helitack needs speed and a quick luff up, rig right back, to carry the board through.');
      } else {
        const e = (t - d.spinT) / 1.1;
        if (!d.switched && e >= 0.5) flipSides();
        if (e >= 1 && Math.sign(twa) === -d.fromSide && at > 55) done('Helitack!');
        else if (t - d.spinT > 4.5) return this.fall('windward', 'the board stopped turning: keep the rig pushed forward and round while it sails backwards.');
      }
    } else if (d.kind === 'c360') {
      if (d.turned >= 350 * DEG) done(`Carving 360! Out at ${(speed * MS_TO_KN).toFixed(1)} knots`);
      else if (speed < 1.8 && d.turned < 300 * DEG) return this.fall('windward', 'you ran out of speed in the turn and stalled head to wind. Go in at full speed and sink the rail hard (right stick) for a tight carve.');
    } else if (d.kind === 'spock') {
      if (d.turned >= 2 * Math.PI - 1e-6) done('Spock!');
      else if (s.leanX < -0.03 && d.turned < Math.PI) return this.fall('windward', 'your weight went back and the tail bit: the spin stalled and you fell in. Keep pressing the nose down.');
    }
  }

  /**
   * Battens. Each strip's camber stays popped to one side until the wind
   * presses on its convex side hard enough to push the battens through:
   * then it snaps across (a clack you can hear), and the strip pulls the
   * other way. After a tack or a sail flip they pop as the sail fills on
   * the new side; backwinded hard, they pop and the sail drives you in.
   */
  updateBattens(dt, aero) {
    const r = this.rig;
    if (!aero) return;
    for (let i = 0; i < r.cam.length; i++) {
      const st = aero.strips[i];
      if (!st) continue;
      const on = r.cam[i] >= 0 ? 1 : -1;
      if (st.press > BATTEN_PRESS && r.camTo[i] === on) r.camTo[i] = -on;
      const before = r.cam[i];
      r.cam[i] = approach(r.cam[i], r.camTo[i], (2 / BATTEN_T) * dt);
      if ((before >= 0) !== (r.cam[i] >= 0)) this.battenPop = { t: this.t, i, to: r.camTo[i] };
    }
  }

  /**
   * The wind under a flying board (N, upward): the bottom is a small, very
   * low-aspect flat plate. With the nose or the windward rail lifted into the
   * apparent wind it carries a little of your weight; falling flat, it
   * brakes the drop a touch.
   */
  boardAirLift(b) {
    const R = boardMatrix(this.yaw, this.pitch, this.roll);
    const n = mulMV(R, [0, 1, 0]);
    const wv = this.wind.sample(this.pos[0], 0.6, this.pos[2], this.t);
    const aw = [wv[0] - this.vel[0], -this.heaveVel, wv[2] - this.vel[2]];
    const sp = Math.hypot(aw[0], aw[1], aw[2]);
    if (sp < 1) return 0;
    const sinA = dot(aw, n) / sp; // + = air striking the bottom
    const area = 0.72 * b.length * b.width;
    const ar = b.width * b.width / area;
    const cn = Math.sign(sinA) * ((Math.PI * ar / 2) * Math.abs(sinA) + 2 * sinA * sinA);
    return 0.5 * RHO_AIR * sp * sp * area * cn * n[1];
  }

  /**
   * Jumping. Hold the pop button to crouch (knees soft, soaking up the chop
   * and loading up), let go to pop: the legs drive the board down and off
   * the water, and stiff legs take the whole kick of the chop face you're
   * on instead of soaking it up. Popped as the tail climbs a steep face, the
   * two add up and the board flies; on flat water it's a little hop. You
   * need speed (planing) and both feet in the straps to take the board with
   * you. In the air you pull your knees up, which lifts the board under you.
   */
  updateKnees(dt, ctl) {
    const s = this.sailor;
    const sailing = this.state === S.SAILING;
    if (this.popT !== undefined) this.popT += dt;
    // (a pop that never left the water was just a bounce)
    if (this.popT !== undefined && !this.airborne && this.popT > POP_T + 0.4) this.popT = undefined;
    if (!sailing) this.popT = undefined;
    const popping = this.popT !== undefined && this.popT < POP_T;
    // (the same button uphauls and waterstarts: still held from that, it isn't a crouch)
    if (!sailing) this.popBlock = !!ctl.pop;
    else if (!ctl.pop) this.popBlock = false;
    if (sailing && ctl.pop && !this.popBlock && !this.airborne) s.crouch = Math.min(1, s.crouch + dt / CROUCH_T);
    else if (s.crouch > 0 && !(sailing && ctl.pop)) {
      if (sailing && !this.airborne) {
        const p = this.hull?.planing ?? 0;
        if (s.straps < 2) this.emit('hint', 'Both feet in the straps to jump: the straps are how you take the board with you (X)');
        else if (p < 0.6) this.emit('hint', 'Get planing first: a jump needs speed');
        else {
          this.popT = 0;
          this.popK = (0.35 + 0.65 * s.crouch) * smoothstep(0.6, 0.9, p);
          this.popStart = this.t;
        }
      }
      s.crouch = 0;
    }
    // Knees: bent in the crouch, straightening through the pop, tucked up in
    // the air after a jump, absorbing the landing.
    const jumping = this.popT !== undefined && this.airborne;
    const target = !sailing || popping ? 0 : jumping ? 0.14 : 0.16 * s.crouch;
    const prev = s.knees;
    s.knees = damp(s.knees, target, popping ? 30 : this.airborne ? 6 : 10, dt);
    // Flying, the board is light against your body: pulling your knees up
    // lifts it (and pushing your feet down before landing lowers it).
    if (this.airborne) this.pos[1] += (s.knees - prev) * 0.49 * this.sailorHeight * 0.9;
  }

  /**
   * Heave, pitch and roll on the chop. The water only pushes: floating, the
   * hull rides the average surface along its length; planing, it rides on
   * the patch of tail carrying it. A chop face rising under a fast board
   * (its slope times your speed, plus the wave's own motion) throws it up,
   * and if the water then drops away faster than gravity can follow, the
   * board flies until it lands again. The nose meets the faces of the chop
   * ahead: pointing up at them it skims over, nose-down to the water it
   * digs in and the board stops dead (see noseDrag).
   */
  updateAttitude(dt, ctl, hull, waterY, sailorOnBoard, u = 0, aeroUp = 0) {
    const b = this.board;
    const p = hull.planing;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const surf = (x) => this.waves.height(this.pos[0] + fx * x, this.pos[2] + fz * x, this.t);
    const half = b.length * 0.42;
    const hN = surf(half), hT = surf(-half);
    const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
    const hS = this.waves.height(this.pos[0] + sx * 0.4, this.pos[2] + sz * 0.4, this.t);
    const hP = this.waves.height(this.pos[0] - sx * 0.4, this.pos[2] - sz * 0.4, this.t);
    const waveSlope = Math.atan2(hN - hT, 2 * half);
    const waveRoll = Math.atan2(hP - hS, 0.8);

    // Where the water carries the board: its length when floating, the
    // planing patch on the tail when planing. The patch rides the surface
    // averaged over its wetted length, which smooths out ripples shorter
    // than it, and your legs soak up much of the rest.
    const wet = clamp(hull.lambda * hull.beam, 0.5, 0.7 * b.length);
    const x0 = b.transomX + 0.05;
    let sC = 0, vC = 0;
    const NS = 5;
    for (let i = 0; i < NS; i++) {
      const x = x0 + wet * (i + 0.5) / NS;
      sC += surf(x) / NS;
      vC += this.waves.verticalVelocity(this.pos[0] + fx * x, this.pos[2] + fz * x, this.t) / NS;
    }
    const slopeC = (surf(x0 + wet) - surf(x0)) / wet;
    const xc = lerp(-0.05 * b.length, x0 + wet / 2, smoothstep(0.3, 0.9, p));
    const surfH = lerp((hN + hT) / 2, sC, p);
    // How fast that surface rises under you: the wave's own motion plus its
    // slope times your speed. Soft knees soak up most of it (more crouched);
    // popping, stiff legs take all of it.
    const popping = this.popT !== undefined && this.popT < POP_T;
    const legs = popping ? 1 : LEGS * (1 - 0.35 * this.sailor.crouch);
    const vS = lerp(0, vC + u * slopeC, p) * legs;
    const tp = Math.tan(this.pitch);
    const zC = this.pos[1] + xc * tp;
    const zCdot = this.heaveVel + xc * this.pitchRate;
    const imm = surfH - zC; // how far the bottom is below the surface there

    // Heave: draft from displaced volume, lifting out as the board planes.
    const V = b.volume / 1000;
    const draftDisp = (hull.submerged / (0.72 * b.length * b.width)) + Math.max(0, hull.sinking) / (b.length * b.width * 0.6);
    const draft = lerp(Math.min(draftDisp, V / (b.length * b.width * 0.55) + 0.3), 0.012, p);
    // The sail's lift (rig leaned to windward) unweights the whole system.
    const gEff = clamp(G - aeroUp / this.totalMass, 3, 12);
    // Floating, buoyancy over the waterplane; planing, the change in lift as
    // the wetted length and the flow angle change (soft, and well damped).
    const k = lerp(140, 100, p), c = lerp(20, 17, p);
    const touching = imm > -0.004;
    // (the pop: your legs driving the board down against the water)
    const popPush = popping && touching ? POP_ACC * this.popK : 0;
    let push = touching ? Math.max(0, gEff + k * (imm - draft) + c * (vS - zCdot)) + popPush : 0;
    // Flying, the wind gets under the board: a little lift with the nose (or
    // the windward rail) up into the apparent wind.
    if (!touching && sailorOnBoard) push += this.boardAirLift(b) / this.totalMass;
    // Slamming over the chop draws its energy from your speed: the power
    // the water damps out of the bouncing, as drag. Popping off a face is
    // different: stiff legs turn some of your speed into the climb, without
    // the slamming, and driving the board down into the water loads the
    // planing surface, so its drag goes up with the lift for that moment.
    this.slamDrag = touching && sailorOnBoard ? (popping ? this.totalMass * Math.max(0, c * (vS - zCdot) * zCdot) :
      0.7 * p * this.totalMass * c * (vS - zCdot) ** 2) / Math.max(3, Math.abs(u)) + hull.drag * popPush / gEff : 0;
    this.dbgChop = { imm, draft, vS, zCdot, push, gEff, k, slopeC, sC, wet, pitch: this.pitch, xc };
    this.heaveVel += (push - gEff) * dt;
    this.pos[1] += this.heaveVel * dt;
    // Contact with the water: 1 riding on it, 0 flying.
    const wasAir = this.airborne;
    this.contact = clamp((imm + 0.03) / 0.03, 0, 1);
    // (flying: clear of the water, not just skimming its tops)
    this.airborne = imm < -0.02 || (wasAir && !touching);
    if (!sailorOnBoard) this.airborne = false;
    if (this.airborne) {
      if (!wasAir) this.takeoff = { x: this.pos[0], z: this.pos[2], t: this.t, popped: this.popT !== undefined };
      this.airTime = (this.airTime ?? 0) + dt;
      this.airHeight = Math.max(this.airHeight ?? 0, -imm);
    } else {
      if (wasAir) {
        // Landing: how hard (descending speed onto the water) and how square.
        const hit = Math.max(0, vS - zCdot);
        const rel = (this.pitch - Math.atan(slopeC)) / DEG;
        this.landing = { hit, rel, air: this.airTime ?? 0, height: this.airHeight ?? 0, t: this.t };
        // Touching down scrubs off speed: more landing hard, most nose-first.
        const sp = Math.hypot(this.vel[0], this.vel[2]);
        if (sp > 1) {
          // (and coming down on the tail with the nose high in the air, it stalls)
          const loss = Math.min(0.5 * sp, (0.12 + 0.4 * smoothstep(0, -6, rel) + 0.2 * smoothstep(8, 18, rel)) * hit);
          this.vel = scale(this.vel, 1 - loss / sp);
          // (and your body carries on: landing from any height, you feel it as a lurch forward)
          this.aLong = (this.aLong ?? 0) - loss * 15 * smoothstep(1.2, 2.5, hit);
        }
        this.impact = Math.max(this.impact ?? 0, clamp(hit / 2.5, 0, 1));
        this.sailor.knees = Math.min(0.2, this.sailor.knees + hit * 0.03); // (absorbing it)
        const to = this.takeoff;
        const popped = to?.popped || this.popT !== undefined;
        this.popT = undefined;
        if (this.state === S.SAILING && (popped ? this.landing.air >= 0.25 : this.landing.air >= 0.4)) {
          // A jump: how high, how long, how far, and how you came down.
          const dist = to ? Math.hypot(this.pos[0] - to.x, this.pos[2] - to.z) : 0;
          const how = rel < -3 ? 'nose first!' : rel > 3 ? 'tail first' : 'flat';
          this.jump = { height: this.landing.height, air: this.landing.air, dist, rel, hit, how, popped, t: this.t };
          this.landing.jump = this.jump;
          if (!this.bestJump || this.jump.height > this.bestJump.height) this.bestJump = this.jump;
          this.emit('jump', `${popped ? 'Jump' : 'Airtime'}: ${this.jump.height.toFixed(2)} m high, ${this.jump.air.toFixed(1)} s, ${dist.toFixed(0)} m — landed ${how}`, 1);
        }
        // Landing sideways (the board slid downwind in the air), plunging in
        // steeply tail first, or dropping from high up drags air down the fin.
        const fwdL = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)], stbdL = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
        const slip = Math.abs(Math.atan2(dot(this.vel, stbdL), Math.max(1, Math.abs(dot(this.vel, fwdL)))));
        this.finAir = Math.max(this.finAir ?? 0, 0.45 * clamp(smoothstep(4 * DEG, 12 * DEG, slip) + 0.6 * smoothstep(9, 20, rel) +
          0.4 * smoothstep(0.3, 1, this.airHeight ?? 0), 0, 1));
      }
      this.airTime = 0;
      this.airHeight = 0;
    }
    this.impact = Math.max(0, (this.impact ?? 0) - dt * 4);
    this.finAir = Math.max(0, (this.finAir ?? 0) - dt);
    // Chatter: the bottom slapping over the chop.
    this.chopHit = touching ? Math.abs(vS - zCdot) * p : 0;

    // The nose: its rocker meets the faces of the chop ahead and lifts it
    // over them (with a slap of spray drag). Pushed deeper than the rocker
    // can deflect, with the board pitched down (weight forward, or dropping
    // off a crest), it buries: the board stops dead.
    const xn = 0.5 * b.length - 0.35;
    const noseImm = surf(xn) - (this.pos[1] + xn * tp + 0.045);
    const q = 0.5 * RHO_WATER * u * u;
    const nose = p > 0.5 && noseImm > 0 && sailorOnBoard ? Math.min(noseImm, 0.15) : 0;
    const dig = smoothstep(0.05, 0.12, nose) * smoothstep(2.5 * DEG, -2 * DEG, this.pitch);
    this.noseDig = dig;
    this.noseDrag = q * 0.6 * b.width * nose * (0.06 + 1.6 * dig);
    if (this.noseDrag > this.totalMass * G && this.state === S.SAILING) {
      this.emit('nosedive', 'Nose-dive! The nose buried in a chop. Weight back to keep it up through rough water.', 2);
    }

    let pitchAcc;
    if (this.airborne) {
      // In the air the water lets go: the board keeps turning, and your feet
      // steer it (weight back lifts the nose).
      const w = clamp(this.sailor.leanX / (this.sailor.straps === 2 ? 0.2 : 0.077), -1, 1);
      // (your feet in the straps hold its attitude against your body's)
      const airTrim = hull.trim + (3 - 7 * w) * DEG;
      pitchAcc = 30 * (airTrim - this.pitch) - 12 * this.pitchRate;
    } else {
      const slopeBoard = lerp(waveSlope, Math.atan(slopeC), p);
      const pitchTarget = hull.trim + slopeBoard * (1 - 0.55 * p);
      pitchAcc = 90 * (pitchTarget - this.pitch) - 16 * this.pitchRate + 250 * nose * (1 - 0.7 * dig);
    }
    // Popping, you kick the tail down as your legs drive: the nose comes up.
    if (popping) pitchAcc += 7 * this.popK;
    // Spinning on its nose, the nose is pressed down and the tail lifts.
    if (this.state === S.TRICK && this.stateData.kind === 'spock') pitchAcc += 60 * (-7 * DEG - this.pitch);
    this.pitchRate += pitchAcc * dt;
    this.pitch += this.pitchRate * dt;

    let rollCmd = 0;
    if (this.state === S.SAILING || this.state === S.FLIP || (this.state === S.TRICK && this.stateData.kind === 'duck')) {
      const maxRoll = lerp(8 * (0.75 / b.width), 30, p) * DEG;
      rollCmd = ctl.rail * maxRoll;
    }
    // (a carving 360 is ridden right over on its inside rail)
    if (this.state === S.TRICK && this.stateData.kind === 'c360') rollCmd = -this.stateData.dir * this.stateData.bank;
    // (in the air the water no longer rolls it; your feet do, more freely)
    const inAir = this.airborne ? 1 : 0;
    const rollTarget = rollCmd * (1 + 0.4 * inAir) + waveRoll * (sailorOnBoard ? 0.6 : 1) * (1 - 0.7 * p) * (1 - inAir);
    this.rollRate += ((70 - 40 * inAir) * (rollTarget - this.roll) - (14 - 6 * inAir) * this.rollRate) * dt;
    this.roll += this.rollRate * dt;
  }

  /**
   * The posed body for the current stance and rig: how far out it can lean,
   * its lever, and (unhooked) how far out the harness lines would let you hang.
   */
  solveBody() {
    const s = this.sailor, st = this.state;
    const onBoom = st === S.SAILING;
    const pose = stance(this.board, s, st, this.stateData, this.stateTime);
    const solve = (hooked) => {
      const g = onBoom ? boomGrips(this.board, this.rig, this.sailGeo, hooked, s.gripX) : null;
      const ctx = bodyContext({
        H: this.sailorHeight, stance: hooked === s.hooked ? pose : stance(this.board, { ...s, hooked }, st), side: s.side,
        leanX: s.leanX, hooked, onBoom, hands: g && { f: g.f, b: g.b }, lines: g && { a: g.lineA, b: g.lineB },
        lineLength: this.harnessLines, phi: onBoom ? reachPhi(s.phi) : 0,
      });
      return { ctx, st: g?.st, ...(onBoom ? reachLimit(ctx) : { betaMax: 30 * DEG, betaMin: -30 * DEG, fits: true }) };
    };
    const now = solve(s.hooked && onBoom);
    this.hookReach = onBoom && !s.hooked ? solve(true) : null;
    // How far back you can lean before the arms or lines hold you, and where
    // the rig's pull acts on you: the hook, or the hands.
    const body = poseBody(now.ctx, s.beta, s.phi);
    const attach = onBoom && s.hooked ? body.hook : now.ctx.hands ? scale(add(now.ctx.hands.f, now.ctx.hands.b), 0.5) : body.mid;
    return {
      ctx: now.ctx, betaMax: now.betaMax, betaMin: now.betaMin, fits: now.fits, hookReach: this.hookReach, stations: now.st,
      pitch: pitchTable(now.ctx, s.beta), attachH: attach[1] - this.board.thickness,
      table: leverTable(now.ctx, -30 * DEG, Math.max(now.betaMax, 10 * DEG)),
    };
  }

  /**
   * Fore and aft. The rig is pinned at the mast foot: its drive (high up) and
   * its lift (behind the mast) tip it forward, and you hold it back by the
   * harness or your hands. That pull acts on you at the hook or the hands and
   * tips you forward over your feet. Your feet can press anywhere from the
   * back heel to the front toes (a little further with them in the straps);
   * you lean back until the pull is balanced with the pressure where you want
   * it (weight front or back). React too slowly to a gust, or be unable to
   * lean back far enough, and you go over the front.
   */
  updatePitch(dt) {
    const s = this.sailor, b = this.board, geo = this.bodyGeo, ctx = geo.ctx;
    const W = this.sailorMass * G;
    // Pull forward on you (N): what holds the rig against tipping, at the
    // grips. The rig's own weight helps hold it back, and so does technique:
    // hanging your weight down on the boom behind the mast (into the mast
    // foot) and holding the boom with a push-pull between your hands.
    const grip = ctx.hands ? scale(add(ctx.hands.f, ctx.hands.b), 0.5) : [b.mastFootX - 0.5, b.thickness + this.boomHeight, 0];
    const gx = grip[0] - b.mastFootX, gy = Math.max(0.6, grip[1] - b.thickness);
    const tipLeft = this.tipAero - this.sail.rigMass * G * 0.35;
    const couple = 0.25 * W; // N·m of push-pull between the hands
    // Weight you can hang down on the boom or lines: only as much as it takes
    // to keep the pull to what you're happy leaning back against (more with
    // your weight forward), since it presses the nose down.
    const hangMax = (s.hooked ? 0.4 : 0.3) * W;
    const wF = clamp(s.leanX / (s.straps === 2 ? 0.2 : 0.077), -1, 1);
    const comfy = W * 0.35 * (1 - 0.6 * Math.max(0, wF)) * gy / Math.max(0.5, geo.attachH);
    const hangDown = clamp((tipLeft - couple - comfy) / Math.max(0.2, -gx), 0, hangMax);
    this.hangDown = hangDown;
    const pull = (tipLeft - Math.sign(tipLeft) * Math.min(Math.abs(tipLeft), couple) - hangDown * Math.max(0, -gx)) / gy;
    // Centre of mass ahead of the middle of your feet at your lean.
    const pt = geo.pitch;
    // Tipping you forward about your feet (N·m): the pull, and the board
    // braking under you (a nose dug into a chop) as your body carries on.
    const braking = -this.sailorMass * (this.aLong ?? 0) * 0.9 * comDistPhi(pt, s.phi);
    const tip = pull * geo.attachH + braking;
    let comX = comFwdAt(pt, s.phi);
    // Where your feet can press: back heel to front toes, plus a little from the straps.
    const base = ctx.base;
    const strap = s.straps === 2 ? 0.08 : s.straps === 1 ? 0.04 : 0;
    const toe = ctx.feetF[0] - base[0] + 0.12 + strap, heel = ctx.feetB[0] - base[0] - 0.12 - strap;
    // You feel the pull a moment late, and lean back so it balances with the
    // pressure where you want it (weight on the front or back foot).
    this.pullFelt = this.pullFelt === undefined ? pull : damp(this.pullFelt, pull, 8, dt);
    // Weight forward or back (right stick) picks the foot you press through.
    const w = clamp(s.leanX / (s.straps === 2 ? 0.2 : 0.077), -1, 1);
    const want = w > 0 ? w * 0.5 * toe : -w * 0.5 * heel;
    const phiMax = 40 * DEG;
    // (Weight forward means pressing through the front foot while leaning
    // back on the rig, not leaning out over your toes.)
    const phiT = clamp(phiForFwd(pt, Math.min(0.08, want - (this.pullFelt * geo.attachH) / W)), -20 * DEG, phiMax);
    if (this.pitchSettle) {
      this.pitchSettle = false;
      s.phi = phiT;
      s.phiRate = 0;
      comX = comFwdAt(pt, s.phi);
    }
    // Your feet press wherever gets you there, within heel to toes.
    const dist = comDistPhi(pt, s.phi);
    const I = this.sailorMass * dist * dist + 4;
    const needed = tip + 3000 * (phiT - s.phi) - 500 * s.phiRate;
    const cop = clamp(comX + needed / W, heel, toe);
    // Leaning back with the pull gone, you can pull yourself up on the boom
    // (the rig is pinned at the mast foot).
    const handle = Math.max(-150 * (this.sailorMass / 75), Math.min(0, needed - W * (heel - comX)));
    // Unhooked, more pull than your toes can hold makes your arms give: the
    // rig tips forward instead of you (see updateRig). Hooked in, the lines
    // can't give: that's how a catapult starts.
    const holdable = W * (toe - comX) + 400 * Math.max(0, s.phiRate);
    const give = s.hooked ? 0 : clamp(tip - holdable, 0, 250);
    s.give = damp(s.give ?? 0, give, give > (s.give ?? 0) ? 12 : 4, dt);
    let tau = W * (cop - comX) + handle - (tip - give) - 40 * s.phiRate; // + tips you back
    // You can't fold back further than this.
    if (s.phi > phiMax) tau -= 4000 * (s.phi - phiMax) + 400 * Math.max(0, s.phiRate);
    s.phiRate += (tau / I) * dt;
    s.phi += s.phiRate * dt;
    // The board feels the pressure move over a moment (feet don't teleport).
    this.copX = this.copX === undefined ? base[0] + cop : damp(this.copX, base[0] + cop, 10, dt);
    const atToe = cop >= toe - 1e-4;
    // Unhooked, being dragged forward over your toes you let go with the back hand.
    if (!s.hooked && atToe && s.phiRate < -0.6 && s.gripLost <= 0) {
      s.gripLost = 0.7;
      this.emit('grip', 'Dragged forward — you let go with the back hand. Lean back against the pull.', 2);
    }
    this.pitchBalance = {
      pull, tip, comX, cop, toe, heel, phiT, phiMax, atToe, atHeel: cop <= heel + 1e-4,
      // The least lean back that holds the pull, pressing through your toes,
      // and how much more pull (as metres of lean) there is than that holds now.
      phiNeed: clamp(phiForFwd(pt, toe - 0.05 - tip / W), -20 * DEG, phiMax),
      excess: Math.max(0, tip - W * (toe - comX)) / W,
      phiAt: (x) => phiForFwd(pt, x),
      // Pull forward you could hold leaning right back with your weight on
      // your toes, and what you can hold at the lean you're at now (plus what
      // your arms can give, unhooked).
      tipMax: W * (toe - comFwdAt(pt, phiMax)),
      tipNow: W * (toe - comX) + (s.hooked ? 0 : 250),
    };
  }

  updateBalance(dt, ctl, tauPull, handForce, p, speed, onBoard) {
    const s = this.sailor;
    const mS = this.sailorMass;
    const holding = HOLDS_BOOM.has(this.state);
    if (!holding) {
      s.beta = damp(s.beta, this.state === S.SECURE || this.state === S.UPHAUL ? 6 * DEG : s.beta, 4, dt);
      s.betaRate = 0;
      s.hang = 0;
      s.hangTime = 0;
      s.phi = damp(s.phi, 0, 4, dt);
      s.phiRate = 0;
      s.give = 0;
      this.copX = undefined;
      s.stamina = Math.min(1, s.stamina + dt * 0.03);
      return;
    }
    const b = this.board;
    // The body follows the stance and the rig: re-solve its geometry at 60 Hz
    // and interpolate the lever in between.
    this.bodyTick = ((this.bodyTick ?? 0) + 1) % 4;
    // The hands slide along the boom to stay over the feet as you move back
    // toward the straps (a hand-over-hand shuffle, not a jump).
    const feet = stance(b, this.sailor, this.state, this.stateData, this.stateTime);
    const gx = gripCenterX(feet);
    this.sailor.gripX = this.sailor.gripX === undefined ? gx : this.sailor.gripX + clamp(gx - this.sailor.gripX, -1.5 * dt, 1.5 * dt);
    const baseX = 0.5 * (feet.feetF[0] + feet.feetB[0]), baseZ = 0.5 * (feet.feetF[2] + feet.feetB[2]);
    const stepped = this.bodyGeo && this.state === S.SAILING && this.lastBase &&
      Math.hypot(baseX - this.lastBase[0], baseZ - this.lastBase[1]) > 0.02;
    if (stepped) {
      // A step moves the feet under the body, not the body: keep the centre
      // of mass where it was (more upright stepping back toward it, further
      // out stepping onto the windward rail).
      const s = this.sailor, old = this.bodyGeo;
      const lever = leverAt(old.table, s.beta), fwd = comFwdAt(old.pitch, s.phi) - (baseX - this.lastBase[0]);
      this.bodyGeo = this.solveBody();
      s.beta = clamp(leanFor(this.bodyGeo.table, lever), -30 * DEG, Math.max(s.beta, this.bodyGeo.betaMax));
      s.phi = clamp(phiForFwd(this.bodyGeo.pitch, fwd), -30 * DEG, 40 * DEG);
      this.bodyGeo = this.solveBody();
      this.bodyTick = 0;
    } else if (!this.bodyGeo || this.bodyTick === 0) this.bodyGeo = this.solveBody();
    // (only steps while sailing: getting up or tacking sets the body afresh)
    this.lastBase = this.state === S.SAILING ? [baseX, baseZ] : undefined;
    const tbl = this.bodyGeo.table;
    const sailing = this.state === S.SAILING;
    // How far out you can hang: arms (and harness lines) to the boom.
    const betaMax = sailing ? this.bodyGeo.betaMax : 30 * DEG;
    // Weight of the rig held to windward helps; leaned to leeward it pulls you in.
    const rigCgSide = Math.sin(this.rig.lean) * 1.7;
    const tauRig = this.sailor.side * rigCgSide * this.sail.rigMass * G * 0.6;
    const kRoll = RHO_WATER * G * (b.width ** 3) * b.length / 12 * 0.12;
    // Core and leg strength scale roughly with body mass. Holding the mast
    // (tacks, sail flips) steadies you: the rig is pinned at the mast foot.
    const holdingMast = this.state === S.TACK || this.state === S.FLIP || this.state === S.TRICK;
    const tauMax = (260 + 80 * p) * (mS / 75) * (holdingMast ? 1.6 : 1) + kRoll * (1 - 0.5 * p);
    // Balanced: the lean whose weight lever (centre of mass out from the
    // board's centreline) matches the sail's pull.
    this.betaEq = leanFor(tbl, (tauPull - tauRig) / (mS * G));
    this.betaMax = betaMax;
    let target;
    if (this.assists.autoHike || !sailing) {
      target = clamp(this.betaEq, -12 * DEG, betaMax);
      if (!sailing) target = clamp(target, -5 * DEG, holdingMast ? 10 * DEG : 30 * DEG);
    } else {
      // (you lean back against the pull without thinking, part of the way;
      // LT hangs you out as far as it takes)
      const instinct = clamp(this.betaEq * 0.6, 0, 12 * DEG);
      target = Math.min(betaMax, Math.max(instinct, 4 * DEG + ctl.hike * Math.max(0, betaMax - 4 * DEG)));
    }
    // To hold a boom that's out over the water (or far back) you lean out to it.
    if (sailing && this.bodyGeo.fits) target = Math.max(target, Math.min(this.bodyGeo.betaMin, betaMax));
    this.betaTarget = target;
    this.betaMin = sailing ? this.bodyGeo.betaMin : -30 * DEG;
    const tauGrav = mS * G * leverAt(tbl, s.beta);
    const dCom = comDistAt(tbl, s.beta);
    const I = mS * dCom * dCom + this.sail.rigMass * 0.8;
    // Coming back in you can also pull yourself up on the boom: the rig is
    // pinned at the mast foot, so it works as a handle (until you pull it over).
    const handle = 200 * (mS / 75);
    const muscle = clamp(5000 * (target - s.beta) - 600 * s.betaRate, -(tauMax + handle), tauMax);
    // At the full reach of your arms (or harness lines) you hang on the boom:
    // they hold you in, and the same pull goes into the rig, bringing it over
    // toward you.
    const over = sailing ? s.beta - betaMax : 0;
    // (as hard as arms or lines can pull, not more)
    const held = over > 0 ? Math.min(800, 6000 * over + 500 * Math.max(0, s.betaRate)) : 0;
    const tau = tauGrav + tauRig - tauPull + muscle - held - 60 * s.betaRate;
    s.betaRate += (tau / I) * dt;
    s.beta += s.betaRate * dt;
    s.hang = damp(s.hang, held, held > s.hang ? 2.5 : 4, dt); // a rig comes over in a second or so, not instantly
    // Pulled in toward the sail, unhooked: you let go with the back hand, the
    // sail opens and stops pulling, and you take hold again once you're back
    // on your feet. (A big gust, or the rig falling to leeward, can still pull
    // you over: then you let go of the rig altogether.)
    // (only when you're straining to hold out and still being pulled in, not coming in on purpose)
    const straining = muscle >= tauMax * 0.95 && tauPull > 0;
    if (sailing && !s.hooked && straining && s.beta < 2 * DEG && s.betaRate < -0.4 && s.backOff <= 0 && s.side * this.rig.lean > -8 * DEG) {
      s.backOff = 1.1;
      s.regrab = 0;
      if (this.t - (this.letGoAt ?? -99) > 8) this.emit('letgo', 'Too much pull: you let go with the back hand. Lean back (LT) before you sheet in again.', 1);
      this.letGoAt = this.t;
    }
    if (s.backOff > 0) s.backOff = Math.max(0, s.backOff - dt);
    else s.regrab = Math.min(1, s.regrab + dt);

    // A rig leaned further out over the water than you can reach at your lean
    // comes back in toward you.
    s.reachIn = sailing && this.bodyGeo.fits ? Math.max(0, this.bodyGeo.betaMin - s.beta) : 0;
    // The sail can't hold you up: hang on it for more than a moment and the rig comes down on you.
    s.hangTime = Math.max(0, (s.hangTime ?? 0) + (s.hang > 140 ? dt : -2 * dt));
    if (sailing) this.updatePitch(dt);
    else {
      s.phi = damp(s.phi, 0, 4, dt);
      s.phiRate = 0;
      this.copX = undefined;
    }
    this.balance = {
      tauPull, tauGrav, tauRig, muscle, tauMax, net: tau, betaMax, hang: s.hang,
      leverMax: leverAt(tbl, betaMax), saturated: muscle >= tauMax * 0.999 || muscle <= -(tauMax + handle) * 0.999,
    };

    // Arms: holding the rig unhooked burns the forearms; the harness takes most of it.
    // Hooked in, what's left for the arms is steadying the rig plus whatever
    // the harness lines don't balance (see handLoads).
    const armLoad = s.hooked ? handForce * 0.1 + Math.abs(this.hands?.couple ?? 0) : handForce;
    const drain = Math.max(0, armLoad - 110) / 300 * 0.03 + (ctl.pump ? 0.05 : 0);
    s.stamina = clamp(s.stamina + (armLoad < 110 && !ctl.pump ? 0.045 : 0) * dt - drain * dt, 0, 1);
    s.gripLost = Math.max(0, s.gripLost - dt);
    const grip = 250 + 400 * s.stamina;
    if (!s.hooked && handForce > grip && s.gripLost <= 0 && this.state === S.SAILING) {
      s.gripLost = 0.7;
      this.emit('grip', s.stamina < 0.35 ? 'Forearm burn — the sail was ripped from your hands' : 'Too much power — the sail was ripped from your back hand', 2);
    }

    const fa = this.pitchBalance;
    if (this.assists.noFalls) {
      s.beta = Math.max(s.beta, -20 * DEG);
      if (s.beta <= -20 * DEG) s.betaRate = 0;
      s.hang = Math.min(s.hang, 500);
      s.hangTime = 0;
      if (fa && sailing) {
        // Held between your heels and toes.
        const fwd = fa.phiAt(fa.toe), back = fa.phiAt(fa.heel);
        if (s.phi < fwd) { s.phi = fwd; s.phiRate = Math.max(0, s.phiRate); }
        if (s.phi > back) { s.phi = back; s.phiRate = Math.min(0, s.phiRate); }
      }
      return;
    }
    // (thrown over the front around a jump: what went wrong there)
    const jumpWhy = () => {
      if (this.airborne) return 'with your weight forward in the air the nose dropped and the rig took you over the front. Keep your weight back in the air (RS down) and the nose up.';
      const l = this.landing;
      if (!l || this.t - l.t > 0.6 || l.air < 0.25) return null;
      return l.rel < -3 ? 'the nose hit the water first and the board stopped dead under you. Weight back in the air and land tail first.'
        : 'you landed hard and the board stopped under you. Land tail first with soft knees, and ease the sheet a touch as you touch down.';
    };
    if (fa && sailing && fa.comX > fa.toe + 0.05 && s.phiRate < 0) {
      // Tipped forward over your front foot by the pull.
      if (s.hooked && speed > 4) this.fall('catapult', jumpWhy() ?? 'the gust\'s pull through your harness lines tipped you over your front foot and launched you over the boom. Keep your weight back and sheet out the moment a gust hits!');
      else this.fall('leeward', 'the pull dragged you forward over your front foot. Lean back against it and sheet out when it gusts.');
    } else if (fa && sailing && fa.comX + (fa.tip + 150 * mS / 75) / (mS * G) < fa.heel - 0.1 && s.phiRate > 0) {
      // Leaned back further than the pull (and a pull up on the boom) can hold.
      this.fall('windward', 'you leaned back with too little pull to hold you and sat down off the back. Ease the lean when the power drops.');
    } else if (s.beta < -24 * DEG) {
      // (the rig's own weight, leaned out to leeward, dragging you over)
      const rigOver = s.side * this.rig.lean < -8 * DEG;
      if (s.hooked && speed > 5.5) this.fall('catapult', jumpWhy() ?? 'a gust yanked you up out of your stance by the harness lines and over the boom. Sheet out and sink your weight back the moment a gust hits!');
      // Slow and unhooked on a board that floats you easily, you let go of the
      // rig rather than get dragged in after it (on a small board you'd sink:
      // you go in, and waterstart).
      else if (!s.hooked && speed < 3 && this.board.volume > 1.4 * this.totalMass) {
        this.dropRig(rigOver ? 'The rig fell to leeward and pulled you off balance, so you let go of it. Keep it upright (left stick). Hold LB to uphaul.'
          : 'Pulled off balance, so you let go of the rig. Lean back (LT) or ease the sheet (RT) sooner. Hold LB to uphaul.');
      } else this.fall('leeward', rigOver ? 'the rig fell to leeward and dragged you over. Keep it upright, or tilted a little to windward (left stick).' : 'too much power for your stance. Hike out (LT) or sheet out (RT).');
    } else if (s.beta > 86 * DEG || s.hangTime > 1.2 || s.side * this.rig.lean > 58 * DEG) {
      if (this.aero && this.aero.alphaMid < -2 * DEG) this.fall('backwind', 'the wind got on the wrong side of the sail and pushed you in.');
      else if (s.beta > 86 * DEG) this.fall('windward', 'you leaned out with nothing to hang on. Come in (ease LT) when the power drops.');
      else this.fall('windward', 'you hung on the boom with too little wind in the sail and pulled the rig over on top of you. Come in (ease LT) when the power drops.');
    }
  }
}

export { BOARDS };
