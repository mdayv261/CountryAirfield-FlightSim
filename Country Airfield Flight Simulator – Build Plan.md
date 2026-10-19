# **Country Airfield Flight Simulator – Build Plan**

Oct 19, 2026

A browser-based (Three.js) flight simulator with three aircraft, moderate-realism 6-DOF physics and a fictional Victorian country airfield, built in ten stages with Claude Code using Claude Opus 5.5.

## **1\. Scope decisions**

The simulator runs in a web browser, uses procedural low-poly models and a moderate-realism 6-DOF flight model.

| Area | Decision |
| :---- | :---- |
| Platform | Web browser, Three.js (WebGL), JavaScript/TypeScript, Vite dev server |
| Physics | Moderate realism, 6-DOF rigid body, fixed 120 Hz physics step |
| Controls | Keyboard, mouse-as-stick, USB joystick/yoke and rudder pedals (Gamepad API) |
| Views | Cockpit with gauges, external chase, tower/fly-by, HUD overlay |
| 3D models | Procedural low-poly, built in code; no external assets or licences |
| Wind | Adjustable steady wind, gusts and light turbulence, crosswind presets |
| Features | Synthesised engine and wind sounds, aerobatic G-meter with limits, gyro prerotator and rotor RPM |
| Airfield | Fictional Victorian country strip with gentle hills, tree lines and a farm dam |
| Sky | Daylight only, blue sky, altocumulus cloud layer |
| Out of scope | Night, rain, ATC radio, multiplayer, damage modelling beyond over-stress warnings |

## **2\. Aircraft specifications**

These figures are the tuning targets for each flight model; the gyro uses the Amax Eagle (a Victorian-designed, single-seat, open-frame Subaru EA81 gyro) as its closest published reference.

| Item | Benson-type gyro (Subaru EA81) | Air-Bike 103 (Hirth F-33) | Super Decathlon 8KCAB |
| :---- | :---- | :---- | :---- |
| Engine | Subaru EA81 1.8 L flat-4, liquid-cooled, 110 hp at 5,400 rpm, 2.2:1 belt reduction, pusher | Hirth F-33 312 cc single-cylinder 2-stroke, air-cooled, 28 hp at 6,500 rpm, belt reduction 1:1.8/2.2/2.5 | Lycoming AEIO-360-H1B, 180 hp at 2,700 rpm, inverted fuel and oil |
| Propeller | Fixed-pitch pusher (size TBC) | 60x28, 58x30 or 56x32 in | 74 in constant-speed, 2-blade |
| Lifting surface | 26 ft (7.9 m) 2-blade rotor, 531 sq ft (49.3 m²) disc | 26.75 ft (8.15 m) span, 120 sq ft (11.1 m²), 54 in chord | 32 ft (9.75 m) span, 169 sq ft (15.7 m²) |
| Length | 10 ft (3.05 m) | 16 ft (4.9 m) | 22.9 ft (7.0 m) |
| Empty weight | 410 lb (186 kg) | 242–248 lb (110–112 kg) | 1,305 lb (592 kg) |
| Max weight | 850 lb (386 kg) | Not published (assume 500 lb / 227 kg) | 1,800 lb aerobatic / 1,950 lb normal |
| Fuel | 12 US gal (45 L) | 5 US gal (19 L) | 40 US gal (151 L) usable |
| Stall / min speed | No wing stall; minimum level speed TBC | 28 mph | 57 mph IAS (clean) |
| Cruise | 70 mph | 55 mph | 141 mph at 75% power |
| Max / Vne | 100 mph max | Vne 80 mph | Vne 200 mph, Vno 160, Va 107 mph |
| Climb | 1,500 fpm | 475 fpm | 1,130 fpm (Vx 58, Vy 82 mph) |
| Take-off roll | 100 ft (30 m) | 250 ft (76 m) | 580 ft (177 m) |
| Landing roll | 10 ft (3 m) | 200 ft (61 m) | 498 ft (152 m) |
| Ceiling | 14,000 ft | 10,000 ft | 16,000 ft |
| Gear | Tricycle | Conventional (taildragger), no brakes | Conventional, steerable tailwheel |
| Controls | Stick tilts rotor head, rudder pedals, throttle, prerotator | 3-axis, recoil start | 3-axis, propeller RPM lever |
| G limits | Avoid low-g (pushover hazard) | Not published | \+6 g / −5 g |

Notes for the flight model:

* The Amax Eagle source quotes 110 hp; the sim uses your 100 hp figure, so expect slightly lower climb than 1,500 fpm.  
* Gyro behaviour to model: rotor RPM driven by airflow through the disc, rotor decay at low g, and power pushover when the propeller thrust line sits above the centre of gravity.  
* Air-Bike: single-cylinder torque pulses, no brakes, crosswind sensitivity from its low wing loading (about 4 lb/sq ft at the assumed 500 lb).  
* Super Decathlon: P-factor, gyroscopic precession, inverted flight, spins, and a G-limit warning at \+6/−5 g.

## **3\. Airfield and environment**

The airfield is a fictional Victorian country strip, runway 18/36, at about 150 ft elevation, set in gently rolling farmland.

| Element | Specification |
| :---- | :---- |
| Main runway | 600 m x 18 m gravel, runway 18/36, threshold markers and painted numbers on boards |
| Parallel runway | Grass, 600 m x 30 m, 30 m east of the gravel runway |
| Runway markers | White and orange cones every 50 m along both edges of both runways |
| Taxiways | Two gravel taxiways, about 10 m wide, from the apron to each threshold |
| Apron | Gravel parking area, about 60 m x 40 m, with tie-down points |
| Hangars | Three corrugated-iron hangars with sliding doors and curved roofs |
| Clubroom | Weatherboard building with veranda, next to the hangars |
| Control tower | Small two-storey tower with glazed cab; windsock mast on the roof |
| Windsock | Orange and white, animated by sim wind: fills at 15 kt, droops in calm |
| Terrain | Heightmap with gentle hills (to about 200 ft above field), clear approach paths |
| Vegetation | Tree lines along paddock fences, gum-tree clusters, a farm dam north-east of the field |
| Sky | Blue gradient sky, sun position by time of day (daylight only) |
| Clouds | Altocumulus layer at about 10,000–15,000 ft: patchy rounded cloudlets in rows |
| Wind | Direction and speed slider, gust strength, turbulence level, crosswind presets |
| Units | Speed in knots , altitude in feet, distances in metres and nautical miles. |

## **4\. Recommended Claude model**

Use Claude Opus 5.5 as the main model; it is Anthropic's model for complex, multi-step work and suits the flight physics and architecture.

| Model | Use it for | Why |
| :---- | :---- | :---- |
| Claude Opus 5.5 (main) | Stages 1, 3, 4, 5, 6 and 8: architecture, 6-DOF physics, gyro rotor model, aerobatics, debugging | Best balance of reasoning depth and speed for maths-heavy code |
| Claude Sonnet 5.5 | Stages 2, 7, 9 and 10: scenery, buildings, gauges, sound, polish, documentation | Faster and uses less of your plan allowance on routine work |
| Claude Fable 5.1 (optional) | Only if a flight model problem stalls after two Opus attempts | Mythos-tier model, most capable; heavier on usage |

In Claude Code, type /model to switch models at any time. 

## **5\. Staged action plan**

Build in ten stages, simplest aircraft first; finish each stage's exit check and commit to git before starting the next.

| Stage | Build | Exit check | Model |
| :---- | :---- | :---- | :---- |
| 1\. Foundation | Vite \+ Three.js \+ TypeScript project, folder layout, game loop with fixed 120 Hz physics step, aircraft data files (JSON), Vitest test harness | Empty 3D scene runs at 60 fps; tests pass | Opus 5.5 |
| 2\. Airfield and world | Terrain with hills, gravel and grass runways, cones, taxiways, apron, three hangars, clubroom, tower, animated windsock, trees, dam, sky, altocumulus clouds | Free camera shows every item; runway measures 600 m | Sonnet 5.5 |
| 3\. Flight core | 6-DOF rigid body, ISA atmosphere, wind, gusts and turbulence, landing gear springs and friction (gravel vs grass), input system for keyboard, mouse and joystick with calibration | Tests for free fall, parked aircraft at rest, and wind drift pass | Opus 5.5 |
| 4\. Air-Bike | Wing lift and drag curves, stall, propeller thrust, Hirth 2-stroke power curve, taildragger ground handling, no brakes | Stall, cruise, climb and take-off roll within ±10% of section 2 | Opus 5.5 |
| 5\. Super Decathlon | Constant-speed propeller, torque, P-factor, gyroscopic effects, inverted flight, spins, G-load and limits | Loop, roll and spin recovery flyable; Vs and climb within ±10% | Opus 5.5 |
| 6\. Gyro | Rotor autorotation model, prerotator, tilting rotor head control, thrust-line offset, low-g and pushover warning, tricycle ground handling | Rotor spins up on take-off roll; steady autorotative descent; low-g warning triggers | Opus 5.5 |
| 7\. Cockpits and views | Per-aircraft panels 1\. Gyrocopter \- ASI, altimeter, VSI, G4 compass, tachos for rotor and engine RPM, slip ball, coolant temp for Subaru, fuel gauge. 2\. ASI, altimeter, VSI, G4 compass, tacho RPM, slip ball, EGT for Hirth,fuel gauge. 3\. ASI, attitude indicator altimeter, VSI, DG compass, manifold pressure in inches, tacho RPM and G-meter. All cockpit views have  optional HUD on left side of screen, chase, cockpit and tower views. | All views switch by key; gauges track flight state | Sonnet 5.5 |
| 8\. Flight testing and tuning | Automated performance tests against section 2, crosswind and gust tuning, handling feel review | All performance tests pass; your test-flight notes resolved | Opus 5.5 |
| 9\. Sound and menus | Synthesised engine sounds (single-cylinder 2-stroke, Subaru boxer, Lycoming), wind and rotor sounds, stall warning buzzer for Decathlon only, aircraft select, wind and time-of-day settings, control mapping | Each aircraft sounds distinct; settings persist between sessions | Sonnet 5.5 |
| 10\. Polish and packaging | Performance optimisation, pause and reset, README and pilot's guide, production build | Runs at 60 fps on your machine; build opens from a single folder | Sonnet 5.5 |

Working rules for every stage:

* Start each stage in a fresh Claude Code session and paste that stage's prompt from section 7\.  
* Ask Claude Code to plan first (plan mode), review the plan, then let it build.  
* Test fly in the browser yourself before accepting the stage.  
* Commit to git at the end of every stage so you can roll back.

## **6\. Claude Code setup guide**

Setup takes about 20 minutes on macOS 13+ or Ubuntu 20.04+; the steps below use the terminal.

**Step 1 – Check prerequisites**

* A Claude Pro, Max, Team, Enterprise or Console account.  
* macOS 13.0+, Ubuntu 20.04+, Debian 10+ or Windows 10 1809+; 4 GB+ RAM.  
* Node.js 22 LTS (for the Vite dev server) from nodejs.org, and Git.  
* A current Chrome, Edge or Firefox browser; joystick and pedals plugged in by USB.

**Step 2 – Install Claude Code (native installer, recommended)**

curl \-fsSL https\://claude.ai/install.sh | bash  
Open a new terminal, then confirm the install:

claude \--version  
claude doctor  
If "claude" is not found, the install folder is not on your PATH; see the troubleshooting page in the sources. Prefer a window to a terminal? The Claude desktop app also runs Claude Code.

**Step 3 – Create the project folder**

mkdir \-p \~/Projects/country-flight-sim  
cd \~/Projects/country-flight-sim  
git init  
node \-v  
**Step 4 – Start Claude Code and log in**

claude  
Follow the browser prompt to log in. Then type /model and choose Claude Opus 5.5.

**Step 5 – Add the project memory file**

Create a file named CLAUDE.md in the project folder and paste the CLAUDE.md template from section 7\. Claude Code reads it at the start of every session, so the specs and rules carry across stages.

**Step 6 – Run Stage 1**

Paste the master prompt, then the Stage 1 prompt (section 7). Review the plan Claude Code proposes before approving the build.

**Step 7 – Test in the browser**

npm run dev  
Open the local address it prints (normally http\://localhost:5173). For the joystick, press any button once after the page loads so the browser detects it.

**Step 8 – Save progress**

At the end of each stage ask Claude Code to commit, or run:

git add \-A  
git commit \-m "Stage N complete"

## **7\. Prompt framework**

The framework has four parts: a CLAUDE.md memory file, a master prompt for session one, ten stage prompts, and two reusable fix prompts.

### **7.1 CLAUDE.md template (save in the project folder)**

\# Country Airfield Flight Simulator

\#\# Goal  
Browser flight simulator, three aircraft, one fictional Victorian country airfield.  
Daylight only, blue sky, altocumulus clouds. Moderate-realism 6-DOF physics.

\#\# Tech stack  
\- TypeScript, Three.js (WebGL), Vite, Vitest. No game engine.  
\- All 3D geometry procedural low-poly, built in code. No external models or textures.  
\- Web Audio API for synthesised sound. Gamepad API for joystick and pedals.

\#\# Architecture rules  
\- Fixed physics step 120 Hz, decoupled from rendering (accumulator loop).  
\- SI units inside physics (m, kg, s, N, rad). Convert only for display.  
\- World axes: \+X east, \+Y up, \+Z south. Runway 18/36 runs along Z.  
\- One data file per aircraft in /src/aircraft/\<name\>.json; no magic numbers in code.  
\- Folders: /src/core, /src/physics, /src/aircraft, /src/world, /src/cockpit, /src/audio, /src/input, /src/ui, /tests.

\#\# Aircraft targets (tune to within \+/-10%)  
Gyrocopter (Bensen B8M, McCulloch 4318 engine 65 hp, pusher):  
  rotor 6.15 m 2-blade, empty 115 kg, max 250 kg, fuel 20 L, cruise 65 kts,  
  max 95 kts, climb 1100 fpm, take-off roll 30 m with prerotation, tricycle gear.  
Air-Bike 103 (Hirth F-33 28 hp at 6500 rpm, belt reduction, tractor):  
  span 8.15 m, area 11.1 m2, chord 54 in, empty 112 kg, max 227 kg (assumed),  
  fuel 19 L, stall 28 kts, cruise 55 kts, Vne 80 kts, climb 475 fpm,  
  take-off roll 76 m, landing roll 61 m, taildragger, no brakes.  
Super Decathlon 8KCAB (Lycoming AEIO-360 180 hp at 2700 rpm, 74 in constant-speed prop):  
  span 9.75 m, area 15.7 m2, empty 592 kg, max 816 kg aerobatic, fuel 151 L,  
  stall 57 kts, Vx 58, Vy 82, Va 107, Vno 160, Vne 200 kts, climb 1130 fpm,  
  take-off roll 177 m, landing roll 152 m, \+6/-5 g, inverted fuel and oil, taildragger.

\#\# Airfield  
600 m x 18 m gravel runway 18/36; parallel 600 m x 30 m grass runway 30 m east.  
Edge cones every 50 m. Two taxiways from apron to each threshold. Apron 60 x 40 m.  
Three hangars, clubroom with veranda, small control tower with roof windsock.  
Gentle hills to 60 m above field, tree lines, gum clusters, farm dam to the north-east.

\#\# Working rules  
\- Plan first, then build. List files you will change before changing them.  
\- Write or update tests for every physics change. Run all tests before finishing.  
\- Keep 60 fps on a mid-range laptop. Report frame time after visual changes.  
\- Explain physics choices in plain English comments for a mechanical engineer.  
\- Never delete working features without asking. Commit at the end of each stage.  
\- Keep docs/STATUS.md updated: stage, what works, known issues, next step.

### **7.2 Master prompt (paste at the start of session one)**

You are building a browser flight simulator described in CLAUDE.md. Read it fully.  
I am a retired mechanical engineer with a fluid-power background; explain  
aerodynamics and code choices in plain engineering terms, briefly.

We will work in ten stages. In each stage:  
1\. Restate the stage goal and exit check in two or three lines.  
2\. Propose a plan: files, data structures, tests, and risks. Wait for my approval.  
3\. Build it, run the tests, and fix failures.  
4\. Tell me exactly what to test fly or look at in the browser.  
5\. Update docs/STATUS.md and commit with the message "Stage N: \<summary\>".

Ask me questions whenever a requirement is unclear rather than guessing.  
Start with Stage 1\.

### **7.3 Stage prompts (one per session)**

Start each later session with: "Read CLAUDE.md and docs/STATUS.md, then begin the stage below."

STAGE 1 \- FOUNDATION  
Set up Vite \+ TypeScript \+ Three.js \+ Vitest. Create the folder layout in CLAUDE.md.  
Build a fixed-step game loop (120 Hz physics, render at display rate) with pause.  
Create a typed aircraft data schema and empty JSON files for the three aircraft.  
Show a ground plane, sky colour and an fps counter.  
Exit check: npm run dev shows the scene at 60 fps; npm test passes.

STAGE 2 \- AIRFIELD AND WORLD  
Build the airfield from CLAUDE.md, procedural low-poly, in /src/world.  
Terrain: 6 x 6 km heightmap, flat airfield zone, gentle hills to 60 m, farm dam.  
Runways: gravel 600 x 18 m and grass 600 x 30 m, edge cones every 50 m, threshold markers.  
Taxiways, apron, three hangars, clubroom with veranda, two-storey tower, roof windsock.  
Windsock animates from a wind vector (full at 15 kt). Tree lines and gum clusters, instanced.  
Sky: gradient with sun; altocumulus layer at 3,000-4,500 m as rows of rounded cloudlets.  
Add a free-fly camera for inspection.  
Exit check: every item visible; runway length measures 600 m; 60 fps.

STAGE 3 \- FLIGHT CORE  
Build /src/physics: 6-DOF rigid body (quaternion attitude, inertia tensor), ISA  
atmosphere, wind model (steady, gusts, turbulence, crosswind presets), and landing  
gear contact (spring-damper struts, tyre friction: gravel mu 0.6, grass mu 0.4,  
steerable tailwheel/nosewheel). Build /src/input: keyboard, mouse-as-stick and  
Gamepad API joystick/pedals with axis mapping, dead zones and a calibration screen.  
Tests: free fall, aircraft at rest on gear, drift in wind, energy conservation.  
Exit check: all tests pass; a test block can be thrown and settles on its gear.

STAGE 4 \- AIR-BIKE 103  
Model the Air-Bike from CLAUDE.md. Lift and drag from CL/CD vs alpha tables with  
stall break; aileron, elevator, rudder moments; stability derivatives; propeller  
thrust from rpm and airspeed; Hirth F-33 power curve with belt reduction and  
single-cylinder vibration. Taildragger handling, no brakes. Procedural model:  
open seat, strut-braced high wing, steel tube fuselage, tail feathers.  
Add automated tests for stall, cruise, climb and take-off roll vs CLAUDE.md.  
Exit check: tests within \+/-10%; I can take off, circuit and land on both runways.

STAGE 5 \- SUPER DECATHLON  
Model the Super Decathlon from CLAUDE.md, reusing the fixed-wing code.  
Add: constant-speed propeller governor and RPM lever, engine torque, P-factor,  
gyroscopic precession, slipstream on the tail, spin entry and recovery,  
inverted flight with inverted fuel and oil, G-load calculation with warnings at  
\+6/-5 g and an over-stress flag. Procedural tandem cabin, high wing, taildragger.  
Exit check: Vs, Vy and climb within \+/-10%; loop, aileron roll, stall turn and spin  
recovery are flyable.

STAGE 6 \- GYRO  
Model the Bensen B-8M gyro from CLAUDE.md. Rotor: blade-element or momentum  
autorotation model; rotor RPM driven by inflow through the disc; rotor thrust  
from RPM and disc angle; rotor decay at low g. Controls: stick tilts the rotor  
head (pitch and roll), rudder pedals, throttle, prerotator engage button.  
Model the propeller thrust-line offset from the centre of gravity and show a  
low-g / power-pushover warning. Tricycle gear. Open frame, seat, mast, tail.  
Exit check: prerotate, take off in about 30 m, climb, cruise 70 mph, steady  
autorotative descent at idle, low-g warning triggers on a sharp pushover.

STAGE 7 \- COCKPITS, HUD AND VIEWS  
Build per-aircraft instrument panels as drawn gauges: ASI, altimeter, VSI, RPM,  
slip ball, compass, fuel gauges; EGT/CHT for the Hirth; coolant temp for the Subaru; rotor RPM  
for the gyro; attitude indicator, DG compass, manifold pressure, G-meter with max/min needles for the Decathlon.  
Add views: cockpit (look around with mouse or hat switch), chase, tower, fly-by.  
Add a toggleable HUD: airspeed, altitude, heading, VSI, G, wind.  
Exit check: all views switch by key; gauges agree with the HUD.

STAGE 8 \- FLIGHT TESTING AND TUNING  
Write an automated test-pilot script that flies each aircraft through stall,  
cruise, climb, take-off and landing roll and reports results vs CLAUDE.md in a  
table. Tune data files, not code, until all pass. Then tune crosswind handling  
and gust response. I will add test-flight notes in docs/FLIGHT\_NOTES.md; resolve each.  
Exit check: all performance tests pass; all notes resolved.

STAGE 9 \- SOUND AND MENUS  
Synthesise with Web Audio: single-cylinder 2-stroke (Hirth), flat-4 boxer with belt  
whine (Subaru), Lycoming flat-4, wind noise by airspeed, rotor swish by rotor RPM,  
stall warning horn for the Decathlon. Build menus: aircraft select, start position  
(apron or runway threshold), wind settings, time of day, control mapping, units.  
Save settings in browser storage.  
Exit check: each engine sounds distinct; settings survive a reload.

STAGE 10 \- POLISH AND PACKAGING  
Profile and optimise to 60 fps. Add pause, reset to apron, reset to threshold.  
Write README.md (install, run) and docs/PILOT\_GUIDE.md (controls, procedures for  
each aircraft). Produce a production build that runs from one folder.  
Exit check: 60 fps on my machine; the build runs from npm run preview.

### **7.4 Reusable fix prompts**

BUG REPORT  
Aircraft: \<name\>. View: \<view\>. What I did: \<steps\>.  
What happened: \<result\>. What I expected: \<expected\>.  
Find the root cause, explain it in two lines, add a test that reproduces it, then fix it.

HANDLING FEEL  
Aircraft: \<name\>. It feels \<too twitchy / too heavy / wrong\> in \<axis\> at \<speed\>.  
Compare with the real aircraft's known behaviour, propose up to three data-file  
changes with expected effect, and wait for my choice before changing anything.

## **8\. Assumptions and open questions**

These items were assumed to complete the plan; confirm or correct them before Stage 4\.

| Item | Assumption | Confirm |
| :---- | :---- | :---- |
| Gyro reference | Data used for a Bensen B-8M single-seat, open-frame specs at https\://www\.vortechonline.com/bensen/index.html | Do you have a specific gyro (e.g. a build you know) to match? Bensen B-8M |
| Gyro rotor RPM, propeller size | Tuned in Stage 6 until take-off and climb match targets | Any known rotor RPM or prop figures? Minimum takeo-off rotor RPM 200 rpm, maximum rotor RPM 400 rpm. Rotor diameter 6.15 metres. |
| Air-Bike empty weight | 250 lb (115 kg); the plans page does not list it | Pilot weight to use? 90 kg |
| Air-Bike reduction ratio | 2.5:1 belt, matching the 60x28 in prop | Correct ratio? 2.5:1 |
| Runway direction | 18/36 (north–south) | Preferred heading? 36 |
| Field elevation | About 50 ft | Preferred elevation? 50 ft |
| Speed units | Knots on the HUD, mph on Air-Bike and Decathlon gauges, selectable | Preferred default? Knots on all aircraft. |
| Computer | Mac or Linux with a mid-range GPU | Which machine will you fly on? Mac (Apple silicon) |

* ☐ Confirm the table above  
* ☐ Install Claude Code and run Stage 1

## **9\. Sources**

* [Air-Bike 103 specifications – Jordan Lake Aero](https://www.jordanlakeaero.com/ultralight.html)  
* [Super Decathlon 8KCAB specifications – American Champion Aircraft](https://www.americanchampionaircraft.com/super-decathlon)  
* [Hirth 33 Series (F33) technical data – Hirth Engines](https://old.hirthengines.com/2-stroke-engines/33-series/)  
* [Hirth F-33 – Wikipedia](https://en.wikipedia.org/wiki/Hirth_F-33)  
* [Stratus EA 81 (Subaru EA81 conversion) – Wikipedia](https://en.wikipedia.org/wiki/Stratus_EA_81)  
* [https\://www\.vortechonline.com/bensen/index.html](https://www.vortechonline.com/bensen/index.html)   
* [https\://en.wikipedia.org/wiki/Bensen\_B-8](https://en.wikipedia.org/wiki/Bensen_B-8)   
* [Claude Code advanced setup – Anthropic](https://code.claude.com/docs/en/setup)