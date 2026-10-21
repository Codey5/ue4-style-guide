// The sailor and the rig never pass through each other: plays the lessons
// with the 3D sailor and rig posed every frame, and measures how far the boom
// and the sail (as drawn, after the cloth gives way round the body) go into
// the body. The boom has to stay out of it; the sail may press in a couple of
// centimetres (cloth bearing on a shoulder) but not cut through. The hands
// and forearms hold the boom and don't count, and neither do falls (the
// sailor and the rig go their separate ways). Run: node tools/clash-check.mjs [lessonId] [-v]
import * as THREE from 'three';
import { Sim, S } from '../src/physics/sim.js';
import { LESSONS, LessonRunner } from '../src/coach/lessons.js';
import { Rig, Sailor, bodyCapsules } from '../src/render/models.js';
import { boomLocal } from '../src/physics/body.js';

const DT = 1 / 240;
const only = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2].split(',') : null;
const verbose = process.argv.includes('-v');
// How deep (m) each may go into the body, and in how many frames of a state at most.
const BOOM_DEPTH = 0.02, SAIL_DEPTH = 0.03, MAX_SHARE = 0.02;
const IGNORE = new Set([S.FALLING, S.WATER, S.WATERSTART, S.CLIMB, S.UPHAUL, S.RISING]);

const segDist = (p, a, b) => {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
};

/** The deepest any point goes into the body: [depth, part]. */
function deepest(points, caps, labels = null) {
  let worst = 0, part = null;
  points.forEach((q, i) => {
    for (const c of caps) {
      const d = c.r - segDist(q, c.a, c.b);
      if (d > worst) { worst = d; part = labels ? `${c.name} @${labels[i]}` : c.name; }
    }
  });
  return [worst, part];
}

function measure(rig, sailor) {
  sailor.side = sailor.sideNow;
  const m = rig.group.matrix, geo = rig.geo, L = rig.boomLength;
  const caps = bodyCapsules(sailor.pose).filter((c) => c.name !== 'forearm');
  const boom = [], labels = [];
  for (const side of [-1, 1]) for (let x = 0.12; x < L; x += 0.06) {
    boom.push(new THREE.Vector3(...boomLocal(geo, x, side)).applyMatrix4(m));
    labels.push(`${side === sailor.side ? 'windward' : 'leeward'} tube ${x.toFixed(2)} m`);
  }
  const sail = [], sailLabels = [];
  const pos = rig.sailPos, NU = Math.round(Math.sqrt(pos.length / 3)); // (labels only)
  for (let k = 0; k < pos.length; k += 3) {
    sail.push(new THREE.Vector3(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(m));
    sailLabels.push(`sail ${(pos[k] * 100).toFixed(0)} cm back, ${(pos[k + 1] * 100).toFixed(0)} cm up`);
  }
  void NU;
  // (the boom tube has a radius too)
  const [bd, bp] = deepest(boom, caps.map((c) => ({ ...c, r: c.r + 0.017 })), labels);
  const [sd, sp] = deepest(sail, caps, sailLabels);
  return { bd, bp, sd, sp };
}

let failures = 0;
for (const lesson of LESSONS) {
  if (only && !only.includes(lesson.id)) continue;
  const s = lesson.setup;
  const sim = new Sim({
    boardId: s.boardId, sailArea: s.sailArea, sailorMass: 75, sailorHeight: 1.83,
    wind: { fromDeg: 270, ...s.wind }, start: s.start, assists: { autoHike: false, noFalls: false },
  });
  const run = new LessonRunner(lesson, 'watch', sim);
  const rig = new Rig(sim.sailGeo), sailor = new Sailor(sim.sailorHeight);
  const stats = {};
  let t = 0;
  while (t < 200) {
    sim.step(DT, run.controls(DT));
    t += DT;
    const r = run.update(DT);
    if (Math.round(t / DT) % 4 === 0) {
      rig.update(sim, 4 * DT, sailor.pose && sim.sailor.hooked && sim.state === S.SAILING ? sailor.hookLocal.clone() : null);
      rig.group.updateMatrix();
      sailor.update(sim, rig, 4 * DT);
      rig.drapeAround(sim, sailor);
      sailor.sideNow = sim.sailor.side;
      if (!IGNORE.has(sim.state) && sim.stateTime > 0.15) {
        const key = sim.state === S.TRICK ? `trick ${sim.stateData.kind}` : sim.state;
        const st = stats[key] ??= { n: 0, boom: 0, sail: 0, wb: null, ws: null };
        const c = measure(rig, sailor);
        st.n++;
        const at = { t: +t.toFixed(2), st: +sim.stateTime.toFixed(2), kn: +sim.telemetry.kn.toFixed(1), boom: Math.round(sim.rig.boom / 0.01745), rake: Math.round(sim.rig.rake / 0.01745), lean: Math.round(sim.rig.lean / 0.01745) };
        if (c.bd > BOOM_DEPTH) { st.boom++; if (!st.wb || c.bd > st.wb.d) st.wb = { d: c.bd, part: c.bp, ...at }; }
        if (c.sd > SAIL_DEPTH) { st.sail++; if (!st.ws || c.sd > st.ws.d) st.ws = { d: c.sd, part: c.sp, ...at }; }
      }
    }
    if (r === 'complete' || r === 'fell') break;
  }
  for (const [key, st] of Object.entries(stats)) {
    const boom = st.boom / st.n, sail = st.sail / st.n;
    const ok = boom <= MAX_SHARE && sail <= MAX_SHARE;
    if (!ok) failures++;
    if (!ok || verbose) {
      const w = (x) => (x ? ` (worst ${(x.d * 100).toFixed(0)} cm, ${x.part}, ${JSON.stringify({ ...x, d: undefined, part: undefined })})` : '');
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${lesson.title.padEnd(26)} ${key.padEnd(14)} boom in the body ${(100 * boom).toFixed(1)}%${w(st.wb)}, sail ${(100 * sail).toFixed(1)}%${w(st.ws)}`);
    }
  }
  if (!verbose && Object.values(stats).every((st) => st.boom / st.n <= MAX_SHARE && st.sail / st.n <= MAX_SHARE)) {
    console.log(`PASS  ${lesson.title.padEnd(26)} the boom and the sail stay out of the sailor`);
  }
}
if (failures) { console.log(`${failures} clash(es) between the sailor and the rig`); process.exit(1); }
