# Project Status

**Current stage:** 1 – Foundation (complete, awaiting browser check by the user)
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
- Tests: 28 passing (game loop timing and pause, unit conversions, aircraft data against CLAUDE.md, validator rejections).

## Decisions recorded
- Gyro engine: McCulloch 4318, 65 hp (not Subaru). Stages 7 and 9 will use CHT and a 2-stroke sound for the gyro.
- Pilot 90 kg; Air-Bike belt 2.5:1 with 60 in prop; field elevation 50 ft (15.24 m); default runway 36; knots on all aircraft.
- Gyro rotor rpm: 200 minimum for take-off, 400 maximum.

## Known issues / open questions
- Frame rate not yet confirmed in a browser (the Chrome extension was not connected during the build).
- McCulloch 4318 rated rpm (4100) and direct drive are assumptions; confirm in Stage 6.
- Super Decathlon speeds in CLAUDE.md are labelled knots. The published figures (stall 53 mph, Vne 200 mph, etc.) are mph. Settle which applies before Stage 5 tuning.
- Air-Bike speeds in CLAUDE.md are knots, but the Build Plan lists mph (stall 28, cruise 55, Vne 80). Confirm before Stage 4.

## Next step
Stage 2: terrain heightmap, runways, cones, taxiways, apron, buildings, windsock, trees, dam, sky gradient, clouds and a free-fly camera.
