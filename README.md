# Country Airfield Flight Simulator

A browser flight simulator set at a fictional country airfield in Victoria, Australia. Three
aircraft, each with its own 6-degree-of-freedom flight model tuned to published figures:

- **Air-Bike 103**: an open-cockpit ultralight with a Hirth F-33 single-cylinder two-stroke.
- **Super Decathlon 8KCAB**: an aerobatic taildragger with a Lycoming AEIO-360 (180 hp) and a constant-speed propeller.
- **Bensen B-8M gyroplane**: a single-seat gyro with a McCulloch 4318 flat-4 two-stroke and a free-spinning rotor.

Everything is built in code: the low-poly scenery and aircraft are procedural, and the engine,
wind and rotor sounds are synthesised live. No models, textures or audio files are loaded.

**Play it online: <https://mdayv261.github.io/CountryAirfield-FlightSim/>** (desktop browser; keyboard, mouse or joystick).

See [docs/PILOT_GUIDE.md](docs/PILOT_GUIDE.md) for the controls and how to fly each aircraft.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer (with npm). Developed on Node 25.
- A desktop browser with WebGL 2 and Web Audio: Chrome, Edge, Firefox or Safari.
- Optional: a joystick (the Logitech Extreme 3D Pro is set up automatically) and rudder pedals.

## Install and run

```sh
npm install        # once, to fetch Three.js, Vite, TypeScript and Vitest
npm run dev        # start the development server
```

Then open <http://localhost:5173/>. Sound starts on your first key press or click (browsers
require a user action before playing audio). Press **Esc** for the settings menu and **H** to
hide or show the key help.

## Build and run the production version

```sh
npm run build      # type-checks, then writes the finished game to dist/
npm run preview    # serves dist/ at http://localhost:4173/
```

`dist/` is self-contained: `index.html` plus one script file, with relative paths, so the
folder can be copied anywhere and served by any static web server, under any path. For example,
to serve it with Python:

```sh
cd dist && python3 -m http.server 8080    # then open http://localhost:8080/
```

Opening `dist/index.html` directly from disk (a `file://` address) does not work: browsers only
load JavaScript modules over HTTP.

## Deployment

Every push to `main` runs the tests, builds the game and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). The site updates a minute or two after the push. The
Actions tab on GitHub shows each run; a failing test stops the deployment.

## Tests

```sh
npm test               # all automated tests (physics, flight performance, instruments, sound, settings)
npm run flight-test    # the automated test pilot: writes docs/FLIGHT_TEST_REPORT.md
npm run typecheck      # TypeScript only
```

## Project layout

| Folder | Contents |
|---|---|
| `src/core` | Fixed 120 Hz game loop, units, constants, saved settings |
| `src/physics` | Rigid body, atmosphere, wind, landing gear, wing aerodynamics, engine and propeller, gyro rotor |
| `src/aircraft` | One data file per aircraft (`*.json`), the data schema, procedural 3D models |
| `src/world` | Terrain, airfield, buildings, trees, sky, clouds, sun position |
| `src/cockpit` | Instruments and drawn panel gauges |
| `src/audio` | Synthesised engine, propeller, wind, rotor and stall-horn sound |
| `src/input` | Keyboard, mouse and joystick input with calibration |
| `src/ui` | HUD, cameras and views, menu, overlays, graphics quality |
| `tests` | Vitest suites, including the automated test pilot |
| `docs` | Status, pilot's guide, flight-test report and flight notes |

All physics runs in SI units; speeds are shown in knots. World axes: +X east, +Y up, +Z south;
the runways run north–south (18/36).

## Performance

The simulator targets 60 fps. The frame-rate overlay (top left) shows the frame rate, CPU time
per frame and the current graphics level. With **Graphics: Auto** (the default, in the Esc menu)
it steps down shadow detail and then render resolution if a machine cannot hold 60 fps.
