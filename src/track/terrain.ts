// Terrain heightfield that conforms to the roads. Owner: track. Headless.
//
// Natural shape (base, hills, rim, noise, brooks, ponds) -> conform to every road within reach
// (terrain sits 0.35 m under road + shoulder, then blends to the natural height over an
// embankment / cutting) -> a clearance pass guarantees the terrain never pokes through a road.
// The grid triangulation here is the one used by colliders and by the render mesh.
import { Vector3 } from 'three';
import type { SurfaceType } from '../core/types';
import type { BrookDef, PondDef, TerrainDef, TerrainPatchDef } from './format';
import type { BuiltPath } from './path';

/** Terrain under the road and shoulders sits this far below the road plane. */
export const UNDER_ROAD = 0.35;
/** Shoulders sit this far below the road plane, so road surfaces always win. */
export const SHOULDER_DROP = 0.03;
/** Sloped skirt beyond the shoulder: width and drop (m). */
export const SKIRT_W = 1.5;
export const SKIRT_DROP = 0.6;

function hash2(i: number, j: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

interface BrookSeg { ax: number; az: number; bx: number; bz: number; la: number; lb: number; len: number }

/** 0..1 coverage of a terrain patch at x/z (soft 2 m edge). */
export function patchWeight(p: TerrainPatchDef, x: number, z: number): number {
  const dx = x - p.at[0], dz = z - p.at[1];
  if (p.size) {
    const a = ((p.rot ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const u = Math.abs(dx * c - dz * s) - p.size[0] / 2, v = Math.abs(dx * s + dz * c) - p.size[1] / 2;
    return 1 - sstep(-1, 1, Math.max(u, v));
  }
  return 1 - sstep(-1, 1, Math.hypot(dx, dz) - (p.radius ?? 0));
}

export interface WaterHit { level: number; depth: number; dist: number; width: number; bank: number }

export class Terrain {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly nx: number;
  readonly nz: number;
  readonly h: Float32Array;
  /** Distance beyond the nearest road edge per vertex (m); 99 = far away. */
  readonly roadDist: Float32Array;
  readonly def: TerrainDef;
  private brookSegs: { def: BrookDef; segs: BrookSeg[] }[] = [];

  constructor(def: TerrainDef, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.def = def;
    const cell = def.cell ?? 3;
    const margin = def.margin ?? 90;
    this.cell = cell;
    this.x0 = Math.floor((bounds.minX - margin) / cell) * cell;
    this.z0 = Math.floor((bounds.minZ - margin) / cell) * cell;
    this.nx = Math.ceil((bounds.maxX + margin - this.x0) / cell) + 1;
    this.nz = Math.ceil((bounds.maxZ + margin - this.z0) / cell) + 1;
    this.h = new Float32Array(this.nx * this.nz);
    this.roadDist = new Float32Array(this.nx * this.nz).fill(99);
    for (const b of def.brooks ?? []) {
      const segs: BrookSeg[] = [];
      for (let i = 0; i < b.points.length - 1; i++) {
        const [ax, az, la] = b.points[i], [bx, bz, lb] = b.points[i + 1];
        segs.push({ ax, az, bx, bz, la, lb, len: Math.hypot(bx - ax, bz - az) });
      }
      this.brookSegs.push({ def: b, segs });
    }
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      this.h[j * this.nx + i] = this.natural(this.x0 + i * this.cell, this.z0 + j * this.cell);
    }
  }

  /** Distance to the nearest brook centre line and the water level there. */
  brookAt(x: number, z: number, out: WaterHit): WaterHit | null {
    let best: WaterHit | null = null;
    for (const { def, segs } of this.brookSegs) {
      for (const s of segs) {
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / (s.len * s.len || 1)));
        const px = s.ax + dx * t, pz = s.az + dz * t;
        const d = Math.hypot(x - px, z - pz) - def.width / 2;
        if (!best || d < best.dist) {
          best = out;
          out.dist = d; out.level = s.la + (s.lb - s.la) * t; out.depth = def.depth; out.width = def.width; out.bank = def.bank;
        }
      }
    }
    return best;
  }

  pondAt(x: number, z: number): { pond: PondDef; dist: number } | null {
    let best: { pond: PondDef; dist: number } | null = null;
    for (const p of this.def.ponds ?? []) {
      const d = Math.hypot(x - p.at[0], z - p.at[1]) - p.radius;
      if (!best || d < best.dist) best = { pond: p, dist: d };
    }
    return best;
  }

  private wh: WaterHit = { level: 0, depth: 0, dist: 0, width: 0, bank: 0 };

  /** Natural terrain height before road conformity. */
  natural(x: number, z: number): number {
    const d = this.def;
    let h = d.base + (d.tilt ? d.tilt[0] * x + d.tilt[1] * z : 0);
    for (const hl of d.hills) {
      const qx = (x - hl.at[0]) / (hl.sx ?? 1), qz = (z - hl.at[1]) / (hl.sz ?? 1);
      const q2 = (qx * qx + qz * qz) / (hl.radius * hl.radius);
      if (q2 < 1) { const f = 1 - q2; h += hl.height * f * f; }
    }
    if (d.rim) {
      const r = Math.hypot(x - d.rim.center[0], z - d.rim.center[1]);
      h += d.rim.height * sstep(d.rim.radius, d.rim.radius + d.rim.width, r);
    }
    if (d.noise) {
      const s = d.noise.scale;
      h += d.noise.amp * (valueNoise(x / s, z / s) * 0.7 + valueNoise(x / (s * 0.37) + 17.3, z / (s * 0.37) - 4.1) * 0.3);
    }
    const w = this.brookSegs.length ? this.brookAt(x, z, this.wh) : null;
    if (w) {
      const half = w.width / 2;
      const dc = w.dist + half; // distance from the centre line
      const bed = w.level - w.depth;
      let c = Infinity;
      if (dc <= half) c = bed + 0.35 * w.depth * (dc / half) * (dc / half);
      else if (dc <= half + w.bank) c = bed + 0.35 * w.depth + (w.level + 0.7 - bed - 0.35 * w.depth) * sstep(half, half + w.bank, dc);
      if (c < h) h = c;
    }
    for (const p of d.ponds ?? []) {
      const r = Math.hypot(x - p.at[0], z - p.at[1]);
      let c: number;
      const bed = p.level - p.depth;
      if (r <= p.radius) c = bed + 0.5 * p.depth * (r / p.radius) * (r / p.radius);
      else if (r <= p.radius + p.bank) c = bed + 0.5 * p.depth + (p.level + 0.6 - bed - 0.5 * p.depth) * sstep(p.radius, p.radius + p.bank, r);
      else c = Infinity;
      if (c < h) h = c;
    }
    return h;
  }

  inGrid(x: number, z: number): boolean {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    return fx >= 0 && fz >= 0 && fx <= this.nx - 1 && fz <= this.nz - 1;
  }

  /** Height of the terrain surface exactly as triangulated. */
  heightAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return this.natural(x, z);
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= this.nx - 1) i = this.nx - 2;
    if (j >= this.nz - 1) j = this.nz - 2;
    const u = fx - i, v = fz - j;
    const nx = this.nx, H = this.h;
    const h00 = H[j * nx + i], h10 = H[j * nx + i + 1], h01 = H[(j + 1) * nx + i], h11 = H[(j + 1) * nx + i + 1];
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  /** Distance beyond the nearest road edge (bilinear over vertices). */
  roadDistAt(x: number, z: number): number {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return 99;
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.nz - 2, Math.floor(fz));
    const u = fx - i, v = fz - j, nx = this.nx, D = this.roadDist;
    const a = D[j * nx + i], b = D[j * nx + i + 1], c = D[(j + 1) * nx + i], d = D[(j + 1) * nx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  /** Slope (rise over run) at a point. */
  slopeAt(x: number, z: number): number {
    const e = this.cell;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  /** Water level at a point if it is under water, else null. */
  waterLevelAt(x: number, z: number): number | null {
    const b = this.brookAt(x, z, this.wh);
    const g = this.heightAt(x, z);
    if (b && b.dist < 4 && g < b.level) return b.level;
    const p = this.pondAt(x, z);
    if (p && p.dist < p.pond.bank && g < p.pond.level) return p.pond.level;
    return null;
  }

  /** Distance to open water's edge (negative inside). */
  waterDist(x: number, z: number): number {
    let d = 99;
    const b = this.brookAt(x, z, this.wh);
    if (b) d = Math.min(d, b.dist);
    const p = this.pondAt(x, z);
    if (p) d = Math.min(d, p.dist);
    return d;
  }

  surfaceAt(x: number, z: number): SurfaceType {
    for (const p of this.def.patches ?? []) if (patchWeight(p, x, z) > 0.5) return p.surface;
    const lvl = this.waterLevelAt(x, z);
    if (lvl !== null && this.heightAt(x, z) < lvl - 0.05) return 'water';
    return 'offroad';
  }

  /**
   * Shapes the terrain to the roads. `conformWeight(path, row)` is 0 for bridge decks (natural
   * ground below), 1 elsewhere.
   */
  conform(paths: BuiltPath[], conformWeight: (p: BuiltPath, i: number) => number): void {
    const { nx, nz, cell, x0, z0 } = this;
    const REACH = 55;
    const bestE = new Float32Array(nx * nz).fill(1e9);
    const bestP = new Int16Array(nx * nz).fill(-1);
    const bestI = new Int32Array(nx * nz);
    // 1. nearest road sample per vertex (stamping)
    for (const p of paths) {
      for (let i = 0; i < p.count; i++) {
        const c = p.pos[i];
        const r = p.hw[i] + REACH;
        const i0 = Math.max(0, Math.floor((c.x - r - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((c.x + r - x0) / cell));
        const j0 = Math.max(0, Math.floor((c.z - r - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((c.z + r - z0) / cell));
        for (let j = j0; j <= j1; j++) {
          const z = z0 + j * cell;
          for (let ii = i0; ii <= i1; ii++) {
            const x = x0 + ii * cell;
            const e = Math.hypot(x - c.x, z - c.z) - p.hw[i];
            const k = j * nx + ii;
            if (e < bestE[k]) { bestE[k] = e; bestP[k] = p.index; bestI[k] = i; }
          }
        }
      }
    }
    // 2. conform
    const P = new Vector3(), R = new Vector3();
    for (let k = 0; k < nx * nz; k++) {
      const pi = bestP[k];
      if (pi < 0) continue;
      const p = paths.find((q) => q.index === pi)!;
      const x = x0 + (k % nx) * cell, z = z0 + Math.floor(k / nx) * cell;
      // refine: project onto the two neighbouring segments
      const i = bestI[k];
      let lat = 0, along = 0, bestD = Infinity, row = i;
      for (const a of [i - 1, i]) {
        const ia = p.closed ? (a + p.count) % p.count : a;
        const ib = p.closed ? (ia + 1) % p.count : ia + 1;
        if (ia < 0 || ib >= p.count) continue;
        const A = p.pos[ia], B = p.pos[ib];
        const dx = B.x - A.x, dz = B.z - A.z;
        const len2 = dx * dx + dz * dz || 1;
        const t = Math.min(1, Math.max(0, ((x - A.x) * dx + (z - A.z) * dz) / len2));
        const px = A.x + dx * t, pz = A.z + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d < bestD) {
          bestD = d; along = t; row = ia;
          const rr = p.right[ia];
          lat = (x - px) * rr.x + (z - pz) * rr.z;
          lat /= Math.hypot(rr.x, rr.z) || 1;
        }
      }
      const rb = p.closed ? (row + 1) % p.count : Math.min(p.count - 1, row + 1);
      P.copy(p.pos[row]).lerp(p.pos[rb], along);
      R.copy(p.right[row]).lerp(p.right[rb], along).normalize();
      const hw = p.hw[row], sh = p.shoulder[row];
      const e = Math.abs(lat) - hw;
      this.roadDist[k] = Math.min(this.roadDist[k], e);
      const latC = Math.sign(lat) * Math.min(Math.abs(lat), hw + sh);
      const ys = P.y + R.y * latC - (Math.abs(lat) > hw ? SHOULDER_DROP : 0);
      const near = ys - UNDER_ROAD;
      const N = this.h[k];
      let target: number;
      const flat = sh + SKIRT_W;
      if (e <= flat) target = near;
      else {
        const F = Math.max(8, 2.0 * Math.abs(N - near));
        target = near + (N - near) * sstep(0, F, e - flat);
      }
      const w = conformWeight(p, row);
      this.h[k] = N + (target - N) * w;
    }
  }

  /** Lowers vertices until the terrain is at least `clear` below every road / shoulder point. */
  clearRoads(paths: BuiltPath[], clear = 0.15): number {
    let fixed = 0;
    const Q = new Vector3();
    for (let pass = 0; pass < 6; pass++) {
      let n = 0;
      for (const p of paths) {
        for (let i = 0; i < p.count; i++) {
          const ext = p.hw[i] + p.shoulder[i] + 0.5;
          for (let l = -ext; l <= ext + 1e-6; l += 0.75) {
            Q.copy(p.pos[i]).addScaledVector(p.right[i], l);
            const top = Q.y - (Math.abs(l) > p.hw[i] ? SHOULDER_DROP : 0) - clear;
            const h = this.heightAt(Q.x, Q.z);
            if (h > top) { n++; this.lowerCell(Q.x, Q.z, top - (UNDER_ROAD - clear)); }
          }
        }
      }
      fixed += n;
      if (n === 0) break;
    }
    return fixed;
  }

  private lowerCell(x: number, z: number, to: number): void {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.min(this.nx - 2, Math.max(0, Math.floor(fx))), j = Math.min(this.nz - 2, Math.max(0, Math.floor(fz)));
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const k = (j + b) * this.nx + i + a;
      if (this.h[k] > to) this.h[k] = to;
    }
  }

  minHeight(): number {
    let m = Infinity;
    for (let k = 0; k < this.h.length; k++) if (this.h[k] < m) m = this.h[k];
    return m;
  }
}
