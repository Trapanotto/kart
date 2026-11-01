// Item-Boxen, Item-Würfeln und alle Item-Effekte
import * as THREE from 'three';
import { ITEMS, itemWeights, ROAD_HALF } from './data.js';
import { FENCE } from './track.js';

const _v = new THREE.Vector3();

function emojiTexture(emoji, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.font = `${size * 0.72}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// kleine Modelle für Items
function makeAcorn() {
  const g = new THREE.Group();
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: '#B5733A', roughness: 0.4 }));
  nut.scale.set(1, 1.25, 1);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6B4A2E', roughness: 0.9 }));
  cap.position.y = 0.18;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.25), cap.material);
  stem.position.y = 0.6;
  g.add(nut, cap, stem);
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
function makeYarn() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#FF7BAC', roughness: 0.9 });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 14), mat));
  const lm = new THREE.MeshStandardMaterial({ color: '#E2558C', roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 6, 30), lm);
    t.rotation.set(i * 0.8, i * 1.3, 0);
    g.add(t);
  }
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
function makePuddle() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), new THREE.MeshStandardMaterial({ color: '#F2A93B', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.92 }));
  m.rotation.x = -Math.PI / 2;
  const g = new THREE.Group();
  g.add(m);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), m.material);
    const a = (i / 5) * Math.PI * 2;
    b.position.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6);
    b.scale.set(1, 0.15, 1);
    g.add(b);
  }
  return g;
}
function makeCloud() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#6E7790', roughness: 1 });
  for (const [x, y, s] of [[0, 0, 0.6], [0.55, -0.1, 0.45], [-0.55, -0.1, 0.48], [0.2, 0.3, 0.42]]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), mat);
    m.position.set(x, y, 0);
    g.add(m);
  }
  const bolt = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 4), new THREE.MeshBasicMaterial({ color: '#FFE36A', toneMapped: false }));
  bolt.position.y = -0.6;
  bolt.rotation.z = Math.PI;
  g.add(bolt);
  return g;
}

export class ItemManager {
  constructor(race) {
    this.race = race;
    this.boxes = [];
    this.ents = [];
    this.group = new THREE.Group();
    race.scene.add(this.group);
    this.boxMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.15, transparent: true, opacity: 0.55, iridescence: 1, iridescenceIOR: 1.6, emissive: '#6644ff', emissiveIntensity: 0.15 });
    this.pawMat = new THREE.SpriteMaterial({ map: emojiTexture('🐾'), depthWrite: false });
    this.bubbleMat = new THREE.MeshPhysicalMaterial({ color: '#BFF2FF', roughness: 0.05, transparent: true, opacity: 0.3, iridescence: 1, depthWrite: false });
    this.zzzMat = new THREE.SpriteMaterial({ map: emojiTexture('💤'), depthWrite: false });
    if (race.mode !== 'tt') this.buildBoxes();
    this.buildPads();
    this.buildPuddles();
  }

  buildBoxes() {
    const tr = this.race.track;
    const geo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
    for (const f of tr.def.items || []) {
      const i = Math.round(f * tr.N);
      for (let k = -2; k <= 2; k++) {
        const pos = tr.pointAt(i, k * 3.4);
        pos.y += 1.4 + tr.bump[i];
        const mesh = new THREE.Mesh(geo, this.boxMat);
        const paw = new THREE.Sprite(this.pawMat);
        paw.scale.setScalar(0.9);
        mesh.add(paw);
        mesh.position.copy(pos);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ pos, mesh, respawn: 0, phase: Math.random() * 6 });
      }
    }
  }

  buildPads() {
    const tr = this.race.track;
    this.pads = [];
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFB020';
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#FFF4B0';
    for (let y = 0; y < 128; y += 64) {
      ctx.beginPath();
      ctx.moveTo(6, y + 50); ctx.lineTo(32, y + 14); ctx.lineTo(58, y + 50); ctx.lineTo(58, y + 62); ctx.lineTo(32, y + 28); ctx.lineTo(6, y + 62);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.padTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    for (const [f, lat] of tr.def.pads || []) {
      const i = Math.round(f * tr.N);
      const pos = tr.pointAt(i, lat * ROAD_HALF);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 8), mat);
      m.rotation.order = 'YXZ';
      m.rotation.y = tr.headingAt(i);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pos.x, pos.y + 0.07 + tr.bump[i], pos.z);
      this.group.add(m);
      this.pads.push({ i, lat: lat * ROAD_HALF });
    }
  }

  buildPuddles() {
    const tr = this.race.track;
    for (const [f, lat] of tr.def.puddles || []) {
      const i = Math.round(f * tr.N);
      const pos = tr.pointAt(i, lat * ROAD_HALF);
      pos.y += 0.06;
      const mesh = makePuddle();
      mesh.scale.setScalar(1.4);
      mesh.position.copy(pos);
      this.group.add(mesh);
      this.ents.push({ type: 'honey', pos, mesh, life: Infinity, owner: null, permanent: true, r: 2.6 });
    }
  }

  roll(kart) {
    const n = this.race.karts.length;
    const r = n > 1 ? (kart.rank - 1) / (n - 1) : 0.5;
    const w = itemWeights(r);
    if (this.race.karts.some((k) => k.cloud > 0)) w.cloud = 0;
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (const [id, v] of Object.entries(w)) if ((x -= v) <= 0) return id;
    return 'carrot';
  }

  update(dt) {
    const race = this.race;
    const t = race.time;
    this.padTex.offset.y -= dt * 2;
    // Boxen
    for (const b of this.boxes) {
      if (b.respawn > 0) {
        b.respawn -= dt;
        b.mesh.visible = b.respawn <= 0;
        if (b.respawn <= 0) b.mesh.scale.setScalar(0.1);
        continue;
      }
      b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + dt * 3));
      b.mesh.rotation.set(t * 0.8 + b.phase, t * 1.1 + b.phase, 0);
      b.mesh.position.y = b.pos.y + Math.sin(t * 2 + b.phase) * 0.2;
      for (const k of race.karts) {
        if (k.pos.distanceToSquared(b.mesh.position) < 4.4) {
          b.respawn = 2.2;
          b.mesh.visible = false;
          race.burst(b.mesh.position, '#FFFFFF', 12);
          if (!k.item && k.rolling <= 0 && k.cloud <= 0) {
            k.rolling = 1.3;
            if (k.human !== null) race.audio.itemBox();
          }
          break;
        }
      }
    }
    // Würfeln
    for (const k of race.karts) {
      if (k.rolling > 0) {
        k.rolling -= dt;
        if (k.rolling <= 0) {
          const id = this.roll(k);
          if (id === 'cloud') {
            this.attachCloud(k);
          } else {
            k.item = id;
            k.itemCount = ITEMS[id].count || 1;
            if (k.human !== null) race.audio.itemGet();
          }
        }
      }
      // Boost-Felder
      if (k.grounded) for (const p of this.pads) {
        const di = Math.abs(k.loc.i - p.i);
        if ((di < 3 || di > race.track.N - 3) && Math.abs(k.loc.lat - p.lat) < 2.6) { k.boost(1.0, 1); break; }
      }
      // Item benutzen
      const press = k.input.item && !k.prevItem;
      k.prevItem = k.input.item;
      if (press && k.item && race.state === 'race' && k.stun <= 0 && !k.finished) this.use(k);
      // Schild / Wolke Darstellung
      this.decorate(k);
    }
    // Objekte
    for (let i = this.ents.length - 1; i >= 0; i--) {
      const e = this.ents[i];
      e.life -= dt;
      e.age = (e.age || 0) + dt;
      if (e.life <= 0 || this[e.type + 'Update']?.(e, dt) === false) this.remove(i);
    }
  }

  remove(i) {
    const e = this.ents[i];
    this.group.remove(e.mesh);
    this.ents.splice(i, 1);
  }

  use(k) {
    const race = this.race;
    const id = k.item;
    k.itemCount--;
    if (k.itemCount <= 0) k.item = null;
    const f = k.forward.clone();
    const back = k.input.back;
    switch (id) {
      case 'acorn': {
        const dir = back ? f.clone().negate() : f;
        const pos = k.pos.clone().addScaledVector(dir, 2.6);
        pos.y += 0.7;
        const mesh = makeAcorn();
        mesh.position.copy(pos);
        this.group.add(mesh);
        const speed = Math.max(55, k.speed + 30);
        this.ents.push({ type: 'acorn', pos, vel: dir.multiplyScalar(back ? 35 : speed), mesh, life: 5, owner: k, bounces: 0, idx: k.trackIdx });
        race.audio.throw(k);
        break;
      }
      case 'honey': {
        const pos = k.pos.clone().addScaledVector(f, -3.2);
        race.track.locate(pos, k.trackIdx, _locTmp);
        pos.y = _locTmp.y + 0.06;
        const mesh = makePuddle();
        mesh.position.copy(pos);
        this.group.add(mesh);
        this.ents.push({ type: 'honey', pos, mesh, life: 40, owner: k, r: 2.2 });
        race.audio.drop(k);
        break;
      }
      case 'yarn': {
        const pos = k.pos.clone().addScaledVector(f, 2.6);
        const mesh = makeYarn();
        mesh.position.copy(pos);
        this.group.add(mesh);
        const target = race.ranked.find((o) => o.rank === k.rank - 1) || null;
        this.ents.push({ type: 'yarn', pos, mesh, life: 14, owner: k, target, idx: k.trackIdx + 2, lat: k.loc.lat, speed: Math.max(48, k.speed + 18) });
        race.audio.throw(k);
        break;
      }
      case 'bubble':
        k.shield = 14;
        race.audio.shield(k);
        break;
      case 'carrot':
      case 'carrot3':
        k.boost(1.25, 2);
        race.burst(k.pos, '#FF8A2B', 10, true);
        break;
      case 'yawn': {
        for (const o of race.karts) {
          if (o !== k && o.rank < k.rank && !o.finished) {
            if (o.shield > 0) { o.shield = 0; continue; }
            o.drowsy = 3;
            o.drift.on = false;
          }
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 8, 48), new THREE.MeshBasicMaterial({ color: '#B6A6FF', transparent: true, opacity: 0.8 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(k.pos).add(new THREE.Vector3(0, 1, 0));
        this.group.add(ring);
        this.ents.push({ type: 'ring', mesh: ring, life: 1.2, pos: ring.position });
        race.audio.yawn();
        race.announce('💤 Gähn-Welle!');
        break;
      }
    }
  }

  ringUpdate(e, dt) {
    const s = 1 + (1.2 - e.life) * 60;
    e.mesh.scale.setScalar(s);
    e.mesh.material.opacity = e.life / 1.2;
  }

  hitTest(e, radius) {
    for (const k of this.race.karts) {
      if (k === e.owner && e.age < 0.4) continue;
      if (Math.abs(k.pos.y - e.pos.y) > 2.5) continue;
      const dx = k.pos.x - e.pos.x, dz = k.pos.z - e.pos.z;
      if (dx * dx + dz * dz < radius * radius) return k;
    }
    return null;
  }

  projectileClash(e) {
    for (let j = 0; j < this.ents.length; j++) {
      const o = this.ents[j];
      if (o === e || o.permanent || !['acorn', 'yarn', 'honey'].includes(o.type)) continue;
      if (o.pos.distanceToSquared(e.pos) < 3.5) {
        this.race.burst(o.pos, '#FFFFFF', 10);
        o.life = 0;
        return true;
      }
    }
    return false;
  }

  acornUpdate(e, dt) {
    const tr = this.race.track;
    e.pos.addScaledVector(e.vel, dt);
    const loc = tr.locate(e.pos, e.idx, _locTmp);
    e.idx = loc.i;
    e.pos.y = loc.y + 0.7;
    const lim = FENCE - 0.5;
    if (Math.abs(loc.lat) > lim) {
      const R = tr.R[loc.i];
      const s = Math.sign(loc.lat);
      e.pos.x -= R.x * s * (Math.abs(loc.lat) - lim);
      e.pos.z -= R.z * s * (Math.abs(loc.lat) - lim);
      const vn = e.vel.x * R.x + e.vel.z * R.z;
      e.vel.x -= 2 * vn * R.x;
      e.vel.z -= 2 * vn * R.z;
      if (++e.bounces > 3) return false;
    }
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.x += dt * 15;
    const k = this.hitTest(e, 1.7);
    if (k) { k.hit(); return false; }
    if (this.projectileClash(e)) return false;
  }

  honeyUpdate(e) {
    const k = this.hitTest(e, e.r);
    if (k && k.honey <= 0.3) {
      if (k.shield > 0) { k.shield = 0; this.race.audio.pop(k); if (!e.permanent) return false; return; }
      k.honey = 1.4;
      k.speed *= 0.6;
      k.drift.on = false;
      this.race.audio.splat(k);
      if (!e.permanent) return false;
    }
  }

  yarnUpdate(e, dt) {
    const tr = this.race.track;
    const tgt = e.target;
    let homing = false;
    if (tgt && !tgt.finished) {
      let gap = tgt.trackIdx - e.idx;
      if (gap < -tr.N / 2) gap += tr.N;
      if (gap > tr.N / 2) gap -= tr.N;
      homing = gap < 10;
      if (!homing) e.lat += (tgt.loc.lat - e.lat) * Math.min(1, dt * 1.5);
    }
    if (homing) {
      _v.subVectors(tgt.pos, e.pos);
      _v.y = 0;
      const d = _v.length();
      e.pos.addScaledVector(_v.normalize(), Math.min(d, e.speed * dt));
      const loc = tr.locate(e.pos, e.idx, _locTmp);
      e.idx = loc.i;
      e.pos.y = loc.y + 0.65;
    } else {
      e.idx = (e.idx + (e.speed * dt) / 2) % tr.N;
      tr.pointAt(e.idx, e.lat, e.pos);
      e.pos.y += 0.65 + tr.bump[Math.floor(e.idx)];
    }
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.x += dt * 12;
    if (Math.random() < 0.4) this.race.fx.soft.emit(e.pos, _v.set(0, 0.5, 0), '#FFB3CF', 0.3, 0.6);
    const k = this.hitTest(e, 1.8);
    if (k) { k.hit(); return false; }
    if (this.projectileClash(e)) return false;
  }

  attachCloud(k) {
    k.cloud = 7;
    this.race.audio.cloud(k);
  }

  zap(k) {
    k.cloud = 0;
    this.race.audio.zap(k);
    this.race.burst(k.pos, '#FFE36A', 20, true);
    if (k.shield > 0) { k.shield = 0; return; }
    k.stun = 0.7;
    k.small = 3.5;
    k.speed *= 0.4;
  }

  // Wolke weitergeben bei Kart-Kontakt
  passCloud(a, b) {
    if (a.cloud > 0 && b.cloud <= 0 && !b.finished) {
      b.cloud = a.cloud;
      a.cloud = 0;
      this.race.audio.cloud(b);
    }
  }

  decorate(k) {
    const d = (k.deco ||= {});
    if (k.shield > 0) {
      if (!d.shield) {
        d.shield = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 16), this.bubbleMat);
        this.group.add(d.shield);
      }
      d.shield.visible = true;
      d.shield.position.copy(k.pos).add(_v.set(0, 1.1, 0));
      d.shield.scale.setScalar(1 + Math.sin(this.race.time * 6) * 0.03);
    } else if (d.shield) d.shield.visible = false;
    if (k.cloud > 0) {
      if (!d.cloud) { d.cloud = makeCloud(); this.group.add(d.cloud); }
      d.cloud.visible = true;
      d.cloud.position.copy(k.pos).add(_v.set(0, 3.6, 0));
      d.cloud.children.at(-1).visible = Math.sin(this.race.time * 20) > 0.5 || k.cloud < 2;
      if (Math.random() < 0.3) this.race.fx.soft.emit(d.cloud.position, _v.set(0, -6, 0), '#8FD3FF', 0.15, 0.4);
    } else if (d.cloud) d.cloud.visible = false;
    if (k.drowsy > 0) {
      if (!d.zzz) { d.zzz = new THREE.Sprite(this.zzzMat); d.zzz.scale.setScalar(1.3); this.group.add(d.zzz); }
      d.zzz.visible = true;
      d.zzz.position.copy(k.pos).add(_v.set(0.5, 3 + Math.sin(this.race.time * 3) * 0.3, 0));
    } else if (d.zzz) d.zzz.visible = false;
  }
}

const _locTmp = {};
