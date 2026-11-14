// Track 2: Bambus-Tempel. A misty bamboo forest on a mountainside with an old temple at its foot.
// Technical and narrow, with real height differences (about 24 m).
//
// Map coordinates: e = east, n = north (metres). World: x = -e, z = n (as in Kleeblatt-Tal).
// Driving order (clockwise seen from above):
//   Act 1  start in the temple forecourt under the torii -> climb through dense bamboo with tight
//          linked corners (risky dirt trail through the bamboo cuts the S) -> cliff-side ledge
//          with a low stone wall and the view over the misty valley.
//   Act 2  long plank bridge over the gorge (waterfall to the left) -> fast downhill with two
//          banked hairpins (drift!) -> jump off the stone terraces.
//   Act 3  valley floor past the lantern pond -> around the temple compound -> start.
// Lap 2: rain sets in, the plank bridge starts to break (script: src/track/scripts/bambus.ts).
// Lap 3: the temple gate opens a route through the inner courtyard (swinging lantern inside),
//        bamboo logs roll across the second downhill leg.
import type { ControlPoint, EdgeDef, PropPlacement, TrackDef, Vec2 } from '../format';
import { BAMBUS_BRIDGE, BAMBUS_SCALE, bambusScript } from '../scripts/bambus';

const S = BAMBUS_SCALE;
/** Anchor + offset as a Progress string. */
const A = (anchor: string, d: number): string => (d < 0 ? `${anchor}${d}` : `${anchor}+${d}`);
const XZ = (e: number, n: number): Vec2 => [-e * S, n * S];
const P = (e: number, n: number, y: number, o: Omit<ControlPoint, 'p'> = {}): ControlPoint => ({ p: [-e * S, y, n * S], ...o });
const wall = (offset = 1.0, height?: number, catchHeight?: number): EdgeDef => ({ kind: 'wall', offset, height, catchHeight });
const fence = (offset = 1.4): EdgeDef => ({ kind: 'fence', offset });
const rail = (offset = 0.8): EdgeDef => ({ kind: 'rail', offset });

/** Arching bamboo on both sides of a stretch (closes into a green tunnel), deterministic jitter. */
function bambooTunnel(anchor: string, from: number, to: number, step: number, lat: number, seed: number): PropPlacement[] {
  const out: PropPlacement[] = [];
  let k = seed;
  const rnd = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  for (let d = from; d <= to; d += step) {
    for (const side of [-1, 1]) {
      const j = (rnd() - 0.5) * step * 0.6;
      out.push({ name: 'bamboo_arch', at: A(anchor, Math.round(d + j)), lat: side * (lat + rnd() * 2), rot: side > 0 ? 90 + (rnd() - 0.5) * 30 : -90 + (rnd() - 0.5) * 30, scale: 0.85 + rnd() * 0.35 });
    }
  }
  return out;
}

/** Mossy boulders on the gorge rims and on its floor (breaks up the steep walls). World coordinates. */
function gorgeRocks(): PropPlacement[] {
  const out: PropPlacement[] = [];
  const cx = -250 * S;
  let k = 7;
  const rnd = () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
  for (let z = 186; z < 274; z += 7) {
    const nearBridge = z > 200 && z < 226;
    for (const side of [-1, 1]) {
      if (!nearBridge) out.push({ name: rnd() < 0.6 ? 'bamboo_rock_a' : 'bamboo_rock_b', pos: [cx + side * (26 + rnd() * 3), z + rnd() * 4], rot: rnd() * 360, scale: 1.4 + rnd() * 1.4 });
      out.push({ name: 'bamboo_rock_a', pos: [cx + side * (13 + rnd() * 4), z + rnd() * 4], rot: rnd() * 360, scale: 1.0 + rnd() * 1.3 });
    }
  }
  return out;
}

const SCATTER_EXCLUDE = [
  { at: XZ(0, 10), radius: 40 }, { at: XZ(40, -40), radius: 42 }, { at: XZ(250, 205), radius: 30 }, { at: XZ(152, 42), radius: 20 },
  { at: XZ(-30, 30), radius: 9 }, { at: XZ(182, 60), radius: 9 },
];

export const bambusTempel: TrackDef = {
  id: 'bambus',
  name: 'Bambus-Tempel',
  laps: 3,
  cup: 0,
  order: 1,
  theme: 'bamboo',
  script: bambusScript,
  music: 'bambus',
  environment: {
    hdr: 'meadow_day',
    skyTop: '#93aab0',
    skyHorizon: '#e2e6d9',
    sunDir: [-0.7385, 0.3746, -0.5605],
    sunColor: '#ffdcae',
    sunIntensity: 2.5,
    ambientIntensity: 0.7,
    fogColor: '#c6d2c8',
    fogDensity: 0.0052,
    weather: 'pollen',
    exposure: 0.95,
  },
  width: 7,
  main: [
    // --- Act 1: forecourt, bamboo climb, ledge ------------------------------------------
    P(0, 0, 4.0, { name: 'start', w: 7.5, bank: 0, left: wall(3, 1.5), right: wall(3, 1.5), shoulder: 2.5 }),
    P(0, 30, 4.2),
    P(0, 56, 4.8, { name: 'forecourtEnd' }),
    P(5, 80, 6.0, { w: 7, bank: 7, left: fence(1.4), right: fence(1.4) }),
    P(21, 96, 7.5),
    P(43, 103, 9.0, { name: 'bamboo', bank: 0 }),
    P(61, 111, 10.6, { bank: -9 }),
    P(70, 127, 12.0, { w: 6.5 }),
    P(72, 145, 13.4, { bank: 0, name: 'bambooS' }),
    P(80, 161, 14.8, { bank: 9 }),
    P(96, 172, 16.2),
    P(114, 177, 17.6, { bank: 0, w: 6.5 }),
    P(134, 186, 19.0, { bank: -4 }),
    P(152, 194, 20.4, { name: 'ledge', bank: 0, w: 6.5, left: wall(1.2, 2.2), right: wall(0.8, 0.75) }),
    P(176, 198, 22.2),
    P(200, 199, 23.8, { name: 'ledgeEnd', bank: 0 }),
    // --- Act 2: bridge, downhill, terraces ------------------------------------------------
    P(222, 199, 24.8, { w: 6, bank: 0, left: rail(), right: rail() }),
    P(250, 199, 25.0, { name: 'bridge', bank: 0 }),
    P(278, 199, 24.8, { bank: 0 }),
    P(296, 196, 24.4, { w: 6.5, bank: 6 }),
    P(311, 186, 23.7, { bank: 10 }),
    P(318, 168, 22.6, { name: 'downhill', bank: 2 }),
    P(318, 147, 21.2, { bank: 6, w: 7 }),
    P(309, 129, 19.8, { bank: 9 }),
    P(291, 118, 18.6, { bank: 0, name: 'leg1' }),
    P(268, 115.5, 17.6, { w: 7.5, bank: -6 }),
    P(250, 115, 17.0, { name: 'hairpin1', bank: -11 }),
    P(235.5, 109, 16.5, { bank: -12 }),
    P(229.5, 94.5, 15.8, { bank: -12 }),
    P(235.5, 80, 15.1, { bank: -11 }),
    P(250, 74, 14.5, { bank: -6 }),
    P(270, 74, 13.6, { bank: 0, name: 'leg2', w: 7 }),
    P(286, 74.5, 13.0, { bank: 6 }),
    P(300, 74.5, 12.5, { name: 'hairpin2', bank: 11, w: 7.5 }),
    P(314.1, 68.6, 12.1, { bank: 12 }),
    P(320, 54.5, 11.6, { bank: 12 }),
    P(314.1, 40.4, 11.1, { bank: 11 }),
    P(299, 34.5, 10.6, { bank: 4, name: 'leg3', w: 7 }),
    P(285, 34.3, 10.2, { bank: 0, left: wall(1.5, 1.1, 3), right: wall(1.5, 1.1, 3), name: 'terrace' }),
    P(262, 34, 8.6),
    P(236, 34, 6.4, { name: 'landing' }),
    // --- Act 3: valley floor, pond, temple ------------------------------------------------
    P(210, 32, 4.8, { bank: 0, w: 7, left: fence(2), right: fence(2) }),
    P(184, 27, 4.1, { bank: -3 }),
    P(158, 18, 3.8, { name: 'pond', bank: 0 }),
    P(133, 6, 3.6, { bank: 2 }),
    P(110, -8, 3.5),
    P(90, -26, 3.5, { name: 'templeApproach', bank: 4 }),
    P(72, -48, 3.5, { bank: 5, left: wall(3, 1.6), right: fence(0.6) }),
    P(48, -64, 3.4, { bank: 4 }),
    P(23, -71, 3.4, { name: 'lastCorner', bank: 7 }),
    P(4, -63, 3.5, { bank: 7, w: 7.5 }),
    P(-1, -44, 3.7, { bank: 0, left: wall(3, 1.5), right: wall(3, 1.5) }),
    P(0, -22, 3.9),
  ],
  branches: [
    {
      // Risky dirt trail straight through the bamboo, cutting the S-bends. Offroad: pays off with a boost.
      id: 'trail', from: 'bamboo-6', to: 'bambooS+40', w: 3.6, risk: 0.6, needsBoost: true,
      points: [
        P(52, 115, 9.6, { surface: 'offroad', look: 'dirt', left: 'none', right: 'none', shoulder: 1 }),
        P(62, 134, 11.4),
        P(73, 156, 13.2),
      ],
    },
    {
      // Lap 3: through the temple gate and the inner courtyard, cutting the last corner.
      id: 'temple', from: 'templeApproach+6', to: 'start-6', w: 4.6, risk: 0.35, tag: 'temple', enabled: false,
      points: [
        P(74, -38, 3.6, { surface: 'road', look: 'gravel', left: 'none', right: wall(0.7, 1.3), shoulder: 1.2 }),
        P(64, -36.7, 3.65, { left: wall(1.2, 1.3) }),
        P(62, -36.5, 3.7, { left: 'none', right: 'none' }),
        P(40, -35, 3.8, { name: 'courtyard' }),
        P(25, -34.4, 3.85, { left: wall(0.7, 1.3), right: wall(0.7, 1.3) }),
        P(15, -31.5, 3.9),
        P(7.5, -22, 3.95),
      ],
    },
  ],
  decks: [
    { from: BAMBUS_BRIDGE.from, to: BAMBUS_BRIDGE.to, style: 'wood', model: 'bamboo_bridge' },
  ],
  structures: [
    { type: 'barn', path: 'temple', at: 'courtyard', length: 30, width: 12, height: 9, doorsTag: 'templeDoors', model: 'bamboo_temple', doors: 'entry' },
  ],
  ramps: [{ at: 'terrace-4', length: 6, height: 1.1, width: 11, trick: 26 }],
  boostPads: [
    { at: 'ledge-36', lat: 1.5, width: 3.6 },
    { at: 'hairpin1+52', lat: -1.5, width: 3.6 },
    { at: 'leg3+2', lat: 0, width: 3.6 },
    { at: 'lastCorner+40', lat: -2.6, width: 3.6 },
  ],
  itemRows: [
    { at: 'start+44' },
    { at: 'ledge-14', count: 3 },
    { at: 'downhill+6', count: 3 },
    { at: 'pond+10' },
  ],
  respawn: [
    { from: 'bridge-34', to: 'bridge+34', at: 'bridge-40' },
    { from: 'terrace-6', to: 'landing+6', at: 'terrace-14' },
  ],
  grid: { first: 8, rowGap: 4.2, lat: 2.6 },
  terrain: {
    cell: 3,
    margin: 90,
    base: 2.2,
    tilt: [0, 0.095],
    hills: [
      { at: XZ(40, -40), radius: 110, height: 5.5 }, // temple plateau
      { at: XZ(150, 300), radius: 170, height: 26 }, // mountain above the ledge
      { at: XZ(330, 270), radius: 120, height: 18 },
      { at: XZ(-60, 200), radius: 120, height: 16 },
      { at: XZ(300, 150), radius: 60, height: 6 }, // downhill shoulder
      { at: XZ(230, -60), radius: 110, height: 6 },
      { at: XZ(185, 140), radius: 46, height: -12 }, // hollow below the ledge
      { at: XZ(188, 168), radius: 34, height: -18, sx: 1.7 }, // the drop on the ledge's right
      { at: XZ(285, 100), radius: 75, height: 5 }, // switchback slope
    ],
    noise: { amp: 1.4, scale: 30 },
    rim: { center: XZ(150, 80), radius: 260, width: 200, height: 45 },
    brooks: [
      // the gorge under the bridge: steep walls, a river at the bottom fed by the waterfall
      {
        width: 12, depth: 1.6, bank: 16,
        points: [
          [...XZ(250, 256), -1.6], [...XZ(246.5, 246), -1.7], [...XZ(253, 236), -1.75], [...XZ(247.5, 226), -1.8], [...XZ(252.5, 214), -1.9],
          [...XZ(249, 200), -2.0], [...XZ(253.5, 188), -2.05], [...XZ(247.5, 178), -2.1], [...XZ(250, 170), -2.2],
        ],
      },
    ],
    ponds: [{ at: XZ(152, 42), radius: 12, level: 2.7, depth: 1.5, bank: 5 }],
    patches: [
      { at: XZ(40, -35), size: [44, 26], surface: 'offroad', look: 'gravel' }, // inner courtyard
      { at: XZ(0, 20), size: [30, 60], surface: 'offroad', look: 'gravel' }, // forecourt
    ],
  },
  props: [
    // temple forecourt: two torii, stone lanterns behind the walls, pagodas on the slopes
    { name: 'bamboo_torii', at: 'start+4', lat: 0 },
    { name: 'bamboo_torii', at: 'forecourtEnd-8', lat: 0 },
    ...[-36, -20, 16, 30, 44].flatMap((d) => [-1, 1].map((sd) => ({ name: 'bamboo_lantern_stone', at: A('start', d), lat: sd * 12.6, solid: 0.5 }))),
    { name: 'bamboo_pagoda', pos: XZ(-30, 30), rot: 20, solid: [8.6, 8.6] as Vec2, solidHeight: 10 },
    { name: 'bamboo_pagoda', pos: XZ(182, 60), rot: -15, scale: 1.15, solid: [9.5, 9.5] as Vec2, solidHeight: 10 },
    { name: 'bamboo_lantern_paper', at: 'forecourtEnd+4', lat: -10.5, rot: 90 },
    { name: 'bamboo_lantern_paper', at: 'forecourtEnd+4', lat: 10.5, rot: -90 },
    // paper lanterns along the bamboo climb (alternating sides, outside the fences)
    ...[0, 26, 52, 78, 104, 130].map((d, i) => ({ name: 'bamboo_lantern_paper', at: A('bamboo', d - 10), lat: (i % 2 ? 1 : -1) * 10, rot: i % 2 ? -90 : 90 })),
    ...bambooTunnel('bamboo', -10, 160, 7, 11, 11),
    ...bambooTunnel('downhill', -20, 60, 8, 11.5, 23),
    ...bambooTunnel('leg1', 0, 30, 8, 11.5, 29),
    ...bambooTunnel('leg2', -18, 22, 8, 11.5, 31),
    // ledge: boulders against the cliff, lanterns at the bridge head
    ...[[-14, 2.4], [8, 2.8], [30, 2.2], [48, 3.0]].map(([d, sc]) => ({ name: 'bamboo_rock_a', at: A('ledge', d), lat: -12.5, scale: sc })),
    { name: 'bamboo_lantern_stone', at: 'bridge-34', lat: -9, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'bridge-34', lat: 9, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'bridge+34', lat: -9, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'bridge+34', lat: 9, solid: 0.5 },
    ...gorgeRocks(),
    // chevrons: right-hander after the bridge, both hairpins
    { name: 'sign_arrow', at: 'downhill-34', lat: -10.5, rot: 180 },
    { name: 'sign_arrow', at: 'downhill-20', lat: -10.5, rot: 180 },
    ...[-10, 4, 18, 32].map((d) => ({ name: 'sign_arrow', at: A('hairpin1', d + 10), lat: 11, rot: 180, flip: true })),
    ...[-10, 4, 18, 32].map((d) => ({ name: 'sign_arrow', at: A('hairpin2', d + 10), lat: -11, rot: 180 })),
    // terraces: lanterns at the jump, mossy rocks below
    { name: 'bamboo_lantern_stone', at: 'terrace-6', lat: -10, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'terrace-6', lat: 10, solid: 0.5 },
    { name: 'bamboo_lantern_paper', at: 'landing+14', lat: -10.5, rot: 90 },
    { name: 'bamboo_lantern_paper', at: 'landing+14', lat: 10.5, rot: -90 },
    // lantern pond: stepping stones with stone lanterns
    ...([[141, 37], [146, 40], [151, 42.5], [156, 45], [161, 47]] as Vec2[]).map((q, i) => ({ name: 'bamboo_rock_b', pos: XZ(q[0], q[1]), y: 1.65, rot: i * 47, scale: 1.6 })),
    { name: 'bamboo_lantern_stone', pos: XZ(146, 40), y: 2.95, scale: 0.8 },
    { name: 'bamboo_lantern_stone', pos: XZ(156, 45), y: 2.95, scale: 0.8 },
    { name: 'bamboo_lantern_stone', at: 'pond-6', lat: 10, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'pond+18', lat: 10, solid: 0.5 },
    // temple grounds
    { name: 'bamboo_lantern_stone', at: 'templeApproach-10', lat: -10, solid: 0.5 },
    { name: 'bamboo_lantern_stone', at: 'templeApproach+20', lat: -11, solid: 0.5 },
    { name: 'bamboo_lantern_paper', at: 'lastCorner-10', lat: -11, rot: 90 },
    { name: 'bamboo_lantern_paper', at: 'lastCorner+16', lat: -11, rot: 90 },
    // stone lanterns guarding the corners of the temple gate
    { name: 'bamboo_lantern_stone', path: 'temple', at: 'courtyard-16.2', lat: -6.9, solid: 0.7, solidHeight: 3 },
    { name: 'bamboo_lantern_stone', path: 'temple', at: 'courtyard-16.2', lat: 6.9, solid: 0.7, solidHeight: 3 },
    // stone lanterns closing the gaps where the temple route's walls meet the start straight
    { name: 'bamboo_lantern_stone', at: 'start-36', lat: 10.9, solid: 1.1, solidHeight: 3 },
    { name: 'bamboo_lantern_stone', at: 'start-17', lat: 10.9, solid: 1.3, solidHeight: 3 },
  ],
  scatter: [
    {
      // dense bamboo walls close to the road (solid trunks)
      props: [{ name: 'bamboo_clump', scale: [0.85, 1.25] }],
      density: 6, solid: 0.55, seed: 7, bands: [[5, 15, 1]], maxSlope: 0.95, exclude: SCATTER_EXCLUDE,
    },
    {
      // the forest beyond (thinned by quality, lod1 in the distance)
      props: [{ name: 'bamboo_clump', weight: 3, scale: [0.9, 1.3] }, { name: 'bamboo_stalks', weight: 2, scale: [0.9, 1.3] }],
      density: 6.5, seed: 9, bands: [[15, 45, 1], [45, 99, 0.55]], maxSlope: 0.95, exclude: SCATTER_EXCLUDE,
    },
    {
      props: [{ name: 'bamboo_stalks', scale: [0.7, 1.1] }], density: 9, seed: 13, bands: [[3, 14, 1]], maxSlope: 0.95, exclude: SCATTER_EXCLUDE,
    },
    {
      props: [{ name: 'bamboo_fern', scale: [0.8, 1.4] }], density: 18, seed: 19, bands: [[2.8, 30, 1], [30, 99, 0.3]],
      exclude: [{ at: XZ(40, -40), radius: 30 }],
    },
    {
      props: [{ name: 'bamboo_rock_a', weight: 1, scale: [0.6, 1.3] }, { name: 'bamboo_rock_b', weight: 1.5, scale: [0.6, 1.4] }], density: 0.7, solid: 0.6, seed: 31,
      bands: [[6, 99, 1]],
    },
    {
      props: [{ name: 'bamboo_maple', scale: [0.85, 1.15] }], density: 0.7, solid: 0.4, seed: 43, bands: [[6, 60, 1]],
      regions: [{ at: XZ(150, 30), radius: 70 }, { at: XZ(40, -40), radius: 80 }, { at: XZ(0, 40), radius: 45 }],
    },
  ],
  lapEvents: [
    { lap: 2, name: 'rain', at: 'bridge' },
    { lap: 3, name: 'templeOpen', enable: ['temple'], disable: ['templeDoors'], at: 'templeApproach' },
  ],
};
