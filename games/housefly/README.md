# Housefly

A hoverbike the size of a toy, loose in a house built 25 times life size. You get flying-car physics in the spirit of GTA San Andreas's flying cars cheat: speed carries through, dives pay you back in momentum, and a climb spends it until the bike stalls and tips over nose first.

Open `index.html` in a browser. It is a single file and loads three.js from a CDN, so you need to be online.

## Controls

| Keyboard | Gamepad | Action |
| --- | --- | --- |
| W / S | RT / LT | Throttle, brake (air brake in flight) |
| A / D | Left stick X | Steer (banks into the turn in the air) |
| ↓ / ↑ | Left stick Y | Pull the nose up, push it down (`I` inverts) |
| Q / E, ← / → | LB / RB | Roll |
| Shift | B | Boost |
| Space | A | Hop off a surface. In the air, flip the way you're steering: back flip by default, front flip with ↑, side flip with A/D or Q/E. Upside down on the floor, it flips you back over. |
| R, C | Back, Y | Reset, cycle camera |
| T, M, Esc | | Bank assist on/off, mute, pause |
| Mouse drag, wheel | Right stick | Look around, zoom |

On a phone you get a stick plus Thrust, Boost and Hop buttons.

## How the flying works

All of the physics lives between the `@@PHYSICS_START` / `@@PHYSICS_END` markers in `index.html`. It has no rendering dependencies, so you can pull it into Node and run flight tests headlessly. The numbers are in the `TUNE` object.

- **Rigid body.** The bike has mass and a box inertia tensor, and it integrates at 240 Hz. Every force acts at a real point on the body, so hover pads, crashes and scrapes all produce torque.
- **Hover pads.** Each corner casts a ray along the bike's own down axis and pushes back with a preloaded spring and damper. Rebound damping is stiffer than compression damping. Pads work against any surface, including walls and ceilings. On screen, each pad also sits on its own springs, for travel, sway and tilt. The pads feel the frame's G-load and get flung outward when the bike spins. They steer like front wheels, tilt back under throttle and forward under brake, and lean into rolls. They also squash on hard landings, tuck in during flips, and spin their rotors faster the harder they work.
- **Lift and stall.** Lift is ∝ v² × CL(α) and capped at about 3.3 g. Past roughly 16° angle of attack it collapses. At high speed you can only turn so tightly, which is why pulling out of a fast dive feels heavy.
- **Energy.** Thrust plus boost is always just below gravity. A vertical climb therefore always bleeds speed eventually, but slowly: from 40 m/s it lasts about 7 seconds.
- **Weathervane and trim.** Aerodynamic stability swings the nose toward the flight path, and gets stiffer with speed. It rests a few degrees above the path, so if you let go the bike settles into a gentle climb-and-sink rhythm (a phugoid) instead of simply diving. At low speed the nose-heavy balance takes over, which gives you a hammerhead when you stall at the top of a vertical climb.
- **Freestyle.** Air flips spin you through a clean 360 while loosening the grip of the air, so your momentum carries straight through. Barrel rolls, loops and flips are counted and called out, and chaining them builds a combo.
- **Assist.** Steering in the air banks you toward a target angle. Letting go levels you off, but only after a short pause, so it never fights a loop or a roll in progress. Full stick also flies the tightest turn the air will hold instead of stalling. Press `T` to turn the assist off and fly fully manual, with stalls included.

## The house

There's a double-height living room with a gallery on two sides, plus a kitchen and dining room under a study loft, a hallway with floating stairs, a bedroom, and a playroom on each floor. Twenty gold rings are hidden around the house. Some are easy, and some sit under the coffee table, under the dining table, or up the stairwell.
