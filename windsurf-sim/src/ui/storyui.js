// The story card: the chapter, a dot for each of its goals (done, now, still
// to come), and the goal you're on with its progress and an arrow to the mark
// to head for. Below it, Kai, your instructor: the chapter's opening words,
// then a tip for each goal in your own controller's buttons (and, if you're
// stuck on one, where to find his lesson on it).
import { CHAPTERS } from '../game/career.js';
import { RAD } from '../physics/math.js';
import { LessonUi } from './lessonui.js';

const $ = (id) => document.getElementById(id);
/** How long the chapter's opening words stay up (s). */
const INTRO = 9;
/** How long a new tip stays bright before it fades back a little (s). */
const TIP = 16;
/** On one goal this long, Kai offers his lesson on it (s). */
const STUCK = 75;

export class StoryUi {
  constructor() {
    this.panel = $('story');
    this.kai = $('kai');
    this.last = {};
  }

  show(on) {
    this.panel.hidden = !on;
    this.kai.hidden = !on;
    document.getElementById('hud').classList.toggle('story-on', on);
    this.last = {};
    this.goal = null;
  }

  set(id, html) {
    if (this.last[id] === html) return;
    this.last[id] = html;
    $(id).innerHTML = html;
  }

  update(run, sim, glyphs, since) {
    const ch = run.chapter;
    const cur = run.current;
    this.set('story-eyebrow', `Chapter ${CHAPTERS.indexOf(ch) + 1} of ${CHAPTERS.length} · ${ch.title}`);
    this.set('story-dots', run.goals.map((g) => `<li class="${g.done ? 'done' : g === cur ? 'now' : ''}"></li>`).join(''));
    $('story-now').classList.toggle('complete', run.complete);
    this.set('story-goal', run.complete ? 'Chapter complete!' : cur.goal.text);
    // Progress on it, or how far to the mark and which way (relative to the board).
    const t = run.target;
    let label = run.complete ? '' : cur.tracker.label;
    $('story-arrow-svg').style.display = t ? '' : 'none';
    if (t) {
      const vx = t.at[0] - sim.pos[0], vz = t.at[1] - sim.pos[2];
      const fwd = vx * Math.cos(sim.yaw) - vz * Math.sin(sim.yaw), right = vx * Math.sin(sim.yaw) + vz * Math.cos(sim.yaw);
      $('story-arrow').setAttribute('transform', `rotate(${(Math.atan2(right, fwd) * RAD).toFixed(0)})`);
      label = `${Math.round(Math.hypot(vx, vz))} m`;
    }
    this.set('story-p', label);
    const p = run.complete ? 1 : cur.tracker.p;
    $('story-bar-wrap').style.visibility = p > 0 && (p < 1 || run.complete) && !t ? 'visible' : 'hidden';
    $('story-bar').style.width = `${(p * 100).toFixed(0)}%`;

    // Kai.
    if (cur !== this.goal) { this.goal = cur; this.goalSince = sim.t; }
    let text, bright = true;
    if (sim.t - since < INTRO && !run.fresh) text = `<b>${ch.title}.</b> ${ch.intro}`;
    else if (run.complete) text = `<b>Nice sailing!</b> ${ch.outro} {MENU} for what's next.`;
    else if (cur.goal.lesson && sim.t - this.goalSince > STUCK) text = `${cur.goal.hint} Stuck? Pause ({MENU}) and I'll show you.`;
    else { text = cur.goal.hint; bright = sim.t - this.goalSince < TIP; }
    this.set('kai-text', LessonUi.caption(text, glyphs));
    this.kai.classList.toggle('quiet', !bright);
  }
}
