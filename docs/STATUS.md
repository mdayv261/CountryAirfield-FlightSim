# Project Status

**Current stage:** 4 – Air-Bike 103 (complete; automated exit checks pass 2026-10-19; your hand-flown circuits still to confirm)
**Next stage:** 5 – Super Decathlon

## What works
- Vite 8 + TypeScript 7 (strict) + Three.js r186 + Vitest 4. Scripts: `npm run dev`, `npm test`, `npm run build`, `npm run preview`, `npm run typecheck`.
- Folder layout per CLAUDE.md (`src/cockpit` and `src/audio` are still empty placeholders).
- `src/core/GameLoop.ts`: fixed 120 Hz physics step with an accumulator, decoupled from the display rate. It also provides an interpolation `alpha` for rendering, a 0.25 s catch-up cap and pause (P key).
- `src/core/units.ts`: display-only unit conversions. `src/core/constants.ts`: sim-wide constants.
- `src/aircraft/schema.ts`: typed `AircraftData` plus `validateAircraftData()`. The validator rejects missing fields, bad enum values and out-of-range numbers, which catches knots typed in place of m/s.
- Starter JSON files: `airbike103.json`, `decathlon8kcab.json`, `bensenB8M.json`. They hold the CLAUDE.md figures converted to SI units. Aerodynamic, propeller, gear and rotor data come in Stages 4–6.
- **Stage 2 world** (`src/world`, all dimensions in `layout.ts`, all procedural, seeded so it is identical every load):
  - Terrain: 6 x 6 km heightmap (15 m grid, 160k triangles, flat-shaded), paddock patchwork colours. Flat (y = 0 exactly)
    over x -220..180, z -650..650; hills rise over 500 m to a 59.2 m maximum (cap 60). Steepest slope 0.149 (8.5°).
    Heights fade to 0 over the last 1 km to meet a flat skirt that runs to the horizon.
  - `Heightfield.heightAt(x, z)` returns the exact rendered surface (same triangle split). Stage 3 gear contact should use it.
  - Farm dam ("turkey's nest") 900 m NE at (520, -720): 50 m radius, 3 m deep basin, 1.8 m earth bank, water at -0.6 m.
  - Runways: gravel 600 x 18 m on x = 0; grass 600 x 30 m with mowing stripes, centreline x = 30 (edges 6 m apart).
    White edge cones every 50 m on both edges of both runways (52). White gable threshold markers at all four ends (4 gravel, 6 grass).
  - Apron 40 x 60 m west of the gravel runway. Two L-shaped taxiways from the apron to each threshold (stub onto the gravel runway).
  - Three gable-roof hangars (doors face the apron), clubroom with veranda (deck, posts, rail, skillion roof), two-storey
    tower with glazed cab and an outside stair. All buildings are merged into one draw call.
  - Windsock on the tower roof: 5 orange/white bands, each fills at 3 kt, fully horizontal at 15 kt, points downwind, small flutter.
  - Trees, instanced in 2 draw calls: 8 windbreak lines plus 70 gum clusters and 220 scattered gums, clear of the airfield/approach zone and the dam.
  - Sky: gradient dome shader with a sun disc and glow (sun azimuth 25°, elevation 52°, northern sky), with matching horizon fog.
  - Altocumulus: rows of lumpy cloudlets (6 lobes each, instanced), 22 km square layer, every lobe between 3,000 and 4,500 m.
  - Sun shadows (2048 map) over an 800 m square around the airfield. Logarithmic depth buffer.
- **Stage 4 Air-Bike 103** (flyable):
  - `aero.ts`: coefficient build-up. CL/CD from ±180° alpha tables (stall break at 19°, flat-plate beyond), stability and
    control derivatives (Cm_alpha, Cm_q, Cn_beta, Cl_beta, Cl_p, Cn_r, control powers, adverse yaw), stall pitch break and
    loss of roll damping, ground effect (McCormick), propeller slipstream over the tail for elevator and rudder authority.
  - `powerplant.ts`: Hirth F-33 brake-power curve (20.6 kW at 6500 rpm), 2.5:1 belt at 95%, shaft dynamics from a
    torque balance, carburettor lag, idle air bleed that fades with rpm (engine braking), stalls below 1000 rpm,
    E starts and stops it. Propeller thrust and torque from CT/CP vs advance ratio; windmills in a fast glide.
    Torque reaction rolls left (clockwise prop). Fuel burn (BSFC 0.45 kg/kWh) updates mass and inertia.
    Single-cylinder vibration (firing at rpm/60, about 100 Hz) is exposed as a level and frequency for cockpit
    camera shake (and later sound), not as a force: it is above the 60 Hz a 120 Hz step can represent.
  - `FixedWingAircraft`: airframe + gear + aero + powerplant + fuel; flight state (IAS, alpha, beta, G, AGL, VS).
  - Data in `airbike103.json` (tables, derivatives, prop, engine); notes record each estimate and the tuning.
  - Procedural model (`src/aircraft/models/airbike103Model.ts`): strut-braced high wing, steel-tube keel and booms,
    open seat with pilot, Hirth with belt drive, wooden prop (blurs to a disc), tail feathers. Elevator, ailerons
    and rudder move with the controls.
  - Views (V cycles them): chase (follows heading, not bank), cockpit (pilot's eye, engine shake, drag to look),
    free camera. HUD on the left: IAS kt, ALT and AGL ft, VSI fpm, heading, rpm, throttle, fuel, G, AoA, slip ball,
    and a STALL warning 3° before the stalling angle.
  - Spawns: 7 = gravel 36, 8 = grass 36, 9 = gravel 18, 0 = grass 18; Backspace resets. Keyboard flight is on by default
    (arrows stick, Z/C rudder, +/− throttle). Neutral stick trims about 40 kt at full power. Default wind: light northerly.
  - Automated flight tests (test pilot autopilot in `tests/helpers`), mass 216 kg, calm ISA:
    stall 24.4 kt (target 24, +1.7%); cruise at 75% power 49.2 kt (47, +4.7%); best climb 498 fpm (475, +4.8%);
    take-off roll 76.0 m on grass and 72.8 m on gravel (76, 0% and −4.2%, three-point technique);
    full-power level speed 54.7 kt (Part 103 limit 55). Full left-hand 500 ft circuits with take-off, 5° approach,
    flare and roll-out pass on gravel 36, grass 36, grass 18 and gravel 18 (touchdown 26 kt, 1.2 m/s sink, no strikes,
    stops on the runway).
  - Browser: 75 fps (vsync) in chase and cockpit views, mean 13.34 ms, p95 13.9 ms, no frame over 20 ms; physics
    120 Hz at about 13 µs per step. No console errors.
- **Stage 3 flight core** (`src/physics`, `src/input`):
  - `RigidBody`: 6-DOF, quaternion attitude, full inertia tensor, body axes x right / y up / z aft (forward −z, origin at CG;
    identity = level facing north). Translation uses semi-implicit Euler. Rotation uses Euler's equations including the
    gyroscopic ω×Iω term, solved by implicit midpoint (5 passes), which conserves energy and momentum when torque-free.
    Keeps the previous state so rendering interpolates between physics steps.
  - `atmosphere.ts`: ISA troposphere (T, p, ρ, a) with an ISA deviation input; matches the ICAO table to 0.02%.
  - `WindModel`: steady wind reported at 10 m with power-law shear (α 0.14, constant above 300 m);
    Poisson-timed 1−cos gusts with a small direction swing; Dryden-style first-order turbulence
    (σ: light 0.7, moderate 1.5, severe 3 m/s; L = 150 m, so the time scale is L/V); head/crosswind components.
    7 presets in `windPresets.ts` (calm, 36 headwind, 18 gusting, quartering, E and W crosswinds, strong crosswind). Seeded and repeatable.
  - `GearSet`: spring-damper struts with a 10× bump stop; normal load along the ground normal. Tyre friction: rolling
    resistance plus brakes in the rolling direction, slip-angle side force (peak at 8°), friction-circle cap.
    Skids slide with Coulomb friction. Pedal steering: nosewheel same way, tailwheel opposite, so right pedal turns right.
    Stability safeguards: friction gain, strut stiffness and damping are capped per contact using its effective mass
    and the time step (no effect on real aircraft struts; prevents chatter or blow-ups on light tumbling objects).
  - Surfaces (`surfaces.ts`): gravel μ 0.6 / rolling 0.04 (runway, taxiways, apron); grass μ 0.4 / rolling 0.07; dam water.
  - `PhysicsWorld` steps wind, gravity and actors at 120 Hz. `Airframe` = aircraft body + gear from its JSON (aero comes in Stages 4–6).
  - Aircraft JSON now has `inertia` and `gear.legs`, which are estimates (see each file's notes): Air-Bike and Decathlon taildraggers
    with steerable tailwheels (±30°) and wingtip skids, Decathlon toe brakes; gyro with foot-steered nosewheel (±34°) and keel tail skid.
  - Test block (`testBlock.ts`): 50 kg box on a tricycle with 8 corner skids, drag, test thrust, steering and brakes.
    T throws it from the camera; throttle, pedals and brakes drive it.
  - Input: channels pitch/roll/yaw/throttle/brakes/prop lever (`controls.ts`). Keyboard flight keys (K toggles):
    arrows stick, Z/C rudder, +/− or PgUp/PgDn throttle, Home/End prop, B brakes; they ramp in and re-centre.
    Mouse stick (J toggles). Gamepad API joysticks and pedals with per-device bindings, calibration (min/centre/max),
    dead zone and invert, saved in localStorage. Joystick beats mouse beats keyboard per channel; unplugging falls back.
  - Controls and calibration screen (O): live axis bars per device, Bind (move the control), Calibrate (sweep then Done),
    invert, dead zone, clear, reset defaults, keyboard and mouse toggles.
  - The windsock now reads the wind model at mast-top height, so gusts and turbulence show on it. N cycles wind presets.
- Free-fly camera: drag to look, WASD move, R/F up and down, Shift x5, mouse wheel sets speed (shown in kt), arrow keys look.
  Keys 1–6 give preset views (overview, runway 36 threshold, apron, tower/windsock, dam, altocumulus).
- M is a measuring tool: it drops a point where the crosshair meets the ground and shows the horizontal distance.
  `[`/`]` changes inspection wind speed (1 kt steps), `,`/`.` changes direction (10° steps). X toggles the axis marker (hidden by default
  because it sits on the runway centreline). H toggles the help.
- FPS overlay: fps, frame time (ms), physics rate (Hz) and a PAUSED flag.
- Measured in Chrome on the Mac mini M4 (2560x1440 display at 75 Hz): 75 fps, mean frame 13.34 ms,
  p95 13.6 ms, max 14.4 ms over 300 frames, so no dropped frames. The browser locks to the display's 75 Hz refresh.
  Physics holds 120 Hz. P pauses (physics 0 Hz, render continues) and resumes cleanly. No console errors.
- Tests: 133 passing (Stage 4 added aero, powerplant and Air-Bike performance/circuit suites; Stage 3 added rigid body, atmosphere, wind, gear and input suites). Highlights: free fall matches ½gt²;
  a torque-free tumble (with the intermediate-axis flip) conserves energy to 1e-6; an undamped strut bounce returns to its
  release height within 1%; all three aircraft settle at rest on their wheels (loads sum to weight, struts compress by load/k,
  taildraggers 8–13° nose-up); braking stops in v²/(2μg) on gravel and grass; rolling coast distance follows the rolling
  resistance; nosewheel and tailwheel steering both turn right with right pedal; a draggy body drifts at wind speed;
  gusts stay within their amplitude; turbulence RMS within 10%; a thrown block bounces and settles on its gear, and one
  dropped upside down comes fully to rest. A separate stress run of 40 random violent throws all settled (none blew up).
- Stage 3 exit check in Chrome (Mac mini M4, 75 Hz): a block thrown with T bounces, lands on its gear, rolls and stops
  (wheel loads sum to its weight). Frame time unchanged: mean 13.34 ms, p95 15.3 ms, no frame over 20 ms, physics 120 Hz.
  No console errors. Logitech Extreme 3D Pro detected and given default roll/pitch bindings.
- Earlier stages: Stage 1 suites plus terrain (flat zone, 60 m cap, slope, edge fade, dam, heightfield interpolation),
  airfield (runway sizes and spacing, cones, threshold markers, taxiway connectivity, no overlaps, buildings off pavements,
  tower and windsock), windsock (downwind, calm, full at 15 kt, 3 kt per band, monotonic), trees, clouds (3,000–4,500 m, rows), sun, ray measuring.
- Stage 2 exit check in Chrome on the Mac mini M4 (2560x1440 at 75 Hz), 600 frames per view over 4 views:
  mean 13.34 ms (75 fps, the vsync limit), p95 15.0 ms, max 15.5 ms, no frame over 20 ms. 36 draw calls, about 860k triangles.
  The measuring tool reads the gravel runway as 600.0 m (-300.0 to 300.0); both runway meshes are 600 m long. No console errors or warnings.

## Decisions recorded
- Gyro engine: McCulloch 4318, 65 hp (not Subaru). Stages 7 and 9 will use CHT and a 2-stroke sound for the gyro.
- Air-Bike landing roll (decided 2026-10-19): keep the physics as modelled and accept the gap to the 61 m target.
  With no brakes, only drag, rolling resistance and the windmilling prop slow it (about 0.9 m/s² on average), giving
  about 112 m on grass and 165 m on gravel from a 26 kt touchdown. Grass rolling resistance stays at 0.07.
- Body axes are three.js-style (x right, y up, z aft) rather than the aero convention (x forward, y right, z down),
  so models and physics share one frame. Aero code in Stages 4–6 must use alpha = atan2(−v_y, −v_z) and beta from v_x.
- Reported wind is the 10 m wind; aloft it is up to 1.6× stronger (shear). The windsock at about 10 m reads the reported value.
- Grass runway "30 m east" means the centrelines are 30 m apart (confirmed by user 2026-10-19), leaving 6 m of grass between the edges.
- Pilot 90 kg; Air-Bike belt 2.5:1 with 60 in prop; field elevation 50 ft (15.24 m); default runway 36; knots on all aircraft.
- Gyro rotor rpm: 200 minimum for take-off, 400 maximum.
- Speeds are knots everywhere; mph is never used. Manufacturer mph figures are converted (x 0.869) and rounded down to a whole knot:
  Air-Bike stall 24, cruise 47, Vne 69 kt; Decathlon stall 49, Vx 50, Vy 71, Va 93, Vno 139, Vne 173 kt;
  Gyro (Bensen B-8M per vortechonline.com: cruise 65 mph, max 95 mph) cruise 56, max 82 kt.
- Where sources disagree, the manufacturer's official figures win (rule in CLAUDE.md). Audit on 2026-10-19 changed:
  Air-Bike wing area 11.15 m2 (120 sq ft); Hirth power 20.6 kW (28 HP DIN); Decathlon cruise 122 kt at 75% power added,
  fuel 151 L is usable (163 L total); gyro empty 113.4 kg (250 lb), max 249.5 kg (550 lb).

## Known issues / open questions
- Air-Bike landing roll is longer than the 61 m target (about 112 m on grass, 165 m on gravel). Accepted: see Decisions.
- Hands-off the Air-Bike shows a lightly damped phugoid and a slow left turn from propeller torque. This is realistic;
  a pilot holds attitude and a touch of right stick.
- Taildragger ground handling is directionally unstable (as it should be): steer with rudder from the start of the roll.
- McCulloch 4318 rated rpm (4100) and direct drive are assumptions; confirm in Stage 6.
- Gyro figures with no Bensen/Vortech source: rotor 6.15 m (user-supplied; Wikipedia says 20 ft / 6.10 m), fuel 20 L,
  take-off roll 30 m (Amax Eagle figure; Wikipedia/Jane's gives 300 ft / 91 m for the B-8M). Kept as in CLAUDE.md.
- The Stage 6 prompt's exit check says "cruise 70 mph" (Amax Eagle figure). Use CLAUDE.md's 56 kt (Bensen 65 mph) instead.
- Shadows only cover an 800 m square around the airfield (fixed). Later stages may need the shadow box to follow the aircraft.
- About 860k triangles a frame (terrain 160k, plus clouds and trees, plus the shadow pass). Fine on the M4; on a weaker laptop,
  the first things to cut are the terrain cell size (15 m → 20 m) and the cloud lobe count.
- Gusts and turbulence are uniform across the field (functions of time only), which is fine for one aircraft.
- Joystick defaults: standard gamepads and the Logitech Extreme 3D Pro (built-in profile: X/Y stick, twist axis 5 =
  rudder with a 0.1 dead zone, slider axis 6 = throttle, inverted so forward is full) work out of the box. Older saved
  bindings are topped up once with the profile's missing channels, never overwriting user changes. Other
  non-standard joysticks get roll and pitch only; bind the rest on the calibration screen (O).
- The test block coasts a long way on gravel (rolling 0.04): about 80 m from 8 m/s. That is correct for free-rolling wheels.
- Inertia and gear figures are estimates; Stages 4–6 should refine them against the targets.
- Clouds are not fogged and stop at the layer edge (11 km out), so at high altitude the edge of the layer can be seen.

## Next step
Confirm by hand: take off, fly a circuit and land on both runways (keys 7/8 to spawn). Then Stage 5: Super Decathlon
(reuse `FixedWingAircraft`; add the constant-speed prop, P-factor, gyroscopic precession, spins and G limits).
