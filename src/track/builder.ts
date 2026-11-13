// TrackDef -> TrackRuntime. Owner: track. Headless and deterministic: math from 'three' only.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { createRng, KART, SURFACES } from '../core/data';
import { GRID_SIZE } from '../core/types';
import type {
  ItemBoxSpot, Pose, RaceSim, SimEntity, SurfaceType, TrackBranch, TrackCollider, TrackFrame, TrackLocation, TrackMeta,
  TrackRuntime, TrackZone,
} from '../core/types';
import type { ControlPoint, EdgeDef, PathRef, Progress, TrackDef } from './format';
import { type HazardHost, type HazardRuntime, updateHazard } from './hazards';
import { type BuiltPath, buildPath, computeFrames, EDGE_DEFAULT_OFFSET, resolveProgress, rowAt, wrapS } from './path';
import { SHOULDER_DROP, SKIRT_DROP, SKIRT_W, Terrain } from './terrain';

// ---------------------------------------------------------------------------
// Built data shared with the view and the tools
// ---------------------------------------------------------------------------

export type BarrierStyle = 'wood' | 'stone' | 'hedge';

export interface Barrier {
  kind: 'fence' | 'rail' | 'wall' | 'hedge' | 'boundary' | 'deckRail';
  style: BarrierStyle;
  height: number;
  /** Base points on the ground. */
  pts: Vector3[];
  /** Invisible collider extension above `height` (m). */
  catch?: number;
}

export interface BuiltPad { path: number; s0: number; length: number; lat: number; width: number; duration: number }
export interface BuiltRamp { path: number; s0: number; length: number; height: number; lat: number; width: number; surface: SurfaceType }
export interface BuiltPatch { path: number; s0: number; s1: number; latMin: number; latMax: number; surface: SurfaceType; tag?: string }
export interface BuiltDeck { path: number; s0: number; s1: number; style: 'wood' | 'stone'; rails: boolean; model?: string }

export interface PlacedProp {
  name: string;
  x: number; y: number; z: number;
  yaw: number;
  scale: number;
  tag?: string;
  /** Detail props are thinned by the quality density; solid / explicit ones never are. */
  detail: boolean;
  /** Stable 0..1 value for density thinning. */
  keep: number;
  /** Distance beyond the nearest road edge (m), for LOD choice. */
  dist: number;
}

export interface BuiltStructure {
  type: 'barn';
  path: number;
  s: number;
  center: Vector3;
  fwd: Vector3;
  right: Vector3;
  length: number;
  width: number;
  height: number;
  doorsTag: string;
  model: string;
  doors: 'entry' | 'both';
}

export interface TrackState {
  /** Increments whenever a lap event changed something. */
  version: number;
  tags: Map<string, boolean>;
  lap: number;
}

interface Proj {
  path: number; row: number; t: number;
  lat: number; hw: number; h: number; e: number; s: number;
}

const UP = new Vector3(0, 1, 0);
const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

class MeshAcc {
  v: number[] = [];
  i: number[] = [];
  private map = new Map<string, number>();
  add(x: number, y: number, z: number, key?: string): number {
    if (key !== undefined) {
      const k = this.map.get(key);
      if (k !== undefined) return k;
    }
    const n = this.v.length / 3;
    this.v.push(x, y, z);
    if (key !== undefined) this.map.set(key, n);
    return n;
  }
  addV(p: Vector3, key?: string): number { return this.add(p.x, p.y, p.z, key); }
  tri(a: number, b: number, c: number): void { this.i.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.i.push(a, b, c, b, d, c); }
}

function emptyLoc(): TrackLocation {
  return { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: -1 };
}
function emptyFrame(): TrackFrame {
  return { pos: new Vector3(), forward: new Vector3(0, 0, 1), right: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), halfWidth: 8 };
}

/** Lateral columns (fractions of the half width) of road meshes; shared with the view. */
export const ROAD_COLS = [-1, -0.82, -0.55, -0.25, 0, 0.25, 0.55, 0.82, 1];

const CELL = 8;
const REG = 45;
const HINT_PATH = 1 << 20;

// ---------------------------------------------------------------------------

export class BuiltTrack implements TrackRuntime {
  readonly meta: TrackMeta;
  readonly def: TrackDef;
  readonly length: number;
  readonly paths: BuiltPath[] = [];
  readonly colliders: TrackCollider[] = [];
  readonly colliderTags = new Map<TrackCollider, string>();
  readonly startGrid: Pose[] = [];
  readonly itemBoxes: ItemBoxSpot[] = [];
  readonly zones: TrackZone[] = [];
  readonly zoneTags = new Map<TrackZone, string>();
  readonly branches: TrackBranch[] = [];
  readonly branchTags = new Map<TrackBranch, string>();
  killY = -30;

  terrain!: Terrain;
  readonly barriers: Barrier[] = [];
  readonly pads: BuiltPad[] = [];
  readonly ramps: BuiltRamp[] = [];
  readonly patches: BuiltPatch[] = [];
  readonly decks: BuiltDeck[] = [];
  readonly props: PlacedProp[] = [];
  readonly structures: BuiltStructure[] = [];
  readonly hazards: HazardRuntime[] = [];
  readonly state: TrackState = { version: 0, tags: new Map(), lap: 0 };
  /** Racing line per path, per row: lateral offset and target speed fraction. */
  readonly rlLat: Float32Array[] = [];
  readonly rlSpeed: Float32Array[] = [];
  /** Build timings and stats. */
  readonly stats: Record<string, number> = {};

  private initialTags = new Map<string, boolean>();
  private applied = new Set<number>();
  private grid!: { x0: number; z0: number; nx: number; nz: number; start: Int32Array; items: Int32Array; complex: Uint8Array };
  private host: HazardHost;

  constructor(def: TrackDef) {
    const t0 = now();
    this.def = def;
    this.meta = { id: def.id, name: def.name, laps: def.laps, cup: def.cup, environment: def.environment, music: def.music };
    const width = def.width ?? KART.roadHalfWidth;

    // 1. paths
    const main = buildPath(def.main, { index: 0, id: 'main', closed: true, width, step: 1 });
    this.paths.push(main);
    this.length = main.length;
    (def.branches ?? []).forEach((b, k) => {
      const from = wrapS(main, resolveProgress(main, b.from));
      const to = wrapS(main, resolveProgress(main, b.to));
      const span = (to - from + main.length) % main.length;
      const f0 = this.frameOn(main, from - 10), f1 = this.frameOn(main, from), f2 = this.frameOn(main, to), f3 = this.frameOn(main, to + 10);
      const first = b.points[0] ?? {};
      const bw = b.w ?? width;
      const cps: ControlPoint[] = [
        { p: [f0.pos.x, f0.pos.y, f0.pos.z] },
        { p: [f1.pos.x, f1.pos.y, f1.pos.z], w: bw, surface: first.surface, look: first.look, left: first.left, right: first.right, shoulder: first.shoulder, bank: 0 },
        ...b.points,
        { p: [f2.pos.x, f2.pos.y, f2.pos.z], w: bw, bank: 0 },
        { p: [f3.pos.x, f3.pos.y, f3.pos.z] },
      ];
      const p = buildPath(cps, { index: k + 1, id: b.id, closed: false, width: bw, step: 1, phantom: 1 });
      p.mainFrom = from;
      p.mainSpan = span;
      p.enabled = b.enabled ?? true;
      this.blendJunction(p);
      this.paths.push(p);
    });
    this.stats.paths = now() - t0;

    // 2. decks
    for (const d of def.decks ?? []) {
      const p = this.pathByRef(d.path);
      const s0 = resolveProgress(p, d.from), s1 = resolveProgress(p, d.to);
      this.decks.push({ path: p.index, s0, s1, style: d.style, rails: d.rails ?? true, model: d.model });
      for (let s = s0; s <= s1 + 1e-6; s += p.ds * 0.5) p.deck[rowAt(p, s, ROW).i] = 1;
    }

    // 3. spatial grid for locate
    this.buildGrid();

    // 4. terrain
    const t1 = now();
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.paths) for (const v of p.pos) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    this.terrain = new Terrain(def.terrain, { minX, maxX, minZ, maxZ });
    this.terrain.conform(this.paths, (p, i) => this.conformWeight(p, i));
    this.stats.terrainFixes = this.terrain.clearRoads(this.paths);
    this.stats.terrain = now() - t1;
    this.killY = this.terrain.minHeight() - 4;

    // 5. features
    this.host = {
      length: this.length,
      sample: (pr, lat, path, out) => this.sample(pr, lat, path, out),
      groundAt: (x, z, y) => this.groundAt(x, z, y),
      halfWidthAt: (pr) => this.sample(pr, 0, 0, FR).halfWidth,
    };
    this.buildFeatures();
    const t2 = now();
    this.buildRacingLines();
    this.stats.racingLine = now() - t2;
    this.buildBarriers();
    this.buildStructures();
    const t3 = now();
    this.buildScenery();
    this.stats.scenery = now() - t3;
    const t4 = now();
    this.buildColliders();
    this.stats.colliders = now() - t4;
    this.buildGridAndBoxes();
    this.buildBranches();
    this.buildHazards();
    for (const [k, v] of this.state.tags) this.initialTags.set(k, v);
    this.applyTags();
    this.stats.total = now() - t0;
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  pathByRef(ref: PathRef): BuiltPath {
    if (!ref || ref === 'main') return this.paths[0];
    const p = this.paths.find((q) => q.id === ref);
    if (!p) throw new Error(`track: unknown path '${ref}'`);
    return p;
  }

  /** Frame on a path at a path-local distance (no main mapping). */
  frameOn(p: BuiltPath, s: number, lat = 0, out: TrackFrame = emptyFrame()): TrackFrame {
    const r = rowAt(p, s, ROW);
    const { i, j, t } = r;
    out.pos.copy(p.pos[i]).lerp(p.pos[j], t);
    out.forward.copy(p.fwd[i]).lerp(p.fwd[j], t).normalize();
    out.right.copy(p.right[i]).lerp(p.right[j], t).normalize();
    out.up.copy(p.up[i]).lerp(p.up[j], t).normalize();
    out.halfWidth = p.hw[i] + (p.hw[j] - p.hw[i]) * t;
    if (lat !== 0) out.pos.addScaledVector(out.right, lat);
    return out;
  }

  /** Main progress -> path-local distance on a branch, or -1 if outside it. */
  localS(p: BuiltPath, progress: number): number {
    if (p.index === 0) return wrapS(p, progress);
    const L = this.length;
    const d = (((progress - p.mainFrom) % L) + L) % L;
    if (d > p.mainSpan) return -1;
    return (d / p.mainSpan) * p.length;
  }

  /** Path-local distance -> main progress. */
  mainProgress(p: BuiltPath, s: number): number {
    if (p.index === 0) return wrapS(p, s);
    return (p.mainFrom + (s / p.length) * p.mainSpan) % this.length;
  }

  /**
   * Where a branch still overlaps the main road near its junctions, it takes over the main
   * road's height and banking so the two surfaces coincide (the branch then sinks 2 cm below).
   */
  private blendJunction(p: BuiltPath): void {
    const main = this.paths[0];
    const F = emptyFrame();
    const weightAt = (i: number): { w: number; y: number; bank: number } => {
      const s = i * p.ds;
      const guess = this.mainProgress(p, s);
      let best = Infinity, bs = guess;
      for (let d = -40; d <= 40; d += 0.5) {
        const f = this.frameOn(main, guess + d, 0, F);
        const dd = (f.pos.x - p.pos[i].x) ** 2 + (f.pos.z - p.pos[i].z) ** 2;
        if (dd < best) { best = dd; bs = guess + d; }
      }
      this.frameOn(main, bs, 0, F);
      const rl = Math.hypot(F.right.x, F.right.z) || 1;
      const lat = ((p.pos[i].x - F.pos.x) * F.right.x + (p.pos[i].z - F.pos.z) * F.right.z) / (rl * rl);
      const H = F.halfWidth, h = p.hw[i];
      // fully blended while any part of the branch overlaps the main road, then fade out over 5 m
      const w = 1 - sstep(H + h - 1, H + h + 4, Math.abs(lat));
      return { w, y: F.pos.y + F.right.y * lat, bank: main.bank[rowAt(main, bs, ROW).i] };
    };
    // From each junction: follow the main road's (extended) plane while the branch overlaps it,
    // then ease into the designed height / banking over BAND rows.
    const n = p.count;
    const BAND = Math.min(30, Math.round(n * 0.25));
    const g = new Float32Array(n);
    const ty = new Float32Array(n), tb = new Float32Array(n);
    let a = 0, b = n - 1;
    while (a < n / 2 && weightAt(a).w >= 1) a++;
    while (b > n / 2 && weightAt(b).w >= 1) b--;
    for (let i = 0; i < n; i++) {
      const da = i - a, db = b - i;
      const ga = da <= 0 ? 1 : da < BAND ? 1 - sstep(0, BAND, da) : 0;
      const gb = db <= 0 ? 1 : db < BAND ? 1 - sstep(0, BAND, db) : 0;
      g[i] = Math.max(ga, gb);
      if (g[i] > 0) { const r = weightAt(i); ty[i] = r.y; tb[i] = r.bank; }
    }
    for (let i = 0; i < n; i++) {
      if (g[i] <= 0) continue;
      p.pos[i].y += (ty[i] - p.pos[i].y) * g[i];
      p.bank[i] += (tb[i] - p.bank[i]) * g[i];
    }
    computeFrames(p, [p.fwd[0].clone(), p.fwd[p.count - 1].clone()]);
  }

  private conformWeight(p: BuiltPath, i: number): number {
    if (!p.deck[i]) return 1;
    // ramp in over the last 4 m of a deck so the abutments meet the road
    let d = 0;
    const n = p.count;
    for (let k = 1; k <= 4; k++) {
      const a = p.closed ? (i - k + n) % n : Math.max(0, i - k);
      const b = p.closed ? (i + k) % n : Math.min(n - 1, i + k);
      if (!p.deck[a] || !p.deck[b]) { d = k; break; }
    }
    return d === 0 ? 0 : 1 - (d - 1) / 4;
  }

  // -------------------------------------------------------------------------
  // spatial grid + locate
  // -------------------------------------------------------------------------

  private buildGrid(): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.paths) for (const v of p.pos) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    const x0 = minX - REG - 20, z0 = minZ - REG - 20;
    const nx = Math.ceil((maxX - x0 + REG + 20) / CELL), nz = Math.ceil((maxZ - z0 + REG + 20) / CELL);
    const lists: number[][] = Array.from({ length: nx * nz }, () => []);
    for (const p of this.paths) {
      for (let a = 0; a < p.segments; a++) {
        const b = p.closed ? (a + 1) % p.count : a + 1;
        const A = p.pos[a], B = p.pos[b];
        const r = Math.max(p.hw[a], p.hw[b]) + REG;
        const i0 = Math.max(0, Math.floor((Math.min(A.x, B.x) - r - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((Math.max(A.x, B.x) + r - x0) / CELL));
        const j0 = Math.max(0, Math.floor((Math.min(A.z, B.z) - r - z0) / CELL)), j1 = Math.min(nz - 1, Math.floor((Math.max(A.z, B.z) + r - z0) / CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * nx + i].push(p.index * HINT_PATH + a);
      }
    }
    const start = new Int32Array(nx * nz + 1);
    let n = 0;
    for (let k = 0; k < lists.length; k++) { start[k] = n; n += lists[k].length; }
    start[lists.length] = n;
    const items = new Int32Array(n);
    const complex = new Uint8Array(nx * nz);
    for (let k = 0; k < lists.length; k++) {
      const l = lists[k];
      items.set(l, start[k]);
      if (l.length === 0) continue;
      let pmin = Infinity, pmax = -Infinity, rmin = Infinity, rmax = -Infinity;
      for (const v of l) {
        const pp = Math.floor(v / HINT_PATH), rr = v % HINT_PATH;
        pmin = Math.min(pmin, pp); pmax = Math.max(pmax, pp); rmin = Math.min(rmin, rr); rmax = Math.max(rmax, rr);
      }
      if (pmin !== pmax || rmax - rmin > 40) complex[k] = 1;
    }
    this.grid = { x0, z0, nx, nz, start, items, complex };
  }

  private project(p: BuiltPath, a: number, pos: Vector3, out: Proj): Proj {
    const b = p.closed ? (a + 1) % p.count : a + 1;
    const A = p.pos[a], B = p.pos[b];
    D.subVectors(B, A);
    const len2 = D.lengthSq() || 1;
    let t = (P1.subVectors(pos, A).dot(D)) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    P1.copy(A).addScaledVector(D, t);
    R1.copy(p.right[a]).lerp(p.right[b], t).normalize();
    U1.copy(p.up[a]).lerp(p.up[b], t).normalize();
    P2.subVectors(pos, P1);
    // beyond the segment ends (t clamped): longitudinal miss distance counts as well
    const along = t === 0 || t === 1 ? P2.dot(D) / Math.sqrt(len2) : 0;
    const lat = P2.dot(R1);
    const hw = p.hw[a] + (p.hw[b] - p.hw[a]) * t;
    P2.addScaledVector(R1, -lat);
    const h = P2.dot(U1);
    out.path = p.index; out.row = a; out.t = t; out.lat = lat; out.hw = hw; out.h = h;
    const ex = Math.max(0, Math.abs(lat) - hw);
    out.e = along === 0 ? ex : Math.sqrt(ex * ex + along * along);
    out.s = (a + t) * p.ds;
    return out;
  }

  private score(c: Proj, hintPath: number, hintRow: number): number {
    let v = c.e * c.e;
    const h = c.h;
    if (h < -1.5) v += (h + 1.5) * (h + 1.5) * 4;
    else if (h > 1) v += (h - 1) * (h - 1) * 0.12;
    if (hintPath >= 0) {
      const p = this.paths[c.path];
      let d = Math.abs(c.row - hintRow);
      if (p.closed) d = Math.min(d, p.count - d);
      if (c.path !== hintPath || d > 25) v += 3;
    }
    return v;
  }

  locate(pos: Vector3, hint?: TrackLocation, out: TrackLocation = emptyLoc()): TrackLocation {
    const g = this.grid;
    const hv = hint ? hint.hint : -1;
    let hp = hv >= 0 ? Math.floor(hv / HINT_PATH) : -1;
    let hr = hv >= 0 ? hv % HINT_PATH : -1;
    if (hp >= this.paths.length || (hp > 0 && !this.paths[hp].enabled)) { hp = -1; hr = -1; }
    const ci = Math.floor((pos.x - g.x0) / CELL), cj = Math.floor((pos.z - g.z0) / CELL);
    const inGrid = ci >= 0 && cj >= 0 && ci < g.nx && cj < g.nz;
    const cell = inGrid ? cj * g.nx + ci : -1;
    let found = false;

    // fast path: simple cell, local window around the hint
    if (cell >= 0 && hp >= 0 && !g.complex[cell] && g.start[cell + 1] > g.start[cell] && Math.floor(g.items[g.start[cell]] / HINT_PATH) === hp) {
      const p = this.paths[hp];
      let bestV = Infinity;
      for (let k = -3; k <= 3; k++) {
        let a = hr + k;
        if (p.closed) a = (a + p.segments) % p.segments;
        else if (a < 0 || a >= p.segments) continue;
        this.project(p, a, pos, CAND);
        const v = this.score(CAND, hp, hr);
        if (v < bestV) { bestV = v; copyProj(BEST, CAND); }
      }
      const edge = (BEST.row === ((hr - 3 + p.segments) % p.segments) && BEST.t === 0) || (BEST.row === (hr + 3) % p.segments && BEST.t === 1);
      if (bestV < Infinity && !edge) found = true;
    }
    if (!found && cell >= 0 && g.start[cell + 1] > g.start[cell]) {
      let bestV = Infinity;
      for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
        const v0 = g.items[k];
        const p = this.paths[Math.floor(v0 / HINT_PATH)];
        if (!p.enabled) continue;
        this.project(p, v0 % HINT_PATH, pos, CAND);
        const v = this.score(CAND, hp, hr);
        if (v < bestV) { bestV = v; copyProj(BEST, CAND); }
      }
      found = bestV < Infinity;
    }
    if (!found) {
      // far away: brute force over everything
      let bestV = Infinity;
      for (const p of this.paths) {
        if (!p.enabled) continue;
        for (let a = 0; a < p.segments; a++) {
          this.project(p, a, pos, CAND);
          const v = CAND.e * CAND.e + Math.max(0, -CAND.h - 1.5) * 4;
          if (v < bestV) { bestV = v; copyProj(BEST, CAND); }
        }
      }
    }
    const p = this.paths[BEST.path];
    out.path = BEST.path;
    out.progress = this.mainProgress(p, BEST.s);
    out.lat = BEST.lat;
    out.halfWidth = BEST.hw;
    out.height = BEST.h;
    out.onRoad = Math.abs(BEST.lat) <= BEST.hw;
    out.hint = BEST.path * HINT_PATH + BEST.row;
    return out;
  }

  sample(progress: number, lat = 0, path = 0, out: TrackFrame = emptyFrame()): TrackFrame {
    let p = this.paths[path] ?? this.paths[0];
    let s = this.localS(p, progress);
    if (s < 0) { p = this.paths[0]; s = wrapS(p, progress); }
    return this.frameOn(p, s, lat, out);
  }

  racingLine(progress: number, path = 0): { lat: number; speed: number } {
    let p = this.paths[path] ?? this.paths[0];
    let s = this.localS(p, progress);
    if (s < 0) { p = this.paths[0]; s = wrapS(p, progress); }
    const { i, j, t } = rowAt(p, s, ROW);
    const L = this.rlLat[p.index], S = this.rlSpeed[p.index];
    RL.lat = L[i] + (L[j] - L[i]) * t;
    RL.speed = S[i] + (S[j] - S[i]) * t;
    return RL;
  }

  respawn(loc: TrackLocation): Pose {
    let path = loc.path;
    let progress = loc.progress - 4;
    if (path > 0 && !this.paths[path]?.enabled) path = 0;
    if (path === 0) {
      for (const r of this.def.respawn ?? []) {
        const main = this.paths[0];
        const a = wrapS(main, resolveProgress(main, r.from)), b = wrapS(main, resolveProgress(main, r.to));
        const inside = a <= b ? progress >= a && progress <= b : progress >= a || progress <= b;
        if (inside) { progress = resolveProgress(main, r.at); break; }
      }
    }
    const line = this.racingLine(progress, path);
    const f = this.sample(progress, 0, path);
    const lat = Math.max(-f.halfWidth + 2, Math.min(f.halfWidth - 2, line.lat * 0.5));
    this.sample(progress, lat, path, f);
    return poseFromFrame(f, 0.05);
  }

  /** Height of the ground at x/z: road / shoulder if there is one near `yHint`, else terrain. */
  groundAt(x: number, z: number, yHint?: number): number {
    GP.set(x, yHint ?? this.terrain.heightAt(x, z) + 1, z);
    const l = this.locate(GP, undefined, GL);
    const p = this.paths[l.path];
    const ext = l.halfWidth + p.shoulder[Math.floor(l.hint % HINT_PATH)] ;
    const terr = this.terrain.heightAt(x, z);
    if (Math.abs(l.lat) <= ext && Math.abs(l.height) < 3) {
      const roadY = GP.y - l.height; // approx (up ~ Y)
      return Math.max(terr, roadY - (Math.abs(l.lat) > l.halfWidth ? SHOULDER_DROP : 0));
    }
    return terr;
  }

  /** Road surface point on a path row (with the small drop that keeps overlapping roads apart). */
  roadPoint(p: BuiltPath, i: number, lat: number, out: Vector3): Vector3 {
    out.copy(p.pos[i]).addScaledVector(p.right[i], lat);
    if (p.index > 0) out.y -= this.overlapDrop(p, out);
    return out;
  }

  /** Branch roads sink 2 cm per level where they overlap a road of a lower index. */
  private overlapDrop(p: BuiltPath, v: Vector3): number {
    const g = this.grid;
    const ci = Math.floor((v.x - g.x0) / CELL), cj = Math.floor((v.z - g.z0) / CELL);
    if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.nz) return 0;
    const cell = cj * g.nx + ci;
    for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
      const v0 = g.items[k];
      const q = Math.floor(v0 / HINT_PATH);
      if (q >= p.index) continue;
      this.project(this.paths[q], v0 % HINT_PATH, v, OV);
      // inside the other road's footprint: stay at least 2 cm (per level) below its surface
      if (OV.e < 0.05 && Math.abs(OV.h) < 1) return Math.max(0, OV.h + 0.02 * (p.index - q));
    }
    return 0;
  }

  /**
   * A road whose footprint (+margin) contains v within maxDy vertically, ignoring path `self`
   * rows within `gap` of `row`. Returns its surface height or null.
   */
  otherRoadAt(v: Vector3, self: number, row: number, gap: number, margin: number, maxDy: number): number | null {
    const g = this.grid;
    const ci = Math.floor((v.x - g.x0) / CELL), cj = Math.floor((v.z - g.z0) / CELL);
    if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.nz) return null;
    const cell = cj * g.nx + ci;
    let best: number | null = null;
    for (let k = g.start[cell]; k < g.start[cell + 1]; k++) {
      const v0 = g.items[k];
      const q = Math.floor(v0 / HINT_PATH), a = v0 % HINT_PATH;
      const p = this.paths[q];
      if (q === self) {
        let d = Math.abs(a - row);
        if (p.closed) d = Math.min(d, p.count - d);
        if (d < gap) continue;
      }
      this.project(p, a, v, OV);
      if (OV.e > margin || Math.abs(OV.h) > maxDy) continue;
      // junction rows: a branch end and the main road share the start/end
      const y = v.y - OV.h;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // features
  // -------------------------------------------------------------------------

  private buildFeatures(): void {
    const def = this.def;
    for (const b of def.boostPads ?? []) {
      const p = this.pathByRef(b.path);
      this.pads.push({ path: p.index, s0: wrapS(p, resolveProgress(p, b.at)), length: b.length ?? 6, lat: b.lat ?? 0, width: b.width ?? 3.2, duration: b.duration ?? 1.2 });
    }
    for (const r of def.ramps ?? []) {
      const p = this.pathByRef(r.path);
      const s0 = wrapS(p, resolveProgress(p, r.at));
      const hw = this.frameOn(p, s0).halfWidth;
      const ramp: BuiltRamp = { path: p.index, s0, length: r.length ?? 7, height: r.height ?? 1.2, lat: r.lat ?? 0, width: r.width ?? hw * 2, surface: r.surface ?? 'road' };
      this.ramps.push(ramp);
      const trick = r.trick ?? 30;
      if (trick > 0) {
        const z: TrackZone = { kind: 'trick', path: p.index, from: this.mainProgress(p, s0 + ramp.length - 1), to: this.mainProgress(p, s0 + ramp.length + trick), enabled: true };
        this.zones.push(z);
      }
    }
    for (const z of def.zones ?? []) {
      const p = this.pathByRef(z.path);
      const zone: TrackZone = {
        kind: z.kind, path: p.index, from: this.mainProgress(p, resolveProgress(p, z.from)), to: this.mainProgress(p, resolveProgress(p, z.to)),
        latMin: z.latMin, latMax: z.latMax, enabled: z.enabled ?? true,
      };
      this.zones.push(zone);
      if (z.tag) { this.zoneTags.set(zone, z.tag); this.declareTag(z.tag, zone.enabled); }
    }
    for (const pt of def.patches ?? []) {
      const p = this.pathByRef(pt.path);
      this.patches.push({ path: p.index, s0: resolveProgress(p, pt.from), s1: resolveProgress(p, pt.to), latMin: pt.latMin, latMax: pt.latMax, surface: pt.surface, tag: pt.tag });
    }
    for (const b of def.branches ?? []) if (b.tag) this.declareTag(b.tag, b.enabled ?? true);
  }

  private declareTag(tag: string, enabled: boolean): void {
    if (!this.state.tags.has(tag)) this.state.tags.set(tag, enabled);
  }

  // -------------------------------------------------------------------------
  // racing line: minimum curvature within the road, then a speed profile
  // -------------------------------------------------------------------------

  private buildRacingLines(): void {
    const drv = this.def.driving ?? {};
    const aLat = drv.lateralAccel ?? 20, aBrake = drv.brake ?? 16, aAcc = drv.accel ?? 9, top = drv.topSpeed ?? KART.topSpeed;
    for (const p of this.paths) {
      const stride = 2;
      const m = p.closed ? Math.floor(p.count / stride) : Math.floor((p.count - 1) / stride) + 1;
      const rowOf = (k: number) => (p.closed ? (k * stride) % p.count : Math.min(p.count - 1, k * stride));
      const cx = new Float64Array(m), cz = new Float64Array(m), rx = new Float64Array(m), rz = new Float64Array(m), lim = new Float64Array(m), lat = new Float64Array(m);
      for (let k = 0; k < m; k++) {
        const i = rowOf(k);
        cx[k] = p.pos[i].x; cz[k] = p.pos[i].z;
        const rl = Math.hypot(p.right[i].x, p.right[i].z) || 1;
        rx[k] = p.right[i].x / rl; rz[k] = p.right[i].z / rl;
        lim[k] = Math.max(0, p.hw[i] - 1.8);
      }
      const idx = (k: number) => (p.closed ? (k + m) % m : Math.max(0, Math.min(m - 1, k)));
      const px = (k: number) => cx[idx(k)] + rx[idx(k)] * lat[idx(k)];
      const pz = (k: number) => cz[idx(k)] + rz[idx(k)] * lat[idx(k)];
      const pinned = (k: number) => !p.closed && (k < 3 || k > m - 4);
      for (let it = 0; it < 1500; it++) {
        for (let k = 0; k < m; k++) {
          if (pinned(k)) continue;
          const tx = (-px(k - 2) + 4 * px(k - 1) + 4 * px(k + 1) - px(k + 2)) / 6;
          const tz = (-pz(k - 2) + 4 * pz(k - 1) + 4 * pz(k + 1) - pz(k + 2)) / 6;
          const want = (tx - cx[k]) * rx[k] + (tz - cz[k]) * rz[k];
          const v = lat[k] + (want - lat[k]) * 1.2;
          lat[k] = Math.max(-lim[k], Math.min(lim[k], v));
        }
      }
      // pull towards boost pads on this path
      for (const pad of this.pads) {
        if (pad.path !== p.index) continue;
        for (let k = 0; k < m; k++) {
          let s = rowOf(k) * p.ds;
          let d = s - pad.s0;
          if (p.closed) { if (d > p.length / 2) d -= p.length; if (d < -p.length / 2) d += p.length; }
          let w = 0;
          if (d >= -30 && d < -8) w = sstep(-30, -8, d);
          else if (d >= -8 && d <= pad.length) w = 1;
          else if (d > pad.length && d < pad.length + 10) w = 1 - sstep(pad.length, pad.length + 10, d);
          if (w > 0) lat[k] = Math.max(-lim[k], Math.min(lim[k], lat[k] + (pad.lat - lat[k]) * w));
          s = 0;
        }
      }
      // speed profile
      const v = new Float64Array(m);
      const seg = p.ds * stride;
      for (let k = 0; k < m; k++) {
        const ax = px(k - 1), az = pz(k - 1), bx = px(k), bz = pz(k), cxx = px(k + 1), czz = pz(k + 1);
        const cross = (bx - ax) * (czz - az) - (bz - az) * (cxx - ax);
        const la = Math.hypot(bx - ax, bz - az), lb = Math.hypot(cxx - bx, czz - bz), lc = Math.hypot(cxx - ax, czz - az);
        const kap = la * lb * lc > 1e-9 ? (2 * Math.abs(cross)) / (la * lb * lc) : 0;
        const i = rowOf(k);
        const turnSign = -Math.sign(cross); // >0 right turn
        const bank = (p.bank[i] * Math.PI) / 180;
        const a = Math.max(aLat * 0.6, aLat + 9.8 * Math.sin(bank) * turnSign);
        const sf = SURFACES[p.surface[i]]?.speed ?? 1;
        v[k] = Math.min(top * sf, kap > 1e-6 ? Math.sqrt(a / kap) : top);
      }
      const passes = p.closed ? 2 : 1;
      for (let ps = 0; ps < passes; ps++) {
        for (let k = (p.closed ? m - 1 : m - 2); k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[idx(k + 1)] ** 2 + 2 * aBrake * seg));
        for (let k = (p.closed ? 0 : 1); k < m; k++) v[k] = Math.min(v[k], Math.sqrt(v[idx(k - 1)] ** 2 + 2 * aAcc * seg * 4));
      }
      const L = new Float32Array(p.count), S = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        const f = i / stride;
        const k0 = Math.floor(f), t = f - k0;
        const a = idx(k0), b = idx(k0 + 1);
        L[i] = lat[a] + (lat[b] - lat[a]) * t;
        S[i] = Math.max(0.3, Math.min(1, (v[a] + (v[b] - v[a]) * t) / top));
      }
      this.rlLat[p.index] = L;
      this.rlSpeed[p.index] = S;
    }
  }

  /** Time to drive [s0, s0 + len] on a path along its racing line (s). */
  private lineTime(p: BuiltPath, s0: number, len: number, boostDist = 0): number {
    const top = this.def.driving?.topSpeed ?? KART.topSpeed;
    let t = 0;
    for (let d = 0; d < len; d += p.ds) {
      const i = rowAt(p, s0 + d, ROW).i;
      const v = d < boostDist ? top * KART.boostPower : this.rlSpeed[p.index][i] * top;
      t += p.ds / Math.max(3, v);
    }
    return t;
  }

  private buildBranches(): void {
    (this.def.branches ?? []).forEach((b, k) => {
      const p = this.paths[k + 1];
      const main = this.paths[0];
      const mid = this.frameOn(p, p.length / 2);
      const ml = this.locate(mid.pos, undefined, emptyLoc());
      // side relative to the main path at the same progress
      const mf = this.sample(ml.progress, 0, 0);
      const side = (mid.pos.clone().sub(mf.pos).dot(mf.right) >= 0 ? 1 : -1) as -1 | 1;
      const mainT = this.lineTime(main, p.mainFrom, p.mainSpan);
      const brT = this.lineTime(p, 0, p.length, b.needsBoost ? 2.5 * KART.topSpeed * KART.boostPower : 0);
      const gain = b.gain ?? Math.round((mainT - brT) * 100) / 100;
      const tb: TrackBranch = { path: p.index, from: p.mainFrom, to: (p.mainFrom + p.mainSpan) % this.length, side, gain, risk: b.risk, needsBoost: b.needsBoost, enabled: p.enabled };
      this.branches.push(tb);
      if (b.tag) this.branchTags.set(tb, b.tag);
      this.stats[`branch.${b.id}.length`] = Math.round(p.length);
      this.stats[`branch.${b.id}.mainSpan`] = Math.round(p.mainSpan);
      this.stats[`branch.${b.id}.gain`] = gain;
    });
  }

  // -------------------------------------------------------------------------
  // barriers
  // -------------------------------------------------------------------------

  private buildBarriers(): void {
    const styleOf = (k: string): BarrierStyle => (k === 'wall' ? 'stone' : k === 'hedge' ? 'hedge' : 'wood');
    const heightOf: Record<string, number> = { fence: 1.15, rail: 0.75, wall: 0.95, hedge: 1.7, boundary: 1.15, deckRail: 1.0 };
    const V = new Vector3();
    for (const p of this.paths) {
      for (const side of [-1, 1] as const) {
        let cur: Barrier | null = null;
        const close = () => { if (cur && cur.pts.length >= 2) this.barriers.push(cur); cur = null; };
        const rows = p.closed ? p.count + 1 : p.count;
        for (let ii = 0; ii < rows; ii += 2) {
          const i = ii % p.count;
          const edge: EdgeDef = side < 0 ? p.left[i] : p.rightEdge[i];
          let kind: Barrier['kind'];
          let off: number;
          let style: BarrierStyle;
          if (p.deck[i]) {
            const dk = this.decks.find((d) => d.path === p.index && i * p.ds >= d.s0 - 1 && i * p.ds <= d.s1 + 1);
            if (!dk || !dk.rails) { close(); continue; }
            kind = 'deckRail'; off = 0.4; style = dk.style === 'stone' ? 'stone' : 'wood';
          } else if (edge.kind === 'none') { close(); continue; }
          else if (edge.kind === 'open') { kind = 'boundary'; off = edge.reach ?? 22; style = 'wood'; }
          else { kind = edge.kind; off = edge.offset ?? EDGE_DEFAULT_OFFSET[edge.kind]; style = styleOf(edge.kind); }
          const hgt = edge.height ?? heightOf[kind];
          const lat = side * (p.hw[i] + off);
          // inside of a tight turn: offset curve folds over
          if (p.curv[i] * side > 0 && Math.abs(lat) > 0.85 / Math.abs(p.curv[i])) { close(); continue; }
          V.copy(p.pos[i]).addScaledVector(p.right[i], lat);
          const onPlane = Math.abs(lat) <= p.hw[i] + p.shoulder[i];
          if (kind === 'deckRail') V.copy(p.pos[i]).addScaledVector(p.right[i], lat);
          else V.y = onPlane ? V.y - SHOULDER_DROP : this.terrain.heightAt(V.x, V.z);
          if (!this.terrain.inGrid(V.x, V.z)) { close(); continue; }
          // never across another road; skip open water
          if (kind !== 'deckRail' && this.otherRoadAt(V, p.index, i, 30, p.index > 0 || kind === 'boundary' ? 2.5 : 1.5, 4) !== null) { close(); continue; }
          if (kind !== 'deckRail' && this.terrain.waterLevelAt(V.x, V.z) !== null) { close(); continue; }
          if (kind === 'boundary' && this.terrain.roadDistAt(V.x, V.z) < off - 4) { close(); continue; }
          if (!cur || cur.kind !== kind || cur.style !== style || cur.height !== hgt || (cur.catch ?? 0) !== (edge.catchHeight ?? 0)) {
            const last: Vector3 | undefined = cur ? (cur as Barrier).pts[(cur as Barrier).pts.length - 1] : undefined;
            close();
            cur = { kind, style, height: hgt, pts: [], catch: edge.catchHeight };
            // close the outline when the edge kind changes (no gaps to slip through)
            if (last && last.distanceTo(V) < 25) cur.pts.push(last.clone());
          }
          (cur as Barrier).pts.push(V.clone());
        }
        close();
      }
    }
  }

  // -------------------------------------------------------------------------
  // structures (drive-through barn)
  // -------------------------------------------------------------------------

  private buildStructures(): void {
    for (const s of this.def.structures ?? []) {
      const p = this.pathByRef(s.path);
      const sc = resolveProgress(p, s.at);
      const f = this.frameOn(p, sc);
      const fwd = f.forward.clone().setY(0).normalize();
      const right = new Vector3().crossVectors(fwd, UP).normalize();
      this.structures.push({ type: s.type, path: p.index, s: sc, center: f.pos.clone(), fwd, right, length: s.length, width: s.width, height: s.height, doorsTag: s.doorsTag, model: s.model ?? 'barn', doors: s.doors ?? 'entry' });
      this.declareTag(s.doorsTag, true);
    }
  }

  // -------------------------------------------------------------------------
  // scenery
  // -------------------------------------------------------------------------

  private buildScenery(): void {
    const def = this.def;
    const T = this.terrain;
    const clear: { x: number; z: number; r: number }[] = [];
    const F = emptyFrame();
    for (const pp of def.props ?? []) {
      let x: number, z: number, yaw = ((pp.rot ?? 0) * Math.PI) / 180, y: number;
      if (pp.pos) { x = pp.pos[0]; z = pp.pos[1]; }
      else {
        const p = this.pathByRef(pp.path);
        this.frameOn(p, wrapS(p, resolveProgress(p, pp.at ?? 0)), pp.lat ?? 0, F);
        x = F.pos.x; z = F.pos.z;
        yaw += Math.atan2(F.forward.x, F.forward.z);
      }
      y = pp.y ?? this.groundAt(x, z) + (pp.dy ?? 0);
      if (pp.y !== undefined) y += pp.dy ?? 0;
      this.props.push({ name: pp.name, x, y, z, yaw, scale: (pp.scale ?? 1) * (pp.flip ? -1 : 1), tag: pp.tag, detail: false, keep: 0, dist: this.terrain.roadDistAt(x, z) });
      if (pp.tag) this.declareTag(pp.tag, true);
      const r = pp.clear ?? (typeof pp.solid === 'number' ? pp.solid + 1.5 : Array.isArray(pp.solid) ? Math.hypot(pp.solid[0], pp.solid[1]) / 2 + 1.5 : 2);
      clear.push({ x, z, r });
    }
    for (const st of this.structures) clear.push({ x: st.center.x, z: st.center.z, r: Math.hypot(st.length, st.width) / 2 + 3 });

    (def.scatter ?? []).forEach((rule, ri) => {
      const rng = createRng(rule.seed ?? 1000 + ri * 7919);
      const cs = Math.sqrt(1000 / rule.density);
      const x0 = T.x0, z0 = T.z0, x1 = T.x0 + (T.nx - 1) * T.cell, z1 = T.z0 + (T.nz - 1) * T.cell;
      const total = rule.props.reduce((a, p) => a + (p.weight ?? 1), 0);
      for (let gz = z0; gz < z1; gz += cs) for (let gx = x0; gx < x1; gx += cs) {
        const x = gx + rng.next() * cs, z = gz + rng.next() * cs;
        const pick = rng.next() * total, r0 = rng.next(), r1 = rng.next(), r2 = rng.next(), keep = rng.next();
        if (rule.regions && !rule.regions.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.radius)) continue;
        if (rule.exclude && rule.exclude.some((c) => Math.hypot(x - c.at[0], z - c.at[1]) < c.radius)) continue;
        const d = T.roadDistAt(x, z);
        let mul = 0;
        for (const [a, b, mm] of rule.bands) if (d >= a && d < b) { mul = mm; break; }
        if (mul <= 0 || r0 >= mul) continue;
        if (d < (rule.solid ? 4.5 : 3)) continue;
        if (T.waterDist(x, z) < (rule.waterGap ?? 1.5)) continue;
        if (T.slopeAt(x, z) > (rule.maxSlope ?? 0.7)) continue;
        if (clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
        if (this.nearBarrierOrDeck(x, z, rule.solid ? 1.6 : 0.8)) continue;
        let acc = 0, chosen = rule.props[0];
        for (const p of rule.props) { acc += p.weight ?? 1; if (pick < acc) { chosen = p; break; } }
        const sc = chosen.scale ?? [0.85, 1.2];
        const scale = sc[0] + (sc[1] - sc[0]) * r1;
        const yaw = rule.spin === false ? 0 : r2 * Math.PI * 2;
        // Only props karts can reach are solid (and always shown); far ones are thinned by quality.
        const solid = !!rule.solid && d < 32;
        this.props.push({ name: chosen.name, x, y: T.heightAt(x, z), z, yaw, scale, tag: rule.tag, detail: !solid, keep, dist: d });
        if (solid) this.solidTrees.push({ x, y: T.heightAt(x, z), z, r: rule.solid! * scale });
      }
      if (rule.tag) this.declareTag(rule.tag, true);
    });
  }

  private solidTrees: { x: number; y: number; z: number; r: number }[] = [];
  private barrierIndex: { x: number; z: number }[] | null = null;

  private nearBarrierOrDeck(x: number, z: number, r: number): boolean {
    if (!this.barrierIndex) {
      this.barrierIndex = [];
      for (const b of this.barriers) for (let k = 0; k < b.pts.length; k++) {
        const a = b.pts[k], c = b.pts[Math.min(b.pts.length - 1, k + 1)];
        this.barrierIndex.push({ x: a.x, z: a.z }, { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 });
      }
    }
    for (const q of this.barrierIndex) if (Math.abs(q.x - x) < r && Math.abs(q.z - z) < r) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // colliders
  // -------------------------------------------------------------------------

  private addCollider(id: string, kind: 'ground' | 'wall', surface: SurfaceType, m: MeshAcc, tag?: string): TrackCollider | null {
    if (m.i.length === 0) return null;
    const c: TrackCollider = { id, kind, surface, vertices: new Float32Array(m.v), indices: new Uint32Array(m.i), enabled: true };
    this.colliders.push(c);
    if (tag) { this.colliderTags.set(c, tag); this.declareTag(tag, true); }
    return c;
  }

  private buildColliders(): void {
    const A = new Vector3(), B = new Vector3();
    // roads, grouped by surface
    const roads = new Map<SurfaceType, MeshAcc>();
    for (const p of this.paths) {
      for (let i = 0; i < p.segments; i++) {
        const j = p.closed ? (i + 1) % p.count : i + 1;
        const surf = p.surface[i];
        let m = roads.get(surf);
        if (!m) roads.set(surf, (m = new MeshAcc()));
        const key = (r: number, s: number) => `${p.index}:${r}:${s}`;
        // main: the cross-section is a straight line, one quad is exact; branches use the render
        // columns so that clamping under an overlapped road stays local
        const cols = p.index === 0 ? [-1, 1] : ROAD_COLS;
        for (let c = 0; c < cols.length - 1; c++) {
          const l0 = m.addV(this.roadPoint(p, i, cols[c] * p.hw[i], A), key(i, c)), r0 = m.addV(this.roadPoint(p, i, cols[c + 1] * p.hw[i], B), key(i, c + 1));
          const l1 = m.addV(this.roadPoint(p, j, cols[c] * p.hw[j], A), key(j, c)), r1 = m.addV(this.roadPoint(p, j, cols[c + 1] * p.hw[j], B), key(j, c + 1));
          m.tri(l0, r0, l1); m.tri(r0, r1, l1);
        }
      }
    }
    for (const [surf, m] of roads) this.addCollider(surf === 'road' ? 'road' : `road.${surf}`, 'ground', surf, m);

    // shoulders + skirts
    const sh = new MeshAcc();
    for (const p of this.paths) {
      for (let i = 0; i < p.segments; i++) {
        const j = p.closed ? (i + 1) % p.count : i + 1;
        if (p.deck[i] || p.deck[j]) continue;
        for (const side of [-1, 1]) {
          const ids: number[][] = [];
          for (const r of [i, j]) {
            const row: number[] = [];
            for (const [k, lat, drop] of this.shoulderProfile(p, r)) {
              this.shoulderPoint(p, r, side * lat, drop, A);
              row.push(sh.addV(A, `${p.index}:${r}:${side}:${k}`));
            }
            ids.push(row);
          }
          for (let k = 0; k < 2; k++) {
            const a = ids[0][k], b = ids[0][k + 1], c = ids[1][k], d = ids[1][k + 1];
            if (side > 0) { sh.tri(a, b, c); sh.tri(b, d, c); } else { sh.tri(b, a, d); sh.tri(a, c, d); }
          }
        }
      }
    }
    this.addCollider('shoulder', 'ground', 'offroad', sh);

    // terrain, grouped by surface
    const T = this.terrain;
    const terr = new Map<SurfaceType, MeshAcc>();
    for (let j = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) {
      const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
      const tris: [number, number][][] = [[[0, 0], [1, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]]];
      for (const t of tris) {
        const cx = x + ((t[0][0] + t[1][0] + t[2][0]) / 3) * T.cell, cz = z + ((t[0][1] + t[1][1] + t[2][1]) / 3) * T.cell;
        const surf = T.surfaceAt(cx, cz);
        let m = terr.get(surf);
        if (!m) terr.set(surf, (m = new MeshAcc()));
        const ids = t.map(([a, b]) => m!.add(x + a * T.cell, T.h[(j + b) * T.nx + i + a], z + b * T.cell, `${i + a}:${j + b}`));
        m.tri(ids[0], ids[1], ids[2]);
      }
    }
    for (const [surf, m] of terr) this.addCollider(surf === 'offroad' ? 'terrain' : `terrain.${surf}`, 'ground', surf, m);

    // boost pads and surface patches (thin overlays)
    const pads = new MeshAcc();
    for (const pad of this.pads) this.overlay(pads, this.paths[pad.path], pad.s0, pad.s0 + pad.length, pad.lat - pad.width / 2, pad.lat + pad.width / 2, 0.02);
    this.addCollider('pads', 'ground', 'boost', pads);
    const patchGroups = new Map<string, { surf: SurfaceType; tag?: string; m: MeshAcc }>();
    for (const pt of this.patches) {
      const k = `${pt.surface}:${pt.tag ?? ''}`;
      let g = patchGroups.get(k);
      if (!g) patchGroups.set(k, (g = { surf: pt.surface, tag: pt.tag, m: new MeshAcc() }));
      this.overlay(g.m, this.paths[pt.path], pt.s0, pt.s1, pt.latMin, pt.latMax, 0.012);
    }
    for (const [k, g] of patchGroups) this.addCollider(`patch.${k.replace(/:$/, '')}`, 'ground', g.surf, g.m, g.tag);

    // ramps
    const ramps = new Map<SurfaceType, MeshAcc>();
    for (const r of this.ramps) {
      let m = ramps.get(r.surface);
      if (!m) ramps.set(r.surface, (m = new MeshAcc()));
      this.rampMesh(m, r);
    }
    for (const [surf, m] of ramps) this.addCollider(surf === 'road' ? 'ramps' : `ramps.${surf}`, 'ground', surf, m);

    // walls: barriers
    const walls = new MeshAcc();
    for (const b of this.barriers) this.wallStrip(walls, b.pts, -0.4, b.height + Math.max(0.5, b.catch ?? 0));
    // under-deck curtains: nobody drives under a bridge unless a road passes there
    for (const d of this.decks) {
      const p = this.paths[d.path];
      const F = emptyFrame();
      for (const side of [-1, 1]) {
        let prev: Vector3 | null = null;
        for (let s = d.s0; s <= d.s1 + 1e-6; s += 2) {
          this.frameOn(p, s, side * (this.frameOn(p, s, 0, F).halfWidth + 0.4), F);
          const g = this.terrain.heightAt(F.pos.x, F.pos.z) - 0.3;
          const top = F.pos.y - 0.6;
          const probe = new Vector3(F.pos.x, g + 1, F.pos.z);
          const roadBelow = this.otherRoadAt(probe, p.index, Math.round(s / p.ds), 40, 4, 3) !== null;
          if (top - g < 0.5 || roadBelow) { prev = null; continue; }
          const cur = new Vector3(F.pos.x, g, F.pos.z);
          if (prev) this.wallStrip(walls, [prev, cur], 0, top - Math.min(prev.y, g));
          prev = cur;
        }
      }
    }
    this.addCollider('walls', 'wall', 'wall', walls);
    // solid props + trees
    const solid = new MeshAcc();
    for (const pp of this.def.props ?? []) {
      if (!pp.solid) continue;
      const placed = this.props.find((q) => q.name === pp.name && !q.detail && q.tag === pp.tag && (pp.pos ? q.x === pp.pos[0] && q.z === pp.pos[1] : true));
      if (!placed) continue;
      const h = pp.solidHeight ?? 4;
      const sc = Math.abs(placed.scale);
      if (typeof pp.solid === 'number') this.prism(solid, placed.x, placed.y - 0.5, placed.z, pp.solid * sc, h);
      else this.box(solid, placed.x, placed.y - 0.5, placed.z, pp.solid[0] * sc, pp.solid[1] * sc, placed.yaw, h);
    }
    for (const t of this.solidTrees) this.prism(solid, t.x, t.y - 0.5, t.z, t.r, 3.5);
    this.addCollider('walls.props', 'wall', 'wall', solid);
    // structures
    for (const st of this.structures) {
      const w = new MeshAcc(), d = new MeshAcc();
      const c = st.center, hl = st.length / 2, hwd = st.width / 2;
      for (const side of [-1, 1]) {
        const a = c.clone().addScaledVector(st.fwd, -hl).addScaledVector(st.right, side * hwd);
        const b = c.clone().addScaledVector(st.fwd, hl).addScaledVector(st.right, side * hwd);
        a.y = this.groundAt(a.x, a.z, c.y + 1); b.y = this.groundAt(b.x, b.z, c.y + 1);
        this.wallStrip(w, [a, b], -0.5, st.height);
      }
      for (const end of st.doors === 'both' ? [-1, 1] : [-1]) {
        const a = c.clone().addScaledVector(st.fwd, end * hl).addScaledVector(st.right, -hwd);
        const b = c.clone().addScaledVector(st.fwd, end * hl).addScaledVector(st.right, hwd);
        a.y = c.y; b.y = c.y;
        this.wallStrip(d, [a, b], -0.5, st.height * 0.8);
      }
      this.addCollider(`walls.${st.type}`, 'wall', 'wall', w);
      this.addCollider(`door.${st.doorsTag}`, 'wall', 'wall', d, st.doorsTag);
    }
  }

  /** Lateral profile of a shoulder: [key, |lat|, drop below the road plane]. */
  shoulderProfile(p: BuiltPath, i: number): [number, number, number][] {
    return [[0, p.hw[i], SHOULDER_DROP], [1, p.hw[i] + p.shoulder[i], SHOULDER_DROP], [2, p.hw[i] + p.shoulder[i] + SKIRT_W, SKIRT_DROP]];
  }

  /** Shoulder vertex; dives under any other road it would cover. */
  shoulderPoint(p: BuiltPath, i: number, lat: number, drop: number, out: Vector3): Vector3 {
    out.copy(p.pos[i]).addScaledVector(p.right[i], lat);
    out.y -= drop;
    const other = this.otherRoadAt(out, p.index, i, 12, 0.3, 2);
    if (other !== null && out.y > other - 0.05) out.y = other - 0.05;
    return out;
  }

  private overlay(m: MeshAcc, p: BuiltPath, s0: number, s1: number, l0: number, l1: number, lift: number): void {
    const A = new Vector3(), B = new Vector3(), F = emptyFrame();
    const n = Math.max(1, Math.ceil((s1 - s0) / 1));
    let pa = -1, pb = -1;
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      this.frameOn(p, s, 0, F);
      A.copy(F.pos).addScaledVector(F.right, l0).addScaledVector(F.up, lift);
      B.copy(F.pos).addScaledVector(F.right, l1).addScaledVector(F.up, lift);
      if (p.index > 0) { A.y -= this.overlapDrop(p, A); B.y -= this.overlapDrop(p, B); }
      const a = m.addV(A), b = m.addV(B);
      if (k > 0) { m.tri(pa, pb, a); m.tri(pb, b, a); }
      pa = a; pb = b;
    }
  }

  /** Ramp profile: height at fraction t of its length. */
  static rampHeight(r: BuiltRamp, t: number): number {
    const u = Math.min(1, Math.max(0, t));
    return r.height * (0.55 * u + 0.45 * u * u);
  }

  rampMesh(m: MeshAcc, r: BuiltRamp): void {
    const p = this.paths[r.path];
    const F = emptyFrame();
    const n = Math.max(4, Math.ceil(r.length / 0.5));
    const rows: number[][] = [];
    const l0 = r.lat - r.width / 2, l1 = r.lat + r.width / 2;
    const pt = (s: number, lat: number, h: number) => {
      this.frameOn(p, s, lat, F);
      return m.add(F.pos.x + F.up.x * h, F.pos.y + F.up.y * h, F.pos.z + F.up.z * h);
    };
    for (let k = 0; k <= n; k++) {
      const s = r.s0 + (r.length * k) / n;
      const h = BuiltTrack.rampHeight(r, k / n) + 0.01;
      rows.push([pt(s, l0, 0), pt(s, l0, h), pt(s, l1, h), pt(s, l1, 0)]);
    }
    const back = r.s0 + r.length + 0.7;
    const end = [pt(back, l0, 0), pt(back, l0, 0.01), pt(back, l1, 0.01), pt(back, l1, 0)];
    rows.push(end);
    for (let k = 0; k < rows.length - 1; k++) {
      const a = rows[k], b = rows[k + 1];
      // top
      m.tri(a[1], a[2], b[1]); m.tri(a[2], b[2], b[1]);
      // sides
      m.tri(a[0], a[1], b[0]); m.tri(a[1], b[1], b[0]);
      m.tri(a[3], b[3], a[2]); m.tri(a[2], b[3], b[2]);
    }
  }

  /**
   * Closed wall slab along a polyline: two faces `thick` apart, a top and end caps, so karts
   * cannot tunnel through a zero-thickness strip when pushed.
   */
  private wallStrip(m: MeshAcc, pts: Vector3[], y0: number, y1: number, thick = 0.3): void {
    if (pts.length < 2) return;
    const n = pts.length;
    const side: number[][] = [];
    for (let k = 0; k < n; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
      let nx = -(b.z - a.z), nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      nx = (nx / l) * thick * 0.5; nz = (nz / l) * thick * 0.5;
      const p = pts[k];
      side.push([
        m.add(p.x + nx, p.y + y0, p.z + nz), m.add(p.x + nx, p.y + y1, p.z + nz),
        m.add(p.x - nx, p.y + y0, p.z - nz), m.add(p.x - nx, p.y + y1, p.z - nz),
      ]);
    }
    for (let k = 1; k < n; k++) {
      const [a0, a1, a2, a3] = side[k - 1], [b0, b1, b2, b3] = side[k];
      m.quad(a0, a1, b0, b1); // face +n
      m.quad(b2, b3, a2, a3); // face -n
      m.quad(a1, a3, b1, b3); // top
    }
    for (const [c, flip] of [[side[0], false], [side[n - 1], true]] as const) {
      if (flip) m.quad(c[2], c[3], c[0], c[1]); else m.quad(c[0], c[1], c[2], c[3]);
    }
  }

  private prism(m: MeshAcc, x: number, y: number, z: number, r: number, h: number): void {
    const n = 8, base: number[] = [], top: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      base.push(m.add(x + Math.cos(a) * r, y, z + Math.sin(a) * r));
      top.push(m.add(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r));
    }
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      m.tri(base[k], top[k], base[k2]); m.tri(top[k], top[k2], base[k2]);
    }
  }

  private box(m: MeshAcc, x: number, y: number, z: number, w: number, d: number, yaw: number, h: number): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => new Vector3(x + a * c + b * s, y, z - a * s + b * c));
    this.wallStrip(m, [...corners, corners[0]], 0, h);
  }

  // -------------------------------------------------------------------------
  // grid, item boxes, hazards
  // -------------------------------------------------------------------------

  private buildGridAndBoxes(): void {
    const g = this.def.grid ?? {};
    const first = g.first ?? 7, gap = g.rowGap ?? 4.2, lat = g.lat ?? 2.7;
    for (let i = 0; i < GRID_SIZE; i++) {
      const f = this.sample(this.length - first - i * gap, i % 2 === 0 ? lat : -lat);
      this.startGrid.push(poseFromFrame(f, 0.02));
    }
    let id = 0;
    for (const row of this.def.itemRows ?? []) {
      const p = this.pathByRef(row.path);
      const s = wrapS(p, resolveProgress(p, row.at));
      const f = this.frameOn(p, s);
      const n = row.count ?? 4;
      const lats = row.lats ?? Array.from({ length: n }, (_, k) => (n === 1 ? 0 : -f.halfWidth * 0.62 + (f.halfWidth * 1.24 * k) / (n - 1)));
      for (const l of lats) {
        const ff = this.frameOn(p, s, l);
        this.itemBoxes.push({ id: id++, pos: ff.pos.clone().addScaledVector(ff.up, 1.0), up: ff.up.clone() });
      }
    }
  }

  private buildHazards(): void {
    for (const h of this.def.hazards ?? []) {
      const main = this.paths[0];
      const from = wrapS(main, resolveProgress(main, h.at));
      const to = h.to !== undefined ? wrapS(main, resolveProgress(main, h.to)) : from;
      this.hazards.push({ type: h.type, tag: h.tag, enabled: h.enabled ?? false, from, to, side: h.side ?? 1, count: h.count ?? 6, period: h.period ?? (h.type === 'sheepHerd' ? 11 : 2.4), entities: [], next: 0 });
      this.declareTag(h.tag, h.enabled ?? false);
    }
  }

  // -------------------------------------------------------------------------
  // lap events
  // -------------------------------------------------------------------------

  private applyTags(): void {
    const tags = this.state.tags;
    for (const [c, t] of this.colliderTags) c.enabled = tags.get(t) ?? true;
    for (const [z, t] of this.zoneTags) z.enabled = tags.get(t) ?? true;
    for (const [b, t] of this.branchTags) { b.enabled = tags.get(t) ?? true; this.paths[b.path].enabled = b.enabled; }
    for (const h of this.hazards) {
      const on = tags.get(h.tag) ?? h.enabled;
      if (on && !h.enabled) h.next = 0;
      h.enabled = on;
    }
    this.state.version++;
  }

  createEntities(sim: RaceSim): SimEntity[] {
    // reset lap state for a fresh race
    let changed = false;
    for (const [k, v] of this.initialTags) { if (this.state.tags.get(k) !== v) changed = true; this.state.tags.set(k, v); }
    this.applied.clear();
    this.state.lap = 0;
    for (const h of this.hazards) { for (const e of h.entities) e.dead = true; h.entities.length = 0; h.next = 0; }
    this.applyTags();
    if (changed) sim.events.emit('track:changed', { lap: 0, event: 'reset' });
    return [];
  }

  setLap(lap: number, sim: RaceSim): void {
    if (lap <= this.state.lap) return;
    this.state.lap = lap;
    const evs = (this.def.lapEvents ?? []).map((e, i) => ({ e, i })).sort((a, b) => a.e.lap - b.e.lap);
    for (const { e, i } of evs) {
      if (e.lap > lap || this.applied.has(i)) continue;
      this.applied.add(i);
      for (const t of e.enable ?? []) this.state.tags.set(t, true);
      for (const t of e.disable ?? []) this.state.tags.set(t, false);
      this.applyTags();
      const pos = e.at !== undefined ? this.sample(resolveProgress(this.paths[0], e.at)).pos.clone() : undefined;
      sim.events.emit('track:changed', { lap, event: e.name });
      sim.events.emit('track:event', { name: e.name, pos });
    }
  }

  step(sim: RaceSim, dt: number): void {
    // Fallback: follow the leader's lap if the race rules do not call setLap themselves.
    let lead = 0;
    for (const k of sim.karts) if (!k.race.finished && k.race.lap > lead) lead = k.race.lap;
    if (lead > this.state.lap) this.setLap(lead, sim);
    for (const h of this.hazards) updateHazard(h, this.host, sim, dt);
  }
}

// ---------------------------------------------------------------------------

const ROW = { i: 0, j: 0, t: 0 };
const RL = { lat: 0, speed: 1 };
const D = new Vector3(), P1 = new Vector3(), P2 = new Vector3(), R1 = new Vector3(), U1 = new Vector3();
const GP = new Vector3();
const GL = emptyLoc();
const FR = emptyFrame();
const newProj = (): Proj => ({ path: 0, row: 0, t: 0, lat: 0, hw: 0, h: 0, e: 0, s: 0 });
const CAND = newProj(), BEST = newProj(), OV = newProj();
function copyProj(a: Proj, b: Proj): void {
  a.path = b.path; a.row = b.row; a.t = b.t; a.lat = b.lat; a.hw = b.hw; a.h = b.h; a.e = b.e; a.s = b.s;
}

const M4 = new Matrix4(), LEFT = new Vector3();
export function poseFromFrame(f: TrackFrame, lift = 0): Pose {
  LEFT.copy(f.right).negate();
  M4.makeBasis(LEFT, f.up, f.forward);
  return { pos: f.pos.clone().addScaledVector(f.up, lift), quat: new Quaternion().setFromRotationMatrix(M4) };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function buildTrack(def: TrackDef): BuiltTrack {
  return new BuiltTrack(def);
}

export type { Progress };
