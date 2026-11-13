// Track validator: proves a built track is drivable and its colliders are sound. Owner: track.
// Headless; used by tests/track*.test.ts. Run for every new track.
import { Vector3 } from 'three';
import type { TrackCollider, TrackFrame, TrackLocation } from '../../src/core/types';
import type { BuiltTrack } from '../../src/track/builder';

export interface ValidateOptions {
  lapLength?: [number, number];
  /** Minimum corner radius on the main path / branches (m). */
  minRadius?: number;
  minBranchRadius?: number;
  halfWidth?: [number, number];
  /** Allowed distance between a road point and the first ground hit below it (m). */
  groundTolerance?: number;
}

export interface ValidateResult {
  errors: string[];
  warnings: string[];
  metrics: Record<string, number>;
}

const frame = (): TrackFrame => ({ pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 0 });
const loc = (): TrackLocation => ({ path: 0, progress: 0, lat: 0, halfWidth: 0, height: 0, onRoad: true, hint: -1 });

/** Downward ray caster over the enabled ground colliders (2D bucket grid). */
export class GroundRaycaster {
  private tris: { c: TrackCollider; a: number; b: number; d: number }[] = [];
  private cells = new Map<number, number[]>();
  private readonly cs = 4;
  constructor(colliders: readonly TrackCollider[], kind: 'ground' | 'wall' = 'ground') {
    for (const c of colliders) {
      if (c.kind !== kind) continue;
      const v = c.vertices, ix = c.indices;
      for (let k = 0; k < ix.length; k += 3) {
        const id = this.tris.length;
        this.tris.push({ c, a: ix[k], b: ix[k + 1], d: ix[k + 2] });
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const q of [ix[k], ix[k + 1], ix[k + 2]]) {
          x0 = Math.min(x0, v[q * 3]); x1 = Math.max(x1, v[q * 3]); z0 = Math.min(z0, v[q * 3 + 2]); z1 = Math.max(z1, v[q * 3 + 2]);
        }
        for (let i = Math.floor(x0 / this.cs); i <= Math.floor(x1 / this.cs); i++) for (let j = Math.floor(z0 / this.cs); j <= Math.floor(z1 / this.cs); j++) {
          const key = i * 100003 + j;
          let l = this.cells.get(key);
          if (!l) this.cells.set(key, (l = []));
          l.push(id);
        }
      }
    }
  }

  /** Highest ground below `y` at x/z, with its collider. */
  cast(x: number, y: number, z: number): { y: number; c: TrackCollider } | null {
    const l = this.cells.get(Math.floor(x / this.cs) * 100003 + Math.floor(z / this.cs));
    if (!l) return null;
    let best: { y: number; c: TrackCollider } | null = null;
    for (const id of l) {
      const t = this.tris[id];
      if (!t.c.enabled) continue;
      const v = t.c.vertices;
      const ax = v[t.a * 3], ay = v[t.a * 3 + 1], az = v[t.a * 3 + 2];
      const bx = v[t.b * 3], by = v[t.b * 3 + 1], bz = v[t.b * 3 + 2];
      const cx = v[t.d * 3], cy = v[t.d * 3 + 1], cz = v[t.d * 3 + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const hy = l1 * ay + l2 * by + l3 * cy;
      if (hy <= y && (!best || hy > best.y)) best = { y: hy, c: t.c };
    }
    return best;
  }
}

export function validateTrack(track: BuiltTrack, opt: ValidateOptions = {}): ValidateResult {
  const errors: string[] = [], warnings: string[] = [];
  const metrics: Record<string, number> = {};
  const L = track.length;
  const main = track.paths[0];
  const tol = opt.groundTolerance ?? 0.05;
  metrics.length = Math.round(L * 10) / 10;
  const [lmin, lmax] = opt.lapLength ?? [600, 2500];
  if (L < lmin || L > lmax) errors.push(`lap length ${L.toFixed(0)} m outside [${lmin}, ${lmax}]`);

  // Temporarily enable every branch so all geometry is checked.
  const saved = track.paths.map((p) => p.enabled);
  for (const p of track.paths) p.enabled = true;
  try {
    // 1. closed and continuous
    for (const p of track.paths) {
      for (let i = 0; i < p.segments; i++) {
        const j = p.closed ? (i + 1) % p.count : i + 1;
        const d = p.pos[i].distanceTo(p.pos[j]);
        if (Math.abs(d - p.ds) > 0.15 * p.ds) errors.push(`${p.id}: gap at row ${i} (${d.toFixed(2)} m)`);
        const ang = Math.acos(Math.min(1, p.fwd[i].dot(p.fwd[j])));
        if (ang > 0.12) errors.push(`${p.id}: kink at ${(i * p.ds).toFixed(0)} m (${((ang * 180) / Math.PI).toFixed(1)}°)`);
        const slope = Math.abs(p.pos[j].y - p.pos[i].y) / d;
        if (slope > 0.3) errors.push(`${p.id}: slope ${slope.toFixed(2)} at ${(i * p.ds).toFixed(0)} m`);
      }
    }
    // branch ends meet the main path
    for (const p of track.paths.slice(1)) {
      const a = track.sample(p.mainFrom, 0, 0).pos, b = track.sample(p.mainFrom + p.mainSpan, 0, 0).pos;
      if (a.distanceTo(p.pos[0]) > 0.5) errors.push(`${p.id}: start does not meet the main path (${a.distanceTo(p.pos[0]).toFixed(2)} m)`);
      if (b.distanceTo(p.pos[p.count - 1]) > 0.5) errors.push(`${p.id}: end does not meet the main path`);
    }

    // 2. corner radius (smoothed over 6 m) and widths
    for (const p of track.paths) {
      const minR = p.index === 0 ? opt.minRadius ?? 15 : opt.minBranchRadius ?? 10;
      let worst = Infinity, at = 0;
      const n = p.count;
      for (let i = 0; i < n; i++) {
        let k = 0, c = 0;
        for (let d = -3; d <= 3; d++) {
          const r = p.closed ? (i + d + n) % n : i + d;
          if (r < 0 || r >= n) continue;
          c += p.curv[r]; k++;
        }
        const R = 1 / Math.max(1e-6, Math.abs(c / k));
        if (R < worst) { worst = R; at = i * p.ds; }
        const hw = p.hw[i];
        const [w0, w1] = opt.halfWidth ?? [p.index === 0 ? 5.5 : 3.5, 11];
        if (hw < w0 - 1e-3 || hw > w1 + 1e-3) { errors.push(`${p.id}: half width ${hw.toFixed(1)} at ${(i * p.ds).toFixed(0)} m`); break; }
      }
      metrics[`minRadius.${p.id}`] = Math.round(worst * 10) / 10;
      if (worst < minR) errors.push(`${p.id}: corner radius ${worst.toFixed(1)} m at ${at.toFixed(0)} m (< ${minR})`);
    }

    // 3. no self-intersection on the same level (rows far apart along the paths)
    {
      const pts: { p: number; i: number; v: Vector3; hw: number; s: number }[] = [];
      for (const p of track.paths) for (let i = 0; i < p.count; i += 2) pts.push({ p: p.index, i, v: p.pos[i], hw: p.hw[i], s: track.mainProgress(p, i * p.ds) });
      const cell = 12;
      const grid = new Map<string, number[]>();
      pts.forEach((q, k) => {
        const key = `${Math.floor(q.v.x / cell)},${Math.floor(q.v.z / cell)}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
      });
      const reported = new Set<string>();
      pts.forEach((a) => {
        const ci = Math.floor(a.v.x / cell), cj = Math.floor(a.v.z / cell);
        for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
          for (const k of grid.get(`${ci + di},${cj + dj}`) ?? []) {
            const b = pts[k];
            if (b === a) continue;
            let ds = Math.abs(a.s - b.s);
            ds = Math.min(ds, L - ds);
            if (a.p === b.p) {
              const pa = track.paths[a.p];
              let di2 = Math.abs(a.i - b.i);
              if (pa.closed) di2 = Math.min(di2, pa.count - di2);
              if (di2 * pa.ds < 40) continue;
            } else if (ds < 45) continue; // junction region
            const dxz = Math.hypot(a.v.x - b.v.x, a.v.z - b.v.z);
            if (dxz < a.hw + b.hw + 1 && Math.abs(a.v.y - b.v.y) < 4.5) {
              const key = `${a.p}:${Math.round(a.s / 20)}|${b.p}:${Math.round(b.s / 20)}`;
              if (!reported.has(key)) { reported.add(key); errors.push(`roads overlap: ${track.paths[a.p].id}@${a.s.toFixed(0)} and ${track.paths[b.p].id}@${b.s.toFixed(0)} (dy ${(a.v.y - b.v.y).toFixed(1)})`); }
            }
          }
        }
      });
    }

    // 4. locate(sample()) round trip
    {
      const f = frame(), l = loc(), lh = loc();
      const probe = new Vector3();
      let worstP = 0, worstLat = 0, n = 0, bad = 0;
      for (const p of track.paths) {
        lh.hint = -1;
        for (let s = 0.25; s < p.length - 0.25; s += 1) {
          const prog = track.mainProgress(p, s);
          for (const fr of [-0.9, -0.5, 0, 0.5, 0.9]) {
            track.frameOn(p, s, 0, f);
            const lat = fr * f.halfWidth;
            track.frameOn(p, s, lat, f);
            probe.copy(f.pos).addScaledVector(f.up, 0.4);
            for (const useHint of [false, true]) {
              const r = useHint ? track.locate(probe, lh, lh) : track.locate(probe, undefined, l);
              n++;
              let dp = Math.abs(r.progress - prog);
              dp = Math.min(dp, L - dp);
              // on a branch overlapping the main road, landing on main is fine
              if (r.path !== p.index) {
                // hysteresis: with a hint, locate keeps the current path until the kart is 1.7 m beyond its edge
                const onOther = Math.abs(r.lat) <= r.halfWidth + (useHint ? 1.8 : 0.4) && r.height > 0.1 && r.height < 1.1; // a branch may sit (clamped) below the other road
                if (!onOther) { bad++; if (bad < 8) errors.push(`locate: ${p.id}@${s.toFixed(1)} lat ${lat.toFixed(1)} -> path ${r.path} lat ${r.lat.toFixed(1)} h ${r.height.toFixed(2)}`); }
                continue;
              }
              const dl = Math.abs(r.lat - lat);
              worstP = Math.max(worstP, dp); worstLat = Math.max(worstLat, dl);
              if (dp > 0.8 * (p.index === 0 ? 1 : p.mainSpan / p.length + 0.2) || dl > 0.3 || Math.abs(r.height - 0.4) > 0.1) {
                bad++;
                if (bad < 8) errors.push(`locate: ${p.id}@${s.toFixed(1)} lat ${lat.toFixed(1)} -> progress off ${dp.toFixed(2)}, lat ${r.lat.toFixed(2)}, h ${r.height.toFixed(2)}`);
              }
            }
          }
        }
      }
      metrics.locateChecks = n;
      metrics.locateWorstProgress = Math.round(worstP * 100) / 100;
      metrics.locateWorstLat = Math.round(worstLat * 100) / 100;
      if (bad >= 8) errors.push(`locate: ${bad} failures in total`);
    }

    // 5. colliders watertight: ray down from every road / shoulder point
    {
      const rc = new GroundRaycaster(track.colliders);
      const f = frame();
      let n = 0, bad = 0, worst = 0;
      const rampCover = (p: number, s: number) => track.ramps.some((r) => r.path === p && s >= r.s0 - 0.5 && s <= r.s0 + r.length + 1.5);
      for (const p of track.paths) {
        for (let s = 0.5; s < p.length - 0.5; s += 1) {
          if (rampCover(p.index, s)) continue;
          track.frameOn(p, s, 0, f);
          const hw = f.halfWidth;
          for (let lat = -hw + 0.1; lat <= hw - 0.1 + 1e-6; lat += (hw * 2 - 0.2) / 6) {
            track.frameOn(p, s, lat, f);
            const hit = rc.cast(f.pos.x, f.pos.y + 2.5, f.pos.z);
            n++;
            const d = hit ? hit.y - f.pos.y : -Infinity;
            // overlays (pads, patches) sit up to 2.5 cm above; branches sink 2 cm per level under the main road
            // a branch overlapping a lower-index road lies just under that road's surface
            const other = p.index > 0 ? track.otherRoadAt(f.pos, p.index, Math.floor(s / p.ds), 1e9, 0, 1) : null;
            // main points next to a junction may hit the branch surface a few cm higher (small lip)
            const okOther = (hit && other !== null && Math.abs(hit.y - other) < tol) || (hit && p.index === 0 && (hit.c.id.startsWith('road') || hit.c.id === 'shoulder') && d > 0 && d < 0.2 && Math.abs(lat) > hw - 0.7)
              // branch surfaces bend under the road they overlap within ~40 m of a junction
              || (hit && p.index > 0 && (s < 40 || s > p.length - 40) && d < 0.25 && d > -0.25);
            if (!okOther && (!hit || d < -0.02 * p.index - tol || d > tol)) {
              bad++;
              worst = Math.max(worst, Math.abs(d));
              if (bad < 8) errors.push(`ground: ${p.id}@${s.toFixed(0)} lat ${lat.toFixed(1)}: ${hit ? `hit ${hit.c.id} at ${d.toFixed(3)} m` : 'no ground'}`);
            }
          }
          // shoulders
          const r = Math.floor(s / p.ds);
          const junction = p.index > 0 && (s < 40 || s > p.length - 40);
          if (!junction && !p.deck[r] && !p.deck[Math.min(p.count - 1, r + 2)] && !p.deck[Math.max(0, r - 2)]) for (const side of [-1, 1]) {
            track.frameOn(p, s, side * (hw + 1), f);
            const hit = rc.cast(f.pos.x, f.pos.y + 2.5, f.pos.z);
            n++;
            if (!hit || (hit.y < f.pos.y - 0.3 && !hit.c.id.startsWith('road'))) { bad++; if (bad < 8) errors.push(`ground: shoulder hole at ${p.id}@${s.toFixed(0)} side ${side}`); }
          }
        }
      }
      metrics.groundChecks = n;
      if (bad >= 8) errors.push(`ground: ${bad} failures in total (worst ${worst.toFixed(3)} m)`);
      // kill plane below every ground
      let minY = Infinity;
      for (const c of track.colliders) if (c.kind === 'ground') for (let k = 1; k < c.vertices.length; k += 3) minY = Math.min(minY, c.vertices[k]);
      metrics.minGroundY = Math.round(minY * 100) / 100;
      if (track.killY >= minY - 1) errors.push(`killY ${track.killY.toFixed(1)} not below the lowest ground ${minY.toFixed(1)}`);
    }

    // 6. grid on the road, facing forward
    track.startGrid.forEach((g, i) => {
      const r = track.locate(g.pos, undefined, loc());
      const fwd = new Vector3(0, 0, 1).applyQuaternion(g.quat);
      const f = track.sample(r.progress, 0, 0);
      if (r.path !== 0 || !r.onRoad || Math.abs(r.lat) > r.halfWidth - 1.2 || Math.abs(r.height) > 0.15) errors.push(`grid ${i} not on the road (lat ${r.lat.toFixed(1)}, h ${r.height.toFixed(2)})`);
      if (fwd.dot(f.forward) < 0.95) errors.push(`grid ${i} not facing forward`);
      if (r.progress < L / 2) errors.push(`grid ${i} in front of the start line`);
    });

    // 7. item boxes above the road
    for (const b of track.itemBoxes) {
      const r = track.locate(b.pos, undefined, loc());
      if (!r.onRoad || r.height < 0.6 || r.height > 1.6) errors.push(`item box ${b.id} not above the road (lat ${r.lat.toFixed(1)}, h ${r.height.toFixed(2)})`);
    }
    metrics.itemBoxes = track.itemBoxes.length;

    // 8. walls never cross a road
    {
      let bad = 0;
      for (const b of track.barriers) for (const q of b.pts) {
        if (b.kind === 'deckRail') continue;
        const r = track.locate(q, undefined, loc());
        if (Math.abs(r.lat) < r.halfWidth - 0.2 && Math.abs(r.height) < 2) { bad++; if (bad < 4) errors.push(`barrier (${b.kind}) on the road at ${track.paths[r.path].id}@${r.progress.toFixed(0)}`); }
      }
      for (const st of track.structures) {
        for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const q = st.center.clone().addScaledVector(st.fwd, (a * st.length) / 2).addScaledVector(st.right, (b * st.width) / 2);
          q.y += 1;
          const r = track.locate(q, undefined, loc());
          if (r.path !== st.path && Math.abs(r.lat) < r.halfWidth + 1) errors.push(`${st.type} corner on ${track.paths[r.path].id}@${r.progress.toFixed(0)}`);
        }
      }
    }

    // 8b. no wall collider intrudes into any road (except door colliders, which close a branch on purpose)
    {
      let bad = 0;
      const q = new Vector3();
      const l = loc();
      for (const c of track.colliders) {
        if (c.kind !== 'wall' || c.id.startsWith('door.')) continue;
        const v = c.vertices;
        for (let k = 0; k < c.indices.length; k += 3) {
          // test the triangle centroid and its vertices at their base
          for (const w of [[1 / 3, 1 / 3, 1 / 3], [1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
            const a = c.indices[k], b = c.indices[k + 1], d = c.indices[k + 2];
            q.set(v[a * 3] * w[0] + v[b * 3] * w[1] + v[d * 3] * w[2], v[a * 3 + 1] * w[0] + v[b * 3 + 1] * w[1] + v[d * 3 + 1] * w[2], v[a * 3 + 2] * w[0] + v[b * 3 + 2] * w[1] + v[d * 3 + 2] * w[2]);
            const r = track.locate(q, undefined, l);
            const margin = c.id === 'walls' ? 0.02 : 0.8;
            if (Math.abs(r.lat) < r.halfWidth + margin && r.height > -0.8 && r.height < 3) {
              bad++;
              if (bad < 6) errors.push(`wall collider '${c.id}' intrudes into ${track.paths[r.path].id}@${r.progress.toFixed(0)} lat ${r.lat.toFixed(1)}`);
              break;
            }
          }
        }
      }
      if (bad >= 6) errors.push(`wall colliders: ${bad} intrusions in total`);
    }

    // 9. racing line inside the road
    for (const p of track.paths) {
      const lat = track.rlLat[p.index], sp = track.rlSpeed[p.index];
      let minSp = 1;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(lat[i]) > p.hw[i]) { errors.push(`racing line leaves ${p.id} at ${(i * p.ds).toFixed(0)}`); break; }
        minSp = Math.min(minSp, sp[i]);
      }
      metrics[`minLineSpeed.${p.id}`] = Math.round(minSp * 100) / 100;
    }

    // 10. zones
    for (const z of track.zones) if (!(z.from >= 0 && z.from <= L && z.to >= 0 && z.to <= L)) errors.push(`zone ${z.kind} out of range`);
    // 11. props not floating / buried
    {
      let bad = 0;
      for (const pr of track.props) {
        const g = track.groundAt(pr.x, pr.z, pr.y + 1);
        if (Math.abs(g - pr.y) > 0.6 && pr.name !== 'start_gate' && pr.name !== 'balloon_arch') { bad++; if (bad < 4) warnings.push(`prop ${pr.name} at ${pr.x.toFixed(0)},${pr.z.toFixed(0)} is ${(pr.y - g).toFixed(2)} m off the ground`); }
      }
    }
  } finally {
    track.paths.forEach((p, i) => (p.enabled = saved[i]));
  }
  return { errors, warnings, metrics };
}
