// The tuning panel: every live tweak (tweaks.js) as a slider, grouped, that
// applies the moment it moves, while you sail. Changed values are marked,
// each has its own reset, and "Copy changes" gives just what you changed as
// a few lines of text to send back to be made the new defaults (or to paste
// into another browser with "Paste").
import {
  TWEAKS, TWEAK_GROUPS, applyTweaks, changedTweaks, getTweak, isChanged, onTweak, resetAllTweaks, resetTweak, setTweak,
} from '../tweaks.js';

const decimals = (step) => Math.max(0, Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)));

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
      <p class="tune-intro">Changes apply as you sail and are kept in this browser. When it feels right, <b>Copy changes</b> and send them over to make them the defaults.</p>
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
        row.title = d.help;
        const id = `tw-${d.key.replace('.', '-')}`;
        row.innerHTML = `
          <label for="${id}">${d.label}</label>
          <input type="range" id="${id}" min="${d.min}" max="${d.max}" step="${d.step}">
          <output></output>
          <button class="tune-undo" title="Back to the default (${d.def})" aria-label="Reset ${d.label}">↺</button>`;
        const input = row.querySelector('input'), out = row.querySelector('output');
        input.addEventListener('input', () => setTweak(d.key, +input.value));
        // (after a drag, the keyboard goes back to the game)
        input.addEventListener('pointerup', () => input.blur());
        row.querySelector('.tune-undo').addEventListener('click', () => resetTweak(d.key));
        sec.appendChild(row);
        this.rows.set(d.key, { row, input, out, d });
      }
      body.appendChild(sec);
    }
    onTweak(() => this.refresh());
    $('tune-close').addEventListener('click', () => this.toggle(false));
    $('tune-reset').addEventListener('click', () => {
      if (Object.keys(changedTweaks()).length && confirm('Put every setting back to its default?')) resetAllTweaks();
      this.refresh();
    });
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
        this.refresh();
      } catch { msg.textContent = "That doesn't read as settings: paste exactly what Copy changes gave."; }
    });
    $('tune-io-close').addEventListener('click', () => { io.hidden = true; });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Backquote' || e.code === 'F2') { e.preventDefault(); this.toggle(); }
    });
    this.refresh();
  }

  get open() { return !this.el.hidden; }

  toggle(on = !this.open) {
    this.el.hidden = !on;
    if (on) this.refresh();
  }

  refresh() {
    for (const [key, r] of this.rows) {
      const v = getTweak(key);
      if (+r.input.value !== v) r.input.value = v;
      r.out.textContent = v.toFixed(decimals(r.d.step));
      r.row.classList.toggle('changed', isChanged(key));
    }
    const n = Object.keys(changedTweaks()).length;
    this.el.querySelector('#tune-count').textContent = n ? `${n} changed` : 'all defaults';
  }
}
