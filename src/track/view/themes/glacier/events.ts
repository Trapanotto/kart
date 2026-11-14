// Animated set pieces of Gletscher-Gipfel: falling icicles (entity view), the avalanche snow mass,
// the cable car. They only read sim state (track.script.state, entity data). Owner: track 4.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { registerEntityView } from '../../../../core/entityViews';
import type { RenderContext, SimEntity, View } from '../../../../core/types';
import type { BuiltTrack } from '../../../builder';
import { GLACIER, type GletscherState } from '../../../scripts/gletscher';
import { markerMaterial } from './materials';

let iceMatForViews: THREE.Material | null = null;

function icicleView(e: SimEntity, ctx: RenderContext): View | null {
  const root = new THREE.Group();
  root.position.copy(e.pos);
  root.quaternion.copy(e.quat);
  const strength = uniform(0);
  const marker = new THREE.Mesh(new THREE.CircleGeometry(GLACIER.icicles.radius, 28).rotateX(-Math.PI / 2), markerMaterial(strength));
  marker.position.y = 0.06;
  marker.renderOrder = 2;
  root.add(marker);
  let ice: THREE.Object3D;
  if (ctx.assets.has('prop.glacier_icicle')) {
    ice = ctx.assets.model('prop.glacier_icicle');
    if (iceMatForViews) ice.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = iceMatForViews!; });
  } else {
    ice = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.3, 7).rotateX(Math.PI).translate(0, -1.15, 0), new THREE.MeshStandardMaterial({ color: '#9fdcf5', roughness: 0.15 }));
  }
  ice.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  root.add(ice);
  ctx.scene.add(root);
  const top = GLACIER.icicles.ceiling;
  let t = e.id * 0.37;
  return {
    update(dt) {
      t += dt;
      const d = e.data as { state: string; f: number; active: number };
      const st = d?.state ?? 'idle';
      const act = d?.active ?? 0;
      root.visible = act > 0;
      if (!root.visible) return;
      root.position.copy(e.pos);
      let y = top + 0.4;
      let s = 1;
      if (st === 'warn') {
        // hangs, shakes harder as it is about to drop; the marker grows and pulses
        y = top + 0.4 + Math.sin(t * 40) * 0.03 * d.f;
        ice.rotation.z = Math.sin(t * 33) * 0.06 * d.f;
        strength.value = (0.35 + 0.65 * d.f) * (0.8 + 0.2 * Math.sin(t * 18));
        marker.scale.setScalar(0.4 + 0.6 * d.f);
      } else if (st === 'fall') {
        y = top + 0.4 - (top + 0.2) * d.f * d.f;
        ice.rotation.z = 0;
        strength.value = 1;
        marker.scale.setScalar(1);
      } else if (st === 'shatter') {
        y = 0.2;
        s = Math.max(0.01, 1 - d.f * 2.5);
        strength.value = Math.max(0, 1 - d.f * 2);
      } else {
        strength.value = 0;
        y = top + 0.4;
        ice.rotation.z = 0;
        marker.scale.setScalar(0.3);
      }
      ice.position.y = y;
      ice.scale.set(s, st === 'shatter' ? s * 0.5 : 1, s);
      marker.visible = strength.value > 0.01;
    },
    dispose() { ctx.scene.remove(root); },
  };
}

let registered = false;
export function registerGlacierViews(iceMat: THREE.Material): void {
  iceMatForViews = iceMat;
  if (registered) return;
  registered = true;
  registerEntityView('hazard.icicle', icicleView);
}

/** The avalanche: a cornice on the slope (laps 1-2), the sliding mass (lap 3), powder puffs. */
export function avalancheView(t: BuiltTrack, ctx: RenderContext, root: THREE.Object3D, snowMat: THREE.Material): { update(dt: number): void } {
  const S = () => (t.script as any)?.state as GletscherState | undefined;
  const st0 = S();
  const group = new THREE.Group();
  root.add(group);
  // cornice: a heavy overhanging snow slab up the slope, the thing that comes down
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 3.1 + z * 2.3) * 0.12 + Math.sin(y * 4.7 + x * 1.3) * 0.08;
    pos.setXYZ(i, x * (1 + n), y * (1 + n) * 0.55, z * (1 + n));
  }
  geo.computeVertexNormals();
  const cornice = new THREE.Group();
  const mass = new THREE.Group();
  const lumps: THREE.Mesh[] = [];
  for (let k = 0; k < 7; k++) {
    const m = new THREE.Mesh(geo, snowMat);
    const a = (k / 7) * Math.PI * 2;
    m.position.set(Math.cos(a) * 7 * (k ? 1 : 0), (k % 3) * 0.8, Math.sin(a) * 3 * (k ? 1 : 0));
    m.scale.set(7 - (k ? 2.5 : 0), 5 - (k ? 1.5 : 0), 5 - (k ? 1.5 : 0));
    m.castShadow = true;
    m.receiveShadow = true;
    mass.add(m);
    lumps.push(m);
    const c = m.clone();
    c.scale.multiplyScalar(0.8);
    cornice.add(c);
  }
  group.add(cornice, mass);
  mass.visible = false;
  const src = new THREE.Vector3(), dst = new THREE.Vector3();
  let placed = false;
  const place = (s: GletscherState) => {
    // the script state exists once the race started (createEntities); the view may be older
    src.copy(s.source); dst.copy(s.target);
    cornice.position.copy(src);
    cornice.lookAt(dst.x, src.y, dst.z);
    placed = true;
  };
  if (st0) place(st0);
  let puffT = 0;
  const P = new THREE.Vector3();
  return {
    update(dt) {
      const s = S();
      if (!s) { cornice.visible = mass.visible = false; return; }
      if (!placed) place(s);
      puffT -= dt;
      cornice.visible = s.avalanche <= 1;
      if (s.avalanche === 1) {
        // rumble: the cornice trembles and sheds snow
        cornice.position.copy(src);
        cornice.position.x += (Math.random() - 0.5) * 0.25;
        cornice.position.y += (Math.random() - 0.5) * 0.15;
        if (puffT <= 0) { puffT = 0.25; ctx.vfx.spawn('dust', P.copy(src).add(new THREE.Vector3((Math.random() - 0.5) * 10, -2, (Math.random() - 0.5) * 6)), { color: '#f4f8ff', scale: 1.4 }); }
      }
      mass.visible = s.avalanche === 2;
      if (s.avalanche === 2) {
        const k = s.slide * s.slide;
        P.copy(src).lerp(dst, k);
        // follow the slope, slightly above the ground; spread out as it comes down
        const g = t.terrain.heightAt(P.x, P.z);
        P.y = Math.max(g, dst.y) + 1.5 + (1 - s.slide) * 2;
        mass.position.copy(P);
        mass.lookAt(dst.x, P.y, dst.z);
        const sp = 1.1 + 0.8 * s.slide;
        mass.scale.set(1.8 * sp, 0.9 + 0.6 * s.slide, sp);
        lumps.forEach((m, i) => { m.rotation.x += dt * (2 + i * 0.4); });
        if (puffT <= 0) { puffT = 0.08; ctx.vfx.spawn('dust', P.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, 2, (Math.random() - 0.5) * 8)), { color: '#f6f9ff', scale: 3 }); }
      }
    },
  };
}

/** Cable car: cables between station halls and pylon tops, cabins gliding up and down. */
export function cableCar(t: BuiltTrack, ctx: RenderContext, root: THREE.Object3D): { update(dt: number): void } | null {
  const st = t.props.filter((p) => p.name === 'glacier_station');
  const py = t.props.filter((p) => p.name === 'glacier_pylon');
  if (st.length < 2) return null;
  const hall = (p: (typeof st)[number]) => {
    const back = new THREE.Vector3(0, 0, -6.9 * p.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    return new THREE.Vector3(p.x, p.y + 7.1 * p.scale, p.z).add(back);
  };
  const a = hall(st[0]), b = hall(st[1]);
  const pts = [a, ...py.map((p) => new THREE.Vector3(p.x, p.y + 17.4, p.z)).sort((u, v) => u.distanceTo(a) - v.distanceTo(a)), b];
  const dir = b.clone().sub(a).setY(0).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const lines: THREE.Vector3[][] = [-2.1, 2.1].map((o) => pts.map((q) => q.clone().addScaledVector(side, o)));
  // cables as thin boxes (one merged mesh)
  const cab = new THREE.Group();
  root.add(cab);
  const cableGeo: THREE.BufferGeometry[] = [];
  for (const L of lines) for (let k = 0; k < L.length - 1; k++) {
    const p0 = L[k], p1 = L[k + 1];
    const len = p0.distanceTo(p1);
    const g = new THREE.BoxGeometry(0.06, 0.06, len);
    const m4 = new THREE.Matrix4().lookAt(p1, p0, new THREE.Vector3(0, 1, 0));
    m4.setPosition(p0.clone().add(p1).multiplyScalar(0.5));
    g.applyMatrix4(m4);
    cableGeo.push(g);
  }
  for (const g of cableGeo) cab.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#3a3b40', roughness: 0.6 })));
  // cabins
  const has = ctx.assets.has('prop.glacier_gondola');
  const cabins: { o: THREE.Object3D; line: number; phase: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const o = has ? ctx.assets.model('prop.glacier_gondola') : new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2.3).translate(0, -3.4, 0), new THREE.MeshStandardMaterial({ color: '#d8423a' }));
    o.traverse((q) => { if ((q as THREE.Mesh).isMesh) q.castShadow = ctx.quality.tier !== 'mobile'; });
    cab.add(o);
    cabins.push({ o, line: k % 2, phase: k * 0.5 });
  }
  const lengths = lines.map((L) => { const c = [0]; for (let k = 1; k < L.length; k++) c.push(c[k - 1] + L[k].distanceTo(L[k - 1])); return c; });
  const at = (li: number, f: number, out: THREE.Vector3, d: THREE.Vector3) => {
    const L = lines[li], c = lengths[li], total = c[c.length - 1];
    const x = f * total;
    let k = 1;
    while (k < c.length - 1 && c[k] < x) k++;
    const u = (x - c[k - 1]) / Math.max(1e-6, c[k] - c[k - 1]);
    out.copy(L[k - 1]).lerp(L[k], u);
    out.y -= Math.sin(Math.PI * u) * 1.2; // cable sag between supports
    d.copy(L[k]).sub(L[k - 1]).setY(0).normalize();
  };
  const P = new THREE.Vector3(), D = new THREE.Vector3();
  let time = 0;
  return {
    update(dt) {
      time += dt;
      for (const c of cabins) {
        let f = ((time / 70 + c.phase) % 1);
        if (c.line === 1) f = 1 - f;
        at(c.line, f, P, D);
        c.o.position.copy(P);
        c.o.rotation.y = Math.atan2(D.x, D.z) + (c.line ? Math.PI : 0);
        c.o.rotation.z = Math.sin(time * 1.3 + c.phase * 7) * 0.03;
      }
    },
  };
}
