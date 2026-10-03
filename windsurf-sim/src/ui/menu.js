// Start / pause menu: conditions, gear, controls and a technique primer.
// Navigable with a gamepad (D-pad + A/B) as well as mouse and keyboard.
import { BOARDS, BOOM_RATIO, LINES_RATIO, SAILS } from '../physics/gear.js';
import { CONTROL_MAP } from './input.js';
import { LESSONS } from '../coach/lessons.js';

const $ = (id) => document.getElementById(id);

const BEAUFORT = [[1, 'Calm'], [4, 'Light air'], [7, 'Light breeze'], [11, 'Gentle breeze'], [17, 'Moderate breeze'], [22, 'Fresh breeze'], [28, 'Strong breeze'], [34, 'Near gale'], [41, 'Gale']];
const beaufort = (kn) => {
  for (let i = 0; i < BEAUFORT.length; i++) if (kn < BEAUFORT[i][0]) return `Bft ${i} · ${BEAUFORT[i][1]}`;
  return 'Bft 8 · Gale';
};
const boomLabel = (s) => {
  const cm = Math.round(s.height * BOOM_RATIO + s.boomRel);
  const r = cm / s.height;
  const where = r < 0.715 ? 'chest' : r < 0.79 ? 'chest–shoulder' : r < 0.835 ? 'shoulder' : 'chin';
  return `${cm} cm · ${where}`;
};
const linesLabel = (s) => {
  const inch = Math.round((s.height * LINES_RATIO) / 2.54 + (s.linesRel ?? 0));
  return `${inch} in · ${Math.round(inch * 2.54)} cm`;
};
const cmLabel = (v, fwd, back, zero) => (v === 0 ? zero : `${Math.abs(v)} cm ${v < 0 ? fwd : back}`);
const linesPosLabel = (s) => cmLabel(s.tuneLines ?? 0, 'forward', 'back', 'standard');
const mastLabel = (s) => cmLabel(s.tuneMast ?? 0, 'back', 'forward', 'middle of the track');
const HAUL = { downhaul: ['light', 'a touch light', 'normal', 'firm', 'maximum'], outhaul: ['loose · full', 'a touch loose', 'normal', 'firm', 'tight · flat'] };
const haulLabel = (key, v) => HAUL[key][Math.round((v + 1) * 2)];
export const recommendedSail = (massKg, windKn) => (massKg * 1.34) / Math.max(windKn, 5);

const TECHNIQUE = `
<h3>Reading the wind</h3>
<p>The dark patches moving across the water are gusts: more ripples, less reflected sky. They are the same gusts your sail will feel, so watch them coming. The windsock on the beach and the flags on the buoys show the direction. The wind here is side-shore, blowing along the beach.</p>
<h3>Uphaul and get going</h3>
<ol class="steps">
<li>From the water, climb on (A) and hold LB to pull the rig up by the uphaul. Keep your back straight and lift with your legs.</li>
<li>In <b>secure position</b> the sail flags downwind. Tilt the rig toward the nose or tail to turn the board until it's across the wind.</li>
<li>Squeeze RT: your hands go to the boom and the back hand sheets in. Aim for an angle of attack around 15–20°. Too little and the luff flutters; too much and the sail stalls.</li>
</ol>
<h3>Steering</h3>
<p>Below planing speed you steer with the rig. Rake it forward (left stick up) and the centre of effort moves ahead of the fin and daggerboard, so the nose bears away. Rake it back to head up. Sheeting in also moves the centre of effort back, so the board heads up when you pull in.</p>
<p>Once planing you steer with your feet. Sink the leeward rail (toes) to carve away from the wind and the windward rail (heels) to head up. At low speed a heeled hull turns the other way, just like the real thing.</p>
<h3>Getting onto the plane</h3>
<ol class="steps">
<li>Bear away to a beam or broad reach, keep the board flat and your weight forward by the mast foot.</li>
<li>Sheet in, lean the rig slightly to windward and pump (RB) through the hump drag.</li>
<li>When the board releases and the wake goes quiet, move back (right stick down), hook in (A) and step into the front strap, then the back strap (X).</li>
<li>Hang off the harness lines with LT. The balance needle shows the fight between the sail's pull and your body weight. When a gust hits, sheet out a touch. If you're hooked in when it gets too much, it's a catapult.</li>
</ol>
<h3>Hanging off the rig</h3>
<p>Your weight only counters the sail as far out as you can hang. Unhooked that's your arms' reach to the boom; hooked in it's your harness lines. The HUD shows your lean and how far out you can go (lean 24° of 33°). To hang further out, lean the rig to windward (left stick toward the wind): the boom comes out over the water to you. Past about 15° the sail loses more drive than you gain, so sheet out instead.</p>
<p>To hook in, sheet in and come in toward the boom (ease LT) so the lines reach the hook. In the straps the lines sit over your feet and you hang furthest out; hooked in with your feet still forward, you can't.</p>
<p>Hang out with too little wind in the sail (a lull, or LT held in light air) and your weight pulls the rig over on top of you: ease LT when the power drops.</p>
<h3>Leaning back against the pull</h3>
<p>The sail doesn't only pull you out to the side. The rig is pinned at the mast foot and its drive tips it forward; you hold it back through your hands or the harness, so it tips you forward too, over your front foot. You balance that by leaning back, hips back over the tail, until your weight behind your feet matches the pull. The stance panel shows it: the grey bar is where your feet can press (back heel to front toes), the line is where they press, the ring is your centre of mass, and "back" is how far you're leaning back.</p>
<p>Weight forward (right stick up) presses through the front foot and hangs more of your weight on the boom into the mast foot: the nose goes down, for control in chop. Weight back sinks your hips over the tail and frees the board up. On a broad reach the pull swings forward: hang out less and sink back over the back foot.</p>
<p>Walk back along the board before stepping into the front strap, so the step is short. A step moves your feet, not your body: step a long way back while leaning hard against the pull and it drags you forward over your toes.</p>
<h3>Gusts and catapults</h3>
<p>Hooked in, the harness lines can't give. When a gust hits, its extra pull tips you over your front foot faster than you can lean back, and the lines launch you over the boom: a catapult. The stance panel goes amber, then red. As a gust reaches you, sink your weight back (right stick down) and ease the sheet (RT) to spill the extra power, then sheet back in as it passes. Gusts show as dark patches on the water upwind, so get ready before they arrive.</p>
<p>Unhooked, your arms give first: the rig rakes forward, and if the pull keeps dragging you forward you let go with the back hand. In a lull, ease your lean back or you sit down off the tail.</p>
<h3>Tuning the rig</h3>
<p>Set up on the beach, in the Gear menu. <b>Harness lines</b> belong over the sail's draft: then both hands go light and the harness takes the pull (watch the Hands bar). Forward of it the back hand pulls and tires; behind it the front hand does and the sail sheets in on you. Gusts blow the draft back, so a rig balanced in a lull goes back-hand heavy in a gust.</p>
<p><b>Downhaul</b> sets how much the top of the sail twists open under load: more for a windy, gusty day (steadier and faster), less in light wind for power. <b>Outhaul</b> sets the depth: loose and full to plane early, tight and flat for less drag and a draft that stays forward. <b>Mast foot</b> forward keeps the nose down for control; back frees the board up for speed.</p>
<h3>Feel it through the controller</h3>
<p>With rumble on, the low motor carries the sail's load and thumps as a gust fills the sail; it pulses, harder and harder, as the pull tips you toward your toes before a catapult. The high motor buzzes as the fin nears a spin-out and pulses when a hand is about to lose its grip.</p>
<h3>Sailing through chop</h3>
<p>At speed every chop throws the board up and slaps it down: it skips off the tops and flies off the steeper ones (the controller's chatter goes quiet in the air, and it thumps when you land). Slamming costs speed, so flat water is fast. Keep your weight back (right stick down) and a little less sheet in: the nose stays up over the chop. Weight forward, the nose rides into the backs of the waves and can bury: the board stops dead and throws you over the front. In the air your feet steer the board: keep the nose up and land flat or tail first; a high or tail-first landing can drag air down the fin. The mast foot forward keeps the board steadier in rough water. Sailing with the waves on a broad reach smooths the ride; heading up into them is the roughest, and if a big one knocks you off the plane upwind, bear away to get going again.</p>
<h3>Speed on a broad reach</h3>
<p>Once planing, a broad reach (about 120–135° to the wind) is the fastest point of sail: the sail's pull points forward instead of over the side, so you're no longer overpowered. Keep the rig fairly upright, with only enough windward lean to keep the boom within reach (with the boom eased, leaning it more just tips the sail's force upward), sheet in close to the stall and sit back on the tail (right stick down) so the board rides on less water.</p>
<p>Bear away much further and the apparent wind gets lighter as it swings behind you. In a moderate breeze you drop off the plane somewhere past 135°; it takes more wind to plane deep downwind.</p>
<h3>Tack</h3>
<p>Head up by raking the rig back while keeping the sail sheeted in. When the nose approaches the wind, press B and step round the front of the mast. As the nose crosses the wind you change sides; then rake the rig forward to bear away on the new tack. Small boards sink if you tack slowly.</p>
<h3>Carve gybe</h3>
<ol class="steps">
<li>Planing, unhook (A) and take your feet out of the straps (hold X).</li>
<li>Rake the rig forward and to windward, push on your toes (right stick toward the leeward rail) and carve downwind. Keep the sail sheeted in to keep the speed.</li>
<li>At dead downwind press Y to flip the sail: let go with the back hand and the clew swings round the front of the mast.</li>
<li>Grab the new side, keep carving out of the turn and sheet in on the new tack. Flip too early and the sail backwinds; too late and you stall.</li>
</ol>
<h3>Waterstart</h3>
<p>In 12 knots or more you don't need to uphaul. Hold LB to clear the rig and lift it into the wind, steer the board across the wind with the rig, then sheet in. The sail lifts you onto the board. In light wind it won't. Climb on and uphaul instead.</p>
<h3>Glossary</h3>
<dl class="glossary">
<dt>Luff / leech / clew</dt><dd>Front edge on the mast / back edge / back corner at the boom end.</dd>
<dt>Sheet in / out</dt><dd>Pull the back hand in (more power) or let it out (less).</dd>
<dt>Bear away / head up</dt><dd>Turn away from / toward the wind.</dd>
<dt>Planing</dt><dd>Riding on top of the water on dynamic lift instead of floating; drag drops and speed jumps.</dd>
<dt>Spin-out</dt><dd>The fin ventilates and loses grip; the tail slides out. Sheet out and press on the front foot.</dd>
<dt>Catapult</dt><dd>Launched over the boom by a gust while hooked in: its pull tips you over your front foot faster than you can lean back. Sink back and sheet out as gusts hit.</dd>
<dt>Sinker</dt><dd>A board with less volume (litres) than you, your rig and the board weigh (kg): it only floats you when planing.</dd>
<dt>Harness lines</dt><dd>The loop of rope on the boom you hook into. Its length (in inches, typically 26–34") sets how far out you hang.</dd>
<dt>Mast foot pressure</dt><dd>Weight hung through the harness into the mast foot; keeps the nose down at speed.</dd>
</dl>`;

export class Menu {
  constructor(settings, handlers) {
    this.settings = settings;
    this.h = handlers;
    this.el = $('menu');
    this.content = $('menu-content');
    this.tab = 'sail';
    this.started = false;
    this.focusIdx = 0;
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.select(b.dataset.tab);
    });
    this.render();
  }

  get open() { return !this.el.hidden; }

  show() {
    this.el.hidden = false;
    this.select('sail');
  }

  hide() {
    this.el.hidden = true;
  }

  select(tab) {
    this.tab = tab;
    for (const t of document.querySelectorAll('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
    this.render();
  }

  setPadStatus(input) {
    const el = $('pad-status');
    if (input.gamepad) {
      el.textContent = `Controller: ${input.gamepad.id.replace(/\(.*\)/, '').trim() || 'gamepad'}${input.gamepad.vibrationActuator ? ' · rumble supported' : ''}`;
      el.className = 'pad-status ok';
    } else {
      el.textContent = 'No controller detected. Connect one and press any button, or use the keyboard.';
      el.className = 'pad-status';
    }
  }

  render() {
    const s = this.settings;
    const c = this.content;
    const slider = (id, label, min, max, step, value, out) =>
      `<div class="field"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><output id="${id}-out">${out}</output></div>`;
    const toggle = (id, label, checked) => `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${label}</label>`;
    if (this.tab === 'sail' && this.activeLesson) {
      const l = this.activeLesson;
      c.innerHTML = `
        <h2>Paused</h2>
        <p>Lesson: <b>${l.lesson.title}</b> · ${l.mode === 'watch' ? 'watching the coach' : 'your turn'}${l.done ? ' · complete' : ''}.</p>
        <div class="actions">
          <button class="btn primary" id="act-resume">Resume</button>
          <button class="btn" id="act-lesson-restart">Restart lesson</button>
          <button class="btn" id="act-lesson-switch">${l.mode === 'watch' ? 'Try it yourself' : 'Watch the coach'}</button>
          <button class="btn" id="act-lesson-exit">Exit to free sailing</button>
        </div>
        <p class="muted">The Lessons tab has the full list.</p>`;
    } else if (this.tab === 'lessons') {
      c.innerHTML = `
        <h2>Lessons</h2>
        <p class="muted">Watch the coach sail each technique with real controller inputs. The on-screen controller shows every stick, trigger and button. Then take over and do it yourself; the steps tick off as you go.</p>
        <div class="lesson-list">
          ${LESSONS.map((l, i) => `<div class="lesson-row ${this.completed?.has(l.id) ? 'done' : ''}">
            <span class="n">${i + 1}</span>
            <div><b>${l.title}</b><p>${l.summary}</p>
              <div class="spec">${BOARDS.find((x) => x.id === l.setup.boardId)?.name} · ${l.setup.sailArea.toFixed(1)} m² · ${l.setup.wind.speedKn} kn${this.completed?.has(l.id) ? ' · done ✓' : ''}</div></div>
            <div class="acts"><button class="btn primary" data-lesson="${l.id}" data-mode="watch">Watch</button><button class="btn" data-lesson="${l.id}" data-mode="try">Try it</button></div>
          </div>`).join('')}
        </div>`;
    } else if (this.tab === 'sail') {
      const b = BOARDS.find((x) => x.id === s.boardId);
      c.innerHTML = `
        <h2>${this.started ? 'Paused' : 'Go sailing'}</h2>
        <p>${s.windKn} knots side-shore, ${s.gustiness < 0.2 ? 'steady' : s.gustiness < 0.55 ? 'gusty' : 'very gusty'}. You're on the ${b.name} with a ${s.sailArea.toFixed(1)} m² sail and weigh ${s.mass} kg.</p>
        <p class="muted">Start in the secure position with the rig up, in the water to practise waterstarts, or already sailing on a beam reach.</p>
        <p class="small-note muted">Beam Reach needs a keyboard or a game controller.</p>
        <div class="actions">
          ${this.started ? '<button class="btn primary" id="act-resume">Resume</button><button class="btn" id="act-restart-secure">Restart: secure position</button>' : '<button class="btn primary" id="act-secure">Go sailing</button>'}
          <button class="btn" id="act-restart-water">${this.started ? 'Restart' : 'Start'}: in the water</button>
          <button class="btn" id="act-restart-sailing">${this.started ? 'Restart' : 'Start'}: already sailing</button>
        </div>
        <h3>Quick controls</h3>
        <div class="maptable"><table><tbody>
          ${CONTROL_MAP.slice(0, 8).map(([pad, kb, what]) => `<tr><td>${pad}</td><td>${kb}</td><td>${what}</td></tr>`).join('')}
        </tbody></table></div>`;
    } else if (this.tab === 'conditions') {
      c.innerHTML = `
        <h2>Conditions</h2>
        <div class="page">
          ${slider('wind', 'Wind (10 m)', 4, 35, 1, s.windKn, `${s.windKn} kn`)}
          <p class="muted" id="bft">${beaufort(s.windKn)} · ${(s.windKn / 1.944).toFixed(1)} m/s. The sail sits lower than 10 m and sees about 85% of this.</p>
          ${slider('gust', 'Gustiness', 0, 1, 0.05, s.gustiness, `${Math.round(s.gustiness * 100)}%`)}
          ${slider('shifts', 'Wind shifts', 0, 1, 0.05, s.shifts, `${Math.round(s.shifts * 100)}%`)}
          ${slider('chop', 'Chop', 0.2, 2, 0.1, s.chop, `${s.chop.toFixed(1)}×`)}
          <p class="muted">Changes apply immediately. The wind blows side-shore, along the beach.</p>
        </div>`;
    } else if (this.tab === 'gear') {
      const rec = recommendedSail(s.mass, s.windKn);
      const total = s.mass + (BOARDS.find((x) => x.id === s.boardId)?.mass ?? 8) + 9;
      c.innerHTML = `
        <h2>Gear</h2>
        <div class="cards">
          ${BOARDS.map((b) => `<button class="card" data-board="${b.id}" aria-pressed="${b.id === s.boardId}">
            <b>${b.name}</b><span class="spec">${Math.round(b.length * 100)} × ${Math.round(b.width * 100)} cm · fin ${Math.round(b.finDepth * 100)} cm${b.dagger ? ' · daggerboard' : ''}</span>
            <p>${b.blurb}</p>${b.volume < total ? '<span class="spec" style="color:var(--warn)">Sinker at your weight</span>' : ''}</button>`).join('')}
        </div>
        ${slider('sail', 'Sail size', 0, SAILS.length - 1, 1, SAILS.findIndex((x) => Math.abs(x.area - s.sailArea) < 0.05), `${s.sailArea.toFixed(1)} m²`)}
        <p class="rec">Rule of thumb for ${s.mass} kg in ${s.windKn} kn: about ${rec.toFixed(1)} m².</p>
        ${slider('mass', 'Your weight', 50, 110, 1, s.mass, `${s.mass} kg`)}
        ${slider('height', 'Your height', 155, 200, 1, s.height, `${s.height} cm`)}
        ${slider('boom', 'Boom height', -12, 16, 1, s.boomRel, boomLabel(s))}
        ${slider('lines', 'Harness lines', -6, 6, 1, s.linesRel ?? 0, linesLabel(s))}
        <p class="muted">How far out you can hang decides how much power you can hold. Unhooked, it's your arms; hooked in, it's the harness lines. Longer lines let you hang further out but take the boom further from your hands; shorter lines keep you upright and close to the rig. A higher boom lets you lean further out on straight arms but needs longer lines, or the hook won't reach. Leaning the rig to windward brings the boom out over the water to you.</p>
        <h3>Rig tuning</h3>
        ${slider('tlines', 'Harness line position', -10, 10, 1, s.tuneLines ?? 0, linesPosLabel(s))}
        ${slider('tmast', 'Mast foot', -10, 10, 1, s.tuneMast ?? 0, mastLabel(s))}
        ${slider('downhaul', 'Downhaul', -1, 1, 0.5, s.downhaul ?? 0, haulLabel('downhaul', s.downhaul ?? 0))}
        ${slider('outhaul', 'Outhaul', -1, 1, 0.5, s.outhaul ?? 0, haulLabel('outhaul', s.outhaul ?? 0))}
        <p class="muted">Harness lines balanced over the sail's draft leave both hands light (watch the Hands bar). Too far forward and the back hand pulls; too far back and the front hand does, and the sail sheets in on you. The mast foot forward keeps the nose down for control and pointing; back frees the board up for speed. More downhaul twists the top of the sail open: less low-end power, but faster and steadier when it's windy and gusty. A tight outhaul flattens the sail: less power and drag, the draft forward; a loose one is fuller, for planing early, but draggy and back-hand heavy at speed.</p>
        <h3>Assists</h3>
        ${toggle('autohike', 'Auto-hike: the game balances your body against the pull (LT is ignored)', s.autoHike)}
        ${toggle('nofalls', 'No falls: you never get pulled over or fall back', s.noFalls)}
        <p class="muted">Gear changes restart you in the secure position.</p>`;
    } else if (this.tab === 'controls') {
      c.innerHTML = `
        <h2>Controls</h2>
        <p class="muted">Sticks are relative to the board: push the left stick where you want the mast tip to go, push the right stick toward the rail you want to sink. Every trigger is analog.</p>
        <div class="maptable"><table><thead><tr><th>Controller</th><th>Keyboard</th><th>Action</th></tr></thead><tbody>
          ${CONTROL_MAP.map(([pad, kb, what]) => `<tr><td>${pad}</td><td>${kb}</td><td>${what}</td></tr>`).join('')}
        </tbody></table></div>
        <h3>Options</h3>
        ${toggle('rumble', 'Rumble: feel the load in the sail, gusts arriving and the chop; pulses warn of a catapult coming, a fin about to spin out or a hand losing its grip', s.rumble)}
        ${toggle('invert', 'Invert rig rake (stick up = rig back)', s.invertRake)}
        ${toggle('particles', 'Wind particles: specks drifting with the wind', s.windParticles)}
        ${toggle('shake', 'Camera sway over chop', s.cameraShake)}
        ${slider('volume', 'Volume', 0, 1, 0.05, s.volume, `${Math.round(s.volume * 100)}%`)}`;
    } else {
      c.innerHTML = `<h2>Technique</h2>${TECHNIQUE}`;
    }
    this.wire();
    this.focusIdx = 0;
    // Land on the main action so a gamepad's A button starts sailing.
    const primary = this.content.querySelector('.btn.primary');
    if (primary && !this.el.hidden) primary.focus({ preventScroll: true });
  }

  wire() {
    const s = this.settings, h = this.h;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('act-resume', 'click', () => h.resume());
    on('act-secure', 'click', () => h.start('secure'));
    on('act-restart-secure', 'click', () => h.start('secure'));
    on('act-restart-water', 'click', () => h.start('water'));
    on('act-restart-sailing', 'click', () => h.start('sailing'));
    on('act-lesson-restart', 'click', () => h.lesson(this.activeLesson.lesson.id, this.activeLesson.mode));
    on('act-lesson-switch', 'click', () => h.lesson(this.activeLesson.lesson.id, this.activeLesson.mode === 'watch' ? 'try' : 'watch'));
    on('act-lesson-exit', 'click', () => h.exitLesson());
    for (const b of this.content.querySelectorAll('[data-lesson]')) {
      b.addEventListener('click', () => h.lesson(b.dataset.lesson, b.dataset.mode));
    }
    const range = (id, key, fmt, apply) => on(id, 'input', (e) => {
      const v = parseFloat(e.target.value);
      $(`${id}-out`).textContent = fmt(v);
      apply(v);
    });
    range('wind', 'windKn', (v) => `${v} kn`, (v) => { s.windKn = v; $('bft').textContent = `${beaufort(v)} · ${(v / 1.944).toFixed(1)} m/s. The sail sits lower than 10 m and sees about 85% of this.`; h.conditions(); });
    range('gust', 'gustiness', (v) => `${Math.round(v * 100)}%`, (v) => { s.gustiness = v; h.conditions(); });
    range('shifts', 'shifts', (v) => `${Math.round(v * 100)}%`, (v) => { s.shifts = v; h.conditions(); });
    range('chop', 'chop', (v) => `${v.toFixed(1)}×`, (v) => { s.chop = v; h.conditions(); });
    range('sail', 'sail', (v) => `${SAILS[v].area.toFixed(1)} m²`, (v) => { s.sailArea = SAILS[v].area; h.gear(); });
    range('mass', 'mass', (v) => `${v} kg`, (v) => { s.mass = v; h.gear(); });
    range('height', 'height', (v) => `${v} cm`, (v) => {
      s.height = v;
      const o = $('boom-out'), l = $('lines-out');
      if (o) o.textContent = boomLabel(s);
      if (l) l.textContent = linesLabel(s);
      h.gear();
    });
    range('lines', 'linesRel', () => '', (v) => { s.linesRel = v; $('lines-out').textContent = linesLabel(s); h.gear(); });
    range('boom', 'boomRel', () => '', (v) => { s.boomRel = v; $('boom-out').textContent = boomLabel(s); h.gear(); });
    range('tlines', 'tuneLines', () => '', (v) => { s.tuneLines = v; $('tlines-out').textContent = linesPosLabel(s); h.gear(); });
    range('tmast', 'tuneMast', () => '', (v) => { s.tuneMast = v; $('tmast-out').textContent = mastLabel(s); h.gear(); });
    range('downhaul', 'downhaul', (v) => haulLabel('downhaul', v), (v) => { s.downhaul = v; h.gear(); });
    range('outhaul', 'outhaul', (v) => haulLabel('outhaul', v), (v) => { s.outhaul = v; h.gear(); });
    range('volume', 'volume', (v) => `${Math.round(v * 100)}%`, (v) => { s.volume = v; h.options(); });
    for (const card of this.content.querySelectorAll('[data-board]')) {
      card.addEventListener('click', () => { s.boardId = card.dataset.board; h.gear(); this.render(); });
    }
    on('autohike', 'change', (e) => { s.autoHike = e.target.checked; h.options(); });
    on('nofalls', 'change', (e) => { s.noFalls = e.target.checked; h.options(); });
    on('rumble', 'change', (e) => { s.rumble = e.target.checked; h.options(); });
    on('invert', 'change', (e) => { s.invertRake = e.target.checked; h.options(); });
    on('particles', 'change', (e) => { s.windParticles = e.target.checked; h.options(); });
    on('shake', 'change', (e) => { s.cameraShake = e.target.checked; h.options(); });
    // Re-render the rule-of-thumb line when the weight changes.
    on('mass', 'change', () => this.render());
  }

  /** Gamepad navigation over the visible focusable elements. */
  pad(ui) {
    const items = [...document.querySelectorAll('#tabs .tab, #menu-content button, #menu-content input')];
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    let i = cur < 0 ? this.focusIdx : cur;
    if (ui.padDown) i = Math.min(items.length - 1, i + 1);
    if (ui.padUp) i = Math.max(0, i - 1);
    if (ui.padDown || ui.padUp) { items[i].focus(); this.focusIdx = i; }
    const el = items[i];
    if (el && el.type === 'range' && (ui.padLeft || ui.padRight)) {
      el.value = String(parseFloat(el.value) + (ui.padRight ? 1 : -1) * parseFloat(el.step || '1'));
      el.dispatchEvent(new Event('input'));
    } else if (el && ui.padLeft && el.classList.contains('tab')) {
      // nothing
    }
    if (ui.padA && el) {
      if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); }
      else el.click();
    }
  }
}
