// Procedural sound, all synthesised from noise: wind past your ears (apparent
// wind), water rushing under the hull, the planing hiss, a luffing sail
// fluttering, battens clacking through, chop slaps and wipeout splashes.
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
    this.master.connect(comp).connect(ctx.destination);

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

  update(sim) {
    if (!this.ctx || !sim.telemetry) return;
    const t = this.ctx.currentTime;
    const tel = sim.telemetry;
    const set = (param, v, tc = 0.08) => param.setTargetAtTime(v, t, tc);
    // Wind in your ears: the apparent wind, or the true wind when stopped.
    const tw = sim.wind.sample(sim.pos[0], 1.7, sim.pos[2], sim.t);
    const aw = Math.hypot(tw[0] - sim.vel[0], tw[2] - sim.vel[2]);
    set(this.wind.g.gain, clamp((aw / 14) ** 2, 0, 1.2) * 0.32);
    set(this.wind.f.frequency, 280 + aw * 55);
    set(this.whistle.g.gain, clamp((aw - 9) / 10, 0, 1) * 0.03);
    // Water: gurgle at low speed, rushing hiss once planing.
    const sp = tel.speed;
    const inWater = sim.state === 'water' || sim.state === 'waterstart';
    set(this.water.g.gain, clamp(sp / 9, 0, 1) * 0.35 + (inWater ? 0.06 : 0));
    set(this.water.f.frequency, 180 + sp * 70);
    set(this.hiss.g.gain, clamp((sp - 4) / 10, 0, 1) * tel.planing * 0.12 * (sim.airborne ? 0.15 : 1));
    // Luffing flutter.
    const a = Math.abs(tel.alpha) * 57.3;
    const q = sim.aero ? sim.aero.qMean : 0;
    const luff = sim.aero ? clamp(1 - a / 7, 0, 1) * clamp(q / 25, 0, 1) : 0;
    set(this.flapDepth.gain, luff * 0.22);
    set(this.flapLfo.frequency, 5 + Math.sqrt(Math.max(q, 0)) * 1.3);
    if ((sim.chopHit ?? 0) > 0.25 && Math.random() < 0.15) this.slap(sim.chopHit);
  }
}
