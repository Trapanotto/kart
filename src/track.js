// Strecke: Geometrie, Abfragen (wo ist ein Kart?), Landschaft
import * as THREE from 'three';
import { sampleCenterline, ROAD_HALF, OFFROAD, SPACING } from './data.js';
import { instanceProps, propClone, landmarkClone } from './assets.js';

export const FENCE = ROAD_HALF + OFFROAD;
const RAMP_LEN = 6;      // Stützpunkte (x SPACING = 12 Einheiten)
const RAMP_H = 1.7;

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
    this.bump = new Float32Array(N);
    this.launch = new Uint8Array(N);
    for (const f of def.ramps || []) {
      const c = Math.round(f * N);
      for (let k = 0; k < RAMP_LEN; k++) this.bump[(c - RAMP_LEN + 1 + k + N) % N] = RAMP_H * ((k + 1) / RAMP_LEN);
      this.launch[c % N] = 1;
      this.launch[(c + 1) % N] = 1;
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
    let y = cy;
    if (Math.abs(lat) < ROAD_HALF) y += this.bump[i] + (this.bump[j] - this.bump[i]) * u;
    out.i = i; out.u = u; out.idx = i + u; out.lat = lat; out.y = y;
    out.cx = cx; out.cz = cz;
    return out;
  }

  pointAt(idx, lat = 0, out = new THREE.Vector3()) {
    const N = this.N;
    const i = ((Math.floor(idx) % N) + N) % N;
    const u = idx - Math.floor(idx);
    const a = this.P[i], b = this.P[(i + 1) % N], R = this.R[i];
    out.set(a.x + (b.x - a.x) * u + R.x * lat, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u + R.z * lat);
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
    const ribbon = (inner, outer, yOff, colorFn, uvScale, withBump) => {
      const pos = [], uv = [], col = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const k = i % N, p = this.P[k], R = this.R[k];
        const b = withBump ? this.bump[k] : 0;
        for (const s of [inner, outer]) {
          pos.push(p.x + R.x * s, p.y + yOff + b, p.z + R.z * s);
          uv.push((s - inner) / (outer - inner), (i * SPACING) / uvScale);
          const c = colorFn(k, s);
          col.push(c.r, c.g, c.b);
        }
        if (i < N) {
          const a = i * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
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
      ribbon(-ROAD_HALF, ROAD_HALF, 0.02, (k) => (this.grip[k] < 1 ? ice : white), 18, true),
      new THREE.MeshStandardMaterial({ map: roadTex, vertexColors: true, roughness: 0.85 }));
    road.material.side = THREE.DoubleSide;
    road.receiveShadow = true;
    group.add(road);
    const offMat = new THREE.MeshStandardMaterial({ map: offTex, roughness: 1 });
    for (const s of [-1, 1]) {
      const g = ribbon(s * (ROAD_HALF + 0.6), s * FENCE, 0.0, () => white, 10, false);
      const m = new THREE.Mesh(g, offMat);
      m.material.side = THREE.DoubleSide;
      m.receiveShadow = true;
      group.add(m);
      // Bordstein
      const c1 = C(th.curb[0]), c2 = C(th.curb[1]);
      const curb = new THREE.Mesh(
        ribbon(s * (ROAD_HALF - 0.3), s * (ROAD_HALF + 0.8), 0.09, (k) => (Math.floor(k / 2) % 2 ? c1 : c2), 10, false),
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
          const d = s * (FENCE + 0.35 + o);
          fencePos.push(p.x + R.x * d, p.y + h, p.z + R.z * d);
          fenceCol.push(c.r, c.g, c.b);
        }
        if (i < N) for (let q = 0; q < prof.length - 1; q++) {
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
    if (this.def.shape.type === 'lemniscate') this.buildBridge(group, th);
    else this.buildEmbankment(group, th);

    // Rampen-Vorderseite + Streifen
    const rampMat = new THREE.MeshStandardMaterial({ color: th.curb[1], roughness: 0.5 });
    for (const f of this.def.ramps || []) {
      const c = Math.round(f * N) % N;
      const p = this.P[c], R = this.R[c], T = this.T[c];
      const box = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, RAMP_H, 0.4), rampMat);
      box.position.set(p.x + T.x * 0.1, p.y + RAMP_H / 2, p.z + T.z * 0.1);
      box.rotation.y = Math.atan2(T.x, T.z);
      box.castShadow = true;
      group.add(box);
      for (let k = 0; k < RAMP_LEN; k += 2) {
        const q = this.P[(c - k + N) % N];
        const s = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2 - 1, 0.05, 1.2), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
        s.position.set(q.x, q.y + this.bump[(c - k + N) % N] + 0.06, q.z);
        s.rotation.order = 'YXZ';
        s.rotation.y = Math.atan2(T.x, T.z);
        s.rotation.x = -Math.atan(RAMP_H / (RAMP_LEN * SPACING));
        group.add(s);
      }
    }

    this.buildStart(group, th);
    this.buildSky(scene, th);
    this.buildScenery(group, th, settings);
    return group;
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
        const d0 = s * FENCE, d1 = s * (FENCE + 0.5 + h * 1.1);
        pos.push(p.x + R.x * d0, p.y, p.z + R.z * d0, p.x + R.x * d1, this.groundY, p.z + R.z * d1);
        col.push(g2.r, g2.g, g2.b, g1.r, g1.g, g1.b);
        if (i < N) {
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
      for (const [s, dy] of [[-FENCE, 0], [-FENCE, -1.4], [FENCE, -1.4], [FENCE, 0]]) pos.push(p.x + R.x * s, p.y + dy - 0.02, p.z + R.z * s);
      if (i < N) for (let q = 0; q < 3; q++) {
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
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.9 });
    const geo = new THREE.CylinderGeometry(1.6, 2.4, 1, 14);
    for (let i = 0; i < N; i += 14) {
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
      const i = Math.round(f * this.N) % this.N;
      const p = this.P[i], R = this.R[i];
      const side = lmName === 'Windmill' ? FENCE + 9 : 0;
      lm.position.set(p.x + R.x * side, p.y, p.z + R.z * side);
      lm.rotation.y = this.headingAt(i);
      group.add(lm);
      lm.traverse((o) => { if (o.name.startsWith('Spin')) this.spinners.push({ o, axis: lmName === 'Windmill' ? 'z' : 'x' }); });
    }
    if (th.volcano) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(22, 95, 110, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#4A3438', roughness: 1, flatShading: true }));
      v.position.set(0, this.groundY + 55, 0);
      group.add(v);
      const lava = new THREE.Mesh(new THREE.CircleGeometry(22, 24), new THREE.MeshBasicMaterial({ color: '#FF6A1A', toneMapped: false }));
      lava.rotation.x = -Math.PI / 2;
      lava.position.set(0, this.groundY + 108, 0);
      group.add(lava);
      this.volcanoTop = new THREE.Vector3(0, this.groundY + 110, 0);
    }
  }
}
