// Spannende Streckenteile: Weggabelungen, Sprung-Abkürzungen, Loopings, einstürzende Brücken, Wasser
import * as THREE from 'three';
import { SPACING } from './data.js';

const _v = new THREE.Vector3();

export const LOOP_LEN = 18;   // Stützpunkte, die ein Looping entlang der Strecke belegt
export const LOOP_R = 9;      // Radius
export const LOOP_SHIFT = 8;  // seitlicher Versatz zwischen Ein- und Ausfahrt

// Wird im Track-Konstruktor aufgerufen (vor dem Bau der Geometrie)
export function prepareFeatures(tr, def) {
  const N = tr.N;
  // Einstürzende Brücken
  tr.crumble = new Uint8Array(N);
  tr.crumbleRanges = [];
  for (const [a, len] of def.crumble || []) {
    const ia = Math.round(a * N) % N;
    for (let k = 0; k < len; k++) { tr.crumble[(ia + k) % N] = 1; tr.bridge[(ia + k) % N] = 1; }
    tr.crumbleRanges.push({ ia, len });
  }
  tr.crumbleT = 0;
  tr.crumbleGap = (i, lat) => {
    if (!tr.crumble[i]) return false;
    return tileState(tr, i, lat > 0 ? 1 : 0).down;
  };
  // Loopings
  tr.loops = (def.loops || []).map((f) => ({ c: Math.round(f * N) % N }));
  for (const L of tr.loops) {
    const p = tr.P[L.c];
    L.origin = p.clone();
    L.T = tr.T[L.c].clone();
    L.R = tr.R[L.c].clone();
    L.D = LOOP_LEN * SPACING;
    L.tr = tr;
    // Strecke unter dem Looping flach halten
    for (let k = 0; k <= LOOP_LEN; k++) tr.P[(L.c + k) % N].y = p.y + (tr.P[(L.c + LOOP_LEN) % N].y - p.y) * (k / LOOP_LEN);
  }
}

// Zustand einer Planke: oben, wackelnd, abgestürzt
function tileState(tr, i, side) {
  const N = tr.N;
  let rel = 0;
  for (const r of tr.crumbleRanges) { const d = (i - r.ia + N) % N; if (d < r.len) { rel = d; break; } }
  const period = 6;
  const c = (tr.crumbleT + side * period * 0.5 + Math.floor(rel / 2) * 0.12) % period;
  return { c, shake: c > 3.2 && c < 4.4, down: c >= 4.4 && c < 5.6, fall: c >= 4.4 ? c - 4.4 : 0 };
}

// Position im Looping (s = 0..1) – folgt der Strecke; liefert Punkt, Vorwärts- und Oben-Richtung
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function loopPoint(L, s, off, out) {
  const tr = L.tr, N = tr.N;
  const th = s * Math.PI * 2;
  const idx = L.c + s * LOOP_LEN;
  const lat = -LOOP_SHIFT / 2 + LOOP_SHIFT * s + off;
  tr.pointAt(idx, lat, out);
  const T = tr.T[Math.floor(idx) % N];
  out.addScaledVector(T, LOOP_R * Math.sin(th));
  out.y += LOOP_R * (1 - Math.cos(th));
  return out;
}
export function loopFrame(L, s, off, pos, fwd, up) {
  loopPoint(L, s, off, pos);
  if (fwd) {
    loopPoint(L, Math.max(0, s - 0.004), off, _a);
    loopPoint(L, Math.min(1, s + 0.004), off, _b);
    fwd.subVectors(_b, _a).normalize();
    const R = L.tr.R[Math.floor(L.c + s * LOOP_LEN) % L.tr.N];
    up.crossVectors(R, fwd).normalize();
  }
  return pos;
}
export function loopLength(L) {
  let len = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  loopFrame(L, 0, 0, a);
  for (let k = 1; k <= 100; k++) { loopFrame(L, k / 100, 0, b); len += a.distanceTo(b); a.copy(b); }
  return len;
}

export class Features {
  constructor(track, group, th, settings) {
    this.tr = track;
    this.group = group;
    this.th = th;
    this.buildIslands(settings);
    this.buildShortcuts();
    this.buildLoops();
    this.buildCrumble();
    this.buildWater();
  }

  // ------------------------------------------------------------ Insel der Weggabelung
  buildIslands(settings) {
    const tr = this.tr, N = tr.N, th = this.th;
    const prof = [[-1, 0], [-1, 1.1], [-0.6, 1.7], [0.6, 1.7], [1, 1.1], [1, 0]];
    const pos = [], idx = [];
    for (const fk of tr.forks) {
      const base = pos.length / 3;
      for (let k = 0; k <= fk.len; k++) {
        const i = (fk.ia + k) % N, p = tr.P[i], R = tr.R[i], m = tr.island[i];
        for (const [o, h] of prof) {
          const l = o * m;
          pos.push(p.x + R.x * l, p.y + h * Math.min(1, m) + tr.crossOff(i, l), p.z + R.z * l);
        }
        if (k < fk.len) for (let q = 0; q < prof.length - 1; q++) {
          const a = base + k * prof.length + q, b = a + prof.length;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      // Wegweiser am Anfang der Insel
      const i0 = (fk.ia + 16) % N, p0 = tr.P[i0];
      const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.8, 0.25), new THREE.MeshStandardMaterial({ color: '#FFFFFF', emissive: '#FFD447', emissiveIntensity: 0.3 }));
      sign.position.set(p0.x, p0.y + 3, p0.z);
      sign.rotation.y = tr.headingAt(i0);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4), new THREE.MeshStandardMaterial({ color: '#8A8A90' }));
      post.position.set(p0.x, p0.y + 1.2, p0.z);
      this.group.add(sign, post);
      // Deko-Büsche auf der Insel
      for (let k = 18; k < fk.len - 16; k += 9) {
        const i = (fk.ia + k) % N, p = tr.P[i];
        const b = new THREE.Mesh(new THREE.SphereGeometry(Math.min(2, tr.island[i] * 0.8), 14, 10), new THREE.MeshStandardMaterial({ color: th.hills, roughness: 0.9 }));
        b.position.set(p.x, p.y + 2.1, p.z);
        b.scale.y = 0.7;
        b.castShadow = settings.shadows;
        this.group.add(b);
      }
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: th.fence2, roughness: 0.7, side: THREE.DoubleSide }));
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
  }

  // ------------------------------------------------------------ Sprung-Abkürzungen (Kanonen-Schanzen)
  buildShortcuts() {
    const tr = this.tr, N = tr.N;
    tr.shortcuts = [];
    for (const f of tr.def.shortcuts || []) {
      const i0 = Math.round(f * N) % N;
      let best = null;
      const used = tr.shortcuts.map((s) => s.i);
      for (let di = 0; di < N; di += 3) {
        const i = (i0 + di) % N;
        if (tr.gap[i] || tr.crumble[i] || tr.island[i] || tr.launch[i] || tr.bump[i]) continue;
        if (used.some((u) => Math.min(Math.abs(u - i), N - Math.abs(u - i)) < 80)) continue;
        const p = tr.P[i];
        for (let dj = 50; dj < N * 0.3; dj += 2) {
          const j = (i + dj) % N;
          if (tr.gap[j] || tr.crumble[j] || tr.launch[j] || tr.island[j] || tr.bump[j]) continue;
          const q = tr.P[j];
          const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
          if (d < 30 || d > 110 || q.y - p.y > 10 || p.y - q.y > 20) continue;
          const side = Math.sign(dx * tr.R[i].x + dz * tr.R[i].z);
          const fw = (dx * tr.T[i].x + dz * tr.T[i].z) / d;
          if (fw < 0.2) continue;
          const gain = dj * SPACING - d - Math.min(di, N - di) * 0.15;
          if (!best || gain > best.gain) best = { i, j, side, gain, d };
        }
      }
      if (!best || best.gain < 50) continue;
      const lat = best.side * (tr.hw[best.i] - 2.6);
      best.lat = lat;
      tr.shortcuts.push(best);
      // Schanze am Fahrbahnrand
      const p = tr.P[best.i], R = tr.R[best.i];
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.4, 7), new THREE.MeshStandardMaterial({ color: '#FF7A1A', emissive: '#FF4E1A', emissiveIntensity: 0.5 }));
      ramp.position.set(p.x + R.x * lat, p.y + 0.9 + tr.crossOff(best.i, lat), p.z + R.z * lat);
      ramp.rotation.order = 'YXZ';
      const q = tr.P[best.j];
      ramp.rotation.y = Math.atan2(q.x - p.x, q.z - p.z);
      ramp.rotation.x = -0.28;
      ramp.castShadow = true;
      this.group.add(ramp);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 3), new THREE.MeshStandardMaterial({ color: '#FFFFFF', emissive: '#FFD447', emissiveIntensity: 0.6 }));
      arrow.position.copy(ramp.position).add(_v.set(0, 2.6, 0));
      arrow.rotation.set(Math.PI / 2, 0, -ramp.rotation.y);
      this.group.add(arrow);
      // Landeplatz
      const pad = new THREE.Mesh(new THREE.CircleGeometry(4.5, 28), new THREE.MeshStandardMaterial({ color: '#FFD447', emissive: '#FF9A2B', emissiveIntensity: 0.3, transparent: true, opacity: 0.8 }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(q.x, q.y + 0.08, q.z);
      this.group.add(pad);
    }
  }

  // ------------------------------------------------------------ Loopings
  buildLoops() {
    const tr = this.tr;
    const mat = new THREE.MeshStandardMaterial({ color: this.th.road, roughness: 0.7, side: THREE.DoubleSide });
    const railMat = new THREE.MeshStandardMaterial({ color: this.th.curb[1], roughness: 0.4, emissive: this.th.curb[1], emissiveIntensity: 0.25 });
    const pA = new THREE.Vector3(), fA = new THREE.Vector3(), uA = new THREE.Vector3();
    for (const L of tr.loops) {
      L.len = loopLength(L);
      const pos = [], idx = [], rail = [], railIdx = [];
      const S = 120, W = 3.8;
      for (let k = 0; k <= S; k++) {
        loopFrame(L, k / S, 0, pA, fA, uA);
        const Rk = tr.R[Math.floor(L.c + (k / S) * LOOP_LEN) % tr.N];
        for (const s of [-W, W]) pos.push(pA.x + Rk.x * s, pA.y, pA.z + Rk.z * s);
        for (const s of [-W - 0.3, W + 0.3]) {
          rail.push(pA.x + Rk.x * s, pA.y, pA.z + Rk.z * s);
          rail.push(pA.x + Rk.x * s + uA.x * 0.9, pA.y + uA.y * 0.9, pA.z + Rk.z * s + uA.z * 0.9);
        }
        if (k < S) {
          const a = k * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          const r = k * 4;
          for (const o of [0, 2]) railIdx.push(r + o, r + 4 + o, r + o + 1, r + o + 1, r + 4 + o, r + 5 + o);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3));
      rg.setIndex(railIdx);
      rg.computeVertexNormals();
      this.group.add(m, new THREE.Mesh(rg, railMat));
    }
  }

  // ------------------------------------------------------------ Einstürzende Brücken
  buildCrumble() {
    const tr = this.tr, N = tr.N;
    this.tiles = [];
    const mat = new THREE.MeshStandardMaterial({ color: '#B5793F', roughness: 0.8 });
    const mat2 = new THREE.MeshStandardMaterial({ color: '#9A6434', roughness: 0.8 });
    for (const r of tr.crumbleRanges) {
      for (let k = 0; k < r.len; k += 1) {
        const i = (r.ia + k) % N, p = tr.P[i], R = tr.R[i];
        for (const side of [0, 1]) {
          const w = tr.hw[i];
          const lat = side ? w / 2 : -w / 2;
          const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.45, SPACING - 0.15), k % 2 ? mat : mat2);
          m.position.set(p.x + R.x * lat, p.y - 0.2, p.z + R.z * lat);
          m.rotation.y = tr.headingAt(i);
          m.castShadow = m.receiveShadow = true;
          this.group.add(m);
          this.tiles.push({ i, side, m, base: m.position.clone() });
        }
      }
      // Abgrund darunter
      const c = (r.ia + Math.floor(r.len / 2)) % N, p = tr.P[c];
      const voidM = new THREE.Mesh(new THREE.PlaneGeometry(tr.fence[c] * 2 + 10, (r.len + 6) * SPACING), new THREE.MeshStandardMaterial({ color: '#120C1E', roughness: 1 }));
      voidM.rotation.order = 'YXZ';
      voidM.rotation.y = tr.headingAt(c);
      voidM.rotation.x = -Math.PI / 2;
      voidM.position.set(p.x, Math.max(tr.groundY + 0.08, p.y - 4), p.z);
      this.group.add(voidM);
    }
  }

  // ------------------------------------------------------------ Wasser (Unterwasser-Abschnitte)
  buildWater() {
    const tr = this.tr, N = tr.N;
    tr.waterZones = [];
    for (const w of tr.water) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let k = 0; k <= w.len; k++) {
        const p = tr.P[(w.ia + k) % N];
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      minX -= 30; maxX += 30; minZ -= 30; maxZ += 30;
      const depth = w.level - tr.groundY + 1;
      const geo = new THREE.BoxGeometry(maxX - minX, depth, maxZ - minZ);
      const mat = new THREE.MeshPhysicalMaterial({ color: '#1E9BD0', roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, emissive: '#0A4F7A', emissiveIntensity: 0.3 });
      const box = new THREE.Mesh(geo, mat);
      box.position.set((minX + maxX) / 2, w.level - depth / 2, (minZ + maxZ) / 2);
      box.renderOrder = 3;
      this.group.add(box);
      tr.waterZones.push({ minX, maxX, minZ, maxZ, level: w.level, mesh: box });
    }
  }

  update(dt, t) {
    const tr = this.tr;
    tr.crumbleT = t;
    for (const tile of this.tiles) {
      const s = tileState(tr, tile.i, tile.side);
      const m = tile.m;
      m.position.copy(tile.base);
      m.rotation.z = 0;
      if (s.shake) { m.position.y += Math.sin(t * 50 + tile.i) * 0.08; m.rotation.z = Math.sin(t * 40 + tile.i) * 0.05; }
      if (s.down) { m.position.y -= s.fall * s.fall * 14; m.rotation.z = s.fall * 0.8; m.visible = s.fall < 1.3; }
      else m.visible = true;
    }
    for (const z of tr.waterZones) z.mesh.material.opacity = 0.52 + Math.sin(t * 1.5) * 0.04;
  }
}

// Ist ein Punkt unter Wasser?
export function underwater(tr, p) {
  for (const z of tr.waterZones || []) if (p.x > z.minX && p.x < z.maxX && p.z > z.minZ && p.z < z.maxZ && p.y < z.level) return z;
  return null;
}
