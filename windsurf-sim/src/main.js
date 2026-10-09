// Beam Reach: wiring of simulation, rendering, input, sound and UI.
import * as THREE from 'three';
import { Sim, S, BEACH_Z } from './physics/sim.js';
import { clamp } from './physics/math.js';
import { BOOM_RATIO, LINES_RATIO } from './physics/gear.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { createEnvironment, createRenderer, createScene, setEnvironment, World } from './render/scene.js';
import { Water } from './render/water.js';
import { buildBoard, Rig, Sailor } from './render/models.js';
import { Effects } from './render/effects.js';
import { CameraRig } from './render/camera.js';
import { WindParticles } from './render/windfx.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Audio } from './ui/audio.js';
import { LessonUi } from './ui/lessonui.js';
import { LESSONS, findLesson, LessonRunner } from './coach/lessons.js';
import { Coach } from './coach/coach.js';
import { SANDBAR, placeAtStrip } from './physics/spot.js';
import { adviseSail } from './physics/quiver.js';
import { CATEGORIES, GpsLogger } from './game/gps.js';
import { GearVerdict, SessionBook } from './game/sessions.js';
import { Career, ChapterRun, MARKS, chapterSetup, findChapter } from './game/career.js';
import { StoryUi } from './ui/storyui.js';
import { TuneUi } from './ui/tuneui.js';
import { Juice } from './render/juice.js';
import { loadTweaks, tw } from './tweaks.js';

const DT = 1 / 240;
const STORE_KEY = 'beam-reach-settings-v2';

const defaults = {
  windKn: 15, gustiness: 0.45, shifts: 0.5, chop: 1,
  boardId: 'free135', sailArea: 7.0, mass: 75, height: 183, boomRel: 0, linesRel: 0,
  tuneLines: 0, tuneMast: 0, downhaul: 0, outhaul: 0, // rig tuning: cm along the boom / track, and -1..1
  autoHike: false, noFalls: false, rumble: true, invertRake: false, volume: 0.8, lessonsDone: [],
  windParticles: true, cameraShake: true, gpsPanel: true,
  light: 'golden', bloom: true,
};
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
    // v1 put the default boom at 0.8 × height: keep a boom someone set by hand
    // at the same height, otherwise take the new defaults.
    const v1 = localStorage.getItem('beam-reach-settings-v1');
    if (v1) {
      const old = JSON.parse(v1);
      const s = { ...defaults, ...old };
      if ((old.height ?? 178) === 178 && !old.boomRel) Object.assign(s, { height: defaults.height, boomRel: 0 });
      else s.boomRel = clamp(Math.round(s.height * 0.8 + (old.boomRel ?? 0) - s.height * BOOM_RATIO), -12, 16);
      return s;
    }
  } catch { /* storage unavailable */ }
  return { ...defaults };
}
function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const settings = loadSettings();
/** Boom height above the deck in cm: between chest and shoulder, plus the rider's adjustment. */
export const boomHeightFor = (st) => Math.round(st.height * BOOM_RATIO + st.boomRel);
/** Harness line length in inches (as they're sold): scaled to your height, plus your adjustment. */
export const linesFor = (st) => Math.round((st.height * LINES_RATIO) / 2.54 + st.linesRel);
const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const env = createEnvironment(settings.light);
const { scene, skyUniforms, sun, applyLight } = createScene(env);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
// The frame is drawn off-screen in high precision, so that whatever is
// brighter than white (the sun, its glitter on the water, sunlit spray) can
// bleed a little light around it, as it does in a lens (the glow, which can
// be turned off), then tone-mapped and its edges smoothed (FXAA). No
// multisampling: multisampled float buffers are heavy at high resolution
// and badly supported on some GPUs.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.35, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new FXAAPass());
// If the browser resets the graphics anyway, draw straight to the screen from then on.
let direct = false;
canvas.addEventListener('webglcontextrestored', () => {
  if (direct) return;
  direct = true;
  sim.emit('gfx', 'The graphics reset, so the game now draws more simply (no glow). Reload the page to try the full look again.', 2);
});
// (the tuning panel's settings from last time, before anything reads them)
loadTweaks();
const camRig = new CameraRig(camera);

let sim = makeSim('secure');
const water = new Water(scene, env);
const world = new World(scene, sim.wind);
const effects = new Effects(scene);
const windFx = new WindParticles(scene);
const input = new Input(canvas);
const hud = new Hud();
const tune = new TuneUi();
document.getElementById('tune-open')?.addEventListener('click', () => tune.toggle());
const audio = new Audio();
const juice = new Juice({ audio, camRig, effects, hud });
// (events that get big text on screen rather than a message)
const BIG_TEXT_EVENTS = new Set(['trickdone', 'planing', 'jump']);
const lessonUi = new LessonUi();
let lesson = null; // active LessonRunner
const storyUi = new StoryUi();
const career = new Career();
let story = null; // the chapter being sailed (a ChapterRun)
let storyStart = 0, storyDoneAt = null;

const boardGroup = new THREE.Group();
scene.add(boardGroup);
let boardMesh = null, rig = null, sailor = null;

/** A sim from the sandbox settings, or from a lesson's setup (keeping your body and boom height). */
function makeSim(start, setup = null, watch = false) {
  const wind = setup ? setup.wind : { speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop };
  return new Sim({
    boardId: setup?.boardId ?? settings.boardId, sailArea: setup?.sailArea ?? settings.sailArea, sailorMass: settings.mass,
    sailorHeight: settings.height / 100, boomHeight: boomHeightFor(settings) / 100, harnessLines: linesFor(settings) * 0.0254,
    wind: { ...wind, fromDeg: 270 },
    // The coach does its own hiking and never uses the no-falls assist.
    assists: watch ? { autoHike: false, noFalls: false } : { autoHike: settings.autoHike, noFalls: settings.noFalls },
    start: setup?.start ?? (start === 'strip' ? 'sailing' : start),
    spot: { bar: SANDBAR },
    // Lessons sail a standard tune (or their own); free sailing, yours.
    tune: setup ? setup.tune ?? {} : {
      linesPos: settings.tuneLines / 100, mastPos: settings.tuneMast / 100, downhaul: settings.downhaul, outhaul: settings.outhaul,
    },
  });
}

function buildModels() {
  if (boardMesh) boardGroup.remove(boardMesh);
  if (rig) boardGroup.remove(rig.group);
  if (sailor) boardGroup.remove(sailor.group);
  boardMesh = buildBoard(sim.board);
  rig = new Rig(sim.sailGeo);
  sailor = new Sailor(sim.sailorHeight);
  boardGroup.add(boardMesh, rig.group, sailor.group);
}

function syncWorld() {
  world.wind = sim.wind;
  water.setWaves(sim.waves, sim.wind, BEACH_Z);
  skyUniforms.uWindDir.value.set(sim.wind.dir[0], sim.wind.dir[2]);
  skyUniforms.uWindSpeed.value = sim.wind.speed;
}

/**
 * A fresh sim: free sailing (setup null), a lesson's setup, or a story
 * chapter's (logged by the GPS like free sailing, on the chapter's gear).
 */
function restart(mode, setup = null, watch = false, logged = false) {
  const at = sim ? [sim.pos[0], 0, sim.pos[2]] : null;
  const nearShore = at && at[2] < BEACH_Z + 40;
  sim = makeSim(mode, setup, watch);
  if (mode === 'strip') placeAtStrip(sim);
  else if (!setup && at && !nearShore && Math.hypot(at[0], at[2]) < 2500) sim.reset(mode, at);
  // Free sailing and the story are logged by the GPS as a session; lessons aren't.
  sessionGear = logged ? setup : null;
  if (setup && !logged) endSession(); else startSession();
  buildModels();
  syncWorld();
  effects.clearTrail();
  hud.resetEvents(sim);
  juice.reset();
  camRig.yaw = null;
  camRig.pos.set(0, 0, 0); // snap instead of flying in from the old spot
  camRig.look.set(0, 0, 0);
  camRig.boardY = undefined;
  prevState = null;
}

function applyOptions() {
  sim.assists.autoHike = settings.autoHike;
  sim.assists.noFalls = settings.noFalls;
  input.rumbleEnabled = settings.rumble;
  input.invertRake = settings.invertRake;
  windFx.enabled = settings.windParticles;
  bloom.enabled = settings.bloom;
  setEnvironment(env, settings.light);
  applyLight(renderer);
  water.uniforms.uFogDensity.value = env.fogDensity;
  camRig.shakeEnabled = settings.cameraShake;
  audio.volume = settings.volume;
  audio.setMuted(audio.muted);
  saveSettings(settings);
}

let paused = true;
let gearTimer = 0;

// ---- GPS speed sessions: logged while free sailing, with your personal bests.
const book = new SessionBook();
let gps = null, verdict = null, lastState = null, recordCheck = 0, sessionSave = 0, five10Check = 0;
let sessionGear = null; // a story chapter's gear and wind (null: the settings)
const advice = () => (sessionGear ? adviseSail(sessionGear.boardId, settings.mass, sessionGear.wind.speedKn) : adviseSail(settings.boardId, settings.mass, settings.windKn));
const sessionSail = () => sessionGear?.sailArea ?? settings.sailArea;
function sessionMeta() {
  const g = sessionGear;
  if (g) return { board: g.boardId, sail: g.sailArea, mass: settings.mass, wind: g.wind.speedKn, gust: g.wind.gustiness, chop: g.wind.chop, story: true };
  return { board: settings.boardId, sail: settings.sailArea, mass: settings.mass, wind: settings.windKn, gust: settings.gustiness, chop: settings.chop };
}
function saveSession() {
  if (!gps) return;
  book.update(gps.results(), verdict.result(advice(), sessionSail()));
  book.save();
}
function startSession() {
  endSession();
  gps = new GpsLogger();
  verdict = new GearVerdict();
  book.begin(sessionMeta());
}
function endSession() {
  saveSession();
  book.end();
  gps = null;
  verdict = null;
}
/** New personal bests, announced once each run is over (no improvement for three seconds). */
function checkRecords() {
  for (const key of ['s2', 's10', 'm500', 'nm', 'alpha']) {
    const v = gps.best[key];
    if (book.beats(key, v) && sim.t - (gps.at[key] ?? 0) > 3) announce(key, v);
  }
  if (sim.t > five10Check) {
    five10Check = sim.t + 5;
    const f = gps.five10();
    if (f.n === 5 && book.beats('five10', f.v)) announce('five10', f.v);
  }
}
function announce(key, v) {
  book.claim(key, v);
  book.save();
  const cat = CATEGORIES.find((c) => c.key === key);
  sim.emit('pb', `New personal best — ${cat.label}: ${(v * 1.943844).toFixed(2)} knots`, 2);
}
window.addEventListener('pagehide', saveSession);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveSession(); });

function startLesson(id, mode) {
  const def = findLesson(id);
  if (!def) return;
  audio.start();
  exitStory();
  restart(def.setup.start, def.setup, mode === 'watch');
  lesson = new LessonRunner(def, mode, sim);
  menu.activeLesson = lesson;
  menu.started = true;
  lessonUi.show(true);
  camRig.mode = 0;
  resume();
}
function exitLesson() {
  lesson = null;
  menu.activeLesson = null;
  lessonUi.show(false);
}

/** Sail a chapter of the story: Kai's gear and conditions for it, its marks on the water. */
function startChapter(id) {
  const ch = findChapter(id);
  if (!ch) return;
  audio.start();
  exitLesson();
  exitStory();
  const setup = chapterSetup(ch, settings.mass);
  restart(ch.start === 'strip' ? 'strip' : setup.start, setup, false, true);
  story = new ChapterRun(ch, career, sim);
  storyStart = sim.t;
  storyDoneAt = null;
  world.setMarks((ch.marks ?? []).map((k) => MARKS[k]));
  menu.activeStory = story;
  menu.storyBanner = null;
  menu.started = true;
  storyUi.show(true);
  camRig.mode = 0;
  resume();
}
function exitStory() {
  if (!story) return;
  story = null;
  menu.activeStory = null;
  storyUi.show(false);
  world.setMarks([]);
}

const menu = new Menu(settings, {
  start: (mode) => { audio.start(); exitLesson(); exitStory(); restart(mode); menu.started = true; resume(); },
  lesson: (id, mode) => startLesson(id, mode),
  exitLesson: () => { exitLesson(); restart('secure'); resume(); },
  chapter: (id) => startChapter(id),
  exitStory: () => { exitStory(); restart('secure'); resume(); },
  resetStory: () => career.reset(),
  glyphs: () => hud.glyphs(input),
  resume: () => resume(),
  conditions: () => {
    if (lesson || story) { exitLesson(); exitStory(); restart('secure'); }
    sim.setWind({ speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop });
    syncWorld();
    saveSettings(settings);
    if (book.current) Object.assign(book.current, sessionMeta());
  },
  gear: () => {
    saveSettings(settings);
    if (lesson) exitLesson();
    exitStory();
    clearTimeout(gearTimer); // sliders fire continuously; rebuild once they settle
    gearTimer = setTimeout(() => restart('secure'), 200);
  },
  options: () => applyOptions(),
  sessions: () => ({ book, gps, verdict: gps ? verdict.result(advice(), sessionSail()) : null }),
  clearRecords: () => { book.clear(); if (gps) book.begin(sessionMeta()); },
});
menu.completed = new Set(settings.lessonsDone);
menu.career = career;
// (a first visit opens on the story)
if (!career.started) menu.select('story');

function resume() {
  paused = false;
  menu.hide();
  hud.show(true);
  canvas.focus?.();
}
function pause(tab) {
  paused = true;
  menu.show(tab);
}

buildModels();
syncWorld();
applyOptions();
// Browsers only allow sound after a user gesture; unlock on the first one.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio.start(), { once: true });
camRig.update(0.016, sim, sim.waves, { pos: sim.pos, yaw: sim.yaw, t: sim.t });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;
let rumbleTimer = 0;
let rumbleKick = 0;
let lastPop, lastBatten, battenKick = 0;
let lastLanding = null;
let lastControls = null;
// Physics runs at a fixed 240 Hz; rendering interpolates between the last two
// physics states so motion is smooth whatever the display refresh rate.
let prevState = null;
const snapshot = () => ({ pos: [...sim.pos], yaw: sim.yaw, pitch: sim.pitch, roll: sim.roll, t: sim.t });
let usedControls = null;
let framePressed = {};
let renderTime = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const { controls, ui } = input.poll(dt);
  lastControls = controls;
  menu.setPadStatus(input);

  if (ui.mute) audio.setMuted(!audio.muted);
  if (paused) {
    if ((ui.pause || ui.padB) && menu.started) resume();
    else menu.pad(ui);
  } else {
    if (ui.pause) pause();
    if (ui.telemetry) hud.toggleTelemetry();
    if (ui.lookGoal) {
      const t = story?.target;
      camRig.lookGoal = !camRig.lookGoal && !!t;
      hud.flashCamera(camRig.lookGoal ? `Looking toward ${t.name}` : t ? camRig.modeName : 'No buoy to head for right now');
    }
    if (ui.camNext) { camRig.lookGoal = false; camRig.cycle(1); hud.flashCamera(camRig.modeName); }
    if (ui.camPrev) { camRig.cycle(-1); hud.flashCamera(camRig.modeName); }
    if (ui.zoom) camRig.zoomBy(ui.zoom);
    if (ui.drag) camRig.drag(ui.drag[0], ui.drag[1]);

    // Watching the coach: Y / T hands the lesson over to you.
    if (lesson && lesson.mode === 'watch' && controls.pressed.flip) {
      startLesson(lesson.lesson.id, 'try');
      controls.pressed = {}; // that press was "take over", not a sail flip
    }

    // Fixed-step physics; button presses go to the first sub-step only. In a
    // watched lesson the coach supplies the controls, one physics step at a time.
    // (slow motion at the big moments: the world runs slower, physics and all)
    acc += dt * juice.timeScale;
    let first = true;
    let steps = 0;
    framePressed = {};
    let restartLesson = null;
    let goalDone = false;
    while (acc >= DT && steps < 24) {
      const coachDriving = lesson && lesson.coachDriving;
      const c = coachDriving ? lesson.controls(DT) : first ? controls : { ...controls, pressed: {} };
      prevState = snapshot();
      sim.step(DT, c);
      usedControls = c;
      if (gps) {
        gps.step(sim);
        verdict.step(sim, DT);
        if (sim.state === S.FALLING && lastState !== S.FALLING) verdict.fell(sim.sailor.fallType);
      }
      lastState = sim.state;
      for (const [k, v] of Object.entries(c.pressed)) if (v) framePressed[k] = true;
      if (lesson) {
        const r = lesson.update(DT);
        if (r === 'step' && lesson.mode === 'try') sim.emit('lesson', '✓ Step done', 1);
        if (r === 'complete') {
          sim.emit('lesson', lesson.mode === 'watch' ? 'Lesson complete. Your turn!' : '✓ Lesson complete!', 2);
          if (lesson.mode === 'try' && !settings.lessonsDone.includes(lesson.lesson.id)) {
            settings.lessonsDone.push(lesson.lesson.id);
            menu.completed.add(lesson.lesson.id);
            saveSettings(settings);
          }
        }
        if (r === 'fell') restartLesson = lesson;
      }
      if (story) {
        for (const g of story.step(DT)) {
          sim.emit(`goal-${g.id}`, `✓ ${g.text}`, 2);
          goalDone = true;
        }
        if (story.finished && storyDoneAt === null) {
          storyDoneAt = sim.t;
          sim.emit('chapter', `Chapter complete: ${story.chapter.title}!`, 3);
        }
      }
      first = false;
      acc -= DT;
      steps++;
    }
    if (steps >= 24) acc = 0;
    if (goalDone) {
      audio.chime(storyDoneAt !== null && sim.t - storyDoneAt < 0.1);
      rumbleKick = Math.max(rumbleKick, 0.4);
    }
    // A chapter done: a moment to enjoy it, then the story page with what's next.
    if (story && storyDoneAt !== null && sim.t - storyDoneAt > 3.5 && menu.storyBanner !== story.chapter.id) {
      menu.storyBanner = story.chapter.id;
      pause('story');
    }
    if (restartLesson) {
      startLesson(restartLesson.lesson.id, restartLesson.mode);
      sim.emit('lesson', 'The coach fell in. It happens to everyone! Starting the lesson again.', 2);
    }

    hud.quiet = tw.juice.banners >= 0.5 ? BIG_TEXT_EVENTS : null;
    const newEvents = hud.pushEvents(sim);
    juice.update(dt, sim, newEvents, { sailor, boardGroup });
    for (const e of newEvents) {
      if (e.type === 'fall') {
        const p = new THREE.Vector3(sim.pos[0], sim.pos[1] + 0.3, sim.pos[2]);
        effects.splash(p, 1.2);
        audio.splash();
        rumbleKick = 1;
      } else if (e.type === 'spinout' || e.type === 'grip' || e.type === 'nosedive') rumbleKick = Math.max(rumbleKick, 0.7);
      else if (e.type === 'planing' || e.type === 'trickdone') rumbleKick = Math.max(rumbleKick, 0.25);
    }
    // The pop: the tail kicks water as it leaves, and a sharp knock through the controller.
    if (sim.popStart !== undefined && sim.popStart !== lastPop) {
      lastPop = sim.popStart;
      effects.slap(sim, boardGroup, clamp(0.4 * sim.popK, 0.2, 0.4));
      audio.slap(0.4);
      rumbleKick = Math.max(rumbleKick, 0.55);
    }
    // A batten popping through: a clack, and a tick through the controller.
    if (sim.battenPop && sim.battenPop !== lastBatten) {
      lastBatten = sim.battenPop;
      audio.batten();
      battenKick = 0.45;
    }
    // Touching down off a chop: spray, a slap and a thump through the controller.
    if (sim.landing && sim.landing !== lastLanding) {
      lastLanding = sim.landing;
      const hit = sim.landing.hit;
      if (hit > 0.5) {
        const k = tw.juice.landing;
        if (k > 0) {
          effects.slap(sim, boardGroup, clamp(0.25 + hit * 0.3, 0.3, 0.9) * k);
          audio.slap(clamp(hit / 2 * k, 0.15, 1));
          rumbleKick = Math.max(rumbleKick, clamp(hit / 2.5, 0.25, 0.85) * k);
        }
      }
    }
  }
  renderTime += paused ? dt * 0.25 : 0;

  // ---- Visuals, interpolated between the last two physics steps
  const cur = snapshot();
  const prev = prevState ?? cur;
  const a = paused ? 1 : clamp(acc / DT, 0, 1);
  const lerpAngle = (x, y) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * a;
  const view = {
    pos: [0, 1, 2].map((i) => prev.pos[i] + (cur.pos[i] - prev.pos[i]) * a),
    yaw: lerpAngle(prev.yaw, cur.yaw), pitch: lerpAngle(prev.pitch, cur.pitch), roll: lerpAngle(prev.roll, cur.roll),
    t: prev.t + (cur.t - prev.t) * a,
  };
  boardGroup.position.set(view.pos[0], view.pos[1], view.pos[2]);
  boardGroup.rotation.set(view.roll, view.yaw, view.pitch, 'YZX');
  boardGroup.updateMatrixWorld(true);
  // (the world's own time: slower in slow motion, stopped while paused)
  const sdt = paused ? 0 : dt * juice.timeScale;
  rig.update(sim, paused ? dt : sdt, sailor.pose && sim.sailor.hooked && sim.state === S.SAILING ? sailor.hookLocal.clone() : null);
  // (paused, the sailor holds still: the body's springs and smoothing wait)
  sailor.update(sim, rig, sdt);
  rig.drapeAround(sim, sailor);
  rig.updateUphaul(sim, sailor);
  camRig.goal = story?.target?.at ?? null;
  if (!camRig.goal) camRig.lookGoal = false;
  camRig.update(dt, sim, sim.waves, view);
  water.update(view.t, camera);
  effects.update(sdt, sim, boardGroup, sim.waves, { camera, height: renderer.domElement.height, water, t: view.t });
  skyUniforms.uTime.value = view.t;
  world.update(view.t, sim.waves, story?.target ?? null);
  windFx.update(sdt, camera, sim.wind, view.t, sim.waves.height(camera.position.x, camera.position.z, view.t));
  sun.position.set(sim.pos[0] + env.sunDir.x * 60, env.sunDir.y * 60, sim.pos[2] + env.sunDir.z * 60);
  sun.target.position.set(sim.pos[0], 0, sim.pos[2]);
  sun.target.updateMatrixWorld();

  const shown = usedControls ?? controls;
  // (in the story: a button to look toward the mark you're heading for)
  const tg = story && !story.complete ? story.target : null;
  hud.extra = tg ? [[hud.glyphs(input).R3, camRig.lookGoal ? 'Camera back' : `Look toward ${tg.name}`]] : [];
  hud.update(dt, sim, input, shown);
  // (in the story, only once speed is what the chapter's about)
  const gpsOn = gps && !lesson && settings.gpsPanel && (!story || story.chapter.goals.some((g) => g.kind === 'gps'));
  hud.updateGps(dt, gpsOn ? gps : null, book, sim);
  if (story) storyUi.update(story, sim, hud.glyphs(input), storyStart);
  if (gps && !paused) {
    recordCheck -= dt;
    if (recordCheck <= 0) { recordCheck = 0.25; checkRecords(); }
    sessionSave -= dt;
    if (sessionSave <= 0) { sessionSave = 5; saveSession(); }
  }
  if (lesson) {
    lessonUi.update(dt, lesson, shown, framePressed, hud.glyphs(input), hud.isPs(input), {
      index: LESSONS.indexOf(lesson.lesson), count: LESSONS.length,
      inWater: sim.state === S.WATER || sim.state === S.FALLING, sailing: sim.state === S.SAILING,
    });
  }
  if (!paused) audio.update(sim);

  // Rumble: the low motor carries the load in the sail and what you'd feel
  // through your body: a gust filling the sail, hiking at full stretch, and
  // (pulsing, harder as it nears the limit) the pull tipping you over your
  // toes before a catapult. The high motor carries the chatter of chop and a
  // fluttering luff, a buzz as the fin nears spin-out, and a pulse when a
  // hand is close to losing its grip.
  rumbleTimer -= dt;
  rumbleKick = Math.max(0, rumbleKick - dt * 2.5);
  battenKick = Math.max(0, battenKick - dt * 6);
  if (rumbleTimer <= 0 && !paused) {
    rumbleTimer = 0.06;
    const tel = sim.telemetry;
    const f = sim.feel ?? {};
    const pulse = Math.sin(sim.t * Math.PI * 2 * 5) > 0 ? 1 : 0.3;
    const load = clamp((sim.handForce - 60) / 700, 0, 1) ** 1.4;
    const luff = sim.aero ? clamp(1 - Math.abs(tel.alpha) * 57.3 / 7, 0, 1) * clamp(sim.aero.qMean / 25, 0, 1) : 0;
    const tip = f.pitch > 0 ? (0.25 + 0.65 * Math.min(1, f.pitch)) * pulse : 0;
    const strong = Math.max(load * 0.45, rumbleKick, tip, (f.lateral ?? 0) * 0.45, (f.gust ?? 0) * 0.6);
    // (and goes quiet while the board flies)
    const weak = clamp((sim.airborne ? 0 : tel.planing * clamp(tel.speed / 14, 0, 1) * 0.18) + (sim.chopHit ?? 0) * 0.9 + luff * 0.25 +
      (sim.finVentilated ? 0.7 : (f.fin ?? 0) * 0.45) + (f.hand ?? 0) * 0.5 * pulse + battenKick, 0, 1);
    input.rumble(Math.max(strong, juice.strong) * tw.juice.rumble, Math.max(weak, juice.weak) * tw.juice.rumble, 90);
  }

  bloom.strength = tw.juice.glow;
  if (direct) renderer.render(scene, camera);
  else composer.render(dt);
  // (handles for the headless checks and screenshots)
  window.__beamReach = { sim, controls: lastControls, paused, lesson, story, career, effects, boardGroup, water, camera, renderer, gps, book, Coach, hud, camRig, sailor, rig, tune, juice, audio };
}
requestAnimationFrame(frame);
