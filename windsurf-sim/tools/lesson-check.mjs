// Runs every lesson in "watch" mode headlessly and checks the coach completes
// each step, the same way the in-game demo plays it. Run: node tools/lesson-check.mjs [lessonId]
import { Sim } from '../src/physics/sim.js';
import { LESSONS, LessonRunner } from '../src/coach/lessons.js';
import { DEFAULT_SAILOR } from '../src/physics/gear.js';

const DT = 1 / 240;
let failures = 0;
const only = process.argv[2];
const verbose = process.argv.includes('-v');

export function lessonSim(lesson, overrides = {}) {
  const s = lesson.setup;
  return new Sim({
    boardId: s.boardId, sailArea: s.sailArea, sailorMass: overrides.mass ?? 75, sailorHeight: overrides.height ?? DEFAULT_SAILOR.height,
    wind: { fromDeg: 270, ...s.wind }, start: s.start, assists: { autoHike: false, noFalls: false },
  });
}

for (const lesson of LESSONS) {
  if (only && only !== lesson.id && !only.startsWith('-')) continue;
  for (const mass of [65, 75, 90]) {
    const sim = lessonSim(lesson, { mass });
    const run = new LessonRunner(lesson, 'watch', sim);
    const times = [];
    let result = null;
    let t = 0;
    while (t < 240) {
      const c = run.controls(DT);
      sim.step(DT, c);
      t += DT;
      const r = run.update(DT);
      if (verbose && Math.round(t / DT) % 240 === 0) console.log(`   t ${t.toFixed(0)} step ${run.step} ${sim.state} kn ${sim.telemetry.kn.toFixed(1)} twa ${(sim.twa * 57.3).toFixed(0)} p ${sim.telemetry.planing.toFixed(2)}`);
      if (r === 'step' || r === 'complete') times.push(t.toFixed(1));
      if (r === 'complete') { result = 'ok'; break; }
      if (r === 'fell') { result = `FAILED at step ${run.step + 1} (${run.failed}): ${sim.events.slice(-2).map((e) => e.text).join(' | ')}`; break; }
    }
    if (!result) result = `FAILED: did not finish, stuck at step ${run.step + 1}`;
    // A demo should look clean: flag any slips the coach made along the way
    // (other than the falls a step sets out to show, which must be the kind it shows).
    const shown = (e) => e.type === 'fall' && run.expectedFalls.some((f) => Math.abs(f.t - e.t) < 0.05);
    const slips = sim.events.filter((e) => ['grip', 'fall', 'spinout'].includes(e.type) && !shown(e)).map((e) => e.type);
    for (const f of run.expectedFalls) if (f.type !== 'catapult' && result === 'ok') result = `FAILED: the demonstrated fall was a ${f.type}, not a catapult`;
    if (lesson.steps.some((st) => st.expectFall) && !run.expectedFalls.length && result === 'ok') result = 'FAILED: the demonstration never fell';
    if (result === 'ok' && slips.length) result = `ok (slips: ${slips.join(', ')})`;
    const ok = result.startsWith('ok');
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${lesson.title.padEnd(26)} ${String(mass).padStart(3)} kg  steps done at [${times.join(', ')}] s  ${result === 'ok' ? '' : result}`);
  }
}
if (failures) { console.log(`${failures} lesson run(s) failed`); process.exit(1); }
