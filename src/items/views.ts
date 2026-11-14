// Render side of items: item boxes, thrown items, hazards and per-kart attachments.
// Owner: gameplay. WebGPU-compatible three.js only ('three/webgpu'); views only read sim state.
// Uses ctx.assets.model('item.<id>') when the GLB exists, tidy primitives otherwise.
import * as THREE from 'three/webgpu';
import { registerEntityView } from '../core/entityViews';
import { SIM_DT } from '../core/types';
import type { Kart, RenderContext, SimEntity, View } from '../core/types';
import { ITEM } from './params';

// ---------------------------------------------------------------------------
// Shared resources (created lazily, never disposed: they are tiny and reused every race)

const geo = {
  sphere: () => cached('sphere', () => new THREE.SphereGeometry(1, 20, 14)),
  sphereLo: () => cached('sphereLo', () => new THREE.SphereGeometry(1, 10, 8)),
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  rbox: () => cached('rbox', () => roundedBox(1, 0.14)),
  cyl: () => cached('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 18)),
  cone: () => cached('cone', () => new THREE.ConeGeometry(1, 1, 16)),
  torus: () => cached('torus', () => new THREE.TorusGeometry(1, 0.08, 8, 40)),
  ring: () => cached('ring', () => new THREE.RingGeometry(0.86, 1, 64)),
  disc: () => cached('disc', () => blobDisc()),
};
const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
const std = (color: string, rough = 0.6, metal = 0, emissive?: string, ei = 0) =>
  mat(`std:${color}:${rough}:${metal}:${emissive}:${ei}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: emissive ?? '#000000', emissiveIntensity: ei }));

/** A box with bevelled edges (cheap: scaled sphere-projected cube). */
function roundedBox(size: number, r: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size, 6, 6, 6);
  const p = g.attributes.position as THREE.BufferAttribute;
  const h = size / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-h, Math.min(h, v.x)), Math.max(-h, Math.min(h, v.y)), Math.max(-h, Math.min(h, v.z)));
    v.sub(c).normalize().multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Irregular splat disc for the honey puddle, lying in XZ. */
function blobDisc(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.12 * Math.sin(a * 5) + 0.07 * Math.sin(a * 3 + 1.3);
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, sx = 1, sy = sx, sz = sx): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}

/** The GLB if the actors team delivered it, else the primitive fallback. */
function model(ctx: RenderContext, name: string, fallback: () => THREE.Object3D): THREE.Object3D {
  if (ctx.assets.has(name)) {
    const m = ctx.assets.model(name);
    // Phones: items (36 item boxes alone) stay out of the shadow map.
    const cast = ctx.quality.tier !== 'mobile';
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = cast; });
    return m;
  }
  return fallback();
}

// ---------------------------------------------------------------------------
// Fallback models (sizes in metres, origin at the bottom centre unless noted)

function acornModel(): THREE.Object3D {
  const g = new THREE.Group();
  const nut = mesh(geo.sphere(), std('#b9783a', 0.45), 0.36, 0.42, 0.36);
  const cap = mesh(geo.sphere(), std('#6b4423', 0.9), 0.4, 0.22, 0.4);
  cap.position.y = 0.22;
  const stem = mesh(geo.cyl(), std('#4a2f18', 0.9), 0.05, 0.16, 0.05);
  stem.position.y = 0.45;
  g.add(nut, cap, stem);
  return g;
}

function honeyJarModel(): THREE.Object3D {
  const g = new THREE.Group();
  const jar = mesh(geo.cyl(), std('#f2a516', 0.15, 0, '#a85a00', 0.25), 0.32, 0.5, 0.32);
  jar.position.y = 0.25;
  const lid = mesh(geo.cyl(), std('#d8433b', 0.5), 0.34, 0.12, 0.34);
  lid.position.y = 0.55;
  const cloth = mesh(geo.cone(), std('#f6e2b3', 0.8), 0.38, 0.14, 0.38);
  cloth.position.y = 0.62;
  g.add(jar, lid, cloth);
  return g;
}

function itemBoxModel(): THREE.Object3D {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(geo.rbox(), mat('boxShell', () => new THREE.MeshPhysicalMaterial({
    color: '#9fdcff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.45, iridescence: 1, iridescenceIOR: 1.6,
    clearcoat: 1, depthWrite: false,
  })));
  shell.scale.setScalar(1.25);
  const q = questionMark(std('#ffd447', 0.35, 0, '#ff9a00', 0.6));
  q.scale.setScalar(0.55);
  g.add(shell, q);
  g.userData.inner = q;
  return g;
}

function questionMark(m: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const arc = new THREE.Mesh(cached('qarc', () => new THREE.TorusGeometry(0.32, 0.11, 8, 20, Math.PI * 1.35)), m);
  arc.rotation.z = -Math.PI * 0.35;
  arc.position.y = 0.3;
  const stem = mesh(geo.cyl(), m, 0.11, 0.3, 0.11);
  stem.position.y = -0.1;
  const dot = mesh(geo.sphere(), m, 0.13);
  dot.position.y = -0.48;
  g.add(arc, stem, dot);
  return g;
}

function giftModel(): THREE.Object3D {
  const g = new THREE.Group();
  // Looks like an item box at a glance, but solid, red and with a bow: readable on a second look.
  const body = mesh(geo.rbox(), std('#e8475f', 0.45), 1.05);
  body.position.y = 0.52;
  const ribbon1 = mesh(geo.box(), std('#ffd447', 0.4), 1.08, 1.08, 0.2);
  ribbon1.position.y = 0.52;
  const ribbon2 = mesh(geo.box(), std('#ffd447', 0.4), 0.2, 1.08, 1.08);
  ribbon2.position.y = 0.52;
  const bowL = mesh(geo.torus(), std('#ffd447', 0.4), 0.22, 0.22, 0.6);
  bowL.position.set(0.18, 1.12, 0); bowL.rotation.set(0, Math.PI / 2, 0.5);
  const bowR = bowL.clone(); bowR.position.x = -0.18; bowR.rotation.z = -0.5;
  const q = questionMark(std('#ffffff', 0.4));
  q.scale.setScalar(0.32); q.rotation.z = Math.PI; q.position.set(0, 0.52, 0.54);
  g.add(body, ribbon1, ribbon2, bowL, bowR, q);
  return g;
}

function yarnModel(): THREE.Object3D {
  const g = new THREE.Group();
  const ball = mesh(geo.sphere(), std('#ff6fa5', 0.9), 0.62);
  g.add(ball);
  for (let i = 0; i < 4; i++) {
    const t = mesh(geo.torus(), std('#e0457f', 0.9), 0.63, 0.63, 0.63);
    t.rotation.set(i * 0.8, i * 1.3, i * 0.4);
    g.add(t);
  }
  return g;
}

function beeModel(): THREE.Object3D {
  const g = new THREE.Group();
  const body = mesh(geo.sphereLo(), std('#ffcf1f', 0.5), 0.13, 0.12, 0.18);
  const stripe = mesh(geo.sphereLo(), std('#2a2118', 0.6), 0.135, 0.125, 0.06);
  const wing = mesh(geo.sphereLo(), mat('wing', () => new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, roughness: 0.2 })), 0.12, 0.02, 0.07);
  wing.position.set(0, 0.12, 0);
  g.add(body, stripe, wing);
  return g;
}

function cloudModel(): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#7a8096', roughness: 0.95, emissive: '#fff36b', emissiveIntensity: 0 });
  const parts: [number, number, number, number][] = [[0, 0, 0, 1.1], [0.9, -0.15, 0.2, 0.8], [-0.9, -0.1, -0.1, 0.85], [0.3, 0.45, -0.2, 0.8], [-0.35, 0.35, 0.35, 0.7]];
  for (const [x, y, z, r] of parts) { const s = mesh(geo.sphere(), m, r); s.position.set(x, y, z); g.add(s); }
  g.userData.mat = m;
  return g;
}

function carrotModel(gold: boolean): THREE.Object3D {
  const g = new THREE.Group();
  const root = mesh(geo.cone(), gold ? std('#ffd447', 0.25, 0.8, '#ffb000', 0.6) : std('#ff8a2b', 0.5), 0.16, 0.6, 0.16);
  root.rotation.x = Math.PI;
  const leaf = mesh(geo.cone(), std('#4caf50', 0.7), 0.1, 0.3, 0.1);
  leaf.position.y = 0.42;
  g.add(root, leaf);
  return g;
}

function bubbleMesh(): THREE.Mesh {
  return new THREE.Mesh(geo.sphere(), mat('bubble', () => new THREE.MeshPhysicalMaterial({
    color: '#dff6ff', roughness: 0.05, transparent: true, opacity: 0.22, iridescence: 1, iridescenceIOR: 1.3, depthWrite: false, side: THREE.DoubleSide,
  })));
}

const itemIcon: Record<string, (ctx: RenderContext) => THREE.Object3D> = {
  acorn: (ctx) => model(ctx, 'item.acorn', acornModel),
  honey: (ctx) => model(ctx, 'item.honey', honeyJarModel),
  giftbox: (ctx) => { const o = model(ctx, 'item.giftbox', giftModel); o.scale.setScalar(0.7); return o; },
};

// ---------------------------------------------------------------------------
// Interpolation: sim entities move in fixed steps; views blend between the last two.

class Interp {
  private prev = new THREE.Vector3();
  private cur = new THREE.Vector3();
  private simTime = -1;
  private since = 0;
  readonly out = new THREE.Vector3();
  constructor(start: THREE.Vector3) { this.prev.copy(start); this.cur.copy(start); this.out.copy(start); }
  update(pos: THREE.Vector3, ctx: RenderContext, dt: number): THREE.Vector3 {
    const t = ctx.sim?.time ?? 0;
    if (t !== this.simTime) {
      this.prev.copy(this.cur);
      this.cur.copy(pos);
      if (this.simTime < 0 || this.prev.distanceToSquared(this.cur) > 25) this.prev.copy(this.cur);
      this.simTime = t;
      this.since = 0;
    } else this.since += dt;
    return this.out.lerpVectors(this.prev, this.cur, Math.min(1, this.since / SIM_DT));
  }
}

abstract class EntityView implements View {
  readonly root = new THREE.Group();
  protected interp: Interp;
  constructor(readonly e: SimEntity, readonly ctx: RenderContext) {
    this.interp = new Interp(e.pos);
    this.root.position.copy(e.pos);
    ctx.scene.add(this.root);
  }
  abstract update(dt: number, ctx: RenderContext): void;
  dispose(): void { this.ctx.scene.remove(this.root); }
  protected follow(dt: number, ctx: RenderContext): void {
    this.root.position.copy(this.interp.update(this.e.pos, ctx, dt));
  }
}

const easeOutBack = (t: number) => { const c = 1.7; const x = t - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

// ---------------------------------------------------------------------------

class BoxView extends EntityView {
  private body: THREE.Object3D;
  private shown = 1;
  private wasActive = true;
  private respawnT = 1;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.body = model(ctx, 'item.itembox', itemBoxModel);
    this.root.add(this.body);
    this.root.position.copy(e.pos);
    this.body.rotation.set(0.4, (e.data?.spot as number) * 1.3, 0.3);
  }
  update(dt: number, ctx: RenderContext): void {
    const d = this.e.data!;
    const active = !!d.active;
    if (active && !this.wasActive) this.respawnT = 0;
    this.wasActive = active;
    const phase = ((d.spot as number) ?? 0) * 0.7;
    this.body.rotation.y += dt * 1.4;
    this.body.rotation.x = 0.35 + Math.sin(ctx.time * 1.3 + phase) * 0.12;
    this.root.position.set(this.e.pos.x, this.e.pos.y + Math.sin(ctx.time * 2.2 + phase) * 0.12, this.e.pos.z);
    const inner = this.body.userData.inner as THREE.Object3D | undefined;
    if (inner) inner.rotation.y = -this.body.rotation.y * 2;
    if (!active) {
      // Pickup pop: a quick swell, then gone.
      this.shown = Math.max(0, this.shown - dt * 6);
      const s = this.shown > 0 ? 1 + (1 - this.shown) * 0.6 : 0;
      this.body.scale.setScalar(s * this.shown);
      this.body.visible = this.shown > 0;
    } else {
      // Respawn: fade / grow back in with a little overshoot.
      this.respawnT = Math.min(1, this.respawnT + dt * 2.5);
      this.shown = 1;
      this.body.visible = true;
      this.body.scale.setScalar(Math.max(0.01, easeOutBack(this.respawnT)));
    }
  }
}

class AcornView extends EntityView {
  private body: THREE.Object3D;
  private spinner = new THREE.Group();
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.body = model(ctx, 'item.acorn', acornModel);
    this.body.position.y = -0.42;
    this.spinner.add(this.body);
    this.root.add(this.spinner);
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    this.root.quaternion.copy(this.e.quat);
    this.spinner.rotation.x = (this.e.data?.spin as number) ?? 0;
    // Squash for a moment after a wall bounce.
    const since = (ctx.sim?.time ?? 0) - ((this.e.data?.bounce as number) || -9);
    const k = Math.max(0, 1 - since / 0.15);
    this.root.scale.set(1 + k * 0.35, 1 - k * 0.3, 1 + k * 0.35);
  }
}

class HoneyView extends EntityView {
  private jar: THREE.Object3D;
  private puddle: THREE.Mesh;
  private gloss: THREE.Mesh;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.jar = model(ctx, 'item.honey', honeyJarModel);
    this.puddle = new THREE.Mesh(geo.disc(), mat('honeyPuddle', () => new THREE.MeshStandardMaterial({
      color: '#f0a020', roughness: 0.08, metalness: 0, emissive: '#7a3d00', emissiveIntensity: 0.25, transparent: true, opacity: 0.92,
      polygonOffset: true, polygonOffsetFactor: -2,
    })));
    this.puddle.receiveShadow = true;
    this.gloss = new THREE.Mesh(geo.disc(), mat('honeyGloss', () => new THREE.MeshStandardMaterial({ color: '#ffe08a', roughness: 0.02, transparent: true, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -3 })));
    this.gloss.scale.setScalar(0.45);
    this.gloss.position.set(0.3, 0.01, -0.2);
    this.puddle.add(this.gloss);
    this.puddle.visible = false;
    this.root.add(this.jar, this.puddle);
  }
  update(dt: number, ctx: RenderContext): void {
    const d = this.e.data!;
    this.follow(dt, ctx);
    if (d.state === 'jar') {
      this.jar.visible = true;
      this.jar.rotation.x += dt * 9;
      this.jar.position.y = -0.3;
      return;
    }
    this.jar.visible = false;
    this.puddle.visible = true;
    this.root.quaternion.copy(this.e.quat);
    const since = (ctx.sim?.time ?? 0) - (d.landedAt as number);
    const grow = Math.min(1, since / 0.25);
    const R = ITEM.honey.puddleRadius * (0.3 + 0.7 * easeOutBack(grow)) * (d.fade as number);
    this.puddle.scale.set(R, 1, R * 0.92);
    this.puddle.position.y = -0.28;
    this.gloss.rotation.y = Math.sin(ctx.time * 0.8) * 0.2;
  }
}

class GiftView extends EntityView {
  private body: THREE.Object3D;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.body = model(ctx, 'item.giftbox', giftModel);
    this.body.position.y = -0.6;
    this.root.add(this.body);
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    // Telltale wobble: real item boxes float and spin smoothly, the fake one jiggles on the ground.
    const t = ctx.time * 3 + this.e.id;
    this.body.rotation.set(Math.sin(t * 2.3) * 0.06, Math.sin(t) * 0.25, Math.cos(t * 1.7) * 0.06);
    const s = 1 + Math.sin(t * 4) * 0.04;
    this.body.scale.set(s, 2 - s, s);
  }
}

class YarnView extends EntityView {
  private ball: THREE.Object3D;
  private spinner = new THREE.Group();
  private trail: THREE.Line;
  private pts: THREE.Vector3[] = [];
  private trailGeo = new THREE.BufferGeometry();
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.ball = model(ctx, 'item.yarn', yarnModel);
    this.spinner.add(this.ball);
    this.root.add(this.spinner);
    const n = ctx.quality.tier === 'mobile' ? 16 : 32;
    for (let i = 0; i < n; i++) this.pts.push(e.pos.clone());
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.trail = new THREE.Line(this.trailGeo, mat('thread', () => new THREE.LineBasicMaterial({ color: '#ff6fa5' })));
    this.trail.frustumCulled = false;
    ctx.scene.add(this.trail);
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    this.root.quaternion.copy(this.e.quat);
    this.spinner.rotation.x = (this.e.data?.spin as number) ?? 0;
    // Unspooling thread lying on the road behind the ball.
    const p = this.root.position;
    if (this.pts[0].distanceToSquared(p) > 0.36) { const last = this.pts.pop()!; last.copy(p); this.pts.unshift(last); }
    const a = this.trailGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.pts.length; i++) a.setXYZ(i, this.pts[i].x, this.pts[i].y - 0.5 + Math.sin(i * 1.7) * 0.03, this.pts[i].z);
    a.needsUpdate = true;
  }
  override dispose(): void {
    super.dispose();
    this.ctx.scene.remove(this.trail);
    this.trailGeo.dispose();
  }
}

class BeesView extends EntityView {
  private bees: THREE.Object3D[] = [];
  private seeds: number[] = [];
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    const n = ctx.quality.tier === 'mobile' ? 6 : 10;
    for (let i = 0; i < n; i++) {
      const b = model(ctx, 'item.bee', beeModel);
      if (ctx.assets.has('item.bee')) b.scale.setScalar(1);
      this.bees.push(b);
      this.seeds.push(i * 2.39996);
      this.root.add(b);
    }
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    const harass = this.e.data?.state === 'harass';
    const spread = harass ? 1.3 : 0.9;
    const t = ctx.time;
    for (let i = 0; i < this.bees.length; i++) {
      const s = this.seeds[i];
      const b = this.bees[i];
      const x = Math.sin(t * (5 + (i % 3)) + s) * spread, y = Math.sin(t * 7.3 + s * 1.7) * 0.4, z = Math.cos(t * (4.4 + (i % 2)) + s) * spread;
      b.position.set(x, y, z);
      b.rotation.y = t * 6 + s;
      b.scale.setScalar(harass ? 1.3 : 1);
    }
  }
}

class CloudView extends EntityView {
  private cloud: THREE.Object3D;
  private bolt: THREE.Mesh;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.cloud = model(ctx, 'item.cloud', cloudModel);
    this.cloud.scale.setScalar(0.6);
    this.bolt = mesh(geo.cone(), std('#fff36b', 0.3, 0, '#fff36b', 2), 0.25, 1.2, 0.25);
    this.bolt.rotation.x = Math.PI;
    this.bolt.position.y = -0.9;
    this.root.add(this.cloud, this.bolt);
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    const left = Math.max(0, (this.e.data?.left as number) ?? 1);
    // Flashes speed up as the zap approaches: the telegraph.
    const rate = 2 + (1 - left) * 14;
    const flash = Math.max(0, Math.sin(ctx.time * rate)) ** 6;
    const m = this.cloud.userData.mat as THREE.MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = flash * 1.5;
    this.bolt.visible = flash > 0.6 && left < 0.5;
    this.cloud.rotation.y += dt * 0.5;
    const s = 0.6 * (1 + Math.sin(ctx.time * 3) * 0.04);
    this.cloud.scale.set(s, 0.36 / s, s);
  }
  override dispose(): void {
    super.dispose();
    (this.cloud.userData.mat as THREE.Material | undefined)?.dispose();
  }
}

class YawnView extends EntityView {
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#b9a7ff', transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    this.ring = new THREE.Mesh(geo.ring(), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.3;
    this.root.add(this.ring);
  }
  update(dt: number, ctx: RenderContext): void {
    this.follow(dt, ctx);
    const r = Math.max(0.5, (this.e.data?.ring as number) ?? 0);
    const max = (this.e.data?.max as number) ?? ITEM.yawn.radius;
    this.ring.scale.setScalar(r);
    this.ringMat.opacity = 0.65 * (1 - r / max) + 0.05;
  }
  override dispose(): void { super.dispose(); this.ringMat.dispose(); }
}

/** Per-kart attachments: held item, orbiting acorns, bubble shield, golden carrot, lolly aura, drowsy Zzz. */
class KartAttachView extends EntityView {
  private kart: Kart | null = null;
  private held: THREE.Object3D | null = null;
  private heldId: string | null = null;
  private orbit: THREE.Object3D[] = [];
  private bubble = bubbleMesh();
  private gold: THREE.Object3D;
  private aura: THREE.Mesh;
  private auraMat: THREE.MeshStandardMaterial;
  private zzz: THREE.Object3D[] = [];
  private bubbleScale = 0;
  constructor(e: SimEntity, ctx: RenderContext) {
    super(e, ctx);
    for (let i = 0; i < 3; i++) {
      const a = model(ctx, 'item.acorn', acornModel);
      a.visible = false;
      this.orbit.push(a);
      this.root.add(a);
    }
    this.bubble.visible = false;
    this.bubble.position.y = 0.7;
    this.gold = model(ctx, 'item.goldcarrot', () => carrotModel(true));
    this.gold.visible = false;
    this.auraMat = new THREE.MeshStandardMaterial({ color: '#ff7ad9', emissive: '#ff7ad9', emissiveIntensity: 1.2, transparent: true, opacity: 0.35, depthWrite: false });
    this.aura = new THREE.Mesh(geo.torus(), this.auraMat);
    this.aura.rotation.x = Math.PI / 2;
    this.aura.visible = false;
    for (let i = 0; i < 3; i++) {
      const z = mesh(geo.sphereLo(), std('#d9d2ff', 0.6, 0, '#b9a7ff', 0.5), 0.12 + i * 0.04);
      z.visible = false;
      this.zzz.push(z);
      this.root.add(z);
    }
    this.root.add(this.bubble, this.gold, this.aura);
  }

  update(dt: number, ctx: RenderContext): void {
    const sim = ctx.sim;
    if (!sim) return;
    this.kart ??= sim.karts.find((k) => k.id === this.e.data?.kart) ?? null;
    const k = this.kart;
    if (!k) return;
    this.root.position.copy(k.renderPos);
    this.root.quaternion.copy(k.renderQuat);
    const d = this.e.data!;
    const t = ctx.time;

    // Held item behind the kart (dangling while the button is held).
    const heldId = d.holding ? (d.item as string) : null;
    if (heldId !== this.heldId) {
      if (this.held) this.root.remove(this.held);
      this.held = heldId && itemIcon[heldId] ? itemIcon[heldId](ctx) : null;
      if (this.held) this.root.add(this.held);
      this.heldId = heldId;
    }
    if (this.held) {
      this.held.position.set(Math.sin(t * 5) * 0.08, 0.15 + Math.abs(Math.sin(t * 9)) * 0.06, -ITEM.holdDistance);
      this.held.rotation.y = Math.sin(t * 3) * 0.3;
    }

    // Orbiting acorns.
    const n = d.item === 'acorn3' ? (d.count as number) : 0;
    for (let i = 0; i < 3; i++) {
      const a = this.orbit[i];
      a.visible = i < n;
      if (!a.visible) continue;
      const ang = t * ITEM.acorn3.orbitSpeed + (i * Math.PI * 2) / 3;
      a.position.set(Math.sin(ang) * ITEM.acorn3.orbitRadius, 0.25 + Math.sin(t * 6 + i) * 0.05, Math.cos(ang) * ITEM.acorn3.orbitRadius);
      a.rotation.y = ang + Math.PI / 2;
    }

    // Bubble shield: pops in, wobbles, blinks in its last two seconds.
    const want = d.shield ? 1 : 0;
    this.bubbleScale += (want - this.bubbleScale) * Math.min(1, dt * (want ? 10 : 25));
    this.bubble.visible = this.bubbleScale > 0.02;
    if (this.bubble.visible) {
      const w = Math.sin(t * 7) * 0.04;
      const s = 1.75 * this.bubbleScale;
      this.bubble.scale.set(s * (1 + w), s * (1 - w), s * (1 + w * 0.5));
      const left = (d.bubble as number) ?? 99;
      this.bubble.visible = !(left < 2 && Math.sin(t * 20) < -0.3);
    }

    // Golden carrot window: a spinning carrot above the kart.
    this.gold.visible = (d.gold as number) > 0;
    if (this.gold.visible) { this.gold.position.set(0, 1.9 + Math.sin(t * 4) * 0.1, 0); this.gold.rotation.y = t * 5; }

    // Lollipop: rainbow ring sweeping up and down the kart.
    this.aura.visible = !!d.lolly;
    if (this.aura.visible) {
      const hue = (t * 0.8) % 1;
      this.auraMat.color.setHSL(hue, 0.9, 0.6);
      this.auraMat.emissive.setHSL(hue, 0.9, 0.5);
      this.aura.scale.setScalar(1.5 + Math.sin(t * 6) * 0.1);
      this.aura.position.y = 0.6 + Math.sin(t * 4) * 0.5;
    }

    // Drowsy: floating Zzz bubbles.
    for (let i = 0; i < this.zzz.length; i++) {
      const z = this.zzz[i];
      z.visible = !!d.drowsy;
      if (!z.visible) continue;
      const ph = (t * 0.7 + i / 3) % 1;
      z.position.set(0.3 + ph * 0.5, 1.6 + ph * 1.2, -0.2);
      z.scale.setScalar((0.12 + i * 0.04) * (1 - ph * 0.5));
    }
  }
}

// ---------------------------------------------------------------------------

export function createItemView(e: SimEntity, ctx: RenderContext): View | null {
  switch (e.kind) {
    case 'item.box': return new BoxView(e, ctx);
    case 'item.kart': return new KartAttachView(e, ctx);
    case 'item.acorn': return new AcornView(e, ctx);
    case 'item.honey': return new HoneyView(e, ctx);
    case 'item.giftbox': return new GiftView(e, ctx);
    case 'item.yarn': return new YarnView(e, ctx);
    case 'item.bees': return new BeesView(e, ctx);
    case 'item.cloud': return new CloudView(e, ctx);
    case 'item.yawn': return new YawnView(e, ctx);
    default: return null;
  }
}

let registered = false;
/** Registers the item views with the entity view registry (idempotent). */
export function registerItemViews(): void {
  if (registered) return;
  registered = true;
  registerEntityView('item.', createItemView);
}

/** Asset names the item views use, for preloading. */
export const ITEM_ASSETS = ['item.itembox', 'item.acorn', 'item.honey', 'item.giftbox', 'item.yarn', 'item.bee', 'item.bubble', 'item.carrot', 'item.goldcarrot', 'item.lolly', 'item.cloud'];
