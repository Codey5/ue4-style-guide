// Beam Reach: wiring of simulation, rendering, input, sound and UI.
import * as THREE from 'three';
import { Sim, S, BEACH_Z } from './physics/sim.js';
import { clamp } from './physics/math.js';
import { createEnvironment, createRenderer, createScene, World } from './render/scene.js';
import { Water } from './render/water.js';
import { buildBoard, Rig, Sailor } from './render/models.js';
import { Effects } from './render/effects.js';
import { CameraRig } from './render/camera.js';
import { Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Audio } from './ui/audio.js';

const DT = 1 / 240;
const STORE_KEY = 'beam-reach-settings-v1';

const defaults = {
  windKn: 15, gustiness: 0.45, shifts: 0.5, chop: 1,
  boardId: 'free135', sailArea: 7.0, mass: 75,
  autoHike: false, noFalls: false, rumble: true, invertRake: false, volume: 0.8,
};
function loadSettings() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...defaults };
}
function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const settings = loadSettings();
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
const input = new Input(canvas);
const hud = new Hud();
const audio = new Audio();

const boardGroup = new THREE.Group();
scene.add(boardGroup);
let boardMesh = null, rig = null, sailor = null;

function makeSim(start) {
  return new Sim({
    boardId: settings.boardId, sailArea: settings.sailArea, sailorMass: settings.mass,
    wind: { speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop, fromDeg: 270 },
    assists: { autoHike: settings.autoHike, noFalls: settings.noFalls },
    start,
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

function restart(mode) {
  const at = sim ? [sim.pos[0], 0, sim.pos[2]] : null;
  const nearShore = at && at[2] < BEACH_Z + 40;
  sim = makeSim(mode);
  if (at && !nearShore && Math.hypot(at[0], at[2]) < 2500) sim.reset(mode, at);
  buildModels();
  syncWorld();
  effects.clearTrail();
  hud.resetEvents(sim);
  camRig.yaw = null;
  camRig.pos.set(0, 0, 0); // snap instead of flying in from the old spot
  camRig.look.set(0, 0, 0);
}

function applyOptions() {
  sim.assists.autoHike = settings.autoHike;
  sim.assists.noFalls = settings.noFalls;
  input.rumbleEnabled = settings.rumble;
  input.invertRake = settings.invertRake;
  audio.volume = settings.volume;
  audio.setMuted(audio.muted);
  saveSettings(settings);
}

let paused = true;
const menu = new Menu(settings, {
  start: (mode) => { audio.start(); restart(mode); menu.started = true; resume(); },
  resume: () => resume(),
  conditions: () => {
    sim.setWind({ speedKn: settings.windKn, gustiness: settings.gustiness, shifts: settings.shifts, chop: settings.chop });
    syncWorld();
    saveSettings(settings);
  },
  gear: () => { saveSettings(settings); restart('secure'); },
  options: () => applyOptions(),
});

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
camRig.update(0.016, sim, sim.waves);

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

    // Fixed-step physics; button presses go to the first sub-step only.
    acc += dt;
    let first = true;
    let steps = 0;
    while (acc >= DT && steps < 24) {
      const c = first ? controls : { ...controls, pressed: {} };
      sim.step(DT, c);
      first = false;
      acc -= DT;
      steps++;
    }
    if (steps >= 24) acc = 0;

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

  // ---- Visuals
  boardGroup.position.set(sim.pos[0], sim.pos[1], sim.pos[2]);
  boardGroup.rotation.set(sim.roll, sim.yaw, sim.pitch, 'YZX');
  boardGroup.updateMatrixWorld(true);
  rig.update(sim, dt, sailor.pose && sim.sailor.hooked && sim.state === S.SAILING ? sailor.hookLocal.clone() : null);
  sailor.update(sim, rig, dt);
  effects.update(paused ? 0 : dt, sim, boardGroup, sim.waves);
  water.update(sim.t, camera);
  skyUniforms.uTime.value = sim.t;
  world.update(sim.t, sim.waves);
  camRig.update(dt, sim, sim.waves);
  sun.position.set(sim.pos[0] + env.sunDir.x * 40, env.sunDir.y * 40, sim.pos[2] + env.sunDir.z * 40);
  sun.target.position.set(sim.pos[0], 0, sim.pos[2]);
  sun.target.updateMatrixWorld();

  hud.update(dt, sim, input, controls);
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
  window.__beamReach = { sim, controls: lastControls, paused };
}
requestAnimationFrame(frame);
