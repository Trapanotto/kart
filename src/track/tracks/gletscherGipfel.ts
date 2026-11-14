// Track 4: Gletscher-Gipfel, the cup finale. A high alpine glacier above a sea of clouds.
//
// Map coordinates: e = east, n = north (metres). World: x = -e, z = n, so a right turn on the map
// is a right turn in the game. The loop runs clockwise around the glacier peak:
//   Act 1  summit station (cable car, flags) -> fast banked descent on packed snow -> boost straight
//          -> big jump over a crevasse (snow bridge, trick zone).
//   Act 2  glacier tunnel: glowing blue ice walls, slippery ice S-bend -> out onto the ridge with drops
//          on both sides -> banked right-hander down to the frozen lake.
//   Act 3  lake shore road -> the hard climb back through the pine forest: two switchback hairpins
//          -> sweeping right-hander onto the summit straight.
// Lap 2: the ice cave cracks open (falling icicles, a hole in the tunnel wall opens a straighter line).
// Lap 3: an avalanche buries the lake shore road; the detour runs across the frozen lake.
import type { ControlPoint, EdgeDef, TrackDef, Vec2 } from '../format';
import { gletscherScript } from '../scripts/gletscher';

const XZ = (e: number, n: number): Vec2 => [-e, n];
const P = (e: number, n: number, y: number, o: Omit<ControlPoint, 'p'> = {}): ControlPoint => ({ p: [-e, y, n], ...o });
// every barrier gets an invisible catch extension: tumbling karts must not be thrown over a rail
const open = (reach = 20): EdgeDef => ({ kind: 'open', reach, catchHeight: 2 });
/**
 * Points on a circular arc around (ce, cn), angles in degrees from north, clockwise (dir 1 = right
 * turn) or counter-clockwise (dir -1 = left turn). Height eases from y0 to y1; the middle point gets `name`.
 */
function arc(ce: number, cn: number, r: number, a0: number, a1: number, n: number, y0: number, y1: number, o: Omit<ControlPoint, 'p'>, name?: string, dir: 1 | -1 = 1): ControlPoint[] {
  const out: ControlPoint[] = [];
  let span = a1 - a0;
  if (dir < 0 && span > 0) span -= 360;
  for (let k = 0; k <= n; k++) {
    const a = ((a0 + (span * k) / n) * Math.PI) / 180;
    const y = y0 + (y1 - y0) * (k / n);
    out.push(P(ce + r * Math.sin(a), cn + r * Math.cos(a), y, k === 0 ? o : k === n / 2 && name ? { name } : {}));
  }
  return out;
}
const rail = (offset = 0.6, catchHeight = 2): EdgeDef => ({ kind: 'rail', offset, catchHeight });

export const gletscherGipfel: TrackDef = {
  id: 'gletscher',
  name: 'Gletscher-Gipfel',
  laps: 3,
  cup: 0,
  order: 3,
  theme: 'glacier',
  script: gletscherScript,
  environment: {
    hdr: 'glacier_day',
    skyTop: '#2f7fd8',
    skyHorizon: '#d6e8f7',
    // the sun of the CC0 HDRI 'Horn-koppe Snow' (28 degrees up), measured from the file
    sunDir: [0.712, 0.474, 0.518],
    sunColor: '#fff1dc',
    sunIntensity: 2.9,
    ambientIntensity: 0.5,
    fogColor: '#dbe8f4',
    fogDensity: 0.0007,
    weather: 'snow',
    exposure: 0.85,
  },
  music: 'gletscher',
  width: 9,
  main: [
    // --- Act 1: summit and descent ------------------------------------------------
    P(40, 0, 40, { name: 'start', w: 9.5, bank: 0, left: { kind: 'fence', offset: 3 }, right: { kind: 'fence', offset: 3 } }),
    P(62, 0, 40),
    P(84, -2, 39.4, { name: 'summitEnd', right: 'none', left: open(18) }),
    P(108, -10, 38.2, { bank: 6 }),
    P(128, -26, 36.8, { name: 'sweeper', bank: 8 }),
    P(141, -48, 35.2, { bank: 8 }),
    P(146, -72, 33.6, { bank: 4, w: 9 }),
    P(143, -96, 32.0, { name: 'flowLeft', bank: -6 }),
    P(147, -120, 30.4, { bank: -3 }),
    P(156, -142, 29.0, { bank: 3 }),
    P(158, -168, 28.4, { bank: 0 }),
    P(158, -194, 27.8, { name: 'boostStraight', bank: 0, w: 9.5, left: { kind: 'fence', offset: 2.5, catchHeight: 6 }, right: { kind: 'fence', offset: 2.5, catchHeight: 6 } }),
    P(158, -220, 26.6, { name: 'ramp' }),
    P(158, -244, 25.4, { name: 'crevasse' }),
    P(158, -268, 24.2),
    P(157, -292, 23.0, { name: 'landing', left: open(16), right: open(16) }),
    // --- Act 2: glacier tunnel, ridge, down to the lake --------------------------------
    P(154, -314, 22.0, { name: 'caveIn', w: 8.5, bank: 0, surface: 'ice', look: 'gravel', left: { kind: 'wall', offset: 0.8, height: 4.5 }, right: { kind: 'wall', offset: 0.8, height: 4.5 } }),
    P(156, -333, 21.4, { bank: -3 }),
    P(160, -352, 20.8, { name: 'caveS', bank: -4 }),
    P(158, -372, 20.0, { bank: 2 }),
    P(147, -390, 19.2, { bank: 6 }),
    P(129, -402, 18.4, { bank: 7 }),
    P(107, -408, 17.6, { bank: 3 }),
    P(84, -410, 16.9, { name: 'caveOut', bank: 0, w: 9, surface: 'road', look: 'asphalt', left: rail(0.6), right: rail(0.6) }),
    P(58, -411, 16.2, { name: 'ridge', bank: 0, left: rail(0.6), right: rail(0.6) }),
    P(34, -407, 15.6, { bank: -3, left: open(3.5) }),
    P(10, -402, 15.0, { name: 'ridgeMid', bank: 0, right: open(3.5) }),
    P(-14, -405, 14.2, { bank: 3, left: rail(0.6) }),
    P(-38, -414, 13.2, { name: 'ridgeEnd', right: rail(0.6) }),
    P(-62, -416, 12.0, { name: 'lakeTurn', bank: 7, w: 9 }),
    P(-88, -406, 10.0, { bank: 8, left: open(14), right: 'none' }),
    P(-106, -386, 7.6, { bank: 7 }),
    P(-114, -360, 5.2, { name: 'lakeTurnExit', bank: 2 }),
    // --- Act 3: lake shore, switchback climb, summit -----------------------------------------
    P(-116, -334, 3.8, { name: 'shore', bank: 0, w: 9.5, left: open(10), right: open(18) }),
    P(-117, -306, 3.2),
    P(-117, -278, 2.9),
    P(-117, -250, 2.9, { name: 'avalanche' }),
    P(-117, -222, 3.2),
    P(-117, -196, 4.0, { name: 'shoreEnd', right: rail(0.8) }),
    P(-118, -170, 5.4, { name: 'climb', w: 9 }),
    P(-118, -150, 6.8, { bank: 4, left: { kind: 'fence', offset: 1.6, catchHeight: 2.5 } }),
    // hairpin 1: right, R 20, round the forest knoll
    ...arc(-98, -135, 20, 270, 450, 6, 7.8, 11.6, { w: 8.5, bank: 8, left: { kind: 'fence', offset: 1.6, catchHeight: 2.5 } }, 'hairpin1'),
    P(-78, -158, 13.0, { name: 'hairpin1Exit', bank: 2, w: 9, left: open(12) }),
    P(-78, -180, 15.4, { bank: 0 }),
    P(-78, -200, 17.4, { bank: -3 }),
    // hairpin 2: left, R 20.5
    ...arc(-57.5, -215, 20.5, 270, 90, 6, 18.4, 21.8, { w: 8.5, bank: -8, right: { kind: 'fence', offset: 1.6, catchHeight: 2.5 }, left: 'none' }, 'hairpin2', -1),
    P(-37, -192, 23.2, { name: 'hairpin2Exit', bank: -2, w: 9, right: 'none', left: open(12) }),
    P(-36, -166, 25.6, { bank: 0 }),
    P(-35, -138, 28.2, { name: 'forest' }),
    P(-34, -110, 30.8),
    P(-32, -82, 33.4),
    P(-28, -54, 35.8, { name: 'finalTurn', bank: 6, w: 9.5 }),
    P(-16, -26, 38.2, { bank: 8, right: open(16) }),
    P(4, -5, 39.7, { name: 'summit', bank: 3 }),
    P(20, 0, 40, { bank: 0, left: { kind: 'fence', offset: 3 }, right: { kind: 'fence', offset: 3 } }),
  ],
  branches: [
    {
      // Risky cut through the deep-snow gully inside the first sweeper: only pays off with a boost.
      id: 'gully', from: 'summitEnd-8', to: 'flowLeft-4', w: 4.8, risk: 0.6, needsBoost: true,
      points: [
        P(96, -22, 37.0, { surface: 'offroad', look: 'dirt', left: 'none', right: 'none', shoulder: 1 }),
        P(112, -42, 35.6),
        P(125, -62, 34.2),
      ],
    },
    {
      // Lap 2: the tunnel wall breaks and a straight crack through the glacier opens.
      id: 'caveHole', from: 'caveIn+6', to: 'caveOut-16', w: 5.5, risk: 0.25, tag: 'caveHole', enabled: false,
      points: [
        P(146, -344, 20.9, { surface: 'ice', look: 'gravel', left: { kind: 'wall', offset: 0.6, height: 3.5 }, right: { kind: 'wall', offset: 0.6, height: 3.5 }, shoulder: 1 }),
        P(133, -368, 19.8, { name: 'crack' }),
        P(117, -392, 18.6),
      ],
    },
    {
      // Lap 3: the avalanche buries the shore road, everybody crosses the frozen lake. Gain is set
      // high on purpose: once it is open the main road is blocked, so the AI must always take it.
      id: 'lakeDetour', from: 'shore-2', to: 'climb+4', w: 8.5, risk: 0, gain: 6, tag: 'lakeDetour', enabled: false,
      points: [
        P(-138, -318, 2.4, { surface: 'ice', look: 'gravel', left: open(6), right: open(10), shoulder: 2 }),
        P(-155, -298, 1.6, { w: 11 }),
        P(-167, -270, 1.2, { name: 'lakeMid' }),
        P(-168, -242, 1.2),
        P(-158, -214, 1.8),
        P(-140, -188, 3.4, { w: 8.5 }),
      ],
    },
  ],
  decks: [{ from: 'crevasse-11', to: 'crevasse+11', style: 'stone', rails: true, model: 'glacier_snowbridge' }],
  ramps: [{ at: 'ramp-6', length: 6, height: 1.6, width: 12, trick: 36 }],
  boostPads: [
    { at: 'boostStraight-6', lat: 0, width: 4 },
    { at: 'hairpin1Exit+6', lat: -2, width: 4 },
    { at: 'hairpin2Exit+6', lat: 2, width: 4 },
  ],
  itemRows: [
    { at: 'start+60' },
    { at: 'flowLeft+10' },
    { at: 'ridge+10' },
    { at: 'climb+6' },
  ],
  patches: [
    // cracked thin ice on the lake detour: slows like water, steer round it
    { path: 'lakeDetour', from: 'lakeMid-34', to: 'lakeMid-25', latMin: 1.5, latMax: 7.5, surface: 'water' },
    { path: 'lakeDetour', from: 'lakeMid+4', to: 'lakeMid+13', latMin: -8.5, latMax: -2.5, surface: 'water' },
    { path: 'lakeDetour', from: 'lakeMid+40', to: 'lakeMid+48', latMin: 0.5, latMax: 6.5, surface: 'water' },
  ],
  respawn: [{ from: 'ramp-8', to: 'crevasse+30', at: 'ramp-24' }],
  grid: { first: 8, rowGap: 4.2, lat: 2.8 },
  terrain: {
    cell: 3,
    margin: 90,
    base: 37,
    tilt: [-0.075, 0.1],
    hills: [
      { at: XZ(40, -190), radius: 120, height: 40, sx: 1.1, sz: 1.3 }, // glacier peak in the middle of the loop
      { at: XZ(135, -320), radius: 34, height: 14, sx: 1.6, sz: 1 }, // glacier tongue the tunnel runs through
      { at: XZ(15, -330), radius: 34, height: -10, sx: 2.2, sz: 0.7 }, // basin inside the ridge
      { at: XZ(-178, -268), radius: 62, height: -9 }, // lake basin
      { at: XZ(158, -214), radius: 7, height: -16, sx: 6, sz: 1 }, // crevasse trench
    ],
    noise: { amp: 2.2, scale: 42 },
    patches: [{ at: XZ(-178, -268), radius: 48, surface: 'ice' }],
  },
  props: [
    { name: 'start_gate', at: 'start', lat: 0, rot: 0 },
    // tunnel wall where the lap-2 crack opens (entry and exit of the 'caveHole' line)
    // (props seat on the lowest ground under their footprint: dy lifts these back to road level;
    // tests/track.gletscher.test.ts checks that the colliders stand on the road)
    ...([['caveIn+12', 0.41], ['caveIn+22', 0.61], ['caveIn+32', 0.76], ['caveOut-43', 1.43], ['caveOut-33', 1.55], ['caveOut-23', 2.38]] as const).map(([at, dy]) => (
      { name: 'glacier_seal', at, lat: 9.9, dy, solid: [1.2, 10.4] as Vec2, solidHeight: 5, tag: 'caveSeal' })),
    // ice blocks closing the slots between the tunnel wall and the crack's outer wall (never toggled;
    // tagged only so they get their own collider)
    { name: 'glacier_iceblock', pos: XZ(145, -327.7), rot: 174, solid: [1.6, 9.5] as Vec2, solidHeight: 5, tag: 'caveCloser' },
    { name: 'glacier_iceblock', pos: XZ(103.7, -397.3), rot: 126, dy: 1.3, solid: [1.6, 7.5] as Vec2, solidHeight: 5, tag: 'caveCloser' },
    // lap 3: the avalanche pile across the shore road (hidden until it lands)
    { name: 'glacier_snowpile', at: 'avalanche', lat: 0, dy: 6.28, solid: [27, 12] as Vec2, solidHeight: 5, tag: 'avalanchePile', enabled: false },
    // summit: cable car station inside the loop (cable leaves to the south, up to the glacier peak)
    { name: 'glacier_station', pos: XZ(45, -27), rot: 0, solid: [14, 11] as Vec2, solidHeight: 9 },
    { name: 'glacier_pylon', pos: XZ(45, -78), rot: 0, solid: 1.8, solidHeight: 6 },
    { name: 'glacier_pylon', pos: XZ(44, -124), rot: 0 },
    { name: 'glacier_pylon', pos: XZ(42, -164), rot: 0 },
    { name: 'glacier_station', pos: XZ(40, -200), rot: 180, scale: 0.75 },
    { name: 'glacier_snowman', pos: XZ(18, 15), rot: 200 },
    { name: 'glacier_snowman', pos: XZ(70, 14), rot: 160, scale: 0.85 },
    { name: 'glacier_hut', pos: XZ(100, 22), rot: 200, dy: 1.8, solid: [8, 7] as Vec2 },
    { name: 'glacier_rock', pos: XZ(66, 20), rot: 30, scale: 1.2, solid: 1.6 },
    // slalom flags down the descent (red left, blue right), chevrons in the sweeper
    ...[10, 30, 50, 70, 90, 110, 130, 150, 170, 190].map((d, i) => ({ name: i % 2 ? 'glacier_flag_b' : 'glacier_flag_r', at: `summitEnd+${d}`, lat: (i % 2 ? 1 : -1) * 12.5, rot: 180 })),
    { name: 'sign_arrow', at: 'sweeper-10', lat: -13, rot: 180 },
    { name: 'sign_arrow', at: 'sweeper+10', lat: -13, rot: 180 },
    // glacier tunnel portals: seracs and crystals
    { name: 'glacier_serac', at: 'caveIn-6', lat: -16, rot: 20, scale: 1.3 },
    { name: 'glacier_serac', at: 'caveIn-4', lat: 18, rot: -30, scale: 1.1 },
    { name: 'glacier_crystal', at: 'caveIn-14', lat: -13, rot: 40 },
    { name: 'glacier_crystal', at: 'caveIn-12', lat: 13.5, rot: 120, scale: 0.8 },
    { name: 'glacier_serac', at: 'caveOut+6', lat: -15, rot: 70, scale: 1.2 },
    { name: 'glacier_crystal', at: 'caveOut+14', lat: -12.5, rot: 10, scale: 1.1 },
    { name: 'glacier_serac', pos: XZ(128, -300), rot: 10, scale: 1.6 },
    { name: 'glacier_serac', pos: XZ(170, -380), rot: 80, scale: 1.4 },
    { name: 'glacier_serac', pos: XZ(60, -230), rot: 30, scale: 1.8 },
    { name: 'glacier_serac', pos: XZ(85, -260), rot: 140, scale: 1.5 },
    { name: 'glacier_serac', pos: XZ(20, -240), rot: 200, scale: 1.7 },
    // ridge and lake
    { name: 'sign_arrow', at: 'lakeTurn', lat: -14, rot: 180 },
    { name: 'sign_arrow', at: 'lakeTurn+20', lat: -14, rot: 180 },
    { name: 'glacier_fishhut', pos: XZ(-196, -250), rot: 60 },
    { name: 'glacier_fishhut', pos: XZ(-192, -292), rot: 140 },
    { name: 'glacier_fishhut', pos: XZ(-205, -270), rot: 10 },
    { name: 'glacier_snowman', pos: XZ(-188, -300), rot: 80 },
    { name: 'glacier_hut', pos: XZ(-152, -150), rot: 100, solid: [8, 7] as Vec2 },
    // climb: chevrons outside the hairpins
    { name: 'sign_arrow', at: 'hairpin1-12', lat: -13, rot: 180 },
    { name: 'sign_arrow', at: 'hairpin1', lat: -13, rot: 180 },
    { name: 'sign_arrow', at: 'hairpin1+12', lat: -13, rot: 180 },
    { name: 'sign_arrow', at: 'hairpin2-12', lat: 13, rot: 180, flip: true },
    { name: 'sign_arrow', at: 'hairpin2', lat: 13, rot: 180, flip: true },
    { name: 'sign_arrow', at: 'hairpin2+12', lat: 13, rot: 180, flip: true },
    { name: 'glacier_snowman', at: 'forest', lat: 14, rot: -90 },
  ],
  scatter: [
    {
      // seracs and blocks on the glacier peak in the middle of the loop
      props: [{ name: 'glacier_serac', weight: 1, scale: [0.9, 1.9] }, { name: 'glacier_rock', weight: 1.5, scale: [1.5, 3] }], density: 0.35, seed: 397,
      bands: [[24, 99, 1]], regions: [{ at: XZ(40, -190), radius: 95 }], maxSlope: 1.2,
    },
    {
      // pine forest on the climb, round the lake and down the slopes below the ridge
      props: [{ name: 'glacier_pine', scale: [0.75, 1.3] }], density: 7, solid: 0.5, seed: 401, maxSlope: 0.9,
      bands: [[5, 14, 0.45], [14, 99, 1]],
      regions: [{ at: XZ(-80, -150), radius: 115 }, { at: XZ(-170, -150), radius: 70 }, { at: XZ(-10, -90), radius: 55 }, { at: XZ(-50, -40), radius: 45 }, { at: XZ(-60, -470), radius: 120 }, { at: XZ(160, 20), radius: 70 }, { at: XZ(-60, 50), radius: 60 }],
      exclude: [{ at: XZ(-178, -268), radius: 58 }, { at: XZ(-98, -135), radius: 13 }, { at: XZ(-57.5, -215), radius: 13 }],
    },
    {
      // sparse pines everywhere else below the glacier
      props: [{ name: 'glacier_pine', scale: [0.7, 1.2] }], density: 1.4, solid: 0.5, seed: 409, maxSlope: 0.8,
      bands: [[6, 99, 1]],
      exclude: [{ at: XZ(40, -190), radius: 125 }, { at: XZ(-178, -268), radius: 58 }, { at: XZ(150, -340), radius: 60 }],
    },
    {
      props: [{ name: 'glacier_rock', weight: 1, scale: [0.6, 1.5] }, { name: 'glacier_rock_b', weight: 1.6, scale: [0.6, 1.4] }], density: 1.1, solid: 0.7, seed: 419,
      bands: [[5, 99, 1]], exclude: [{ at: XZ(-178, -268), radius: 50 }],
    },
    {
      // ice crystals round the glacier tongue and the peak
      props: [{ name: 'glacier_crystal', scale: [0.6, 1.4] }], density: 2.4, seed: 431,
      bands: [[3, 30, 1]], regions: [{ at: XZ(140, -360), radius: 70 }, { at: XZ(40, -200), radius: 60 }],
    },
  ],
  lapEvents: [
    { lap: 2, name: 'caveCrack', enable: ['caveHole'], disable: ['caveSeal'], at: 'caveS' },
    { lap: 3, name: 'avalancheRumble', enable: ['lakeDetour'], at: 'avalanche' },
  ],
};
