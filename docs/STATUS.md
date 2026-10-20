# Project Status

**Current stage:** 9 – Sound and menus (complete; exit checks pass 2026-10-20). Stage 8 flight notes deferred by the user (2026-10-20): to be added to docs/FLIGHT_NOTES.md later and resolved then.
**Next stage:** 10 (awaiting the brief)

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
- **Stage 9 sound and menus** (2026-10-20):
  - Sound (`src/audio`): Web Audio synthesis driven by the physics (`soundModel.ts`, pure and tested; `SoundSystem.ts`).
    Engine note at the firing frequency (rpm/60 x cylinders x 2/strokes) with each engine's harmonic mix from its data
    file, a low-pass that opens with throttle, exhaust noise pulsed at the firing rate, and a crankshaft-rate throb for
    multi-cylinder engines. Hirth F-33 single 2-stroke (bright, crackling, toothed-belt whine), McCulloch 4318 flat-4
    2-stroke (high snarl, direct drive: the brief's Subaru belt whine does not apply), Lycoming flat-4 4-stroke (deep,
    throaty, strong half-order throb). Measured in Chrome at full power: fundamentals 88 / 267 / 91 Hz, spectral
    centroids 1,286 / 1,125 / 658 Hz (Hirth / McCulloch / Lycoming). Propeller blade-passing buzz; wind roar by airspeed
    (∝ V², pitch rising with speed; an enclosed cabin keeps 70 % out and muffles engine highs); gyro rotor swish beating
    at 2 x rotor rpm / 60; Decathlon stall horn (same warning logic as the HUD). Outside views: distance fade and
    Doppler. Sound starts on the first key press or click (browser rule) and pauses with the sim.
  - Menu (Esc, `src/ui/Menu.ts`): aircraft; start position (apron, engine running, facing the runway, or any of the
    four thresholds); wind (preset, direction, speed, gusts, turbulence); time of day (07:00–17:00, daylight only:
    the sun moves across the northern sky at 37.5° S, equinox, with light and shadows following, `src/world/sun.ts`);
    controls (keyboard flight, mouse stick, auto-rudder, joystick mapping); units for the HUD (altitude ft/m, vertical
    speed fpm or m/s, temperature °C/°F, fuel L/US gal, MAP inHg/hPa; airspeed always knots, gauges keep their own
    markings); sound volume and mute. The flight pauses while the menu is open; keys go to the menu.
  - Settings (`src/core/settings.ts`) saved in localStorage ("cfs.settings.v1"), sanitised on load (an old or damaged
    save falls back to defaults). Keys that change settings (Tab, 7–0, K, J, U, wind keys) save too. Verified in Chrome:
    gyro, apron, wind 270/12 G7 moderate, 16:00, metres, volume 50 %, auto-rudder all survived a reload.
  - Browser: 75 fps (13.3 ms mean, p95 15.0 ms) with sound running; no console errors.
- **Stage 8 flight testing and tuning** (2026-10-20):
  - Automated test pilot (`tests/flightTest/programme.ts`, `npm run flight-test`): flies each aircraft through stall,
    cruise, climb (with Vy/Vx for the Decathlon), maximum level speed (gyro), take-off roll and landing roll, and writes
    the results table to `docs/FLIGHT_TEST_REPORT.md`. All 17 points within ±10 % of CLAUDE.md, except the Air-Bike
    landing roll, kept as an accepted deviation (user decision, see Decisions). No data-file tuning was needed.
  - Handling (`tests/handling.test.ts`): a 3 m/s vertical "1 − cos" gust gives Δn of 0.82–0.87 of the Pratt–Walker
    (FAR 23.341) value for the fixed wings and 1.03 of a blade-element rotor estimate for the gyro (it rides gusts
    best per unit weight); a 3 m/s side gust, controls fixed, rocks them 1.4–2.9° and they settle; in moderate
    turbulence the test pilot holds RMS bank ≤ 1.2° and height within 2 m. Crosswind take-offs and landings from both
    sides at Air-Bike 6, Decathlon 12, gyro 10 kt (at least the FAR 23.233 minimum of 0.2 Vso): lift-off within 1.8 m
    of the centreline using ≤ 22 % control; touchdown on the runway with < 0.2 m/s drift, roll-out on the runway.
  - Physics fix found by the crosswind tests: the gyro's fin took its flow angle from the aircraft's own motion but its
    dynamic pressure including the prop slipstream, so at walking pace in a crosswind it saw a 90° flow at slipstream
    pressure and slewed the gyro round (51° in a second). The slipstream is now added as air velocity along the prop
    axis (`liftingSurfaces.ts`); identical in normal flight. The fixed wings were not affected (their slipstream only
    boosts the rudder and elevator).
  - Test-pilot technique added: ground-track (crab) following on circuit legs, wing-low on short final and in the
    flare, steering back to the centreline on the ground, gyro stick into wind, prerotation on the brakes with pedals.
  - Wind keys (2026-10-20): N preset · [ ] speed ±1 kt · , . direction ±10° · ; ' gusts ±1 kt (0–20) · / turbulence
    none → light → moderate → severe; all on the on-screen help (H). The status panel shows gusts and turbulence.
  - `docs/FLIGHT_NOTES.md`: template for the user's test-flight notes; each will be resolved there.
- **Stage 7 cockpits, HUD and views** (2026-10-20):
  - `src/cockpit/instruments.ts`: one set of indicated values (IAS, altitude, AGL, VSI with 1 s lag, true heading,
    wet compass with 0.3 s damping, pitch/bank, slip ball from lateral specific force, G with tell-tales, wind at the
    aircraft, rpm, rotor rpm, MAP, fuel, CHT/EGT). The panel gauges and the HUD both read it, so they always agree.
  - `src/cockpit/gauges.ts`: Canvas-2D gauges: ASI with green/yellow arcs and red line, 3-pointer altimeter, VSI,
    tacho, rotor tacho, inclinometer, wet compass (reverse-reading card, as the real one), fuel, EGT, CHT, attitude
    indicator, DG, MAP, G-meter with max/min tell-tale needles.
  - `src/cockpit/Panel.ts`: panel drawn to a canvas texture on a 3D panel in the model (unlit face, redrawn every frame
    in the cockpit view, 4 Hz otherwise). Layout and scales per aircraft in each JSON's `panel` block (knots, °C, rpm):
    Layout (user, 2026-10-20): flight instruments across the top, the slip ball under the ASI, the heading gauge to its
    left and engine gauges to its right. Air-Bike and gyro: ALT, ASI (centre), VSI on top, compass. Decathlon: G-meter,
    ALT, AI (centre), ASI, VSI on top; DG in place of the wet compass; RPM, MAP, fuel and CHT in a 2x2 block; panel 0.50 m
    wide. (Air-Bike RPM (ASI size) and fuel, with EGT left of the compass and CHT above it, pod 0.31 m wide; gyro: VSI, ALT, ASI, RPM, rotor rpm LCD across the top, fuel, EGT, CHT right of the slip ball, pod 0.38 m wide; Decathlon as above). The gyro's rotor tacho is a digital LCD (digits turn red outside 200–400 rpm). Open-cockpit pods stand on a post.
  - Engine temperatures (`src/physics/engineTemps.ts`): CHT settles where combustion heat (∝ charge flow, manifold
    pressure x rpm) balances fin cooling (∝ cooling-air speed^0.5, airspeed plus part of the slipstream), with a
    1–2 min time constant; EGT follows power in seconds. About 200–210 °C after a full-power climb, 65–80 °C after a
    5 min idle glide; a reset starts warmed up (120–160 °C). Gyro: McCulloch is air-cooled, so CHT/EGT replace the
    brief's coolant gauge (that was for a Subaru).
  - Views (`src/ui/AircraftCamera.ts`): 1 cockpit (mouse drag or joystick hat to look around: sideways, up, back;
    springs back to ahead; per-aircraft look-down so the panel shows), 2 chase, 3 tower (from outside the cab glass,
    auto-zoom), 4 fly-by (camera set ahead of the track, alternating sides, moves on once passed), 5 free camera
    (whose own viewpoints keep keys 1–6). V cycles. Hat: Extreme 3D Pro axis 9, or a gamepad's d-pad.
  - HUD (I toggles): IAS, ALT/AGL, HDG, VSI, G (max/min), WIND, then engine/rotor/MAP/fuel/CHT/EGT/AOA/slip lines.
    Warnings stay on screen with the HUD off.
  - Gyro model: eye moved to the front of the helmet (was inside the torso box); control rods run along the keel and
    up the mast instead of past the pilot's face.
  - Browser: 75 fps (13.3 ms mean, p95 ≤ 15 ms) in every view and aircraft, display-capped; no console errors.
- **Stage 6 Bensen B-8M gyroplane** (flyable; Tab cycles Air-Bike → Decathlon → gyro):
  - `PoweredAircraft` base (airframe, gear, powerplant and prop effects, fuel, pilot controls, G monitor, auto-rudder)
    with `FixedWingAircraft` (wing aero) and `Gyroplane` (rotor + tail surfaces) on top.
  - `rotor.ts`: blade-element thrust C_T = (σa/2)[θ(1/3 + μ²/2) + λ/2] with momentum-theory induced flow (iterated),
    autorotation torque C_Q = (σδ/8)(1 + μ²) − λC_T driving the rotor rpm, blade-stall cap, blowback flapping a1,
    disc lag 16/(γΩ) from the blades' Lock number γ ≈ 3.7 (≈0.11 s at 370 rpm: pitch/roll damping), H-force, rotor ground effect (Cheeseman–Bennett), prerotator (140 N m to 330 rpm,
    reacting on the airframe and loading the engine). Teetering rotor: no hub moment, so control vanishes at zero g.
  - `liftingSurfaces.ts`: fin + rudder (in the slipstream) and a small tailplane as little wings at their positions;
    open-frame body drag. Prop thrust line 0.18 m above the CG (power pushes the nose down).
  - Stick tilts the rotor head (neutral 0.95° back and 1.6° right, 12° forward, 20° back, ±7° roll); pedals = rudder
    + nosewheel; Q (hold) or joystick thumb button = prerotator. Neutral stick trims about 53 kt.
  - Hands-off flight (2026-10-19): the head's 1.6° right rig cancels prop torque at cruise power and the fin is offset
    0.5° to cancel prop yaw. Stick-free roll stability (`stickFreeRollGain`, `stickFreeRollDamping_s`) tilts the head to
    keep the rotor disc level whenever the stick is centred sideways and the gyro is airborne (modern-gyro behaviour;
    the stock B-8M was spirally neutral). Levelling the disc, not the keel, keeps it flying straight; the keel hangs
    about 1° left wing low. Power sets the pitch: hands-off at 45% power it holds 53 kt level, full power climbs
    ~700 fpm nose up, idle descends ~730 fpm nose down.
  - Stick-free levelling revised (2026-10-20, user: banking felt more aggressive in the cockpit view than the chase
    view). Cause: centring the stick in a bank snapped the gyro level at ~50°/s, which the chase camera (it does not
    roll) hid and the cockpit camera showed in full. Now it engages only once the stick is centred (inside the 5 %
    dead zone), builds up over 2 s, caps its head tilt at 2.5° and rolls back at no more than 8°/s: a 30° bank
    eases level in about 4 s. Any stick input switches it off. Hands-off trim unchanged.
  - Roll response (2026-10-20): about 14°/s at quarter stick, 28°/s at half, 56°/s at full, proportional. (Was
    ~165°/s at full stick with a guessed 0.04 s disc lag.) Controls soften as rotor rpm falls.
  - Modernised after CAA Paper 2009/02, "The Aerodynamics of Gyroplanes" (user decision 2026-10-20):
    - CG / propeller thrust line within 2 in, as the paper recommends for modern gyros: the CG sits 0.15 m higher in
      the airframe (all body-axis positions 0.15 m lower), so the thrust line is 0.03 m (1.2 in) above it, not 0.18 m.
      Full power no longer bunts the nose over harder in a pushover (nose-down rate the same at full power and idle).
      Retrimmed: head neutral 0° back and 1.9° right, fin 0.5°: hands-off 52 kt level at 45 % power, dead straight.
    - Rotor teeter (disc tilt relative to the shaft) computed, with a 12° stop and a HUD "ROTOR TEETER" warning above
      9°. About 2–4° in steady flight (paper: ~2.5°); the paper's push-and-recover manoeuvre reaches 8–11° (paper: 8°).
    - Dynamic (Pitt–Peters) inflow: the induced flow follows its momentum value with τ = (8/3π) R / 2V (~0.05 s in
      cruise), so a gust or sharp pull briefly meets the old wake.
    - Regression suite `tests/gyroCaaPaper.test.ts`: trim 30–70 mph (pitch 9° → 1°, head tilt forward with speed,
      1–1.6° left wing low, rotor 375–380 rpm), 1° aft tilt for 5 s (+11° pitch), phugoid ~19 s ζ ≈ 0.2 (paper VPM
      25–32 s), teeter. Known difference: the model is only weakly sensitive to the thrust-line offset (the old 7 in
      layout was also stable here), whereas the paper found it the main destabiliser on some types.
  - Brakes (2026-10-19): toe brakes on all three wheels (B key / trigger). They hold the gyro still while prerotating
    up to ~2,800 engine rpm on gravel and ~2,500–2,900 rpm on grass; beyond that the prop thrust beats tyre grip.
  - Prerotator clutch is progressive: it passes torque in proportion to engine rpm above the stall speed (full torque
    from 2,600 rpm), so it can never stall the engine. At idle the rotor turns slowly and the HUD says
    "add power: ~2600 engine rpm"; at about 65% throttle it reaches 330 rpm in about 20 s. (Fixed 2026-10-19: holding Q
    at idle used to stall the engine within seconds.)
  - Warnings: LOW G (< 0.5 g airborne), PUSHOVER (< 0.3 g with power), LOW ROTOR RPM (< 200), ROTOR OVERSPEED (> 400).
    HUD shows rotor rpm and PREROTATING.
  - Procedural model: keel, mast, open seat and pilot, rudder bar, fuel tank, McCulloch and pusher prop, tricycle
    gear, fin/rudder/tailplane, and a two-blade rotor that tilts with the disc axis and spins at the real rotor speed.
  - Gyro tests (218 kg, ISA, calm): prerotation to 300 rpm in 22 s at 65% throttle; take-off roll 30.9 m, lift-off 26 kt (target 30 m);
    climb 1136 fpm at 45 kt (1100); cruise 55.3 kt at 45% power (56 kt = Bensen 65 mph); max level 79.6 kt (82);
    idle autorotation at 40 kt steady at −835 fpm with rotor 389 rpm (±1.2); sharp pushover to −0.18 g triggers
    LOW G, rotor decays 375 → 351 rpm, with power on the PUSHOVER warning and a harder nose-down pitch; recovers.
  - Gear: static friction (anchored contacts) stops creep under steady side loads (a prerotator's torque, slopes).
  - Input: button-bound channels (brakes, prerotator) still answer to their keys. Extreme 3D Pro defaults version 4.
  - Browser: 75 fps (13.34 ms mean, p95 14.9 ms) with the gyro in flight; no console errors.
- **Stage 5 Super Decathlon** (flyable; Tab switches aircraft):
  - New shared physics: constant-speed propeller (blade pitch scale s: CT = s·CT(J/s), CP = s²·CP(J/s)) with a
    rate-limited governor set by the rpm lever (2000–2700 rpm; on the fine stop it acts as fixed pitch);
    Gagg–Ferrar altitude power lapse; manifold pressure; P-factor (thrust centre shift ∝ sin of flow angle);
    gyroscopic precession −ω × H of prop and crank; spool-up torque reaction (dH/dt); slipstream swirl on the fin;
    negative-g fuel and oil starvation for engines without inverted systems (the Air-Bike), none for the Decathlon.
  - G monitoring: filtered G-meter with max/min tell-tales, warning within 10% of +6/−5 g, latched OVER-STRESS,
    VNE warning and latched over-speed. Backspace (respawn) resets them.
  - Aero additions: optional yaw-damping and rudder-effectiveness tables against alpha (spins, deep-stall rudder blanking).
  - Decathlon data: near-symmetric section (CLmax 1.42, CLmin −1.17), CD0 0.038, e 0.72, 1.5° incidence,
    74 in Hartzell constant-speed prop, AEIO-360 curve, roll damping reversing at 20–35° alpha.
    The post-stall pitch break means full aft stick settles at about 26° alpha (no deep-stall trap).
  - Procedural Decathlon model (lofted fuselage, tandem cabin glazing, strut-braced high wing at incidence, spring gear,
    red sunburst trim, metal prop). Models now share an `AircraftModel` base (pose interpolation, surfaces, prop blur).
  - HUD adds aircraft name, MAP (inHg) and prop rpm setting, G with max/min, and warnings (STALL, G LIMIT,
    OVER-STRESS, VNE, FUEL STARVED, LOW OIL). Home/End = prop rpm lever.
  - Brakes: B key or joystick trigger (Extreme 3D Pro profile, defaults version 3). A single brake input is shared
    out with the rudder (differential braking for steering a taildragger without pedals).
  - Decathlon performance tests (791 kg, ISA): stall 45.9 kt (target 49, −6%); best climb 1179 fpm (1130, +4%)
    at Vy 76 kt (71, +7%); Vx 54 kt (50, +8%); cruise 119.3 kt TAS at 75% power, 7,500 ft (122, −2%);
    take-off roll 177 m on gravel, lift-off 57 kt (177, 0%); circuit and landing on gravel 36: touchdown 49 kt,
    1.45 m/s, roll 156 m with steady braking (152, +3%).
  - Aerobatics (automated pilot): loop 11.6 s at up to 5.0 g, 37 kt over the top, ±3 m; aileron roll 360° in 4.2 s;
    stall turn: pivot 207°, heading reversed 177°, back at entry height; spin: 186°/s at 28° alpha, recovers in
    0.14 turns, 249 m total; 20 s inverted holding height to 9 m at 84% power, oil 100%.
    G-limit warning/over-stress flags (+6/−5 g) and over-speed tested. Air-Bike starves under negative g.
  - Browser: 75 fps (13.33 ms mean, p95 14.8 ms) with the Decathlon; physics 120 Hz; no console errors.
- **Stage 4 Air-Bike 103** (flyable):
  - `aero.ts`: coefficient build-up. CL/CD from ±180° alpha tables (stall break at 19°, flat-plate beyond), stability and
    control derivatives (Cm_alpha, Cm_q, Cn_beta, Cl_beta, Cl_p, Cn_r, control powers, adverse yaw), stall pitch break and
    loss of roll damping, ground effect (McCormick), propeller slipstream over the tail for elevator and rudder authority.
  - `powerplant.ts`: Hirth F-33 brake-power curve (20.6 kW at 6500 rpm), 2.5:1 belt at 95%, shaft dynamics from a
    torque balance, carburettor lag, idle air bleed that fades with rpm (engine braking), stalls below 1000 rpm,
    E starts and stops it. Propeller thrust and torque from CT/CP vs advance ratio; windmills in a fast glide.
    Torque reaction rolls left (clockwise prop). Fuel burn (BSFC 0.45 kg/kWh) updates mass and inertia.
    Single-cylinder vibration (firing at rpm/60, about 100 Hz) is exposed as a level and frequency for cockpit
    sound (Stage 9), not as a force: it is above the 60 Hz a 120 Hz step can represent.
  - `FixedWingAircraft`: airframe + gear + aero + powerplant + fuel; flight state (IAS, alpha, beta, G, AGL, VS).
  - Data in `airbike103.json` (tables, derivatives, prop, engine); notes record each estimate and the tuning.
  - Procedural model (`src/aircraft/models/airbike103Model.ts`): strut-braced high wing, steel-tube keel and booms,
    open seat with pilot, Hirth with belt drive, wooden prop (blurs to a disc), tail feathers. Elevator, ailerons
    and rudder move with the controls.
  - Views (V cycles them): chase (follows heading, not bank), cockpit (pilot's eye, drag to look; engine shake removed 2026-10-20 so the panel stays steady),
    free camera. HUD on the left: IAS kt, ALT and AGL ft, VSI fpm, heading, rpm, throttle, fuel, G, AoA, slip ball,
    and a STALL warning 3° before the stalling angle.
  - Pitch attitudes (user check, flown as a pilot would; test within ±2°): 0.1° level at 75% throttle (47 kt),
    +9.8° in the full-power climb at 39 kt, −10.9° in an idle descent at 45 kt. Achieved with a 1.6° wing rigging
    incidence (`aero.wingIncidence_deg`; tables are against the wing's angle, so flight performance is unchanged)
    and the tailwheel lowered so the wing's ground angle is as before (fuselage ~11° nose-up at rest).
    With the stick held neutral the attitudes differ (about −3°, +7°, +10°), because neutral stick holds ~40 kt.
  - Engine response (halved at the user's request): idle → full rpm in 1.1 s static / 0.65 s at 45 kt,
    full → idle in 1.3 s / 0.8 s (to 90% of the change). Crank inertia 0.006 and prop 0.125 kg m², carburettor lag 0.075 s.
  - Auto-coordinated rudder (U, or the controls screen; saved; off by default; HUD shows AUTO-RUDDER):
    a PI controller on sideslip plus a washed-out yaw damper (it damps sudden yaw but not a steady turn), added to
    the pilot's rudder in flight only (inactive on the ground and fading in from 15 to 25 kt). In an aileron-only
    30° turn at 40–50 kt the steady slip falls from about 4° to 0.1–0.2°, and the worst moment from about 9° to under 3°.
  - Spawns: 7 = gravel 36, 8 = grass 36, 9 = gravel 18, 0 = grass 18; Backspace resets. Keyboard flight is on by default
    (arrows stick, Z/C rudder, +/− throttle). Neutral stick trims about 40 kt at full power. Default wind: light northerly.
  - Automated flight tests (test pilot autopilot in `tests/helpers`), mass 216 kg, calm ISA:
    stall 24.4 kt (target 24, +1.7%); cruise at 75% power 49.2 kt (47, +4.7%); best climb 498 fpm (475, +4.8%);
    take-off roll 74.3 m on grass and 71.0 m on gravel (76, −2% and −7%, three-point technique);
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
- Tests: 259 passing (Stage 9 added settings, units, sun and sound-model suites; Stage 8 added the flight-test programme and gust/turbulence/crosswind handling suites; Stage 7 added engine-temperature, instrument, HUD/gauge agreement, gauge geometry and view suites; Stage 6 added rotor, gyro performance and static-friction tests; Stage 5 added Decathlon performance, aerobatics, propeller-effects suites; engine response, pitch-attitude check, auto-rudder and the joystick profile added since; Stage 4 added aero, powerplant and Air-Bike performance/circuit suites; Stage 3 added rigid body, atmosphere, wind, gear and input suites). Highlights: free fall matches ½gt²;
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
- Air-Bike landing roll (decided 2026-10-19, reconfirmed for Stage 8 on 2026-10-20): keep the physics as modelled and accept
  the gap to the 61 m target; the flight-test report lists it as an accepted deviation with this reason.
  With no brakes, only drag, rolling resistance and the windmilling prop slow it (about 0.9 m/s² on average), giving
  about 112 m on grass and 165 m on gravel from a 26 kt touchdown. Grass rolling resistance stays at 0.07.
- Body axes are three.js-style (x right, y up, z aft) rather than the aero convention (x forward, y right, z down),
  so models and physics share one frame. Aero code in Stages 4–6 must use alpha = atan2(−v_y, −v_z) and beta from v_x.
- Reported wind is the 10 m wind; aloft it is up to 1.6× stronger (shear). The windsock at about 10 m reads the reported value.
- Gyro cruise (decided 2026-10-19): Bensen's 65 mph (56 kt) is level flight at about 45% power; full power gives the
  82 kt maximum. At 75% power the same airframe would cruise near 75 kt.
- Gyro take-off: the CLAUDE.md 30 m roll needs prerotation near flight rpm (330 rpm prerotator), about 150 kgf static
  thrust, rotor ground effect and generous back stick (20°). Jane's quotes ~91 m for a stock B-8M.
- Pitch-attitude targets (0° / +10° / −10°) are pilot-flown attitudes (level 75% throttle, Vy climb, 45 kt idle descent),
  not hands-off; decided 2026-10-19.
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
- Gauge markings for the Air-Bike and gyro (and the Hirth/McCulloch CHT/EGT limits) are assumed; no published panel
  data. Engine temperature figures are estimates, not manufacturer data.
- No magnetic variation: compass, DG and HUD all show true heading.
- The Decathlon cabin interior is minimal (panel box only). Cowl top lowered to the panel top (firewall 0.38 m) and the
  cabin glazing is a separate 20%-opacity mesh (was opaque), so the pilot sees out ahead and to the sides (2026-10-20).
- Gyro hands-off: power changes still turn it gently (full power ~25°/min left, idle ~45°/min right) because prop
  torque changes with power; the bank stays under 4°.
- Gyro rotor overspeeds (> 400 rpm) in a near-vertical slow descent; the warning shows it. Keep some airspeed.
- Decathlon spin is a little fast and steep compared with the real aircraft (speed builds to ~60 kt). Revisit in Stage 8.
- Decathlon hands-off take-off (stick neutral) lifts off late (~85 kt): neutral stick trims near 90 kt. There is no
  pitch trim control yet; consider adding trim in Stage 7/9.
- Stall turns end with a brief backward slide of about 3 m/s; acceptable, but technique-sensitive.
- The Air-Bike pitch-attitude test is flown at 1,000 ft: higher up the engine loses power (Gagg–Ferrar lapse), as it should.
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
Try the menu (Esc) and listen to each aircraft (sound starts on the first key press or click). Stage 8's flight notes are
deferred: when you add notes to docs/FLIGHT_NOTES.md, each will be resolved there. Then Stage 10 when the brief arrives.
