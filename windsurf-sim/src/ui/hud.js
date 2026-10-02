// Heads-up display: GPS-style speed, wind instrument, balance strip, stance
// diagram, context hints with the right button glyphs, event toasts and the
// telemetry panel for those who want the numbers.
import { DEG, MS_TO_KN, RAD, clamp } from '../physics/math.js';
import { S } from '../physics/sim.js';
import { CONTROL_MAP } from './input.js';

const $ = (id) => document.getElementById(id);

const GLYPHS = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', LS: 'L-stick', RS: 'R-stick', L3: 'L3', MENU: 'Menu' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', LS: 'L-stick', RS: 'R-stick', L3: 'L3', MENU: 'Options' },
  kb: { A: 'H', B: 'T', X: 'F', Y: 'G', LB: 'U', RB: 'P', LT: 'C / Z', RT: 'E / Q', LS: 'W A S D', RS: 'Arrows', L3: 'X', MENU: 'Esc' },
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
    $('f-pull').style.width = `${clamp(pull / 800, 0, 1) * 100}%`;
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
    const holding = sim.state === S.SAILING || sim.state === S.FLIP || sim.state === S.TACK;
    $('bal-text').textContent = holding ? `lean ${(sim.sailor.beta * RAD).toFixed(0)}°${sim.state === S.SAILING && sim.betaMax !== undefined ? ` of ${(sim.betaMax * RAD).toFixed(0)}°` : ''}` : '—';
    $('v-sheet').textContent = (controls.sheet * 100).toFixed(0);
    $('v-hike').textContent = (controls.hike * 100).toFixed(0);
    $('v-pull').textContent = `${pull.toFixed(0)} N`;
    $('v-arms').textContent = `${(sim.sailor.stamina * 100).toFixed(0)}%`;
    this.drawStance(sim);
    this.drawHints(sim, input);
    if (this.telemetryOn) this.drawTelemetry(sim);
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
    let feet = '';
    const fx = (x, z) => `<ellipse cx="${(z * k * 0.9).toFixed(1)}" cy="${y(x)}" rx="5" ry="9" fill="#ffc531"/>`;
    if (sim.state === S.SAILING || sim.state === S.FLIP) {
      if (s.straps === 2) feet = fx(b.frontStrapX, sideX * 0.29 * b.width) + fx(b.backStrapX, sideX * 0.2 * b.width);
      else if (s.straps === 1) feet = fx(b.frontStrapX, sideX * 0.29 * b.width) + fx(s.x - 0.32, sideX * 0.04);
      else feet = fx(s.x + 0.26, sideX * 0.03) + fx(s.x - 0.32, sideX * 0.06);
      const lx = sim.feetLoadX();
      feet += `<line x1="-30" x2="30" y1="${y(lx)}" y2="${y(lx)}" stroke="#69d4ea" stroke-width="1.5" stroke-dasharray="3 3"/>`;
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
      `<circle cx="0" cy="${y(b.mastFootX)}" r="4" fill="#e9f2f5"/>` + feet +
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
      case S.SAILING:
        if (!planing) {
          add(g.RT, 'Sheet in: angle of attack 15–20°');
          add(`${g.LS} ↑`, 'Bear away to a beam / broad reach');
          add(`${g.RB} hold`, 'Pump to get over the hump');
          add(`${g.RS} ↑`, 'Weight forward, board flat');
          add(g.B, 'Tack (head up first)');
        } else {
          if (!s.hooked) add(g.A, 'Hook in');
          else add(g.A, 'Unhook (before a gybe)');
          if (s.straps < 2) add(g.X, s.straps === 0 ? 'Front foot into the strap' : 'Back foot into the strap');
          else add(`${g.X} hold`, 'Feet out for a gybe');
          add(g.LT, 'Hike out against the pull');
          add(g.RS, 'Rail: carve with toes / heels');
          add(g.Y, 'Flip the sail at dead downwind');
        }
        break;
      default:
        break;
    }
    $('hint-title').textContent = sim.state === S.SAILING ? (planing ? 'Planing' : 'Sailing') : stateTitle(sim.state);
    $('hints').innerHTML = list.slice(0, 5).join('');
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
