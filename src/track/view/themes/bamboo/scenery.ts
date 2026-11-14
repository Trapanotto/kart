// Bambus-Tempel set dressing built in code: bamboo fences replacing the farm fences, mossy stone
// walls, the waterfall and the distant bamboo forest. Owner: track 2.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RenderContext } from '../../../../core/types';
import type { BuiltTrack } from '../../../builder';
import { BAMBUS_GORGE } from '../../../scripts/bambus';
import type { TexLib } from '../../materials';
import { backdropGeometry } from '../../meshes';
import { caneMaterial, foamMaterial, mossStone, waterfallMaterial } from './materials';

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Replaces wooden fences / rails / boundary fences with bamboo ones; re-skins stone walls with moss. */
export function restyleBarriers(t: BuiltTrack, ctx: RenderContext, root: THREE.Group, T: TexLib): void {
  for (const o of [...root.children]) {
    if (o.name === 'barriers.wood' || o.name === 'tile.fence_wood') o.visible = false;
    if (o.name === 'barriers.stone' && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = mossStone(T);
  }
  const mobile = ctx.quality.tier === 'mobile';
  const post = new THREE.CylinderGeometry(1, 1, 1, 5, 1, false);
  post.translate(0, 0.5, 0);
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), d = new THREE.Vector3();
  let n = 0;
  const add = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    d.subVectors(b, a);
    const L = d.length();
    if (L < 0.05) return;
    q.setFromUnitVectors(up, d.normalize());
    mats.push(new THREE.Matrix4().compose(a, q.clone(), new THREE.Vector3(r, L, r)));
    const h = hash(n++);
    cols.push(new THREE.Color().setHSL(0.16 + h * 0.06, 0.45 + h * 0.1, 0.42 + h * 0.12));
  };
  const step = mobile ? 3.2 : 1.7;
  for (const bar of t.barriers) {
    if (bar.kind !== 'fence' && bar.kind !== 'boundary' && bar.kind !== 'rail') continue;
    const h = bar.kind === 'rail' ? 0.85 : 1.25;
    const pts = bar.pts;
    // resample by arc length
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const total = cum[cum.length - 1];
    const cnt = Math.max(1, Math.round(total / step));
    const at = (dd: number) => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < dd) k++;
      const f = (dd - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
      return pts[k - 1].clone().lerp(pts[k], Math.min(1, Math.max(0, f)));
    };
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= cnt; k++) {
      const p = at((total * k) / cnt);
      p.y -= 0.2;
      add(p, p.clone().setY(p.y + h + 0.2 + hash(n) * 0.2), 0.06);
      if (prev) {
        for (const z of mobile ? [h * 0.75] : [h * 0.45, h * 0.9]) {
          add(prev.clone().setY(prev.y + z + 0.2), p.clone().setY(p.y + z + 0.2), 0.045);
        }
      }
      prev = p;
    }
  }
  if (!mats.length) return;
  const im = new THREE.InstancedMesh(post, caneMaterial(), mats.length);
  mats.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, cols[i]); });
  im.castShadow = !mobile;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  im.name = 'bamboo.fences';
  root.add(im);
}

/** Waterfall at the head of the gorge: animated sheet, foam at its foot, spray. */
export function buildWaterfall(t: BuiltTrack, ctx: RenderContext, root: THREE.Group): { update(dt: number): void } | null {
  const T = t.terrain;
  const brook = T.def.brooks?.[0];
  if (!brook) return null;
  const [x, z0, level] = brook.points[0];
  // walk north from the head of the brook to the cliff top
  let zTop = z0, yTop = level;
  for (let z = z0; z < z0 + 40; z += 0.5) {
    const h = T.heightAt(x, z);
    if (h > level + 6) { zTop = z; yTop = h; break; }
  }
  // the face may span a few grid cells: climb to the real lip
  for (let z = zTop; z < zTop + 9; z += 0.5) yTop = Math.max(yTop, T.heightAt(x, z));
  if (yTop < level + 5) return null;
  const H = yTop - level + 0.8;
  const W = 9;
  const geo = new THREE.PlaneGeometry(W, H, 6, 14);
  // bow the sheet outward at the top (water shoots over the lip)
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const v = (p.getY(i) + H / 2) / H; // 0 bottom .. 1 top
    p.setZ(i, -Math.pow(v, 3) * 1.6 - 0.4 * Math.sin(Math.PI * v));
  }
  geo.computeVertexNormals();
  const sheet = new THREE.Mesh(geo, waterfallMaterial());
  sheet.position.set(x, level + H / 2 - 0.4, zTop - 2.2);
  sheet.rotation.y = Math.PI; // face south (towards the bridge)
  sheet.name = 'bamboo.waterfall';
  root.add(sheet);
  const foam = new THREE.Mesh(new THREE.CircleGeometry(6, 24), foamMaterial());
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(x, level + 0.08, zTop - 6);
  root.add(foam);
  const mist = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), foamMaterial());
  mist.position.set(x, level + 3.5, zTop - 5.5);
  mist.rotation.y = Math.PI;
  root.add(mist);
  let tt = 0;
  const pos = new THREE.Vector3(x, level + 0.4, zTop - 4.5);
  return {
    update(dt) {
      tt += dt;
      if (ctx.quality.tier !== 'mobile' && tt > 0.35) {
        tt = 0;
        pos.x = x + (Math.random() - 0.5) * 5;
        ctx.vfx.spawn('splash', pos, { scale: 1.6, color: '#e8f4f4' });
      }
    },
  };
}

/** Distant bamboo forest on the backdrop ring: instanced low-LOD bamboo clumps, one draw call. */
export function buildDistantBamboo(t: BuiltTrack, ctx: RenderContext, root: THREE.Group): void {
  const { geo: back, trees } = backdropGeometry(t);
  back.dispose();
  let geo: THREE.BufferGeometry | null = null;
  let mat: THREE.Material = new THREE.MeshStandardMaterial({ roughness: 1, color: '#6d9a42' });
  if (ctx.assets.has('prop.bamboo_clump.lod1')) {
    const src = ctx.assets.model('prop.bamboo_clump.lod1');
    src.updateMatrixWorld(true);
    const geos: THREE.BufferGeometry[] = [];
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      geos.push(g.index ? g.toNonIndexed() : g);
      mat = m.material as THREE.Material;
    });
    if (geos.length) geo = mergeGeometries(geos, false);
  }
  if (!geo) {
    const c = new THREE.CylinderGeometry(0.12, 0.18, 12, 4, 1, true);
    c.translate(0, 6, 0);
    geo = c;
  }
  const keep = ctx.quality.tier === 'mobile' ? 130 : ctx.quality.tier === 'medium' ? 420 : 700;
  const list = trees.slice(0, keep);
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4(), s = new THREE.Matrix4();
  list.forEach((m, k) => { im.setMatrixAt(k, m4.copy(m).multiply(s.makeScale(1.3, 1.25 + (k % 5) * 0.08, 1.3))); });
  im.computeBoundingSphere();
  im.name = 'bamboo.backdrop';
  root.add(im);
  void BAMBUS_GORGE;
}
