// The session log: your GPS results for each sailing session, your personal
// bests (kept in this browser), and a verdict on how well your gear suited
// the wind.
import { DEG } from '../physics/math.js';
import { S } from '../physics/states.js';

const KEY = 'beam-reach-sessions-v1';
/** Records count from 10 knots (m/s): nobody logs their uphauling speed. */
export const MIN_RECORD = 10 / 1.943844;
const LOG_MAX = 30;

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class SessionBook {
  constructor(store = storage()) {
    this.store = store;
    this.data = this.load();
    this.current = null;
  }

  load() {
    try {
      const raw = this.store?.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { bests: d.bests ?? {}, log: Array.isArray(d.log) ? d.log : [] };
      }
    } catch { /* unreadable: start afresh */ }
    return { bests: {}, log: [] };
  }

  save() {
    try { this.store?.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage full or blocked */ }
  }

  get bests() { return this.data.bests; }
  get log() { return this.data.log; }

  /** A new session with this gear and these conditions. */
  begin(meta) {
    this.current = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: Date.now(), ...meta, results: null, verdict: null };
  }

  /**
   * The session so far. It goes into the log once it's worth keeping (a
   * minute on the water and a few hundred metres sailed), and stays up to
   * date from then on.
   */
  update(results, verdict) {
    const c = this.current;
    if (!c) return;
    c.results = results;
    c.verdict = verdict;
    if (results.duration < 60 || results.distance < 200) return;
    const i = this.data.log.findIndex((e) => e.id === c.id);
    const entry = { ...c };
    if (i >= 0) this.data.log[i] = entry;
    else {
      this.data.log.unshift(entry);
      if (this.data.log.length > LOG_MAX) this.data.log.length = LOG_MAX;
    }
  }

  end() {
    this.current = null;
  }

  /** Whether a speed (m/s) beats your best in a category. */
  beats(key, v) {
    return v >= MIN_RECORD && v > (this.data.bests[key]?.v ?? 0) + 0.005;
  }

  /** Make it your new best (with when, and on what). */
  claim(key, v) {
    const c = this.current ?? {};
    this.data.bests[key] = { v, date: Date.now(), board: c.board, sail: c.sail, wind: c.wind, mass: c.mass, strip: c.strip };
  }

  clear() {
    this.data = { bests: {}, log: [] };
    this.save();
  }
}

/**
 * How the gear suited the wind, from how you actually sailed: time planing,
 * time off the plane while trying to get going (sheeted in on a reach), and
 * time overpowered (planing with the sail eased right off, or the pull more
 * than you can hold), plus being pulled over.
 */
export class GearVerdict {
  constructor() {
    this.sailing = 0; this.planing = 0; this.under = 0; this.over = 0; this.pulled = 0;
  }

  step(sim, dt) {
    if (sim.state !== S.SAILING || !sim.telemetry) return;
    const t = sim.telemetry, f = sim.feel ?? {};
    this.sailing += dt;
    const reaching = Math.abs(sim.twa) > 70 * DEG && Math.abs(sim.twa) < 150 * DEG;
    if (t.planing > 0.9 && t.speed > 4.5) {
      this.planing += dt;
      if (t.alpha < 9 * DEG || (f.lateral ?? 0) > 0.3 || (f.pitch ?? 0) > 0.6) this.over += dt;
    } else if (reaching && (sim.lastControls?.sheet ?? 0) > 0.6) this.under += dt;
  }

  fell(type) {
    if (type === 'catapult' || type === 'leeward') this.pulled++;
  }

  /** { kind: 'over' | 'under' | 'good' | null, text }; advice: adviseSail() for the wind. */
  result(advice, sailArea) {
    if (this.sailing < 45) return { kind: null, text: 'Sail a little longer for a verdict on your gear.' };
    const overShare = this.planing > 20 ? this.over / this.planing : 0;
    const underShare = this.under / this.sailing, planeShare = this.planing / this.sailing;
    const pct = (x) => `${Math.round(x * 100)}%`;
    const suggest = advice && Math.abs(advice.sail.area - sailArea) > 0.05 ? ` The advisor suggests the ${advice.sail.name}.` : '';
    if (overShare > 0.35 || this.pulled >= 3) {
      return { kind: 'over', text: `Overpowered: ${this.pulled >= 3 ? `pulled over ${this.pulled} times, and ` : ''}${pct(overShare)} of your planing time with the sail eased right off.${suggest}` };
    }
    if (underShare > 0.4 && planeShare < 0.4) {
      return { kind: 'under', text: `Underpowered: off the plane ${pct(underShare)} of the time while trying to get going.${suggest || ' A bigger board would help too.'}` };
    }
    return { kind: 'good', text: `Well matched: planing ${pct(planeShare)} of the time${overShare > 0.15 ? ', a touch overpowered in the gusts' : ''}.` };
  }
}
