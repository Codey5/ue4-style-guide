// Procedural sound, all synthesised from noise: wind past your ears (apparent
// wind), water rushing under the hull, the planing hiss, a luffing sail
// fluttering, battens clacking through, chop slaps and wipeout splashes;
// the rig swishing through the air as it's thrown round; and the small
// sounds of what you do (the harness hook, a foot into a strap, a pump
// stroke, the sail filling) and the big moments (a landing, a trick).
import { clamp } from '../physics/math.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    // (muffled in slow motion)
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass'; this.tone.frequency.value = 20000; this.tone.Q.value = 0.7;
    this.master.connect(this.tone).connect(comp).connect(ctx.destination);

    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      s.loopStart = Math.random(); s.start(0, Math.random() * 1.5);
      return s;
    };
    const chain = (src, type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      return { f, g };
    };
    this.wind = chain(noise(), 'bandpass', 500, 0.6);
    this.whistle = chain(noise(), 'bandpass', 2400, 6);
    this.water = chain(noise(), 'lowpass', 300, 0.7);
    this.hiss = chain(noise(), 'highpass', 2500, 0.5);
    // Sail flutter: band-passed noise gated by a square-ish LFO.
    this.flap = chain(noise(), 'bandpass', 220, 1.2);
    this.flapLfo = ctx.createOscillator();
    this.flapLfo.type = 'square';
    this.flapLfo.frequency.value = 8;
    this.flapDepth = ctx.createGain();
    this.flapDepth.gain.value = 0;
    this.flapLfo.connect(this.flapDepth).connect(this.flap.g.gain);
    this.flapLfo.start();
    // The rig swishing through the air (thrown round in a move).
    this.swish = chain(noise(), 'bandpass', 900, 1.4);
  }

  /** How loud the rig's swish is (0–1), and extra wind or hiss for a moment (a gust, the board releasing). */
  setSwish(level) { this.swishLevel = level; }
  swell(name, amount) { this.extra = this.extra ?? {}; this.extra[name] = Math.max(this.extra[name] ?? 0, amount); }
  /** Slow motion: 0 normal, 1 deep (the world goes muffled). */
  setSlowmo(k) {
    if (this.tone) this.tone.frequency.setTargetAtTime(20000 * Math.pow(900 / 20000, clamp(k, 0, 1)), this.ctx.currentTime, 0.05);
  }

  /** A one-shot: filtered noise with an attack, a decay and an optional sweep. */
  shot({ gain = 0.3, freq = 800, dur = 0.3, type = 'lowpass', q = 0.8, attack = 0.004, to = null }) {
    if (!this.ctx || gain <= 0) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  /** A tone: a sine (or other) note with a pitch glide, for rings and booms. */
  note({ gain = 0.1, freq = 440, to = null, dur = 0.3, type = 'sine', delay = 0 }) {
    if (!this.ctx || gain <= 0) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** The harness hook dropping onto the lines: a metallic clack and a ring. */
  hookIn(k = 1) {
    this.shot({ gain: 0.22 * k, freq: 3800, dur: 0.05, type: 'highpass' });
    this.shot({ gain: 0.12 * k, freq: 1700, dur: 0.09, type: 'bandpass', q: 3 });
    this.note({ gain: 0.035 * k, freq: 2350, dur: 0.22 });
    this.note({ gain: 0.02 * k, freq: 3610, dur: 0.15 });
  }
  /** Unhooking: a lighter clink. */
  hookOut(k = 1) {
    this.shot({ gain: 0.1 * k, freq: 3400, dur: 0.04, type: 'highpass' });
    this.note({ gain: 0.018 * k, freq: 2600, dur: 0.12 });
  }
  /** A foot planted into a strap: a dull thud through the deck. */
  thud(k = 1) {
    this.shot({ gain: 0.32 * k, freq: 220, dur: 0.14, type: 'lowpass', q: 1.2 });
    this.note({ gain: 0.08 * k, freq: 110, to: 60, dur: 0.12 });
  }
  /** A pump stroke: the sail fanned through the air. */
  pumpStroke(k = 1) { this.shot({ gain: 0.14 * k, freq: 500, to: 1300, dur: 0.32, type: 'bandpass', q: 1.5, attack: 0.08 }); }
  /** The sail filling: a soft, deep whump as the cloth snaps taut. */
  whump(k = 1) {
    this.shot({ gain: 0.28 * k, freq: 140, to: 260, dur: 0.38, type: 'lowpass', q: 1.4, attack: 0.03 });
    this.note({ gain: 0.06 * k, freq: 75, to: 58, dur: 0.3 });
  }
  /** Touching down hard: a boom through the board and a slap. */
  thump(k = 1) {
    this.note({ gain: 0.22 * k, freq: 70, to: 38, dur: 0.35 });
    this.shot({ gain: 0.3 * k, freq: 380, dur: 0.22, type: 'lowpass' });
    this.shot({ gain: 0.1 * k, freq: 2400, dur: 0.3, type: 'highpass' });
  }
  /** A trick landed: a rising run of notes over a whoosh. */
  stinger(k = 1) {
    [523, 659, 784, 1047].forEach((f, i) => this.note({ gain: 0.07 * k, freq: f, dur: 0.45, type: 'triangle', delay: i * 0.07 }));
    this.shot({ gain: 0.12 * k, freq: 600, to: 3000, dur: 0.5, type: 'bandpass', q: 1, attack: 0.15 });
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  burst(gain = 0.6, freq = 800, dur = 0.5, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  splash() { this.burst(0.9, 900, 1.2); this.burst(0.4, 3000, 0.6, 'highpass'); }
  slap(strength) { this.burst(clamp(strength, 0, 1) * 0.35, 500, 0.12); }
  click() { this.burst(0.08, 4000, 0.05, 'highpass'); }
  /** A batten popping through: a sharp clack with a little body to it. */
  batten() { this.burst(0.16, 2600, 0.035, 'highpass'); this.burst(0.07, 420, 0.07); }

  /** A goal done: two quick rising notes (three for a chapter). */
  chime(big = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    (big ? [659, 784, 988] : [784, 1047]).forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain(), t = t0 + i * 0.11;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  update(sim) {
    if (!this.ctx || !sim.telemetry) return;
    const t = this.ctx.currentTime;
    const tel = sim.telemetry;
    const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
    // Wind in your ears: the apparent wind, or the true wind when stopped.
    const tw = sim.wind.sample(sim.pos[0], 1.7, sim.pos[2], sim.t);
    const aw = Math.hypot(tw[0] - sim.vel[0], tw[2] - sim.vel[2]);
    // (and a gust coming: you hear it before it reaches you)
    const ex = this.extra ?? {};
    for (const k of Object.keys(ex)) ex[k] = Math.max(0, ex[k] - 0.016);
    set(this.wind.g.gain, clamp((aw / 14) ** 2, 0, 1.2) * 0.32 * (1 + (ex.wind ?? 0)));
    set(this.wind.f.frequency, 280 + aw * 55);
    set(this.whistle.g.gain, (clamp((aw - 9) / 10, 0, 1) + (ex.wind ?? 0) * 0.6) * 0.03);
    set(this.swish.g.gain, clamp(this.swishLevel ?? 0, 0, 1) * 0.22, 0.04);
    set(this.swish.f.frequency, 600 + clamp(this.swishLevel ?? 0, 0, 1) * 900, 0.04);
    // Water: gurgle at low speed, rushing hiss once planing.
    const sp = tel.speed;
    const inWater = sim.state === 'water' || sim.state === 'waterstart';
    set(this.water.g.gain, clamp(sp / 9, 0, 1) * 0.35 + (inWater ? 0.06 : 0));
    set(this.water.f.frequency, 180 + sp * 70);
    set(this.hiss.g.gain, clamp((sp - 4) / 10, 0, 1) * tel.planing * 0.12 * (sim.airborne ? 0.15 : 1) * (1 + (ex.hiss ?? 0)));
    // Luffing flutter.
    const a = Math.abs(tel.alpha) * 57.3;
    const q = sim.aero ? sim.aero.qMean : 0;
    const luff = sim.aero ? clamp(1 - a / 7, 0, 1) * clamp(q / 25, 0, 1) : 0;
    set(this.flapDepth.gain, luff * 0.22);
    set(this.flapLfo.frequency, 5 + Math.sqrt(Math.max(q, 0)) * 1.3);
    if ((sim.chopHit ?? 0) > 0.25 && Math.random() < 0.15) this.slap(sim.chopHit);
  }
}
