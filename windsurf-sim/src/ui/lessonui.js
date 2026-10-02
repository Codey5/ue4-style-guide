// Lesson captions and the on-screen controller that shows exactly what the
// coach (or you) is doing with the sticks, triggers and buttons.

const $ = (id) => document.getElementById(id);
const PRESS_MAP = { hook: 'A', climb: 'A', straps: 'X', tack: 'B', flip: 'Y', drop: 'L3' };

export class LessonUi {
  constructor() {
    this.panel = $('lesson');
    this.pad = $('padviz');
    this.flash = {};
    this.lastKey = '';
    this.buildPad();
  }

  buildPad() {
    this.pad.innerHTML = `
      <div class="label" id="pad-title">Coach's controller</div>
      <svg viewBox="0 0 240 150" aria-hidden="true" class="padsvg">
        <path class="pad-body" d="M44,38 Q64,28 120,30 Q176,28 196,38 Q228,58 226,108 Q223,140 196,134 Q178,128 168,110 L72,110 Q62,128 44,134 Q17,140 14,108 Q12,58 44,38 Z"/>
        <g id="pv-lt"><rect class="pv-track" x="30" y="2" width="52" height="12" rx="4"/><rect class="pv-fill" x="30" y="2" width="0" height="12" rx="4"/><text x="56" y="11" class="pv-t" id="pv-lt-t">LT hike</text></g>
        <g id="pv-rt"><rect class="pv-track" x="158" y="2" width="52" height="12" rx="4"/><rect class="pv-fill" x="158" y="2" width="0" height="12" rx="4"/><text x="184" y="11" class="pv-t" id="pv-rt-t">RT sheet</text></g>
        <g id="pv-lb"><rect class="pv-btn-r" x="30" y="17" width="52" height="11" rx="4"/><text x="56" y="25.5" class="pv-t" id="pv-lb-t">LB uphaul</text></g>
        <g id="pv-rb"><rect class="pv-btn-r" x="158" y="17" width="52" height="11" rx="4"/><text x="184" y="25.5" class="pv-t" id="pv-rb-t">RB pump</text></g>
        <circle class="pv-well" cx="66" cy="66" r="18" id="pv-ls-well"/><circle class="pv-knob" cx="66" cy="66" r="8" id="pv-ls"/>
        <text x="66" y="98" class="pv-t">rig</text>
        <circle class="pv-well" cx="150" cy="92" r="16"/><circle class="pv-knob" cx="150" cy="92" r="7" id="pv-rs"/>
        <text x="150" y="121" class="pv-t">body</text>
        <g class="pv-face">
          <circle cx="190" cy="52" r="8" id="pv-Y"/><text x="190" y="55.5" class="pv-g" id="pv-Y-t">Y</text>
          <circle cx="205" cy="66" r="8" id="pv-B"/><text x="205" y="69.5" class="pv-g" id="pv-B-t">B</text>
          <circle cx="190" cy="80" r="8" id="pv-A"/><text x="190" y="83.5" class="pv-g" id="pv-A-t">A</text>
          <circle cx="175" cy="66" r="8" id="pv-X"/><text x="175" y="69.5" class="pv-g" id="pv-X-t">X</text>
        </g>
      </svg>
      <div class="pv-legend" id="pv-legend"></div>`;
  }

  show(on) {
    this.panel.hidden = !on;
    this.pad.hidden = !on;
    document.getElementById('hud').classList.toggle('lesson-on', on);
  }

  setGlyphs(g, isPs) {
    const key = `${g.A}${g.LT}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const set = (id, t) => { $(id).textContent = t; };
    set('pv-A-t', isPs ? '✕' : 'A'); set('pv-B-t', isPs ? '○' : 'B'); set('pv-X-t', isPs ? '□' : 'X'); set('pv-Y-t', isPs ? '△' : 'Y');
    set('pv-lt-t', `${isPs ? 'L2' : 'LT'} hike`); set('pv-rt-t', `${isPs ? 'R2' : 'RT'} sheet`);
    set('pv-lb-t', `${isPs ? 'L1' : 'LB'} uphaul`); set('pv-rb-t', `${isPs ? 'R1' : 'RB'} pump`);
  }

  /** Fill caption tokens like {RT} with the player's glyphs. */
  static caption(text, g) {
    return text.replace(/\{(\w+)\}/g, (_, k) => `<span class="key">${g[k] ?? k}</span>`);
  }

  update(dt, runner, controls, pressed, glyphs, isPs, info) {
    if (!runner) return;
    this.setGlyphs(glyphs, isPs);
    const l = runner.lesson;
    const watch = runner.mode === 'watch';
    $('lesson-eyebrow').textContent = `Lesson ${info.index + 1} of ${info.count} · ${l.title}`;
    $('lesson-mode').textContent = watch ? 'Watching the coach' : 'Your turn';
    $('lesson-mode').className = `lesson-mode ${watch ? '' : 'you'}`;
    $('pad-title').textContent = watch ? "Coach's controller" : 'Your controller';
    let text;
    if (runner.done) text = watch ? 'That\'s the technique. Now try it yourself.' : 'Lesson complete. Nicely sailed!';
    else {
      text = runner.current.say;
      if (!watch && info.inWater && l.setup.start !== 'water') text = "You're in the water. Waterstart ({LB} hold) or climb on ({A}) and uphaul, then carry on with: " + text;
    }
    const html = LessonUi.caption(text, glyphs);
    if (html !== this.lastText) { $('lesson-step').innerHTML = html; this.lastText = html; }
    const dots = l.steps.map((_, i) => `<li class="${i < runner.step || runner.done ? 'done' : i === runner.step ? 'now' : ''}"></li>`).join('');
    if (dots !== this.lastDots) { $('lesson-dots').innerHTML = dots; this.lastDots = dots; }
    const foot = watch
      ? `{Y} try it yourself · ${glyphs.MENU} pause, lessons, exit`
      : runner.done ? `${glyphs.MENU} for the next lesson` : `${glyphs.MENU} pause · restart or watch the coach again`;
    const fh = LessonUi.caption(foot, glyphs);
    if (fh !== this.lastFoot) { $('lesson-foot').innerHTML = fh; this.lastFoot = fh; }

    // Controller overlay.
    for (const k of Object.keys(this.flash)) this.flash[k] = Math.max(0, this.flash[k] - dt);
    for (const [name, on] of Object.entries(pressed)) if (on && PRESS_MAP[name]) this.flash[PRESS_MAP[name]] = 0.45;
    if (controls.strapsHeld) this.flash.X = Math.max(this.flash.X ?? 0, 0.1);
    const lit = (id, on) => $(id).classList.toggle('on', !!on);
    for (const b of ['A', 'B', 'X', 'Y']) lit(`pv-${b}`, this.flash[b] > 0);
    $('pv-ls').setAttribute('cx', (66 + controls.lean * 11).toFixed(1));
    $('pv-ls').setAttribute('cy', (66 - controls.rake * 11).toFixed(1));
    lit('pv-ls-well', this.flash.L3 > 0);
    $('pv-rs').setAttribute('cx', (150 + controls.rail * 10).toFixed(1));
    $('pv-rs').setAttribute('cy', (92 - controls.weight * 10).toFixed(1));
    $('pv-lt').querySelector('.pv-fill').setAttribute('width', (52 * controls.hike).toFixed(1));
    $('pv-rt').querySelector('.pv-fill').setAttribute('width', (52 * controls.sheet).toFixed(1));
    lit('pv-lb', controls.uphaul);
    lit('pv-rb', controls.pump);
    const legend = `Rig rake ${signed(controls.rake)} · lean ${signed(controls.lean)}<br>Weight ${signed(controls.weight)} · rail ${signed(controls.rail)}`;
    if (legend !== this.lastLegend) { $('pv-legend').innerHTML = legend; this.lastLegend = legend; }
  }
}

const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;
