// Spline paths: control points -> evenly spaced road samples with frames. Owner: track. Headless.
import { CatmullRomCurve3, Vector3 } from 'three';
import type { SurfaceType } from '../core/types';
import type { ControlPoint, EdgeDef, EdgeKind, Progress, RoadLook } from './format';

const Y = new Vector3(0, 1, 0);

export const EDGE_DEFAULT_OFFSET: Record<EdgeKind, number> = { open: 0, fence: 1.4, rail: 0.5, wall: 1.0, hedge: 1.8, none: 0 };

/** Road samples of one path, evenly spaced by `ds`. */
export interface BuiltPath {
  index: number;
  id: string;
  closed: boolean;
  /** Number of sample rows. Closed: segments = count (wraps). Open: segments = count - 1. */
  count: number;
  segments: number;
  ds: number;
  length: number;
  pos: Vector3[];
  fwd: Vector3[];
  right: Vector3[];
  up: Vector3[];
  hw: Float32Array;
  bank: Float32Array;
  shoulder: Float32Array;
  /** Signed horizontal curvature (1/m), positive = right turn. */
  curv: Float32Array;
  surface: SurfaceType[];
  /** Render look per row (undefined = from the surface). */
  look: (RoadLook | undefined)[];
  left: EdgeDef[];
  rightEdge: EdgeDef[];
  /** 1 where the road is a bridge deck. */
  deck: Uint8Array;
  anchors: Map<string, number>;
  /** Branches: main-path progress of the start and the progress span covered. */
  mainFrom: number;
  mainSpan: number;
  enabled: boolean;
}

export interface PathOptions {
  index: number;
  id: string;
  closed: boolean;
  /** Default half width. */
  width: number;
  step?: number;
  /** For open paths: number of leading/trailing phantom control points that shape the ends but are not sampled. */
  phantom?: number;
}

function edgeOf(e: EdgeKind | EdgeDef | undefined): EdgeDef | undefined {
  if (e === undefined) return undefined;
  return typeof e === 'string' ? { kind: e } : e;
}

/** Interpolates a numeric control-point property between the points that define it (smoothstep). */
function interpParam(defined: { c: number; v: number }[], c: number, total: number, closed: boolean, fallback: number): number {
  if (defined.length === 0) return fallback;
  if (defined.length === 1) return defined[0].v;
  // find surrounding defined indices
  let a = -1;
  for (let i = 0; i < defined.length; i++) if (defined[i].c <= c) a = i;
  let ca: number, va: number, cb: number, vb: number;
  if (a === -1) {
    if (!closed) return defined[0].v;
    const last = defined[defined.length - 1];
    ca = last.c - total; va = last.v; cb = defined[0].c; vb = defined[0].v;
  } else if (a === defined.length - 1) {
    if (!closed) return defined[a].v;
    ca = defined[a].c; va = defined[a].v; cb = defined[0].c + total; vb = defined[0].v;
  } else {
    ca = defined[a].c; va = defined[a].v; cb = defined[a + 1].c; vb = defined[a + 1].v;
  }
  const f = cb > ca ? (c - ca) / (cb - ca) : 0;
  const s = f * f * (3 - 2 * f);
  return va + (vb - va) * s;
}

function sticky<T>(cps: ControlPoint[], get: (p: ControlPoint) => T | undefined, closed: boolean, fallback: T): T[] {
  const m = cps.length;
  const out: T[] = new Array(m);
  let cur: T | undefined;
  if (closed) for (let i = 0; i < m; i++) { const v = get(cps[i]); if (v !== undefined) cur = v; }
  for (let i = 0; i < m; i++) {
    const v = get(cps[i]);
    if (v !== undefined) cur = v;
    out[i] = cur ?? fallback;
  }
  return out;
}

/** Builds evenly spaced samples along a Catmull-Rom spline through the control points. */
export function buildPath(cps: ControlPoint[], opt: PathOptions): BuiltPath {
  const { closed } = opt;
  const step = opt.step ?? 1;
  const ph = closed ? 0 : opt.phantom ?? 0;
  const m = cps.length;
  const curve = new CatmullRomCurve3(cps.map((c) => new Vector3(c.p[0], c.p[1], c.p[2])), closed, 'centripetal');
  const segTotal = closed ? m : m - 1;
  const t0 = ph / segTotal, t1 = (segTotal - ph) / segTotal;
  // Fine table of the curve between t0 and t1.
  const K = Math.max(200, (segTotal - 2 * ph) * 96);
  const ft = new Float64Array(K + 1), fs = new Float64Array(K + 1);
  const a = new Vector3(), b = new Vector3();
  curve.getPoint(t0, a);
  for (let k = 0; k <= K; k++) {
    const t = t0 + ((t1 - t0) * k) / K;
    curve.getPoint(t, b);
    ft[k] = t;
    fs[k] = k === 0 ? 0 : fs[k - 1] + a.distanceTo(b);
    a.copy(b);
  }
  const length = fs[K];
  const segments = Math.max(4, Math.round(length / step));
  const ds = length / segments;
  const count = closed ? segments : segments + 1;

  const sToT = (s: number): number => {
    let lo = 0, hi = K;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fs[mid] <= s) lo = mid; else hi = mid; }
    const f = fs[hi] > fs[lo] ? (s - fs[lo]) / (fs[hi] - fs[lo]) : 0;
    return ft[lo] + (ft[hi] - ft[lo]) * Math.min(1, Math.max(0, f));
  };
  const tToS = (t: number): number => {
    let lo = 0, hi = K;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ft[mid] <= t) lo = mid; else hi = mid; }
    const f = ft[hi] > ft[lo] ? (t - ft[lo]) / (ft[hi] - ft[lo]) : 0;
    return fs[lo] + (fs[hi] - fs[lo]) * Math.min(1, Math.max(0, f));
  };

  const defW: { c: number; v: number }[] = [], defB: { c: number; v: number }[] = [];
  cps.forEach((c, i) => {
    if (c.w !== undefined) defW.push({ c: i, v: c.w });
    if (c.bank !== undefined) defB.push({ c: i, v: c.bank });
  });
  const surf = sticky(cps, (c) => c.surface, closed, 'road' as SurfaceType);
  const le = sticky(cps, (c) => edgeOf(c.left), closed, { kind: 'open' } as EdgeDef);
  const re = sticky(cps, (c) => edgeOf(c.right), closed, { kind: 'open' } as EdgeDef);
  const sh = sticky(cps, (c) => c.shoulder, closed, 2.5);
  const lk = sticky<RoadLook | undefined>(cps, (c) => c.look, closed, undefined);
  const look: (RoadLook | undefined)[] = [];

  const pos: Vector3[] = [], fwd: Vector3[] = [], right: Vector3[] = [], up: Vector3[] = [];
  const hw = new Float32Array(count), bank = new Float32Array(count), shoulder = new Float32Array(count), curv = new Float32Array(count);
  const surface: SurfaceType[] = [], left: EdgeDef[] = [], rightEdge: EdgeDef[] = [];
  for (let i = 0; i < count; i++) {
    const t = sToT(i * ds);
    pos.push(curve.getPoint(t));
    const c = Math.min(segTotal - 1e-6, t * segTotal);
    const ci = Math.floor(c);
    hw[i] = interpParam(defW, c, segTotal, closed, opt.width);
    bank[i] = interpParam(defB, c, segTotal, closed, 0);
    surface.push(surf[ci]);
    left.push(le[ci]);
    rightEdge.push(re[ci]);
    shoulder[i] = sh[ci];
    look.push(lk[ci]);
  }
  const path: BuiltPath = {
    index: opt.index, id: opt.id, closed, count, segments, ds, length, pos, fwd, right, up, hw, bank, shoulder, curv,
    surface, look, left, rightEdge, deck: new Uint8Array(count), anchors: new Map(), mainFrom: 0, mainSpan: length, enabled: true,
  };
  const endTangents: [Vector3, Vector3] | undefined = closed ? undefined : [curve.getTangent(t0).normalize(), curve.getTangent(t1).normalize()];
  computeFrames(path, endTangents);
  const anchors = new Map<string, number>();
  cps.forEach((c, i) => {
    if (!c.name) return;
    const t = i / segTotal;
    if (t < t0 - 1e-9 || t > t1 + 1e-9) return;
    anchors.set(c.name, tToS(t));
  });

  path.anchors = anchors;
  return path;
}

/** (Re)computes forward / right / up frames and curvature from positions and bank. */
export function computeFrames(p: BuiltPath, endTangents?: [Vector3, Vector3]): void {
  const { closed, count, pos, bank, ds } = p;
  for (let i = 0; i < count; i++) {
    const ip = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
    const inx = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
    const f = (p.fwd[i] ??= new Vector3()).subVectors(pos[inx], pos[ip]).normalize();
    if (!closed && endTangents && i === 0) f.copy(endTangents[0]);
    if (!closed && endTangents && i === count - 1) f.copy(endTangents[1]);
    const r0 = new Vector3().crossVectors(f, Y).normalize();
    const u0 = new Vector3().crossVectors(r0, f).normalize();
    const bk = (bank[i] * Math.PI) / 180;
    (p.right[i] ??= new Vector3()).copy(r0).multiplyScalar(Math.cos(bk)).addScaledVector(u0, -Math.sin(bk));
    (p.up[i] ??= new Vector3()).copy(u0).multiplyScalar(Math.cos(bk)).addScaledVector(r0, Math.sin(bk));
  }
  for (let i = 0; i < count; i++) {
    const ip = closed ? (i - 1 + count) % count : Math.max(0, i - 1);
    const inx = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
    const ha = Math.atan2(p.fwd[ip].x, p.fwd[ip].z), hb = Math.atan2(p.fwd[inx].x, p.fwd[inx].z);
    let d = hb - ha;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const span = (inx - ip + count) % count || 1;
    p.curv[i] = -d / (span * ds);
  }
}

/** Resolves a Progress value on a path (not wrapped). */
export function resolveProgress(path: BuiltPath, p: Progress): number {
  if (typeof p === 'number') return p;
  const s = p.trim();
  if (s.endsWith('%')) return (parseFloat(s) / 100) * path.length;
  const m = /^([A-Za-z_][\w.]*)\s*(?:([+-])\s*([\d.]+))?$/.exec(s);
  if (!m) throw new Error(`track: bad progress '${p}'`);
  const base = path.anchors.get(m[1]);
  if (base === undefined) throw new Error(`track: unknown anchor '${m[1]}' on path '${path.id}'`);
  const off = m[3] ? parseFloat(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
  return base + off;
}

/** Wraps (closed) or clamps (open) a path-local distance. */
export function wrapS(path: BuiltPath, s: number): number {
  if (path.closed) return ((s % path.length) + path.length) % path.length;
  return Math.min(path.length, Math.max(0, s));
}

/** Sample row index and blend factor for a path-local distance. */
export function rowAt(path: BuiltPath, s: number, out: { i: number; j: number; t: number }): { i: number; j: number; t: number } {
  const w = wrapS(path, s);
  let i = Math.floor(w / path.ds);
  if (path.closed) {
    i = i % path.count;
    out.i = i; out.j = (i + 1) % path.count;
  } else {
    if (i >= path.count - 1) i = path.count - 2;
    out.i = i; out.j = i + 1;
  }
  out.t = Math.min(1, Math.max(0, w / path.ds - i));
  return out;
}
