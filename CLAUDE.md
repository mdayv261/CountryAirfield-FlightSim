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
  fuel 19 L, stall 24 kts, cruise 47 kts, Vne 69 kts, climb 475 fpm,  
  take-off roll 76 m, landing roll 61 m, taildragger, no brakes.  
Super Decathlon 8KCAB (Lycoming AEIO-360 180 hp at 2700 rpm, 74 in constant-speed prop):  
  span 9.75 m, area 15.7 m2, empty 592 kg, max 816 kg aerobatic, fuel 151 L,  
  stall 49 kts, Vx 50, Vy 71, Va 93, Vno 139, Vne 173 kts, climb 1130 fpm,  
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
\- Speeds in knots everywhere (data, code, gauges, HUD, docs). Convert manufacturer mph figures to knots (x 0.869), rounded down to a whole knot; never display or store mph.