# Beam Reach

A windsurfing simulator for the browser, built around a game controller and real physics. The sail is a soft wing in an apparent-wind field. The board is a planing hull with a fin that can spin out. You are a body that has to balance the pull of the rig with its own weight. Nothing is scripted to "feel right": if the board planes, it's because hydrodynamic lift carried the load and the drag dropped.

Focus of this version: **freeride / blasting** and **learning the basics**: a **story** that takes you from your first day on a board to speed week, and a **sandbox** where you pick the wind, the gear and your weight.

## Play

1. Open `dist/beam-reach.html` in a recent Chrome, Edge or Firefox. It is a single self-contained file, so it works offline and from disk.
2. Plug in an Xbox or PlayStation controller and press any button (Chrome/Edge support rumble).
3. Pick **Story** to start from scratch, or **Go sailing** to sail free (you start in the secure position with the rig up).

No controller? The keyboard works too (see below), though analog triggers make it far more natural.

New to it, or to windsurfing? Start the **Story**. The **Lessons** in the menu show each technique, sailed by a coach.

## Story

A summer at the spot, in ten chapters: from never having stood on a windsurf board to speed week on the sandbar. Kai, who runs the school on the beach, picks the board, the sail and the day for each one, starting on the biggest, steadiest board in barely any wind and building up a little at a time. Each chapter has four goals, done in order; a chapter takes a few minutes, and finishing it unlocks the next (finished chapters are kept in your browser). Restarting a chapter starts it afresh. From chapter 4 the sails are sized for your weight (the Gear tab's weight setting): a school rigs a heavier sailor a bigger sail.

| # | Chapter | Gear and wind | Goals |
| --- | --- | --- | --- |
| 1 | Day one | Beginner 210 L, 4.2 m², 7 kn | Climb onto the board · Pull the rig out of the water · Sheet in and get moving · Sail 100 m without falling in |
| 2 | There and back | Beginner 210 L, 5.3 m², 9 kn | Bear away · Head up · Tack · Sail out to the orange buoy and back to the school buoy |
| 3 | Upwind | Beginner 210 L, 5.8 m², 11 kn | Sail close-hauled for 15 seconds · Reach the upwind buoy · Gybe · Back downwind to the school buoy |
| 4 | A proper breeze | Freeride 155 L, 5.8 / 7.0 / 8.6 m² (65 / 75 / 90 kg: the smallest sail that will plane), 14 kn, gusty | Lean right out against the pull · Sail 300 m through the gusts without falling in · Get planing · Hit 10 knots |
| 5 | Harness and straps | Freeride 155 L, 7.8 / 8.6 / 8.6 m², 16 kn | 15 seconds hooked in · Front foot in the strap · Both feet in the straps · Plane for 20 seconds without dropping off |
| 6 | Hooked in | Freeride 135 L, 7.0 / 7.8 / 7.8 m², 17 kn | Plane 30 s hooked in and in the straps · Hit 18 knots · Plane upwind for 10 s · Carve gybe |
| 7 | Small board | Freeride 115 L, 6.3 / 6.3 / 7.0 m², 18 kn | Waterstart · Plane 30 s without stopping · Hit 20 knots · Carve gybe and plane out of it |
| 8 | Chop hop | Freeride 115 L, 5.8 / 6.3 / 7.0 m², 20 kn, rough chop | Plane 60 s through the chop without falling in · A 30 cm jump · Half a metre of air · Land three jumps cleanly |
| 9 | Freestyle | Freeride 115 L, 5.8 / 5.8 / 6.3 m², 18 kn, flat | Duck gybe · Carving 360 · Spock · Helitack |
| 10 | Speed week | Freemove 95 L, 4.7 / 4.7 / 5.3 m², 24 kn, on the speed strip | Hit 25 knots · 500 m over 22 knots · 5 × 10 s over 22 knots · Hit 27 knots |

While you sail a chapter, a card at the top of the screen lists its goals, ticks each one off as you do it (with a chime and a nudge through the controller), shows your progress on the one you're working on and Kai's hint for it in your controller's own buttons, and points the way to the buoy to head for, which has a yellow ring on the water round it: click the right stick (R3, or L on the keyboard) and the camera looks toward it from behind you, again to look back. Pause for a link to the lesson that shows the technique. The goals are spotted the way the game sees everything else: the sailor's state, the events the physics reports (a tack, a waterstart, a jump, a trick) and the GPS. Story sessions are logged by the GPS like free sailing (records count from 10 knots), so a personal best set in speed week counts.

## Speed sessions

Free sailing is logged by a GPS, the way speedsurfers measure themselves (the GPS Team Challenge categories). It samples your speed and position ten times a second and keeps your best:

| | |
| --- | --- |
| **2 s** | 2-second peak: best average speed over any 2 seconds |
| **10 s** | best average over any 10 seconds |
| **5×10 s** | average of your five best 10-second windows that don't overlap |
| **500 m** | best average over any 500 metres |
| **NM** | best average over a nautical mile (1852 m) |
| **α 500** | alpha: a run of at most 500 m out and back through a gybe, finishing within 50 m of where it started |

The GPS panel (under the wind dial) shows this session beside your personal bests; a new best is announced once the run is over. The **Speed** tab in the menu has your bests (with the date, board, sail and wind), this session, and a log of recent sessions, all kept in your browser. Lessons aren't logged.

**The speed strip.** A long, low sandbar lies a few hundred metres downwind of the start, angled so that sailing along it is a broad reach on starboard tack. The chop can't get past it: the water in its lee is flat right behind it and builds up again over about 450 m of fetch, while the chop breaks white on its windward edge. Two orange flags on the bar mark a 500 m course, and a line of yellow buoys marks the outside of the flat water. Keep off the sand: sail onto it and you run aground. **Start: at the speed strip** (Go sailing, or the Speed tab) puts you at the top of it, already heading down it. The physics, the water shader and the wake all use the same sheltering, so the flat water you see is the flat water you sail on: in 22 kn and rough chop the coach goes about 28 kn on the strip and 20 kn outside it.

**Choosing your gear.** Pick your board and sail in the Gear tab. Its chart shows, for each sail on that board at your weight, the wind it works in: from getting planing (pumping onto it on a beam reach) to overpowered (sailing with the sail eased right off), with today's wind marked and the sail a good sailor would rig (well powered, about two thirds of the way up its range) picked out. The ranges come from the simulation itself: `npm run quiver` has the coach sail every board with every sail across the wind range, at 75 kg, and they're scaled for your weight (heavier sailors need more wind to plane and can hold more). After a session, its log entry says how your gear actually suited the wind: well matched, overpowered (planing with the sail eased right off, or pulled over) or underpowered (off the plane while trying to get going).

## Lessons

Twelve lessons, each with two modes:

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
| 11 | Jumping off the chop (crouch, pop, fly, land tail first) | Freeride 115 L, 6.3 m², 20 kn, rough chop |
| 12 | Freestyle (duck gybe, carving 360, spock, helitack) | Freeride 115 L, 6.3 m², 18 kn |

In **Tuning the rig** the lesson retunes your rig while you sail: it starts with the harness lines 10 cm too far forward (watch the back hand do the harness's work), moves them back over the sail's draft, then builds the wind to a gusty 22 kn and pulls on maximum downhaul.

In **Freestyle** the coach plays all four moves in turn off the plane, powering up again between them, and comes out of each the way it's sailed: carving on out of the duck gybe, sheeting in after the 360 and the spock, and sailing away on the new tack after the helitack. If a move goes wrong, it powers up and has another go.

In **Gusts and catapults** the coach first gets it wrong on purpose: hooked in, weight forward and the sail locked in, a gust catapults it over the boom (the coach takes the controls for that step even in Try it). Then it's your turn to ride a gust out: weight back and ease the sheet as it hits. If it catapults you, you're put straight back on the board for another go.

The coach is not a canned animation. It drives the same simulation through the same controls a player uses: it steers with rig rake, then with the rails once planing; trims the sheet to an angle of attack; hikes to match the pull; leans the rig to windward when it needs to hang further out (and comes in to hook in); sits back on the tail at speed; and eases off before its grip goes. `npm test` also has the coach play every chapter of the story, as 65, 75 and 90 kg sailors on the gear Kai picks for each, and fails unless it completes every goal (getting back on after falls, beating up to the buoys, and borrowing the lessons' own demonstrations for carve gybes and tricks). It runs every lesson for the same three sailors and fails if the coach falls or doesn't finish (except the catapult it means to show, which has to be a catapult); it also lists any slip along the way, a lost grip or a spin-out. It also poses the 3D sailor through every lesson, and through powered-up sandbox runs for short and tall sailors with the boom at both ends of its range, and fails if a hand ever leaves the boom (short of the last moment before a fall, when the sailor is losing the rig) or the body is drawn at a different lean from the one the physics balances.

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
| LB / L1 (hold) | U or J | Uphaul on the board · waterstart in the water · sailing: hold to crouch, let go to pop off the chop (jump) |
| LB + Y / X / A / B | U + G / F / H / T | Freestyle, from the crouch: duck gybe · carving 360 · spock · helitack |
| RB / R1 (hold) | P | Pump |
| L3 | X | Drop the rig |
| D-pad ← / → | V | Camera: chase, windward, leeward, overhead, free orbit (mouse drag) |
| R3 (click) | L | Story: look toward the buoy you're heading for (again to look back) |
| D-pad ↑ / ↓ | Mouse wheel | Camera distance |
| View / Share | Tab | Detailed HUD: telemetry, stance diagram, every bar and every control for now |
| Menu / Options | Esc | Pause: conditions, gear, controls, technique |

**The HUD** shows only what you need while sailing: your speed and the wind's (top left, with chips for planing, hooked in and the straps when they're on), the wind's direction on a dial (top right), the balance strip with your grip left in ten segments and a warning when you're at your limit (bottom), and the one or two buttons worth pressing next (bottom right; crouched, the freestyle moves). In the story the chapter's card sits at the top: a dot for each goal and the one you're on, with an arrow and the distance to the mark, and Kai talks you through it from the bottom of the screen (offering his lesson if you're stuck on a goal for a while). View / Tab brings up the detailed HUD: the telemetry, the stance diagram, the sheet, hike, hands and forearms bars, and every control for the moment with the reason for each. The lessons show the stance diagram and the bars they talk about.

The in-game **Technique** tab walks through uphauling, steering, getting planing, harness and straps, hanging off the rig, leaning back against the pull, gusts and catapults, tuning the rig, what the rumble tells you, sailing through chop, jumping off it, freestyle, the living sail, the broad reach, tacking, the carve gybe and the waterstart, with a glossary.

**Rumble** (Chrome and Edge): the low motor carries the sail's load, thumps as a gust fills the sail, knocks as you pop and thumps as the board lands off a chop, and pulses harder and harder as the pull tips you toward your toes before a catapult (about half a second of warning). The high motor carries the chatter of the chop (silent while the board flies), a fluttering luff and the tick of a batten popping through, buzzes as the fin nears a spin-out, and pulses when a hand is about to lose its grip.

## What's simulated

**Wind**

- You can read the wind like on a real spot: dark gust patches, wind lanes lined up with the wind, whitecaps, flags, a windsock, and air particles drifting with the local wind (gusts visibly speed them up; they can be turned off in Controls).
- The chop is shaded by its height: troughs look down into deep water and go dark, crests are thin water the light shines through, brighter and a little greener (most of all looking toward the sun). It's the same waves the board rides, so you can read the chop coming.
- Whitecaps are the tops of the chop breaking: they sit on the crests of the same waves the board rides, spill down the downwind face, lie across the wind along the crest and travel downwind with the waves, leaving a faint film of foam behind. Up close the foam has a grain that runs with the wind: a bright lip where it's breaking, and behind it foam torn into clumps and streaks down the face, soft-edged, with the dark water showing through. The first white horses appear around Bft 3–4 and there are many by Bft 5; from about 12 knots the wind starts drawing the foam out into long thin lines along the wind, more and brighter as it blows harder.
- Spray is fine droplets, drawn as short motion streaks, soft sheets of it, and a little mist, and the wind carries it all downwind. Planing, the leeward rail throws sheets of spray out and back, and from about 14 knots the tail kicks up a rooster tail behind the fin; more when the board slaps through chop. Landing off a chop squirts flat sheets out from under both rails. The wake is churned, streaky foam that breaks up as it ages.
- **Time of day** (Conditions): golden hour (the default), afternoon or midday. The sun is out over the sea, so sailing out you look into it: a low sun lays a long, bright glitter path on the water, backlights the sail and the spray, warms the horizon and the clouds' sunlit sides, and the sea far off fades into the sky behind it. A glow pass lets the brightest light (the sun, its glitter, sunlit spray) bleed a little like it does in a camera; it can be turned off in Controls on a slow machine. The frame is drawn off-screen in high precision and its edges smoothed with FXAA (no multisampled float buffers, which are heavy at high resolution and flaky on some GPUs); if the browser resets the graphics anyway, the game carries on drawing straight to the screen, without the glow, and says so.
- The wake is a strip of aerated foam lying on the same chop the water draws, so it rides over the waves. Fresh off the tail it's solid white; as it ages it spreads, tears into patches and fades, sooner in rough water.
- Forecast wind is given at 10 m. A logarithmic boundary layer over water (z₀ = 0.2 mm) means the sail sees about 85% of it.
- Gusts are a moving noise field advected with the wind. The water shader evaluates the same noise, so the dark patches you see coming are the gusts you will feel.
- Slow and gust-correlated wind shifts.

**Sail** (strip theory, four horizontal strips)

- Each strip has its own apparent wind: true wind at its height, minus board velocity, minus yaw rotation, minus the rig's own motion. Pumping and fast sheeting therefore really change the airflow.
- Soft-sail lift/drag polar with luffing below about 5°, a gentle stall past 23°, flat-plate behaviour beyond, and a weaker inverted-camber response when backwinded.
- The leech twists open as dynamic pressure rises, which is the sail's own gust depower. The twist is aeroelastic: the leech only opens until that strip is close to luffing, never past it, so a gust depowers the sail without turning the head inside out.
- **Battens.** Each strip's camber sits on one side of the sail, held there by its batten. When the wind presses on the other side hard enough (a tack, a gybe, a sail flagged out and caught again, a backwinding lull) the batten pops through to the new side with a clack and a tick through the controller, one strip at a time, often the loaded foot first. Until it does, that strip flies with its camber the wrong way round: a weak, draggy shape.
- **What you see** is the shape the physics computes: each strip's camber on its batten's side, filled to its load, twisted off to its own angle (the head visibly opening in a gust), and a batten snapping through with a little overshoot. Sheeted out until it luffs, the luff pocket shivers and a ripple runs back across the cloth; at high apparent wind the leech flutters.
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

**Jumps**

- Hold LB to crouch: your knees bend and soak up more of the chop. Let go to pop: for a moment your legs drive the board down against the water (about 1.5 m/s of lift for a full crouch, less for a quick tap), and stiff legs take the whole kick of the face you're on instead of soaking it up. Pop as the tail starts up a steep face and the two add up; pop on flat water and it's a hop of ten centimetres or so. It needs planing speed and both feet in the straps.
- Driving the board into the water loads the planing surface, so the pop costs a little speed; climbing the face turns some of your speed into height.
- In the air, the sail keeps pulling and nothing in the water holds the board back, so you speed up a little and drift downwind. Lean the rig to windward and its lift holds you up longer; the bottom of the board, nose or windward rail lifted into the apparent wind, carries a little too. Weight back keeps the nose up. Your knees come up under you, lifting the board higher, and your feet keep it pointing where you're going (and turn it on its rail).
- Landing: tail first or flat with soft knees is clean. Nose first, it digs in and stops dead and the lurch throws you over the front; a hard flat landing can too, if you're sheeted in hard. Coming down sideways, steeply on the tail or from high up drags air down the fin. Every landing scrubs off some speed, so jumping roughly breaks even with sailing through the chop at best.
- In 20 knots and a short chop, a well-timed pop gets about half a metre and two thirds of a second in the air, up to a metre off the best ramps. The HUD shows your height while you fly and the last and best jump; the detailed HUD's telemetry has the details.

**Freestyle**

All four moves start the same way: hold LB to crouch, then press a button. Each has its own physics, and each can go wrong in its own way.

- **Duck gybe** (LB + Y): carving downwind on the plane (unhooked, heading 105–172° off the wind), you throw the rig across clew first and duck under it instead of flipping it round the front. The board carves on its own physics; only the rig's path is the move. Duck before the board is past about 125° off the wind and the wind fills the sail from the wrong side; leave it until the board has carved back up past 140° on the new tack and it's backwinded too.
- **Carving 360** (LB + X): flat out on a reach (planing, about 12 knots or more, unhooked). Sink the rail toward the sail: the harder you press, the tighter the circle (5 to 12 m) and the more the board banks (12–28°). The sail pulls you through the first quarter, flags out like a weathervane as the board goes downwind and through the wind, and you catch it again for the last 60°. The turn bleeds speed (the carve's sideways load is drag); run out of speed before you're round and you stall and fall in.
- **Spock** (LB + A): on the plane with your weight on the front foot (right stick up), unhooked. The nose bites and the board pivots right round on it, tail out of the water, while you hold the rig still above it. It spins fast at first and slows as it goes; you come out at about a fifth of your entry speed. Weight back in the first half of the spin and the nose lets go: you fall in. Hooked in, the rig just catapults you.
- **Helitack** (LB + B): on a close reach, feet out of the straps and unhooked, with a little speed. The rig goes back and the board luffs up through the wind, faster the more speed you carry; once it's through, the board drifts backwards while the sail spins right round the mast, and you sail out on the new tack without stepping round the front. Too slow to get through the wind, or too long in the spin, and you're in the water.
- The HUD lists the moves while you're crouched, coaches each one as you do it, and tells you your speed coming out.

**Fin and daggerboard**

- Finite-wing lift and induced drag, with stall.
- The fin ventilates (spin-out) when overloaded. It's worse with high trim, the board rolled to windward, chop, or weight on the back foot.
- At low speed a fin-only board makes big leeway; the beginner board's daggerboard lets it point.
- Slogging, you steer with your feet as well as the rig: pushing the rig toward the nose turns the board round through the mast foot, even in irons with the sail flapping (the HUD tells you when you're in irons, and how to get out). It fades as the board gets going and the fin and daggerboard take over. Without hiking (LT) you still lean back against the pull by instinct, part of the way (up to about 12°); LT hangs you out as far as it takes. Unhooked and pulled in toward the sail, you let go with the back hand: the sail opens and stops pulling, and you take hold again and sheet back in over a second or so. Only if that isn't enough (a big gust, or the rig falling to leeward, which pulls you over by its own weight) do you go further: on a board that floats you easily you let go of the rig and uphaul it again; on a small board you fall in and waterstart.

**Steering with the feet**

- When planing, sinking a rail tilts the hydrodynamic lift into a carving force.
- In displacement mode a heeled hull turns the other way, as on a real board.

**The sailor**

- Set your weight, height, boom height and harness line length in the Gear menu. The body is built from standard anthropometric proportions (segment lengths and masses), and the physics balances exactly the body you see: the lean in the HUD is the lean that's drawn.
- The sailor is drawn as one continuous body over a skeleton that's set every frame from the joints the physics poses: a wetsuit with teal panels, a waist harness with its spreader bar and hook (where the lines are drawn to), neoprene booties, and a white helmet, sunglasses and chin strap. It bends at the hips, knees, shoulders and elbows like a body (the skin blends between the bones at each joint) and its proportions scale with your height; the head turns to look ahead past the mast.
- The default sailor is 183 cm and 75 kg, with the boom between chest and shoulder height (0.74 × your height, 135 cm) and 32" harness lines (0.45 × your height).
- The sail's heeling moment about the board's centreline is fought by your weight times how far your centre of mass is out from that centreline, worked out from the posed body (feet in the straps, hook in the lines, hands on the boom), plus core and leg strength (which scale with body mass) and foot pressure on the rails.
- How far out you can hang is geometry. Unhooked, it's your arms' reach to the boom; hooked in, it's the harness lines. Leaning the rig to windward brings the boom out over the water so you can hang further out, but past about 15° the sail loses more drive than you gain. Longer lines let you hang further out. A higher boom lets you lean further on straight arms but needs longer lines. Your hands slide back along the boom as you move back toward the straps; with the sail eased right out they stay forward, where the boom is still in reach.
- To hook in, the lines have to reach the hook: sheet in and come in toward the boom. Hooked in with your feet still forward, the lines are behind you and you can't hang out far; in the straps they're over your feet.
- Fore and aft, too. The rig is pinned at the mast foot and its drive (high up) and lift (behind the mast) tip it forward. You hold it back through your hands or the harness, so the same pull tips you forward over your front foot. You balance it by leaning back, with the hips back over the tail, until your weight behind your feet matches the pull at the hook or hands. Your feet can press anywhere from the back heel to the front toes, a little further with them in the straps. Weight forward or back (right stick) picks where; leaning back with weight forward, more of your weight hangs on the boom into the mast foot. The board feels that pressure: it's where the hull is loaded. The stance diagram (in the detailed HUD, and in the lessons about it) shows it: a bar from heel to toes, a line where your feet press, a ring for your centre of mass, and how far back you're leaning, amber as the pull nears what your toes can hold and red past it.
- Technique takes some of the pull before it reaches you: the rig's own weight, a push-pull between your hands, and hanging your weight down on the boom behind the mast (into the mast foot, which presses the nose down, so only as much as you need).
- A step is a step. Moving your feet back into the straps doesn't move your body: you come upright over the new stance and have to lean back again. Walk back first and the front foot only has a short step into its strap; step a long way back while leaning hard against the pull and it drags you forward over your toes.
- **Catapults.** Hooked in, the lines can't give. A gust's extra pull arrives faster than you can lean back, tips you over your front foot, and the harness launches you over the boom. Weight back and easing the sheet as the gust hits lets you ride it out. Unhooked, your arms give first: the rig rakes forward, and if it keeps dragging you forward you let go with the back hand. Lean back with too little pull to hold you (a lull) and you sit down off the back of the board.
- Too little hike for the power and you're pulled over sideways (a catapult if you're hooked in and fast). Hang out with more weight than the sail is pulling and the rig comes over on top of you: you fall in to windward.
- You can pull yourself back upright on the boom, since the rig is pinned at the mast foot.
- **Hands and harness lines.** The sail's pull sits at its draft, part way along the boom. Hooked in with the lines over that point, the harness takes it all and the hands only steady the rig. Lines forward of it leave the back hand pulling a couple (the front pushing); lines behind it load the front hand, and the sail sheets in on you. The hands can't hold the boom quite still against that, and the extra load drains your forearms. Gusts blow the draft back, so a rig balanced in a lull goes back-hand heavy in a gust. The Hands bar (detailed HUD) shows front and back.
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

`npm test` runs the board through steady-state checks with an autopilot sailor (auto-hike on, no gusts) plus scripted maneuvers, and fails if bearing away from a beam reach to 130° costs more than 10% of the speed, or if a gust doesn't catapult a sailor with weight forward and the sail locked in (or does catapult one who sinks back and eases the sheet), or if the controller doesn't warn before the catapult, or if a rig-tuning setting doesn't have the effect below, or if chop doesn't cost speed, make the board skip at speed (not on flat water) and punish weight forward in rough water, or if a pop timed onto a chop face doesn't fly about half a metre (and beat a pop made blind), a pop on flat water is more than a little hop, or weight forward in the air doesn't land you nose first and over the front, or a freestyle move doesn't come off from its entry conditions (or doesn't go wrong the way it should: a duck gybe ducked too early backwinds, a spock hooked in catapults, weight back in a spock drops you in), or a batten pops in steady sailing or is left on the wrong side after a turn, or the head of the sail twists past luffing. Typical results (75 kg, 183 cm sailor):

| Setup | Result | Real-world reference |
| --- | --- | --- |
| 135 L, 7.0 m², 6–10 kn, beam reach | 3.5–5.5 kn, displacement | Slogging speeds |
| 135 L, 7.0 m², 11 / 12 kn | 6.8 kn slogging / just planes (10.4 kn) | Planing threshold ~12 kn for this combination |
| 135 L, 7.0 m², 14 / 16 / 20 kn | 17.4 / 18.6 / 19.5 kn board speed | Typical freeride GPS speeds |
| 135 L, 7.0 m², 24 kn | 20.0 kn, sailor at the limit | 7.0 m² is too big here |
| 135 L, 16 kn, close-hauled planing | holds 55° to the true wind at 9.9 kn | 50–55° typical for freeride |
| 135 L, 16 kn, 90° / 130° | 18.0 / 17.0 kn | A broad reach holds its speed once planing |
| 135 L, 22 kn, 100° / 130° / 145° | 19.9 / 20.5 / 17.0 kn | Fastest on a broad reach; deep angles need more wind |
| 135 L, 16 kn, 140° and deeper | drops off the plane | The apparent wind gets too light to carry the board |
| 115 L, 6.3 m², 18 kn / 95 L, 5.3 m², 22 kn | 21.4 / 23.6 kn | Smaller, faster boards |
| 135 L, 16 kn, flat water / standard chop (0.34 m) | 21.3 / 18.6 kn, skipping off the chop 9% of the time | Flat water is fast; chop costs speed |
| 135 L, 22 kn, rough chop (0.74 m), weight forward / back | 10.0 kn and three falls / 18.3 kn | Keep the nose up in rough water |
| 183 cm, 32" lines, hooked in, rig leaned ~16°, fully powered | hangs out ~25–30°, leans back ~30°, centre of mass ~35 cm behind where the feet press | A typical hooked-in freeride stance |
| 115 L, 6.3 m², 16 kn, planing hooked in, gust to 24 kn | weight forward, sail locked in: catapulted. Weight back, sheet eased: rides it out | Why you sheet out and sink back in a gust |
| 210 L beginner, 5.3 m², 8 kn | 4.1 kn, can sail 55° upwind | Daggerboard boards point in light wind |
| 95 L board, 85 kg sailor | refuses to float you standing still | A sinker |

Rig tuning, same board and sail (`node tools/physics-check.mjs tune`):

| Change | Effect |
| --- | --- |
| Outhaul loose / tight, 12 kn | 15.4 kn planing / 7.1 kn, not planing |
| Outhaul loose, 16 kn | back hand about twice as loaded (the draft further back) |
| Downhaul maximum / light, gusty 22 kn | 20.3 / 18.3 kn |
| Downhaul light / maximum, 12 kn | 9.1 / 7.5 kn |
| Mast foot 10 cm back / forward, 22 kn, flat water | 23.6 / 21.7 kn (forward rides nose-down; in rough chop forward is the faster, steadier ride) |
| Harness lines 10 cm forward / back, 16 kn | back hand loaded / front hand loaded, and the sail sheets in on you |

`npm run drag` prints the hull resistance curve, which shows the hump and the effect of stance.

## Developing

```bash
npm install        # three.js and esbuild
npm run dev        # http://localhost:8000 serves index.html with live ES modules
npm run build      # writes dist/beam-reach.html (single file, ~800 KB)
npm test           # physics speed polar, maneuver checks, GPS & speed strip, freestyle & battens, every lesson and story chapter sailed by the coach, hands-on-boom pose check
npm run quiver     # recalibrate the gear advisor's wind ranges (src/physics/quiver.js) from the physics
```

```
src/physics/   wind & chop, sail aero, planing hull & foils, the sailor's body geometry, balance + state machine (no rendering deps)
src/coach/     the coach (an expert sailor driving the controls) and the lesson scripts
src/game/      the GPS speed logger, the session log (personal bests, gear verdict) and the story (chapters, goals, progress)
src/render/    three.js: water shader, sky & spot, board/rig/sailor models, spray & wake, cameras
src/ui/        gamepad & keyboard input, HUD, menu, procedural audio
tools/         build script, physics, maneuver, GPS, freestyle, lesson, story and pose checks, the story autopilot, gear-advisor calibration
```

The physics runs at a fixed 240 Hz (about 5 µs per step) independent of the frame rate; rendering interpolates between the last two physics states so motion stays smooth at any refresh rate. The water has no textures: waves and ripples are evaluated per pixel and filtered by their size on screen (the procedural equivalent of mipmapping), so distant water doesn't shimmer.

## Not in this version

- Wave sailing (big jumps and rides on real swell) and foiling.
- Aerial freestyle (forwards, vulcans, flakas): the moves here all stay on the water.
- Real swell and breaking waves.
- Race courses (a slalom course against a ghost of your best lap would build on the GPS).
- Remappable controls.
- Facial animation, fingers, and cloth on the sailor: the body is posed with inverse kinematics from the same joints the physics balances (leaning back, it's drawn as far back as its arms or harness lines reach toward the lean the physics balances).

