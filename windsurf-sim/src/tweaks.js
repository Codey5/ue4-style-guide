// Live tweaks: the numbers behind the game's feel that you can adjust while
// you play, in the tuning panel (ui/tuneui.js). The game reads them from
// `tw` (tw.sailor.hipsHz and so on) every frame, so a change shows at once.
// Defaults are the game as it ships; the headless checks always run on them.
// Changes are kept in this browser, and "Copy changes" gives just the ones
// that differ from the defaults, to send back and make the new defaults.
// The slider covers a sensible range; a typed value can go far beyond it,
// held only inside a safety range that keeps the game from breaking.

export const TWEAK_GROUPS = [
  { id: 'controls', name: 'Controls', note: 'How the sticks and triggers drive the rig and your weight.' },
  { id: 'sailor', name: 'Sailor', note: "The body's give, the head, the back, and how quickly the pose follows the physics." },
  { id: 'camera', name: 'Camera', note: 'The chase camera: where it sits and how it follows.' },
  { id: 'juice', name: 'Juice', note: 'Rumble, spray, glow, and the response to actions and big moments.' },
  { id: 'physics', name: 'Physics', note: 'These change how the board and rig behave. The coach and the lessons are tested on the defaults: send changes here and the tests are re-run (a lesson may need retuning).' },
];

// (the controls marked "coach too" change the rig itself, so the autopilot and the lessons' coach sail with them as well)
const COACH = ' The coach sails with this too.';

/** [key, label, slider min, slider max, step, default, [safe low, safe high], exactly what it does] */
const DEFS = [
  // Controls
  ['controls.deadzone', 'Stick dead zone', 0, 0.4, 0.01, 0.14, [0, 0.95],
    'The share of each stick\'s travel, from the centre, that reads as nothing (0.14 = the first 14%). Past it, the rest of the travel is stretched to cover the full range. Raise it if the rig drifts with your thumbs off the sticks; lower it for a quicker response. Both sticks; controller only.'],
  ['controls.stickCurve', 'Stick response curve', 0.5, 3, 0.05, 1, [0.05, 20],
    'The power the stick deflection is raised to (after the dead zone): 1 = linear; 2 = half way gives a quarter; 0.5 = half way gives 71%. Full travel always gives full. Higher gives finer rake, lean, weight and rail control near the centre. Controller only.'],
  ['controls.crossTalk', 'Left stick axis lock', 0, 0.8, 0.01, 0.35, [0, 0.95],
    'Pushing the left stick mostly one way, the other axis ignores a sideways push up to this share of the main one (0.35: raking at full stick, a 35% sideways wobble is ignored), so raking the rig doesn\'t lean it by accident. 0 = off. Controller only.'],
  ['controls.triggerCurve', 'Trigger response curve', 0.5, 3, 0.05, 1, [0.05, 20],
    'The power the triggers (RT sheet, LT hike) are raised to: 1 = linear; 2 = half way gives a quarter. Higher gives finer sheeting and hiking over the first part of the pull. Controller only.'],
  ['controls.sheetSpeed', 'Sheeting speed', 0.3, 3, 0.05, 1, [0.01, 50],
    'Multiplies how fast the boom follows the sheet trigger: at 1 it sheets in at up to 110°/s (slower under load) and out at 150°/s. 2 = twice as fast.' + COACH],
  ['controls.rigSpeed', 'Rig rake/lean speed', 0.3, 3, 0.05, 1, [0.01, 50],
    'Multiplies how fast the rig rakes and leans after the left stick: at 1 up to 115°/s, settling on the stick\'s angle in about a sixth of a second.' + COACH],
  ['controls.rakeRange', 'Rake range', 0.3, 2, 0.05, 1, [0, 2.5],
    'Multiplies how far the rig rakes at full stick: at 1, 34° toward the nose (bearing away) and 24° toward the tail (heading up).' + COACH],
  ['controls.leanRange', 'Lean range', 0.3, 2, 0.05, 1, [0, 2.5],
    'Multiplies how far the rig leans sideways at full stick: at 1, 34° to either side (on top of what hanging on it brings over).' + COACH],
  ['controls.stepAt', 'Step threshold', 0.2, 0.95, 0.01, 0.55, [0, 0.99],
    'Right stick up/down, with your feet out of the straps: below this share of its travel it shifts your weight between your feet; past it you step along the board (faster the further you push).' + COACH],
  // Sailor
  ['sailor.give', 'Body give', 0, 3, 0.05, 1, [0, 20],
    'Multiplies how hard the board\'s motion under your feet (chop slamming into it, a landing, slowing, a carve) throws the body\'s springs: 0 = rigid; 2 = twice the bounce. Drawing only.'],
  ['sailor.hipsHz', 'Legs spring (Hz)', 0.8, 5, 0.05, 2, [0.1, 30],
    'How many times a second the hips would bounce on the legs (the legs\' stiffness): 2 = a bounce every half second. Lower is a softer, deeper, slower give; higher is stiff legs. Drawing only.'],
  ['sailor.hipsDamping', 'Legs damping', 0.1, 1.5, 0.01, 0.5, [0, 5],
    'How quickly a bounce of the hips dies away: 1 = straight back without overshooting; 0.5 = one small rebound; 0.2 = several. Drawing only.'],
  ['sailor.upperHz', 'Back spring (Hz)', 0.8, 6, 0.05, 2.8, [0.1, 30],
    'How many times a second the upper body would sway over the hips (the back\'s stiffness). Lower is a looser, slower swing. Drawing only.'],
  ['sailor.upperDamping', 'Back damping', 0.1, 1.5, 0.01, 0.4, [0, 5],
    'How quickly the upper body\'s sway dies away: 1 = no overshoot; lower swings back and forth more. Drawing only.'],
  ['sailor.sway', 'Upper body sway', 0, 3, 0.05, 1, [0, 20],
    'Multiplies how far the upper body swings as the hips move under it (fore and aft and sideways; hardly at all up and down). Drawing only.'],
  ['sailor.headLevel', 'Head stays level', 0, 1, 0.01, 0.4, [0, 1],
    'The share of the body\'s tilt (leaning out, the board pitching and rolling) the head turns back toward upright: 0 = the head tilts with the body; 1 = always upright. Drawing only.'],
  ['sailor.hipTwist', 'Hip twist', 0, 2.5, 0.05, 1, [0, 10],
    'Multiplies how far the hips turn toward the bow from the shoulders (which stay square to the boom): at 1 about 17° sailing, 26° in the straps, 33° hooked in and in the straps, 7° in a move. Drawing only.'],
  ['sailor.backArch', 'Back arch', 0, 3, 0.05, 1, [-5, 10],
    'Multiplies the bend in the back: arched (chest toward the boom) hanging in the harness, rounded crouching. 0 = a straight back; negative bends it the other way. Drawing only.'],
  ['sailor.poseSpeed', 'Pose follow speed', 0.3, 3, 0.05, 1, [0.05, 50],
    'Multiplies how quickly the drawn body moves into each new pose the physics asks for: at 1 it\'s most of the way there in a twentieth of a second sailing, a tenth in a move. Lower is lazier, smoother; higher snappier. Drawing only.'],
  // Camera
  ['camera.fov', 'Field of view', 35, 100, 1, 60, [5, 170],
    'The camera\'s view, top to bottom, in degrees. Wider shows more around you and feels faster; narrower is more zoomed in and flatter.'],
  ['camera.speedFov', 'Extra view at speed', 0, 25, 0.5, 0, [-60, 100],
    'Degrees added to the field of view as you speed up: none standing still, all of it at 15 m/s (29 knots) and over. A sense of speed.'],
  ['camera.chaseDistance', 'Chase: distance', 3, 15, 0.1, 6.5, [0.5, 200],
    'How far behind the board the chase camera sits, in metres (times the zoom: D-pad up/down or the mouse wheel).'],
  ['camera.chaseHeight', 'Chase: height', 0, 6, 0.1, 1.5, [-5, 100],
    'How high the chase camera sits, in metres above a point 1.2 m over the board (times the zoom).'],
  ['camera.chaseSide', 'Chase: to windward', -4, 6, 0.1, 2.2, [-100, 100],
    'How far out to windward of the board the chase camera sits, in metres (negative: to leeward, behind the sail).'],
  ['camera.follow', 'Follow tightness', 0.5, 10, 0.1, 3.2, [0.05, 100],
    'How quickly the camera catches up with where it should be, per second: at 3.2 it\'s most of the way there in a third of a second. Lower lags behind more (and swings wide in turns); higher is locked on.'],
  ['camera.turnFollow', 'Turn follow', 0.3, 6, 0.1, 1.6, [0.05, 100],
    'How quickly the camera swings round behind your new course after a turn, per second: at 1.6 most of the way in about two thirds of a second.'],
  ['camera.bobFollow', 'Ride the chop', 0.3, 12, 0.1, 2.2, [0.05, 100],
    'How closely the camera follows the board up and down, per second: low glides over the chop (the board bobs in the frame); high bobs with the board.'],
  ['camera.shake', 'Camera shake', 0, 4, 0.05, 1, [0, 50],
    'Multiplies the camera\'s sway when the board slaps over chop at speed (only with camera shake on in Settings).'],
  ['camera.kicks', 'Camera kicks', 0, 3, 0.05, 1, [0, 20],
    'Multiplies the camera\'s kicks at the big moments: 7° wider and 10% further back as you get planing, 14% back for a trick, a dip as you land a jump or the nose digs in. 0 = none.'],
  // Juice
  ['juice.rumble', 'Rumble strength', 0, 2, 0.05, 1, [0, 10],
    'Multiplies all controller rumble (both motors, capped at full).'],
  ['juice.spray', 'Spray amount', 0, 3, 0.05, 1, [0, 20],
    'Multiplies how much spray comes off the rails, the nose and the tail (very high values cost frame rate).'],
  ['juice.glow', 'Glow', 0, 1.5, 0.01, 0.3, [0, 10],
    'How strongly bright highlights (the sun on the water, white spray) bloom into a glow (only with glow on in Settings).'],
  ['juice.landing', 'Landing impact', 0, 3, 0.05, 1, [0, 20],
    'Multiplies the slap of spray, the sound and the rumble when the board lands off a chop or a jump. 0 = none.'],
  ['juice.actions', 'Action feedback', 0, 2, 0.05, 1, [0, 20],
    'Multiplies the answer to what you do: the harness hook\'s clack, a foot thudding into a strap, a pump stroke\'s whoosh, the sail\'s whump as you sheet in hard, the rig swishing round in a move; the rumble tick and the push through the body with each. 0 = none.'],
  ['juice.moments', 'Big moments', 0, 2, 0.05, 1, [0, 20],
    'Multiplies the payoffs for getting planing (hiss swell, spray burst, rumble), a gust (rush of wind, rumble), a jump landing (boom, thump) and a trick (sting, rumble). Camera kicks have their own setting. 0 = none.'],
  ['juice.slowmo', 'Slow motion', 0, 1, 0.05, 0.5, [0, 1.3],
    'How slow time gets at the top of a big jump (over 0.55 m), as a trick comes off and going over the boom in a catapult: the world runs at 1 − 0.75 × this at the slowest (0.5: 62% speed; 1: a quarter), for under half a second. 0 = never.'],
  ['juice.banners', 'Big moment text', 0, 1, 1, 1, [0, 1],
    '1: big text on screen for getting planing, how you landed a jump and a trick coming off (and no message for those as well). 0: just the messages.'],
  // Physics
  ['physics.sailPower', 'Sail power', 0.5, 1.6, 0.01, 1, [0, 5],
    'Multiplies every force the sail makes (as if the air were that much denser): more power planes earlier, pulls harder, catapults sooner.'],
  ['physics.hullDrag', 'Board drag', 0.5, 1.6, 0.01, 1, [0, 10],
    'Multiplies the water\'s drag on the hull (below and on the plane): lower is faster and planes earlier; higher is stickier.'],
  ['physics.gusts', 'Gust strength', 0, 2.5, 0.05, 1, [0, 5],
    'Multiplies how much stronger the gusts (and lighter the lulls) are than the mean wind: at 1 and a gusty day, about ±40%. 0 = a steady wind.'],
  ['physics.holdStrength', 'Body strength', 0.5, 2, 0.01, 1, [0.05, 20],
    'Multiplies the twist your core and legs can hold against the sail\'s pull on top of your weight: higher is harder to pull over; lower gets pulled over sooner.'],
  ['physics.pop', 'Pop strength', 0.3, 2.5, 0.05, 1, [0, 20],
    'Multiplies how hard your legs kick the board up when you pop for a jump (LB, let go): higher flies higher, even off small chop.'],
];

export const TWEAKS = DEFS.map(([key, label, min, max, step, def, safe, help]) => ({ key, group: key.split('.')[0], label, min, max, step, def, safe, help }));
const BY_KEY = new Map(TWEAKS.map((d) => [d.key, d]));

/** The live values, by group: tw.sailor.hipsHz. */
export const tw = {};
for (const d of TWEAKS) {
  const [g, k] = d.key.split('.');
  (tw[g] ??= {})[k] = d.def;
}

const STORE = 'beam-reach-tweaks-v1';
const listeners = new Set();
/** Slider: on its steps, within its range. Typed (free): any value, within the safety range. */
const tidy = (d, v, free) => {
  if (free) return +Math.min(d.safe[1], Math.max(d.safe[0], v)).toFixed(6);
  const n = Math.round((v - d.min) / d.step) * d.step + d.min;
  return +Math.min(d.max, Math.max(d.min, n)).toFixed(6);
};

export const getTweak = (key) => { const [g, k] = key.split('.'); return tw[g]?.[k]; };
export const tweakDef = (key) => BY_KEY.get(key);
export const isChanged = (key) => { const d = BY_KEY.get(key); return !!d && Math.abs(getTweak(key) - d.def) > 1e-6; };
/** Typed past the slider's range. */
export const isBeyond = (key) => { const d = BY_KEY.get(key), v = getTweak(key); return !!d && (v < d.min - 1e-9 || v > d.max + 1e-9); };

/**
 * Set one; tells the listeners. From the slider it lands on the slider's
 * steps and range; free (typed, pasted, remembered) it can be anything in
 * the safety range. Returns the value it was set to, or null.
 */
export function setTweak(key, value, { save = true, free = false } = {}) {
  const d = BY_KEY.get(key);
  if (!d || value === '' || value === null || !Number.isFinite(+value)) return null;
  const [g, k] = key.split('.');
  tw[g][k] = tidy(d, +value, free);
  for (const fn of listeners) fn(key, tw[g][k]);
  if (save) saveTweaks();
  return tw[g][k];
}
export const resetTweak = (key) => { const d = BY_KEY.get(key); if (d) setTweak(key, d.def); };
export function resetAllTweaks() {
  for (const d of TWEAKS) setTweak(d.key, d.def, { save: false });
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
  for (const [key, v] of Object.entries(obj ?? {})) if (setTweak(key, v, { save: false, free: true }) !== null) n++;
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
    if (raw) for (const [key, v] of Object.entries(JSON.parse(raw))) setTweak(key, v, { save: false, free: true });
  } catch { /* a bad entry: defaults */ }
}
