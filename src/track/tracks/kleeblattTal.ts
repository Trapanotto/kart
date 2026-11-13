// Track 1: Kleeblatt-Tal. A sunny farm valley, laid out as a figure eight (the "clover"):
// the field straight crosses over the start straight on a stone overpass.
//
// Map coordinates: e = east, n = north (metres, before SCALE). World: x = -e, z = n, so a right
// turn on the map is a right turn in the game. Driving order:
//   Act 1  start straight past farmhouse + grandstand -> wide banked right-hander around the
//          windmill -> crest with a small jump into the orchard.
//   Act 2  S-curves between apple trees -> wooden bridge over the brook (ford alternative) ->
//          right-hander up onto the boost straight along the field, over the start straight.
//   Act 3  tightening left hairpin around the mill pond -> downhill run to the barn ->
//          last corner -> under the overpass -> ramp jump onto the start straight.
// Lap 2: sheep cross at the pasture and behind the bridge. Lap 3: the barn opens (shortcut
// through it), hay bales roll down the hill across the downhill run.
import type { ControlPoint, EdgeDef, TrackDef, Vec2 } from '../format';

const SCALE = 1.1;
const XZ = (e: number, n: number): Vec2 => [-e * SCALE, n * SCALE];
const P = (e: number, n: number, y: number, o: Omit<ControlPoint, 'p'> = {}): ControlPoint => ({ p: [-e * SCALE, y, n * SCALE], ...o });
const open = (reach = 20): EdgeDef => ({ kind: 'open', reach });

export const kleeblattTal: TrackDef = {
  id: 'kleeblatt',
  name: 'Kleeblatt-Tal',
  laps: 3,
  cup: 0,
  order: 0,
  environment: {
    hdr: 'meadow_day',
    skyTop: '#4f9fe6',
    skyHorizon: '#d9eeff',
    sunDir: [0.7194, 0.4538, 0.5259],
    sunColor: '#fff3e3',
    sunIntensity: 3.0,
    ambientIntensity: 0.95,
    fogColor: '#d4e9fb',
    fogDensity: 0.0016,
    weather: 'petals',
    exposure: 1.0,
  },
  music: 'kleeblatt',
  width: 8.5,
  main: [
    // --- Act 1 ---------------------------------------------------------------
    P(0, 0, 0, { name: 'start', w: 9, bank: 0, left: { kind: 'fence', offset: 3 }, right: { kind: 'fence', offset: 3 } }),
    P(0, 55, 0.2),
    P(1, 100, 0.8, { name: 'straightEnd', w: 9, bank: 0, left: { kind: 'fence', offset: 4 }, right: 'none' }),
    P(6.5, 138.3, 1.6, { w: 9.5, bank: 6 }),
    P(26, 159.6, 2.6, { name: 'sweeper' }),
    P(50, 166, 3.4, { name: 'windmillApex', bank: 8 }),
    P(74, 159.6, 4.0),
    P(93.5, 138.3, 4.5, { bank: 6 }),
    P(98, 116, 4.8, { name: 'windmillExit', w: 8.5, bank: 0, left: open(20) }),
    P(99, 92, 5.5, { name: 'pasture' }),
    P(100, 72, 6.3, { name: 'crest' }),
    P(100, 62, 5.9),
    P(99, 48, 4.0, { name: 'orchard' }),
    // --- Act 2 ---------------------------------------------------------------
    P(91, 30, 3.0, { w: 8, bank: -2 }),
    P(88, 16, 2.4, { bank: 3, left: { kind: 'rail', offset: 0.6 } }),
    P(92, 2, 1.8, { bank: -3, left: { kind: 'rail', offset: 0.6 }, right: { kind: 'rail', offset: 0.6 } }),
    P(101, -9, 1.4, { bank: 0, w: 8.9 }),
    P(106, -19, 1.3),
    P(106, -27, 1.3, { name: 'bridge' }),
    P(106, -35, 1.3),
    P(103, -47, 1.8, { w: 8, bank: 2, left: open(20), right: 'none' }),
    P(93, -62, 3.0, { bank: 0 }),
    P(88, -80, 4.4, { name: 'fieldCorner', w: 8.5 }),
    P(83.3, -99.5, 5.4, { bank: 6 }),
    P(70.5, -112.3, 6.2, { bank: 5 }),
    P(53, -117, 6.8, { name: 'fieldStraight', bank: 0, left: open(16) }),
    P(25, -118, 7.3, { left: { kind: 'wall', offset: 0.6 }, right: { kind: 'wall', offset: 0.6 } }),
    P(0, -119, 7.5, { name: 'overpass' }),
    P(-30, -120, 7.4, { left: 'none', right: open(18) }),
    // --- Act 3 ---------------------------------------------------------------
    P(-68, -121, 7.3, { name: 'hairpinEntry', w: 8.5, left: { kind: 'rail', offset: 1.2 } }),
    P(-96, -127, 7.2, { bank: -5 }),
    P(-118, -143, 7.0, { w: 8, bank: -7, right: open(14) }),
    P(-126, -163, 6.8, { name: 'hairpinApex', w: 7.5, bank: -8 }),
    P(-119, -183, 6.5, { bank: -6 }),
    P(-102, -195, 5.8, { name: 'hairpinExit', w: 8, bank: -2, left: 'none' }),
    P(-80, -201, 4.2, { name: 'downhill', bank: 0, w: 8.5, right: open(22) }),
    P(-62, -203, 2.6),
    P(-48, -203, 1.4, { name: 'lastCorner', bank: -3, right: open(16) }),
    P(-24, -196.6, 0.8, { bank: -6 }),
    P(-6.4, -179, 0.4, { bank: -4 }),
    P(0, -155, 0.2, { name: 'lastCornerExit', bank: 0, w: 8.5, right: open(16) }),
    P(0, -134, 0.1, { left: { kind: 'wall', offset: 3, height: 5.6 }, right: { kind: 'wall', offset: 3, height: 5.6 } }),
    P(0, -119, 0.0, { name: 'underpass' }),
    P(0, -104, 0.0, { left: { kind: 'fence', offset: 3 }, right: { kind: 'fence', offset: 3 } }),
    // catch fences: karts fly 40 m off the ramp
    P(0, -88, 0.0, { name: 'ramp', left: { kind: 'fence', offset: 3, catchHeight: 6 }, right: { kind: 'fence', offset: 3, catchHeight: 6 } }),
    P(0, -50, 0.0, { w: 9 }),
    P(0, -20, 0.0, { left: { kind: 'fence', offset: 3 }, right: { kind: 'fence', offset: 3 } }),
  ],
  branches: [
    {
      // Risky cut across the windmill meadow: grass track, only pays off with a boost.
      id: 'cut', from: 'straightEnd-14', to: 'windmillExit+28', w: 5, risk: 0.6, needsBoost: true,
      points: [
        P(8, 113, 1.5, { surface: 'offroad', left: 'none', right: 'none', shoulder: 1 }),
        P(30, 119, 2.4),
        P(50, 118, 2.9),
        P(70, 117, 3.6),
        P(92, 104, 4.8),
      ],
    },
    {
      // Splash-through ford next to the bridge: shorter, but water.
      id: 'ford', from: 'bridge-52', to: 'bridge+46', w: 6, risk: 0.3,
      points: [
        P(84, 6, 1.3, { surface: 'sand', look: 'dirt', left: 'none', right: 'none', shoulder: 2 }),
        P(81, -8, 0.4),
        P(80.5, -18, -0.45, { surface: 'water' }),
        P(81, -33, -0.6),
        P(83.5, -44, 0.6, { surface: 'sand' }),
      ],
    },
    {
      // Lap 3: straight through the barn, cutting the last corner.
      id: 'barn', from: 'downhill+10', to: 'underpass-14', w: 4.5, risk: 0.35, tag: 'barn', enabled: false,
      points: [
        P(-61, -199, 2.0, { surface: 'road', look: 'dirt', left: { kind: 'rail', offset: 0.8 }, right: { kind: 'rail', offset: 0.8 }, shoulder: 1.5 }),
        // straight through the 33 m barn (lane |x| < 4.5 m)
        P(-48, -190, 1.3),
        P(-45.1, -187.1, 1.2, { left: 'none', right: 'none' }),
        P(-33.5, -175.5, 1.0, { name: 'barnCentre' }),
        P(-21.9, -163.9, 0.8),
        P(-19, -161, 0.7),
        P(-9, -147, 0.4),
      ],
    },
  ],
  decks: [
    { from: 'bridge-12', to: 'bridge+12', style: 'wood', model: 'bridge_wood' },
    { from: 'overpass-14', to: 'overpass+14', style: 'stone' },
  ],
  structures: [{ type: 'barn', path: 'barn', at: 'barnCentre', length: 33.1, width: 13.8, height: 14.7, doorsTag: 'barnDoors', model: 'barn' }],
  ramps: [{ at: 'ramp', length: 6, height: 1.6, width: 10, trick: 34 }],
  boostPads: [
    { at: 'fieldStraight+6', lat: -3.2, width: 4 },
    { at: 'fieldStraight+42', lat: 3.2, width: 4 },
    { at: 'hairpinExit+4', lat: 2.5, width: 4 },
    { at: 'ramp-14', lat: 0, width: 4 },
  ],
  itemRows: [
    { at: 'start+72' },
    { at: 'orchard+14' },
    { at: 'fieldStraight+24' },
    { at: 'hairpinEntry-22' },
  ],
  zones: [{ kind: 'trick', from: 'crest', to: 'crest+26' }],
  patches: [{ from: 'hairpinExit-14', to: 'hairpinExit+6', latMin: 5.6, latMax: 8, surface: 'sand' }],
  respawn: [{ from: 'ramp-3', to: 'ramp+36', at: 'ramp-20' }],
  grid: { first: 8, rowGap: 4.2, lat: 2.8 },
  terrain: {
    cell: 3,
    margin: 95,
    base: 0.6,
    hills: [
      { at: XZ(52, 132), radius: 34, height: 3.4 }, // windmill knoll
      { at: XZ(106, 76), radius: 34, height: 5 }, // crest
      { at: XZ(178, 92), radius: 95, height: 15 }, // north-east hills
      { at: XZ(195, -70), radius: 70, height: 10 },
      { at: XZ(78, -104), radius: 52, height: 5.5 }, // field corner
      { at: XZ(-8, -121), radius: 42, height: 6, sx: 2.6, sz: 0.55 }, // ridge carrying the field straight
      { at: XZ(-92, -160), radius: 78, height: 6.6 }, // mill pond plateau
      { at: XZ(-72, -252), radius: 58, height: 14 }, // hay hill
      { at: XZ(40, -230), radius: 60, height: 6 },
      { at: XZ(-100, 45), radius: 85, height: 12 }, // behind the farmhouse
      { at: XZ(40, 265), radius: 110, height: 18 },
    ],
    noise: { amp: 1.1, scale: 38 },
    rim: { center: XZ(5, -25), radius: 270, width: 220, height: 55 },
    brooks: [
      {
        width: 6, depth: 0.7, bank: 6,
        points: [
          [...XZ(42, -14), 0.5], [...XZ(60, -22), 0.25], [...XZ(80, -26), -0.1], [...XZ(92, -27), -0.3], [...XZ(106, -28), -0.4],
          [...XZ(122, -24), -0.55], [...XZ(145, -30), -0.8], [...XZ(175, -44), -1.1], [...XZ(215, -52), -1.6], [...XZ(265, -48), -2.2],
        ],
      },
    ],
    ponds: [{ at: XZ(-101, -161), radius: 10, level: 5.6, depth: 1.6, bank: 5 }],
    patches: [
      { at: XZ(50, -60), size: [70 * SCALE, 44 * SCALE], surface: 'offroad', look: 'field' },
      { at: XZ(-36, -172), radius: 16, surface: 'offroad', look: 'gravel' }, // barn yard
      { at: XZ(-28, 36), radius: 14, surface: 'offroad', look: 'gravel' }, // farm yard
    ],
  },
  props: [
    // farm
    { name: 'farmhouse', pos: XZ(-36, 42), rot: -90, solid: [12, 12], solidHeight: 8 },
    { name: 'well', pos: XZ(-21, 22), solid: 1.4 },
    { name: 'crate', pos: XZ(-24, 52), rot: 20, solid: 0.8 },
    { name: 'crate', pos: XZ(-25.5, 53.5), rot: -10, solid: 0.8 },
    { name: 'tractor', pos: XZ(-24, 64), rot: 160, solid: [3, 4.5] },
    { name: 'grandstand', pos: XZ(22, 8), rot: 90, solid: [18, 7.5], solidHeight: 6 },
    { name: 'start_gate', at: 'start', lat: 0, rot: 0 },
    { name: 'sign_arrow', at: 'straightEnd-6', lat: -13, rot: 180 },
    // windmill meadow
    { name: 'windmill', pos: XZ(52, 136), rot: 200, solid: 3.6, solidHeight: 12 },
    { name: 'hay_bale', at: 'straightEnd-22', lat: 13.5, solid: 0.9 },
    { name: 'hay_bale', at: 'windmillExit+36', lat: 13, solid: 0.9 },
    { name: 'sign_arrow', at: 'sweeper', lat: -15, rot: 180 },
    { name: 'sign_arrow', at: 'windmillApex', lat: -15, rot: 180 },
    // pasture (static sheep leave in lap 2 when the herd crosses)
    ...([[118, 96], [124, 102], [114, 106], [128, 90], [121, 85]] as Vec2[]).map((q, i) => ({ name: 'sheep', pos: XZ(q[0], q[1]), rot: i * 67, tag: 'sheepGrazing' })),
    { name: 'balloon_arch', at: 'orchard+4', lat: 0 },
    { name: 'scarecrow', pos: XZ(56, -60), rot: 120 },
    { name: 'tractor', pos: XZ(30, -74), rot: 80, solid: [3, 4.5] },
    { name: 'hay_stack', pos: XZ(74, -44), solid: 2.2 },
    { name: 'bridge_wood', pos: XZ(150, -31), rot: 10 },
    { name: 'rock_a', pos: XZ(41, -11), scale: 1.2, solid: 1.2 },
    { name: 'rock_b', pos: XZ(44, -17), scale: 1.0 },
    // mill pond + hairpin
    { name: 'sign_arrow', at: 'hairpinApex-12', lat: 13, rot: 180, flip: true },
    { name: 'sign_arrow', at: 'hairpinApex', lat: 13, rot: 180, flip: true },
    { name: 'sign_arrow', at: 'hairpinApex+12', lat: 13, rot: 180, flip: true },
    // barn yard
    { name: 'silo', pos: XZ(-58, -160), solid: 2.3, solidHeight: 12 },
    { name: 'hay_stack', pos: XZ(-48, -168), solid: 1.6 },
    { name: 'hay_bale', pos: XZ(-45, -159), rot: 30, solid: 0.9 },
    { name: 'hay_bale', pos: XZ(-43, -156), rot: 75, solid: 0.9 },
    { name: 'crate', pos: XZ(-14, -170), rot: 15, solid: 0.8 },
    { name: 'sign_arrow', at: 'lastCorner+16', lat: 14, rot: 180, flip: true },
    { name: 'sign_arrow', at: 'lastCorner+34', lat: 14, rot: 180, flip: true },
  ],
  scatter: [
    {
      // orchard
      props: [{ name: 'tree_apple', scale: [0.9, 1.15] }], density: 5.5, solid: 0.35, seed: 11,
      bands: [[4.5, 60, 1]],
      regions: [{ at: XZ(122, 40), radius: 40 }, { at: XZ(70, 28), radius: 18 }, { at: XZ(128, -2), radius: 22 }],
    },
    {
      // woods beyond the boundary, thinner near the road
      props: [{ name: 'tree_oak', weight: 2, scale: [0.9, 1.3] }, { name: 'tree_birch', weight: 1.2, scale: [0.9, 1.25] }], density: 3.6, solid: 0.45, seed: 23,
      bands: [[10, 26, 0.25], [26, 99, 1]], maxSlope: 0.9,
      exclude: [{ at: XZ(50, -60), radius: 42 }, { at: XZ(-36, 42), radius: 22 }],
    },
    {
      props: [{ name: 'bush', weight: 3 }, { name: 'tree_birch', weight: 0.4 }], density: 3.2, seed: 37,
      bands: [[3.5, 20, 1], [20, 99, 0.35]], exclude: [{ at: XZ(50, -60), radius: 38 }],
    },
    {
      props: [{ name: 'grass_tuft', scale: [0.8, 1.5] }], density: 16, seed: 41,
      bands: [[2.8, 30, 1], [30, 99, 0.3]], exclude: [{ at: XZ(50, -60), radius: 36 }],
    },
    {
      props: [{ name: 'flower_patch', scale: [0.8, 1.3] }], density: 3.2, seed: 53,
      bands: [[3, 30, 1]], exclude: [{ at: XZ(50, -60), radius: 38 }],
    },
    {
      props: [{ name: 'rock_a', weight: 1, scale: [0.6, 1.2] }, { name: 'rock_b', weight: 1.5, scale: [0.6, 1.3] }], density: 0.7, solid: 0.6, seed: 61,
      bands: [[6, 99, 1]],
    },
  ],
  hazards: [
    { type: 'sheepHerd', tag: 'sheep', at: 'pasture+4', count: 7, period: 10, side: -1 },
    { type: 'sheepHerd', tag: 'sheep', at: 'bridge+36', count: 5, period: 9, side: 1 },
    { type: 'hayRoll', tag: 'hay', at: 'downhill-6', to: 'downhill+26', period: 2.1, side: 1 },
  ],
  lapEvents: [
    { lap: 2, name: 'sheepHerd', enable: ['sheep'], disable: ['sheepGrazing'], at: 'pasture' },
    { lap: 3, name: 'barnOpen', enable: ['barn'], disable: ['barnDoors'], at: 'lastCorner' },
    { lap: 3, name: 'hayRoll', enable: ['hay'], at: 'downhill' },
  ],
};
