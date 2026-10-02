// The windsurfing simulation: board + rig + sailor.
//
// Horizontal motion (surge, sway, yaw) is integrated from real forces: sail
// strips, planing hull drag, fin and daggerboard lift, hull side force, rail
// carving and sailor windage. Trim, heave and roll follow quasi-static
// equilibria from the planing solution. The sailor's lean is a balanced
// inverted pendulum fighting the sail's heeling moment — sheet out, hike or
// get pulled over.
import {
  DEG, G, MS_TO_KN, RHO_AIR, RHO_WATER, add, approach, boardMatrix, clamp, cross, damp,
  dot, lerp, mulMtV, mulMV, norm, scale, smoothstep, sub, wrapAngle,
} from './math.js';
import { Wind, Waves } from './environment.js';
import { BOARDS, BOOM_RATIO, DEFAULT_SAILOR, findBoard, findSail } from './gear.js';
import { buildSailGeometry, sailForces } from './sail.js';
import { foilPolar, planingSolve } from './hull.js';

/** Smooth proportional servo with a rate cap — how hands move a rig. */
const servo = (x, target, gain, maxRate, dt) => x + clamp((target - x) * gain * dt, -maxRate * dt, maxRate * dt);

export const S = {
  SAILING: 'sailing', SECURE: 'secure', TACK: 'tack', FLIP: 'flip', FALLING: 'falling',
  WATER: 'water', CLIMB: 'climb', UPHAUL: 'uphaul', WATERSTART: 'waterstart', RISING: 'rising',
};
const ON_BOARD = new Set([S.SAILING, S.SECURE, S.TACK, S.FLIP, S.UPHAUL]);
const HOLDS_BOOM = new Set([S.SAILING, S.TACK, S.FLIP]);

export const BEACH_Z = -260; // the shoreline runs east-west, north of the start

/** Normalised controls the sim consumes (see ui/input.js for the mapping). */
export function emptyControls() {
  return {
    rake: 0, lean: 0, weight: 0, rail: 0, sheet: 0, hike: 0, pump: false, uphaul: false, strapsHeld: false,
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
    this.waves = new Waves(this.wind);
    this.assists = { autoHike: false, noFalls: false, ...(opts.assists ?? {}) };
    this.events = [];
    this.t = 0;
    this.setGear(opts.boardId ?? 'free135', opts.sailArea ?? 7, opts.sailorMass ?? DEFAULT_SAILOR.mass,
      opts.sailorHeight ?? DEFAULT_SAILOR.height, opts.boomHeight);
    this.reset(opts.start ?? 'secure');
  }

  /** boomHeight: above the deck; defaults to between chest and shoulder height (BOOM_RATIO × body height). */
  setGear(boardId, sailArea, sailorMass, sailorHeight = DEFAULT_SAILOR.height, boomHeight) {
    this.board = findBoard(boardId);
    this.sail = findSail(sailArea);
    this.sailorMass = sailorMass;
    this.sailorHeight = clamp(sailorHeight, 1.5, 2.05);
    this.boomHeight = clamp(boomHeight ?? BOOM_RATIO * this.sailorHeight, 1.0, 1.75);
    this.sailGeo = buildSailGeometry(this.sail, this.boomHeight);
    this.daggerDown = !!this.board.dagger;
    this.prevPoints = null;
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
    this.rig = { rake: 0, lean: 0, boom: side * 80 * DEG, side, up: 1 };
    this.sailor = {
      side, x: this.board.mastFootX - 0.35, leanX: 0, beta: 4 * DEG, betaRate: 0,
      hooked: false, straps: 0, stamina: 1, gripLost: 0, hookTimer: 0, strapsHoldTime: 0,
      pumpPhase: 0, fallType: null,
    };
    this.twa = side * Math.PI / 2;
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
    this.state = s;
    this.stateTime = 0;
    this.stateData = data;
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
        prevPoints: this.prevPoints, waterLevel: waterY, qEstimate: this.lastQ ?? 30,
        windAt: (pt, h) => this.wind.sample(pt[0], h, pt[2], this.t),
      });
      this.prevPoints = aero.points;
      this.lastQ = damp(this.lastQ ?? aero.qMean, aero.qMean, 4, dt);
    } else {
      this.prevPoints = null;
    }
    this.aero = aero;

    const sailorOnBoard = ON_BOARD.has(this.state) || this.state === S.RISING;
    const mS = this.sailorMass, mB = b.mass, mR = this.sail.rigMass;

    // ---- Forces on the sailor: roll moment about the board centreline at deck level.
    let tauAero = 0, aeroUp = 0, aeroFwd = 0, aeroBoard = [0, 0, 0];
    if (aero) {
      for (const st of aero.strips) {
        const pB = mulMtV(R, sub(st.p, this.pos));
        const fB = mulMtV(R, st.f);
        tauAero += (pB[1] - deckY) * fB[2] - pB[2] * fB[1];
      }
      aeroBoard = mulMtV(R, aero.force);
      aeroUp = aero.force[1];
      aeroFwd = aeroBoard[0];
    }
    const transmit = this.state === S.SAILING ? 1 : this.state === S.FLIP ? 0.35 : this.state === S.TACK ? 0.3 : 0;
    const tauPull = -sailor.side * tauAero * transmit; // + pulls the sailor toward the rig
    const handForce = Math.max(0, tauPull) / (this.boomHeight + deckY);
    this.handForce = handForce;

    // ---- Vertical load and its fore/aft centre (drives planing trim).
    const rigOnBoard = mR * rig.up;
    let W, xLoad;
    if (sailorOnBoard) {
      const mfp = (sailor.hooked ? 0.22 : 0.08) * handForce;
      const up = Math.max(0, aeroUp);
      W = (mB + mS + rigOnBoard) * G - aeroUp;
      const feetLoad = Math.max(0.05 * mS * G, mS * G - mfp - up);
      const ceH = this.sailGeo.ceHeight;
      xLoad = (mB * G * -0.05 + (rigOnBoard * G + mfp) * b.mastFootX + feetLoad * this.feetLoadX()) /
        Math.max(1, mB * G * 1 + rigOnBoard * G + mfp + feetLoad) + (0.2 * aeroFwd * ceH) / Math.max(200, W);
    } else {
      W = (mB + mS * 0.12 + rigOnBoard * 0.4) * G - Math.max(0, aeroUp) * 0.3;
      xLoad = b.mastFootX - 0.3;
    }
    W = Math.max(W, 0.25 * mB * G);
    const chop = this.waves.hs;
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

    // Hull drag along the direction of travel.
    if (speed > 1e-3) {
      const vdir = scale(this.vel, 1 / speed);
      const fwdShare = Math.abs(u) / speed;
      applyAt(boardPoint(hull.cp, 0.02), scale(vdir, -hull.drag * fwdShare));
    }

    // Hull side force: cross-flow drag on the immersed hull plus planing rail grip.
    const leeway = Math.atan2(w, Math.max(Math.abs(u), 0.3));
    const draft = clamp(hull.submerged / (0.75 * b.length * b.width), 0.02, 0.2);
    const latArea = b.length * 0.9 * (draft + 0.03);
    const hullSide = -(0.5 * RHO_WATER * w * Math.abs(w) * latArea * 1.1 + w * 18 + p * W * 0.9 * Math.sin(leeway));
    const hullLatX = lerp(-0.1, hull.cp, p);
    applyAt(boardPoint(hullLatX, 0), scale(stbd, hullSide));

    // Fin (ventilation = spin-out) and daggerboard.
    const finDepth = b.finDepth;
    const fin = this.foilForce(dt, boardPoint(b.finX, -finDepth * 0.45), b.finArea, (finDepth * finDepth / b.finArea) * 1.4, true, fwd, stbd, hull);
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
    const carve = p * W * Math.tan(this.roll) * 0.85;
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
    const acc = scale(F, 1 / (m * (1 + 0.08 * (1 - p))));
    this.vel = add(this.vel, scale(acc, dt));
    this.vel[1] = 0;
    this.pos = add(this.pos, scale(this.vel, dt));
    this.yawRate += (N / Iz) * dt;
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);
    this.accel = acc;

    // ---- Attitude: heave, trim and roll follow the water and the planing solution.
    this.updateAttitude(dt, ctl, hull, waterY, sailorOnBoard);

    // ---- Sailor balance.
    this.updateBalance(dt, ctl, tauPull, handForce, p, speed, sailorOnBoard);

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

  /** Where the sailor's weight goes through the feet, board x. */
  feetLoadX() {
    const s = this.sailor;
    if (this.state === S.SECURE || this.state === S.UPHAUL) return this.board.mastFootX - 0.12;
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
        0.1 * this.waves.hs - (this.sailor.straps === 2 && this.sailor.leanX < -0.08 ? 0.08 : 0);
      if (!this.finVentilated && sp > 5 && demand > vent && HOLDS_BOOM.has(this.state)) {
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
    if (st === S.SAILING) {
      if (pr.hook) {
        if (s.hooked) { s.hooked = false; this.emit('hook', 'Unhooked'); }
        else if (ctl.sheet > 0.4) { s.hooked = true; this.emit('hook', 'Hooked in — hang your weight off the harness lines'); }
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

  dropRig() {
    this.sailor.hooked = false;
    this.sailor.straps = 0;
    this.setState(S.UPHAUL, { progress: 0 });
    this.rig.up = 0;
    this.emit('drop', 'Dropped the rig. Hold LB to uphaul');
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
    const titles = { catapult: 'Catapult!', leeward: 'Pulled over', windward: 'Fell in to windward', sink: 'Sank', backwind: 'Backwinded' };
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
    const flagAngle = () => {
      // Boom angle at which the sail streams like a flag in the apparent wind
      // (board motion only; the rig's own motion is ignored here).
      const R = boardMatrix(this.yaw, this.pitch, this.roll);
      const ce = add(this.pos, mulMV(R, [this.board.mastFootX - 0.6, 2.2, 0]));
      const rC = sub(ce, this.pos);
      const vCe = add(this.vel, [this.yawRate * rC[2], 0, -this.yawRate * rC[0]]);
      const awB = mulMtV(R, sub(this.wind.sample(ce[0], 2.3, ce[2], this.t), vCe));
      return Math.atan2(-awB[2], -awB[0]);
    };
    if (st === S.SAILING) {
      // Hooked in and hanging off the harness lines in the straps, the stance
      // itself pulls the rig back toward the tail; that is the neutral position.
      const neutral = -3 - 9 * (s.hooked ? 1 : 0.35) * (s.straps / 2);
      const rakeCmd = (neutral + ctl.rake * (ctl.rake > 0 ? 34 : 24)) * DEG;
      const leanCmd = ctl.lean * 34 * DEG;
      let sheet = ctl.sheet;
      if (s.gripLost > 0) sheet *= 0.45; // the back hand slips: the sail opens and dumps power
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
        r.rake = servo(r.rake, (18 + ctl.rake * 10) * DEG, 5, 115 * DEG, dt);
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
    }
    void twa;
  }

  updateStance(dt, ctl) {
    const s = this.sailor, b = this.board;
    if (this.state !== S.SAILING) {
      s.leanX = damp(s.leanX, 0, 6, dt);
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

  updateAttitude(dt, ctl, hull, waterY, sailorOnBoard) {
    const b = this.board;
    const p = hull.planing;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const half = b.length * 0.42;
    const hN = this.waves.height(this.pos[0] + fx * half, this.pos[2] + fz * half, this.t);
    const hT = this.waves.height(this.pos[0] - fx * half, this.pos[2] - fz * half, this.t);
    const sx = Math.sin(this.yaw), sz = Math.cos(this.yaw);
    const hS = this.waves.height(this.pos[0] + sx * 0.4, this.pos[2] + sz * 0.4, this.t);
    const hP = this.waves.height(this.pos[0] - sx * 0.4, this.pos[2] - sz * 0.4, this.t);
    const waveSlope = Math.atan2(hN - hT, 2 * half);
    const waveRoll = Math.atan2(hP - hS, 0.8);

    // Heave: draft from displaced volume, lifting out as the board planes.
    const V = b.volume / 1000;
    const draftDisp = (hull.submerged / (0.72 * b.length * b.width)) + Math.max(0, hull.sinking) / (b.length * b.width * 0.6);
    const draft = lerp(Math.min(draftDisp, V / (b.length * b.width * 0.55) + 0.3), 0.012, p);
    const target = (hN + hT) / 2 * (1 - 0.35 * p) + waterY * 0.35 * p - draft;
    const k = 140, c = 20;
    this.heaveVel += (k * (target - this.pos[1]) - c * this.heaveVel) * dt;
    this.pos[1] += this.heaveVel * dt;
    this.chopHit = Math.abs(this.heaveVel) * p;

    const pitchTarget = hull.trim + waveSlope * (1 - 0.55 * p);
    this.pitchRate += (90 * (pitchTarget - this.pitch) - 16 * this.pitchRate) * dt;
    this.pitch += this.pitchRate * dt;

    let rollCmd = 0;
    if (this.state === S.SAILING || this.state === S.FLIP) {
      const maxRoll = lerp(8 * (0.75 / b.width), 30, p) * DEG;
      rollCmd = ctl.rail * maxRoll;
    }
    const rollTarget = rollCmd + waveRoll * (sailorOnBoard ? 0.6 : 1) * (1 - 0.7 * p);
    this.rollRate += (70 * (rollTarget - this.roll) - 14 * this.rollRate) * dt;
    this.roll += this.rollRate * dt;
  }

  updateBalance(dt, ctl, tauPull, handForce, p, speed, onBoard) {
    const s = this.sailor;
    const mS = this.sailorMass;
    const holding = HOLDS_BOOM.has(this.state);
    if (!holding) {
      s.beta = damp(s.beta, this.state === S.SECURE || this.state === S.UPHAUL ? 6 * DEG : s.beta, 4, dt);
      s.betaRate = 0;
      s.stamina = Math.min(1, s.stamina + dt * 0.03);
      return;
    }
    const b = this.board;
    const L = this.sailorHeight * 0.56 + (s.hooked ? 0.08 : 0);
    const dFeet = s.straps > 0 ? 0.12 : 0.06;
    // Weight of the rig held to windward helps; leaned to leeward it pulls you in.
    const rigCgSide = Math.sin(this.rig.lean) * 1.7;
    const tauRig = this.sailor.side * rigCgSide * this.sail.rigMass * G * 0.6;
    const kRoll = RHO_WATER * G * (b.width ** 3) * b.length / 12 * 0.12;
    // Core and leg strength scale roughly with body mass. Holding the mast
    // (tacks, sail flips) steadies you: the rig is pinned at the mast foot.
    const holdingMast = this.state === S.TACK || this.state === S.FLIP;
    const tauMax = (260 + 80 * p) * (mS / 75) * (holdingMast ? 1.6 : 1) + kRoll * (1 - 0.5 * p);
    const betaMax = (s.hooked ? 74 : 56) * DEG;
    let target;
    const sinEq = (tauPull - tauRig) / (mS * G * L) - dFeet / L;
    this.betaEq = Math.asin(clamp(sinEq, -0.5, 0.99));
    if (this.assists.autoHike || this.state !== S.SAILING) {
      target = Math.asin(clamp(sinEq, -0.2, Math.sin(betaMax)));
      if (this.state !== S.SAILING) target = clamp(target, -5 * DEG, holdingMast ? 10 * DEG : 30 * DEG);
    } else {
      target = (4 * DEG) + ctl.hike * (betaMax - 4 * DEG);
    }
    this.betaTarget = target;
    const tauGrav = mS * G * (L * Math.sin(s.beta) + dFeet);
    const I = mS * L * L + this.sail.rigMass * 0.8;
    // Coming back in you can also pull yourself up on the boom: the rig is
    // pinned at the mast foot, so it works as a handle (until you pull it over).
    const handle = 200 * (mS / 75);
    const muscle = clamp(2400 * (target - s.beta) - 420 * s.betaRate, -(tauMax + handle), tauMax);
    const tau = tauGrav + tauRig - tauPull + muscle - 60 * s.betaRate;
    s.betaRate += (tau / I) * dt;
    s.beta += s.betaRate * dt;
    this.balance = { tauPull, tauGrav, tauRig, muscle, tauMax, saturated: muscle >= tauMax * 0.999 || muscle <= -(tauMax + handle) * 0.999, net: tau };

    // Arms: holding the rig unhooked burns the forearms; the harness takes most of it.
    const armLoad = s.hooked ? handForce * 0.15 : handForce;
    const drain = Math.max(0, armLoad - 110) / 300 * 0.03 + (ctl.pump ? 0.05 : 0);
    s.stamina = clamp(s.stamina + (armLoad < 110 && !ctl.pump ? 0.045 : 0) * dt - drain * dt, 0, 1);
    s.gripLost = Math.max(0, s.gripLost - dt);
    const grip = 250 + 400 * s.stamina;
    if (!s.hooked && handForce > grip && s.gripLost <= 0 && this.state === S.SAILING) {
      s.gripLost = 0.7;
      this.emit('grip', s.stamina < 0.35 ? 'Forearm burn — the sail was ripped from your hands' : 'Too much power — the sail was ripped from your back hand', 2);
    }

    if (this.assists.noFalls) {
      s.beta = clamp(s.beta, -20 * DEG, 80 * DEG);
      if (s.beta <= -20 * DEG || s.beta >= 80 * DEG) s.betaRate = 0;
      return;
    }
    if (s.beta < -24 * DEG) {
      if (s.hooked && speed > 5.5) this.fall('catapult', 'a gust launched you over the front while hooked in. Sheet out when it gusts!');
      else this.fall('leeward', 'too much power for your stance. Hike out (LT) or sheet out (RT).');
    } else if (s.beta > 86 * DEG) {
      if (this.aero && this.aero.alphaMid < -2 * DEG) this.fall('backwind', 'the wind got on the wrong side of the sail and pushed you in.');
      else this.fall('windward', 'you leaned out with nothing to hang on. Come in (ease LT) when the power drops.');
    }
  }
}

export { BOARDS };
