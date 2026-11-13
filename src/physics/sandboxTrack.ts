// Physics test circuit: a closed loop with the geometry the flat test track lacks.
// Built from TrackColliders inside a small TrackRuntime so the game's code path is exercised.
// Owner: physics. Headless (used by tests and sandbox/physics.html).
//
// Layout (clockwise from above, 605 m):
//   S1 straight 150 m: bumps, jump ramp (trick zone), ice patch on the right half
//   T1 90° right, R 15 m (the reference "tight corner")
//   S2 straight 80 m: hill climbing 7 m
//   T2 90° right, R 40 m, banked 20°, on top of the hill
//   S3 straight 125 m: a 5 m drop (cliff), then a slope back down; an angled wall block
//   T3 90° right, R 25 m
//   S4 straight 85 m: boost pad, sand patch, wall block, cannon on the left shoulder
//   T4 90° right, R 25 m
import { Quaternion, Vector3 } from 'three';
import { GRID_SIZE } from '../core/types';
import type {
  ItemBoxSpot, Pose, RaceSim, SimEntity, SurfaceType, TrackCollider, TrackFrame, TrackLocation, TrackMeta, TrackRuntime, TrackZone,
} from '../core/types';

const UP = new Vector3(0, 1, 0);
const HALF = 8, SHOULDER = 4.5, WALL_H = 1.4;

interface Seg { kind: 'straight' | 'arc'; len: number; radius?: number; }

export interface SandboxFeature { name: string; progress: number; lat?: number }

export interface SandboxTrack extends TrackRuntime {
  readonly features: SandboxFeature[];
  /** Reference corner (T1) entry and exit progress. */
  readonly corner90: { entry: number; exit: number; radius: number };
}

export function createSandboxTrack(): SandboxTrack {
  const R1 = 15, R2 = 40, R3 = 25, R4 = 25;
  const A = 150, B = 80, C = 125, D = 85;
  const q = Math.PI / 2;
  const segs: Seg[] = [
    { kind: 'straight', len: A }, { kind: 'arc', len: q * R1, radius: R1 },
    { kind: 'straight', len: B }, { kind: 'arc', len: q * R2, radius: R2 },
    { kind: 'straight', len: C }, { kind: 'arc', len: q * R3, radius: R3 },
    { kind: 'straight', len: D }, { kind: 'arc', len: q * R4, radius: R4 },
  ];
  const segStart: number[] = [];
  let total = 0;
  for (const s of segs) { segStart.push(total); total += s.len; }
  const length = total;
  const sT1 = segStart[1], sS2 = segStart[2], sT2 = segStart[3], sS3 = segStart[4], sT3 = segStart[5], sS4 = segStart[6];

  // Elevation and bank along the path.
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const elevation = (s: number) => {
    const hill = 7 * smooth((s - (sS2 + 5)) / 40);
    const dropAt = sS3 + 35;
    const drop = s < dropAt ? 0 : s < dropAt + 1.5 ? (5 * (s - dropAt)) / 1.5 : 5;
    const down = 2 * smooth((s - (dropAt + 30)) / 35);
    return hill - drop - down;
  };
  const bankAt = (s: number) => {
    const deg = 20;
    const inT = smooth((s - (sT2 - 12)) / 18) * (1 - smooth((s - (sS3 - 6)) / 18));
    return (deg * Math.PI) / 180 * inT;
  };

  // Sample the centre line every metre.
  const N = Math.round(length);
  const STEP = length / N;
  const pts: Vector3[] = [], fwd: Vector3[] = [], rightV: Vector3[] = [], upV: Vector3[] = [];
  {
    // Heading as an exact function of distance; position integrated in fine substeps so the loop closes.
    const headingAt = (d: number) => {
      let h = 0;
      for (let k = 0; k < segs.length; k++) {
        const sg = segs[k];
        if (sg.kind !== 'arc') continue;
        const u = Math.min(sg.len, Math.max(0, d - segStart[k]));
        h += u / sg.radius!;
      }
      return h;
    };
    let x = 0, z = 0;
    const SUB = 20;
    for (let i = 0; i < N; i++) {
      const s0 = i * STEP;
      pts.push(new Vector3(x, elevation(s0), z));
      for (let k = 0; k < SUB; k++) {
        const hm = headingAt(s0 + ((k + 0.5) / SUB) * STEP);
        x += (-Math.sin(hm) * STEP) / SUB; z += (Math.cos(hm) * STEP) / SUB;
      }
    }
  }
  const idxAt = (progress: number) => {
    const p = ((progress % length) + length) % length;
    const i = Math.min(N - 1, Math.floor(p / STEP));
    return { i, t: (p - i * STEP) / STEP };
  };

  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    const f = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    fwd.push(f);
    const r0 = new Vector3().crossVectors(f, UP).normalize();
    const bank = bankAt(i * STEP);
    const r = r0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(UP, -Math.sin(bank));
    rightV.push(r);
    upV.push(new Vector3().crossVectors(r, f).normalize());
  }
  const edge = (i: number, lat: number, up = 0, out = new Vector3()) => out.copy(pts[i]).addScaledVector(rightV[i], lat).addScaledVector(upV[i], up);

  // --- colliders -------------------------------------------------------
  const colliders: TrackCollider[] = [];
  const add = (id: string, kind: 'ground' | 'wall', surface: SurfaceType, v: number[], idx: number[]) =>
    colliders.push({ id, kind, surface, vertices: new Float32Array(v), indices: new Uint32Array(idx), enabled: true });

  // Ribbon between two lateral offsets over the whole loop.
  const ribbon = (id: string, kind: 'ground' | 'wall', surface: SurfaceType, latA: number, latB: number, upA = 0, upB = 0) => {
    const v: number[] = [], idx: number[] = [], t = new Vector3();
    for (let i = 0; i < N; i++) {
      edge(i, latA, upA, t); v.push(t.x, t.y, t.z);
      edge(i, latB, upB, t); v.push(t.x, t.y, t.z);
      const a = i * 2, b = ((i + 1) % N) * 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    add(id, kind, surface, v, idx);
  };
  ribbon('road', 'ground', 'road', -HALF, HALF);
  ribbon('shoulderL', 'ground', 'offroad', -HALF - SHOULDER, -HALF);
  ribbon('shoulderR', 'ground', 'offroad', HALF, HALF + SHOULDER);
  const W = HALF + SHOULDER;
  ribbon('wallL', 'wall', 'wall', -W, -W, -3, WALL_H);
  ribbon('wallR', 'wall', 'wall', W, W, -3, WALL_H);
  add('ground', 'ground', 'offroad', [-400, -6, -400, 400, -6, -400, 400, -6, 400, -400, -6, 400], [0, 2, 1, 0, 3, 2]);

  // Patch on the road surface between progress s0..s1 and lat l0..l1, lifted by `lift`,
  // with an optional height profile h(t) for t = 0..1 along the patch.
  const patch = (id: string, kind: 'ground' | 'wall', surface: SurfaceType, s0: number, s1: number, l0: number, l1: number, lift: number, h?: (t: number) => number, step = 0.5) => {
    const v: number[] = [], idx: number[] = [];
    const n = Math.max(1, Math.round((s1 - s0) / step));
    const fr = emptyFrame();
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const hh = lift + (h ? h(i / n) : 0);
      for (const l of [l0, l1]) { sample(s, l, 0, fr); v.push(fr.pos.x + fr.up.x * hh, fr.pos.y + fr.up.y * hh, fr.pos.z + fr.up.z * hh); }
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
    add(id, kind, surface, v, idx);
  };

  // Bumps: six low humps across the road.
  for (let b = 0; b < 6; b++) {
    const s0 = 45 + b * 2.6;
    patch('bump' + b, 'ground', 'road', s0, s0 + 1.4, -HALF, HALF, 0.005, (t) => 0.2 * Math.sin(Math.PI * t), 0.2);
  }
  // Jump ramp (centre lanes) with side and back faces as walls.
  const rampS0 = 88, rampS1 = 97, rampH = 1.5;
  patch('ramp', 'ground', 'road', rampS0, rampS1, -4.5, 4.5, 0.01, (t) => rampH * t * t * (1.6 - 0.6 * t), 0.5);
  {
    const v: number[] = [], idx: number[] = [], fr = emptyFrame();
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => { const o = v.length / 3; v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
    const P = (s: number, l: number, h: number) => { sample(s, l, 0, fr); return fr.pos.clone().addScaledVector(fr.up, h); };
    quad(P(rampS1, -4.5, 0), P(rampS1, 4.5, 0), P(rampS1, 4.5, rampH), P(rampS1, -4.5, rampH));
    for (const l of [-4.5, 4.5]) for (let i = 0; i < 6; i++) {
      const a = rampS0 + ((rampS1 - rampS0) * i) / 6, b = rampS0 + ((rampS1 - rampS0) * (i + 1)) / 6;
      const ha = rampH * ((i / 6) ** 2) * (1.6 - 0.6 * (i / 6)), hb = rampH * (((i + 1) / 6) ** 2) * (1.6 - 0.6 * ((i + 1) / 6));
      quad(P(a, l, 0), P(b, l, 0), P(b, l, hb), P(a, l, ha));
    }
    add('rampSides', 'wall', 'wall', v, idx);
  }
  patch('ice', 'ground', 'ice', 112, 138, 0, HALF, 0.02);
  patch('boost', 'ground', 'boost', sS4 + 30, sS4 + 34, -2, 2, 0.02);
  patch('sand', 'ground', 'sand', sS4 + 45, sS4 + 62, -HALF, -1.5, 0.02);

  // Free-standing wall blocks: a shallow-angle one and a steep one.
  const block = (id: string, s: number, lat: number, yawDeg: number, len: number, wid: number) => {
    const fr = sample(s, lat, 0, emptyFrame());
    const f = fr.forward.clone().applyAxisAngle(fr.up, (yawDeg * Math.PI) / 180);
    const r = new Vector3().crossVectors(f, fr.up).normalize();
    const v: number[] = [], idx: number[] = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (const h of [-1, 1.3]) {
      const p = fr.pos.clone().addScaledVector(f, (a * len) / 2).addScaledVector(r, (b * wid) / 2).addScaledVector(fr.up, h);
      v.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < 4; i++) { const a = i * 2, b = ((i + 1) % 4) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    idx.push(1, 3, 5, 1, 5, 7);
    add(id, 'wall', 'wall', v, idx);
  };
  block('blockShallow', sS4 + 12, 4.5, 18, 9, 0.8);
  block('blockSteep', sS3 + 95, -4.5, 70, 4, 1);

  // --- zones ------------------------------------------------------------
  const poseAt = (progress: number, lat: number, lift = 0): Pose => {
    const f = sample(progress, lat);
    const m = new Vector3().crossVectors(f.up, f.forward);
    void m;
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), f.forward);
    const upAfter = new Vector3(0, 1, 0).applyQuaternion(quat);
    quat.premultiply(new Quaternion().setFromUnitVectors(upAfter, f.up));
    return { pos: f.pos.clone().addScaledVector(f.up, lift), quat };
  };
  const zones: TrackZone[] = [
    { kind: 'trick', path: 0, from: rampS1 - 4, to: rampS1 + 1, latMin: -4.5, latMax: 4.5, enabled: true },
    { kind: 'cannon', path: 0, from: sS4 + 70, to: sS4 + 74, latMin: -W, latMax: -HALF - 0.5, target: poseAt(20, -3, 0.4), duration: 2.4, enabled: true },
  ];

  // --- runtime ----------------------------------------------------------
  const meta: TrackMeta = {
    id: 'physics-sandbox', name: 'Physik-Testkurs', laps: 3, cup: 0,
    environment: { hdr: null, skyTop: '#5aa9e6', skyHorizon: '#dff1ff', sunDir: [0.4, 0.8, 0.3], sunColor: '#fff4e0', sunIntensity: 3, ambientIntensity: 1, fogColor: '#cfe8ff', fogDensity: 0.002 },
  };

  function sample(progress: number, lat = 0, _path = 0, out: TrackFrame = emptyFrame()): TrackFrame {
    const { i, t } = idxAt(progress);
    const j = (i + 1) % N;
    out.forward.copy(fwd[i]).lerp(fwd[j], t).normalize();
    out.up.copy(upV[i]).lerp(upV[j], t).normalize();
    out.right.copy(rightV[i]).lerp(rightV[j], t).normalize();
    out.pos.copy(pts[i]).lerp(pts[j], t).addScaledVector(out.right, lat);
    out.halfWidth = HALF;
    return out;
  }

  const d = new Vector3(), tmp = new Vector3(), rr = new Vector3();
  function locate(pos: Vector3, hint?: TrackLocation, out: TrackLocation = emptyLocation()): TrackLocation {
    let best = -1, bestD = Infinity, bestT = 0;
    const local = hint !== undefined && hint.hint >= 0;
    const from = local ? hint!.hint : 0;
    const span = local ? 40 : N;
    for (let k = 0; k < span; k++) {
      const i = local ? (from - 15 + k + N) % N : k;
      const j = (i + 1) % N;
      const ax = pts[i].x, az = pts[i].z, bx = pts[j].x, bz = pts[j].z;
      const ex = bx - ax, ez = bz - az;
      const t = Math.min(1, Math.max(0, ((pos.x - ax) * ex + (pos.z - az) * ez) / (ex * ex + ez * ez)));
      const dx = ax + ex * t - pos.x, dz = az + ez * t - pos.z;
      // Small vertical term separates stacked sections.
      const dy = (pts[i].y + (pts[j].y - pts[i].y) * t - pos.y) * 0.3;
      const dd = dx * dx + dz * dz + dy * dy;
      if (dd < bestD) { bestD = dd; best = i; bestT = t; }
    }
    if (local && bestD > 50 * 50) return locate(pos, undefined, out);
    const j = (best + 1) % N;
    tmp.copy(pts[best]).lerp(pts[j], bestT);
    rr.copy(rightV[best]).lerp(rightV[j], bestT).normalize();
    const upx = d.copy(upV[best]).lerp(upV[j], bestT).normalize();
    const rel = tmp.subVectors(pos, tmp);
    out.path = 0;
    out.progress = (best + bestT) * STEP;
    out.lat = rel.dot(rr);
    out.halfWidth = HALF;
    out.height = rel.dot(upx);
    out.onRoad = Math.abs(out.lat) <= HALF;
    out.hint = best;
    return out;
  }

  const startGrid: Pose[] = [];
  for (let i = 0; i < GRID_SIZE; i++) startGrid.push(poseAt(36 - i * 4, i % 2 ? 2.5 : -2.5));
  const itemBoxes: ItemBoxSpot[] = [];

  const features: SandboxFeature[] = [
    { name: 'Start', progress: 36 },
    { name: 'Bumps', progress: 38 },
    { name: 'Ramp', progress: 75 },
    { name: 'Ice', progress: 105, lat: 4 },
    { name: '90° corner', progress: sT1 - 30 },
    { name: 'Hill', progress: sS2 + 2 },
    { name: 'Banked turn', progress: sT2 - 15 },
    { name: 'Drop', progress: sS3 + 15 },
    { name: 'Steep wall', progress: sS3 + 75, lat: -4.5 },
    { name: 'Boost pad', progress: sS4 + 15 },
    { name: 'Shallow wall', progress: sS4 + 2, lat: 4.5 },
    { name: 'Cannon', progress: sS4 + 55, lat: -10 },
  ];

  return {
    meta, length, colliders, startGrid, itemBoxes, zones, branches: [], killY: -20,
    features,
    corner90: { entry: sT1, exit: sS2, radius: R1 },
    locate, sample,
    racingLine: () => ({ lat: 0, speed: 1 }),
    respawn: (loc) => poseAt(loc.progress, Math.max(-4, Math.min(4, loc.lat)) * 0.5, 0.05),
    createEntities: (_sim: RaceSim): SimEntity[] => [],
    setLap() {},
    step() {},
  };
}

function emptyFrame(): TrackFrame {
  return { pos: new Vector3(), forward: new Vector3(0, 0, 1), right: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), halfWidth: HALF };
}

function emptyLocation(): TrackLocation {
  return { path: 0, progress: 0, lat: 0, halfWidth: HALF, height: 0, onRoad: true, hint: -1 };
}
