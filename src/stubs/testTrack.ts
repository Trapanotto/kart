// Grey-box test track: a flat stadium oval. Shared by all sandboxes and headless tests.
// Owner: lead. The real tracks live in src/track/.
import { Quaternion, Vector3 } from 'three';
import { GRID_SIZE } from '../core/types';
import type { ItemBoxSpot, Pose, RaceSim, SimEntity, TrackCollider, TrackFrame, TrackLocation, TrackMeta, TrackRuntime } from '../core/types';

const UP = new Vector3(0, 1, 0);

export function emptyLocation(): TrackLocation {
  return { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: 0 };
}

export function emptyFrame(): TrackFrame {
  return { pos: new Vector3(), forward: new Vector3(0, 0, 1), right: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), halfWidth: 8 };
}

export function createTestTrack(): TrackRuntime {
  const STRAIGHT = 140, R = 55, STEP = 2, HALF = 8;
  const pts: Vector3[] = [];
  // Stadium, driven counter-clockwise seen from above (left turns).
  const arcN = Math.round((Math.PI * R) / STEP), strN = Math.round(STRAIGHT / STEP);
  for (let i = 0; i < strN; i++) pts.push(new Vector3(-R, 0, -STRAIGHT / 2 + (i / strN) * STRAIGHT));
  for (let i = 0; i < arcN; i++) { const a = Math.PI - (i / arcN) * Math.PI; pts.push(new Vector3(Math.cos(a) * R, 0, STRAIGHT / 2 + Math.sin(a) * R)); }
  for (let i = 0; i < strN; i++) pts.push(new Vector3(R, 0, STRAIGHT / 2 - (i / strN) * STRAIGHT));
  for (let i = 0; i < arcN; i++) { const a = -(i / arcN) * Math.PI; pts.push(new Vector3(Math.cos(a) * R, 0, -STRAIGHT / 2 + Math.sin(a) * R)); }
  // Start line (progress 0) in the middle of the first straight; the grid stands behind it.
  pts.push(...pts.splice(0, strN >> 1));
  const N = pts.length;
  const cum: number[] = [0];
  for (let i = 0; i < N; i++) cum.push(cum[i] + pts[i].distanceTo(pts[(i + 1) % N]));
  const length = cum[N];
  const fwd = pts.map((p, i) => pts[(i + 1) % N].clone().sub(p).normalize());

  const meta: TrackMeta = {
    id: 'test', name: 'Teststrecke', laps: 3, cup: 0,
    environment: { hdr: null, skyTop: '#5aa9e6', skyHorizon: '#dff1ff', sunDir: [0.4, 0.8, 0.3], sunColor: '#fff4e0', sunIntensity: 3, ambientIntensity: 1, fogColor: '#cfe8ff', fogDensity: 0.002 },
  };

  // Colliders: road ribbon, a large offroad plane just below it, outer and inner walls.
  const WALL = HALF + 6;
  const road: number[] = [], roadIdx: number[] = [], wall: number[] = [], wallIdx: number[] = [];
  const tmp = new Vector3(), right = new Vector3();
  for (let i = 0; i < N; i++) {
    right.crossVectors(fwd[i], UP).normalize();
    for (const s of [-1, 1]) { tmp.copy(pts[i]).addScaledVector(right, s * HALF); road.push(tmp.x, 0, tmp.z); }
    for (const s of [-1, 1]) {
      tmp.copy(pts[i]).addScaledVector(right, s * WALL);
      wall.push(tmp.x, -1, tmp.z, tmp.x, 3, tmp.z);
    }
    const a = i * 2, b = ((i + 1) % N) * 2;
    roadIdx.push(a, b, a + 1, a + 1, b, b + 1);
    const wa = i * 4, wb = ((i + 1) % N) * 4;
    wallIdx.push(wa, wa + 1, wb, wb, wa + 1, wb + 1, wa + 2, wb + 2, wa + 3, wa + 3, wb + 2, wb + 3);
  }
  const G = 400;
  const colliders: TrackCollider[] = [
    { id: 'road', kind: 'ground', surface: 'road', vertices: new Float32Array(road), indices: new Uint32Array(roadIdx), enabled: true },
    { id: 'grass', kind: 'ground', surface: 'offroad', vertices: new Float32Array([-G, -0.03, -G, G, -0.03, -G, G, -0.03, G, -G, -0.03, G]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]), enabled: true },
    { id: 'walls', kind: 'wall', surface: 'wall', vertices: new Float32Array(wall), indices: new Uint32Array(wallIdx), enabled: true },
  ];

  const idxAt = (progress: number) => {
    const p = ((progress % length) + length) % length;
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= p) lo = m; else hi = m; }
    return { i: lo, t: (p - cum[lo]) / (cum[lo + 1] - cum[lo]) };
  };

  function sample(progress: number, lat = 0, _path = 0, out: TrackFrame = emptyFrame()): TrackFrame {
    const { i, t } = idxAt(progress);
    const j = (i + 1) % N;
    out.forward.copy(fwd[i]).lerp(fwd[j], t).normalize();
    out.up.copy(UP);
    out.right.crossVectors(out.forward, UP).normalize();
    out.pos.copy(pts[i]).lerp(pts[j], t).addScaledVector(out.right, lat);
    out.halfWidth = HALF;
    return out;
  }

  const d = new Vector3();
  function locate(pos: Vector3, hint?: TrackLocation, out: TrackLocation = emptyLocation()): TrackLocation {
    let best = -1, bestD = Infinity, bestT = 0;
    const from = hint && hint !== out ? hint.hint : out.hint;
    const local = hint !== undefined;
    const span = local ? 24 : N;
    for (let k = 0; k < span; k++) {
      const i = local ? (from - 8 + k + N) % N : k;
      const j = (i + 1) % N;
      const seg = cum[i + 1] - cum[i];
      d.copy(pos).sub(pts[i]);
      const t = Math.min(1, Math.max(0, d.dot(fwd[i]) / seg));
      const dx = pts[i].x + (pts[j].x - pts[i].x) * t - pos.x, dz = pts[i].z + (pts[j].z - pts[i].z) * t - pos.z;
      const dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = i; bestT = t; }
    }
    if (local && bestD > 60 * 60) return locate(pos, undefined, out);
    const j = (best + 1) % N;
    right.crossVectors(fwd[best], UP).normalize();
    tmp.copy(pts[best]).lerp(pts[j], bestT);
    out.path = 0;
    out.progress = cum[best] + (cum[best + 1] - cum[best]) * bestT;
    out.lat = d.copy(pos).sub(tmp).dot(right);
    out.halfWidth = HALF;
    out.height = pos.y;
    out.onRoad = Math.abs(out.lat) <= HALF;
    out.hint = best;
    return out;
  }

  const poseAt = (progress: number, lat: number): Pose => {
    const f = sample(progress, lat);
    return { pos: f.pos.clone(), quat: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), f.forward) };
  };
  const startGrid: Pose[] = [];
  for (let i = 0; i < GRID_SIZE; i++) startGrid.push(poseAt(length - 6 - i * 4, i % 2 ? 2.5 : -2.5));
  const itemBoxes: ItemBoxSpot[] = [];
  let id = 0;
  for (const p of [0.2, 0.55, 0.8]) for (const lat of [-4.5, -1.5, 1.5, 4.5]) {
    const f = sample(p * length, lat);
    itemBoxes.push({ id: id++, pos: f.pos.clone().add(new Vector3(0, 1, 0)), up: UP.clone() });
  }

  return {
    meta, length, colliders, startGrid, itemBoxes, zones: [], branches: [], killY: -30,
    locate, sample,
    racingLine: () => ({ lat: 0, speed: 1 }),
    respawn: (loc) => poseAt(loc.progress, 0),
    createEntities: (_sim: RaceSim): SimEntity[] => [],
    setLap() {},
    step() {},
  };
}
