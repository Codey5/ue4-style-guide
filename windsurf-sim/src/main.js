// Beam Reach: wiring of simulation, rendering, input, sound and UI.
import * as THREE from 'three';
import { Sim, S, BEACH_Z } from './physics/sim.js';
import { clamp } from './physics/math.js';
import { BOOM_RATIO } from './physics/gear.js';
import { createEnvironment, createRenderer, createScene, World } from './render/scene.js';
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

const DT = 1 / 240;
const STORE_KEY = 'beam-reach-settings-v2';

const defaults = {
  windKn: 15, gustiness: 0.45, shifts: 0.5, chop: 1,
  boardId: 'free135', sailArea: 7.0, mass: 75, height: 183, boomRel: 0,
  autoHike: false, noFalls: false, rumble: true, invertRake: false, volume: 0.8, lessonsDone: [],
  windParticles: true, cameraShake: true,
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
const canvas = document.getElementById('view');
const renderer = createRenderer(canvas);
const env = createEnvironment();
const { scene, skyUniforms, sun } = createScene(env);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
const camRig = new CameraRig(camera);

let sim = makeSim('secure');
const water = new Water(scene, env);
const world = new World(scene, sim.wind);
const effects = new Effects(scene);
const windFx = new WindParticles(scene);
const input = new Input(canvas);
const hud = new Hud();
const audio = new Audio();
const lessonUi = new LessonUi();
let lesson = null; // active LessonRunner

const boardGroup = new THREE.Group();
scene.add(boardGroup);
let boardMesh = null, rig = null, sailor = null;

/** A sim from the sandbox settings, or from a lesson's setup (keeping your body and boom height). */
function makeSim(start, setup = null, watch = false) {
  const wind = setup ? setup.wind : { speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop };
  return new Sim({
    boardId: setup?.boardId ?? settings.boardId, sailArea: setup?.sailArea ?? settings.sailArea, sailorMass: settings.mass,
    sailorHeight: settings.height / 100, boomHeight: boomHeightFor(settings) / 100,
    wind: { ...wind, fromDeg: 270 },
    // The coach does its own hiking and never uses the no-falls assist.
    assists: watch ? { autoHike: false, noFalls: false } : { autoHike: settings.autoHike, noFalls: settings.noFalls },
    start: setup?.start ?? start,
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

function restart(mode, setup = null, watch = false) {
  const at = sim ? [sim.pos[0], 0, sim.pos[2]] : null;
  const nearShore = at && at[2] < BEACH_Z + 40;
  sim = makeSim(mode, setup, watch);
  if (!setup && at && !nearShore && Math.hypot(at[0], at[2]) < 2500) sim.reset(mode, at);
  buildModels();
  syncWorld();
  effects.clearTrail();
  hud.resetEvents(sim);
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
  camRig.shakeEnabled = settings.cameraShake;
  audio.volume = settings.volume;
  audio.setMuted(audio.muted);
  saveSettings(settings);
}

let paused = true;
let gearTimer = 0;

function startLesson(id, mode) {
  const def = findLesson(id);
  if (!def) return;
  audio.start();
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

const menu = new Menu(settings, {
  start: (mode) => { audio.start(); exitLesson(); restart(mode); menu.started = true; resume(); },
  lesson: (id, mode) => startLesson(id, mode),
  exitLesson: () => { exitLesson(); restart('secure'); resume(); },
  resume: () => resume(),
  conditions: () => {
    if (lesson) { exitLesson(); restart('secure'); }
    sim.setWind({ speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop });
    syncWorld();
    saveSettings(settings);
  },
  gear: () => {
    saveSettings(settings);
    if (lesson) exitLesson();
    clearTimeout(gearTimer); // sliders fire continuously; rebuild once they settle
    gearTimer = setTimeout(() => restart('secure'), 200);
  },
  options: () => applyOptions(),
});
menu.completed = new Set(settings.lessonsDone);

function resume() {
  paused = false;
  menu.hide();
  hud.show(true);
  canvas.focus?.();
}
function pause() {
  paused = true;
  menu.show();
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
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;
let rumbleTimer = 0;
let rumbleKick = 0;
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
    if (ui.camNext) { camRig.cycle(1); hud.flashCamera(camRig.modeName); }
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
    acc += dt;
    let first = true;
    let steps = 0;
    framePressed = {};
    let restartLesson = null;
    while (acc >= DT && steps < 24) {
      const coachDriving = lesson && lesson.mode === 'watch';
      const c = coachDriving ? lesson.controls(DT) : first ? controls : { ...controls, pressed: {} };
      prevState = snapshot();
      sim.step(DT, c);
      usedControls = c;
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
      first = false;
      acc -= DT;
      steps++;
    }
    if (steps >= 24) acc = 0;
    if (restartLesson) {
      startLesson(restartLesson.lesson.id, restartLesson.mode);
      sim.emit('lesson', 'The coach fell in. It happens to everyone! Starting the lesson again.', 2);
    }

    for (const e of hud.pushEvents(sim)) {
      if (e.type === 'fall') {
        const p = new THREE.Vector3(sim.pos[0], sim.pos[1] + 0.3, sim.pos[2]);
        effects.splash(p, 1.2);
        audio.splash();
        rumbleKick = 1;
      } else if (e.type === 'spinout' || e.type === 'grip') rumbleKick = Math.max(rumbleKick, 0.7);
      else if (e.type === 'planing') rumbleKick = Math.max(rumbleKick, 0.25);
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
  rig.update(sim, dt, sailor.pose && sim.sailor.hooked && sim.state === S.SAILING ? sailor.hookLocal.clone() : null);
  sailor.update(sim, rig, dt);
  effects.update(paused ? 0 : dt, sim, boardGroup, sim.waves);
  camRig.update(dt, sim, sim.waves, view);
  water.update(view.t, camera);
  skyUniforms.uTime.value = view.t;
  world.update(view.t, sim.waves);
  windFx.update(paused ? 0 : dt, camera, sim.wind, view.t, sim.waves.height(camera.position.x, camera.position.z, view.t));
  sun.position.set(sim.pos[0] + env.sunDir.x * 40, env.sunDir.y * 40, sim.pos[2] + env.sunDir.z * 40);
  sun.target.position.set(sim.pos[0], 0, sim.pos[2]);
  sun.target.updateMatrixWorld();

  const shown = usedControls ?? controls;
  hud.update(dt, sim, input, shown);
  if (lesson) {
    lessonUi.update(dt, lesson, shown, framePressed, hud.glyphs(input), hud.isPs(input), {
      index: LESSONS.indexOf(lesson.lesson), count: LESSONS.length,
      inWater: sim.state === S.WATER || sim.state === S.FALLING,
    });
  }
  if (!paused) audio.update(sim);

  // Rumble: the low motor carries the load in the sail, the high motor the
  // chatter of chop, a fluttering luff and a ventilating fin.
  rumbleTimer -= dt;
  rumbleKick = Math.max(0, rumbleKick - dt * 2.5);
  if (rumbleTimer <= 0 && !paused) {
    rumbleTimer = 0.1;
    const tel = sim.telemetry;
    const load = clamp((sim.handForce - 60) / 700, 0, 1) ** 1.4;
    const luff = sim.aero ? clamp(1 - Math.abs(tel.alpha) * 57.3 / 7, 0, 1) * clamp(sim.aero.qMean / 25, 0, 1) : 0;
    const strong = Math.max(load * 0.55, rumbleKick);
    const weak = clamp(tel.planing * clamp(tel.speed / 14, 0, 1) * 0.18 + (sim.chopHit ?? 0) * 0.9 + luff * 0.25 + (sim.finVentilated ? 0.7 : 0), 0, 1);
    input.rumble(strong, weak, 130);
  }

  renderer.render(scene, camera);
  window.__beamReach = { sim, controls: lastControls, paused, lesson };
}
requestAnimationFrame(frame);
