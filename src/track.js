// Strecke: Geometrie, Abfragen (wo ist ein Kart?), Landschaft
import * as THREE from 'three';
import { sampleCenterline, ROAD_HALF, OFFROAD, SPACING } from './data.js';
import { instanceProps, propClone, landmarkClone } from './assets.js';
import { prepareFeatures, Features } from './features.js';

export const FENCE = ROAD_HALF + OFFROAD;
const RAMP_LEN = 6;      // Stützpunkte (x SPACING = 12 Einheiten)
const RAMP_H = 1.7;
const GAP_LEN = 7;       // Stützpunkte ohne Fahrbahn (x SPACING = 14 Einheiten)

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx, w, h, colA, colB, n, rmax) {
  ctx.fillStyle = colA;
  ctx.fillRect(0, 0, w, h);
  const r = rng(7);
  ctx.fillStyle = colB;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.25 + r() * 0.5;
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, 1 + r() * rmax, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export class Track {
  constructor(def, theme) {
    this.def = def;
    this.theme = theme;
    const { points, length } = sampleCenterline(def.shape);
    this.length = length;
    const N = (this.N = points.length);
    this.P = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // Unterwasser-Senken: Strecke taucht in einen See
    this.water = [];
    for (const [a, b, depth] of def.underwater || []) {
      const ia = Math.round(a * N), len = (Math.round(b * N) - ia + N) % N;
      const edgeY = Math.min(this.P[ia % N].y, this.P[(ia + len) % N].y);
      for (let k = 0; k <= len; k++) {
        const e = Math.sin((k / len) * Math.PI) ** 2;
        this.P[(ia + k) % N].y -= depth * Math.min(1, e * 1.6);
      }
      this.water.push({ ia, len, level: edgeY - 0.6 });
    }
    this.T = [];
    this.R = [];
    for (let i = 0; i < N; i++) {
      const a = this.P[(i - 1 + N) % N], b = this.P[(i + 1) % N];
      const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      this.T.push(t);
      this.R.push(new THREE.Vector3(-t.z, 0, t.x));
    }
    this.slope = this.P.map((p, i) => {
      const n = this.P[(i + 1) % N];
      return (n.y - p.y) / SPACING;
    });
    this.grip = new Float32Array(N).fill(1);
    for (const [a, b] of def.ice || []) for (let i = Math.floor(a * N); i < b * N; i++) this.grip[i % N] = 0.32;
    // Fahrbahnbreite je Stützpunkt (Engstellen weich ein- und ausblenden)
    this.hw = new Float32Array(N).fill(ROAD_HALF);
    for (const [a, b, w] of def.narrow || []) {
      const ia = Math.round(a * N), len = (Math.round(b * N) - ia + N) % N;
      for (let k = 0; k <= len; k++) {
        const e = Math.min(1, k / 12, (len - k) / 12);
        const i = (ia + k) % N;
        this.hw[i] = Math.min(this.hw[i], ROAD_HALF + (w - ROAD_HALF) * e);
      }
    }
    this.fence = this.hw.map((h) => h + OFFROAD);
    // Sprünge: normale Rampen, Lücken, grosse Schanzen, Gleiter-Schanzen
    this.jumps = [];
    for (const f of def.ramps || []) this.jumps.push({ f, len: 0, h: RAMP_H, kind: 1 });
    for (const f of def.gaps || []) this.jumps.push({ f, len: GAP_LEN, h: RAMP_H, kind: 1 });
    for (const f of def.bigjumps || []) this.jumps.push({ f, len: 15, h: 3.2, kind: 2 });
    for (const [f, len] of def.glides || []) this.jumps.push({ f, len, h: 2.6, kind: 3 });
    this.gap = new Uint8Array(N);
    this.bump = new Float32Array(N);
    this.launch = new Uint8Array(N);
    for (const j of this.jumps) {
      const c = (j.c = Math.round(j.f * N) % N);
      const rl = j.kind === 1 ? RAMP_LEN : 9;
      for (let k = 0; k < rl; k++) this.bump[(c - rl + 1 + k + N) % N] = j.h * ((k + 1) / rl);
      this.launch[c] = j.kind;
      this.launch[(c + 1) % N] = j.kind;
      for (let k = 2; k <= j.len + 1; k++) this.gap[(c + k) % N] = 1;
    }
    // Steilkurven: Neigung aus der Kurvenkrümmung (Aussenseite höher)
    this.bank = new Float32Array(N);
    const bankAll = def.banking || 0;
    for (let i = 0; i < N; i++) {
      const a = this.T[(i - 6 + N) % N], b = this.T[(i + 6) % N];
      const curve = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
      this.bank[i] = Math.max(-0.42, Math.min(0.42, curve * 1.1)) * bankAll;
    }
    for (let pass = 0; pass < 3; pass++) {
      const s = Float32Array.from(this.bank);
      for (let i = 0; i < N; i++) this.bank[i] = (s[(i - 2 + N) % N] + s[(i - 1 + N) % N] + s[i] + s[(i + 1) % N] + s[(i + 2) % N]) / 5;
    }
    // Halfpipes: Wände steigen zu beiden Seiten an
    this.hp = new Float32Array(N);
    for (const [a, b, H] of def.halfpipes || []) {
      const ia = Math.round(a * N), len = (Math.round(b * N) - ia + N) % N;
      for (let k = 0; k <= len; k++) this.hp[(ia + k) % N] = H * Math.min(1, k / 10, (len - k) / 10);
    }
    // Weggabelungen: Insel in der Mitte, Fahrbahn wird breiter
    this.island = new Float32Array(N);
    this.forks = [];
    for (const fk of def.forks || []) {
      const ia = Math.round(fk.a * N), len = (Math.round(fk.b * N) - ia + N) % N;
      for (let k = 0; k <= len; k++) {
        const e = Math.min(1, k / 14, (len - k) / 14);
        const i = (ia + k) % N;
        this.island[i] = fk.m * e;
        this.hw[i] += (fk.m + 1) * Math.min(1, e * 1.5);
        this.fence[i] = this.hw[i] + OFFROAD;
      }
      this.forks.push({ ...fk, ia, len });
    }
    let minY = Infinity;
    for (const p of this.P) minY = Math.min(minY, p.y);
    this.groundY = def.shape.type === 'lemniscate' ? -30 : minY - 0.6;
    // Raster für schnelle Nachbarsuche
    this.cell = 24;
    this.grid = new Map();
    this.P.forEach((p, i) => {
      const k = this.key(p.x, p.z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    // Brücken: wo die Strecke über einen anderen Streckenteil führt
    this.bridge = new Uint8Array(N);
    if (def.shape.type === 'lemniscate') this.bridge.fill(1);
    else {
      const raw = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        const p = this.P[i];
        const reach = this.fence[i] * 2 + 6 + Math.max(0, p.y - this.groundY) * 1.1;
        const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
        const rc = Math.ceil(reach / this.cell);
        outer: for (let dx = -rc; dx <= rc; dx++) for (let dz = -rc; dz <= rc; dz++) {
          for (const j of this.grid.get((cx + dx) + ',' + (cz + dz)) || []) {
            const di = Math.abs(i - j);
            if (Math.min(di, N - di) < 30) continue;
            const q = this.P[j];
            if (q.y < p.y - 5 && Math.hypot(q.x - p.x, q.z - p.z) < reach) { raw[i] = 1; break outer; }
          }
        }
      }
      for (let i = 0; i < N; i++) if (raw[i]) for (let k = -6; k <= 6; k++) this.bridge[(i + k + N) % N] = 1;
    }
    prepareFeatures(this, def);
    this.slope = this.P.map((p, i) => (this.P[(i + 1) % N].y - p.y) / SPACING);
  }

  // Abstand zum nächsten anderen Streckenteil (nicht die Nachbarpunkte)
  nearestOther(i) {
    const p = this.P[i], N = this.N;
    let best = Infinity;
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      for (const j of this.grid.get((cx + dx) + ',' + (cz + dz)) || []) {
        const di = Math.abs(i - j);
        if (Math.min(di, N - di) < 40) continue;
        best = Math.min(best, Math.hypot(this.P[j].x - p.x, this.P[j].z - p.z));
      }
    }
    return best;
  }

  key(x, z) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); }

  // Abstand (xz) zum nächsten Streckenpunkt mit ähnlicher Höhe (für Deko)
  nearestDist(x, z, y = null) {
    let best = Infinity;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const l = this.grid.get((cx + dx) + ',' + (cz + dz));
      if (!l) continue;
      for (const i of l) {
        const p = this.P[i];
        if (y !== null && Math.abs(p.y - y) > 8) continue;
        best = Math.min(best, Math.hypot(p.x - x, p.z - z));
      }
    }
    return best;
  }

  // Höhe der Fahrbahn quer zur Fahrtrichtung (Steilkurve + Halfpipe)
  crossOff(i, lat) {
    let y = -this.bank[i] * lat;
    const H = this.hp[i];
    if (H) {
      const flat = this.hw[i] * 0.35, w = this.fence[i];
      const t = Math.max(0, (Math.abs(lat) - flat) / (w - flat));
      y += H * t * t;
    }
    return y;
  }
  // Steigung quer zur Fahrtrichtung (dy / dlat)
  crossSlope(i, lat) {
    let s = -this.bank[i];
    const H = this.hp[i];
    if (H) {
      const flat = this.hw[i] * 0.35, w = this.fence[i];
      const t = Math.max(0, (Math.abs(lat) - flat) / (w - flat));
      s += (H * 2 * t / (w - flat)) * Math.sign(lat);
    }
    return s;
  }

  // Position eines Karts relativ zur Strecke
  locate(p, hint, out = {}) {
    const N = this.N;
    let best = -1, bd = Infinity;
    const scan = (from, count) => {
      for (let k = 0; k < count; k++) {
        const i = (((from + k) % N) + N) % N;
        const q = this.P[i];
        const dx = q.x - p.x, dz = q.z - p.z, dy = q.y - p.y;
        const d = dx * dx + dz * dz + dy * dy * 6;
        if (d < bd) { bd = d; best = i; }
      }
    };
    if (hint == null || hint < 0 || !isFinite(hint)) scan(0, N);
    else {
      scan(Math.floor(hint) - 30, 60);
      if (bd > 60 * 60) scan(0, N);
    }
    let i = best;
    let a = this.P[i], b = this.P[(i + 1) % N];
    let sx = b.x - a.x, sz = b.z - a.z;
    let u = ((p.x - a.x) * sx + (p.z - a.z) * sz) / (sx * sx + sz * sz);
    if (u < 0) {
      i = (i - 1 + N) % N;
      a = this.P[i]; b = this.P[(i + 1) % N];
      sx = b.x - a.x; sz = b.z - a.z;
      u = ((p.x - a.x) * sx + (p.z - a.z) * sz) / (sx * sx + sz * sz);
    }
    u = Math.min(1, Math.max(0, u));
    const j = (i + 1) % N;
    const cx = a.x + sx * u, cz = a.z + sz * u, cy = a.y + (b.y - a.y) * u;
    const R = this.R[i];
    const lat = (p.x - cx) * R.x + (p.z - cz) * R.z;
    let y = cy + this.crossOff(i, lat);
    if (Math.abs(lat) < this.hw[i]) y += this.bump[i] + (this.bump[j] - this.bump[i]) * u;
    out.gap = this.gap[i] === 1 || (this.crumbleGap ? this.crumbleGap(i, lat) : false);
    if (out.gap) y = -1e4;
    out.i = i; out.u = u; out.idx = i + u; out.lat = lat; out.y = y; out.roadY = cy;
    out.cx = cx; out.cz = cz;
    return out;
  }

  pointAt(idx, lat = 0, out = new THREE.Vector3()) {
    const N = this.N;
    const i = ((Math.floor(idx) % N) + N) % N;
    const u = idx - Math.floor(idx);
    const a = this.P[i], b = this.P[(i + 1) % N], R = this.R[i];
    out.set(a.x + (b.x - a.x) * u + R.x * lat, a.y + (b.y - a.y) * u + this.crossOff(i, lat), a.z + (b.z - a.z) * u + R.z * lat);
    return out;
  }

  headingAt(idx) {
    const T = this.T[((Math.floor(idx) % this.N) + this.N) % this.N];
    return Math.atan2(T.x, T.z);
  }

  // ------------------------------------------------------------ Geometrie
  build(scene, settings) {
    const th = this.theme;
    const group = new THREE.Group();
    scene.add(group);
    this.group = group;
    const N = this.N;
    const C = (h) => new THREE.Color(h);

    // Texturen
    const roadTex = canvasTex(256, 256, (ctx, w, h) => {
      speckle(ctx, w, h, th.road, th.road2, 900, 2.2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, 0, 7, h);
      ctx.fillRect(w - 7, 0, 7, h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const offTex = canvasTex(256, 256, (ctx, w, h) => speckle(ctx, w, h, th.offroad, th.ground2, 600, 3));
    const groundTex = canvasTex(512, 512, (ctx, w, h) => speckle(ctx, w, h, th.ground, th.ground2, 1400, 6));
    groundTex.repeat.set(70, 70);

    // Fahrbahn + Wiese + Bordsteine
    // inner/outer: Abstand zur Mittellinie, als Funktion des Stützpunkts
    const ribbon = (innerF, outerF, yOff, colorFn, uvScale, withBump, cols = 1, skip = null) => {
      const pos = [], uv = [], col = [], idx = [];
      const W = cols + 1;
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.P[k], R = this.R[k];
        const b = withBump ? this.bump[k] : 0;
        const inner = innerF(k), outer = outerF(k);
        for (let q = 0; q <= cols; q++) {
          const s = inner + ((outer - inner) * q) / cols;
          pos.push(p.x + R.x * s, p.y + yOff + b + this.crossOff(k, s), p.z + R.z * s);
          uv.push(q / cols, (i * SPACING) / uvScale);
          const c = colorFn(k, s);
          col.push(c.r, c.g, c.b);
        }
        const k2 = (k + 1) % N;
        if (i < N && !this.gap[k] && !this.gap[k2] && !(skip && (skip(k) || skip(k2)))) {
          for (let q = 0; q < cols; q++) {
            const a = i * W + q;
            idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const white = C('#ffffff'), ice = C(th.ice || '#BFE9FF');
    const road = new THREE.Mesh(
      ribbon((k) => -this.hw[k], (k) => this.hw[k], 0.02, (k) => (this.grip[k] < 1 ? ice : white), 18, true, 8, (k) => this.crumble && this.crumble[k]),
      new THREE.MeshStandardMaterial({ map: roadTex, vertexColors: true, roughness: 0.85 }));
    road.material.side = THREE.DoubleSide;
    road.receiveShadow = true;
    group.add(road);
    const offMat = new THREE.MeshStandardMaterial({ map: offTex, roughness: 1 });
    for (const s of [-1, 1]) {
      const g = ribbon((k) => s * (this.hw[k] + 0.6), (k) => s * this.fence[k], 0.0, (k) => (this.hp[k] ? (this.grip[k] < 1 ? ice : white) : white), 10, false, 4, (k) => this.crumble && this.crumble[k]);
      const m = new THREE.Mesh(g, offMat);
      m.material.side = THREE.DoubleSide;
      m.receiveShadow = true;
      group.add(m);
      // Bordstein
      const c1 = C(th.curb[0]), c2 = C(th.curb[1]);
      const curb = new THREE.Mesh(
        ribbon((k) => s * (this.hw[k] - 0.3), (k) => s * (this.hw[k] + 0.8), 0.09, (k) => (Math.floor(k / 2) % 2 ? c1 : c2), 10, false, 1, (k) => this.crumble && this.crumble[k]),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
      curb.receiveShadow = true;
      group.add(curb);
    }

    // Banden (weiche Polster)
    const f1 = C(th.fence), f2 = C(th.fence2);
    const fencePos = [], fenceCol = [], fenceIdx = [];
    const prof = [[-0.35, 0], [-0.35, 0.7], [-0.15, 1.0], [0.15, 1.0], [0.35, 0.7], [0.35, 0]];
    for (const s of [-1, 1]) {
      const base = fencePos.length / 3;
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.P[k], R = this.R[k];
        const c = Math.floor(k / 3) % 2 ? f1 : f2;
        for (const [o, h] of prof) {
          const d = s * (this.fence[k] + 0.35 + o);
          fencePos.push(p.x + R.x * d, p.y + h + this.crossOff(k, d), p.z + R.z * d);
          fenceCol.push(c.r, c.g, c.b);
        }
        if (i < N && !this.gap[k] && !this.gap[(k + 1) % N]) for (let q = 0; q < prof.length - 1; q++) {
          const a = base + i * prof.length + q, b = a + prof.length;
          fenceIdx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fencePos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fenceCol, 3));
    fg.setIndex(fenceIdx);
    fg.computeVertexNormals();
    const fence = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide }));
    fence.castShadow = settings.shadows;
    fence.receiveShadow = true;
    group.add(fence);

    // Böschungen bzw. Brückenpfeiler
    if (this.def.shape.type !== 'lemniscate') this.buildEmbankment(group, th);
    if (this.bridge.some((b) => b)) this.buildBridge(group, th);

    // Rampen-Vorderseite + Streifen
    const rampMat = new THREE.MeshStandardMaterial({ color: th.curb[1], roughness: 0.5 });
    const glideMat = new THREE.MeshStandardMaterial({ color: '#4FC3FF', roughness: 0.4, emissive: '#1E88FF', emissiveIntensity: 0.4 });
    const bigMat = new THREE.MeshStandardMaterial({ color: '#FFD447', roughness: 0.4, emissive: '#FF9A2B', emissiveIntensity: 0.25 });
    for (const j of this.jumps) {
      const c = j.c;
      const p = this.P[c], T = this.T[c];
      const ROAD_HALF = this.hw[c];
      const rl = j.kind === 1 ? RAMP_LEN : 9;
      const mat = j.kind === 3 ? glideMat : j.kind === 2 ? bigMat : rampMat;
      const box = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, j.h, 0.4), mat);
      box.position.set(p.x + T.x * 0.1, p.y + j.h / 2, p.z + T.z * 0.1);
      box.rotation.y = Math.atan2(T.x, T.z);
      box.castShadow = true;
      group.add(box);
      for (let k = 0; k < rl; k += 2) {
        const q = this.P[(c - k + N) % N];
        const s = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 - 1, 0.05, 1.2), j.kind === 1 ? new THREE.MeshStandardMaterial({ color: '#ffffff' }) : mat);
        s.position.set(q.x, q.y + this.bump[(c - k + N) % N] + 0.06, q.z);
        s.rotation.order = 'YXZ';
        s.rotation.y = Math.atan2(T.x, T.z);
        s.rotation.x = -Math.atan(j.h / (rl * SPACING));
        group.add(s);
      }
    }

    // Graben unter jeder Lücke (Wasser, Lava, Abgrund …)
    const gapCol = { volcano: '#FF6A1A', cave: '#140C2E', clouds: '#FFFFFF', glacier: '#4FA3E0', reef: '#1B6E8C' }[this.def.theme] || '#3FA9D8';
    const gapMat = new THREE.MeshStandardMaterial({ color: gapCol, roughness: 0.15, emissive: this.def.theme === 'volcano' ? '#FF4E1A' : '#000000',
      emissiveIntensity: this.def.theme === 'volcano' ? 0.7 : 0 });
    this.gapMeshes = [];
    // Abgrund-Textur: dunkel in der Mitte
    const voidTex = canvasTex(128, 128, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.7);
      g.addColorStop(0, '#05030A'); g.addColorStop(0.6, '#1A1226'); g.addColorStop(1, th.ground2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }, false);
    const voidMat = new THREE.MeshStandardMaterial({ map: voidTex, roughness: 1 });
    for (const j of this.jumps) {
      if (!j.len) continue;
      const GAP_LEN = j.len;
      const c = (j.c + 2 + Math.floor(GAP_LEN / 2)) % N;
      const p = this.P[c];
      const deep = j.kind !== 1 && !['volcano', 'reef', 'clouds'].includes(this.def.theme);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(this.fence[c] * 2 + 8, (GAP_LEN + 3) * SPACING), deep ? voidMat : gapMat);
      m.rotation.order = 'YXZ';
      m.rotation.y = this.headingAt(c);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, Math.max(this.groundY + 0.08, p.y - 2.5), p.z);
      m.receiveShadow = true;
      group.add(m);
      this.gapMeshes.push(m);
      // Warnschilder
      for (const s of [-1, 1]) {
        const q = this.P[(c - GAP_LEN + N) % N], R = this.R[(c - GAP_LEN + N) % N];
        const sign = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.8, 3), new THREE.MeshStandardMaterial({ color: '#FFD447', emissive: '#FFB000', emissiveIntensity: 0.4 }));
        sign.position.set(q.x + R.x * s * (this.fence[c] + 1.5), q.y + 1.2, q.z + R.z * s * (this.fence[c] + 1.5));
        group.add(sign);
      }
    }

    this.buildStart(group, th);
    this.buildSky(scene, th);
    this.buildScenery(group, th, settings);
    this.buildDetails(group, th, settings);
    this.features = new Features(this, group, th, settings);
    return group;
  }

  update(dt, t) {
    if (this.features) this.features.update(dt, t);
  }

  // Details: Kurvenschilder, Fähnchen, Laternen, Tribüne, Randpflanzen
  buildDetails(group, th, settings) {
    const N = this.N, r = rng(N * 7 + 3);
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, list, shadow = false, colors = null) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
      im.castShadow = shadow && settings.shadows;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      return im;
    };
    const place = (x, y, z, yaw, sx = 1, sy = 1, sz = 1) => {
      _q.setFromAxisAngle(up, yaw);
      return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    };
    const free = (i) => !this.bridge[i] && !this.gap[i] && this.nearestOther(i) > 45;

    // 1) Kurvenschilder (Pfeile) an der Kurvenaussenseite
    const chevTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = th.curb[1]; x.fillRect(0, 0, 128, 64);
      x.fillStyle = '#FFFFFF';
      for (const ox of [10, 52, 94]) { x.beginPath(); x.moveTo(ox, 8); x.lineTo(ox + 22, 32); x.lineTo(ox, 56); x.lineTo(ox + 12, 56); x.lineTo(ox + 34, 32); x.lineTo(ox + 12, 8); x.fill(); }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const signs = { 1: [], '-1': [] }, posts = [];
    for (let i = 0; i < N; i += 5) {
      const a = this.T[(i - 8 + N) % N], b = this.T[(i + 8) % N];
      const curve = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
      if (Math.abs(curve) < 0.32 || this.gap[i]) continue;
      const dir = curve > 0 ? 1 : -1; // 1 = Rechtskurve
      const lat = -dir * (this.fence[i] + 1.2);
      const p = this.P[i], R = this.R[i];
      const x = p.x + R.x * lat, z = p.z + R.z * lat;
      const yaw = this.headingAt(i) + Math.PI;
      signs[dir].push(place(x, p.y + 2.1, z, yaw, 1, 1, 1));
      posts.push(place(x, p.y + 1.0, z, 0, 1, 1, 1));
    }
    const signGeo = new THREE.PlaneGeometry(3.2, 1.6);
    for (const d of [1, -1]) {
      const mat = new THREE.MeshStandardMaterial({ map: chevTex, roughness: 0.6, side: THREE.DoubleSide });
      if (d === -1) { mat.map = chevTex.clone(); mat.map.repeat.x = -1; mat.map.offset.x = 1; mat.map.wrapS = THREE.RepeatWrapping; mat.map.needsUpdate = true; }
      inst(signGeo, mat, signs[d], true);
    }
    inst(new THREE.CylinderGeometry(0.12, 0.12, 2, 6), new THREE.MeshStandardMaterial({ color: '#8A8A90' }), posts);

    // 2) Fähnchen-Girlanden über der Strecke
    const poles = [], ropes = [], flags = [], flagCols = [];
    const palette = [th.fence, th.fence2, th.curb[1], '#FFD447', '#7EC8F2', '#9ED36A'].map((c) => new THREE.Color(c));
    for (let i = 40; i < N - 20; i += 75) {
      if (!free(i)) continue;
      const p = this.P[i], R = this.R[i], w = this.fence[i] + 0.8, yaw = this.headingAt(i);
      for (const s of [-1, 1]) poles.push(place(p.x + R.x * s * w, p.y + 4.2, p.z + R.z * s * w, 0, 1, 1, 1));
      ropes.push(place(p.x, p.y + 8.2, p.z, yaw + Math.PI / 2, w * 2, 1, 1));
      const n = Math.floor(w * 2 / 1.6);
      for (let k = 0; k <= n; k++) {
        const l = -w + (k / n) * w * 2;
        const sag = 0.9 * (1 - (l / w) ** 2);
        flags.push(place(p.x + R.x * l, p.y + 7.6 - sag, p.z + R.z * l, yaw, 1, 1, 1));
        flagCols.push(palette[k % palette.length]);
      }
    }
    inst(new THREE.CylinderGeometry(0.18, 0.22, 8.4, 8), new THREE.MeshStandardMaterial({ color: th.fence2, roughness: 0.5 }), poles, true);
    inst(new THREE.BoxGeometry(1, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: '#FFFFFF' }), ropes);
    const flagGeo = new THREE.ConeGeometry(0.55, 1.2, 3);
    flagGeo.rotateX(Math.PI);
    flagGeo.scale(1, 1, 0.15);
    inst(flagGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), flags, false, flagCols);

    // 3) Laternen mit leuchtenden Kugeln
    const lampPosts = [], lampBalls = [];
    for (let i = 10; i < N; i += 22) {
      if (this.gap[i] || this.bridge[i]) continue;
      const s = (i / 22) % 2 ? 1 : -1;
      const p = this.P[i], R = this.R[i], w = this.fence[i] + 1.6;
      lampPosts.push(place(p.x + R.x * s * w, p.y + 2.2, p.z + R.z * s * w, 0));
      lampBalls.push(place(p.x + R.x * s * w, p.y + 4.6, p.z + R.z * s * w, 0));
    }
    const glow = th.night || th.volcano || th.underwater ? 3 : 1.2;
    inst(new THREE.CylinderGeometry(0.14, 0.2, 4.4, 8), new THREE.MeshStandardMaterial({ color: '#5A5560', roughness: 0.5 }), lampPosts);
    inst(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshStandardMaterial({ color: '#FFF4C2', emissive: th.night ? '#B6F3FF' : '#FFE08A', emissiveIntensity: glow }), lampBalls);

    // 4) Zuschauertribüne mit Fans neben dem Start
    const i0 = 8, p0 = this.P[i0], R0 = this.R[i0];
    const side = this.nearestOther(i0) > 60 ? -1 : 1;
    const tribune = new THREE.Group();
    const standMat = new THREE.MeshStandardMaterial({ color: th.fence2, roughness: 0.7 });
    for (let row = 0; row < 3; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2 + row * 1.2, 2.4), standMat);
      step.position.set(0, (1.2 + row * 1.2) / 2, row * 2.4);
      step.castShadow = step.receiveShadow = true;
      tribune.add(step);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(36, 0.4, 9), new THREE.MeshStandardMaterial({ color: th.fence, roughness: 0.5 }));
    roof.position.set(0, 8.5, 2.4);
    roof.castShadow = true;
    tribune.add(roof);
    for (const x of [-17, 17]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 8.5), standMat);
      pole.position.set(x, 4.25, 6.4);
      tribune.add(pole);
    }
    const fanBody = [], fanEyes = [], fanCols = [];
    this.fans = [];
    const fanPal = ['#F4EEE4', '#C8552B', '#8C6B4F', '#F7A8C6', '#E7C79F', '#2C3350', '#A0724B', '#7A5034', '#FFD447', '#9ED36A'].map((c) => new THREE.Color(c));
    for (let row = 0; row < 3; row++) for (let k = 0; k < 14; k++) {
      const fx = -15.5 + k * 2.35 + (r() - 0.5) * 0.6, fy = 1.2 + row * 1.2 + 0.8, fz = row * 2.4;
      this.fans.push({ x: fx, y: fy, z: fz, ph: r() * 6, sp: 6 + r() * 4 });
      fanCols.push(fanPal[Math.floor(r() * fanPal.length)]);
    }
    const fanGeo = new THREE.SphereGeometry(0.75, 14, 10);
    const eyeGeo = new THREE.SphereGeometry(0.12, 8, 6);
    this.fanMesh = new THREE.InstancedMesh(fanGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), this.fans.length);
    this.fanEyes = new THREE.InstancedMesh(eyeGeo, new THREE.MeshStandardMaterial({ color: '#1A1420', roughness: 0.2 }), this.fans.length * 2);
    fanCols.forEach((c, i) => this.fanMesh.setColorAt(i, c));
    this.fanMesh.castShadow = settings.shadows;
    tribune.add(this.fanMesh, this.fanEyes);
    void fanBody; void fanEyes;
    const d = this.fence[i0] + 7;
    tribune.position.set(p0.x + R0.x * side * d, p0.y, p0.z + R0.z * side * d);
    // Tribüne schaut zur Strecke
    tribune.rotation.y = this.headingAt(i0) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(tribune);
    this.updateFans(0);

    // 5) Dichte kleine Pflanzen direkt an der Bande
    const small = { meadow: 'Flower', bamboo: 'Flower', cave: 'GlowShroom', honey: 'Flower', glacier: 'Crystal', reef: 'Seaweed', clouds: 'Cloud', volcano: 'LavaRock' }[this.def.theme] || 'Flower';
    const tufts = [], rocks = [];
    for (let i = 0; i < N; i += 2) {
      if (this.gap[i] || this.bridge[i]) continue;
      for (const s of [-1, 1]) {
        if (r() < 0.55) continue;
        const p = this.P[i], R = this.R[i], w = this.fence[i] + 1.4 + r() * 3;
        const x = p.x + R.x * s * w, z = p.z + R.z * s * w;
        if (this.nearestDist(x, z) < this.fence[i] + 1) continue;
        const sc = small === 'Cloud' ? 0.5 + r() * 0.4 : 0.45 + r() * 0.5;
        (r() < 0.75 ? tufts : rocks).push(place(x, p.y - (small === 'Cloud' ? 1.5 : 0), z, r() * 6.28, sc, sc, sc));
      }
    }
    group.add(instanceProps(small, tufts, { shadows: false }));
    group.add(instanceProps('Rock', rocks, { shadows: false }));
  }

  // Fans hüpfen und jubeln
  updateFans(t) {
    if (!this.fanMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1.08, 1);
    this.fans.forEach((f, i) => {
      const y = f.y + Math.abs(Math.sin(t * f.sp + f.ph)) * 0.45;
      m.compose(p.set(f.x, y, f.z), q, s);
      this.fanMesh.setMatrixAt(i, m);
      for (const e of [-1, 1]) {
        m.compose(p.set(f.x + e * 0.28, y + 0.18, f.z - 0.68), q, new THREE.Vector3(1, 1, 1));
        this.fanEyes.setMatrixAt(i * 2 + (e > 0 ? 1 : 0), m);
      }
    });
    this.fanMesh.instanceMatrix.needsUpdate = true;
    this.fanEyes.instanceMatrix.needsUpdate = true;
  }

  buildEmbankment(group, th) {
    const N = this.N;
    const pos = [], col = [], idx = [];
    const g1 = new THREE.Color(th.ground2), g2 = new THREE.Color(th.offroad);
    for (const s of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.P[k], R = this.R[k];
        const h = p.y - this.groundY;
        const d0 = s * this.fence[k], d1 = s * (this.fence[k] + 0.5 + h * 1.1);
        pos.push(p.x + R.x * d0, p.y + this.crossOff(k, d0), p.z + R.z * d0, p.x + R.x * d1, this.groundY, p.z + R.z * d1);
        col.push(g2.r, g2.g, g2.b, g1.r, g1.g, g1.b);
        const k2 = (k + 1) % N;
        if (i < N && !this.gap[k] && !this.gap[k2] && !this.bridge[k] && !this.bridge[k2]) {
          const a = base + i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    group.add(m);
  }

  buildBridge(group, th) {
    const N = this.N;
    // Unterseite der Fahrbahn (Platte)
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = this.P[k], R = this.R[k];
      const F = this.fence[k];
      for (const [s, dy] of [[-F, 0], [-F, -1.4], [F, -1.4], [F, 0]]) pos.push(p.x + R.x * s, p.y + dy - 0.02, p.z + R.z * s);
      if (i < N && !this.gap[k] && !this.gap[(k + 1) % N] && this.bridge[k] && this.bridge[(k + 1) % N]) for (let q = 0; q < 3; q++) {
        const a = i * 4 + q, b = a + 4;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const slab = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: th.fence2, roughness: 0.7, side: THREE.DoubleSide }));
    slab.receiveShadow = true;
    group.add(slab);
    // Wolken-Pfeiler, die nicht auf der unteren Fahrbahn stehen
    const pillarMat = new THREE.MeshStandardMaterial({ color: th.cloudGround ? '#FFFFFF' : th.fence2, roughness: 0.8 });
    const geo = new THREE.CylinderGeometry(1.6, 2.4, 1, 14);
    for (let i = 0; i < N; i += 14) {
      if (!this.bridge[i] || this.gap[i]) continue;
      const p = this.P[i];
      const h = p.y - this.groundY;
      for (const s of [-1, 1]) {
        const x = p.x + this.R[i].x * s * 6, z = p.z + this.R[i].z * s * 6;
        let blocked = false;
        for (let j = 0; j < N; j += 2) {
          const q = this.P[j];
          if (q.y < p.y - 6 && Math.hypot(q.x - x, q.z - z) < FENCE + 3) { blocked = true; break; }
        }
        if (blocked) continue;
        const m = new THREE.Mesh(geo, pillarMat);
        m.scale.y = h;
        m.position.set(x, this.groundY + h / 2 - 1.4, z);
        group.add(m);
        if (!th.cloudGround) continue;
        const puff = propClone('Cloud');
        puff.position.set(x, this.groundY + 6, z);
        puff.scale.setScalar(3.5);
        group.add(puff);
      }
    }
  }

  buildStart(group, th) {
    const p = this.P[0], T = this.T[0], R = this.R[0];
    const tex = canvasTex(256, 32, (ctx, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
        ctx.fillStyle = (x + y) % 2 ? '#222' : '#fff';
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }, false);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    line.rotation.order = 'YXZ';
    line.rotation.y = Math.atan2(T.x, T.z) + Math.PI / 2;
    line.rotation.x = -Math.PI / 2;
    line.position.set(p.x, p.y + 0.05, p.z);
    line.receiveShadow = true;
    group.add(line);
    // Torbogen
    const arch = new THREE.Group();
    const mat1 = new THREE.MeshStandardMaterial({ color: th.fence, roughness: 0.4 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 9, 16), mat1);
      post.position.set(s * (ROAD_HALF + 2.2), 4.5, 0);
      post.castShadow = true;
      arch.add(post);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: th.fence2 }));
      ball.position.set(s * (ROAD_HALF + 2.2), 9.4, 0);
      arch.add(ball);
    }
    const bannerTex = canvasTex(1024, 128, (ctx, w, h) => {
      ctx.fillStyle = th.fence2;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = th.fence;
      for (let x = 0; x < w; x += 64) { ctx.beginPath(); ctx.arc(x + 32, h, 20, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = 'bold 78px "Baloo 2", "Trebuchet MS", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#3B2A4A';
      ctx.strokeText('🐾 TRAPANOTTO KART 🐾', w / 2, h / 2 - 4);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('🐾 TRAPANOTTO KART 🐾', w / 2, h / 2 - 4);
    }, false);
    const banner = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF + 2.2) * 2, 2.4, 0.5),
      [mat1, mat1, mat1, mat1, new THREE.MeshStandardMaterial({ map: bannerTex }), new THREE.MeshStandardMaterial({ map: bannerTex })]);
    banner.position.set(0, 8, 0);
    banner.castShadow = true;
    arch.add(banner);
    arch.position.set(p.x, p.y, p.z);
    arch.rotation.y = Math.atan2(T.x, T.z);
    group.add(arch);
    void R;
  }

  buildSky(scene, th) {
    const geo = new THREE.SphereGeometry(1800, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(th.sky[0]) }, bottom: { value: new THREE.Color(th.sky[1]) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y*1.6+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
    scene.add(sky);
    this.sky = sky;
  }

  buildScenery(group, th, settings) {
    const r = rng(this.N * 13 + 5);
    // Boden
    const groundTex = canvasTex(512, 512, (ctx, w, h) => speckle(ctx, w, h, th.ground, th.ground2, 1400, 6));
    groundTex.repeat.set(80, 80);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = this.groundY;
    ground.receiveShadow = true;
    group.add(ground);

    // Hügel am Horizont
    const hillMat = new THREE.MeshStandardMaterial({ color: th.hills, roughness: 1, flatShading: true });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + r() * 0.1;
      const d = 650 + r() * 350;
      const s = 70 + r() * 140;
      const m = new THREE.Mesh(th.cloudGround ? new THREE.SphereGeometry(1, 12, 8) : new THREE.ConeGeometry(1, 1, 7), hillMat);
      m.scale.set(s, s * (th.cloudGround ? 0.45 : 0.6 + r() * 0.5), s);
      m.position.set(Math.cos(a) * d, this.groundY + (th.cloudGround ? 0 : m.scale.y / 2 - 2), Math.sin(a) * d);
      group.add(m);
    }

    // Deko verteilen
    const base = { Tree: 1.7, Pine: 1.9, Bamboo: 1.4, Mushroom: 1.4, GlowShroom: 1.5, Flower: 1.6, Rock: 1.4, Coral: 1.6,
      Seaweed: 1.7, Cloud: 2.6, HoneyJar: 1.4, Honeycomb: 1.5, Crystal: 1.5, LavaRock: 1.4, Palm: 1.5, Tower: 2.4 };
    const mats = {};
    const total = th.props.reduce((s, p) => s + p[1], 0);
    const pick = () => {
      let x = r() * total;
      for (const [n, w] of th.props) if ((x -= w) <= 0) return n;
      return th.props[0][0];
    };
    const tryPlace = (x, z, yRef) => {
      const d = this.nearestDist(x, z);
      if (d < FENCE + 3) return;
      const name = pick();
      const s = base[name] * (0.75 + r() * 0.6);
      // Höhe: auf der Böschung oder auf dem Boden
      let y = this.groundY;
      if (yRef !== null && this.def.shape.type !== 'lemniscate') y = Math.max(this.groundY, yRef - (d - FENCE) / 1.1);
      if (name === 'Cloud') y = this.groundY + (th.cloudGround ? 4 + r() * 10 : 25 + r() * 30);
      if (name === 'Tower' && th.cloudGround) {
        y = this.groundY + 18 + r() * 14;
        (mats.Cloud ||= []).push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 3, z), new THREE.Quaternion(), new THREE.Vector3(4, 3, 4)));
      }
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2), new THREE.Vector3(s, s, s));
      (mats[name] ||= []).push(m);
    };
    for (let i = 0; i < this.N; i += 2) {
      const p = this.P[i], R = this.R[i];
      for (const s of [-1, 1]) {
        if (r() < 0.7) continue;
        const d = FENCE + 3 + r() * r() * 70;
        tryPlace(p.x + R.x * s * d, p.z + R.z * s * d, p.y);
      }
    }
    for (let k = 0; k < 260; k++) {
      const a = r() * Math.PI * 2, d = 50 + r() * 600;
      tryPlace(Math.cos(a) * d, Math.sin(a) * d, null);
    }
    // In Bereiche aufteilen, damit unsichtbare Bereiche nicht gezeichnet werden
    const _p = new THREE.Vector3();
    for (const [name, list] of Object.entries(mats)) {
      const chunks = new Map();
      for (const m of list) {
        _p.setFromMatrixPosition(m);
        const key = Math.floor(_p.x / 140) + ',' + Math.floor(_p.z / 140);
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(m);
      }
      for (const l of chunks.values()) group.add(instanceProps(name, l, { shadows: settings.shadows && !['Flower', 'Cloud'].includes(name) }));
    }


    // Wahrzeichen (in Blender modelliert)
    const LM = { meadow: 'Windmill', bamboo: 'Gate_Pagoda', cave: 'Gate_Shroom', honey: 'Factory', glacier: 'Gate_Ice',
      reef: 'Gate_Coral', clouds: 'Gate_Castle', volcano: 'Gate_Tiki' };
    this.spinners = [];
    const lmName = LM[this.def.theme];
    for (const f of [0.25, 0.7]) {
      const lm = landmarkClone(lmName);
      if (!lm) break;
      let i = Math.round(f * this.N) % this.N;
      for (let s = 0; s < this.N / 4 && (this.bridge[i] || this.gap[i] || this.nearestOther(i) < 45); s++) i = (i + 1) % this.N;
      const p = this.P[i], R = this.R[i];
      const side = lmName === 'Windmill' ? FENCE + 9 : 0;
      lm.position.set(p.x + R.x * side, p.y, p.z + R.z * side);
      lm.rotation.y = this.headingAt(i);
      group.add(lm);
      lm.traverse((o) => { if (o.name.startsWith('Spin')) this.spinners.push({ o, axis: lmName === 'Windmill' ? 'z' : 'x' }); });
    }
    if (th.volcano) {
      let minR = Infinity;
      for (const p of this.P) minR = Math.min(minR, Math.hypot(p.x, p.z));
      const vb = Math.max(30, Math.min(95, minR - 35)), vs = vb / 95;
      const v = new THREE.Mesh(new THREE.CylinderGeometry(22 * vs, vb, 110 * vs, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#4A3438', roughness: 1, flatShading: true }));
      v.position.set(0, this.groundY + 55 * vs, 0);
      group.add(v);
      const lava = new THREE.Mesh(new THREE.CircleGeometry(22 * vs, 24), new THREE.MeshBasicMaterial({ color: '#FF6A1A', toneMapped: false }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(0, this.groundY + 108, 0);
      group.add(lava);
      this.volcanoTop = new THREE.Vector3(0, this.groundY + 110, 0);
    }
  }
}
