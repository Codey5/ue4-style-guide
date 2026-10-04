// Heads-up display: GPS-style speed, wind instrument, balance strip, stance
// diagram, context hints with the right button glyphs, event toasts and the
// telemetry panel for those who want the numbers.
import { DEG, MS_TO_KN, RAD, clamp } from '../physics/math.js';
import { S, TRICKS } from '../physics/sim.js';
import { stance } from '../physics/body.js';
import { CONTROL_MAP } from './input.js';
import { CATEGORIES } from '../game/gps.js';
import { SANDBAR, barCoords, barPoint } from '../physics/spot.js';

const KN = MS_TO_KN;
const knots = (v) => (v > 0 ? (v * KN).toFixed(1) : '–');

const $ = (id) => document.getElementById(id);

const GLYPHS = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', LS: 'L-stick', RS: 'R-stick', L3: 'L3', R3: 'R3', MENU: 'Menu' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', LS: 'L-stick', RS: 'R-stick', L3: 'L3', R3: 'R3', MENU: 'Options' },
  kb: { A: 'H', B: 'T', X: 'F', Y: 'G', LB: 'U', RB: 'P', LT: 'C / Z', RT: 'E / Q', LS: 'W A S D', RS: 'Arrows', L3: 'X', R3: 'L', MENU: 'Esc' },
};

export function pointOfSail(twaAbsDeg) {
  if (twaAbsDeg < 35) return 'In irons';
  if (twaAbsDeg < 60) return 'Close-hauled';
  if (twaAbsDeg < 80) return 'Close reach';
  if (twaAbsDeg < 105) return 'Beam reach';
  if (twaAbsDeg < 150) return 'Broad reach';
  if (twaAbsDeg < 168) return 'Training run';
  return 'Dead run';
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.toasts = $('toasts');
    this.lastEvent = 0;
    this.textTimer = 0;
    this.telemetryOn = false;
    this.camTimer = 0;
    // Dial ticks every 30°.
    const ticks = $('dial-ticks');
    let html = '';
    for (let a = 0; a < 360; a += 30) {
      const r0 = a % 90 === 0 ? 46 : 49;
      const x0 = Math.sin(a * DEG) * r0, y0 = -Math.cos(a * DEG) * r0;
      const x1 = Math.sin(a * DEG) * 54, y1 = -Math.cos(a * DEG) * 54;
      html += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="rgba(233,242,245,.35)" stroke-width="1.5"/>`;
    }
    ticks.innerHTML = html;
  }

  show(on) { this.root.hidden = !on; }

  glyphs(input) {
    // Prefer controller glyphs whenever one is connected, unless you're typing.
    if (!input.gamepad || input.lastDevice === 'keyboard') return GLYPHS.kb;
    return this.isPs(input) ? GLYPHS.ps : GLYPHS.xbox;
  }

  isPs(input) {
    return !!input.gamepad && /054c|playstation|dualsense|dualshock|sony/.test(input.gamepad.id.toLowerCase());
  }

  flashCamera(name) {
    const el = $('cam-name');
    el.textContent = `${name} camera`;
    el.style.opacity = 1;
    this.camTimer = 2.5;
  }

  toggleTelemetry() {
    this.telemetryOn = !this.telemetryOn;
    $('telemetry').hidden = !this.telemetryOn;
  }

  pushEvents(sim) {
    const out = [];
    for (const e of sim.events) {
      if (e.t <= this.lastEvent) continue;
      out.push(e);
      const div = document.createElement('div');
      div.className = `toast p${e.priority}`;
      div.textContent = e.text;
      this.toasts.prepend(div);
      setTimeout(() => div.classList.add('fade'), e.priority >= 3 ? 4500 : 3000);
      setTimeout(() => div.remove(), e.priority >= 3 ? 5200 : 3700);
      while (this.toasts.children.length > 4) this.toasts.lastChild.remove();
    }
    if (sim.events.length) this.lastEvent = sim.events[sim.events.length - 1].t;
    return out;
  }

  resetEvents(sim) {
    this.lastEvent = sim.t;
    this.toasts.innerHTML = '';
  }

  update(dt, sim, input, controls) {
    const tel = sim.telemetry;
    if (!tel) return;
    this.camTimer -= dt;
    if (this.camTimer < 0) $('cam-name').style.opacity = 0;
    // Wind dial: bow up. Arrows show where the wind comes FROM.
    const twaDeg = sim.twa * RAD;
    $('arrow-true').setAttribute('transform', `rotate(${twaDeg.toFixed(1)})`);
    const aw = sim.aero ? sim.aero.awMid : null;
    let awa = twaDeg;
    if (aw) {
      const fx = Math.cos(sim.yaw), fz = -Math.sin(sim.yaw);
      const sx = Math.sin(sim.yaw), sz = Math.cos(sim.yaw);
      awa = Math.atan2(-(aw[0] * sx + aw[2] * sz), -(aw[0] * fx + aw[2] * fz)) * RAD;
    }
    $('arrow-app').setAttribute('transform', `rotate(${awa.toFixed(1)})`);

    // Balance strip (every frame).
    const bal = sim.balance;
    let needle = 0.5;
    if (bal && (sim.state === S.SAILING || sim.state === S.FLIP || sim.state === S.TACK)) {
      needle = clamp(0.5 - (bal.muscle / bal.tauMax) * 0.45, 0, 1);
    }
    $('bal-needle').style.left = `${(needle * 100).toFixed(1)}%`;
    $('balance').classList.toggle('alarm', !!bal?.saturated && sim.state === S.SAILING);
    const pull = sim.handForce ?? 0;
    $('f-sheet').style.width = `${(controls.sheet * 100).toFixed(0)}%`;
    $('f-hike').style.width = `${(controls.hike * 100).toFixed(0)}%`;
    // Hands: front | back, each from the middle out (hooked in, only what the lines don't balance).
    const hands = sim.state === S.SAILING ? sim.hands : null;
    $('f-handF').style.width = `${clamp((hands?.front ?? 0) / 500, 0, 1) * 50}%`;
    $('f-handB').style.width = `${clamp((hands?.back ?? 0) / 500, 0, 1) * 50}%`;
    $('f-handB').parentElement.parentElement.classList.toggle('heavy', (sim.feel?.hand ?? 0) > 0.4);
    $('f-arms').style.width = `${(sim.sailor.stamina * 100).toFixed(0)}%`;

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 1 / 12;
    $('sog').textContent = tel.kn.toFixed(1);
    $('max').textContent = sim.maxSpeed.toFixed(1);
    const hdg = ((90 - sim.yaw * RAD) % 360 + 360) % 360;
    $('hdg').textContent = String(Math.round(hdg) % 360).padStart(3, '0');
    const local = sim.wind.sample(sim.pos[0], 10, sim.pos[2], sim.t);
    $('tws').textContent = (Math.hypot(local[0], local[2]) * MS_TO_KN).toFixed(0);
    const abs = Math.abs(twaDeg);
    $('pos-sail').textContent = pointOfSail(abs);
    $('tack').textContent = twaDeg >= 0 ? 'Starboard tack' : 'Port tack';
    $('awa').textContent = Math.abs(awa).toFixed(0);
    const planing = tel.planing > 0.92 && tel.speed > 4.5;
    $('chip-plane').className = `chip ${planing ? 'on' : ''}`;
    $('chip-hook').className = `chip ${sim.sailor.hooked ? 'hot' : ''}`;
    const st = sim.sailor.straps;
    $('chip-straps').textContent = st === 2 ? 'Both straps' : st === 1 ? 'Front strap' : 'Straps';
    $('chip-straps').className = `chip ${st ? 'hot' : ''}`;
    $('chip-spin').hidden = !sim.finVentilated;
    $('chip-spin').className = 'chip alarm';
    // Flying: how high the board is off the water right now.
    const flying = sim.airborne && (sim.airTime ?? 0) > 0.12;
    $('chip-air').hidden = !flying;
    if (flying) $('chip-air').textContent = `Air ${(sim.airHeight ?? 0).toFixed(2)} m`;
    const j = sim.jump, best = sim.bestJump;
    $('jumprow').hidden = !best;
    if (j) {
      $('jump-last').textContent = j.height.toFixed(2);
      $('jump-air').textContent = j.air.toFixed(1);
      $('jump-best').textContent = best.height.toFixed(2);
    }
    const holding = sim.state === S.SAILING || sim.state === S.FLIP || sim.state === S.TACK;
    $('bal-text').textContent = holding ? `lean ${(sim.sailor.beta * RAD).toFixed(0)}°${sim.state === S.SAILING && sim.betaMax !== undefined ? ` of ${(sim.betaMax * RAD).toFixed(0)}°` : ''}` : '—';
    $('v-sheet').textContent = (controls.sheet * 100).toFixed(0);
    $('v-hike').textContent = (controls.hike * 100).toFixed(0);
    $('v-pull').textContent = hands ? `${hands.front.toFixed(0)} · ${hands.back.toFixed(0)} N` : `${pull.toFixed(0)} N`;
    $('v-arms').textContent = `${(sim.sailor.stamina * 100).toFixed(0)}%`;
    this.drawStance(sim);
    this.drawHints(sim, input);
    if (this.telemetryOn) this.drawTelemetry(sim);
  }

  /**
   * The GPS panel: this session's bests in each speedsurfing category beside
   * your personal bests, and which way the speed strip is.
   */
  updateGps(dt, gps, book, sim) {
    const el = $('gps');
    el.hidden = !gps;
    if (!gps) return;
    if (this.gpsRef !== gps) { this.gpsRef = gps; this.f10 = null; this.gpsTimer = 0; }
    this.gpsTimer = (this.gpsTimer ?? 0) - dt;
    if (this.gpsTimer > 0) return;
    this.gpsTimer = 0.25;
    const d = gps.duration;
    $('gps-time').textContent = `${Math.floor(d / 60)}:${String(Math.floor(d % 60)).padStart(2, '0')}`;
    if (!this.f10 || sim.t > this.f10.at) this.f10 = { v: gps.five10(), at: sim.t + 2 };
    const sess = { ...gps.best, five10: this.f10.v.n === 5 ? this.f10.v.v : 0 };
    const since = book.current?.date ?? 0;
    let html = '<span class="h">kn</span><span class="h r">now</span><span class="h r">best</span>';
    for (const c of CATEGORIES) {
      const pb = book.bests[c.key];
      const mine = pb && pb.date >= since && Math.abs(pb.v - sess[c.key]) < 0.01;
      html += `<span class="k">${c.label}</span><span class="v${mine ? ' new' : ''}">${knots(sess[c.key])}</span><span class="pb">${pb ? knots(pb.v) : '–'}</span>`;
    }
    if (html !== this.lastGps) { $('gps-rows').innerHTML = html; this.lastGps = html; }
    // The speed strip: on it, or how far and which way to its lee.
    const wd = sim.wind.dir, bar = SANDBAR;
    const [s, dd] = barCoords(bar, wd[0], wd[2], sim.pos[0], sim.pos[2]);
    const on = s > 0 && s < bar.length && dd > bar.halfWidth + 3 && dd < bar.halfWidth + 140;
    const strip = $('gps-strip');
    strip.classList.toggle('on', on);
    if (on) {
      const course = s > bar.course[0] && s < bar.course[1];
      $('gps-strip-t').textContent = `On the speed strip: flat water${course ? ', between the flags' : ''}`;
    } else {
      const [tx, tz] = barPoint(bar, wd[0], wd[2], clamp(s, 40, bar.length - 40), bar.halfWidth + bar.laneD);
      const vx = tx - sim.pos[0], vz = tz - sim.pos[2];
      const fwd = vx * Math.cos(sim.yaw) - vz * Math.sin(sim.yaw), right = vx * Math.sin(sim.yaw) + vz * Math.cos(sim.yaw);
      $('gps-arrow').setAttribute('transform', `rotate(${(Math.atan2(right, fwd) * RAD).toFixed(0)})`);
      const dist = Math.hypot(vx, vz);
      $('gps-strip-t').textContent = `Speed strip ${dist > 950 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist / 10) * 10} m`}`;
    }
  }

  drawStance(sim) {
    const b = sim.board, s = sim.sailor;
    // Top-down board, nose up. 100 px = 1 m.
    const k = 100 / b.width * 0.62;
    const y = (x) => (-x * k * 0.75).toFixed(1);
    const L = b.length;
    const hw = (b.width / 2) * k;
    const nose = y(L / 2), tail = y(-L / 2), wide = y(-L / 2 + L * 0.42);
    const tw = (b.tailWidth * 0.42) * k;
    const outline = `M0,${nose} C${(hw * 0.9).toFixed(1)},${nose} ${hw.toFixed(1)},${(+wide - 40).toFixed(1)} ${hw.toFixed(1)},${wide} L${tw.toFixed(1)},${tail} L${(-tw).toFixed(1)},${tail} L${(-hw).toFixed(1)},${wide} C${(-hw).toFixed(1)},${(+wide - 40).toFixed(1)} ${(-hw * 0.9).toFixed(1)},${nose} 0,${nose} Z`;
    const strapZ = [0.29 * b.width * k, 0.2 * b.width * k];
    const sideX = s.side; // starboard = right on the diagram
    let feet = '', pitchText = '';
    const fx = (x, z) => `<ellipse cx="${(z * k * 0.9).toFixed(1)}" cy="${y(x)}" rx="5" ry="9" fill="#ffc531"/>`;
    if (sim.state === S.SAILING || sim.state === S.FLIP || sim.state === S.TRICK) {
      const st = stance(b, s, sim.state, sim.stateData, sim.stateTime);
      feet = fx(st.feetF[0], st.feetF[2]) + fx(st.feetB[0], st.feetB[2]);
      const lx = sim.feetLoadX();
      const pb = sim.state === S.SAILING ? sim.pitchBalance : null;
      if (pb && sim.bodyGeo) {
        // Fore and aft: where your feet can press (back heel to front toes),
        // where they press now, and your centre of mass leaning back against
        // the pull. Amber as the pull nears what your toes can hold; red past it.
        const base = sim.bodyGeo.ctx.base[0];
        const tone = pb.excess > 0.02 ? '#ff5a4a' : pb.cop > pb.toe - 0.07 ? '#ffab3a' : '#69d4ea';
        const yT = +y(base + pb.toe), yH = +y(base + pb.heel), yC = +y(base + pb.comX);
        const gx = -sideX * 40;
        feet += `<rect x="${gx - 2}" y="${yT.toFixed(1)}" width="4" height="${(yH - yT).toFixed(1)}" rx="2" fill="rgba(233,242,245,.18)"/>` +
          `<line x1="${gx - 7}" x2="${gx + 7}" y1="${y(lx)}" y2="${y(lx)}" stroke="${tone}" stroke-width="3" stroke-linecap="round"/>` +
          `<line x1="-30" x2="30" y1="${y(lx)}" y2="${y(lx)}" stroke="${tone}" stroke-width="1.5" stroke-dasharray="3 3"/>` +
          `<circle cx="${gx}" cy="${clamp(yC, -118, 96).toFixed(1)}" r="3.5" fill="none" stroke="#e9f2f5" stroke-width="1.5"/>`;
        pitchText = `<text x="0" y="104" text-anchor="middle" fill="${tone}" font-size="13" font-family="B612 Mono, monospace">back ${Math.max(0, s.phi / DEG).toFixed(0)}°</text>`;
      } else feet += `<line x1="-30" x2="30" y1="${y(lx)}" y2="${y(lx)}" stroke="#69d4ea" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    } else if (sim.state === S.SECURE || sim.state === S.UPHAUL || sim.state === S.TACK) {
      feet = fx(b.mastFootX - 0.16, sideX * 0.12) + fx(b.mastFootX - 0.5, sideX * 0.1);
    }
    let straps = '';
    for (const [x, z] of [[b.frontStrapX, strapZ[0]], [b.backStrapX, strapZ[1]]]) {
      for (const sd of [-1, 1]) straps += `<rect x="${(sd * z - 6).toFixed(1)}" y="${(+y(x) - 4).toFixed(1)}" width="12" height="8" rx="3" fill="none" stroke="rgba(233,242,245,.5)"/>`;
    }
    const roll = (sim.roll / DEG).toFixed(0);
    $('stance-svg').innerHTML =
      `<path d="${outline}" fill="rgba(233,242,245,.1)" stroke="rgba(233,242,245,.55)" stroke-width="1.5"/>` +
      straps +
      `<circle cx="0" cy="${y(b.mastFootX)}" r="4" fill="#e9f2f5"/>` + feet + pitchText +
      `<text x="0" y="122" text-anchor="middle" fill="#93aab4" font-size="13" font-family="B612 Mono, monospace">rail ${roll > 0 ? 'stbd' : roll < 0 ? 'port' : ''} ${Math.abs(roll)}°</text>`;
  }

  drawHints(sim, input) {
    const g = this.glyphs(input);
    const s = sim.sailor;
    const tel = sim.telemetry;
    const list = [];
    const add = (key, text) => list.push(`<li><span class="key">${key}</span><span>${text}</span></li>`);
    const planing = tel.planing > 0.92 && tel.speed > 4.5;
    switch (sim.state) {
      case S.WATER:
        add(`${g.LB} hold`, 'Waterstart: lift the rig, steer, sheet in');
        add(g.A, 'Climb on and uphaul');
        break;
      case S.WATERSTART:
        add(g.LS, 'Steer: rig forward bears away');
        add(g.RT, 'Sheet in to get lifted out');
        add(`${g.LB} release`, 'Drop the rig');
        break;
      case S.UPHAUL:
        add(`${g.LB} hold`, 'Pull the rig up by the uphaul');
        break;
      case S.SECURE:
        add(g.RT, 'Grab the boom and sheet in');
        add(g.LS, 'Turn the board: rig to the nose or tail');
        add(g.B, 'Tack: step round the mast');
        add(g.Y, 'Swap sides (when downwind)');
        break;
      case S.TACK:
        add(g.LS, 'Rig back until the nose crosses the wind');
        add(g.RT, 'Sheet in on the new side');
        break;
      case S.FLIP:
        add(g.RS, 'Keep carving on the inside rail');
        break;
      case S.TRICK: {
        const k = sim.stateData.kind;
        if (k === 'duck') { add(g.RS, 'Keep carving on the inside rail'); add(g.RT, 'Catch the boom on the new side'); }
        else if (k === 'heli') { add(g.LS, 'Rig back: the board luffs through the wind'); add(g.RT, 'Then the sail spins round the mast'); }
        else if (k === 'c360') { add(g.RS, 'Sink the rail toward the sail'); add(g.RT, 'Let the sail flag, catch it coming round'); }
        else { add(`${g.RS} ↑`, 'Weight on the nose: it pivots on it'); add(g.RT, 'Sheet in once round'); }
        break;
      }
      case S.SAILING:
        // Crouched: the freestyle moves (and the pop, letting go).
        if (sim.lastControls?.pop && !sim.airborne) {
          add(`${g.LB}+${g.Y}`, 'Duck gybe: carving downwind');
          add(`${g.LB}+${g.X}`, 'Carving 360: flat out');
          add(`${g.LB}+${g.A}`, 'Spock: unhooked, weight forward');
          add(`${g.LB}+${g.B}`, 'Helitack: close reach, feet out');
          add(`${g.LB} let go`, s.straps === 2 ? 'Pop off a chop face' : 'Stand up');
          break;
        }
        if (sim.inIrons) {
          add(`${g.RT} ease`, 'Let the sail out: pointing into the wind it can\'t fill');
          add(`${g.LS} ↑`, 'Rig toward the nose: your feet turn the board away from the wind');
          add(g.RT, 'Sheet in gently once you\'re across the wind, rig still a little forward');
          break;
        }
        if (!planing) {
          add(g.RT, 'Sheet in: angle of attack 15–20°');
          add(`${g.LS} ↑`, 'Bear away to a beam / broad reach');
          add(`${g.RB} hold`, 'Pump to get over the hump');
          add(`${g.RS} ↑`, 'Weight forward, board flat');
          add(g.B, 'Tack (head up first)');
        } else if (sim.airborne && (sim.airTime ?? 0) > 0.12) {
          add(`${g.RS} ↓`, 'Weight back: nose up, land tail first');
          add(g.RT, 'Stay sheeted in: the sail holds you up');
          add(g.LS, 'Rig upright, a touch to windward');
        } else {
          if (!s.hooked) add(g.A, 'Hook in');
          else add(g.A, 'Unhook (before a gybe)');
          if (s.straps < 2) add(g.X, s.straps === 0 ? 'Front foot into the strap' : 'Back foot into the strap');
          else add(`${g.X} hold`, 'Feet out for a gybe');
          add(`${g.LB} hold`, s.straps === 2 ? 'Crouch: pop off a chop, or a trick' : 'Crouch for a trick');
          add(g.LT, 'Hike out against the pull');
          add(g.RS, 'Rail: carve with toes / heels');
          add(g.Y, 'Flip the sail at dead downwind');
        }
        break;
      default:
        break;
    }
    $('hint-title').textContent = sim.state === S.SAILING ? (sim.lastControls?.pop && !sim.airborne ? 'Crouched' : sim.inIrons ? 'In irons' : planing ? 'Planing' : 'Sailing')
      : sim.state === S.TRICK ? TRICKS[sim.stateData.kind]?.name ?? 'Freestyle' : stateTitle(sim.state);
    $('hints').innerHTML = list.slice(0, 6).join('');
  }

  drawTelemetry(sim) {
    const t = sim.telemetry;
    const h = sim.hull;
    const a = sim.aero;
    const f = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const bal = sim.balance ?? {};
    $('telemetry').innerHTML =
      `<div class="label">Telemetry</div>` +
      `<h3>Sail</h3><dl>` +
      row('Apparent wind', `${f(t.awSpeed * MS_TO_KN, 1)} kn`) +
      row('Angle of attack', `${f(t.alpha * RAD, 1)}°`) +
      row('Drive', `${f(t.aeroFwd)} N`) +
      row('Side force', `${f(Math.abs(t.aeroSide))} N`) +
      row('Vertical lift', `${f(t.aeroUp)} N`) +
      row('Boom angle', `${f(Math.abs(sim.rig.boom) * RAD)}°`) +
      row('Rig rake / lean', `${f(sim.rig.rake * RAD)}° / ${f(sim.rig.lean * RAD)}°`) +
      row('Aspect ratio (eff.)', a ? f(a.aspect, 1) : '–') +
      `</dl><h3>Hull & fin</h3><dl>` +
      row('Planing', `${f(t.planing * 100)} %`) +
      row('Trim angle', `${f(t.trim * RAD, 1)}°`) +
      row('Wetted area', `${f(t.wet, 2)} m²`) +
      row('Hull drag', `${f(t.drag)} N`) +
      row('· trim / friction', `${f(h.dTrim)} / ${f(h.dFric)} N`) +
      row('· wave / tail', `${f(h.dWave)} / ${f(h.dTail)} N`) +
      row('Leeway', `${f(t.leeway * RAD, 1)}°`) +
      row('Fin angle / load', `${f(t.finAlpha * RAD, 1)}° / ${f(t.finLoad)} N`) +
      row('Load centre', `${f((t.xLoad - sim.board.transomX) * 100)} cm from tail`) +
      `</dl><h3>Sailor</h3><dl>` +
      row('Pull on hands', `${f(sim.handForce)} N${sim.sailor.hooked ? ' (harness)' : ''}`) +
      row('Heeling moment', `${f(bal.tauPull)} N·m`) +
      row('Body moment', `${f(bal.tauGrav)} N·m`) +
      row('Core / feet', `${f(bal.muscle)} of ±${f(bal.tauMax)} N·m`) +
      row('Lean / balanced at', `${f(sim.sailor.beta * RAD)}° / ${f((sim.betaEq ?? 0) * RAD)}°`) +
      row('Reach (arms or lines)', `${f((sim.betaMin ?? 0) * RAD)}° to ${f((sim.betaMax ?? 0) * RAD)}°${sim.bodyGeo && !sim.bodyGeo.fits ? ' (boom out of reach)' : ''}`) +
      row('Weight out from centreline', `${f((bal.leverMax ?? 0) * 100)} cm at full reach`) +
      `</dl><h3>Jumps</h3><dl>` +
      row('Last', sim.jump ? `${f(sim.jump.height, 2)} m · ${f(sim.jump.air, 1)} s · ${f(sim.jump.dist)} m, ${sim.jump.how}` : '–') +
      row('Best', sim.bestJump ? `${f(sim.bestJump.height, 2)} m · ${f(sim.bestJump.air, 1)} s` : '–') +
      `</dl>`;
  }
}

function stateTitle(st) {
  return {
    [S.WATER]: 'In the water', [S.WATERSTART]: 'Waterstart', [S.UPHAUL]: 'Uphauling', [S.SECURE]: 'Secure position',
    [S.TACK]: 'Tacking', [S.FLIP]: 'Gybe: sail flip', [S.FALLING]: 'Wipeout', [S.CLIMB]: 'Climbing on', [S.RISING]: 'Up and away',
  }[st] ?? 'Now';
}

export { CONTROL_MAP };
