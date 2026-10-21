// Story mode, checked headlessly: the coach plays every chapter (as 65, 75
// and 90 kg sailors, on the gear Kai picks for them) and must complete every
// goal in it, with the goals detected exactly as they are in the game.
// Runs the chapters in parallel. Run: node tools/career-check.mjs [chapterId] [-v]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { CHAPTERS } from '../src/game/career.js';
import { playChapter } from './storypilot.mjs';

const MASSES = [65, 75, 90];

if (isMainThread) {
  const only = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
  const verbose = process.argv.includes('-v');
  const jobs = [];
  for (const ch of CHAPTERS) if (!only || ch.id === only) for (const mass of MASSES) jobs.push({ id: ch.id, mass, verbose });
  const results = [];
  const width = Math.max(1, Math.min(jobs.length, availableParallelism()));
  let next = 0;
  await new Promise((resolve) => {
    let running = 0;
    const launch = () => {
      if (next >= jobs.length) { if (!running) resolve(); return; }
      const job = jobs[next++];
      running++;
      const w = new Worker(new URL(import.meta.url), { workerData: job });
      w.on('message', (r) => results.push(r));
      w.on('error', (e) => results.push({ ...job, complete: false, error: String(e?.stack ?? e) }));
      w.on('exit', () => { running--; launch(); });
    };
    for (let i = 0; i < width; i++) launch();
  });
  let failures = 0;
  for (const ch of CHAPTERS) {
    for (const r of results.filter((x) => x.id === ch.id).sort((a, b) => a.mass - b.mass)) {
      if (!r.complete) failures++;
      const done = ch.goals.map((g) => `${g.id} ${r.times?.[g.id] !== undefined ? r.times[g.id].toFixed(0) : '–'}`).join(', ');
      console.log(`${r.complete ? 'PASS' : 'FAIL'}  ${String(CHAPTERS.indexOf(ch) + 1).padStart(2)} ${ch.title.padEnd(16)} ${String(r.mass).padStart(3)} kg  ${r.board ?? ''} ${r.sail?.toFixed?.(1) ?? ''} m²  goals at [${done}] s, falls ${r.falls ?? '?'}${r.complete ? '' : `  MISSING ${r.missing?.join(', ') ?? ''} ${r.error ?? ''}`}`);
    }
  }
  if (failures) { console.log(`${failures} chapter run(s) not completed`); process.exit(1); }
} else {
  parentPort.postMessage(playChapter(workerData.id, workerData.mass, workerData.verbose));
}
