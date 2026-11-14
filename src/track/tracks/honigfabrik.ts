// Track 3: Honigfabrik. A honey factory run by bees: half outdoors among flower fields and hives
// at golden hour, half indoors in a warm production hall. Obstacles, machinery and timing.
//
// Map coordinates: e = east, n = north (metres). World: x = -e, z = n, so a right turn on the map
// is a right turn in the game. Driving order:
//   Act 1  delivery yard between giant honey jars -> right-hander into the production hall.
//   Act 2  conveyor belts (left belt pushes forward, right belt backward) -> U-turn around the
//          bottling line (drift) -> row of stamping presses (slalom or timing) -> honey vats
//          (flood A, gantry above) -> courtyard (flood C, lap 3 pipe cannon) -> steel spiral ramp
//          around the giant honey tank (long right-hand drift) -> pipe tunnel.
//   Act 3  rooftop of the packing house above the flower fields and the hive tower -> chute
//          down with a jump -> last corner (drift, risky cut between the crates) -> start.
// Every lap the honey flood rises (lap 2: one lane of two sections, lap 3: more, the gantry
// becomes the dry line); lap 3 opens the pipe cannon. Belts, presses, the flood and the cannon
// run in src/track/scripts/honig.ts.
import type { ControlPoint, EdgeDef, PropPlacement, TrackDef, Vec2 } from '../format';
import { honigScript } from '../scripts/honig';

const XZ = (e: number, n: number): Vec2 => [-e, n];
/**
 * Ground level of the factory. Everything sits 2 m above y = 0: the kart physics treats wheels below
 * y = 0.1 as 'upside down' (see the report), so roads must stay clearly above 0.
 */
export const G0 = 2;
const P = (e: number, n: number, y: number, o: Omit<ControlPoint, 'p'> = {}): ControlPoint => ({ p: [-e, y + G0, n], ...o });
const rail = (offset = 1.2, extra: Partial<EdgeDef> = {}): EdgeDef => ({ kind: 'rail', offset, ...extra });
const wall = (offset = 1.0, extra: Partial<EdgeDef> = {}): EdgeDef => ({ kind: 'wall', offset, ...extra });

/** Giant honey tank in the courtyard; the spiral ramp circles it clockwise. */
export const TANK: { e: number; n: number; r: number } = { e: -40, n: 208, r: 22 };
const SPIRAL_Y0 = 0.3, SPIRAL_Y1 = 7.8;

/** Clockwise spiral points around the tank, every 45 deg, starting after the south point. */
function spiral(): ControlPoint[] {
  const out: ControlPoint[] = [];
  const steps = 8;
  for (let k = 1; k <= steps; k++) {
    const a = -Math.PI / 2 - (k * 2 * Math.PI) / steps; // clockwise from the south point
    const y = SPIRAL_Y0 + ((SPIRAL_Y1 - SPIRAL_Y0) * k) / steps;
    const o: Omit<ControlPoint, 'p'> = {};
    if (k === 4) o.name = 'spiralTop';
    if (k === steps) { o.name = 'spiralExit'; o.bank = 2; }
    out.push(P(TANK.e + Math.cos(a) * TANK.r, TANK.n + Math.sin(a) * TANK.r, y, o));
  }
  return out;
}

/** U-turn at the east end of the hall (left, around the bottling line). */
const UTURN = { e: 190, n: 165, r: 21.5 };
function uturn(): ControlPoint[] {
  const out: ControlPoint[] = [];
  const banks = [-4, -7, -7, -7, -3];
  for (let k = 0; k <= 4; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 4; // counter-clockwise from the south point
    out.push(P(UTURN.e + Math.cos(a) * UTURN.r, UTURN.n + Math.sin(a) * UTURN.r, 0, { bank: banks[k], name: k === 2 ? 'uturnApex' : undefined }));
  }
  return out;
}

/** Last corner: a 135 deg left-hander around LAST_C onto the start straight. */
export const LAST_C = { e: 4, n: -62, r: 26 };
function lastCorner(): ControlPoint[] {
  const deg = [225, 260, 295, 330];
  const banks = [-4, -6, -6, -3];
  const out = deg.map((d, k) => {
    const a = (d * Math.PI) / 180;
    return P(LAST_C.e + Math.cos(a) * LAST_C.r, LAST_C.n + Math.sin(a) * LAST_C.r, 0, {
      bank: banks[k], ...(k === 0 ? { name: 'lastCorner', left: 'none' as const, right: { kind: 'open' as const, reach: 14 } } : {}),
    });
  });
  out.push(P(LAST_C.e + LAST_C.r, LAST_C.n + 2, 0, { name: 'lastCornerExit', bank: 0, left: { kind: 'open', reach: 16 } }));
  out.push(P(LAST_C.e + LAST_C.r, -32, 0));
  return out;
}

/** The crate cut: a wide arc through the infield of the last corner, slightly below the banked road. */
export const CUT_C = { e: 2, n: -40, r: 33 };
function cutArc(): ControlPoint[] {
  return [240, 262, 284, 306].map((d, k) => {
    const a = (d * Math.PI) / 180;
    const o: Omit<ControlPoint, 'p'> = k === 0 ? { left: 'none', right: 'none', shoulder: 1.0, look: 'gravel' } : {};
    if (k === 1) o.name = 'cutMid';
    return P(CUT_C.e + Math.cos(a) * CUT_C.r, CUT_C.n + Math.sin(a) * CUT_C.r, k === 0 || k === 3 ? -0.2 : -0.45, o);
  });
}

/** Production hall: two bays (map rectangles), walls 12 m, trusses above. Shared with the theme. */
export const HALL = {
  bays: [
    { e0: 76, e1: 232, n0: 120, n1: 165 }, // south bay: belts, U-turn
    { e0: 30, e1: 232, n0: 165, n1: 210 }, // north bay: presses, vats, gantry
  ],
  wallH: 12,
  /** Door openings: [wall e or n, along from, along to]. */
  doors: { southWest: [133, 152], northWest: [176, 198] },
};
const r = (e: number, n: number, radius: number) => ({ at: XZ(e, n), radius });
const FIELDS = {
  sun: [r(-168, 120, 24), r(-168, 40, 22), r(-96, 128, 20), r(-92, 32, 18)],
  lavender: [r(-168, 80, 16), r(-96, 82, 20), r(-168, -8, 18), r(-104, -6, 12)],
  hives: [r(-100, 104, 9), r(-170, 60, 7)],
  noTrees: [r(-130, 70, 60), r(30, 20, 60), r(130, 165, 110), r(-20, 205, 50)],
  paved: [r(32, -20, 34), r(32, 40, 34), r(36, 95, 30), r(70, 187, 32), r(120, 165, 52), r(190, 165, 50), r(-20, 205, 46), r(4, -62, 38)],
};

/** Hand-placed scenery: yard, hall kit, courtyard, fields, last corner. */
function scenery(): PropPlacement[] {
  const out: PropPlacement[] = [];
  const add = (p: PropPlacement) => out.push(p);
  // --- yard -----------------------------------------------------------------
  add({ name: 'start_gate', at: 'start', lat: 0 });
  for (const [at, lat] of [['start-34', 27], ['start+6', 16.5], ['start+46', 16], ['start+26', -17], ['yardEnd-6', -16]] as [string, number][]) {
    add({ name: 'honey_jar_giant', at, lat, rot: 30 + lat * 7, solid: 2.4, solidHeight: 6 });
  }
  const crates = (e: number, n: number, rot: number, layout: [number, number, number][]) => {
    for (const [dx, dz, lvl] of layout) {
      const a = (rot * Math.PI) / 180;
      add({ name: 'honey_crate', pos: XZ(e + dx * Math.cos(a) - dz * Math.sin(a), n + dx * Math.sin(a) + dz * Math.cos(a)), rot: rot + lvl * 9, dy: lvl * 1.1, solid: lvl === 0 ? 0.75 : undefined, clear: 1.5 });
    }
  };
  crates(47, -6, 10, [[0, 0, 0], [1.2, 0, 0], [0.6, 0, 1], [0, 1.2, 0]]);
  crates(46, 64, -20, [[0, 0, 0], [1.2, 0.2, 0], [0.5, 0, 1]]);
  crates(13, 52, 40, [[0, 0, 0], [0, 1.2, 0], [0, 0.6, 1]]);
  for (const [e, n, k] of [[49, 24, 3], [12, 8, 2], [48, 84, 2]] as [number, number, number][]) {
    for (let i = 0; i < k; i++) add({ name: 'honey_barrel', pos: XZ(e + i * 1.15, n + (i % 2) * 0.9), rot: i * 47, solid: 0.55, clear: 1.2 });
  }
  for (const [e, n] of [[46.5, -6], [47.7, -5.6], [46.2, 64.2]] as [number, number][]) add({ name: 'honey_jar', pos: XZ(e, n), dy: 2.2, rot: e * 13, clear: 0.3 });
  for (let s = 4; s <= 74; s += 23) add({ name: 'honey_lamp_post', at: `start+${s}`, lat: 13.2, rot: 90 });
  add({ name: 'honey_bee', at: 'start+14', lat: 14.5, rot: -70 });
  add({ name: 'honey_bee', at: 'start-12', lat: -13.5, rot: 80 });
  add({ name: 'honey_bee', at: 'yardEnd+2', lat: 13.4, rot: -110 });
  for (const at of ['yardEnd+14', 'yardEnd+28', 'yardEnd+42']) add({ name: 'sign_arrow', at, lat: -13.2, rot: 180 });
  // --- hall kit -------------------------------------------------------------
  const W = 8;
  const wallRun = (fixed: number, from: number, to: number, alongE: boolean, door?: number[]) => {
    const n = Math.round((to - from) / W);
    for (let k = 0; k < n; k++) {
      const c = from + (k + 0.5) * ((to - from) / n);
      if (door && c > door[0] - W / 2 + 1 && c < door[1] + W / 2 - 1) continue;
      add({ name: 'honey_wall', pos: alongE ? XZ(c, fixed) : XZ(fixed, c), rot: alongE ? 0 : 90, scale: 1, clear: 4, solid: [W, 0.8], solidHeight: 6 });
    }
  };
  const [S, N] = HALL.bays;
  wallRun(S.e0, S.n0, S.n1, false, HALL.doors.southWest);
  wallRun(S.n0, S.e0, S.e1, true);
  wallRun(S.e1, S.n0, N.n1, false);
  wallRun(N.n1, N.e0, N.e1, true);
  wallRun(N.e0, N.n0, N.n1, false, HALL.doors.northWest);
  wallRun(N.n0, N.e0, S.e0, true);
  for (const [e, n] of [[S.e0, S.n0], [S.e1, S.n0], [S.e1, N.n1], [N.e0, N.n1], [N.e0, N.n0], [S.e0, N.n0]] as [number, number][]) add({ name: 'honey_column', pos: XZ(e, n), clear: 2 });
  for (let e = 100; e <= 172; e += 18) add({ name: 'honey_column', pos: XZ(e, 160.5), clear: 2 });
  // door jambs: close the gaps between the wall panels and the road walls (no pockets inside the hall)
  for (const [e, spans] of [[S.e0, [[127.5, 132.4], [151.6, 157.5]]], [N.e0, [[172.5, 177.4], [196.6, 202.5]]]] as [number, number[][]][]) {
    for (const [a, b] of spans) for (let n = a; n <= b + 0.01; n += (b - a) / 2) add({ name: 'honey_column', pos: XZ(e, n), solid: 1.0, solidHeight: 6, clear: 1 });
  }
  for (let e = S.e0 + 9; e < S.e1 - 4; e += 13) add({ name: 'honey_truss', pos: XZ(e, (S.n0 + S.n1) / 2), rot: 90, y: 2 + HALL.wallH - 0.4, scale: (S.n1 - S.n0) / 46 });
  for (let e = N.e0 + 6; e < N.e1 - 4; e += 13) add({ name: 'honey_truss', pos: XZ(e, (N.n0 + N.n1) / 2), rot: 90, y: 2 + HALL.wallH - 0.4, scale: (N.n1 - N.n0) / 46 });
  // hanging lamps over both legs and the U-turn
  for (let e = 92; e <= 172; e += 16) add({ name: 'honey_lamp', pos: XZ(e, 142.5), y: 2 + HALL.wallH - 0.6, clear: 0 });
  for (let e = 44; e <= 172; e += 16) add({ name: 'honey_lamp', pos: XZ(e, 187), y: 2 + HALL.wallH - 0.6, clear: 0 });
  for (const [e, n] of [[198, 150], [207, 165], [198, 180]] as [number, number][]) add({ name: 'honey_lamp', pos: XZ(e, n), y: 2 + HALL.wallH - 0.6, clear: 0 });
  // honey vats and the bottling line along the spine
  for (const e of [106, 121, 136, 151, 166]) add({ name: 'honey_vat', pos: XZ(e, 163.5), rot: e * 3, solid: 3.1, solidHeight: 3 });
  for (let e = 84; e <= 172; e += 8.5) add({ name: 'honey_crate', pos: XZ(e, 125.5 + ((e * 7) % 3)), rot: e * 11, clear: 1 });
  for (let e = 40; e <= 64; e += 6) add({ name: 'honey_barrel', pos: XZ(e, 205.5), rot: e * 9, clear: 1 });
  for (let e = 120; e <= 220; e += 9) add({ name: 'honey_barrel', pos: XZ(e, 206 - ((e * 3) % 2)), rot: e * 5, clear: 1 });
  for (let n = 128; n <= 200; n += 7) add({ name: 'honey_crate', pos: XZ(227.5, n), rot: n * 7, clear: 1 });
  add({ name: 'honey_bee', pos: XZ(101, 158), rot: 160 });
  add({ name: 'honey_bee', pos: XZ(143, 158.5), rot: 200 });
  add({ name: 'honey_bee', pos: XZ(160, 196.5), rot: 10 });
  add({ name: 'honey_bee', pos: XZ(215, 126), rot: -40 });
  // --- courtyard: tank, cannon, pipes ---------------------------------------
  add({ name: 'honey_tank', pos: XZ(TANK.e, TANK.n), rot: 180, clear: 12 });
  add({ name: 'honey_cannon', at: 'cannonBay+1', lat: 13.6, solid: [4.0, 8.0], solidHeight: 6 });
  add({ name: 'honey_cannon_lid', at: 'cannonBay-2.35', lat: 13.6, solid: [4.6, 1.0], solidHeight: 5, tag: 'cannonLid' });
  for (let k = 0; k < 4; k++) add({ name: 'honey_pipe', pos: XZ(-6 - k * 6.2, 236), rot: 0, clear: 1 });
  for (let k = 0; k < 3; k++) add({ name: 'honey_pipe', pos: XZ(20, 202 + k * 6.2), rot: 90, clear: 1 });
  for (const [e, n] of [[24, 176], [26, 174.5], [-6, 174], [-60, 174], [-66, 176]] as [number, number][]) add({ name: 'honey_barrel', pos: XZ(e, n), rot: e * 7, solid: 0.55, clear: 1 });
  crates(10, 172, 15, [[0, 0, 0], [1.2, 0, 0], [0.6, 0, 1]]);
  add({ name: 'honey_bee', pos: XZ(12, 175), rot: 20 });
  // --- fields below the roof --------------------------------------------------
  add({ name: 'honey_hive_tower', pos: XZ(-158, 92), rot: 20, solid: 4, solidHeight: 12, clear: 6 });
  add({ name: 'honey_hive_tower', pos: XZ(-100, 150), rot: -15, solid: 4, solidHeight: 12, clear: 6 });
  for (const [e, n, rot] of [[-150, 64, 40], [-108, 96, 200], [-112, 24, -30], [-160, 132, 120]] as [number, number, number][]) add({ name: 'honey_bee', pos: XZ(e, n), rot, clear: 1 });
  // green roof of the packing house: hives, sunflower boxes, bee keepers
  const roofY = G0 + 8.8 - 0.12;
  for (let d = 4, k = 0; d <= 140; d += 9, k++) {
    const side = k % 2 === 0 ? 1 : -1;
    const lat = side * (8.5 + 2.6 + (k % 3) * 1.1);
    const name = k % 5 === 2 ? 'honey_bee' : k % 3 === 0 ? 'honey_hive' : 'honey_sunflower';
    add({ name, at: `roof+${d}`, lat, y: roofY, rot: side > 0 ? -90 : 90, clear: 0 });
    if (name === 'honey_sunflower') add({ name, at: `roof+${d + 1.6}`, lat: lat + side * 1.2, y: roofY, rot: side > 0 ? -80 : 100, scale: 0.85, clear: 0 });
  }
  // --- landing and the crate cut ----------------------------------------------
  for (const [at, lat] of [['landing+10', 27], ['lastCorner+20', 27]] as [string, number][]) add({ name: 'honey_jar_giant', at, lat, rot: 60, solid: 2.4, solidHeight: 6 });
  for (const [at, lat] of [[10, -6.4], [22, -6.6], [34, -6.4], [16, 6.2]] as [number, number][]) {
    add({ name: 'honey_crate', at, lat, path: 'crateCut', rot: at * 9, solid: 0.75 });
    add({ name: 'honey_crate', at: at + 1.2, lat: lat - Math.sign(lat) * 0.1, path: 'crateCut', rot: at * 5, dy: 1.1 });
  }
  add({ name: 'honey_barrel', at: 28, lat: 6.0, path: 'crateCut', solid: 0.55 });
  add({ name: 'sign_arrow', at: 'lastCorner+4', lat: 13, rot: 180, flip: true });
  add({ name: 'sign_arrow', at: 'lastCorner+22', lat: 13, rot: 180, flip: true });
  add({ name: 'honey_bee', at: 'landing+16', lat: -13, rot: 100 });
  return out;
}

export const honigfabrik: TrackDef = {
  id: 'honig',
  name: 'Honigfabrik',
  laps: 3,
  cup: 0,
  order: 2,
  theme: 'honey',
  script: honigScript,
  environment: {
    // golden hour: low warm sun, honey-coloured haze; the procedural sky lights the scene
    hdr: null,
    skyTop: '#86acd9',
    skyHorizon: '#ffd391',
    sunDir: [-0.62, 0.36, -0.7],
    sunColor: '#ffc27a',
    sunIntensity: 3.3,
    ambientIntensity: 0.85,
    fogColor: '#f3c98f',
    fogDensity: 0.0021,
    weather: 'pollen',
    exposure: 1.02,
  },
  music: 'honig',
  width: 8.5,
  main: [
    // --- Act 1: delivery yard ----------------------------------------------
    P(30, 0, 0, { name: 'start', w: 9, bank: 0, left: rail(2.5), right: rail(2.5) }),
    P(30, 42, 0),
    P(31, 78, 0, { name: 'yardEnd', w: 9 }),
    P(36, 104, 0, { bank: 4 }),
    P(46, 124, 0, { name: 'yardCorner', bank: 5 }),
    P(60, 137, 0, { bank: 2 }),
    // --- Act 2: production hall --------------------------------------------
    P(76, 142, 0, { name: 'hallDoor', w: 7.5, bank: 0, left: wall(1.0), right: wall(1.0) }),
    P(90, 142.5, 0, { name: 'beltStart', w: 8.5 }),
    P(120, 142.5, 0),
    P(152, 142.5, 0, { name: 'beltEnd' }),
    P(172, 143, 0, { name: 'uturn', bank: 0 }),
    ...uturn(),
    P(172, 187, 0, { name: 'pressStart', w: 8, bank: 0 }),
    P(136, 187, 0),
    P(98, 187, 0, { name: 'pressEnd' }),
    P(64, 187, 0, { name: 'vats', w: 8.5, left: 'none' }),
    P(30, 187, 0, { name: 'hallExit', w: 7.5 }),
    // --- courtyard ----------------------------------------------------------
    P(16, 187, 0, { w: 10, left: rail(1.5, { catchHeight: 2 }), right: rail(6.0, { catchHeight: 2 }) }),
    P(2, 187, 0, { name: 'cannonBay', w: 10.5 }),
    P(-18, 186.6, 0.1, { name: 'courtyard', w: 9, bank: 3, left: rail(1.0, { catchHeight: 2 }), right: rail(1.8, { catchHeight: 2 }) }),
    P(TANK.e, TANK.n - TANK.r, SPIRAL_Y0, { name: 'spiral', w: 8, bank: 7, left: rail(0.5), right: rail(0.5) }),
    ...spiral(),
    // --- pipe tunnel and rooftop -------------------------------------------
    P(-62, 185.5, 8.2, { w: 7.5, bank: 0 }),
    P(-80, 184.5, 8.4, { name: 'tunnel', w: 6.5 }),
    P(-98, 181, 8.6, { name: 'tunnelEnd', w: 7 }),
    P(-115, 172, 8.7, { w: 8, bank: -4 }),
    P(-128, 157, 8.8, { bank: -5 }),
    P(-134, 138, 8.8, { name: 'roof', bank: 0, w: 8.5 }),
    P(-135, 110, 8.8),
    P(-131, 84, 8.8, { name: 'hive', bank: 1.5 }),
    P(-135, 56, 8.8, { bank: -1.5 }),
    P(-137, 30, 8.8, { bank: 0 }),
    P(-132, 8, 8.7, { bank: -4 }),
    P(-118, -9, 8.3, { name: 'chute', bank: -2, w: 8 }),
    P(-102, -23, 5.6, { bank: 0 }),
    P(-88, -35, 2.8),
    P(-75, -45, 1.4, { name: 'jump', w: 8.5, left: { kind: 'rail', offset: 1.2, catchHeight: 5 }, right: { kind: 'rail', offset: 1.2, catchHeight: 5 } }),
    P(-55, -57, 0.3, { w: 9 }),
    P(-35, -68, 0.0, { name: 'landing', bank: -2, right: { kind: 'open', reach: 14 } }),
    // --- last corner (circle around LAST_C) ---------------------------------
    ...lastCorner(),
  ],
  branches: [
    {
      // Lap 3 dry line: raised gantry over the honey vats along the hall's spine.
      id: 'gantry', from: 'pressEnd-6', to: 'hallExit-4', w: 4.2, risk: 0.25,
      points: [
        P(92, 183, 0.0, { left: rail(0.4), right: 'none', shoulder: 0.6, look: 'planks' }),
        P(82, 175.2, 0.8),
        P(72, 172, 1.9, { left: rail(0.4), right: rail(0.4) }),
        P(62, 171.8, 2.2, { name: 'gantryTop' }),
        P(55, 172.4, 1.9),
        P(48, 175.6, 0.8, { left: rail(0.4), right: 'none' }),
      ],
    },
    {
      // Lap 3 only: the lane into the pipe cannon (an AI line; it lies on the widened main road).
      id: 'cannon', from: 'hallExit+4', to: 'courtyard+6', w: 3.5, risk: 0.3, gain: 1.5, tag: 'cannon', enabled: false,
      points: [
        P(15, 190, 0, { left: 'none', right: 'none', shoulder: 0.3 }),
        P(5, 193.4, 0),
        P(-4, 193.4, 0),
        P(-11, 190.6, 0),
      ],
    },
    {
      // Risky cut inside the last corner, between crate stacks and a honey puddle.
      id: 'crateCut', from: 'landing+3', to: 'lastCornerExit+14', w: 3.8, risk: 0.55,
      points: cutArc(),
    },
  ],
  decks: [
    // the steel spiral, the pipe tunnel and the packing-house roof down to the chute
    { from: 'spiral+9', to: 'jump-8', style: 'stone' },
    { from: 'gantryTop-16', to: 'gantryTop+13', path: 'gantry', style: 'wood', rails: true },
  ],
  ramps: [{ at: 'jump', length: 6, height: 1.5, width: 11, trick: 32 }],
  boostPads: [
    { at: 'start+30', lat: -3.2, width: 3.6 },
    { at: 'spiralExit+6', lat: 0, width: 3.6 },
    { at: 'roof+40', lat: 2.8, width: 3.6 },
    { at: 'jump-14', lat: 0, width: 4 },
  ],
  itemRows: [
    { at: 'start+58' },
    { at: 'beltEnd+4' },
    { at: 'roof+12' },
    { at: 'landing+2', count: 5 },
  ],
  patches: [
    // flood A (hall vats): lap 2 the left lane, lap 3 the whole road (the gantry is dry)
    { from: 'pressEnd+2', to: 'hallExit-7', latMin: -8.5, latMax: -0.6, surface: 'sticky', tag: 'floodA2', enabled: false },
    { from: 'pressEnd+2', to: 'hallExit-7', latMin: -0.6, latMax: 8.5, surface: 'sticky', tag: 'floodA3', enabled: false },
    // flood C (courtyard): lap 2 the right lane, lap 3 most of the road (dry strip left, cannon right)
    { from: 'hallExit+5', to: 'spiral-4', latMin: 0.5, latMax: 6.2, surface: 'sticky', tag: 'floodC2', enabled: false },
    { from: 'hallExit+5', to: 'spiral-4', latMin: -3.2, latMax: 0.5, surface: 'sticky', tag: 'floodC3', enabled: false },
    // flood D (yard corner, lap 3): the inside of the corner
    { from: 'yardEnd+4', to: 'hallDoor-6', latMin: 1.2, latMax: 9, surface: 'sticky', tag: 'floodD3', enabled: false },
    // the honey puddle in the crate cut
    { from: 4, to: 14, latMin: -3.8, latMax: 1.6, surface: 'sticky', path: 'crateCut' },
  ],
  zones: [
    { kind: 'cannon', from: 'cannonBay-3', to: 'cannonBay+3', latMin: 5.8, latMax: 12.5, tag: 'cannon', enabled: false },
  ],
  respawn: [
    { from: 'jump-3', to: 'landing', at: 'jump-22' },
    { from: 'cannonBay-4', to: 'cannonBay+4', at: 'cannonBay-12' },
  ],
  grid: { first: 8, rowGap: 4.2, lat: 2.8 },
  driving: { lateralAccel: 19 },
  terrain: {
    cell: 3,
    margin: 90,
    base: G0,
    hills: [
      { at: XZ(-240, 90), radius: 120, height: 22 }, // hills beyond the flower fields
      { at: XZ(-60, 330), radius: 120, height: 18 },
      { at: XZ(150, 330), radius: 110, height: 14 },
      { at: XZ(320, 120), radius: 110, height: 16 },
      { at: XZ(120, -190), radius: 120, height: 14 },
      { at: XZ(-160, -170), radius: 100, height: 12 },
    ],
    noise: { amp: 0.35, scale: 40 },
    rim: { center: XZ(30, 75), radius: 250, width: 180, height: 30 },
    patches: [
      // yard, hall floor and courtyard paving (render look only, still 'offroad' to drive on)
      { at: XZ(32, 22), size: [68, 186], surface: 'offroad', look: 'gravel' },
      { at: XZ(131, 187.5), size: [204, 47], surface: 'offroad', look: 'gravel' },
      { at: XZ(154, 142.5), size: [158, 47], surface: 'offroad', look: 'gravel' },
      { at: XZ(-22, 205), size: [100, 78], surface: 'offroad', look: 'gravel' },
      { at: XZ(4, -62), radius: 38, surface: 'offroad', look: 'gravel' },
      // flower fields (striped sunflower / lavender rows in the terrain material)
      ...[...FIELDS.sun, ...FIELDS.lavender].map((q) => ({ at: q.at, radius: q.radius + 4, surface: 'offroad' as const, look: 'field' as const })),
    ],
  },
  props: scenery(),
  scatter: [
    {
      // sunflower fields below the packing-house roof
      props: [{ name: 'honey_sunflower', scale: [0.85, 1.25] }], density: 45, seed: 71, spin: false,
      bands: [[4, 60, 1]], regions: FIELDS.sun,
    },
    {
      props: [{ name: 'honey_lavender', scale: [0.8, 1.3] }], density: 34, seed: 73,
      bands: [[4, 60, 1]], regions: FIELDS.lavender,
    },
    {
      props: [{ name: 'honey_hive', scale: [0.9, 1.1] }], density: 1.6, seed: 79,
      bands: [[8, 60, 1]], regions: FIELDS.hives,
    },
    {
      // meadow and hedgerows around the factory grounds
      props: [{ name: 'tree_oak', weight: 2, scale: [0.9, 1.3] }, { name: 'tree_apple', weight: 1.2, scale: [0.9, 1.2] }], density: 2.6, seed: 83,
      bands: [[22, 34, 0.4], [34, 99, 1]], maxSlope: 0.9, exclude: [...FIELDS.sun, ...FIELDS.lavender, ...FIELDS.noTrees],
    },
    {
      props: [{ name: 'bush', weight: 3 }, { name: 'flower_patch', weight: 2 }], density: 2.6, seed: 89,
      bands: [[4, 40, 1], [40, 99, 0.3]], exclude: [...FIELDS.sun, ...FIELDS.lavender, ...FIELDS.paved],
    },
    {
      props: [{ name: 'grass_tuft', scale: [0.8, 1.4] }], density: 14, seed: 97,
      bands: [[3, 30, 1], [30, 99, 0.3]], exclude: FIELDS.paved,
    },
  ],
  lapEvents: [
    { lap: 2, name: 'honeyFlood2', enable: ['floodA2', 'floodC2'], at: 'vats' },
    { lap: 3, name: 'honeyFlood3', enable: ['floodA3', 'floodC3', 'floodD3'], at: 'vats' },
    { lap: 3, name: 'cannonOpen', enable: ['cannon'], disable: ['cannonLid'], at: 'cannonBay' },
  ],
};
