// World layout data: every airfield, terrain and scenery dimension lives here, so the
// builders contain no magic numbers. SI units (m, rad). Axes: +X east, +Y up, +Z south.
// Field level is y = 0 (the field's 15.24 m AMSL elevation is applied by the atmosphere model).

/** Axis-aligned rectangle on the ground: centre and full sizes along X (east) and Z (south). */
export interface GroundRect {
  cx: number;
  cz: number;
  sizeX: number;
  sizeZ: number;
}

const GRAVEL_WIDTH = 18;
const GRASS_WIDTH = 30;
/** Grass runway centreline is this far east of the gravel centreline (CLAUDE.md "30 m east"). */
const RUNWAY_CENTRELINE_SPACING = 30;
const RUNWAY_LENGTH = 600;
const TAXIWAY_WIDTH = 10;

export const RUNWAYS = {
  length: RUNWAY_LENGTH,
  gravel: { cx: 0, cz: 0, sizeX: GRAVEL_WIDTH, sizeZ: RUNWAY_LENGTH } satisfies GroundRect,
  grass: {
    cx: RUNWAY_CENTRELINE_SPACING, // edges 6 m apart (30 - 18/2 - 30/2)
    cz: 0,
    sizeX: GRASS_WIDTH,
    sizeZ: RUNWAY_LENGTH,
  } satisfies GroundRect,
  /** Height of runway/taxiway surfaces above the terrain, m (stops depth fighting). */
  surfaceLift: 0.04,
};

/** Apron west of the gravel runway: 40 m east-west by 60 m north-south. */
export const APRON: GroundRect = { cx: -60, cz: 0, sizeX: 40, sizeZ: 60 };

const apronEastEdge = APRON.cx + APRON.sizeX / 2; // -40
const taxiwayCx = apronEastEdge - TAXIWAY_WIDTH / 2; // -45, flush with apron's east edge
const thresholdZ = RUNWAY_LENGTH / 2; // 300
const gravelWestEdge = RUNWAYS.gravel.cx - GRAVEL_WIDTH / 2; // -9
const taxiLegLength = thresholdZ - TAXIWAY_WIDTH - APRON.sizeZ / 2; // apron edge to stub
const stubLength = gravelWestEdge - (taxiwayCx - TAXIWAY_WIDTH / 2);

/**
 * Two L-shaped taxiways: a leg running north (or south) from the apron, then a stub east
 * onto the gravel runway at the threshold. Rectangles do not overlap (no depth fighting).
 * The grass runway is reached by crossing the gravel runway, as at many country fields.
 */
export const TAXIWAYS: GroundRect[] = [-1, 1].flatMap((side) => [
  {
    cx: taxiwayCx,
    cz: side * (APRON.sizeZ / 2 + taxiLegLength / 2),
    sizeX: TAXIWAY_WIDTH,
    sizeZ: taxiLegLength,
  },
  {
    cx: (taxiwayCx - TAXIWAY_WIDTH / 2 + gravelWestEdge) / 2,
    cz: side * (thresholdZ - TAXIWAY_WIDTH / 2),
    sizeX: stubLength,
    sizeZ: TAXIWAY_WIDTH,
  },
]);

export const SURFACES = {
  /** Size of the coloured patches that give gravel and grass some texture, m. */
  patch: 2,
  gravel: 0xb5a788,
  apron: 0xa99c80,
  /** Mown grass runway: alternating light/dark mowing stripes along its length. */
  grassLight: 0x9cbc66,
  grassDark: 0x86a956,
  /** Random brightness variation per patch, as a fraction. */
  jitter: 0.025,
  seed: 36,
};

export const MARKERS = {
  coneSpacing: 50,
  /** CASA-style white edge cone. */
  cone: { height: 0.5, baseRadius: 0.22, radialSegments: 8 },
  /** Cones sit this far outside the runway edge so wheels running on the edge miss them. */
  coneOffset: 0.5,
  /** White gable (triangular prism) threshold markers laid across each runway end. */
  gable: { length: 3, width: 0.9, height: 0.5 },
  gablesPerThreshold: { gravel: 4, grass: 6 },
  colour: 0xf4f4f0,
};

const HANGAR_DEPTH = 18;
/** Gap between the hangar door face and the apron's west edge. */
const HANGAR_APRON_GAP = 2;

export const HANGAR = {
  /** Width along Z (door face), depth along X, wall height, extra ridge height. */
  width: 16,
  depth: HANGAR_DEPTH,
  wallHeight: 5,
  ridgeRise: 2,
  centresZ: [-20, 0, 20],
  /** Doors face east onto the apron. */
  cx: APRON.cx - APRON.sizeX / 2 - HANGAR_APRON_GAP - HANGAR_DEPTH / 2,
  doorWidthFraction: 0.8,
  doorHeightFraction: 0.85,
  /** Colorbond-style wall and roof colours, one pair per hangar. */
  walls: [0xc4c7c9, 0x5d7454, 0xd9cfb4],
  roofs: [0xa9adb0, 0x8b3a2e, 0x4e6a78],
  door: 0x6d7378,
};

export const CLUBROOM = {
  cx: -66,
  cz: -46,
  sizeX: 14,
  sizeZ: 8,
  wallHeight: 3,
  roofRise: 1.2,
  /** Veranda on the south side, facing the apron. */
  verandaDepth: 3,
  verandaPostHeight: 2.6,
  verandaPosts: 6,
  walls: 0xe9ddbf,
  roof: 0x9b3a2c,
  trim: 0xf5f2ea,
  window: 0x3a4d5e,
  deck: 0x8a6a48,
};

export const TOWER = {
  cx: -66,
  cz: 44,
  size: 5,
  storeyHeight: 3,
  storeys: 2,
  /** Glazed cab band in the top storey. */
  windowBand: 1.4,
  roofThickness: 0.3,
  roofOverhang: 0.4,
  walls: 0xf1eee6,
  roof: 0x7d8288,
  glass: 0x2f4558,
  stair: 0x8a8f94,
};

export const WINDSOCK = {
  mastHeight: 4,
  mastRadius: 0.05,
  length: 3.6,
  mouthRadius: 0.45,
  tailRadius: 0.22,
  segments: 5,
  colours: [0xff6a13, 0xf6f6f2],
  mastColour: 0xd8d8d8,
  /** Wind speed at which the sock flies fully horizontal: 15 kt in m/s. */
  fullSpeedMps: (15 * 1852) / 3600,
  /** Flutter: small yaw/pitch wobble that grows with wind speed, rad and Hz. */
  flutterAmplitude: 0.06,
  flutterHz: 1.7,
};

export const TERRAIN = {
  size: 6000,
  /** Grid spacing of the height mesh, m. Fine enough to shape the dam bank. */
  cell: 15,
  hillMax: 60,
  seed: 1931,
  /** Longest hill wavelength, m. Long wavelengths keep the hills gentle. */
  baseWavelength: 1800,
  octaves: 4,
  /** Amplitude ratio between octaves; below 0.5 keeps fine detail from steepening slopes. */
  gain: 0.35,
  /** fBm values between these map to zero..full hill height (smoothstep). */
  hillLow: 0.32,
  hillHigh: 0.74,
  /** Flat airfield zone (y = 0 exactly), extended along the runway for the approaches. */
  flatZone: { minX: -220, maxX: 180, minZ: -650, maxZ: 650 },
  /** Distance over which hills rise from the flat zone to full height. */
  flatBlend: 500,
  /** Heights fade to zero over this distance at the map edge to meet the outer skirt. */
  edgeFade: 1000,
  /** Outer ground skirt beyond the heightmap, to the horizon. */
  skirtSize: 60000,
  /** Paddock patchwork: fenced blocks of this size, each given one pasture/crop colour. */
  paddockSize: 420,
  paddockColours: [0x6f8f45, 0x7c9a4c, 0x8f9a52, 0xb9a865, 0x627f3d, 0xa49a5a],
  /** Mown grass around the runways, apron and buildings. */
  airfieldGrass: 0x7a9e4e,
  mownZone: { minX: -150, maxX: 120, minZ: -380, maxZ: 380 },
  /** Bare earth on the dam bank. */
  bankEarth: 0x8f7a58,
  /** Random brightness variation per vertex, as a fraction. */
  colourJitter: 0.06,
};

export const DAM = {
  /** Farm dam north-east of the field (about 900 m from the runway midpoint). */
  cx: 520,
  cz: -720,
  radius: 50,
  depth: 3,
  waterLevel: -0.6,
  waterColour: 0x4d7a96,
  /** Earth bank (spoil wall) all round: a "turkey's nest" dam, common on flat Victorian farms. */
  bankHeight: 1.8,
  bankWidth: 22,
  /** Terrain is levelled to the bank base out to this radius. */
  levelRadius: 160,
};

export const VEGETATION = {
  seed: 77,
  /** Keep trees clear of this zone (runways, approaches, apron, buildings). */
  clearZone: { minX: -150, maxX: 120, minZ: -1100, maxZ: 1100 },
  /** Windbreak tree lines along paddock fences: [x0, z0, x1, z1]. */
  treeLines: [
    [-400, -1300, -400, 900],
    [300, -500, 300, 1200],
    [-1500, -1200, 200, -1200],
    [600, 1300, 2200, 1300],
    [-2400, 400, -600, 400],
    [900, -1600, 900, -200],
    [-1200, 1600, -1200, 2600],
    [1400, 300, 2600, 300],
  ] as const,
  treeLineSpacing: 9,
  /** Gum clusters: count, cluster radius, trees per cluster. */
  gumClusters: 70,
  gumClusterRadius: 45,
  gumsPerCluster: [5, 14] as const,
  /** Scattered single paddock gums. */
  scatteredGums: 220,
  gumHeight: [12, 24] as const,
  lineTreeHeight: [9, 14] as const,
  /** Gums stay this far inside the heightmap edge. */
  edgeMargin: 300,
  /** Position jitter of windbreak trees along/across their line, m. */
  lineJitter: 1.5,
  gumTrunk: 0xcfc6b2,
  lineTrunk: 0x6b5540,
  gumCanopy: [0x6e7f4c, 0x5f7445, 0x7a8a58, 0x687a50],
  lineCanopy: [0x3e5733, 0x46603a, 0x3a5230],
};

export const SKY = {
  zenith: 0x2f6fc0,
  horizon: 0xc4dbef,
  /** Sun in the northern sky (southern hemisphere): azimuth from true north, elevation. */
  sunAzimuthDeg: 25,
  sunElevationDeg: 52,
  sunColour: 0xfff4e0,
  domeRadius: 25000,
  fogNear: 2500,
  fogFar: 16000,
  sunIntensity: 2.0,
  /** Hemisphere fill light: sky colour, ground bounce colour, intensity. */
  hemiSky: 0xcfe4ff,
  hemiGround: 0x5a6238,
  hemiIntensity: 1.1,
  /**
   * Sun shadows cover a fixed square around the airfield buildings (half-size, m). A
   * 2048 map over 800 m gives ~0.4 m texels: enough for hangars, trees and cones.
   */
  shadowCentre: [-30, 0, 0] as const,
  shadowHalfSize: 400,
  shadowMapSize: 2048,
};

export const CLOUDS = {
  seed: 4500,
  /** Altocumulus layer: cloudlet bottoms and tops stay inside 3,000-4,500 m. */
  baseMin: 3000,
  topMax: 4500,
  /** Layer extent (square, centred on the field). */
  extent: 22000,
  /** Rows (billows) lie across the upper wind; spacing between rows and along them. */
  rowSpacing: 900,
  cloudletSpacing: 520,
  rowAzimuthDeg: 20,
  /** Fraction of cloudlet slots filled (gaps between cloudlets are typical). */
  coverage: 0.55,
  /** Cloudlet horizontal radius range, lobes per cloudlet, lobe radius as a fraction of it. */
  radius: [150, 300] as const,
  lobes: 6,
  lobeSize: [0.4, 0.62] as const,
  /** Lobe vertical radius as a fraction of its horizontal radius (rounded, flattish puffs). */
  flatness: 0.6,
  colour: 0xffffff,
  /** Self-lit share so shaded undersides stay a soft blue-grey rather than dark. */
  emissive: 0x8a94a6,
};
