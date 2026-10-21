// The tuning panel: every live tweak (tweaks.js) as a slider, grouped, that
// applies the moment it moves, while you sail. Hover a setting for exactly
// what it does; click its number to type any value (past the slider's ends
// too, for testing extremes). Changed values are marked, each has its own
// reset, and "Copy changes" gives just what you changed as a few lines of
// text to send back to be made the new defaults (or to paste into another
// browser with "Paste"). "Coach sails" hands the board to the autopilot,
// so you can tune while watching someone sail.
import {
  TWEAKS, TWEAK_GROUPS, applyTweaks, changedTweaks, getTweak, isBeyond, isChanged, onTweak, resetAllTweaks, resetTweak, setTweak,
} from '../tweaks.js';

const decimals = (step) => Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));
/** On the slider's steps: its usual decimals; typed: as many as it has (up to 4). */
const show = (d, v) => {
  const fixed = v.toFixed(decimals(d.step));
  return Math.abs(+fixed - v) < 1e-9 ? fixed : String(+v.toFixed(4));
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TuneUi {
  constructor() {
    const el = this.el = document.createElement('aside');
    el.id = 'tune';
    el.className = 'tune';
    el.hidden = true;
    el.setAttribute('aria-label', 'Tuning');
    el.innerHTML = `
      <header class="tune-head">
        <div><b>Tuning</b> <span class="tune-count" id="tune-count"></span></div>
        <button class="tune-x" id="tune-close" title="Close (\` or F2)" aria-label="Close">×</button>
      </header>
      <p class="tune-intro">Changes apply as you sail and are kept in this browser. Hover a setting for what it does; click its number to type any value. When it feels right, <b>Copy changes</b> and send them over to make them the defaults.</p>
      <label class="tune-cruise"><input type="checkbox" id="tune-cruise"> <span><b>Coach sails</b>: the autopilot sails round while you watch and tune (any stick takes over)</span></label>
      <div class="tune-actions">
        <button id="tune-copy">Copy changes</button>
        <button id="tune-paste">Paste…</button>
        <button id="tune-reset" class="quiet">Reset all</button>
      </div>
      <div class="tune-io" id="tune-io" hidden>
        <textarea id="tune-text" spellcheck="false" rows="6"></textarea>
        <div class="tune-io-row"><span id="tune-io-msg"></span><button id="tune-apply" hidden>Apply</button><button id="tune-io-close" class="quiet">Done</button></div>
      </div>
      <div class="tune-body" id="tune-body"></div>`;
    document.body.appendChild(el);
    // The hover tip: one, shown beside the panel for the setting under the pointer (or with focus).
    const tip = this.tip = document.createElement('div');
    tip.className = 'tune-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    const $ = (id) => el.querySelector(`#${id}`);
    this.rows = new Map();
    const body = $('tune-body');
    for (const g of TWEAK_GROUPS) {
      const sec = document.createElement('details');
      sec.className = `tune-group tune-${g.id}`;
      sec.open = g.id !== 'physics';
      sec.innerHTML = `<summary>${g.name}</summary><p class="tune-note">${g.note}</p>`;
      for (const d of TWEAKS.filter((t) => t.group === g.id)) {
        const row = document.createElement('div');
        row.className = 'tune-row';
        const id = `tw-${d.key.replace('.', '-')}`;
        row.innerHTML = `
          <label for="${id}">${d.label}</label>
          <input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}" aria-describedby="tune-tip">
          <input type="text" class="tune-num" inputmode="decimal" spellcheck="false" aria-label="${esc(d.label)}, type a value">
          <button class="tune-undo" aria-label="Reset ${esc(d.label)}">↺</button>`;
        const input = row.querySelector('input[type=range]'), num = row.querySelector('.tune-num');
        input.addEventListener('input', () => setTweak(d.key, +input.value));
        // (after a drag, the keyboard goes back to the game)
        input.addEventListener('pointerup', () => input.blur());
        // Typed: any value (past the slider's ends too), on Enter or leaving the box; Escape puts it back.
        const commit = () => {
          const v = parseFloat(num.value.replace(',', '.'));
          if (setTweak(d.key, v, { free: true }) === null) this.refresh();
        };
        num.addEventListener('focus', () => num.select());
        num.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { commit(); num.blur(); }
          else if (e.key === 'Escape') { this.refresh(true); num.blur(); }
          e.stopPropagation();
        });
        num.addEventListener('change', commit);
        row.querySelector('.tune-undo').addEventListener('click', () => resetTweak(d.key));
        row.addEventListener('mouseenter', () => this.showTip(d, row));
        row.addEventListener('mouseleave', () => this.hideTip());
        row.addEventListener('focusin', () => this.showTip(d, row));
        row.addEventListener('focusout', () => this.hideTip());
        sec.appendChild(row);
        this.rows.set(d.key, { row, input, num, d });
      }
      body.appendChild(sec);
    }
    body.addEventListener('scroll', () => this.hideTip());
    onTweak(() => this.refresh());
    $('tune-close').addEventListener('click', () => this.toggle(false));
    $('tune-reset').addEventListener('click', () => {
      if (Object.keys(changedTweaks()).length && confirm('Put every setting back to its default?')) resetAllTweaks();
      this.refresh(true);
    });
    const cruise = this.cruiseBox = $('tune-cruise');
    cruise.addEventListener('change', () => { this.onCruise?.(cruise.checked); cruise.blur(); });
    const io = $('tune-io'), text = $('tune-text'), msg = $('tune-io-msg'), apply = $('tune-apply');
    $('tune-copy').addEventListener('click', async () => {
      const ch = changedTweaks();
      const n = Object.keys(ch).length;
      text.value = n ? JSON.stringify(ch, null, 1) : '';
      text.readOnly = true;
      apply.hidden = true;
      io.hidden = false;
      if (!n) { msg.textContent = 'Nothing changed yet: everything is at its default.'; return; }
      text.focus(); text.select();
      let copied = false;
      try { await navigator.clipboard.writeText(text.value); copied = true; } catch { /* blocked here: copy it by hand */ }
      msg.textContent = copied ? `Copied ${n} change${n > 1 ? 's' : ''}. Paste them in your message.` : 'Selected: press Ctrl+C (⌘C) to copy.';
    });
    $('tune-paste').addEventListener('click', () => {
      text.value = '';
      text.readOnly = false;
      apply.hidden = false;
      io.hidden = false;
      msg.textContent = 'Paste settings copied from here, then Apply.';
      text.focus();
    });
    apply.addEventListener('click', () => {
      try {
        const n = applyTweaks(JSON.parse(text.value.trim().startsWith('{') ? text.value : `{${text.value}}`));
        msg.textContent = `Applied ${n} setting${n === 1 ? '' : 's'}.`;
        this.refresh(true);
      } catch { msg.textContent = "That doesn't read as settings: paste exactly what Copy changes gave."; }
    });
    $('tune-io-close').addEventListener('click', () => { io.hidden = true; });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && e.target.type === 'text')) return;
      if (e.code === 'Backquote' || e.code === 'F2') { e.preventDefault(); this.toggle(); }
    });
    this.refresh(true);
  }

  get open() { return !this.el.hidden; }

  toggle(on = !this.open) {
    this.el.hidden = !on;
    if (on) this.refresh(true); else this.hideTip();
  }

  /** The autopilot's switch shows whether the coach has the board. */
  setCruise(on) { this.cruiseBox.checked = !!on; }

  showTip(d, row) {
    const v = getTweak(d.key);
    const range = `Slider ${show(d, d.min)} to ${show(d, d.max)}; type anything from ${show(d, d.safe[0])} to ${show(d, d.safe[1])}.`;
    this.tip.innerHTML = `<b>${esc(d.label)}</b><p>${esc(d.help)}</p><p class="tune-tip-meta">Now ${esc(show(d, v))} · default ${esc(show(d, d.def))}${isBeyond(d.key) ? ' · <em>past the slider</em>' : ''}<br>${esc(range)}</p>`;
    this.tip.hidden = false;
    // (beside the panel, level with the setting; under it if the panel fills the screen)
    const p = this.el.getBoundingClientRect(), r = row.getBoundingClientRect(), t = this.tip.getBoundingClientRect();
    const roomLeft = p.left - 12;
    if (roomLeft >= 240) {
      this.tip.style.width = `${Math.min(340, roomLeft)}px`;
      const h = this.tip.getBoundingClientRect().height;
      this.tip.style.left = `${p.left - 8 - Math.min(340, roomLeft)}px`;
      this.tip.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2))}px`;
    } else {
      this.tip.style.width = `${Math.min(340, window.innerWidth - 24)}px`;
      this.tip.style.left = '12px';
      this.tip.style.top = `${Math.min(window.innerHeight - t.height - 8, r.bottom + 6)}px`;
    }
  }

  hideTip() { this.tip.hidden = true; }

  /** Show the values (all = also the number being typed in). */
  refresh(all = false) {
    for (const [key, r] of this.rows) {
      const v = getTweak(key);
      if (+r.input.value !== v) r.input.value = v;
      if (all || document.activeElement !== r.num) r.num.value = show(r.d, v);
      r.row.classList.toggle('changed', isChanged(key));
      r.row.classList.toggle('beyond', isBeyond(key));
      r.row.querySelector('.tune-undo').title = `Back to the default (${show(r.d, r.d.def)})`;
    }
    const n = Object.keys(changedTweaks()).length;
    this.el.querySelector('#tune-count').textContent = n ? `${n} changed` : 'all defaults';
  }
}
