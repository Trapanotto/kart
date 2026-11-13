// Static track geometry for the view: road, shoulders, terrain, backdrop, water, decks, barriers,
// pads, ramps, markings. Everything static is merged per material. Owner: track.
import * as THREE from 'three/webgpu';
import { createRng } from '../../core/data';
import { BuiltTrack, ROAD_COLS } from '../builder';
import type { BuiltPath } from '../path';
import { patchWeight, valueNoise } from '../terrain';

const V = new THREE.Vector3(), W = new THREE.Vector3();

/** Minimal indexed geometry builder with named float attributes. */
export class Geo {
  pos: number[] = [];
  idx: number[] = [];
  attrs = new Map<string, { size: number; data: number[] }>();
  get count(): number { return this.pos.length / 3; }
  vert(p: THREE.Vector3 | [number, number, number], at: Record<string, number | number[]> = {}): number {
    if (Array.isArray(p)) this.pos.push(p[0], p[1], p[2]); else this.pos.push(p.x, p.y, p.z);
    for (const [k, v] of Object.entries(at)) {
      const a = this.attr(k, Array.isArray(v) ? v.length : 1);
      if (Array.isArray(v)) a.data.push(...v); else a.data.push(v);
    }
    return this.count - 1;
  }
  attr(name: string, size: number) {
    let a = this.attrs.get(name);
    if (!a) this.attrs.set(name, (a = { size, data: [] }));
    return a;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  /** a-b along the first row, c-d the next row; front face up for a road built left to right. */
  quad(a: number, b: number, c: number, d: number): void { this.idx.push(a, b, c, b, d, c); }
  build(normals = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    for (const [k, a] of this.attrs) g.setAttribute(k, new THREE.Float32BufferAttribute(a.data, a.size));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (normals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function lookOf(t: BuiltTrack, p: BuiltPath, i: number): [number, number, number] {
  let look = p.look[i];
  if (p.deck[i]) {
    const dk = t.decks.find((d) => d.path === p.index && i * p.ds >= d.s0 - 1 && i * p.ds <= d.s1 + 1);
    if (dk?.style === 'wood') look = 'planks';
  }
  if (!look) {
    const s = p.surface[i];
    look = s === 'offroad' || s === 'sticky' ? 'dirt' : s === 'sand' || s === 'water' ? 'gravel' : 'asphalt';
  }
  return [look === 'dirt' ? 1 : 0, look === 'planks' ? 1 : 0, look === 'gravel' ? 1 : 0];
}

// ---------------------------------------------------------------------------

export function roadGeometry(t: BuiltTrack): THREE.BufferGeometry {
  const g = new Geo();
  const COLS = ROAD_COLS;
  for (const p of t.paths) {
    const rows = p.closed ? p.count + 1 : p.count;
    // smoothed curvature for kerbs
    const kerbAt = (i: number): [number, number] => {
      if (p.index !== 0 || p.deck[i] || p.surface[i] !== 'road') return [0, 0];
      let c = 0;
      for (let d = -5; d <= 5; d++) c += p.curv[(i + d + p.count) % p.count];
      c /= 11;
      const k = smooth(1 / 75, 1 / 45, Math.abs(c));
      return c > 0 ? [0, k] : [k, 0];
    };
    let prev: number[] | null = null;
    for (let r = 0; r < rows; r++) {
      const i = r % p.count;
      const s = r * p.ds;
      const look = lookOf(t, p, i);
      const kerb = kerbAt(i);
      const row: number[] = [];
      for (const c of COLS) {
        const lat = c * p.hw[i];
        t.roadPoint(p, i, lat, V);
        row.push(g.vert(V, { uv: [lat, s], hw: p.hw[i], kerb, look, main: p.index === 0 ? 1 : 0 }));
      }
      if (prev) for (let k = 0; k < COLS.length - 1; k++) g.quad(prev[k], prev[k + 1], row[k], row[k + 1]);
      prev = row;
    }
  }
  return fixWinding(g.build());
}

/** Ensures faces point up (normals computed from indices). */
function fixWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.getAttribute('normal');
  let up = 0;
  for (let k = 0; k < n.count; k++) up += n.getY(k);
  if (up < 0) {
    const ix = geo.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) { const a = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, a); }
    geo.computeVertexNormals();
  }
  return geo;
}

export function shoulderGeometry(t: BuiltTrack): THREE.BufferGeometry {
  const g = new Geo();
  const blendFor = [[0.85, 0, 0, 0], [0.55, 0, 0, 0], [0.3, 0, 0, 0]];
  for (const p of t.paths) {
    const rows = p.closed ? p.count + 1 : p.count;
    for (const side of [-1, 1]) {
      let prev: number[] | null = null;
      for (let r = 0; r < rows; r++) {
        const i = r % p.count;
        if (p.deck[i]) { prev = null; continue; }
        const row: number[] = [];
        for (const [k, lat, drop] of t.shoulderProfile(p, i)) {
          t.shoulderPoint(p, i, side * lat, drop, V);
          row.push(g.vert(V, { blend: blendFor[k] }));
        }
        if (prev) for (let k = 0; k < 2; k++) {
          if (side > 0) g.quad(prev[k], prev[k + 1], row[k], row[k + 1]);
          else g.quad(prev[k + 1], prev[k], row[k + 1], row[k]);
        }
        prev = row;
      }
    }
  }
  return fixWinding(g.build());
}

export function terrainGeometry(t: BuiltTrack, step = 1): THREE.BufferGeometry {
  const T = t.terrain;
  const g = new Geo();
  if (step > 1) return coarseTerrain(t, step);
  const patches = T.def.patches ?? [];
  for (let j = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++) {
    const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
    const k = j * T.nx + i;
    const h = T.h[k];
    const d = T.roadDist[k];
    let dirt = 0.5 * (1 - smooth(3, 9, d));
    let field = 0, mud = 0, gravel = 0;
    const wd = T.waterDist(x, z);
    mud = Math.max(mud, 0.85 * (1 - smooth(-1, 2.5, wd)));
    for (const p of patches) {
      const w = patchWeight(p, x, z);
      if (p.look === 'field') field = Math.max(field, w);
      else if (p.look === 'mud') mud = Math.max(mud, w);
      else if (p.look === 'gravel' || p.look === 'sand') gravel = Math.max(gravel, w);
    }
    dirt = Math.max(dirt, 0.35 * smooth(0.3, 0.9, valueNoise(x / 23, z / 23)));
    g.vert([x, h, z], { blend: [dirt, field, mud, gravel] });
  }
  for (let j = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) {
    const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1;
    // same triangulation as the colliders: (a, d, b) and (a, c, d)
    g.tri(a, d, b); g.tri(a, c, d);
  }
  return fixWinding(g.build());
}

/**
 * Coarser terrain (every `step`-th vertex) for mobile. Each vertex takes the lowest height of the
 * fine vertices around it, so the coarse surface never rises through a road. The border vertices
 * keep their exact height so the backdrop still stitches.
 */
/** Road distance band (m) over which the coarse terrain blends from "lowest nearby" to exact. */
export const COARSE_NEAR = 8, COARSE_FAR = 16;

function coarseTerrain(t: BuiltTrack, step: number): THREE.BufferGeometry {
  const T = t.terrain;
  const g = new Geo();
  const xs: number[] = [], zs: number[] = [];
  for (let i = 0; i < T.nx; i += step) xs.push(i);
  if (xs[xs.length - 1] !== T.nx - 1) xs.push(T.nx - 1);
  for (let j = 0; j < T.nz; j += step) zs.push(j);
  if (zs[zs.length - 1] !== T.nz - 1) zs.push(T.nz - 1);
  for (const j of zs) for (const i of xs) {
    const exact = T.h[j * T.nx + i];
    let h = exact;
    const d = T.roadDist[j * T.nx + i];
    const border = i === 0 || j === 0 || i === T.nx - 1 || j === T.nz - 1;
    // Only near a road does the surface need to stay below the fine terrain; everywhere else
    // the true height keeps hills in shape and scenery on the ground.
    const nearRoad = 1 - smooth(COARSE_NEAR, COARSE_FAR, d);
    if (!border && nearRoad > 0) {
      for (let dj = -step; dj <= step; dj++) for (let di = -step; di <= step; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= T.nx || jj >= T.nz) continue;
        h = Math.min(h, T.h[jj * T.nx + ii]);
      }
      h = exact + (h - exact) * nearRoad;
    }
    const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
    const field = Math.max(0, ...(T.def.patches ?? []).filter((p) => p.look === 'field').map((p) => patchWeight(p, x, z)));
    const gravel = Math.max(0, ...(T.def.patches ?? []).filter((p) => p.look === 'gravel' || p.look === 'sand').map((p) => patchWeight(p, x, z)));
    g.vert([x, h, z], { blend: [0.5 * (1 - smooth(3, 9, d)), field, 0.85 * (1 - smooth(-1, 2.5, T.waterDist(x, z))), gravel] });
  }
  const nx = xs.length;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    g.tri(a, d, b); g.tri(a, c, d);
  }
  return fixWinding(g.build());
}

/** Height of the backdrop beyond the terrain grid. */
export function backdropHeight(t: BuiltTrack, x: number, z: number, dist: number): number {
  const n = valueNoise(x / 180, z / 180) * 0.5 + 0.5;
  return t.terrain.natural(x, z) + Math.max(0, dist - 60) * (0.1 + 0.12 * n) + valueNoise(x / 60, z / 60) * Math.min(1, dist / 100) * 6;
}

/** Rings of terrain from the grid border out to the horizon, stitched to the border vertices. */
export function backdropGeometry(t: BuiltTrack): { geo: THREE.BufferGeometry; trees: THREE.Matrix4[] } {
  const T = t.terrain;
  const g = new Geo();
  const cx = T.x0 + ((T.nx - 1) * T.cell) / 2, cz = T.z0 + ((T.nz - 1) * T.cell) / 2;
  const border: [number, number][] = [];
  for (let i = 0; i < T.nx - 1; i++) border.push([i, 0]);
  for (let j = 0; j < T.nz - 1; j++) border.push([T.nx - 1, j]);
  for (let i = T.nx - 1; i > 0; i--) border.push([i, T.nz - 1]);
  for (let j = T.nz - 1; j > 0; j--) border.push([0, j]);
  const rings = [0, 20, 55, 120, 240, 450, 800, 1400];
  const ids: number[][] = [];
  for (const [i, j] of border) {
    const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz);
    const col: number[] = [];
    for (const r of rings) {
      const px = x + (dx / l) * r, pz = z + (dz / l) * r;
      const y = r === 0 ? T.h[j * T.nx + i] : backdropHeight(t, px, pz, r);
      col.push(g.vert([px, y, pz], { blend: [0.15 * Math.min(1, r / 300), 0, 0, 0] }));
    }
    ids.push(col);
  }
  for (let k = 0; k < ids.length; k++) {
    const a = ids[k], b = ids[(k + 1) % ids.length];
    for (let r = 0; r < rings.length - 1; r++) g.quad(a[r], b[r], a[r + 1], b[r + 1]);
  }
  const geo = fixWinding(g.build());
  // distant forest
  const rng = createRng(4242);
  const trees: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (let k = 0; k < 1400; k++) {
    const a = rng.next() * Math.PI * 2;
    const [bi, bj] = border[Math.floor(rng.next() * border.length)];
    const x0 = T.x0 + bi * T.cell, z0 = T.z0 + bj * T.cell;
    const dx = x0 - cx, dz = z0 - cz, l = Math.hypot(dx, dz);
    const r = 4 + Math.pow(rng.next(), 1.4) * 420;
    const x = x0 + (dx / l) * r + Math.cos(a) * 6, z = z0 + (dz / l) * r + Math.sin(a) * 6;
    const y = backdropHeight(t, x, z, r) - 0.3;
    const s = 0.8 + rng.next() * 0.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * 6.28);
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + rng.next() * 0.5), s)));
  }
  return { geo, trees };
}

export function waterGeometry(t: BuiltTrack): THREE.BufferGeometry | null {
  const def = t.terrain.def;
  const g = new Geo();
  for (const b of def.brooks ?? []) {
    // resample the centre line every ~2 m
    const pts: [number, number, number][] = [];
    for (let k = 0; k < b.points.length - 1; k++) {
      const [ax, az, al] = b.points[k], [bx, bz, bl] = b.points[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let s = 0; s < n; s++) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n, al + ((bl - al) * s) / n]);
    }
    pts.push(b.points[b.points.length - 1]);
    const half = b.width / 2 + b.bank * 0.55;
    let prev: number[] | null = null;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], c = pts[Math.min(pts.length - 1, k + 1)];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const [x, z, lvl] = pts[k];
      const row = [g.vert([x - nx * half, lvl, z - nz * half], { uv: [0, k] }), g.vert([x + nx * half, lvl, z + nz * half], { uv: [1, k] })];
      if (prev) { g.tri(prev[0], row[0], prev[1]); g.tri(prev[1], row[0], row[1]); }
      prev = row;
    }
  }
  for (const p of def.ponds ?? []) {
    const r = p.radius + p.bank * 0.55;
    const c = g.vert([p.at[0], p.level, p.at[1]], { uv: [0.5, 0.5] });
    const n = 40, ring: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      ring.push(g.vert([p.at[0] + Math.cos(a) * r, p.level, p.at[1] + Math.sin(a) * r], { uv: [0, 0] }));
    }
    for (let k = 0; k < n; k++) g.tri(c, ring[(k + 1) % n], ring[k]);
  }
  if (g.count === 0) return null;
  return fixWinding(g.build());
}

// ---------------------------------------------------------------------------
// Instanced boxes (barriers, piers, decks, gate posts)
// ---------------------------------------------------------------------------

export class BoxBatch {
  readonly mats: THREE.Matrix4[] = [];
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  /** Box from a to b (centre line), given height and thickness, bottom at the points' y + y0. */
  segment(a: THREE.Vector3, b: THREE.Vector3, y0: number, h: number, thick: number, vertical = false): void {
    const d = W.subVectors(b, a);
    const len = d.length();
    if (len < 1e-3) return;
    if (vertical) d.y = 0;
    d.normalize();
    this.q.setFromUnitVectors(X_AXIS, d);
    const c = V.addVectors(a, b).multiplyScalar(0.5);
    c.y += y0 + h / 2;
    this.mats.push(new THREE.Matrix4().compose(c.clone(), this.q.clone(), new THREE.Vector3(len, h, thick)));
  }
  /** Axis-aligned-ish box at a position with yaw. */
  box(c: THREE.Vector3, size: [number, number, number], yaw = 0): void {
    this.q.setFromAxisAngle(Y_AXIS, yaw);
    this.m.compose(c.clone(), this.q.clone(), new THREE.Vector3(...size));
    this.mats.push(this.m.clone());
  }
  mesh(mat: THREE.Material, cast = true): THREE.InstancedMesh | null {
    if (this.mats.length === 0) return null;
    const m = new THREE.InstancedMesh(UNIT_BOX, mat, this.mats.length);
    this.mats.forEach((x, k) => m.setMatrixAt(k, x));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    return m;
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

/** Fences, rails, walls, hedges, deck parapets. */
export function barrierBatches(t: BuiltTrack, skip: (b: BuiltTrack['barriers'][number]) => boolean = () => false): { wood: BoxBatch; stone: BoxBatch; hedge: BoxBatch } {
  const wood = new BoxBatch(), stone = new BoxBatch(), hedge = new BoxBatch();
  for (const b of t.barriers) {
    if (skip(b)) continue;
    const pts = b.pts;
    if (b.style === 'wood') {
      const h = b.height;
      const postEvery = b.kind === 'rail' || b.kind === 'deckRail' ? 1 : 2;
      for (let k = 0; k < pts.length; k++) {
        if (k % postEvery === 0 || k === pts.length - 1) {
          wood.box(new THREE.Vector3(pts[k].x, pts[k].y + (h + 0.43) / 2 - 0.35, pts[k].z), [0.16, h + 0.43, 0.16]);
        }
        if (k > 0) {
          const a = pts[k - 1], c = pts[k];
          if (b.kind === 'rail') wood.segment(a, c, h - 0.32, 0.26, 0.12);
          else {
            wood.segment(a, c, h * 0.42, 0.14, 0.07);
            wood.segment(a, c, h * 0.86, 0.14, 0.07);
          }
        }
      }
    } else if (b.style === 'stone') {
      const thick = b.kind === 'deckRail' ? 0.45 : b.height > 3 ? 0.9 : 0.6;
      for (let k = 1; k < pts.length; k++) stone.segment(pts[k - 1], pts[k], -0.5, b.height + 0.5, thick, true);
      if (b.kind === 'deckRail' || b.height > 3) for (let k = 0; k < pts.length; k += 4) stone.box(new THREE.Vector3(pts[k].x, pts[k].y + b.height + 0.06, pts[k].z), [0.7, 0.14, 0.7]);
    } else {
      for (let k = 1; k < pts.length; k++) {
        const wob = 0.9 + 0.2 * Math.abs(Math.sin(k * 1.7));
        hedge.segment(pts[k - 1], pts[k], -0.3, b.height * wob + 0.3, 1.2 * wob, true);
      }
    }
  }
  return { wood, stone, hedge };
}

/** Bridge deck bodies (slab + side beams) and piers. */
export function deckGeometry(t: BuiltTrack, style: 'wood' | 'stone', modelled: Set<string> = new Set()): { geo: THREE.BufferGeometry | null; piers: BoxBatch } {
  const g = new Geo();
  const piers = new BoxBatch();
  const F = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 };
  for (const d of t.decks) {
    if (d.style !== style || (d.model && modelled.has(d.model))) continue;
    const p = t.paths[d.path];
    const s0 = d.s0 - 1.5, s1 = d.s1 + 1.5;
    const n = Math.ceil(s1 - s0);
    const thick = style === 'wood' ? 0.7 : 1.2;
    let prev: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      t.frameOn(p, s, 0, F);
      const hw = F.halfWidth + 0.55;
      const pts = [
        F.pos.clone().addScaledVector(F.right, -hw).addScaledVector(F.up, -0.04),
        F.pos.clone().addScaledVector(F.right, -hw).addScaledVector(F.up, -thick),
        F.pos.clone().addScaledVector(F.right, hw).addScaledVector(F.up, -thick),
        F.pos.clone().addScaledVector(F.right, hw).addScaledVector(F.up, -0.04),
      ];
      const row = pts.map((q) => g.vert(q));
      if (prev) for (let e = 0; e < 3; e++) g.quad(prev[e + 1], prev[e], row[e + 1], row[e]);
      prev = row;
    }
    // piers / abutments
    const step = style === 'wood' ? 4.5 : 9;
    for (let s = s0 + 0.8; s <= s1 + 0.01; s += step) {
      t.frameOn(p, s, 0, F);
      for (const side of style === 'wood' ? [-1, -0.33, 0.33, 1] : [-1, 1]) {
        const lat = side * (F.halfWidth + (style === 'wood' ? 0.1 : -0.2));
        const top = F.pos.clone().addScaledVector(F.right, lat).addScaledVector(F.up, -thick + 0.05);
        const ground = t.terrain.heightAt(top.x, top.z) - 0.6;
        const h = top.y - ground;
        if (h < 0.2) continue;
        // never stand a pier on another road (overpasses span the road below)
        const below = new THREE.Vector3(top.x, ground + 1.2, top.z);
        if (t.otherRoadAt(below, p.index, Math.round(s / p.ds), 20, 2.5, 3) !== null) continue;
        const sz: [number, number, number] = style === 'wood' ? [0.35, h, 0.35] : [1.4, h, 2.2];
        piers.box(new THREE.Vector3(top.x, ground + h / 2, top.z), sz, Math.atan2(F.forward.x, F.forward.z));
      }
    }
  }
  return { geo: g.count ? fixWinding(g.build()) : null, piers };
}

export function padGeometry(t: BuiltTrack): THREE.BufferGeometry | null {
  const g = new Geo();
  const F = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 };
  for (const pad of t.pads) {
    const p = t.paths[pad.path];
    const n = Math.ceil(pad.length);
    let prev: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const s = pad.s0 + (pad.length * k) / n;
      const row: number[] = [];
      for (const u of [0, 0.5, 1]) {
        t.frameOn(p, s, pad.lat - pad.width / 2 + pad.width * u, F);
        V.copy(F.pos).addScaledVector(F.up, 0.025);
        row.push(g.vert(V, { uv: [u, (pad.length * k) / n] }));
      }
      if (prev) for (let e = 0; e < 2; e++) g.quad(prev[e], prev[e + 1], row[e], row[e + 1]);
      prev = row;
    }
  }
  return g.count ? fixWinding(g.build()) : null;
}

export function rampGeometry(t: BuiltTrack): THREE.BufferGeometry | null {
  const g = new Geo();
  const F = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 };
  for (const r of t.ramps) {
    const p = t.paths[r.path];
    const n = Math.max(6, Math.ceil(r.length / 0.4));
    const l0 = r.lat - r.width / 2, l1 = r.lat + r.width / 2;
    const at = (s: number, lat: number, h: number) => { t.frameOn(p, s, lat, F); return F.pos.clone().addScaledVector(F.up, h); };
    let prevTop: number[] | null = null, prevL: number[] | null = null, prevR: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const f = k / n, s = r.s0 + r.length * f;
      const h = BuiltTrack.rampHeight(r, f) + 0.012;
      const top = [g.vert(at(s, l0, h), { uv: [0, f] }), g.vert(at(s, l1, h), { uv: [r.width, f] })];
      const L = [g.vert(at(s, l0, 0), { uv: [0, f] }), g.vert(at(s, l0, h), { uv: [0, f] })];
      const R = [g.vert(at(s, l1, 0), { uv: [0, f] }), g.vert(at(s, l1, h), { uv: [0, f] })];
      if (prevTop && prevL && prevR) {
        g.quad(prevTop[0], prevTop[1], top[0], top[1]);
        g.tri(prevL[0], L[0], prevL[1]); g.tri(prevL[1], L[0], L[1]);
        g.tri(prevR[0], prevR[1], R[0]); g.tri(prevR[1], R[1], R[0]);
      }
      prevTop = top; prevL = L; prevR = R;
    }
    // back face
    const sEnd = r.s0 + r.length;
    const hEnd = BuiltTrack.rampHeight(r, 1) + 0.012;
    const a = g.vert(at(sEnd, l0, hEnd), { uv: [0, 1] }), b = g.vert(at(sEnd, l1, hEnd), { uv: [r.width, 1] });
    const c = g.vert(at(sEnd + 0.7, l0, 0.01), { uv: [0, 1] }), d = g.vert(at(sEnd + 0.7, l1, 0.01), { uv: [r.width, 1] });
    g.quad(a, b, c, d);
  }
  if (!g.count) return null;
  const geo = g.build(false);
  geo.computeVertexNormals();
  return geo;
}

/** White grid boxes behind the start line and surface patch decals. */
export function markingsGeometry(t: BuiltTrack): THREE.BufferGeometry | null {
  const g = new Geo();
  const F = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 };
  const main = t.paths[0];
  const quad = (s0: number, s1: number, l0: number, l1: number) => {
    const ids: number[] = [];
    for (const [s, l] of [[s0, l0], [s0, l1], [s1, l0], [s1, l1]]) {
      t.frameOn(main, s, l, F);
      ids.push(g.vert(F.pos.clone().addScaledVector(F.up, 0.008)));
    }
    g.quad(ids[0], ids[1], ids[2], ids[3]);
  };
  const def = t.def.grid ?? {};
  const first = def.first ?? 7, gap = def.rowGap ?? 4.2, lat = def.lat ?? 2.7;
  for (let i = 0; i < 8; i++) {
    const s = t.length - first - i * gap;
    const l = i % 2 === 0 ? lat : -lat;
    quad(s + 1.3, s + 1.55, l - 1.1, l + 1.1); // front line
    quad(s - 0.6, s + 1.55, l - 1.1, l - 0.88); // sides
    quad(s - 0.6, s + 1.55, l + 0.88, l + 1.1);
  }
  return g.count ? fixWinding(g.build()) : null;
}

export function patchGeometry(t: BuiltTrack): THREE.BufferGeometry | null {
  const g = new Geo();
  const F = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 };
  for (const pt of t.patches) {
    const p = t.paths[pt.path];
    const n = Math.max(2, Math.ceil(pt.s1 - pt.s0));
    let prev: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const s = pt.s0 + ((pt.s1 - pt.s0) * k) / n;
      const row: number[] = [];
      for (let u = 0; u <= 4; u++) {
        const l = pt.latMin + ((pt.latMax - pt.latMin) * u) / 4;
        t.frameOn(p, s, l, F);
        // ragged edge: fade at the ends
        row.push(g.vert(F.pos.clone().addScaledVector(F.up, 0.014), { uv: [u / 4, k / n] }));
      }
      if (prev) for (let e = 0; e < 4; e++) g.quad(prev[e], prev[e + 1], row[e], row[e + 1]);
      prev = row;
    }
  }
  return g.count ? fixWinding(g.build()) : null;
}
