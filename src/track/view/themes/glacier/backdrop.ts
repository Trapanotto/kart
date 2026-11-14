// Backdrop for the glacier: the terrain falls away from the grid border into a sea of clouds, with
// a ring of distant snowy peaks standing out of it. Replaces the default rising backdrop + forest.
// Owner: track 4.
import * as THREE from 'three/webgpu';
import { createRng } from '../../../../core/data';
import type { BuiltTrack } from '../../../builder';
import { valueNoise } from '../../../terrain';
import { Geo } from '../../meshes';

export const CLOUD_Y = -26;

/** Slope ring from the terrain border down below the clouds (same material as the terrain). */
export function fallRing(t: BuiltTrack): THREE.BufferGeometry {
  const T = t.terrain;
  const g = new Geo();
  const cx = T.x0 + ((T.nx - 1) * T.cell) / 2, cz = T.z0 + ((T.nz - 1) * T.cell) / 2;
  const border: [number, number][] = [];
  for (let i = 0; i < T.nx - 1; i++) border.push([i, 0]);
  for (let j = 0; j < T.nz - 1; j++) border.push([T.nx - 1, j]);
  for (let i = T.nx - 1; i > 0; i--) border.push([i, T.nz - 1]);
  for (let j = T.nz - 1; j > 0; j--) border.push([0, j]);
  const rings = [0, 14, 34, 64, 110, 180, 280];
  const ids: number[][] = [];
  for (const [i, j] of border) {
    const x = T.x0 + i * T.cell, z = T.z0 + j * T.cell;
    const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz);
    const h0 = T.h[j * T.nx + i];
    const col: number[] = [];
    for (const r of rings) {
      const px = x + (dx / l) * r, pz = z + (dz / l) * r;
      // north (behind the summit) the range keeps rising a little before it drops
      const north = Math.max(0, pz / 400);
      const f = r / 280;
      const target = CLOUD_Y - 30;
      let y = h0 + (target - h0) * (f * f * (3 - 2 * f));
      y += north * 40 * Math.sin(Math.PI * Math.min(1, f * 1.4));
      y += valueNoise(px / 40, pz / 40) * Math.min(1, r / 30) * 7;
      col.push(g.vert([px, r === 0 ? h0 : y, pz], { blend: [0, 0, 0, 0] }));
    }
    ids.push(col);
  }
  for (let k = 0; k < ids.length; k++) {
    const a = ids[k], b = ids[(k + 1) % ids.length];
    for (let r = 0; r < rings.length - 1; r++) g.quad(a[r], b[r], a[r + 1], b[r + 1]);
  }
  const geo = g.build();
  // make faces point up
  const nrm = geo.getAttribute('normal');
  let up = 0;
  for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
  if (up < 0) {
    const ix = geo.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) { const a = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, a); }
    geo.computeVertexNormals();
  }
  return geo;
}

/** Big disc at the cloud level. */
export function cloudSea(t: BuiltTrack): THREE.BufferGeometry {
  const T = t.terrain;
  const cx = T.x0 + ((T.nx - 1) * T.cell) / 2, cz = T.z0 + ((T.nz - 1) * T.cell) / 2;
  const geo = new THREE.CircleGeometry(2600, 48);
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, CLOUD_Y, cz);
  return geo;
}

/**
 * Distant mountains: noisy cones with ridges, 600 to 1700 m away, standing out of the clouds.
 * Attribute 'haze' (0..1) grows with distance. `count` scales with quality.
 */
export function peaks(t: BuiltTrack, count: number, seg: number): THREE.BufferGeometry {
  const T = t.terrain;
  const cx = T.x0 + ((T.nx - 1) * T.cell) / 2, cz = T.z0 + ((T.nz - 1) * T.cell) / 2;
  const rng = createRng(9137);
  const g = new Geo();
  for (let k = 0; k < count; k++) {
    // spread round the horizon, a bit denser to the north and east (behind the summit)
    const a = (k / count) * Math.PI * 2 + rng.next() * 0.35;
    const dist = 1050 + rng.next() * 1100;
    const px = cx + Math.cos(a) * dist, pz = cz + Math.sin(a) * dist;
    const H = 170 + rng.next() * 300 + (Math.sin(a) > 0.3 ? 90 : 0);
    const Rb = H * (1.3 + rng.next() * 0.9);
    const haze = Math.min(1, (dist - 900) / 1400) * 0.6 + 0.2;
    const rings = 10;
    const ph = rng.next() * 10;
    const ids: number[][] = [];
    for (let r = 0; r <= rings; r++) {
      const f = r / rings; // 0 = base, 1 = tip
      const row: number[] = [];
      for (let s = 0; s < seg; s++) {
        const th = (s / seg) * Math.PI * 2;
        // ridged cone: a few spurs + noise, sharper towards the top
        const spur = 0.62 + 0.38 * Math.abs(Math.sin(th * 2.5 + ph)) + valueNoise(th * 3 + ph, f * 4) * 0.32 + valueNoise(th * 9 + ph, f * 9) * 0.12;
        const rr = Rb * (1 - f) ** 1.15 * spur;
        const y = CLOUD_Y - 40 + (H - CLOUD_Y + 40) * f + valueNoise(th * 3 + ph, f * 5) * H * 0.1 * (1 - f) + (r === rings ? valueNoise(ph, 1) * H * 0.04 : 0);
        row.push(g.vert([px + Math.cos(th) * rr, y, pz + Math.sin(th) * rr], { haze }));
      }
      ids.push(row);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
      const s2 = (s + 1) % seg;
      g.quad(ids[r][s], ids[r][s2], ids[r + 1][s], ids[r + 1][s2]);
    }
  }
  const geo = g.build();
  const nrm = geo.getAttribute('normal');
  let up = 0;
  for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
  if (up < 0) {
    const ix = geo.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) { const a = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, a); }
  }
  // flat shading: drop the index so normals are per face
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}
