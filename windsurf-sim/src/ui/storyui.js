// The story card: the chapter's goals with a tick for each one done and
// progress on the one you're working on, Kai's hint for it in your own
// controller's buttons, and an arrow to the mark to head for.
import { CHAPTERS } from '../game/career.js';
import { RAD } from '../physics/math.js';
import { LessonUi } from './lessonui.js';

const $ = (id) => document.getElementById(id);
/** How long the chapter's opening words stay up (s). */
const INTRO = 9;

export class StoryUi {
  constructor() {
    this.panel = $('story');
    this.last = {};
  }

  show(on) {
    this.panel.hidden = !on;
    document.getElementById('hud').classList.toggle('story-on', on);
    this.last = {};
  }

  set(id, html) {
    if (this.last[id] === html) return;
    this.last[id] = html;
    $(id).innerHTML = html;
  }

  update(run, sim, glyphs, since) {
    const ch = run.chapter;
    this.set('story-eyebrow', `Chapter ${CHAPTERS.indexOf(ch) + 1} of ${CHAPTERS.length} · ${ch.title}`);
    this.set('story-mode', run.complete ? 'Complete' : 'Story');
    const cur = run.current;
    this.set('story-goals', run.goals.map((g) => {
      const now = g === cur;
      const p = g.tracker.p;
      return `<li class="${g.done ? 'done' : now ? 'now' : ''}"><span>${g.goal.text}</span><span class="p">${now ? g.tracker.label : ''}</span>${now && p > 0 && p < 1 ? `<span class="bar"><i style="width:${(p * 100).toFixed(0)}%"></i></span>` : ''}</li>`;
    }).join(''));
    let hint;
    if (sim.t - since < INTRO && !run.fresh) hint = `<span class="kai">${ch.title}.</span> ${ch.intro}`;
    else if (run.complete) hint = `<span class="kai">Chapter complete.</span> ${ch.outro}`;
    else hint = cur.goal.hint;
    this.set('story-hint', LessonUi.caption(hint, glyphs));
    // The mark to head for, relative to the board's heading.
    const t = run.target;
    $('story-target').hidden = !t;
    if (t) {
      const vx = t.at[0] - sim.pos[0], vz = t.at[1] - sim.pos[2];
      const fwd = vx * Math.cos(sim.yaw) - vz * Math.sin(sim.yaw), right = vx * Math.sin(sim.yaw) + vz * Math.cos(sim.yaw);
      $('story-arrow').setAttribute('transform', `rotate(${(Math.atan2(right, fwd) * RAD).toFixed(0)})`);
      this.set('story-target-t', LessonUi.caption(`${t.name[0].toUpperCase()}${t.name.slice(1)}: ${Math.round(Math.hypot(vx, vz))} m · {R3} to look toward it`, glyphs));
    }
    const lesson = cur?.goal.lesson ? ' · stuck? Pause for Kai\'s lesson on it' : '';
    this.set('story-foot', LessonUi.caption(run.complete ? `${glyphs.MENU} for the next chapter` : `${glyphs.MENU} pause, restart${lesson}`, glyphs));
  }
}
