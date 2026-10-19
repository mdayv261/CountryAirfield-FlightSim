# Project Status

**Current stage:** 2 – Airfield and world (complete; exit check passed 2026-10-19)
**Next stage:** 3 – Flight core

## What works
- Vite 8 + TypeScript 7 (strict) + Three.js r186 + Vitest 4. Scripts: `npm run dev`, `npm test`, `npm run build`, `npm run preview`, `npm run typecheck`.
- Folder layout per CLAUDE.md (`src/physics`, `src/cockpit` and `src/audio` are still empty placeholders).
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
  - Runways: gravel 600 x 18 m on x = 0; grass 600 x 30 m with mowing stripes, centreline x = 54 (30 m gap edge to edge).
    White edge cones every 50 m on both edges of both runways (52). White gable threshold markers at all four ends (4 gravel, 6 grass).
  - Apron 40 x 60 m west of the gravel runway. Two L-shaped taxiways from the apron to each threshold (stub onto the gravel runway).
  - Three gable-roof hangars (doors face the apron), clubroom with veranda (deck, posts, rail, skillion roof), two-storey
    tower with glazed cab and an outside stair. All buildings are merged into one draw call.
  - Windsock on the tower roof: 5 orange/white bands, each fills at 3 kt, fully horizontal at 15 kt, points downwind, small flutter.
  - Trees, instanced in 2 draw calls: 8 windbreak lines plus 70 gum clusters and 220 scattered gums, clear of the airfield/approach zone and the dam.
  - Sky: gradient dome shader with a sun disc and glow (sun azimuth 25°, elevation 52°, northern sky), with matching horizon fog.
  - Altocumulus: rows of lumpy cloudlets (6 lobes each, instanced), 22 km square layer, every lobe between 3,000 and 4,500 m.
  - Sun shadows (2048 map) over an 800 m square around the airfield. Logarithmic depth buffer.
- Free-fly camera: drag to look, WASD move, R/F up and down, Shift x5, mouse wheel sets speed (shown in kt), arrow keys look.
  Keys 1–6 give preset views (overview, runway 36 threshold, apron, tower/windsock, dam, altocumulus).
- M is a measuring tool: it drops a point where the crosshair meets the ground and shows the horizontal distance.
  `[`/`]` changes inspection wind speed (1 kt steps), `,`/`.` changes direction (10° steps). X toggles the axis marker (hidden by default
  because it sits on the runway centreline). H toggles the help.
- FPS overlay: fps, frame time (ms), physics rate (Hz) and a PAUSED flag.
- Measured in Chrome on the Mac mini M4 (2560x1440 display at 75 Hz): 75 fps, mean frame 13.34 ms,
  p95 13.6 ms, max 14.4 ms over 300 frames, so no dropped frames. The browser locks to the display's 75 Hz refresh.
  Physics holds 120 Hz. P pauses (physics 0 Hz, render continues) and resumes cleanly. No console errors.
- Tests: 61 passing. Stage 1 suites plus terrain (flat zone, 60 m cap, slope, edge fade, dam, heightfield interpolation),
  airfield (runway sizes and spacing, cones, threshold markers, taxiway connectivity, no overlaps, buildings off pavements,
  tower and windsock), windsock (downwind, calm, full at 15 kt, 3 kt per band, monotonic), trees, clouds (3,000–4,500 m, rows), sun, ray measuring.
- Stage 2 exit check in Chrome on the Mac mini M4 (2560x1440 at 75 Hz), 600 frames per view over 4 views:
  mean 13.34 ms (75 fps, the vsync limit), p95 15.0 ms, max 15.5 ms, no frame over 20 ms. 36 draw calls, about 860k triangles.
  The measuring tool reads the gravel runway as 600.0 m (-300.0 to 300.0); both runway meshes are 600 m long. No console errors or warnings.

## Decisions recorded
- Gyro engine: McCulloch 4318, 65 hp (not Subaru). Stages 7 and 9 will use CHT and a 2-stroke sound for the gyro.
- Grass runway "30 m east" means a 30 m gap between the runway edges, so the centrelines are 54 m apart.
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
- Shadows only cover an 800 m square around the airfield (fixed). Later stages may need the shadow box to follow the aircraft.
- About 860k triangles a frame (terrain 160k, plus clouds and trees, plus the shadow pass). Fine on the M4; on a weaker laptop,
  the first things to cut are the terrain cell size (15 m → 20 m) and the cloud lobe count.
- The inspection wind in `main.ts` is temporary; Stage 3's wind model will drive the windsock instead.
- Clouds are not fogged and stop at the layer edge (11 km out), so at high altitude the edge of the layer can be seen.

## Next step
Stage 3: 6-DOF rigid body, ISA atmosphere, wind model (feeding the windsock), gear contact on `Heightfield`
(gravel mu 0.6, grass mu 0.4), and keyboard/mouse/gamepad input with calibration.
