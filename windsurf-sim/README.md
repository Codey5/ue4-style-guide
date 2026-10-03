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

Ten lessons, each with two modes:

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
| 7 | Lean back against the pull (fore-and-aft balance, weight forward and back, broad reach) | Freeride 135 L, 7.0 m², 15 kn |
| 8 | Gusts and catapults | Freeride 115 L, 6.3 m², 16 kn, with scripted gusts |
| 9 | Tuning the rig (harness line position, downhaul) | Freeride 115 L, 6.3 m², 16 → 22 kn |
| 10 | Sailing through chop | Freeride 115 L, 6.3 m², 20 kn, rough chop |

In **Tuning the rig** the lesson retunes your rig while you sail: it starts with the harness lines 10 cm too far forward (watch the back hand do the harness's work), moves them back over the sail's draft, then builds the wind to a gusty 22 kn and pulls on maximum downhaul.

In **Gusts and catapults** the coach first gets it wrong on purpose: hooked in, weight forward and the sail locked in, a gust catapults it over the boom (the coach takes the controls for that step even in Try it). Then it's your turn to ride a gust out: weight back and ease the sheet as it hits. If it catapults you, you're put straight back on the board for another go.

The coach is not a canned animation. It drives the same simulation through the same controls a player uses: it steers with rig rake, then with the rails once planing; trims the sheet to an angle of attack; hikes to match the pull; leans the rig to windward when it needs to hang further out (and comes in to hook in); sits back on the tail at speed; and eases off before its grip goes. `npm test` runs every lesson for 65, 75 and 90 kg sailors and fails if the coach falls, loses its grip or spins out (except the catapult it means to show, which has to be a catapult). It also poses the 3D sailor through every lesson, and through powered-up sandbox runs for short and tall sailors with the boom at both ends of its range, and fails if a hand ever leaves the boom or the body is drawn at a different lean from the one the physics balances.

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

The in-game **Technique** tab walks through uphauling, steering, getting planing, harness and straps, hanging off the rig, leaning back against the pull, gusts and catapults, tuning the rig, what the rumble tells you, sailing through chop, the broad reach, tacking, the carve gybe and the waterstart, with a glossary.

**Rumble** (Chrome and Edge): the low motor carries the sail's load, thumps as a gust fills the sail and as the board lands off a chop, and pulses harder and harder as the pull tips you toward your toes before a catapult (about half a second of warning). The high motor carries the chatter of the chop (silent while the board flies) and a fluttering luff, buzzes as the fin nears a spin-out, and pulses when a hand is about to lose its grip.

## What's simulated

**Wind**

- You can read the wind like on a real spot: dark gust patches, wind lanes lined up with the wind, whitecaps, flags, a windsock, and air particles drifting with the local wind (gusts visibly speed them up; they can be turned off in Controls).
- The chop is shaded by its height: troughs look down into deep water and go dark, crests are thin water the light shines through, brighter and a little greener (most of all looking toward the sun). It's the same waves the board rides, so you can read the chop coming.
- Whitecaps are the tops of the chop breaking: they sit on the crests of the same waves the board rides, spill down the downwind face, lie across the wind along the crest and travel downwind with the waves, leaving a fainter trail of foam behind. The first white horses appear around Bft 3–4, many by Bft 5; only in a gale (Bft 7+) does the foam get blown into thin streaks along the wind.
- Forecast wind is given at 10 m. A logarithmic boundary layer over water (z₀ = 0.2 mm) means the sail sees about 85% of it.
- Gusts are a moving noise field advected with the wind. The water shader evaluates the same noise, so the dark patches you see coming are the gusts you will feel.
- Slow and gust-correlated wind shifts.

**Sail** (strip theory, four horizontal strips)

- Each strip has its own apparent wind: true wind at its height, minus board velocity, minus yaw rotation, minus the rig's own motion. Pumping and fast sheeting therefore really change the airflow.
- Soft-sail lift/drag polar with luffing below about 5°, a gentle stall past 23°, flat-plate behaviour beyond, and a weaker inverted-camber response when backwinded.
- The leech twists open as dynamic pressure rises, which is the sail's own gust depower.
- Raking the rig back and keeping it upright closes the foot gap and raises the effective aspect ratio.
- Rig tuning (Gear menu). **Outhaul** sets the depth: loose is fuller (more lift for planing early, but more camber drag and the draft further back), tight is flatter. **Downhaul** sets how the leech twists open under load: more twist off for a windy day, a tight leech for grunt in light wind, and with too little the draft blows back in gusts (more drag, a heavier back hand).
- The force acts at each strip's centre of pressure. Steering comes from the centre of effort moving relative to the fin and daggerboard (rake forward = bear away, sheet in = head up). Leaning the rig to windward gives vertical lift that unweights the board. With the boom eased on a broad reach, the same lean mostly tips the force upward and costs drive.

**Hull**

- Savitsky's prismatic planing equations give the wetted length from the fore-aft load position and the trim angle needed for dynamic lift. Whatever weight dynamic lift can't carry, buoyancy carries, and that part pays wave-making drag.
- That gap is the planing hump. You get through it with power, a flat board, weight forward and pumping.
- Standing in the straps before planing sinks the tail. Weight too far forward at speed digs the nose in. Once planing, weight back on the tail shortens the wetted length and cuts friction; mast-foot pressure and the rig's weight pull the load forward again.
- The sail's drive reaches the board at deck level, through your feet and the mast foot, so it only pitches the nose down by the deck's height. You lean back against the rest.
- Friction uses the ITTC-57 line on the actual wetted area. At speed you ride on the narrow tail.
- Small boards sink when the speed drops: volume (litres) against total mass (kg).
- Chop is a set of directional wave trains travelling downwind. The board rides it with real contact: floating, it follows the surface along its length; planing, it rides on the wetted patch of tail, which averages out ripples shorter than it, and your legs soak up much of the rest. The water only pushes. A chop face rising under a fast board (its slope times your speed, plus the wave's own motion) throws the board up, and when the water drops away faster than gravity can follow, the board flies until it lands. At speed it skips off the chop; steep chop launches it.
- Slamming over the chop takes its energy from your speed, and every landing scrubs some off, most of all nose-first: flat water is fast. Flying, the hull lets go of the water (no drag, no rail grip) and only the tip of the fin stays in; a high or tail-first landing drags air down the fin, an easy spin-out.
- The nose meets the faces of the chop ahead. Pointing up at them, its rocker lifts it over with a slap of spray; pushed in deeper than the rocker can deflect with the board pitched down (weight forward, or dropping off a crest), it buries and the board stops dead. The braking throws you forward through the fore-and-aft balance: that's a nose-dive catapult. Weight back keeps the nose up, in the water and in the air (your feet in the straps steer the board while it flies).
- The rig sits on a universal joint: you hold it steady while the board pitches over the waves underneath it.

**Fin and daggerboard**

- Finite-wing lift and induced drag, with stall.
- The fin ventilates (spin-out) when overloaded. It's worse with high trim, the board rolled to windward, chop, or weight on the back foot.
- At low speed a fin-only board makes big leeway; the beginner board's daggerboard lets it point.

**Steering with the feet**

- When planing, sinking a rail tilts the hydrodynamic lift into a carving force.
- In displacement mode a heeled hull turns the other way, as on a real board.

**The sailor**

- Set your weight, height, boom height and harness line length in the Gear menu. The body is built from standard anthropometric proportions (segment lengths and masses), and the physics balances exactly the body you see: the lean in the HUD is the lean that's drawn.
- The default sailor is 183 cm and 75 kg, with the boom between chest and shoulder height (0.74 × your height, 135 cm) and 32" harness lines (0.45 × your height).
- The sail's heeling moment about the board's centreline is fought by your weight times how far your centre of mass is out from that centreline, worked out from the posed body (feet in the straps, hook in the lines, hands on the boom), plus core and leg strength (which scale with body mass) and foot pressure on the rails.
- How far out you can hang is geometry. Unhooked, it's your arms' reach to the boom; hooked in, it's the harness lines. Leaning the rig to windward brings the boom out over the water so you can hang further out, but past about 15° the sail loses more drive than you gain. Longer lines let you hang further out. A higher boom lets you lean further on straight arms but needs longer lines. Your hands slide back along the boom as you move back toward the straps; with the sail eased right out they stay forward, where the boom is still in reach.
- To hook in, the lines have to reach the hook: sheet in and come in toward the boom. Hooked in with your feet still forward, the lines are behind you and you can't hang out far; in the straps they're over your feet.
- Fore and aft, too. The rig is pinned at the mast foot and its drive (high up) and lift (behind the mast) tip it forward. You hold it back through your hands or the harness, so the same pull tips you forward over your front foot. You balance it by leaning back, with the hips back over the tail, until your weight behind your feet matches the pull at the hook or hands. Your feet can press anywhere from the back heel to the front toes, a little further with them in the straps. Weight forward or back (right stick) picks where; leaning back with weight forward, more of your weight hangs on the boom into the mast foot. The board feels that pressure: it's where the hull is loaded. The HUD's stance panel shows it: a bar from heel to toes, a line where your feet press, a ring for your centre of mass, and how far back you're leaning, amber as the pull nears what your toes can hold and red past it.
- Technique takes some of the pull before it reaches you: the rig's own weight, a push-pull between your hands, and hanging your weight down on the boom behind the mast (into the mast foot, which presses the nose down, so only as much as you need).
- A step is a step. Moving your feet back into the straps doesn't move your body: you come upright over the new stance and have to lean back again. Walk back first and the front foot only has a short step into its strap; step a long way back while leaning hard against the pull and it drags you forward over your toes.
- **Catapults.** Hooked in, the lines can't give. A gust's extra pull arrives faster than you can lean back, tips you over your front foot, and the harness launches you over the boom. Weight back and easing the sheet as the gust hits lets you ride it out. Unhooked, your arms give first: the rig rakes forward, and if it keeps dragging you forward you let go with the back hand. Lean back with too little pull to hold you (a lull) and you sit down off the back of the board.
- Too little hike for the power and you're pulled over sideways (a catapult if you're hooked in and fast). Hang out with more weight than the sail is pulling and the rig comes over on top of you: you fall in to windward.
- You can pull yourself back upright on the boom, since the rig is pinned at the mast foot.
- **Hands and harness lines.** The sail's pull sits at its draft, part way along the boom. Hooked in with the lines over that point, the harness takes it all and the hands only steady the rig. Lines forward of it leave the back hand pulling a couple (the front pushing); lines behind it load the front hand, and the sail sheets in on you. The hands can't hold the boom quite still against that, and the extra load drains your forearms. Gusts blow the draft back, so a rig balanced in a lull goes back-hand heavy in a gust. The HUD's Hands bar shows front and back.
- **Mast foot** position (Gear menu): forward puts its weight and the mast-foot pressure further forward (nose down, more control, the rig's pull ahead of the fin); back frees the board for speed.
- Unhooked, your forearms tire and a big gust rips the sail out of your back hand. The harness takes the load off your arms but won't let you escape a gust.
- Hooked in and in the straps, the stance pulls the rig back, and harness load goes into the mast foot (mast-foot pressure keeps the nose down).

**Maneuvers**

- **Tack:** sheet in and rake back to head up, then step round once the nose crosses the wind. Stall head to wind and you fall in.
- **Carve gybe:** the sail flip at dead downwind sends the clew round the front of the mast. Flip early and it backwinds.
- **Waterstart:** held up into the wind, the sail pulls like a kite. That needs the sail filled (not flapping, not stalled past the clew) and the board across the wind. You steer the board by pushing it through the mast foot. Minimum winds come out at about 12 kn for 7.0 m² and 75 kg, and about 14 kn for 5.3 m² or a 90 kg sailor.
- **Uphaul, secure position, dropping the rig.**
- The coach sails rough water the way a good sailor does: weight further back and a touch less power, and knocked off the plane upwind, it bears away to get going again before heading back up.

### Validation

`npm test` runs the board through steady-state checks with an autopilot sailor (auto-hike on, no gusts) plus scripted maneuvers, and fails if bearing away from a beam reach to 130° costs more than 10% of the speed, or if a gust doesn't catapult a sailor with weight forward and the sail locked in (or does catapult one who sinks back and eases the sheet), or if the controller doesn't warn before the catapult, or if a rig-tuning setting doesn't have the effect below, or if chop doesn't cost speed, make the board skip at speed (not on flat water) and punish weight forward in rough water. Typical results (75 kg, 183 cm sailor):

| Setup | Result | Real-world reference |
| --- | --- | --- |
| 135 L, 7.0 m², 6–10 kn, beam reach | 4–6 kn, displacement | Slogging speeds |
| 135 L, 7.0 m², 11 / 12 kn | 6.8 kn slogging / just planes (10.4 kn) | Planing threshold ~12 kn for this combination |
| 135 L, 7.0 m², 14 / 16 / 20 kn | 17.4 / 18.6 / 19.6 kn board speed | Typical freeride GPS speeds |
| 135 L, 7.0 m², 24 kn | 19.8 kn, sailor at the limit | 7.0 m² is too big here |
| 135 L, 16 kn, close-hauled planing | holds 55° to the true wind at 9.9 kn | 50–55° typical for freeride |
| 135 L, 16 kn, 90° / 130° | 18.0 / 17.3 kn | A broad reach holds its speed once planing |
| 135 L, 22 kn, 100° / 130° / 145° | 20.1 / 20.7 / 14.3 kn | Fastest on a broad reach; deep angles need more wind |
| 135 L, 16 kn, 140° and deeper | drops off the plane | The apparent wind gets too light to carry the board |
| 115 L, 6.3 m², 18 kn / 95 L, 5.3 m², 22 kn | 21.3 / 23.5 kn | Smaller, faster boards |
| 135 L, 16 kn, flat water / standard chop (0.34 m) | 21.4 / 18.6 kn, skipping off the chop 10% of the time | Flat water is fast; chop costs speed |
| 135 L, 22 kn, rough chop (0.74 m), weight forward / back | 14.8 / 18.2 kn | Keep the nose up in rough water |
| 183 cm, 32" lines, hooked in, rig leaned ~16°, fully powered | hangs out ~25–30°, leans back ~30°, centre of mass ~35 cm behind where the feet press | A typical hooked-in freeride stance |
| 115 L, 6.3 m², 16 kn, planing hooked in, gust to 24 kn | weight forward, sail locked in: catapulted. Weight back, sheet eased: rides it out | Why you sheet out and sink back in a gust |
| 210 L beginner, 5.3 m², 8 kn | 4.5 kn, can sail 55° upwind | Daggerboard boards point in light wind |
| 95 L board, 85 kg sailor | refuses to float you standing still | A sinker |

Rig tuning, same board and sail (`node tools/physics-check.mjs tune`):

| Change | Effect |
| --- | --- |
| Outhaul loose / tight, 12 kn | 15.4 kn planing / 7.1 kn, not planing |
| Outhaul loose, 16 kn | back hand about twice as loaded (the draft further back) |
| Downhaul maximum / light, gusty 22 kn | 20.3 / 18.2 kn |
| Downhaul light / maximum, 12 kn | 9.0 / 7.5 kn |
| Mast foot 10 cm back / forward, 22 kn, flat water | 23.7 / 23.0 kn (forward rides nose-down; in rough chop forward is the faster, steadier ride) |
| Harness lines 10 cm forward / back, 16 kn | back hand loaded / front hand loaded, and the sail sheets in on you |

`npm run drag` prints the hull resistance curve, which shows the hump and the effect of stance.

## Developing

```bash
npm install        # three.js and esbuild
npm run dev        # http://localhost:8000 serves index.html with live ES modules
npm run build      # writes dist/beam-reach.html (single file, ~730 KB)
npm test           # physics speed polar, maneuver checks, every lesson sailed by the coach, hands-on-boom pose check
```

```
src/physics/   wind & chop, sail aero, planing hull & foils, the sailor's body geometry, balance + state machine (no rendering deps)
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
- A detailed sailor animation rig: the sailor is a simple figure posed with inverse kinematics, the same body the physics balances. Leaning back, it's drawn as far back as its arms (or harness lines) reach toward the lean the physics balances.

