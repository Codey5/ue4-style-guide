// Poses the 3D sailor every frame while the coach sails, and checks the hands
// stay on the boom whenever the sailor is sailing on it, and that the body is
// drawn at the lean the physics balances (not bent to fit): every lesson, plus
// sandbox runs at the extremes of body height, boom height and wind. (The
// last moment before a fall, or before letting go of the rig, doesn't count:
// that's the sailor losing it.)
// Run: node tools/pose-check.mjs [lessonId]
import { Sim, S } from '../src/physics/sim.js';
import { BOOM_RATIO } from '../src/physics/gear.js';
import { LESSONS, LessonRunner } from '../src/coach/lessons.js';
import { Autopilot } from './autopilot.mjs';
import { Rig, Sailor } from '../src/render/models.js';

const DT = 1 / 240;
const only = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
let failures = 0;

function check(label, sim, controls, update = () => null, duration = 240) {
  const rig = new Rig(sim.sailGeo);
  const sailor = new Sailor(sim.sailorHeight);
  let t = 0, frame = 0, worst = 0, worstAt = null, off = 0, frames = 0, bent = 0, outOfReach = 0;
  // Gaps wait a quarter of a second before they count, and a fall drops them.
  let pending = [];
  const commit = (g) => {
    if (g.gap > 0.03) off++;
    if (g.gap > worst) { worst = g.gap; worstAt = g.at; }
  };
  while (t < duration) {
    const was = sim.state;
    sim.step(DT, controls());
    t += DT;
    const r = update();
    // (falling in, or letting go of the rig rather than being dragged in after it)
    if ((sim.state === S.FALLING && was !== S.FALLING) || (sim.state === S.UPHAUL && was === S.SAILING)) pending = [];
    while (pending.length && pending[0].t < t - 0.25) commit(pending.shift());
    if (++frame % 4 === 0) {
      rig.update(sim, 4 * DT, sailor.pose && sim.sailor.hooked && sim.state === S.SAILING ? sailor.hookLocal.clone() : null);
      rig.group.updateMatrix();
      sailor.update(sim, rig, 4 * DT);
      const hands = sailor.lastHands;
      // (not while the back hand is deliberately off the boom, or taking hold again)
      if (hands && sim.state === S.SAILING && sim.stateTime > 0.5 && !sailor.backOff) {
        frames++;
        // Drawn at the lean the physics balances (within 2°, or at the edge of
        // the reach while hanging on the boom or catching up with the rig),
        // unless the rig is out of reach at any lean.
        if (!sailor.reachFits) outOfReach++;
        else {
          const outside = Math.max(0, sim.sailor.beta - sim.betaMax, sim.betaMin - sim.sailor.beta);
          if (sailor.offReach || Math.abs(sailor.leanDrawn - sim.sailor.beta) > Math.max(2 * 0.01745, outside + 0.01745)) bent++;
        }
        const gap = Math.max(sailor.pose.haL.distanceTo(hands.F), sailor.pose.haR.distanceTo(hands.B));
        pending.push({ t, gap, at: gap > 0.03 && { t: +t.toFixed(1), kn: +sim.telemetry.kn.toFixed(1), lean: Math.round(sim.sailor.beta / 0.01745), hooked: sim.sailor.hooked, straps: sim.sailor.straps, rigRake: Math.round(sim.rig.rake / 0.01745), rigLean: Math.round(sim.rig.lean / 0.01745) } });
      }
    }
    if (r === 'complete' || r === 'fell') break;
  }
  pending.forEach(commit);
  const bentPct = (100 * bent) / Math.max(frames, 1);
  const ok = worst < 0.03 && bentPct < 5;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  hands off the boom ${(100 * off / Math.max(frames, 1)).toFixed(1)}% of ${frames} frames (worst ${(worst * 100).toFixed(0)} cm), drawn at the physics lean ${(100 - bentPct).toFixed(1)}%${outOfReach ? `, rig out of reach ${(100 * outOfReach / frames).toFixed(1)}%` : ''}${worst < 0.03 ? '' : ' ' + JSON.stringify(worstAt)}`);
}

for (const lesson of LESSONS) {
  if (only && only !== lesson.id) continue;
  for (const [mass, height] of [[65, 1.65], [75, 1.83], [90, 1.95]]) {
    const s = lesson.setup;
    const sim = new Sim({
      boardId: s.boardId, sailArea: s.sailArea, sailorMass: mass, sailorHeight: height,
      wind: { fromDeg: 270, ...s.wind }, start: s.start, assists: { autoHike: false, noFalls: false },
    });
    const run = new LessonRunner(lesson, 'watch', sim);
    check(`${lesson.title.padEnd(26)} ${mass} kg ${Math.round(height * 100)} cm`, sim, () => run.controls(DT), () => run.update(DT));
  }
}

if (!only) {
  // Sandbox: short and tall sailors with the boom at both ends of its range,
  // powered up on a close reach, beam reach and broad reach.
  for (const [height, boomRel] of [[1.55, -0.12], [1.55, 0.16], [2.0, -0.12], [2.0, 0.16]]) {
    for (const twa of [60, 100, 135]) {
      const sim = new Sim({
        boardId: 'free115', sailArea: 6.3, sailorMass: 75, sailorHeight: height, boomHeight: height * BOOM_RATIO + boomRel,
        wind: { fromDeg: 270, speedKn: 21, gustiness: 0.5, shifts: 0.3, chop: 1 }, start: 'sailing', assists: { autoHike: true },
      });
      const ap = new Autopilot(sim, twa, { warmup: twa !== 100 ? 15 : 0 });
      check(`Sandbox ${twa}° 21 kn ${Math.round(height * 100)} cm, boom ${Math.round(sim.boomHeight * 100)} cm`.padEnd(48), sim, () => ap.controls(DT), () => null, 45);
    }
  }
}
if (failures) { console.log(`${failures} run(s) let go of the boom`); process.exit(1); }
