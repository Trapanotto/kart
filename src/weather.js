// Wetter und Ereignisse pro Welt: jede Strecke fährt sich bei jedem Rennen ein wenig anders.
//   Kleeblatt-Wiese    Pollenwind: Böen versetzen leichte Karts stärker als schwere
//   Bambuswald-Tempel  Regenschauer: Pfützen mit Aquaplaning
//   Pilzhöhlen         Leuchtpilz-Flackern: die Höhle wird kurz dunkel
//   Honigfabrik        Honigflut: ein Rohr bricht, Honig sperrt eine Spurhälfte
//   Gletscher-Gipfel   Blizzard: Sicht sinkt, Eisplatten (Pingo behält Grip)
//   Korallenriff       Strömung: zieht unter Wasser zur Seite
//   Wolkenschloss      Gewitter: Seitenwind auf den Brücken, Blitze
//   Dschungel-Vulkan   Lavastrom: sperrt eine Kurvenhälfte, Ascheregen
// Zonen liegen in Streckenkoordinaten (Stützpunkt i0, Länge, seitlich d0..d1).
import * as THREE from 'three';
import { underwater } from './features.js';

const RAIN_FOG = new THREE.Color('#9AA6A2');
const rand = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _v = new THREE.Vector3();

export class Weather {
  constructor(race) {
    this.race = race;
    this.tr = race.track;
    this.theme = race.def.theme;
    this.r = rand(Math.floor(Math.random() * 1e9));
    this.group = new THREE.Group();
    race.scene.add(this.group);
    this.zones = [];
    this.t = 0;
    this.gust = 0; this.gustDir = 1; this.gustT = 0; this.nextGust = 6 + this.r() * 6;
    this.rain = 0; this.storm = 0; this.dark = 0; this.flash = 0; this.current = 0;
    this.base = { hemi: race.hemi.intensity, sun: race.sun.intensity };
    const N = this.tr.N;
    this.zoneAt = new Array(N).fill(null);
    const k = this.theme;
    if (k === 'bamboo') { this.place('puddle', 9, 6, 10); this.rainOn = true; }
    if (k === 'glacier') { this.place('ice', 6, 10, 18); this.stormAt = 15 + this.r() * 25; this.stormEnd = this.stormAt + 20 + this.r() * 10; }
    if (k === 'honey') this.planFlow('honey');
    if (k === 'volcano') this.planFlow('lava');
    if (k === 'cave') this.nextDark = 14 + this.r() * 10;
    if (k === 'clouds') this.nextFlash = 5 + this.r() * 5;
    for (const z of this.zones) this.buildZone(z);
    if (this.rainOn) this.buildRain();
  }

  // freie Stellen: keine Lücken, Rampen, Loopings, Gabelungen, nicht am Start
  okAt(i) {
    const tr = this.tr;
    return !tr.gap[i] && !tr.launch[i] && !(tr.island[i] > 0) && !(tr.hp[i] > 0) && !(tr.crumble && tr.crumble[i]) && i > 40 && i < tr.N - 30;
  }

  place(type, count, lmin, lmax) {
    const tr = this.tr, N = tr.N;
    for (let n = 0, tries = 0; n < count && tries < 400; tries++) {
      const len = Math.round(lmin + this.r() * (lmax - lmin)); // Stützpunkte (je 2 m)
      const i0 = Math.floor(this.r() * N);
      let ok = true;
      for (let k = -12; k < len + 12 && ok; k++) { const i = (i0 + k + N) % N; if (!this.okAt(i) || this.zoneAt[i]) ok = false; }
      if (!ok) continue;
      const hw = tr.hw[i0], pick = this.r();
      const d0 = pick < 0.4 ? -hw + 0.6 : pick < 0.8 ? 0.6 : -3;
      const d1 = pick < 0.4 ? -0.6 : pick < 0.8 ? hw - 0.6 : 3;
      const z = { type, i0, len, d0, d1, grow: 1 };
      for (let k = 0; k < len; k++) this.zoneAt[(i0 + k) % N] = z;
      this.zones.push(z);
      n++;
    }
  }

  // Honigflut / Lavastrom: erscheint im Rennen in einer Kurve auf einer Spurhälfte
  planFlow(type) {
    const tr = this.tr, N = tr.N;
    const corners = [];
    for (let i = 60; i < N - 40; i += 2) {
      if (!this.okAt(i)) continue;
      const a = tr.T[i], b = tr.T[(i + 14) % N];
      corners.push([i, Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z))]);
    }
    if (!corners.length) return;
    // die engeren Kurven bevorzugen (auch weiche Spiralen haben dann eine passende Stelle)
    corners.sort((p, q) => q[1] - p[1]);
    corners.splice(Math.max(6, Math.floor(corners.length * 0.25)));
    for (let c = 0; c < corners.length; c++) corners[c] = corners[c][0];
    const i = corners[Math.floor(this.r() * corners.length)];
    const side = this.r() < 0.5 ? 1 : -1;
    const hw = tr.hw[i];
    const z = { type, i0: (i - 8 + N) % N, len: 22, d0: side > 0 ? 0.4 : -hw - 0.5, d1: side > 0 ? hw + 0.5 : -0.4, at: 18 + this.r() * 22, grow: 0, side };
    for (let k = 0; k < z.len; k++) this.zoneAt[(z.i0 + k) % N] = z;
    this.zones.push(z);
    this.flow = z;
  }

  buildZone(z) {
    const tr = this.tr, N = tr.N;
    const pos = [], idx = [], uv = [];
    for (let k = 0; k <= z.len; k++) {
      const i = (z.i0 + k) % N;
      for (const d of [z.d0, z.d1]) { tr.pointAt(i, d, _p); pos.push(_p.x, _p.y + (z.type === 'lava' || z.type === 'honey' ? 0.09 : 0.05), _p.z); }
      uv.push(0, k * 0.15, 1, k * 0.15);
      if (k < z.len) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    let mat;
    const common = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide };
    if (z.type === 'puddle') mat = new THREE.MeshStandardMaterial({ ...common, color: '#4C6A64', roughness: 0.04, metalness: 0, opacity: 0.75, envMapIntensity: 2 });
    else if (z.type === 'ice') { const t = sparkle(); mat = new THREE.MeshStandardMaterial({ ...common, color: '#D6EEFF', roughness: 0.05, opacity: 0.8, map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 0.9 }); }
    else if (z.type === 'honey') { this.tex = blobs('#FFC233', '#B8650A'); mat = new THREE.MeshStandardMaterial({ ...common, color: '#FFB020', roughness: 0.15, opacity: 0.92, map: this.tex, emissive: '#5A2A00', emissiveIntensity: 0.4 }); }
    else { this.tex = blobs('#FFD25A', '#FF4A10'); mat = new THREE.MeshStandardMaterial({ ...common, color: '#220800', roughness: 0.7, opacity: 1, map: this.tex, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 2.4 }); }
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    z.mesh = m; z.count = idx.length;
    if (z.grow < 1) g.setDrawRange(0, 0);
    this.group.add(m);
  }

  buildRain() {
    const n = 2500;
    this.rp = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) this.rp[i] = (Math.random() - 0.5) * 60;
    this.rl = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rl, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#7F96A8', transparent: true, opacity: 0.5, depthWrite: false }));
    this.rainMesh.frustumCulled = false;
    this.rainN = n;
    this.group.add(this.rainMesh);
  }

  say(text, dur = 2) { if (this.race.mode !== 'demo') this.race.humans.forEach((k) => this.race.hud.message(k.human, text, dur)); }

  update(dt) {
    const race = this.race, time = race.time, racing = race.state === 'race';
    this.t += dt;
    const k = this.theme;
    // Böen: Wiese immer, Wolkenschloss bei Gewitter
    if (k === 'meadow' || k === 'clouds') {
      this.nextGust -= dt;
      if (this.nextGust <= 0 && this.gustT <= 0 && racing) {
        this.gustT = 3; this.gustDir = this.r() < 0.5 ? -1 : 1; this.nextGust = 8 + this.r() * 8;
        this.say(this.gustDir > 0 ? '🌬️ Windböe →' : '← Windböe 🌬️', 1.5);
      }
      if (this.gustT > 0) { this.gustT -= dt; this.gust = Math.sin(Math.PI * (1 - this.gustT / 3)); } else this.gust = 0;
    }
    // Regen kommt und geht
    if (this.rainOn) {
      const s = 0.5 + 0.5 * Math.sin(this.t / 18 + 1) * Math.sin(this.t / 7.3);
      this.rain = Math.min(1, 0.3 + 0.9 * s);
      if (this.rain > 0.75 && !this.heavy && racing) { this.heavy = true; this.say('🌧️ Starkregen – Pfützen!', 1.8); }
      if (this.rain < 0.55) this.heavy = false;
      // trueber und dunkler bei starkem Regen
      const th = race.theme, rr = this.rain;
      race.fogOverride = { near: th.fogNear * (1 - 0.55 * rr), far: th.fogFar * (1 - 0.5 * rr), color: '#' + new THREE.Color(th.fog).lerp(RAIN_FOG, rr * 0.6).getHexString() };
      race.hemi.intensity = this.base.hemi * (1 - 0.25 * rr);
      race.sun.intensity = this.base.sun * (1 - 0.5 * rr);
    }
    // Blizzard
    if (this.stormAt !== undefined) {
      const on = time > this.stormAt && time < this.stormEnd ? 1 : 0;
      if (on && !this.stormOn) { this.stormOn = true; if (racing) this.say('❄️ Blizzard!', 1.8); }
      if (!on && this.stormOn) this.stormOn = false;
      this.storm += (on - this.storm) * Math.min(1, dt * 0.5);
      race.fogOverride = this.storm > 0.02 ? { near: 30 + (race.theme.fogNear - 30) * (1 - this.storm), far: 140 + (race.theme.fogFar - 140) * (1 - this.storm), color: race.theme.fog } : null;
    }
    // Höhle: Leuchtpilze flackern, kurz wird es dunkel
    if (this.nextDark !== undefined) {
      this.nextDark -= dt;
      if (this.nextDark <= 0 && racing) { this.darkT = 4; this.nextDark = 16 + this.r() * 12; this.say('🍄 Das Licht flackert!', 1.6); }
      if (this.darkT > 0) this.darkT -= dt;
      const target = this.darkT > 0 ? (Math.sin(this.t * 23) > 0.6 ? 0.55 : 0.12) : 1;
      this.dark += (target - this.dark) * Math.min(1, dt * 8);
      race.hemi.intensity = this.base.hemi * this.dark;
      race.sun.intensity = this.base.sun * this.dark;
    }
    // Gewitterblitze
    if (this.nextFlash !== undefined) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 6 + this.r() * 8; }
      this.flash = Math.max(0, this.flash - dt * 4);
      race.hemi.intensity = this.base.hemi * (1 + this.flash * 2.5);
    }
    // Flut / Lava wächst
    const z = this.flow;
    if (z && time > z.at && z.grow < 1) {
      if (z.grow === 0 && racing) this.say(z.type === 'lava' ? '🌋 Lavastrom! Spur gesperrt' : '🍯 Honigflut! Spur gesperrt', 2);
      z.grow = Math.min(1, z.grow + dt / 3);
      z.mesh.geometry.setDrawRange(0, Math.floor((z.count * z.grow) / 6) * 6);
    }
    if (this.tex) { this.tex.offset.y -= dt * 0.04; this.tex.offset.x = Math.sin(this.t * 0.4) * 0.02; }
    this.updateParticles(dt);
  }

  updateParticles(dt) {
    const race = this.race, focus = race.humans[0] || race.karts[0];
    if (!focus || !race.fxOn) return;
    const c = focus.pos;
    // Böen: Schlieren quer über die Strecke
    if (this.gust > 0.3) for (let n = 0; n < 4; n++) {
      _p.set(c.x + (Math.random() - 0.5) * 50, c.y + 0.5 + Math.random() * 5, c.z + (Math.random() - 0.5) * 50);
      const R = this.tr.R[focus.trackIdx];
      _v.set(R.x * this.gustDir * 22, 0.3, R.z * this.gustDir * 22);
      race.fx.soft.emit(_p, _v, this.theme === 'meadow' ? '#FFF3B0' : '#FFFFFF', 0.18, 0.9);
    }
    // Strömung im Riff: Bläschen ziehen zur Seite
    if (this.theme === 'reef' && underwater(this.tr, c)) for (let n = 0; n < 2; n++) {
      const R = this.tr.R[focus.trackIdx];
      _p.set(c.x + (Math.random() - 0.5) * 30, c.y + Math.random() * 4, c.z + (Math.random() - 0.5) * 30);
      _v.set(R.x * this.current * 6, 1, R.z * this.current * 6);
      race.fx.soft.emit(_p, _v, '#CFF6FF', 0.3, 2);
    }
    // Ascheregen bei Lava
    if (this.flow && this.flow.type === 'lava' && this.flow.grow > 0) {
      _p.set(c.x + (Math.random() - 0.5) * 60, c.y + 15, c.z + (Math.random() - 0.5) * 60);
      race.fx.soft.emit(_p, _v.set(0.5, -3, 0), '#3A3034', 0.3, 6);
    }
    // Regenstreifen um Spieler 1
    if (this.rainMesh) {
      const vis = Math.floor(this.rainN * this.rain), p = this.rp, l = this.rl;
      for (let i = 0; i < vis; i++) {
        const j = i * 3;
        p[j + 1] -= 22 * dt;
        if (p[j + 1] < -8) p[j + 1] += 36;
        const x = c.x + p[j], y = c.y + p[j + 1], z = c.z + p[j + 2];
        l.set([x, y, z, x - 0.08, y + 1.6, z], i * 6);
      }
      this.rainMesh.geometry.setDrawRange(0, vis * 2);
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
      this.rainMesh.material.opacity = 0.3 + this.rain * 0.35;
    }
  }

  zoneHit(kart) {
    const z = this.zoneAt[kart.loc.i];
    if (!z || !kart.grounded || kart.loc.lat < z.d0 || kart.loc.lat > z.d1) return null;
    if (z.grow < 1 && (kart.loc.i - z.i0 + this.tr.N) % this.tr.N > z.len * z.grow) return null;
    return z;
  }

  // vor jedem Physikschritt: Grip, Bremswirkung, Seitenwind pro Kart
  apply(k) {
    let grip = 1, slow = 0, wind = 0;
    k.surface = null;
    const z = this.zoneHit(k);
    if (this.rainOn) grip *= 1 - 0.05 * this.rain;
    if (z) {
      k.surface = z.type;
      if (z.type === 'puddle') grip *= this.rain > 0.45 ? 0.5 : 0.85;
      if (z.type === 'ice' && !k.char.iceGrip) grip *= 0.45;
      if (z.type === 'honey') slow = 0.5 * (1.15 - k.st.mass * 0.15);
      if (z.type === 'lava') slow = 0.55 * (1.15 - k.st.mass * 0.15);
    }
    if (this.storm > 0.3 && !k.char.iceGrip) grip *= 1 - 0.1 * this.storm;
    if (this.gust > 0) {
      const onBridge = this.theme !== 'clouds' || this.tr.bridge[k.loc.i];
      if (onBridge) wind = (this.gustDir * this.gust * (this.theme === 'clouds' ? 5 : 3.5)) / k.st.mass;
    }
    if (this.theme === 'reef') {
      this.current = Math.sin(this.t / 6);
      if (k.uw) wind += this.current * 2.2 / k.st.mass;
    }
    k.envGrip = grip; k.envSlow = slow; k.envWind = wind;
  }

  // für die KI: gesperrte Spurhälfte voraus
  hazardAhead(i, ahead) {
    const z = this.flow;
    if (!z || z.grow <= 0) return null;
    const N = this.tr.N, d = (z.i0 - i + N) % N;
    return d < ahead || (i - z.i0 + N) % N < z.len ? z : null;
  }

  dispose() {
    this.race.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

function sparkle() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
  for (let k = 0; k < 90; k++) { const v = 150 + Math.random() * 105; g.fillStyle = `rgb(${v},${v},255)`; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blobs(light, dark) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = dark; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 70; k++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 8 + Math.random() * 28;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, light); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
