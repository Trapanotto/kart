// Scenery props: real models from the asset library when they exist, otherwise stylised
// placeholders; instanced per (prop, sub-mesh, tag). Owner: track.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RenderContext } from '../../core/types';
import type { PlacedProp } from '../builder';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export function mat(c: string, rough = 0.85, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = c + rough + JSON.stringify(extra);
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, ...extra })));
  return m;
}

type Part = { geo: THREE.BufferGeometry; color: string; rough?: number; name?: string; side?: THREE.Side };

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
  return g.clone().applyMatrix4(m);
}

/** Merges parts with the same colour into one mesh each. */
function assemble(parts: Part[]): THREE.Group {
  const byKey = new Map<string, Part[]>();
  for (const p of parts) {
    const k = `${p.color}|${p.rough ?? 0.85}|${p.name ?? ''}|${p.side ?? 0}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(p);
  }
  const g = new THREE.Group();
  for (const [, ps] of byKey) {
    const geos = ps.map((p) => (p.geo.index ? p.geo.toNonIndexed() : p.geo));
    for (const geo of geos) { for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal') geo.deleteAttribute(n); }
    const merged = mergeGeometries(geos, false)!;
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, mat(ps[0].color, ps[0].rough ?? 0.85, ps[0].side ? { side: ps[0].side } : {}));
    if (ps[0].name) mesh.name = ps[0].name;
    g.add(mesh);
  }
  return g;
}

const cyl = (rt: number, rb: number, h: number, n = 8) => new THREE.CylinderGeometry(rt, rb, h, n, 1);
const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function crown(r: number, y: number, seed: number): THREE.BufferGeometry[] {
  const out = [at(ico(r, 1), 0, y, 0)];
  for (let k = 0; k < 3; k++) {
    const a = seed + k * 2.1;
    out.push(at(ico(r * 0.62, 1), Math.cos(a) * r * 0.6, y + (k - 1) * r * 0.25, Math.sin(a) * r * 0.6));
  }
  return out;
}

/** Stylised placeholders at real-world scale (origin on the ground, front +Z). */
export function placeholder(name: string): THREE.Group {
  const P: Part[] = [];
  const add = (geo: THREE.BufferGeometry | THREE.BufferGeometry[], color: string, rough?: number, nm?: string) => {
    for (const g of Array.isArray(geo) ? geo : [geo]) P.push({ geo: g, color, rough, name: nm });
  };
  switch (name) {
    case 'tree_oak':
      add(at(cyl(0.28, 0.42, 3.4), 0, 1.7, 0), '#6b4a30');
      add(crown(2.6, 4.6, 0.3), '#4a8a34');
      break;
    case 'tree_birch':
      add(at(cyl(0.15, 0.22, 5.2), 0, 2.6, 0), '#e8e2d6');
      add(at(ico(1.7, 1), 0, 5.4, 0, 0, 0, 0, [1, 1.6, 1]), '#79b247');
      break;
    case 'tree_apple':
      add(at(cyl(0.2, 0.3, 1.9), 0, 0.95, 0), '#6e4b2e');
      add(crown(1.9, 2.9, 1.1), '#5c9e3c');
      for (let k = 0; k < 7; k++) { const a = k * 0.9; add(at(ico(0.16, 0), Math.cos(a) * 1.7, 2.4 + (k % 3) * 0.5, Math.sin(a) * 1.7), '#d8342a', 0.5); }
      break;
    case 'bush':
      add([at(ico(1.0, 1), 0, 0.55, 0, 0, 0, 0, [1.2, 0.8, 1]), at(ico(0.7, 1), 0.7, 0.45, 0.3)], '#3f7d33');
      break;
    case 'hedge':
      add(at(box(3, 1.5, 1.1), 0, 0.75, 0), '#356f2c');
      break;
    case 'flower_patch': {
      const cols = ['#f4d23c', '#f2f2f2', '#e45a8c', '#a26ee0'];
      for (let k = 0; k < 9; k++) { const a = k * 2.4, r = 0.25 + (k % 3) * 0.25; add(at(ico(0.11, 0), Math.cos(a) * r, 0.22, Math.sin(a) * r), cols[k % 4], 0.6); }
      add(at(cyl(0.7, 0.75, 0.12, 7), 0, 0.06, 0), '#4f9a3c');
      break;
    }
    case 'grass_tuft':
      for (let k = 0; k < 5; k++) { const a = k * 1.26; add(at(new THREE.ConeGeometry(0.06, 0.55, 3), Math.cos(a) * 0.15, 0.27, Math.sin(a) * 0.15, Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25), '#5f9d3d', 1); }
      break;
    case 'rock_a':
      add(at(new THREE.DodecahedronGeometry(1, 0), 0, 0.45, 0, 0.3, 0.5, 0, [1.3, 0.75, 1]), '#8f8a80', 0.95);
      break;
    case 'rock_b':
      add(at(ico(0.6, 0), 0, 0.3, 0, 0.2, 0.8, 0.1, [1, 0.7, 1.2]), '#9b958a', 0.95);
      break;
    case 'fence_wood':
      add([at(box(0.15, 1.2, 0.15), -1.2, 0.6, 0), at(box(0.15, 1.2, 0.15), 1.2, 0.6, 0), at(box(2.5, 0.12, 0.06), 0, 0.55, 0), at(box(2.5, 0.12, 0.06), 0, 1.0, 0)], '#8a6440');
      break;
    case 'hay_bale':
      add(at(cyl(0.75, 0.75, 1.4, 12), 0, 0.75, 0, 0, 0, Math.PI / 2), '#e0bf5a', 1);
      break;
    case 'hay_stack':
      add([at(cyl(1.6, 2.2, 1.4, 10), 0, 0.7, 0), at(new THREE.ConeGeometry(1.6, 1.6, 10), 0, 2.2, 0)], '#d9b450', 1);
      break;
    case 'crate':
      add(at(box(1, 1, 1), 0, 0.5, 0), '#a77b4a');
      break;
    case 'windmill': {
      add(at(cyl(2.3, 3.4, 11, 8), 0, 5.5, 0), '#efe6d2');
      add(at(new THREE.ConeGeometry(2.8, 3, 8), 0, 12.4, 0), '#b8432f');
      add(at(box(1.2, 2, 0.3), 0, 1, 3.2), '#5b3a24');
      break;
    }
    case 'farmhouse':
      add(at(box(14, 6, 10), 0, 3, 0), '#f1e6cf');
      add([at(box(15.5, 0.4, 7.2), 0, 7.6, -2.6, 0.72, 0, 0), at(box(15.5, 0.4, 7.2), 0, 7.6, 2.6, -0.72, 0, 0)], '#a8432f');
      add([at(box(1.6, 2.6, 0.2), 0, 1.3, 5.05), at(box(1.4, 1.3, 0.2), -4, 3.8, 5.05), at(box(1.4, 1.3, 0.2), 4, 3.8, 5.05), at(box(1.4, 1.3, 0.2), -4, 1.6, 5.05), at(box(1.4, 1.3, 0.2), 4, 1.6, 5.05)], '#5a3b26');
      break;
    case 'silo':
      add(at(cyl(3, 3, 11, 14), 0, 5.5, 0), '#b9c3c9', 0.5);
      add(at(new THREE.SphereGeometry(3, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 11, 0), '#8e9aa3', 0.4);
      break;
    case 'tractor':
      add([at(box(1.6, 1.1, 2.6), 0, 1.25, 0), at(box(1.4, 1.4, 1.2), 0, 2.2, -0.5)], '#c9372b', 0.5);
      add([at(cyl(0.75, 0.75, 0.5, 12), -0.95, 0.75, -0.7, 0, 0, Math.PI / 2), at(cyl(0.75, 0.75, 0.5, 12), 0.95, 0.75, -0.7, 0, 0, Math.PI / 2), at(cyl(0.45, 0.45, 0.4, 10), -0.85, 0.45, 1.0, 0, 0, Math.PI / 2), at(cyl(0.45, 0.45, 0.4, 10), 0.85, 0.45, 1.0, 0, 0, Math.PI / 2)], '#222222', 0.9);
      break;
    case 'sheep':
      add(at(ico(0.55, 1), 0, 0.85, 0, 0, 0, 0, [1.05, 0.9, 1.4]), '#f6f1e6', 1);
      add(at(ico(0.24, 1), 0, 1.05, 0.78, 0, 0, 0, [0.9, 1.1, 1.2]), '#2b2522', 0.8);
      add([at(cyl(0.07, 0.07, 0.55, 5), -0.28, 0.28, 0.4), at(cyl(0.07, 0.07, 0.55, 5), 0.28, 0.28, 0.4), at(cyl(0.07, 0.07, 0.55, 5), -0.28, 0.28, -0.4), at(cyl(0.07, 0.07, 0.55, 5), 0.28, 0.28, -0.4)], '#2b2522', 0.8);
      break;
    case 'scarecrow':
      add([at(cyl(0.07, 0.07, 2.4, 5), 0, 1.2, 0), at(cyl(0.05, 0.05, 1.8, 5), 0, 1.7, 0, 0, 0, Math.PI / 2)], '#7a5634');
      add(at(box(0.7, 0.8, 0.35), 0, 1.6, 0), '#3d6fb0');
      add(at(ico(0.25, 1), 0, 2.25, 0), '#e8cf8a');
      add(at(new THREE.ConeGeometry(0.45, 0.5, 8), 0, 2.55, 0), '#c49a3c');
      break;
    case 'well':
      add(at(cyl(1, 1.05, 0.9, 12), 0, 0.45, 0), '#9a9387', 0.95);
      add([at(box(0.15, 1.8, 0.15), -0.85, 1.4, 0), at(box(0.15, 1.8, 0.15), 0.85, 1.4, 0)], '#6d4b2f');
      add([at(box(2.3, 0.12, 1.2), 0, 2.45, -0.4, 0.5, 0, 0), at(box(2.3, 0.12, 1.2), 0, 2.45, 0.4, -0.5, 0, 0)], '#a8432f');
      break;
    case 'sign_arrow': {
      add(at(cyl(0.06, 0.06, 1.6, 6), 0, 0.8, 0), '#6d6d6d', 0.6);
      add(at(box(1.6, 0.8, 0.08), 0, 1.6, 0), '#f2f0e8', 0.5);
      for (let k = 0; k < 3; k++) add([at(box(0.12, 0.42, 0.1), -0.45 + k * 0.45 - 0.08, 1.7, 0.02, 0, 0, 0.7), at(box(0.12, 0.42, 0.1), -0.45 + k * 0.45 - 0.08, 1.5, 0.02, 0, 0, -0.7)], '#d63c2c', 0.5);
      break;
    }
    case 'grandstand': {
      for (let k = 0; k < 4; k++) add(at(box(26, 0.9 + k * 0.9, 2), 0, (0.9 + k * 0.9) / 2, 3 - k * 2), '#c9c2b4');
      add([at(box(0.3, 6.5, 0.3), -12.8, 3.25, -4.2), at(box(0.3, 6.5, 0.3), 12.8, 3.25, -4.2), at(box(0.3, 4.6, 0.3), -12.8, 2.3, 3.8), at(box(0.3, 4.6, 0.3), 12.8, 2.3, 3.8)], '#7a7f86', 0.5);
      add(at(box(27, 0.25, 9.6), 0, 5.7, -0.2, -0.2, 0, 0), '#2f7fc1', 0.6);
      const cols = ['#e8604c', '#f2c94c', '#56b07a', '#5f8fe0', '#f2f2f2', '#c26fd1'];
      for (let k = 0; k < 4; k++) for (let x = -12; x <= 12; x += 1.1) add(at(ico(0.28, 0), x + ((k * 7) % 3) * 0.2, 1.3 + k * 0.9, 3 - k * 2 - 0.2), cols[Math.abs(Math.round(x * 3 + k * 5)) % cols.length], 0.9);
      break;
    }
    case 'bridge_wood':
      add([at(box(2.6, 0.2, 9), 0, 1.0, 0)], '#8e6a44');
      add([at(box(0.12, 1, 9), -1.25, 1.55, 0), at(box(0.12, 1, 9), 1.25, 1.55, 0)], '#6d4b2f');
      add([at(box(0.3, 1.3, 0.3), -1.2, 0.45, -4), at(box(0.3, 1.3, 0.3), 1.2, 0.45, -4), at(box(0.3, 1.3, 0.3), -1.2, 0.45, 4), at(box(0.3, 1.3, 0.3), 1.2, 0.45, 4)], '#6d4b2f');
      break;
    case 'barn':
      add(at(box(10, 6, 14), 0, 3, 0), '#a8432f');
      break;
    default:
      add(at(box(1, 1, 1), 0, 0.5, 0), '#c0c0c0');
  }
  const g = assemble(P.filter((p) => p.geo.getAttribute('position')?.count));
  if (name === 'windmill') {
    // blades: child named 'blades', rotating about local Z
    const blades = new THREE.Group();
    blades.name = 'blades';
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      parts.push(at(box(0.5, 6.2, 0.12), Math.sin(a) * 3.3, Math.cos(a) * 3.3, 0, 0, 0, -a));
      parts.push(at(box(1.3, 5.2, 0.05), Math.sin(a) * 3.3 + Math.cos(a) * 0.8, Math.cos(a) * 3.3 - Math.sin(a) * 0.8, 0.05, 0, 0, -a));
    }
    const geos = parts.map((p) => p.toNonIndexed());
    for (const geo of geos) geo.deleteAttribute('uv');
    blades.add(new THREE.Mesh(mergeGeometries(geos)!, mat('#f4efe4', 0.8, { side: THREE.DoubleSide })));
    blades.position.set(0, 10.4, 3.1);
    g.add(blades);
  }
  return g;
}

/** Sizes props should have (for fitting models whose scale is off). */
export function sourceFor(name: string, ctx: RenderContext): THREE.Object3D {
  const key = `prop.${name}`;
  if (ctx.assets.has(key)) return ctx.assets.model(key);
  return placeholder(name);
}

const NO_SHADOW = new Set(['grass_tuft', 'flower_patch']);
/** On mobile only the big shapes cast shadows (each caster is another draw call per cascade). */
const MOBILE_SHADOW = new Set(['tree_oak', 'tree_birch', 'tree_apple', 'farmhouse', 'windmill', 'silo', 'grandstand', 'barn', 'tractor', 'hay_stack']);
/** Props that have a `.lod1` model; used beyond FAR metres from the road (always on mobile). */
export const LOD_PROPS = new Set(['tree_oak', 'tree_birch', 'tree_apple', 'farmhouse', 'grandstand', 'silo', 'windmill', 'barn']);
const FAR = 26;

export interface PropBatch {
  tag?: string;
  meshes: THREE.Object3D[];
}

/** Instanced (or, for single animated props, cloned) scenery. */
export function buildProps(props: PlacedProp[], ctx: RenderContext, parent: THREE.Object3D): { batches: PropBatch[]; animated: THREE.Object3D[] } {
  const density = ctx.quality.density;
  const groups = new Map<string, PlacedProp[]>();
  const flipped: PlacedProp[] = [];
  for (const p of props) {
    if (p.scale < 0) { flipped.push(p); continue; }
    if (p.name === 'start_gate' || p.name === 'balloon_arch') continue;
    if (p.detail && p.keep >= density) continue;
    const far = p.detail && p.dist > FAR;
    const lod = LOD_PROPS.has(p.name) && (far || ctx.quality.tier !== 'high') ? '.lod1' : '';
    const k = `${p.name}${lod}|${p.tag ?? ''}|${far ? 'far' : 'near'}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  const batches: PropBatch[] = [];
  const animated: THREE.Object3D[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of groups) {
    const [lname, tag, band] = key.split('|');
    const name = lname.replace('.lod1', '');
    const src = lname !== name && ctx.assets.has(`prop.${lname}`) ? ctx.assets.model(`prop.${lname}`) : sourceFor(name, ctx);
    const batch: PropBatch = { tag: tag || undefined, meshes: [] };
    const cast = !NO_SHADOW.has(name) && band === 'near' && (ctx.quality.tier !== 'mobile' || MOBILE_SHADOW.has(name));
    let hasAnim = false;
    src.traverse((o) => { if (o.name === 'blades' || o.name === 'door_l' || o.name === 'door_r') hasAnim = true; });
    if (hasAnim || list.length <= 2) {
      for (const p of list) {
        const o = list.length === 1 ? src : src.clone(true);
        o.position.set(p.x, p.y, p.z);
        o.rotation.set(0, p.yaw, 0);
        o.scale.setScalar(p.scale);
        o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = cast; m.receiveShadow = true; } });
        parent.add(o);
        batch.meshes.push(o);
        if (hasAnim) animated.push(o);
      }
      batches.push(batch);
      continue;
    }
    src.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    src.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.Mesh); });
    for (const mesh of meshes) {
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      list.forEach((p, k) => {
        q.setFromAxisAngle(up, p.yaw);
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)).multiply(mesh.matrixWorld);
        im.setMatrixAt(k, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = cast;
      im.receiveShadow = band === 'near';
      im.computeBoundingSphere();
      parent.add(im);
      batch.meshes.push(im);
    }
    batches.push(batch);
  }
  // mirrored props (e.g. left-turn chevron signs) as plain clones so face culling stays right
  for (const p of flipped) {
    const o = sourceFor(p.name, ctx);
    o.position.set(p.x, p.y, p.z);
    o.rotation.set(0, p.yaw, 0);
    o.scale.set(p.scale, -p.scale, -p.scale); // p.scale < 0: mirrored in x only
    o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    parent.add(o);
    batches.push({ tag: p.tag, meshes: [o] });
  }
  return { batches, animated };
}

/**
 * Tiles a run-based prop (fence_wood, hedge: 4 m along local X) along polylines. The child
 * `end_post` is only shown on the last section of each run. Returns false if the model is missing.
 */
export function tileAlong(name: string, runs: THREE.Vector3[][], ctx: RenderContext, parent: THREE.Object3D, step = 4): boolean {
  const key = `prop.${name}`;
  // mobile: the procedural boxes are a fraction of the triangles
  if (!ctx.assets.has(key) || runs.length === 0 || ctx.quality.tier === 'mobile') return false;
  const src = ctx.assets.model(key);
  src.updateMatrixWorld(true);
  const body: THREE.Mesh[] = [], end: THREE.Mesh[] = [];
  src.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    let p: THREE.Object3D | null = o, isEnd = false;
    while (p) { if (p.name === 'end_post') isEnd = true; p = p.parent; }
    (isEnd ? end : body).push(o as THREE.Mesh);
  });
  const sections: { m: THREE.Matrix4; last: boolean }[] = [];
  const q = new THREE.Quaternion(), qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  for (const run of runs) {
    // resample by arc length
    const cum = [0];
    for (let k = 1; k < run.length; k++) cum.push(cum[k - 1] + run[k].distanceTo(run[k - 1]));
    const total = cum[cum.length - 1];
    const n = Math.max(1, Math.round(total / step));
    const at = (d: number) => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < d) k++;
      const f = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      return run[k - 1].clone().lerp(run[k], Math.min(1, Math.max(0, f)));
    };
    for (let k = 0; k < n; k++) {
      const a = at((total * k) / n), b = at((total * (k + 1)) / n);
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      q.setFromAxisAngle(Y, Math.atan2(-dz, dx));
      qz.setFromAxisAngle(Z, Math.atan2(b.y - a.y, l));
      q.multiply(qz);
      const len = a.distanceTo(b);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y -= 0.05;
      sections.push({ m: new THREE.Matrix4().compose(mid, q.clone(), new THREE.Vector3(len / step, 1, 1)), last: k === n - 1 });
    }
  }
  const make = (meshes: THREE.Mesh[], list: THREE.Matrix4[]) => {
    for (const mesh of meshes) {
      if (list.length === 0) continue;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      const m4 = new THREE.Matrix4();
      list.forEach((m, k) => im.setMatrixAt(k, m4.copy(m).multiply(mesh.matrixWorld)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `tile.${name}`;
      parent.add(im);
    }
  };
  make(body, sections.map((s) => s.m));
  make(end, sections.filter((s) => s.last).map((s) => s.m));
  return true;
}
