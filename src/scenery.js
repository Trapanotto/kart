// Kulisse: Tunnel mit Lichtleisten, Ballonbögen, kleine Tribünen an Sprüngen und Loopings,
// Ballen an engen Kurven, ein zweites Wahrzeichen pro Welt und Lampions.
// Feste Teile (Tunnel, Tribünen, Wahrzeichen) werden mitgebacken, Lampen und Leuchtteile
// werden beim Backen zu echten Lichtquellen (tr.bakeLights).
import * as THREE from 'three';
import { instanceProps } from './assets.js';
import { LOOP_LEN } from './features.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (x, y, z, yaw = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(UP, yaw), _s.set(sx, sy, sz));
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });

// Fans auf den kleinen Tribünen hüpfen (gleiches Prinzip wie die grosse Tribüne am Start)
export function animateFans(set, t) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1.08, 1), one = new THREE.Vector3(1, 1, 1);
  set.fans.forEach((f, i) => {
    const y = f.y + Math.abs(Math.sin(t * f.sp + f.ph)) * 0.45;
    set.mesh.setMatrixAt(i, m.compose(p.set(f.x, y, f.z), q, s));
    for (const e of [-1, 1]) set.eyes.setMatrixAt(i * 2 + (e > 0 ? 1 : 0), m.compose(p.set(f.x + e * 0.28, y + 0.18, f.z - 0.68), q, one));
  });
  set.mesh.instanceMatrix.needsUpdate = true;
  set.eyes.instanceMatrix.needsUpdate = true;
}

// Dreiecke so drehen, dass die Vorderseite in Richtung `want` zeigt (gemessen an Eckpunkt `vi`)
function orient(geo, vi, want) {
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  if (n.getX(vi) * want.x + n.getY(vi) * want.y + n.getZ(vi) * want.z >= 0) return geo;
  const idx = geo.index.array;
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = a; }
  geo.computeVertexNormals();
  return geo;
}

export function buildSpectacle(tr, group, th, settings) {
  const N = tr.N, r = rng(N * 17 + 11), theme = tr.def.theme;
  const sh = !!settings.shadows;
  const out = { fanSets: [], scroll: [], vents: [], tunnels: [] };
  const lights = tr.bakeLights || (tr.bakeLights = []);
  const light = (x, y, z, color, e) => lights.push({ p: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], c: color, e });

  // Stützpunkte, an denen schon etwas los ist
  const busy = new Uint8Array(N);
  const mark = (i, a, b = a) => { for (let k = -a; k <= b; k++) busy[(((i + k) % N) + N) % N] = 1; };
  const sky = theme === 'clouds'; // dort ist fast alles Brücke
  for (let i = 0; i < N; i++) if ((tr.bridge[i] && !sky) || tr.crumble?.[i] || tr.gap[i] || tr.hp[i] || tr.launch[i] || tr.bump[i] || tr.island[i]) busy[i] = 1;
  for (const L of tr.loops || []) mark(L.c, 6, LOOP_LEN + 6);
  mark(0, 16);
  for (const i of tr.landmarkIdx || []) mark(i, 10);
  const curve = (i, w = 8) => {
    const a = tr.T[(i - w + N) % N], b = tr.T[(i + w) % N];
    return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  };
  const free = (i, a, b = a) => { for (let k = -a; k <= b; k++) if (busy[(((i + k) % N) + N) % N]) return false; return true; };
  const at = (i, lat) => { const p = tr.P[i], R = tr.R[i]; return [p.x + R.x * lat, p.z + R.z * lat]; };
  // Höhe auf der Böschung (gleiche Form wie Track.buildEmbankment)
  const groundAt = (i, lat) => {
    const p = tr.P[i], f = tr.fence[i];
    if (sky) return p.y - 0.4;
    if (tr.def.shape.type === 'lemniscate') return tr.groundY; // dort gibt es keine Böschung
    const top = p.y + tr.crossOff(i, Math.sign(lat) * f);
    const t = Math.min(1, Math.max(0, (Math.abs(lat) - f) / (0.5 + (p.y - tr.groundY) * 1.1)));
    return Math.max(tr.groundY, top + (tr.groundY - top) * t);
  };
  const inst = (geo, mat, list, colors = null, shadow = false) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    if (colors) colors.forEach((c, i) => im.setColorAt(i, c));
    im.castShadow = shadow && sh;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  const mesh = (geo, mat, parent = group) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = sh;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const warm = th.night ? '#BFEFFF' : theme === 'reef' ? '#9FF3FF' : '#FFD98A';

  // ---------------------------------------------------------------- 1) Tunnel
  {
    const L = 30;
    let best = null;
    for (const lim of [0.12, 0.25, 0.4, 0.55]) {
      for (let a = 0; a < N; a += 3) {
        if (!free(a, 4, L + 4)) continue;
        let worst = 0, ok = true;
        for (let k = 0; k <= L && ok; k += 2) {
          const i = (a + k) % N, c = Math.abs(curve(i, 4));
          worst = Math.max(worst, c);
          if (c > lim || Math.abs(tr.bank[i]) > 0.2) ok = false;
        }
        for (let k = 0; k <= L && ok; k += 5) if (tr.nearestOther((a + k) % N) < 40) ok = false;
        if (ok && (!best || worst < best.worst)) best = { a, worst };
      }
      if (best) break;
    }
    if (best) {
      const a = best.a, S = 18, H = 8.6;
      mark(a, 6, L + 6);
      out.tunnels.push({ a, len: L });
      const shell = (grow, inward) => {
        const pos = [], uv = [], idx = [];
        for (let k = 0; k <= L; k++) {
          const i = (a + k) % N, p = tr.P[i], R = tr.R[i], W0 = tr.fence[i] + 0.4, W = W0 + grow;
          for (let s = 0; s <= S; s++) {
            const t = (s / S) * Math.PI, c = Math.cos(t), sn = Math.sin(t);
            const y = p.y + tr.crossOff(i, c * W0) * (1 - sn) + sn * (H + grow) - (grow ? 0.3 * (1 - sn) : 0);
            pos.push(p.x + R.x * c * W, y, p.z + R.z * c * W);
            uv.push(k / 3, s / 3);
          }
        }
        for (let k = 0; k < L; k++) for (let s = 0; s < S; s++) {
          const q = k * (S + 1) + s, w = q + S + 1;
          idx.push(q, w, q + 1, w, w + 1, q + 1);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        return orient(g, Math.floor(L / 2) * (S + 1) + S / 2, inward ? new THREE.Vector3(0, -1, 0) : UP);
      };
      // Innenseite: Ziegel-/Felsmuster
      const tex = (() => {
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const x = c.getContext('2d');
        const base = new THREE.Color(th.hills).lerp(new THREE.Color('#7A726C'), 0.78);
        x.fillStyle = '#' + base.getHexString(); x.fillRect(0, 0, 128, 128);
        x.strokeStyle = 'rgba(0,0,0,0.28)'; x.lineWidth = 4;
        for (let row = 0; row < 4; row++) {
          x.beginPath(); x.moveTo(0, row * 32); x.lineTo(128, row * 32); x.stroke();
          for (let col = 0; col < 3; col++) { const xx = col * 48 + (row % 2) * 24; x.beginPath(); x.moveTo(xx, row * 32); x.lineTo(xx, row * 32 + 32); x.stroke(); }
        }
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
        return t;
      })();
      const inner = mesh(shell(0, true), std('#FFFFFF', { map: tex, roughness: 0.95 }));
      inner.userData.keepFaces = true; // nach innen gerichtet lassen (fürs Backen)
      const outer = mesh(shell(1.4, false), std(theme === 'clouds' ? '#F4F6FF' : th.hills, { roughness: 1, flatShading: true }));
      void outer;
      // Portale an beiden Enden
      const portalMat = std(th.fence2, { roughness: 0.5 });
      for (const k of [0, L]) {
        const i = (a + k) % N, p = tr.P[i], W = tr.fence[i] + 0.4;
        const g = new THREE.TorusGeometry(1, 0.1, 8, 28, Math.PI);
        g.scale(W + 0.9, H + 0.9, 14);
        const m = mesh(g, portalMat);
        m.position.set(p.x, p.y, p.z);
        m.rotation.y = tr.headingAt(i);
      }
      // Lichtleisten an der Decke (leuchten selbst, beim Backen echte Lichter)
      const strips = [];
      for (let k = 2; k < L; k += 2) {
        const i = (a + k) % N, p = tr.P[i], R = tr.R[i], W = tr.fence[i] + 0.4, yaw = tr.headingAt(i);
        for (const t of [Math.PI / 2 - 0.45, Math.PI / 2 + 0.45]) {
          const c = Math.cos(t), sn = Math.sin(t);
          strips.push(M(p.x + R.x * c * (W - 0.2), p.y + sn * (H - 0.2), p.z + R.z * c * (W - 0.2), yaw));
        }
        if (k % 8 === 2) light(p.x, p.y + H - 1.6, p.z, warm, 900);
      }
      inst(new THREE.BoxGeometry(0.4, 0.15, 1.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(warm).multiplyScalar(2.2), toneMapped: false }), strips);
    }
  }

  // ---------------------------------------------------------------- 2) Ballonbögen über Geraden
  {
    const pal = [th.fence, th.fence2, '#FFFFFF'].map((c) => new THREE.Color(c));
    const balloons = [], cols = [], feet = [];
    let made = 0;
    const start = Math.floor(r() * N);
    for (let s = 0; s < N && made < 3; s += 5) {
      const i = (start + s) % N;
      if (!free(i, 4) || Math.abs(curve(i, 6)) > 0.25 || tr.nearestOther(i) < 45) continue;
      mark(i, Math.floor(N / 7));
      made++;
      const p = tr.P[i], R = tr.R[i], T = tr.T[i], W = tr.fence[i] + 0.6, H = 9.5, yaw = tr.headingAt(i);
      const n = 30;
      for (let k = 0; k <= n; k++) {
        const t = (k / n) * Math.PI, c = Math.cos(t), sn = Math.sin(t);
        for (const o of [-0.55, 0.55]) {
          const lat = c * W + (r() - 0.5) * 0.3;
          balloons.push(M(p.x + R.x * lat + T.x * o, p.y + tr.crossOff(i, c * W) * (1 - sn) + sn * H + 0.6, p.z + R.z * lat + T.z * o, yaw, 1, 1.18, 1));
          cols.push(pal[(k + (o > 0 ? 1 : 0)) % pal.length]);
        }
      }
      for (const sd of [-1, 1]) feet.push(M(p.x + R.x * sd * W, p.y + tr.crossOff(i, sd * W) + 0.3, p.z + R.z * sd * W, yaw));
    }
    inst(new THREE.SphereGeometry(0.62, 12, 10), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05 }), balloons, cols, true);
    inst(new THREE.CylinderGeometry(0.9, 1.1, 0.6, 12), std('#5A5560'), feet);
  }

  // ---------------------------------------------------------------- 3) Kleine Tribünen an Sprüngen und Loopings
  {
    const fanPal = ['#F4EEE4', '#C8552B', '#8C6B4F', '#F7A8C6', '#E7C79F', '#2C3350', '#A0724B', '#7A5034', '#FFD447', '#9ED36A'].map((c) => new THREE.Color(c));
    const spots = [];
    for (const j of [...tr.jumps].sort((x, y) => y.kind - x.kind)) spots.push((j.c - 4 + N) % N);
    for (const L of tr.loops || []) spots.push((L.c + 9) % N);
    for (let i = 0; i < N; i++) if (tr.hp[i] && !tr.hp[(i - 1 + N) % N]) spots.push((i + 14) % N);
    const standMat = std(th.fence2, { roughness: 0.7 }), boardMat = std(th.fence, { roughness: 0.5 });
    const taken = [];
    for (const i of spots) {
      if (out.fanSets.length >= 4) break;
      if ((tr.bridge[i] && !sky) || taken.some((t) => Math.min(Math.abs(t - i), N - Math.abs(t - i)) < 30)) continue;
      const d = tr.fence[i] + 4.5;
      let side = 0;
      for (const sd of r() < 0.5 ? [1, -1] : [-1, 1]) {
        const [x, z] = at(i, sd * d);
        if (tr.nearestDist(x, z) > d - 1 && tr.nearestDist(at(i, sd * (d + 6))[0], at(i, sd * (d + 6))[1]) > d + 4) { side = sd; break; }
      }
      if (!side) continue;
      taken.push(i);
      const p = tr.P[i], [x, z] = at(i, side * d), y = groundAt(i, side * (d - 2));
      const stand = new THREE.Group();
      for (let row = 0; row < 2; row++) {
        const h = 1.2 + row * 1.2;
        const step = mesh(new THREE.BoxGeometry(14, h, 2.4), standMat, stand);
        step.position.set(0, h / 2, row * 2.4);
      }
      const board = mesh(new THREE.BoxGeometry(14.4, 1.1, 0.3), boardMat, stand);
      board.position.set(0, 0.55, -1.35);
      if (!sky && p.y - y > 0.3) { // Sockel, wenn die Strecke höher liegt als der Boden
        const pl = mesh(new THREE.BoxGeometry(14, p.y - y, 5), standMat, stand);
        pl.position.set(0, -(p.y - y) / 2, 1.2);
      }
      for (const fx of [-7.2, 7.2]) {
        const pole = mesh(new THREE.CylinderGeometry(0.12, 0.12, 6), standMat, stand);
        pole.position.set(fx, 3, 4);
        const flag = mesh(new THREE.BoxGeometry(0.06, 1.2, 1.8), boardMat, stand);
        flag.position.set(fx, 5.3, 3.1);
      }
      const fans = [], fcols = [];
      for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) {
        fans.push({ x: -5.9 + k * 2.36 + (r() - 0.5) * 0.5, y: 1.2 + row * 1.2 + 0.8, z: row * 2.4, ph: r() * 6, sp: 6 + r() * 4 });
        fcols.push(fanPal[Math.floor(r() * fanPal.length)]);
      }
      const fm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.75, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.8 }), fans.length);
      const fe = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: '#1A1420', roughness: 0.2 }), fans.length * 2);
      fcols.forEach((c, n) => fm.setColorAt(n, c));
      fm.castShadow = sh;
      fm.frustumCulled = fe.frustumCulled = false;
      stand.add(fm, fe);
      stand.position.set(x, p.y, z);
      stand.rotation.y = tr.headingAt(i) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (sky) for (let k = 0; k < 6; k++) {
        const c = mesh(new THREE.SphereGeometry(2.4 + r() * 1.4, 12, 8), std('#FFFFFF', { roughness: 1 }), stand);
        c.position.set(-7 + k * 2.8, -1.2, 1 + (r() - 0.5) * 3);
        c.scale.y = 0.6;
      }
      group.add(stand);
      const set = { mesh: fm, eyes: fe, fans };
      animateFans(set, 0);
      out.fanSets.push(set);
    }
  }

  // ---------------------------------------------------------------- 4) Ballen an engen Kurven
  {
    const kind = { meadow: 'bale', honey: 'bale', bamboo: 'bale', glacier: 'snow', clouds: 'cushion', volcano: 'tyre', cave: 'GlowShroom', reef: 'Coral' }[theme] || 'bale';
    const list = [], cols = [];
    const pastel = ['#FFC9E0', '#BFE6FF', '#FFF1B8', '#D7C8FF'].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i += 3) {
      const c = curve(i, 8);
      if (Math.abs(c) < 0.45 || tr.island[i] || tr.bridge[i] || tr.gap[i] || tr.hp[i] || tr.launch[i]) continue;
      const lat = -(c > 0 ? 1 : -1) * (tr.fence[i] + 2.6);
      const [x, z] = at(i, lat);
      if (tr.nearestDist(x, z) < Math.abs(lat) - 0.5) continue;
      const y = groundAt(i, lat), yaw = tr.headingAt(i), T = tr.T[i];
      if (kind === 'bale') {
        for (const o of [-0.85, 0.85]) {
          list.push(M(x + T.x * o, y + 0.78, z + T.z * o, yaw));
          cols.push(new THREE.Color(theme === 'bamboo' ? '#D9B865' : '#E8C25A').offsetHSL(0, 0, (r() - 0.5) * 0.08));
        }
        if (r() < 0.45) { list.push(M(x, y + 2.25, z, yaw)); cols.push(new THREE.Color('#EFCB66')); }
      } else if (kind === 'snow') {
        for (const o of [-0.9, 0.9]) { list.push(M(x + T.x * o, y + 0.85, z + T.z * o, r() * 6)); cols.push(new THREE.Color('#F4F8FF')); }
        list.push(M(x, y + 2.2, z, 0, 0.7)); cols.push(new THREE.Color('#FFFFFF'));
      } else if (kind === 'cushion') {
        for (const o of [-1.1, 1.1]) { list.push(M(x + T.x * o, y + 0.5, z + T.z * o, yaw, 1.3, 0.7, 1.3)); cols.push(pastel[Math.floor(r() * 4)]); }
      } else if (kind === 'tyre') {
        for (const o of [-0.75, 0.75]) for (let h = 0; h < 3; h++) {
          list.push(M(x + T.x * o, y + 0.3 + h * 0.58, z + T.z * o, 0));
          cols.push(new THREE.Color(h === 2 ? th.fence2 : '#2B2629'));
        }
      } else {
        list.push(M(x, y, z, r() * 6, 1.1 + r() * 0.5));
      }
    }
    const geo = {
      bale: () => new THREE.CylinderGeometry(0.78, 0.78, 1.5, 14).rotateX(Math.PI / 2),
      snow: () => new THREE.SphereGeometry(0.95, 14, 10),
      cushion: () => new THREE.SphereGeometry(1, 14, 10),
      tyre: () => new THREE.TorusGeometry(0.55, 0.27, 8, 16).rotateX(Math.PI / 2),
    }[kind];
    if (geo) inst(geo(), std('#FFFFFF', { roughness: kind === 'snow' ? 0.6 : 0.95 }), list, cols, true);
    else group.add(instanceProps(kind, list, { shadows: sh }));
  }

  // ---------------------------------------------------------------- 5) Zweites Wahrzeichen pro Welt
  {
    let spot = null;
    for (const f of [0.45, 0.9, 0.12, 0.6, 0.33, 0.78]) {
      for (let s = 0; s < N / 8 && !spot; s += 4) {
        const i = (Math.round(f * N) + s) % N;
        if ((tr.bridge[i] && !sky) || tr.nearestOther(i) < 70) continue;
        // beim Vulkan nach aussen (innen steht der Kegel)
        const sides = th.volcano ? [1, -1].sort((u, v) => Math.hypot(...at(i, v * 30)) - Math.hypot(...at(i, u * 30))) : [1, -1];
        for (const sd of sides) {
          const d = tr.fence[i] + 26, [x, z] = at(i, sd * d);
          if (th.volcano && Math.hypot(x, z) < Math.hypot(tr.P[i].x, tr.P[i].z)) continue;
          if (tr.nearestDist(x, z) > 22) { spot = { i, sd, x, z, y: groundAt(i, sd * d) }; break; }
        }
      }
      if (spot) break;
    }
    if (spot) {
      tr._lmSpot = spot.i; tr._lmSide = spot.sd;
      const g = new THREE.Group();
      g.position.set(spot.x, spot.y, spot.z);
      g.rotation.y = tr.headingAt(spot.i) + (spot.sd > 0 ? -Math.PI / 2 : Math.PI / 2); // lokal -z schaut zur Strecke
      g.scale.setScalar({ meadow: 1.7, bamboo: 1.25, honey: 1.9, glacier: 1.7, reef: 1.25, volcano: 1.4 }[theme] || 1);
      group.add(g);
      g.updateMatrixWorld(true);
      const W = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
      const put = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const m = mesh(geo, mat, g);
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, rz);
        return m;
      };
      const glowLight = (x, y, z, color, e) => { const v = W(x, y, z); light(v.x, v.y, v.z, color, e); };
      const LM = {
        // Picknick-Platz mit Riesenapfel und Sonnenschirm
        meadow() {
          const c = document.createElement('canvas'); c.width = c.height = 64;
          const x = c.getContext('2d');
          for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { x.fillStyle = (a + b) % 2 ? '#FFFFFF' : '#D9443A'; x.fillRect(a * 8, b * 8, 8, 8); }
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
          put(new THREE.BoxGeometry(12, 0.1, 9), std('#FFFFFF', { map: t }), 0, 0.05, 0);
          put(new THREE.BoxGeometry(2.4, 1.4, 1.6), std('#B07A3C'), -3, 0.75, 1.5);
          put(new THREE.TorusGeometry(1, 0.1, 6, 16, Math.PI), std('#8A5A2B'), -3, 1.45, 1.5);
          put(new THREE.SphereGeometry(1.8, 20, 14), std('#D93A2F', { roughness: 0.35 }), 3, 1.75, -1);
          put(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), std('#5A3A1E'), 3, 3.8, -1);
          put(new THREE.SphereGeometry(0.6, 10, 6).scale(1, 0.25, 0.5), std('#6DBE45'), 3.6, 3.9, -1, 0, 0, -0.5);
          put(new THREE.CylinderGeometry(0.1, 0.1, 5.5), std('#E8E2D8'), 1, 2.75, 3);
          const cone = new THREE.ConeGeometry(4.2, 1.6, 12, 1, true);
          put(cone, std(th.fence2, { side: THREE.DoubleSide }), 1, 5.6, 3);
          put(new THREE.BoxGeometry(6, 0.3, 2.4), std('#A0724B'), -1, 1.6, -3.5);
          for (const sx of [-3.5, 1.5]) put(new THREE.BoxGeometry(0.3, 1.6, 2), std('#8C6B4F'), sx, 0.8, -3.5);
        },
        // Wasserfall mit Becken und Lampions
        bamboo() {
          put(new THREE.DodecahedronGeometry(1, 1).scale(15, 20, 9), std('#6F7A63', { flatShading: true, roughness: 1 }), 0, 9, 8);
          const c = document.createElement('canvas'); c.width = 32; c.height = 128;
          const x = c.getContext('2d');
          x.fillStyle = '#BFE8FF'; x.fillRect(0, 0, 32, 128);
          for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`; x.fillRect(Math.random() * 32, Math.random() * 128, 2, 10 + Math.random() * 20); }
          const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
          const fall = put(new THREE.PlaneGeometry(6, 19), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.9 }), 0, 9.5, -2.4, -0.12, Math.PI, 0);
          fall.castShadow = false;
          out.scroll.push({ tex: t, speed: -1.4 });
          put(new THREE.CircleGeometry(8, 28).rotateX(-Math.PI / 2), std('#4FA9C9', { roughness: 0.08, metalness: 0.1 }), 0, 0.12, -4);
          put(new THREE.TorusGeometry(8, 0.9, 6, 28).rotateX(Math.PI / 2), std('#7E8A72', { flatShading: true }), 0, 0.2, -4);
          const mist = W(0, 1, -1.5);
          out.vents.push({ p: mist, rate: 10, spread: 4, up: 1.6, color: '#F2FBFF', size: 1.4, life: 2.2 });
          for (const lx of [-9, 9]) {
            put(new THREE.CylinderGeometry(0.12, 0.12, 5), std('#3B2A22'), lx, 2.5, -6);
            put(new THREE.SphereGeometry(0.7, 12, 10).scale(1, 1.25, 1), std('#E8402A', { emissive: '#FF5A2A', emissiveIntensity: 1.2 }), lx, 5.4, -6);
            glowLight(lx, 5.4, -6, '#FF8A4A', 450);
          }
        },
        // Riesenpilz-Kathedrale mit leuchtenden Kristallen
        cave() {
          put(new THREE.CylinderGeometry(2.6, 3.6, 15, 16), std('#EADFCB'), 0, 7.5, 4);
          put(new THREE.SphereGeometry(13, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), std('#B9478A', { roughness: 0.6 }), 0, 14.5, 4);
          const under = put(new THREE.CircleGeometry(13, 28).rotateX(Math.PI / 2), std('#F2D8C9', { roughness: 0.9 }), 0, 14.45, 4);
          under.userData.keepFaces = true;
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2, rr = 8 + r() * 4;
            put(new THREE.SphereGeometry(1, 10, 8).scale(1.6, 0.4, 1.6), std('#FFF4F8'), Math.cos(a) * rr, 14.8 + (1 - rr / 13) * 6, 4 + Math.sin(a) * rr);
          }
          const crys = std('#7FE6FF', { emissive: '#4FD8FF', emissiveIntensity: 1.1, roughness: 0.2 });
          for (let k = 0; k < 8; k++) {
            const cx = -9 + r() * 18, cz = -6 + r() * 4, h = 3 + r() * 6;
            put(new THREE.OctahedronGeometry(1).scale(1.1, h, 1.1), crys, cx, h * 0.8, cz, (r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
            if (k % 3 === 0) glowLight(cx, h + 1, cz - 1, '#6FE0FF', 700);
          }
        },
        // Bienenstock-Turm mit Rohren und Kessel
        honey() {
          for (let k = 0; k < 7; k++) {
            const rr = 6 - k * 0.55 - (k > 4 ? (k - 4) * 0.9 : 0);
            put(new THREE.CylinderGeometry(rr - 0.3, rr, 2.4, 24), std(k % 2 ? '#C98A2A' : '#E0A63A', { roughness: 0.9 }), 0, 1.2 + k * 2.4, 2);
          }
          put(new THREE.SphereGeometry(2.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), std('#E0A63A'), 0, 16.8, 2);
          put(new THREE.CircleGeometry(1.4, 18), std('#2A1A10', { roughness: 1 }), 0, 1.6, 2 - 6.02, 0, Math.PI, 0);
          const cu = std('#B5652F', { metalness: 0.6, roughness: 0.35 });
          put(new THREE.SphereGeometry(3, 20, 14), cu, 11, 4.2, 0);
          for (const [lx, lz] of [[9, -2], [13, -2], [11, 2]]) put(new THREE.CylinderGeometry(0.25, 0.25, 2), cu, lx, 1, lz);
          put(new THREE.CylinderGeometry(0.55, 0.55, 7, 12), cu, 6, 7.5, 0.6, 0, 0, Math.PI / 2);
          put(new THREE.CylinderGeometry(0.55, 0.55, 4, 12), cu, 9.3, 9.2, 0.6);
          put(new THREE.TorusGeometry(0.9, 0.55, 8, 12, Math.PI / 2), cu, 8.4, 11.1, 0.6, 0, 0, 0);
          out.vents.push({ p: W(11, 7.4, 0), rate: 7, spread: 0.8, up: 3, color: '#FFF3D6', size: 1.6, life: 2.6 });
        },
        // Forschungsstation mit Kuppel, Antenne und Eisbögen
        glacier() {
          put(new THREE.BoxGeometry(9, 4, 6), std('#F2F2F2', { roughness: 0.5 }), -3, 2, 2);
          put(new THREE.BoxGeometry(9.1, 0.7, 6.1), std('#D9443A'), -3, 3.2, 2);
          const win = std('#FFE7A0', { emissive: '#FFD27A', emissiveIntensity: 1.2 });
          for (const wx of [-6, -3, 0]) put(new THREE.BoxGeometry(1.2, 1, 0.1), win, wx, 2, -1.03);
          glowLight(-3, 2, -2.5, '#FFD27A', 300);
          put(new THREE.SphereGeometry(3.6, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), std('#E6EEF5', { roughness: 0.35 }), 5, 0, 2);
          put(new THREE.CylinderGeometry(0.12, 0.18, 11), std('#9AA3AD'), -6, 9.5, 3);
          put(new THREE.SphereGeometry(0.45, 10, 8), std('#FF3B30', { emissive: '#FF3B30', emissiveIntensity: 2 }), -6, 15.2, 3);
          const ice = std('#BFE9FF', { roughness: 0.12, metalness: 0.05 });
          for (const [ax, rad] of [[-14, 6], [13, 7.5], [0, 10]]) put(new THREE.TorusGeometry(rad, 0.9, 8, 24, Math.PI), ice, ax, 0, ax === 0 ? 12 : 6, 0, 0.6 * Math.sign(ax || 1), 0);
        },
        // Versunkenes Schiff und Leuchtquallen
        reef() {
          const ship = new THREE.Group();
          ship.position.set(0, -0.6, 4);
          ship.rotation.set(0, 0.35, 0.22);
          g.add(ship);
          const wood = std('#6B4A32', { roughness: 0.95 });
          const hull = mesh(new THREE.BoxGeometry(18, 5, 6.5), wood, ship); hull.position.set(0, 2.5, 0);
          const bow = mesh(new THREE.CylinderGeometry(0.2, 3.25, 6, 4, 1).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4), wood, ship); bow.position.set(12, 2.5, 0); bow.scale.set(1, 0.75, 1);
          const deck = mesh(new THREE.BoxGeometry(17, 0.4, 6), std('#8A6A48'), ship); deck.position.set(0, 5.1, 0);
          const cabin = mesh(new THREE.BoxGeometry(5, 3, 5), wood, ship); cabin.position.set(-5, 6.8, 0);
          const mast = mesh(new THREE.CylinderGeometry(0.4, 0.5, 10), std('#5A3E2A'), ship); mast.position.set(2, 10, 0); mast.rotation.z = 0.15;
          const broken = put(new THREE.CylinderGeometry(0.35, 0.4, 9), std('#5A3E2A'), -10, 0.5, -4, 0, 0.4, Math.PI / 2 - 0.1);
          void broken;
          put(new THREE.BoxGeometry(1.6, 1.1, 1.1), std('#E8B83A', { emissive: '#FFC94A', emissiveIntensity: 0.8, metalness: 0.5 }), 8, 0.55, -5);
          glowLight(8, 2, -5.5, '#FFC94A', 250);
          const jelly = std('#FF8AD8', { emissive: '#FF6ACB', emissiveIntensity: 1.4, roughness: 0.3 });
          for (const [jx, jy, jz] of [[-8, 11, -4], [6, 14, -2], [14, 9, 4]]) {
            put(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), jelly, jx, jy, jz);
            for (let k = 0; k < 5; k++) put(new THREE.CylinderGeometry(0.06, 0.03, 3), jelly, jx + Math.cos(k * 1.26) * 0.9, jy - 1.5, jz + Math.sin(k * 1.26) * 0.9);
            glowLight(jx, jy - 1, jz, '#FF7AD0', 500);
          }
        },
        // Regenbogenbrücke zwischen zwei Wolken
        clouds() {
          const cols = ['#FF5A5A', '#FF9F43', '#FFD447', '#6BD66B', '#4FA9FF', '#9B6BFF'];
          cols.forEach((c, k) => put(new THREE.TorusGeometry(24 - k * 1.3, 0.68, 8, 48, Math.PI), std(c, { emissive: c, emissiveIntensity: 0.25, roughness: 0.5 }), 0, -2, 6));
          const cl = std('#FFFFFF', { roughness: 1 });
          for (const sx of [-21, 21]) for (let k = 0; k < 5; k++) put(new THREE.SphereGeometry(3 + r() * 2.5, 14, 10), cl, sx + (r() - 0.5) * 7, r() * 2, 6 + (r() - 0.5) * 5);
        },
        // Dampfschlote mit glühenden Öffnungen
        volcano() {
          const rock = std('#3A2C2E', { flatShading: true, roughness: 1 });
          const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#FF6A1A').multiplyScalar(1.6), toneMapped: false });
          for (const [vx, vz, h] of [[-8, 2, 5], [0, 6, 7.5], [8, 0, 4.2], [3, -4, 3.2]]) {
            put(new THREE.CylinderGeometry(1.1, 3.4, h, 8, 1, true), rock, vx, h / 2, vz);
            const top = put(new THREE.CircleGeometry(1.1, 10).rotateX(-Math.PI / 2), glow, vx, h - 0.15, vz);
            top.castShadow = false;
            glowLight(vx, h + 0.8, vz, '#FF7A2A', 600);
            out.vents.push({ p: W(vx, h, vz), rate: 6, spread: 0.6, up: 4, color: '#BDB4B0', size: 2, life: 3 });
          }
        },
      };
      (LM[theme] || LM.meadow)();
    }
  }

  // ---------------------------------------------------------------- 6) Lampions: Lichterketten über der Strecke
  if (th.night || th.volcano || theme === 'bamboo' || theme === 'reef') {
    const lanterns = [], cols = [], ropes = [];
    const pal = (theme === 'cave' ? ['#7FE6FF', '#C88CFF', '#7BFFB0'] : theme === 'reef' ? ['#7FE6FF', '#FF8AD8', '#FFF1A0'] : ['#FF5A3A', '#FFB03A', '#FFE07A']).map((c) => new THREE.Color(c));
    for (let i = 30; i < N - 10; i += 52) {
      if (!free(i, 2) || tr.nearestOther(i) < 40) continue;
      const p = tr.P[i], R = tr.R[i], W = tr.fence[i] + 0.5, yaw = tr.headingAt(i);
      ropes.push(M(p.x, p.y + 7.4, p.z, yaw + Math.PI / 2, W * 2, 1, 1));
      const n = Math.floor(W * 2 / 2.2);
      for (let k = 0; k <= n; k++) {
        const l = -W + (k / n) * W * 2, sag = 1.1 * (1 - (l / W) ** 2);
        lanterns.push(M(p.x + R.x * l, p.y + 6.6 - sag, p.z + R.z * l, yaw, 1, 1.3, 1));
        cols.push(pal[k % pal.length].clone().multiplyScalar(1.8));
      }
      light(p.x, p.y + 5.6, p.z, '#' + pal[0].getHexString(), 1400);
    }
    inst(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), lanterns, cols);
    inst(new THREE.BoxGeometry(1, 0.05, 0.05), std('#2A2228'), ropes);
  }
  out.landmarkAt = tr._lmSpot ?? null;
  return out;
}
