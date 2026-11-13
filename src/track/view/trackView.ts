// Track view: everything static about a built track, plus its small animations. Owner: track.
// Render side: imports 'three/webgpu' / 'three/tsl' only. Never writes sim state.
import * as THREE from 'three/webgpu';
import type { RenderContext, TrackRuntime, View } from '../../core/types';
import { createStubTrackView } from '../../stubs/stubRender';
import { BuiltTrack, type BuiltStructure } from '../builder';
import { registerHazardViews } from './hazardViews';
import {
  bannerMaterial, flatMaterial, hayMaterial, hedgeMaterial, loadTextures, padMaterial, planksMaterial, rampMaterial, roadMaterial,
  roofMaterial, stoneMaterial, terrainMaterial, TEXTURE_SETS, type TexLib, waterMaterial, woodMaterial,
} from './materials';
import {
  backdropGeometry, barrierBatches, BoxBatch, deckGeometry, markingsGeometry, padGeometry, patchGeometry, rampGeometry, roadGeometry,
  shoulderGeometry, terrainGeometry, waterGeometry,
  COARSE_FAR,
} from './meshes';
import { buildProps, LOD_PROPS, mat, placeholder, tileAlong } from './props';

interface Door { pivot: THREE.Object3D; open: number }

function mesh(geo: THREE.BufferGeometry | null, m: THREE.Material, cast: boolean, parent: THREE.Object3D, name: string): THREE.Mesh | null {
  if (!geo) return null;
  const o = new THREE.Mesh(geo, m);
  o.name = name;
  o.castShadow = cast;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function offset(m: THREE.Material, factor: number, units: number): THREE.Material {
  m.polygonOffset = true;
  m.polygonOffsetFactor = factor;
  m.polygonOffsetUnits = units;
  return m;
}

/** Drive-through barn from the kit: front (+Z) faces the entry, doors swing outward. */
function buildBarnModel(st: BuiltStructure, ctx: RenderContext, parent: THREE.Object3D): Door[] | null {
  let key = `prop.${st.model}`;
  if (!ctx.assets.has(key)) return null;
  if (ctx.quality.tier === 'mobile' && ctx.assets.has(`${key}.lod1`)) key = `${key}.lod1`;
  const m = ctx.assets.model(key);
  m.position.copy(st.center);
  m.rotation.y = Math.atan2(-st.fwd.x, -st.fwd.z);
  m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  parent.add(m);
  const doors: Door[] = [];
  for (const [n, sign] of [['door_l', 1], ['door_r', -1]] as const) {
    const d = m.getObjectByName(n);
    if (!d) continue;
    d.userData.openAngle = sign * 1.85;
    doors.push({ pivot: d, open: 0 });
  }
  return doors;
}

/** Procedural drive-through barn (fallback): walls, gables, roof and four swinging door leaves. */
function buildBarn(st: BuiltStructure, T: TexLib, parent: THREE.Object3D): Door[] {
  const g = new THREE.Group();
  g.position.copy(st.center);
  g.rotation.y = Math.atan2(st.fwd.x, st.fwd.z);
  parent.add(g);
  const W = st.width, L = st.length, H = st.height, Hw = H * 0.62, op = W - 2.2, doorH = Hw - 0.9;
  const red = planksMaterial(T, '#c4513c');
  const trim = mat('#f3eee2', 0.7);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rz = 0, parentObj: THREE.Object3D = g) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.z = rz;
    o.castShadow = true; o.receiveShadow = true;
    parentObj.add(o);
    return o;
  };
  const base = -0.8;
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.4, Hw - base, L), red, sx * (W / 2 - 0.2), (Hw + base) / 2, 0);
  for (const sz of [-1, 1]) {
    const z = sz * (L / 2 - 0.2);
    const pw = (W - op) / 2;
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(pw, Hw - base, 0.42), red, sx * (W / 2 - pw / 2), (Hw + base) / 2, z);
    add(new THREE.BoxGeometry(op, Hw - doorH, 0.42), red, 0, (Hw + doorH) / 2, z);
    // gable
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, H - Hw)]);
    const gable = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false });
    gable.translate(0, Hw, z - 0.21);
    add(gable, red, 0, 0, 0);
    // white trim around the opening
    add(new THREE.BoxGeometry(op + 0.5, 0.3, 0.5), trim, 0, doorH + 0.15, z);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.3, doorH - base, 0.5), trim, sx * (op / 2 + 0.1), (doorH + base) / 2, z);
    // hay loft window
    add(new THREE.BoxGeometry(1.6, 1.4, 0.5), mat('#3a2418', 0.9), 0, Hw + (H - Hw) * 0.35, z);
  }
  // roof
  const half = W / 2 + 0.9, rise = H - Hw + 0.5;
  const slope = Math.atan2(rise, half);
  const len = Math.hypot(half, rise);
  const roof = roofMaterial(T);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(len, 0.3, L + 1.4), roof, (sx * half) / 2, Hw - 0.5 + rise / 2 + 0.2, 0, -sx * slope);
  // doors
  const doors: Door[] = [];
  const leafW = op / 2 - 0.05;
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (op / 2), 0, sz * (L / 2 + 0.05));
    g.add(pivot);
    const leaf = add(new THREE.BoxGeometry(leafW, doorH - base, 0.16), red, -sx * (leafW / 2), (doorH + base) / 2, 0, 0, pivot);
    const diag = Math.atan2(doorH - base, leafW);
    add(new THREE.BoxGeometry(Math.hypot(leafW, doorH - base) - 0.3, 0.22, 0.2), trim, -sx * (leafW / 2), (doorH + base) / 2, 0, sx * diag, pivot);
    add(new THREE.BoxGeometry(leafW, 0.22, 0.2), trim, -sx * (leafW / 2), doorH - 0.15, 0, 0, pivot);
    add(new THREE.BoxGeometry(leafW, 0.22, 0.2), trim, -sx * (leafW / 2), base + 0.95, 0, 0, pivot);
    void leaf;
    pivot.userData.openAngle = sx * sz * (Math.PI * 0.56);
    doors.push({ pivot, open: 0 });
  }
  return doors;
}

/** Start gate: the envart model fitted to the road, or a chequered banner on two posts. */
function buildGate(t: BuiltTrack, ctx: RenderContext, parent: THREE.Object3D, name: 'start_gate' | 'balloon_arch'): void {
  for (const p of t.props) {
    if (p.name !== name) continue;
    const loc = t.locate(new THREE.Vector3(p.x, p.y + 1, p.z));
    const f = t.sample(loc.progress, 0, loc.path);
    const span = 2 * f.halfWidth + 3;
    const yaw = Math.atan2(f.forward.x, f.forward.z);
    const key = `prop.${name}`;
    const g = new THREE.Group();
    g.position.copy(f.pos);
    g.rotation.y = yaw;
    parent.add(g);
    if (ctx.assets.has(key)) {
      // the kit gate and arch span an 18 m road at scale 1; only scale up for wider roads
      const m = ctx.assets.model(key);
      if (span > 21) m.scale.setScalar(span / 21);
      m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(m);
      continue;
    }
    if (name === 'start_gate') {
      const postM = mat('#2f7d46', 0.5);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 7.4, 10), postM);
        post.position.set(sx * (span / 2), 3.4, 0);
        post.castShadow = true;
        g.add(post);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), mat('#f2c21b', 0.4));
        cap.position.set(sx * (span / 2), 7.3, 0);
        g.add(cap);
      }
      const banner = new THREE.Mesh(new THREE.BoxGeometry(span, 1.3, 0.25), bannerMaterial());
      banner.position.set(0, 6.1, 0);
      banner.castShadow = true;
      g.add(banner);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 0.35, 0.4), mat('#2f7d46', 0.5));
      bar.position.set(0, 6.95, 0);
      g.add(bar);
    } else {
      const n = 26, r = span / 2;
      const cols = ['#e8604c', '#f2c94c', '#56b0e0', '#f2f2f2', '#e86fb0', '#7fd06a'];
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.62, 12, 9), new THREE.MeshStandardMaterial({ roughness: 0.35 }), n * 2);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < n; k++) {
        const a = Math.PI * (k / (n - 1));
        for (const dz of [-0.35, 0.35]) {
          const i = k * 2 + (dz > 0 ? 1 : 0);
          m4.makeTranslation(Math.cos(a) * r, Math.sin(a) * r * 0.85 + 0.2, dz + (k % 2) * 0.1);
          im.setMatrixAt(i, m4);
          im.setColorAt(i, new THREE.Color(cols[(k + (dz > 0 ? 3 : 0)) % cols.length]));
        }
      }
      im.castShadow = true;
      g.add(im);
    }
  }
}

export async function createTrackView(track: TrackRuntime, ctx: RenderContext): Promise<View> {
  if (!(track instanceof BuiltTrack)) return createStubTrackView(track, ctx);
  const t = track;
  registerHazardViews();
  const names = new Set<string>(['sheep', 'hay_bale', 'start_gate', 'balloon_arch', 'fence_wood', 'hedge', 'ramp']);
  for (const p of t.props) names.add(p.name);
  for (const st of t.structures) names.add(st.model);
  for (const d of t.decks) if (d.model) names.add(d.model);
  for (const n of [...names]) if (LOD_PROPS.has(n)) names.add(`${n}.lod1`);
  try { await ctx.assets.load([...names].map((n) => `prop.${n}`)); } catch { /* placeholders */ }
  const T = await loadTextures(TEXTURE_SETS, ctx.quality.maxTextureSize);

  const root = new THREE.Group();
  root.name = 'track';

  // ground: road on top, shoulders pushed back, terrain beneath
  mesh(roadGeometry(t), offset(roadMaterial(T), -1, -1), false, root, 'road');
  mesh(shoulderGeometry(t), offset(terrainMaterial(T), 1, 1), false, root, 'shoulders');
  mesh(terrainGeometry(t, ctx.quality.tier === 'mobile' ? 2 : 1), terrainMaterial(T), false, root, 'terrain');
  const back = backdropGeometry(t);
  mesh(back.geo, terrainMaterial(T), false, root, 'backdrop');
  {
    // distant forest: low-poly round crowns (tinted per instance) on short trunks
    const crownGeo = new THREE.IcosahedronGeometry(3.2, 0);
    crownGeo.scale(1, 1.15, 1);
    crownGeo.translate(0, 5.6, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 4, 1, true);
    trunkGeo.translate(0, 1.5, 0);
    const keepN = Math.max(200, Math.round(back.trees.length * Math.min(1, ctx.quality.density + 0.1)));
    back.trees.length = Math.min(back.trees.length, keepN);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), back.trees.length);
    const trunks = new THREE.InstancedMesh(trunkGeo, mat('#5a4030', 1), back.trees.length);
    const greens = ['#4f8f3a', '#5c9e3c', '#3f7d33', '#6aa84a', '#477f36', '#7fae4a'];
    const c = new THREE.Color();
    back.trees.forEach((m, k) => {
      crowns.setMatrixAt(k, m); trunks.setMatrixAt(k, m);
      crowns.setColorAt(k, c.set(greens[k % greens.length]));
    });
    for (const im of [crowns, trunks]) { im.computeBoundingSphere(); im.name = 'backdropTrees'; root.add(im); }
  }
  let water: THREE.Material = waterMaterial();
  try {
    const rm = await import('../../render/materials');
    if (typeof rm.stylizedWater === 'function') water = rm.stylizedWater({ sceneDepth: ctx.quality.tier !== 'mobile' });
  } catch { /* render team's water not available: keep ours */ }
  mesh(waterGeometry(t), water, false, root, 'water');

  // structures
  const wood = woodMaterial(T), stone = stoneMaterial(T);
  const has = (n: string) => ctx.assets.has(`prop.${n}`);
  const modelled = new Set<string>();
  const F = t.sample(0);
  for (const d of t.decks) {
    if (!d.model || !has(d.model)) continue;
    modelled.add(d.model);
    const p = t.paths[d.path];
    t.frameOn(p, (d.s0 + d.s1) / 2, 0, F);
    const m = ctx.assets.model(`prop.${d.model}`);
    m.position.copy(F.pos);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.right.clone().negate(), F.up, F.forward));
    const deckNode = m.getObjectByName('deck');
    if (deckNode) deckNode.visible = false;
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(m);
  }
  const onModelDeck = (q: THREE.Vector3) => {
    const l = t.locate(q.clone().setY(q.y + 0.5));
    const s0 = t.localS(t.paths[l.path], l.progress);
    return t.decks.some((d) => d.model && modelled.has(d.model) && d.path === l.path && s0 >= d.s0 - 2 && s0 <= d.s1 + 2);
  };
  const fenceRuns = t.barriers.filter((b) => b.kind === 'fence' || b.kind === 'boundary').map((b) => b.pts);
  const hedgeRuns = t.barriers.filter((b) => b.kind === 'hedge').map((b) => b.pts);
  const tiledFence = tileAlong('fence_wood', fenceRuns, ctx, root);
  const tiledHedge = tileAlong('hedge', hedgeRuns, ctx, root);
  const bars = barrierBatches(t, (b) =>
    (tiledFence && (b.kind === 'fence' || b.kind === 'boundary')) || (tiledHedge && b.kind === 'hedge') || (b.kind === 'deckRail' && onModelDeck(b.pts[Math.floor(b.pts.length / 2)])));
  for (const style of ['wood', 'stone'] as const) {
    const d = deckGeometry(t, style, modelled);
    const dm = style === 'wood' ? planksMaterial(T, '#c9a27a') : stoneMaterial(T);
    dm.side = THREE.DoubleSide;
    mesh(d.geo, dm, true, root, `deck.${style}`);
    for (const m of d.piers.mats) (style === 'wood' ? bars.wood : bars.stone).mats.push(m);
  }
  const addBatch = (b: BoxBatch, m: THREE.Material, name: string) => { const o = b.mesh(m, ctx.quality.tier !== 'mobile'); if (o) { o.name = name; root.add(o); } };
  addBatch(bars.wood, wood, 'barriers.wood');
  addBatch(bars.stone, stone, 'barriers.stone');
  addBatch(bars.hedge, hedgeMaterial(), 'barriers.hedge');
  if (has('ramp')) {
    for (const r of t.ramps) {
      t.frameOn(t.paths[r.path], r.s0 + r.length / 2, r.lat, F);
      const m = ctx.assets.model('prop.ramp');
      m.position.copy(F.pos);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.right.clone().negate(), F.up, F.forward));
      m.scale.set(r.width / 10, r.height / 1.6, r.length / 6);
      m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      root.add(m);
    }
  } else mesh(rampGeometry(t), rampMaterial(T), true, root, 'ramps');
  mesh(padGeometry(t), offset(padMaterial(), -2, -2), false, root, 'pads');
  mesh(markingsGeometry(t), offset(flatMaterial('#f4f2ea', 0.6), -2, -2), false, root, 'markings');
  mesh(patchGeometry(t), offset(flatMaterial('#cdb98a', 1), -2, -2), false, root, 'patches');
  const doors: Door[] = [];
  for (const st of t.structures) doors.push(...(buildBarnModel(st, ctx, root) ?? buildBarn(st, T, root)));
  buildGate(t, ctx, root, 'start_gate');
  buildGate(t, ctx, root, 'balloon_arch');
  void hayMaterial;

  // scenery
  const { batches, animated } = buildProps(t.props, ctx, root, ctx.quality.tier === 'mobile' ? { heightAt: (x, z) => t.terrain.heightAt(x, z), reach: t.terrain.cell * 2, far: COARSE_FAR + 4 } : undefined);
  ctx.scene.add(root);

  let version = -1;
  const doorsTag = t.structures[0]?.doorsTag;
  void placeholder;
  return {
    update(dt) {
      if (t.state.version !== version) {
        version = t.state.version;
        for (const b of batches) if (b.tag) { const on = t.state.tags.get(b.tag) ?? true; for (const m of b.meshes) m.visible = on; }
      }
      if (doorsTag) {
        const want = t.state.tags.get(doorsTag) === false ? 1 : 0;
        for (const d of doors) {
          d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt * 0.7);
          const e = d.open * d.open * (3 - 2 * d.open);
          d.pivot.rotation.y = e * d.pivot.userData.openAngle;
        }
      }
      for (const o of animated) {
        const blades = o.getObjectByName('blades');
        if (blades) blades.rotation.z += dt * 0.7;
      }
    },
    dispose() {
      ctx.scene.remove(root);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
    },
  };
}
