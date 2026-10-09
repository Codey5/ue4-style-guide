// Juice: every action you take gets an answer, and the big moments a payoff.
// Read from the simulation's events and state each frame (it changes nothing
// in the physics): small sounds, rumble ticks and a push through the
// sailor's body for hooking in, stepping into a strap, a pump stroke, the
// sail filling, the rig swishing round; and for getting planing, a gust
// hitting, the top of a big jump, the landing and a trick coming off, a
// camera kick, a swell of sound, a rumble, a burst of spray, big text, and
// (at the top of a jump, as a trick lands) a moment of slow motion.
// The strengths are in the tuning panel (juice.*, camera.kicks).
import * as THREE from 'three';
import { S, TRICKS } from '../physics/sim.js';
import { clamp, smoothstep, wrapAngle } from '../physics/math.js';
import { tw } from '../tweaks.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Juice {
  constructor({ audio, camRig, effects, hud }) {
    this.audio = audio;
    this.camRig = camRig;
    this.effects = effects;
    this.hud = hud;
    this.reset();
  }

  reset() {
    this.timeScale = 1;
    this.slow = null;
    this.tick = { strong: 0, weak: 0 };
    this.swell = { strong: 0, weak: 0 };
    this.pumpCycle = null;
    this.rig0 = null;
    this.hf = null;
    this.fillCool = 0;
    this.gustCool = 0;
    this.gf = null;
    this.sheet0 = [];
    this.landedAt = -99;
    this.landing = null;
    this.grade = null;
    this.vy0 = 0;
    this.apexDone = false;
    this.lastPlaning = -99;
    if (this.audio.ctx) { this.audio.setSwish(0); this.audio.setSlowmo(0); }
  }

  /** Rumble: a tick (gone in a fraction of a second) or a swell (a second or so). */
  rumble(strong, weak = 0, swell = false) {
    const r = swell ? this.swell : this.tick;
    r.strong = Math.max(r.strong, strong);
    r.weak = Math.max(r.weak, weak);
  }
  get strong() { return Math.max(this.tick.strong, this.swell.strong); }
  get weak() { return Math.max(this.tick.weak, this.swell.weak); }

  /** A moment of slow motion (seconds at its slowest, then easing back). */
  slowmo(hold) {
    const depth = tw.juice.slowmo;
    if (depth <= 0) return;
    this.slow = { t: 0, hold, depth };
  }

  banner(title, sub, tone) {
    if (tw.juice.banners >= 0.5) this.hud.moment(title, sub, tone);
  }

  /** dt: real seconds this frame; events: the simulation's new events. */
  update(dt, sim, events, { sailor, boardGroup }) {
    const A = tw.juice.actions, M = tw.juice.moments;
    const s = sim.sailor, side = s.side;
    this.tick.strong = Math.max(0, this.tick.strong - dt * 4);
    this.tick.weak = Math.max(0, this.tick.weak - dt * 5);
    this.swell.strong = Math.max(0, this.swell.strong - dt * 1.1);
    this.swell.weak = Math.max(0, this.swell.weak - dt * 1.3);
    this.fillCool -= dt;
    this.gustCool -= dt;
    const kick = (hips, upper, k) => sailor?.kick(hips?.multiplyScalar(k) ?? null, upper?.multiplyScalar(k) ?? null);

    for (const e of events) {
      const text = e.text ?? '';
      switch (e.type) {
        case 'hook':
          if (text.startsWith('Hooked in')) {
            this.audio.hookIn(A);
            this.rumble(0.45 * A, 0.2 * A);
            kick(V(0, -0.35, side * 0.2), null, A);
          } else if (text === 'Unhooked') {
            this.audio.hookOut(A);
            this.rumble(0.2 * A);
            kick(V(0, 0.2, 0), null, A);
          }
          break;
        case 'straps':
          if (/foot in the strap/.test(text)) {
            this.audio.thud(A);
            this.rumble(0.35 * A, 0.25 * A);
            kick(V(0, -0.45, 0), null, A);
          } else if (/out of the straps/.test(text)) {
            this.audio.thud(0.55 * A);
            kick(V(0, 0.25, 0), null, A);
          }
          break;
        case 'planing':
          // The board lets go: the nose drops, the hiss swells, the camera
          // widens and pulls back, a burst of spray, and you settle into it.
          if (M > 0) {
            this.camRig.kick({ fov: 7 * M, pull: 0.1 * M });
            this.audio.whump(0.8 * M);
            this.audio.swell('hiss', 1.2 * M);
            this.audio.swell('wind', 0.35 * M);
            this.rumble(0.55 * M, 0.45 * M, true);
            this.effects.slap(sim, boardGroup, 0.55 * M);
            kick(V(0, -0.3, side * 0.15), null, M);
            this.hud.pulseSpeed();
            if (sim.t - this.lastPlaning > 25) this.banner('Planing', '', 'small gold');
          }
          this.lastPlaning = sim.t;
          break;
        case 'offplane':
          this.audio.shot({ gain: 0.14 * M, freq: 220, to: 120, dur: 0.6, type: 'lowpass', attack: 0.05 });
          this.rumble(0.2 * M, 0.1 * M);
          break;
        case 'trickdone': {
          const kind = sim.lastTrick?.kind;
          this.audio.stinger(M);
          this.camRig.kick({ fov: 4 * M, pull: 0.14 * M });
          this.rumble(0.5 * M, 0.3 * M, true);
          this.slowmo(0.35);
          this.banner(TRICKS[kind]?.name ?? 'Trick', sim.lastTrick ? `out at ${sim.lastTrick.kn.toFixed(1)} knots` : '', 'gold');
          break;
        }
        case 'fall':
          // (a catapult: a beat of slow motion as you go over the boom)
          if (s.fallType === 'catapult') { this.slowmo(0.3); this.camRig.kick({ pull: 0.12 * M }); }
          break;
        case 'nosedive':
          this.camRig.kick({ dip: 1.4 * M });
          this.rumble(0.6 * M, 0.3 * M);
          break;
        default: break;
      }
    }

    const sailing = sim.state === S.SAILING;
    // A pump stroke: a whoosh, a pulse, and the body thrown back with the rig.
    const cycle = Math.floor((s.pumpPhase ?? 0) / (2 * Math.PI));
    if (this.pumpCycle !== null && cycle > this.pumpCycle && sailing) {
      this.audio.pumpStroke(A);
      this.rumble(0.3 * A, 0.1 * A);
      kick(null, V(-0.15, -0.1, side * 0.45), A);
    }
    this.pumpCycle = cycle;

    // The sail filling as you sheet in hard: a whump, a pull through the
    // controller, and the body pulled toward the rig. (Only when you've
    // pulled the trigger in: not every jolt of a landing.)
    const hf = sim.handForce ?? 0;
    const hf0 = this.hf ?? hf;
    this.hf = hf0 + (hf - hf0) * (1 - Math.exp(-dt / 0.05));
    const rise = (this.hf - hf0) / Math.max(dt, 1e-3);
    const sheet = sim.lastControls?.sheet ?? 0;
    this.sheet0.push([sim.t, sheet]);
    while (this.sheet0.length > 1 && sim.t - this.sheet0[0][0] > 0.4) this.sheet0.shift();
    const pulled = sheet - Math.min(...this.sheet0.map(([, v]) => v));
    if (sim.landing && sim.landing !== this.landing) this.landedAt = sim.t;
    if (sailing && !sim.airborne && pulled > 0.2 && rise > 700 && this.hf > 150 && this.fillCool <= 0 && sim.t - this.landedAt > 1) {
      const k = clamp(rise / 2500, 0.35, 1);
      this.audio.whump(k * A);
      this.rumble(0.35 * k * A, 0, true);
      kick(null, V(0.05, 0, -side * 0.35 * k), A);
      this.fillCool = 2;
    }

    // A gust: you hear it coming across the water before it reaches you,
    // then it hits (the wind where you are rising well above what it's
    // been): a rush of wind, a swell in the controller, the camera
    // widening a touch, and the rig pulling you toward it.
    if (sailing && sim.wind?.gustFactor) {
      const d = sim.wind.dir, here = sim.wind.gustFactor(sim.pos[0], sim.pos[2], sim.t);
      const upwind = sim.wind.gustFactor(sim.pos[0] - d[0] * 18, sim.pos[2] - d[2] * 18, sim.t);
      if (upwind > here + 0.04) this.audio.swell('wind', clamp((upwind - here) * 4, 0, 0.6) * M);
      // (the wind itself where you are, gust patches and all, against the last few seconds)
      const w = sim.wind.sample(sim.pos[0], 2, sim.pos[2], sim.t), now = Math.hypot(w[0], w[2]) / Math.max(sim.wind.speed, 0.5);
      this.gf = this.gf === null ? now : this.gf + (now - this.gf) * (1 - Math.exp(-dt / 3));
      if (now - this.gf > 0.08 && this.gustCool <= 0) {
        this.audio.swell('wind', 0.9 * M);
        this.rumble(0.4 * M, 0.15 * M, true);
        this.camRig.kick({ fov: 2.5 * M });
        kick(null, V(0.1, 0, -side * 0.4), M);
        this.gustCool = 6;
      }
    }

    // The rig swishing through the air: thrown round in a flip, a duck, a
    // helitack, a tack, cleared out of the water.
    const r = sim.rig;
    if (this.rig0 && dt > 1e-4) {
      const w = Math.hypot(wrapAngle(r.boom - this.rig0.boom), r.rake - this.rig0.rake, r.lean - this.rig0.lean) / dt;
      this.audio.setSwish(smoothstep(1.2, 5, w) * A);
    }
    this.rig0 = { boom: r.boom, rake: r.rake, lean: r.lean };

    // The top of a big jump: a moment of slow motion.
    const vy = sim.heaveVel ?? 0;
    if (!sim.airborne) this.apexDone = false;
    else if (!this.apexDone && this.vy0 > 0 && vy <= 0 && (sim.airHeight ?? 0) > 0.55) {
      this.slowmo(0.45);
      this.apexDone = true;
    }
    this.vy0 = vy;

    // Landing a jump: a boom through the board, the camera dipping, a thump
    // through the controller; then how you came down.
    const L = sim.landing;
    if (L && L !== this.landing) {
      this.landing = L;
      if (L.jump && (L.air > 0.5 || L.height > 0.4)) {
        const k = clamp(L.hit / 3, 0.3, 1) * M;
        this.audio.thump(k);
        this.camRig.kick({ dip: clamp(L.hit * 0.45, 0.3, 1.6) * M });
        this.rumble(0.85 * k, 0.4 * k);
        this.grade = { at: sim.t + 0.6, jump: L.jump };
      }
    }
    if (this.grade && sim.t >= this.grade.at) {
      const j = this.grade.jump;
      this.grade = null;
      if (sim.state === S.SAILING) {
        const sub = `${j.height.toFixed(2)} m · ${j.air.toFixed(1)} s · ${j.dist.toFixed(0)} m`;
        if (j.rel < -3) this.banner('Nose first!', sub, 'bad');
        else if (j.rel > 12) this.banner('Tail first', sub, 'warn');
        else this.banner('Clean landing', sub, 'good');
      }
    }

    // Slow motion: in quickly, held, eased back out (the world muffled with it).
    if (this.slow) {
      const sl = this.slow;
      sl.t += dt;
      const into = smoothstep(0, 0.08, sl.t), out = smoothstep(sl.hold, sl.hold + 0.35, sl.t);
      const k = sl.depth * into * (1 - out);
      this.timeScale = 1 - 0.75 * k;
      this.audio.setSlowmo(k * 0.8);
      if (sl.t > sl.hold + 0.35) { this.slow = null; this.timeScale = 1; this.audio.setSlowmo(0); }
    } else this.timeScale = 1;
  }
}
