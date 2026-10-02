# Beam Reach

A windsurfing simulator for the browser, built around a game controller and real physics. The sail is a soft wing in an apparent-wind field. The board is a planing hull with a fin that can spin out. You are a body that has to balance the pull of the rig with its own weight. Nothing is scripted to "feel right": if the board planes, it's because hydrodynamic lift carried the load and the drag dropped.

Focus of this first version: **freeride / blasting** and **learning the basics**, in a **pure sandbox** where you pick the wind, the gear and your weight.

## Play

1. Open `dist/beam-reach.html` in a recent Chrome, Edge or Firefox. It is a single self-contained file, so it works offline and from disk.
2. Plug in an Xbox or PlayStation controller and press any button (Chrome/Edge support rumble).
3. Pick **Go sailing**. You start in the secure position with the rig up.

No controller? The keyboard works too (see below), though analog triggers make it far more natural.

New to it, or to windsurfing? Open **Lessons** in the menu.

## Lessons

Six lessons, each with two modes:

- **Watch:** a coach sails the technique step by step, with a caption for each step. An on-screen controller shows exactly what the coach does with the sticks, triggers and buttons, in Xbox or PlayStation layout.
- **Try it:** you sail the same lesson. The steps tick off as you complete them, and the same controller overlay shows your own inputs.

Press Y (△, or G on the keyboard) while watching to take over.

| # | Lesson | Gear and wind |
| --- | --- | --- |
| 1 | Uphaul and first reach | Beginner 210 L, 5.3 m², 9 kn |
| 2 | Steering with the rig | Beginner 210 L, 5.3 m², 10 kn |
| 3 | Getting planing (pump, hook in, straps) | Freeride 135 L, 7.0 m², 16 kn |
| 4 | Tack | Beginner 210 L, 5.3 m², 10 kn |
| 5 | Carve gybe | Freeride 135 L, 7.0 m², 17 kn |
| 6 | Waterstart | Freeride 115 L, 6.3 m², 16 kn |

The coach is not a canned animation. It drives the same simulation through the same controls a player uses: it steers with rig rake, then with the rails once planing; trims the sheet to an angle of attack; hikes to match the pull; sits back on the tail at speed and stands the rig up on a broad reach; and eases off before its grip goes. `npm test` runs every lesson for 65, 75 and 90 kg sailors and fails if the coach falls, loses its grip or spins out. It also poses the 3D sailor through every lesson, and through powered-up sandbox runs for short and tall sailors with the boom at both ends of its range, and fails if a hand ever leaves the boom.

## Controls

Sticks are relative to the board. Push the left stick where you want the mast tip to go; push the right stick toward the rail you want to sink.

| Controller | Keyboard | Action |
| --- | --- | --- |
| Left stick ↑ / ↓ | W / S | Rake the rig toward the nose (bear away) or the tail (head up) |
| Left stick ← / → | A / D | Lean the rig to port / starboard (windward lean gives lift) |
| Right stick ↑ / ↓ | ↑ / ↓ | Weight on the front / back foot; push past halfway to step along the board |
| Right stick ← / → | ← / → | Sink the port / starboard rail: carve when planing |
| RT / R2 | E more · Q less | Sheet in with the back hand (analog) |
| LT / L2 | C more · Z less | Hike out: hang your body weight outboard (analog) |
| A / ✕ | H | Hook in / unhook · climb onto the board when in the water |
| X / □ | F | Tap: step into the next footstrap · hold: feet out |
| B / ○ | T | Tack: step round the front of the mast |
| Y / △ | G | Flip the sail (gybe) · swap sides in secure position |
| LB / L1 (hold) | U | Uphaul on the board · waterstart in the water |
| RB / R1 (hold) | P | Pump |
| L3 | X | Drop the rig |
| D-pad ← / → | V | Camera: chase, windward, leeward, overhead, free orbit (mouse drag) |
| D-pad ↑ / ↓ | Mouse wheel | Camera distance |
| View / Share | Tab | Telemetry panel |
| Menu / Options | Esc | Pause: conditions, gear, controls, technique |

The in-game **Technique** tab walks through uphauling, steering, getting planing, harness and straps, tacking, the carve gybe and the waterstart, with a glossary.

## What's simulated

**Wind**

- You can read the wind like on a real spot: dark gust patches, streaks and wind lanes lined up with the wind on the water, flags, a windsock, and air particles drifting with the local wind (gusts visibly speed them up; they can be turned off in Controls).
- Forecast wind is given at 10 m. A logarithmic boundary layer over water (z₀ = 0.2 mm) means the sail sees about 85% of it.
- Gusts are a moving noise field advected with the wind. The water shader evaluates the same noise, so the dark patches you see coming are the gusts you will feel.
- Slow and gust-correlated wind shifts.

**Sail** (strip theory, four horizontal strips)

- Each strip has its own apparent wind: true wind at its height, minus board velocity, minus yaw rotation, minus the rig's own motion. Pumping and fast sheeting therefore really change the airflow.
- Soft-sail lift/drag polar with luffing below about 5°, a gentle stall past 23°, flat-plate behaviour beyond, and a weaker inverted-camber response when backwinded.
- The leech twists open as dynamic pressure rises, which is the sail's own gust depower.
- Raking the rig back and keeping it upright closes the foot gap and raises the effective aspect ratio.
- The force acts at each strip's centre of pressure. Steering comes from the centre of effort moving relative to the fin and daggerboard (rake forward = bear away, sheet in = head up). Leaning the rig to windward gives vertical lift that unweights the board. With the boom eased on a broad reach, the same lean mostly tips the force upward and costs drive.

**Hull**

- Savitsky's prismatic planing equations give the wetted length from the fore-aft load position and the trim angle needed for dynamic lift. Whatever weight dynamic lift can't carry, buoyancy carries, and that part pays wave-making drag.
- That gap is the planing hump. You get through it with power, a flat board, weight forward and pumping.
- Standing in the straps before planing sinks the tail. Weight too far forward at speed digs the nose in. Once planing, weight back on the tail shortens the wetted length and cuts friction; mast-foot pressure and the rig's weight pull the load forward again.
- The sail's drive reaches the board at deck level, through your feet and the mast foot, so it only pitches the nose down by the deck's height. You lean back against the rest.
- Friction uses the ITTC-57 line on the actual wetted area. At speed you ride on the narrow tail.
- Small boards sink when the speed drops: volume (litres) against total mass (kg).
- Chop is a set of directional wave trains travelling downwind; the board rides them.

**Fin and daggerboard**

- Finite-wing lift and induced drag, with stall.
- The fin ventilates (spin-out) when overloaded. It's worse with high trim, the board rolled to windward, chop, or weight on the back foot.
- At low speed a fin-only board makes big leeway; the beginner board's daggerboard lets it point.

**Steering with the feet**

- When planing, sinking a rail tilts the hydrodynamic lift into a carving force.
- In displacement mode a heeled hull turns the other way, as on a real board.

**The sailor**

- Set your weight and height in the Gear menu. The body is built from standard anthropometric proportions.
- The default sailor is 183 cm and 75 kg. The boom sits between chest and shoulder height (0.74 × your height, 135 cm for 183 cm), adjustable like on a real rig. A higher boom gives more leverage; a lower one gives more control.
- The sail's heeling moment about the board's centreline is fought by your leaning body weight, plus core strength (which scales with body mass) and foot pressure on the rails.
- You can pull yourself back upright on the boom, since the rig is pinned at the mast foot.
- Too little hike for the power and you're pulled over (a catapult if you're hooked in and fast). Hanging out in a lull and you fall in to windward.
- Unhooked, your forearms tire and a big gust rips the sail out of your back hand. The harness takes the load off your arms but won't let you escape a gust.
- Hooked in and in the straps, the stance pulls the rig back, and harness load goes into the mast foot (mast-foot pressure keeps the nose down).

**Maneuvers**

- **Tack:** sheet in and rake back to head up, then step round once the nose crosses the wind. Stall head to wind and you fall in.
- **Carve gybe:** the sail flip at dead downwind sends the clew round the front of the mast. Flip early and it backwinds.
- **Waterstart:** held up into the wind, the sail pulls like a kite. That needs the sail filled (not flapping, not stalled past the clew) and the board across the wind. You steer the board by pushing it through the mast foot. Minimum winds come out at about 12 kn for 7.0 m² and 75 kg, and about 14 kn for 5.3 m² or a 90 kg sailor.
- **Uphaul, secure position, dropping the rig.**

### Validation

`npm test` runs the board through steady-state checks with an autopilot sailor (auto-hike on, no gusts) plus scripted maneuvers, and fails if bearing away from a beam reach to 130° costs more than 10% of the speed. Typical results (75 kg, 183 cm sailor):

| Setup | Result | Real-world reference |
| --- | --- | --- |
| 135 L, 7.0 m², 6–10 kn, beam reach | 4–6 kn, displacement | Slogging speeds |
| 135 L, 7.0 m², 11 / 12 kn | 6.7 kn slogging / just planes | Planing threshold ~12 kn for this combination |
| 135 L, 7.0 m², 14 / 16 / 20 kn | 19.7 / 21.2 / 23.7 kn board speed | Typical freeride GPS speeds |
| 135 L, 7.0 m², 24 kn | 25 kn, sailor at the limit | 7.0 m² is too big here |
| 135 L, 16 kn, close-hauled planing | holds about 55° to the true wind | 50–55° typical for freeride |
| 135 L, 16 kn, 90° / 130° | 20.4 / 20.8 kn | A broad reach is as fast or faster once planing |
| 135 L, 22 kn, 100° / 130° / 145° | 24.5 / 26.0 / 20.0 kn | Fastest on a broad reach; deep angles need more wind |
| 135 L, 16 kn, 140° and deeper | drops off the plane | The apparent wind gets too light to carry the board |
| 115 L, 6.3 m², 18 kn / 95 L, 5.3 m², 22 kn | 24.3 / 27.8 kn | Smaller, faster boards |
| 210 L beginner, 5.3 m², 8 kn | 4.5 kn, can sail 55° upwind | Daggerboard boards point in light wind |
| 95 L board, 85 kg sailor | refuses to float you standing still | A sinker |

`npm run drag` prints the hull resistance curve, which shows the hump and the effect of stance.

## Developing

```bash
npm install        # three.js and esbuild
npm run dev        # http://localhost:8000 serves index.html with live ES modules
npm run build      # writes dist/beam-reach.html (single file, ~710 KB)
npm test           # physics speed polar, maneuver checks, every lesson sailed by the coach, hands-on-boom pose check
```

```
src/physics/   wind & chop, sail aero, planing hull & foils, sailor + state machine (no rendering deps)
src/coach/     the coach (an expert sailor driving the controls) and the lesson scripts
src/render/    three.js: water shader, sky & spot, board/rig/sailor models, spray & wake, cameras
src/ui/        gamepad & keyboard input, HUD, menu, procedural audio
tools/         build script, physics, maneuver, lesson and pose checks
```

The physics runs at a fixed 240 Hz (about 5 µs per step) independent of the frame rate; rendering interpolates between the last two physics states so motion stays smooth at any refresh rate. The water has no textures: waves and ripples are evaluated per pixel and filtered by their size on screen (the procedural equivalent of mipmapping), so distant water doesn't shimmer.

## Not in this version

- Wave sailing, jumps and foiling.
- Real swell and breaking waves.
- Race courses and timing.
- Remappable controls.
- A detailed sailor animation rig: the sailor is posed with inverse kinematics from the simulation state. The hands are placed on the boom first and the body leans out only as far as the arms reach, so at full hike the drawn lean is less than the physics lean shown in the HUD.

