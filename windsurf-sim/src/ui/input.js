// Gamepad (Xbox / PlayStation, standard mapping) and keyboard input, turned
// into the normalised controls the simulation consumes. Sticks are board-
// relative: push the left stick where you want the mast tip to go, push the
// right stick toward the rail you want to sink.
import { emptyControls } from '../physics/sim.js';
import { clamp } from '../physics/math.js';

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

function deadzone(x, y, dz = 0.14) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

/**
 * Pushing mostly one way, the other axis only counts past a margin that
 * grows with the push: steering with the rig forward doesn't lean it
 * sideways by accident (a rig leaned to leeward pulls you over).
 */
function axial(x, y, k = 0.35) {
  const cross = (a, b) => {
    const m = k * Math.abs(b);
    return Math.abs(a) <= m ? 0 : Math.sign(a) * (Math.abs(a) - m) / (1 - m);
  };
  return [cross(x, y), cross(y, x)];
}

export const CONTROL_MAP = [
  ['Left stick ↑ / ↓', 'W / S', 'Rake the rig toward the nose (bear away) or tail (head up)'],
  ['Left stick ← / →', 'A / D', 'Lean the rig to port / starboard (windward lean = lift)'],
  ['Right stick ↑ / ↓', '↑ / ↓', 'Weight on front / back foot; push past halfway to step along the board'],
  ['Right stick ← / →', '← / →', 'Sink the port / starboard rail (toes or heels): carve when planing'],
  ['RT (R2)', 'E more · Q less', 'Sheet in with the back hand (analog)'],
  ['LT (L2)', 'C more · Z less', 'Hike out: hang your body weight outboard (analog)'],
  ['A (✕)', 'H', 'Hook in / unhook the harness · climb onto the board when in the water'],
  ['X (□)', 'F (tap / hold)', 'Tap: step into the next footstrap · Hold: feet out of the straps'],
  ['B (○)', 'T', 'Tack: step round the front of the mast'],
  ['Y (△)', 'G', 'Flip the sail (gybe) · swap sides in secure position'],
  ['LB (L1) hold', 'U / J hold', 'Uphaul when on the board · waterstart when in the water · sailing: crouch, let go to pop (jump)'],
  ['LB + Y / X / A / B', 'U + G / F / H / T', 'Freestyle, from a crouch: duck gybe · carving 360 · spock · helitack'],
  ['RB (R1) hold', 'P hold', 'Pump the sail to get onto the plane'],
  ['L3 click', 'X', 'Drop the rig'],
  ['D-pad ← / →', 'V', 'Change camera'],
  ['R3 click', 'L', 'Story: look toward the buoy you\'re heading for (again to look back)'],
  ['D-pad ↑ / ↓', 'Mouse wheel', 'Camera distance'],
  ['View / Share', 'Tab', 'Telemetry panel'],
  ['Menu / Options', 'Esc', 'Pause, conditions and gear'],
];

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.prevButtons = [];
    this.xHeld = 0;
    this.kbAxes = { rake: 0, lean: 0, weight: 0, rail: 0 };
    this.kbSheet = 0;
    this.kbHike = 0;
    this.fHeld = 0;
    this.ui = {};
    this.gamepad = null;
    this.lastDevice = 'none'; // 'keyboard' or 'gamepad' once one is used
    this.rumbleEnabled = true;
    this.invertRake = false;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.keyPressed(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyF' && this.fHeld < 0.3) this.pending.straps = true;
      if (e.code === 'KeyF') this.fHeld = 0;
    });
    window.addEventListener('blur', () => this.keys.clear());
    this.pending = {};
    this.pendingUi = {};
    // Mouse: drag to orbit the free camera, wheel to zoom.
    let dragging = false, lx = 0, ly = 0;
    target.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.pendingUi.drag = [(this.pendingUi.drag?.[0] ?? 0) + e.clientX - lx, (this.pendingUi.drag?.[1] ?? 0) + e.clientY - ly];
      lx = e.clientX; ly = e.clientY;
    });
    target.addEventListener('wheel', (e) => { this.pendingUi.zoom = (this.pendingUi.zoom ?? 1) * (e.deltaY > 0 ? 1.08 : 1 / 1.08); }, { passive: true });
  }

  keyPressed(code) {
    const p = this.pending, u = this.pendingUi;
    switch (code) {
      case 'KeyH': p.hook = true; p.climb = true; break;
      case 'KeyT': p.tack = true; break;
      case 'KeyG': p.flip = true; break;
      case 'KeyX': p.drop = true; break;
      case 'KeyV': u.camNext = true; break;
      case 'KeyL': u.lookGoal = true; break;
      case 'Tab': u.telemetry = true; break;
      case 'Escape': u.pause = true; break;
      case 'KeyM': u.mute = true; break;
      default: break;
    }
  }

  get connected() {
    return !!this.gamepad;
  }

  /** Read devices; returns {controls, ui}. */
  poll(dt) {
    const c = emptyControls();
    const ui = { ...this.pendingUi };
    Object.assign(c.pressed, this.pending);
    this.pending = {};
    this.pendingUi = {};

    // Keyboard: smoothed pseudo-analog axes, persistent sheet/hike levels.
    const k = (code) => this.keys.has(code);
    const axis = (neg, pos) => (k(pos) ? 1 : 0) - (k(neg) ? 1 : 0);
    const smooth = (cur, target) => {
      const rate = target === 0 ? 7 : 4;
      return cur + clamp(target - cur, -rate * dt, rate * dt);
    };
    const kb = this.kbAxes;
    kb.rake = smooth(kb.rake, axis('KeyS', 'KeyW'));
    kb.lean = smooth(kb.lean, axis('KeyA', 'KeyD'));
    kb.weight = smooth(kb.weight, axis('ArrowDown', 'ArrowUp'));
    kb.rail = smooth(kb.rail, axis('ArrowLeft', 'ArrowRight'));
    this.kbSheet = clamp(this.kbSheet + axis('KeyQ', 'KeyE') * 0.7 * dt, 0, 1);
    this.kbHike = clamp(this.kbHike + axis('KeyZ', 'KeyC') * 0.7 * dt, 0, 1);
    if (k('Space')) this.kbSheet = Math.max(0, this.kbSheet - 3 * dt);
    if (k('KeyF')) this.fHeld += dt;
    c.rake = kb.rake; c.lean = kb.lean; c.weight = kb.weight; c.rail = kb.rail;
    c.sheet = this.kbSheet; c.hike = this.kbHike;
    c.pump = k('KeyP');
    c.uphaul = k('KeyU');
    c.pop = k('KeyU') || k('KeyJ');
    c.strapsHeld = this.fHeld > 0.3;

    // Gamepad overrides when it's being used.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected && (!gp || p.mapping === 'standard')) gp = p;
    this.gamepad = gp;
    if (gp) {
      const b = (i) => gp.buttons[i] ? gp.buttons[i].pressed : false;
      const v = (i) => gp.buttons[i] ? gp.buttons[i].value : 0;
      const [lx, ly] = axial(...deadzone(gp.axes[0] ?? 0, gp.axes[1] ?? 0));
      const [rx, ry] = deadzone(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
      const rt = v(BTN.RT), lt = v(BTN.LT);
      const active = Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) + rt + lt > 0.05 ||
        gp.buttons.some((x) => x.pressed);
      if (active) this.lastDevice = 'gamepad';
      if (this.lastDevice === 'gamepad') {
        c.rake = -ly * (this.invertRake ? -1 : 1);
        c.lean = lx;
        c.weight = -ry;
        c.rail = rx;
        c.sheet = rt;
        c.hike = lt;
        c.pump = b(BTN.RB);
        c.uphaul = b(BTN.LB);
        c.pop = b(BTN.LB);
      }
      const prev = this.prevButtons;
      const edge = (i) => b(i) && !prev[i];
      if (edge(BTN.A)) { c.pressed.hook = true; c.pressed.climb = true; }
      if (edge(BTN.B)) c.pressed.tack = true;
      if (edge(BTN.Y)) c.pressed.flip = true;
      if (edge(BTN.L3)) c.pressed.drop = true;
      if (edge(BTN.R3)) ui.lookGoal = true;
      if (edge(BTN.START)) ui.pause = true;
      if (edge(BTN.BACK)) ui.telemetry = true;
      if (edge(BTN.LEFT)) ui.camPrev = true;
      if (edge(BTN.RIGHT)) ui.camNext = true;
      if (b(BTN.UP)) ui.zoom = (ui.zoom ?? 1) * (1 - dt * 0.8);
      if (b(BTN.DOWN)) ui.zoom = (ui.zoom ?? 1) * (1 + dt * 0.8);
      // X: tap to step into a strap, hold to take the feet out.
      if (b(BTN.X)) this.xHeld += dt;
      else {
        if (prev[BTN.X] && this.xHeld < 0.3) c.pressed.straps = true;
        this.xHeld = 0;
      }
      if (this.xHeld > 0.3) c.strapsHeld = true;
      // Menu navigation helpers.
      ui.padA = edge(BTN.A); ui.padB = edge(BTN.B);
      ui.padUp = edge(BTN.UP); ui.padDown = edge(BTN.DOWN);
      ui.padLeft = edge(BTN.LEFT); ui.padRight = edge(BTN.RIGHT);
      this.prevButtons = gp.buttons.map((x) => x.pressed);
    }
    return { controls: c, ui };
  }

  /** Dual-motor rumble: strong = low-frequency motor (sail load), weak = high-frequency (chop, flutter). */
  rumble(strong, weak, ms = 120) {
    if (!this.rumbleEnabled || !this.gamepad || this.lastDevice !== 'gamepad') return;
    const act = this.gamepad.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', {
      startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1),
    }).catch(() => {});
  }
}
