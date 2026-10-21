# Physics audit: what emerges, what's scripted

The bar is the one set by MX Bikes, Jibbers and ProjectX: the rider is a physical body, moves are things you *do* with it (not buttons that start an animation), and a crash happens because the physics went wrong, not because a rule fired. This is where Beam Reach stands against that bar today (v32), system by system, and in what order to close the gaps.

**Emergent**: comes out of forces and the integration; nothing decides the outcome.
**Partly**: real forces, but with a scripted piece in the loop (a servo, a threshold, a timer).
**Scripted**: a state or a formula decides what happens.

## The water, the wind and the board

| System | Status | How it works now |
| --- | --- | --- |
| Wind, gusts, shifts, chop | Emergent | Noise fields, sampled where each part of the sail and board is. |
| Sail aerodynamics | Emergent | A strip model in the apparent wind: lift, drag, stall, twist, luffing, battens popping through. |
| Planing hull | Emergent | Savitsky planing (trim, wetted length, friction) plus displacement drag; load and its centre from the forces on it. |
| Fin and daggerboard | Emergent | Foils with stall; ventilation (spin-out) from load and air near the surface. |
| Rail carving | Partly | The heeled planing surface pushes the board round (a force), but heel itself is commanded from the right stick, not balanced by the body. |
| Foot steering on the plane | Partly | A yaw moment proportional to heel/toe pressure, fading as the board heels. A model of the effect, not of the feet. |
| Pitch and heave over chop | Partly | Trim chases a target from the hull solution, with springs; airtime and landings are real flight. |
| Jumps | Partly | Flight and landings are physics; the pop is an impulse sized by a formula (crouch depth, timing on the face). |
| In the air, yaw | Scripted | The feet keep the board pointing where it's going (a corrective torque). |

## The sailor

| System | Status | How it works now |
| --- | --- | --- |
| Hanging against the sail (sideways lean) | Partly | A 1-DOF body pivoting on the feet: gravity, the sail's pull and the lines are real moments, but the "muscle" is a PD controller toward a target lean (LT, or automatic) with a strength cap. |
| Leaning back and forward | Partly | The same, fore and aft: centre of pressure between heels and toes, with a limit. |
| Reach: arms and harness lines | Emergent | Geometry: the body can only hang as far as the boom and lines reach; past that the lines hold you and pull the rig over. |
| Feet on the board | Scripted | Stepping along the board is a position the stick moves; stepping into a strap teleports the foot. |
| Hooking in and out | Scripted | A button toggles it if the lines are in reach. |
| Hands on the boom | Partly | Where the hands go is geometry; letting go of the back hand is a threshold on the pull. |
| The drawn body | Partly | A procedural pose from the physics, with springs (give, sway) on top. It shows the physics; it doesn't feed back into it. |

## The rig

| System | Status | How it works now |
| --- | --- | --- |
| Rake, lean and sheeting | Partly (v33) | Rake and lean are a body: the rig has inertia about the mast foot, its weight tips it over, and your hands steer it toward the stick with limited strength (stamina and body weight); gusts yank it before your hands catch it. Sheeting is still a servo on the boom angle. Secure position, uphaul and waterstart still place the rig. |
| Pumping | Scripted | An oscillation of the rig at a fixed rate while the button is held. |
| Uphauling | Scripted | A progress bar while the button is held, slower for big sails and in strong wind. |
| Waterstart | Partly | The lift test is real: the sail's pull against your weight, the board across the wind. But clearing the rig and rising are timed phases. |

## Moves

| Move | Status | How it works now |
| --- | --- | --- |
| Carve gybe | Partly | The carve is the physics (rail, rake, lean), and so is the flip now (below). |
| Sail flip (Y) | Partly (v33) | Y lets go with the back hand. The sail then turns freely about the mast: it weathervanes in the apparent wind, you throw it across with the stick, and sheeting in reaches for the boom on the new side; you've caught it once it's close enough to hold. Your side swaps when the boom passes the bow. Still a state you enter with a button. |
| Tack (B) | Partly (v33) | B steps you up to the mast. The board turns only while you drive it: rig back pushes the nose through the wind, rig forward on the new side bears you away. The step round the mast is still timed footwork. |
| Duck gybe (LB + Y) | Scripted | A trick state: scripted boom throw, a timing window for when you duck, a fixed share of the sail's pull. |
| Carving 360 (LB + X) | Scripted | A trick state: a fixed turning radius set by the rail, speed lost by formula, the sail flagged and caught by script. |
| Spock (LB + A) | Scripted | A trick state: a scripted spin on the nose; weight back ends it. |
| Helitack (LB + B) | Scripted | A trick state: a scripted luff, then a spin at a set yaw rate. |

## Falls

| Fall | Status | How it works now |
| --- | --- | --- |
| Catapult | Partly | Real: the body tips over the front foot when the pull beats your weight lever. Then a rule turns that into a fall. |
| Pulled over to leeward | Partly | Real lean dynamics, ended by a threshold (lean past −24°). |
| Fell in to windward | Partly | Thresholds: lean past 86°, hanging too long, or the rig leaned past 58°. |
| Backwinded | Partly | The angle of attack goes negative: real. The fall is a rule. |
| In irons in a tack, a move going wrong | Scripted | Timers and windows inside the states. |
| Sinking, running aground | Emergent / rule | Real volume and fin depth; the fall is a rule. |
| The fall itself | Scripted | A 0.9 s state that drops the rig, then you're swimming. No ragdoll. |

## What that adds up to

The *forces* are mostly real: wind, sail, hull, fin, and the sailor's balance against the sail. That's the hard part, and it's tested: 182 checks against real-world speeds, angles and techniques.

What's scripted is the **rig**, which is a servo and not a body you hold, and every **discrete action**: flip, tack, tricks, hooking in, stepping into straps, uphauling. In MX Bikes and Jibbers those are exactly the things the player does with the body, and why they feel alive.

## The order to make it emergent

1. **The rig as a physical body.** Give it mass and inertia, held at the mast foot by a joint and by your hands with limited force. The sticks set where your hands *try* to put the boom; the sail's pull, gusts and the rig's weight fight back. Most of the others build on this one.
2. **The sail flip and the tack as things you do.** Let go with the back hand and throw the rig across with the stick; walk round the mast with the feet. No Y or B state.
3. **Feet as contacts.** Each foot presses the board somewhere. Heel and toe pressure becomes the rail and the foot steering; stepping and straps become moving a foot. The "foot steering" model goes away.
4. **The body's balance from the body.** Replace the PD "muscle" and the fall thresholds with a few-segment body (legs, torso, arms) driven toward the player's intent with limited joint strength. Losing balance *is* the fall, ideally into a ragdoll.
5. **Tricks from 1–4.** A carving 360 is a hard carve with the sail let go; a duck gybe is a flip thrown the other way; a spock is weight forward and the rig pushed round. Each loses its state.
6. **Pumping, uphauling and waterstarting** from the same pieces, with the hands moving the rig.

Steps 1 and 2 decide the architecture: everything else follows from a physical rig and hands. They're also where the feel changes most.

## Ready to port?

The physics core is plain, engine-free code: about 2,400 lines (sim, sail, hull, body, environment). With its 182 checks it amounts to a working spec, and it ports cleanly to any engine.

My recommendation is to do steps 1 and 2 here first, then port:

- **Iteration here is fast.** I can run every check headlessly in minutes and render the result. In Unity or Unreal I could write the code but not run the editor, playtest or render in this environment: you'd run every build. Godot does run headless on Linux, so I could run its checks myself, but not playtest it either.
- **Porting the current state machine and then replacing it is double work.** Steps 1 and 2 change the core model: the rig, the hands, the actions. The other steps fit in either place.
- **What carries over unchanged:** the wind, the sail strips, the hull, the fin, the balance tests, the tuning values, the lessons' intent, and the camera and juice ideas.

So: prototype the physical rig and thrown flip here (a few rounds), check they feel right on your controller, then port with that architecture, and do steps 3–6 in the new engine.
