# Project Status

**Current stage:** 1 – Foundation (complete; exit check passed 2026-10-19)
**Next stage:** 2 – Airfield and world

## What works
- Vite 8 + TypeScript 7 (strict) + Three.js r186 + Vitest 4. Scripts: `npm run dev`, `npm test`, `npm run build`, `npm run preview`, `npm run typecheck`.
- Folder layout per CLAUDE.md (`src/physics`, `src/cockpit` and `src/audio` are empty placeholders).
- `src/core/GameLoop.ts`: fixed 120 Hz physics step with an accumulator, decoupled from the display rate. It also provides an interpolation `alpha` for rendering, a 0.25 s catch-up cap and pause (P key).
- `src/core/units.ts`: display-only unit conversions. `src/core/constants.ts`: sim-wide constants.
- `src/aircraft/schema.ts`: typed `AircraftData` plus `validateAircraftData()`. The validator rejects missing fields, bad enum values and out-of-range numbers, which catches knots typed in place of m/s.
- Starter JSON files: `airbike103.json`, `decathlon8kcab.json`, `bensenB8M.json`. They hold the CLAUDE.md figures converted to SI units. Aerodynamic, propeller, gear and rotor data come in Stages 4–6.
- Scene: sky-blue background with horizon fog, 6 km flat ground plane, sun and sky lighting, and an axis marker at the origin (red = east, green = up, blue = south).
- FPS overlay: fps, frame time (ms), physics rate (Hz) and a PAUSED flag.
- Measured in Chrome on the Mac mini M4 (2560x1440 display at 75 Hz): 75 fps, mean frame 13.34 ms,
  p95 13.6 ms, max 14.4 ms over 300 frames, so no dropped frames. The browser locks to the display's 75 Hz refresh.
  Physics holds 120 Hz. P pauses (physics 0 Hz, render continues) and resumes cleanly. No console errors.
- Tests: 28 passing (game loop timing and pause, unit conversions, aircraft data against CLAUDE.md, validator rejections).

## Decisions recorded
- Gyro engine: McCulloch 4318, 65 hp (not Subaru). Stages 7 and 9 will use CHT and a 2-stroke sound for the gyro.
- Pilot 90 kg; Air-Bike belt 2.5:1 with 60 in prop; field elevation 50 ft (15.24 m); default runway 36; knots on all aircraft.
- Gyro rotor rpm: 200 minimum for take-off, 400 maximum.
- Speeds are knots everywhere; mph is never used. Manufacturer mph figures are converted (x 0.869) and rounded down to a whole knot:
  Air-Bike stall 24, cruise 47, Vne 69 kt; Decathlon stall 49, Vx 50, Vy 71, Va 93, Vno 139, Vne 173 kt;
  Gyro (Bensen B-8M per vortechonline.com: cruise 65 mph, max 95 mph) cruise 56, max 82 kt.
- Where sources disagree, the manufacturer's official figures win (rule in CLAUDE.md). Audit on 2026-10-19 changed:
  Air-Bike wing area 11.15 m2 (120 sq ft); Hirth power 20.6 kW (28 HP DIN); Decathlon cruise 122 kt at 75% power added,
  fuel 151 L is usable (163 L total); gyro empty 113.4 kg (250 lb), max 249.5 kg (550 lb).

## Known issues / open questions
- McCulloch 4318 rated rpm (4100) and direct drive are assumptions; confirm in Stage 6.
- Gyro figures with no Bensen/Vortech source: rotor 6.15 m (user-supplied; Wikipedia says 20 ft / 6.10 m), fuel 20 L,
  take-off roll 30 m (Amax Eagle figure; Wikipedia/Jane's gives 300 ft / 91 m for the B-8M). Kept as in CLAUDE.md.
- The Stage 6 prompt's exit check says "cruise 70 mph" (Amax Eagle figure). Use CLAUDE.md's 56 kt (Bensen 65 mph) instead.

## Next step
Stage 2: terrain heightmap, runways, cones, taxiways, apron, buildings, windsock, trees, dam, sky gradient, clouds and a free-fly camera.
