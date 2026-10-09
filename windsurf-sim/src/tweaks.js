// Live tweaks: the numbers behind the game's feel that you can adjust while
// you play, in the tuning panel (ui/tuneui.js). The game reads them from
// `tw` (tw.sailor.hipsHz and so on) every frame, so a change shows at once.
// Defaults are the game as it ships; the headless checks always run on them.
// Changes are kept in this browser, and "Copy changes" gives just the ones
// that differ from the defaults, to send back and make the new defaults.

export const TWEAK_GROUPS = [
  { id: 'controls', name: 'Controls', note: 'How the sticks and triggers drive the rig and your weight.' },
  { id: 'sailor', name: 'Sailor', note: "The body's give, the head, the back, and how quickly the pose follows the physics." },
  { id: 'camera', name: 'Camera', note: 'The chase camera: where it sits and how it follows.' },
  { id: 'juice', name: 'Juice', note: 'Rumble, spray, glow and landing impact.' },
  { id: 'physics', name: 'Physics', note: 'These change how the board and rig behave. The coach and the lessons are tested on the defaults: send changes here and the tests are re-run (a lesson may need retuning).' },
];

/** [key, label, min, max, step, default, what it does] */
const DEFS = [
  // Controls
  ['controls.deadzone', 'Stick dead zone', 0, 0.4, 0.01, 0.14, 'How far a stick moves before it does anything.'],
  ['controls.stickCurve', 'Stick response curve', 0.5, 3, 0.05, 1, '1 = linear. Higher: finer control near the centre, full travel still reaches full.'],
  ['controls.crossTalk', 'Left stick axis lock', 0, 0.8, 0.01, 0.35, 'Pushing the left stick mostly one way ignores a little of the other axis, so raking the rig doesn\'t lean it by accident.'],
  ['controls.triggerCurve', 'Trigger response curve', 0.5, 3, 0.05, 1, '1 = linear. Higher: finer sheeting and hiking near the start of the trigger.'],
  ['controls.sheetSpeed', 'Sheeting speed', 0.3, 3, 0.05, 1, 'How fast the boom follows the sheet trigger, in and out.'],
  ['controls.rigSpeed', 'Rig rake/lean speed', 0.3, 3, 0.05, 1, 'How fast the rig follows the left stick.'],
  ['controls.rakeRange', 'Rake range', 0.3, 2, 0.05, 1, 'How far the rig rakes forward and back at full stick.'],
  ['controls.leanRange', 'Lean range', 0.3, 2, 0.05, 1, 'How far the rig leans sideways at full stick.'],
  ['controls.stepAt', 'Step threshold', 0.2, 0.95, 0.01, 0.55, 'How far the right stick goes (up/down, feet out of the straps) before a weight shift becomes a step along the board.'],
  // Sailor
  ['sailor.give', 'Body give', 0, 3, 0.05, 1, 'How much the body reacts to the board\'s motion (chop, landings, carves). 0 = rigid.'],
  ['sailor.hipsHz', 'Legs spring (Hz)', 0.8, 5, 0.05, 2, 'How stiff the legs are: lower is a softer, slower bounce.'],
  ['sailor.hipsDamping', 'Legs damping', 0.1, 1.5, 0.01, 0.5, 'How quickly the legs\' bounce dies away: lower bounces more.'],
  ['sailor.upperHz', 'Back spring (Hz)', 0.8, 6, 0.05, 2.8, 'How stiff the back is when the upper body sways.'],
  ['sailor.upperDamping', 'Back damping', 0.1, 1.5, 0.01, 0.4, 'How quickly the upper body\'s sway dies away.'],
  ['sailor.sway', 'Upper body sway', 0, 3, 0.05, 1, 'How far the upper body swings over the hips.'],
  ['sailor.headLevel', 'Head stays level', 0, 1, 0.01, 0.4, 'How much the head stays upright against the body\'s lean and the board\'s tilt. 0 = moves with the body.'],
  ['sailor.hipTwist', 'Hip twist', 0, 2.5, 0.05, 1, 'How far the hips turn toward the bow from the shoulders.'],
  ['sailor.backArch', 'Back arch', 0, 3, 0.05, 1, 'How much the back arches hanging in the harness and rounds crouching.'],
  ['sailor.poseSpeed', 'Pose follow speed', 0.3, 3, 0.05, 1, 'How quickly the body moves into each new pose the physics asks for.'],
  // Camera
  ['camera.fov', 'Field of view', 35, 100, 1, 60, 'Degrees of view, top to bottom.'],
  ['camera.speedFov', 'Extra view at speed', 0, 25, 0.5, 0, 'Degrees added to the field of view at full speed, for a sense of speed.'],
  ['camera.chaseDistance', 'Chase: distance', 3, 15, 0.1, 6.5, 'Metres behind the board.'],
  ['camera.chaseHeight', 'Chase: height', 0, 6, 0.1, 1.5, 'Metres above the board.'],
  ['camera.chaseSide', 'Chase: to windward', -4, 6, 0.1, 2.2, 'Metres out to windward of the board.'],
  ['camera.follow', 'Follow tightness', 0.5, 10, 0.1, 3.2, 'How quickly the camera catches up with the board: lower lags more.'],
  ['camera.turnFollow', 'Turn follow', 0.3, 6, 0.1, 1.6, 'How quickly the camera swings round after a turn.'],
  ['camera.bobFollow', 'Ride the chop', 0.3, 12, 0.1, 2.2, 'How closely the camera follows the board up and down: higher bobs more with the chop.'],
  ['camera.shake', 'Camera shake', 0, 4, 0.05, 1, 'Sway when slapping over chop at speed (with camera shake on in Settings).'],
  ['camera.kicks', 'Camera kicks', 0, 3, 0.05, 1, 'How much the camera reacts to big moments: widening as you get planing, pulling back for a trick, dipping on a hard landing.'],
  // Juice
  ['juice.rumble', 'Rumble strength', 0, 2, 0.05, 1, 'All controller rumble.'],
  ['juice.spray', 'Spray amount', 0, 3, 0.05, 1, 'Spray off the rails and the nose.'],
  ['juice.glow', 'Glow', 0, 1.5, 0.01, 0.3, 'Bloom around bright highlights (with glow on in Settings).'],
  ['juice.landing', 'Landing impact', 0, 3, 0.05, 1, 'Slap, spray and rumble when the board lands off a chop or a jump.'],
  ['juice.actions', 'Action feedback', 0, 2, 0.05, 1, 'The sound, rumble and body response to what you do: hooking in, stepping into a strap, pumping, the sail filling, the rig swishing round.'],
  ['juice.moments', 'Big moments', 0, 2, 0.05, 1, 'Payoffs for the big moments: getting planing, a gust hitting, a landing, a trick (sound swells, rumble, spray).'],
  ['juice.slowmo', 'Slow motion', 0, 1, 0.05, 0.5, 'How slow the slow motion gets at the top of a big jump and as a trick comes off. 0 = never.'],
  ['juice.banners', 'Big moment text', 0, 1, 1, 1, 'The big text for a trick, a jump, a landing and getting planing (1 = on).'],
  // Physics
  ['physics.sailPower', 'Sail power', 0.5, 1.6, 0.01, 1, 'Scales every force the sail makes.'],
  ['physics.hullDrag', 'Board drag', 0.5, 1.6, 0.01, 1, 'Scales the water\'s drag on the board.'],
  ['physics.gusts', 'Gust strength', 0, 2.5, 0.05, 1, 'Scales how much stronger (and lighter) the gusts and lulls are.'],
  ['physics.holdStrength', 'Body strength', 0.5, 2, 0.01, 1, 'How much sideways pull you can hold before you\'re pulled over (core and legs).'],
  ['physics.pop', 'Pop strength', 0.3, 2.5, 0.05, 1, 'How hard the legs kick the board up when you pop for a jump.'],
];

export const TWEAKS = DEFS.map(([key, label, min, max, step, def, help]) => ({ key, group: key.split('.')[0], label, min, max, step, def, help }));
const BY_KEY = new Map(TWEAKS.map((d) => [d.key, d]));

/** The live values, by group: tw.sailor.hipsHz. */
export const tw = {};
for (const d of TWEAKS) {
  const [g, k] = d.key.split('.');
  (tw[g] ??= {})[k] = d.def;
}

const STORE = 'beam-reach-tweaks-v1';
const listeners = new Set();
const round = (d, v) => {
  const n = Math.round((v - d.min) / d.step) * d.step + d.min;
  return +Math.min(d.max, Math.max(d.min, n)).toFixed(6);
};

export const getTweak = (key) => { const [g, k] = key.split('.'); return tw[g]?.[k]; };
export const tweakDef = (key) => BY_KEY.get(key);
export const isChanged = (key) => { const d = BY_KEY.get(key); return !!d && Math.abs(getTweak(key) - d.def) > d.step / 2; };

/** Set one (clamped to its range and step); tells the listeners. */
export function setTweak(key, value, save = true) {
  const d = BY_KEY.get(key);
  if (!d || !Number.isFinite(+value)) return false;
  const [g, k] = key.split('.');
  tw[g][k] = round(d, +value);
  for (const fn of listeners) fn(key, tw[g][k]);
  if (save) saveTweaks();
  return true;
}
export const resetTweak = (key) => { const d = BY_KEY.get(key); if (d) setTweak(key, d.def); };
export function resetAllTweaks() {
  for (const d of TWEAKS) setTweak(d.key, d.def, false);
  saveTweaks();
}
/** Called with (key, value) whenever one changes. */
export const onTweak = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Only what differs from the defaults: {"group.name": value}. */
export function changedTweaks() {
  const out = {};
  for (const d of TWEAKS) if (isChanged(d.key)) out[d.key] = getTweak(d.key);
  return out;
}
/** Take a set of changes ({"group.name": value}, as copied); returns how many were applied. */
export function applyTweaks(obj) {
  let n = 0;
  for (const [key, v] of Object.entries(obj ?? {})) if (setTweak(key, v, false)) n++;
  saveTweaks();
  return n;
}

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
export function saveTweaks() {
  try { store()?.setItem(STORE, JSON.stringify(changedTweaks())); } catch { /* private window: kept for this visit only */ }
}
/** In the browser: what you set last time. (Headless, there's no store: the defaults.) */
export function loadTweaks() {
  try {
    const raw = store()?.getItem(STORE);
    if (raw) for (const [key, v] of Object.entries(JSON.parse(raw))) setTweak(key, v, false);
  } catch { /* a bad entry: defaults */ }
}
