// Glacier tunnel: an ice arch swept along the main road between two anchors, with an inner glowing
// surface, a snowy outer shell, portal rims and icicle clusters under the ceiling. The right wall is left
// open where the lap-2 crack breaks through (the 'glacier_seal' props close it until then). Owner: track 4.
import * as THREE from 'three/webgpu';
import type { RenderContext } from '../../../../core/types';
import type { BuiltTrack } from '../../../builder';
import { Geo } from '../../meshes';

export interface TunnelOpts {
  s0: number;
  s1: number;
  /** Main-path ranges where the right wall is open below `gapTop`. */
  gaps: [number, number][];
  gapTop: number;
  inner: THREE.Material;
  outer: THREE.Material;
}

const WALL_OUT = 0.45; // inner face beyond the road edge (the wall barrier slab sits there)
const SPRING = 4.0; // where the arch starts
const RISE = 4.2; // arch height above SPRING
const THICK = 1.8;
const ARCH_STEPS = 10;

/** Inner ceiling height above the road at a lateral offset (for hanging things). */
export function ceilingAt(hw: number, lat: number): number {
  const W = hw + WALL_OUT;
  const c = Math.min(1, Math.abs(lat) / W);
  return SPRING + RISE * Math.sqrt(1 - c * c);
}

export function buildTunnel(t: BuiltTrack, ctx: RenderContext, root: THREE.Object3D, o: TunnelOpts): THREE.Object3D[] {
  const main = t.paths[0];
  const inner = new Geo(), outer = new Geo();
  const F = t.frameOn(main, o.s0);
  const R = new THREE.Vector3();
  const P = new THREE.Vector3();
  const n = Math.ceil((o.s1 - o.s0) / 1.5);
  // profile: [lat sign/fraction, height] built per row (left to right)
  const profile = (W: number, add: number): [number, number][] => {
    const pts: [number, number][] = [[-(W + add), -0.8 - add]];
    for (let k = 0; k <= ARCH_STEPS; k++) {
      const th = (Math.PI * k) / ARCH_STEPS;
      pts.push([-(W + add) * Math.cos(th), SPRING + (RISE + add) * Math.sin(th)]);
    }
    pts.push([W + add, -0.8 - add]);
    return pts;
  };
  const rowsI: number[][] = [], rowsO: number[][] = [];
  const inGap = (s: number) => o.gaps.some(([a, b]) => s >= a && s <= b);
  for (let k = 0; k <= n; k++) {
    const s = o.s0 + ((o.s1 - o.s0) * k) / n;
    t.frameOn(main, s, 0, F);
    R.copy(F.right).setY(0).normalize();
    const W = F.halfWidth + WALL_OUT;
    const gap = inGap(s);
    for (const [geo, rows, add] of [[inner, rowsI, 0], [outer, rowsO, THICK]] as const) {
      const row: number[] = [];
      for (const [lat, h0] of profile(W, add)) {
        let h = h0;
        if (gap && lat > 0 && h < o.gapTop + add * 0.3) h = o.gapTop + add * 0.3;
        // follow the banked road surface at the wall line
        const roadY = F.pos.y + F.right.y * Math.max(-F.halfWidth, Math.min(F.halfWidth, lat));
        P.copy(F.pos).addScaledVector(R, lat);
        P.y = roadY + h;
        row.push(geo.vert(P, { blend: [0, 0, 0, 0] }));
      }
      rows.push(row);
    }
  }
  const m = rowsI[0].length;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < m - 1; j++) {
      // inner faces look inward, outer faces outward
      inner.quad(rowsI[k][j], rowsI[k][j + 1], rowsI[k + 1][j], rowsI[k + 1][j + 1]);
      outer.quad(rowsO[k][j + 1], rowsO[k][j], rowsO[k + 1][j + 1], rowsO[k + 1][j]);
    }
  }
  // portal rims and the lintel over the gaps: join inner and outer surfaces
  const rim = (k: number, flip: boolean) => {
    for (let j = 0; j < m - 1; j++) {
      const a = inner.pos.slice(rowsI[k][j] * 3, rowsI[k][j] * 3 + 3), b = inner.pos.slice(rowsI[k][j + 1] * 3, rowsI[k][j + 1] * 3 + 3);
      const c = outer.pos.slice(rowsO[k][j] * 3, rowsO[k][j] * 3 + 3), d = outer.pos.slice(rowsO[k][j + 1] * 3, rowsO[k][j + 1] * 3 + 3);
      const ia = outer.vert(a as [number, number, number], { blend: [0, 0, 0, 0] }), ib = outer.vert(b as [number, number, number], { blend: [0, 0, 0, 0] });
      if (flip) outer.quad(ia, ib, rowsO[k][j], rowsO[k][j + 1]); else outer.quad(ib, ia, rowsO[k][j + 1], rowsO[k][j]);
      void c; void d;
    }
  };
  rim(0, false);
  rim(n, true);
  const out: THREE.Object3D[] = [];
  for (const [geo, mat, name] of [[inner, o.inner, 'tunnel.inner'], [outer, o.outer, 'tunnel.outer']] as const) {
    const g = geo.build();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.castShadow = name === 'tunnel.inner' || ctx.quality.tier !== 'mobile';
    mesh.receiveShadow = true;
    root.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** Icicle clusters under the ceiling (instanced kit prop 'glacier_icicles', origin at its top). */
export function tunnelIcicles(t: BuiltTrack, ctx: RenderContext, root: THREE.Object3D, s0: number, s1: number, iceMat: THREE.Material): THREE.Object3D[] {
  const key = 'prop.glacier_icicles';
  if (!ctx.assets.has(key)) return [];
  const src = ctx.assets.model(key);
  src.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  src.traverse((q) => { if ((q as THREE.Mesh).isMesh) meshes.push(q as THREE.Mesh); });
  const mats: THREE.Matrix4[] = [];
  const F = t.frameOn(t.paths[0], s0);
  const step = ctx.quality.tier === 'mobile' ? 9 : 5;
  let k = 0;
  for (let s = s0 + 3; s < s1 - 3; s += step, k++) {
    t.frameOn(t.paths[0], s, 0, F);
    for (const side of k % 2 ? [-0.55, 0.15] : [-0.2, 0.55]) {
      const lat = side * F.halfWidth;
      const pos = F.pos.clone().addScaledVector(F.right.clone().setY(0).normalize(), lat);
      pos.y = F.pos.y + F.right.y * lat + ceilingAt(F.halfWidth, lat) + 0.15;
      const yaw = Math.atan2(F.forward.x, F.forward.z) + (k % 3) * 0.6;
      const sc = 0.8 + ((k * 7) % 5) * 0.12;
      mats.push(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sc, sc, sc)));
    }
  }
  const out: THREE.Object3D[] = [];
  for (const mesh of meshes) {
    const im = new THREE.InstancedMesh(mesh.geometry, iceMat, mats.length);
    mats.forEach((m4, i) => im.setMatrixAt(i, m4.clone().multiply(mesh.matrixWorld)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'tunnel.icicles';
    root.add(im);
    out.push(im);
  }
  return out;
}
