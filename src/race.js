// Ein Rennen: Szene, Karts, Regeln, Kameras, Splitscreen
import * as THREE from 'three';
import { CHARACTERS, CLASSES, TRACKS, THEMES } from './data.js';
import { Track } from './track.js';
import { Kart } from './kart.js';
import { AIDriver } from './ai.js';
import { ItemManager } from './items.js';
import { Hazards } from './hazards.js';
import { Particles, Ambient, Skids } from './effects.js';
import { Hud } from './hud.js';
import { createKartModel, FUR } from './assets.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Race {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.settings = app.settings;
    this.audio = app.audio;
    this.input = app.input;
    this.cls = CLASSES[cfg.cls];
    this.def = TRACKS[cfg.track];
    this.theme = THEMES[this.def.theme];
    this.laps = 3;
    this.time = 0;
    this.clock = 0;
    this.state = 'intro';
    this.stateT = 0;
    this.paused = false;
    this.fxOn = true;

    const th = this.theme;
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    scene.environment = app.envMap;
    scene.environmentIntensity = th.night ? 0.35 : 0.8;
    this.hemi = new THREE.HemisphereLight(th.sky[1], th.ground, th.hemi);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#FFF4E0', th.sun));
    sun.castShadow = this.settings.shadows;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -55; sc.right = sc.top = 55; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    this.track = new Track(this.def, th);
    this.track.build(scene, this.settings);
    this.fx = { glow: new Particles(scene, 2500, true), soft: new Particles(scene, 2500, false) };
    this.ambient = new Ambient(this.fx, th.particles);
    this.skids = new Skids(scene);

    // Karts
    const humans = cfg.players.map((p) => CHARACTERS.find((c) => c.id === p.char));
    const used = new Set(humans.map((c) => c.id));
    const ai = this.mode === 'tt' ? [] : CHARACTERS.filter((c) => !used.has(c.id));
    const total = this.mode === 'tt' ? humans.length : Math.max(8, humans.length);
    while (humans.length + ai.length > total) ai.pop();
    this.karts = [];
    this.humans = [];
    humans.forEach((c, i) => {
      const k = new Kart(this, c, this.karts.length, i);
      this.karts.push(k);
      this.humans.push(k);
    });
    for (const c of ai) {
      const k = new Kart(this, c, this.karts.length, null);
      k.ai = new AIDriver(k, this.cls.ai * (0.95 + Math.random() * 0.08));
      this.karts.push(k);
    }
    // Startaufstellung: Reihenfolge aus GP-Wertung oder Spieler hinten
    let order = cfg.grid ? cfg.grid.map((id) => this.karts.find((k) => k.char.id === id)).filter(Boolean) : null;
    if (!order || order.length !== this.karts.length) {
      const aiK = this.karts.filter((k) => k.human === null).sort(() => Math.random() - 0.5);
      order = [...aiK, ...this.humans];
    }
    const N = this.track.N;
    order.forEach((k, s) => {
      const row = Math.floor(s / 2);
      const side = s % 2 ? 1 : -1;
      k.place(N - 6 - row * 5, side * 4.2, this.track);
      k.prevIdx = k.trackIdx;
    });
    this.ranked = [...order];
    this.ranked.forEach((k, i) => (k.rank = i + 1));

    this.items = new ItemManager(this);
    this.hazards = new Hazards(this);
    if (this.mode === 'tt') for (const k of this.humans) { k.item = 'carrot3'; k.itemCount = 3; }

    // Kameras
    this.cams = this.humans.map((k) => {
      const cam = new THREE.PerspectiveCamera(68, 1, 0.1, 3000);
      return { cam, k, yaw: k.heading, pos: new THREE.Vector3(), fov: 68, shake: 0 };
    });
    if (this.humans.length === 3) {
      this.overview = new THREE.PerspectiveCamera(50, 1, 1, 4000);
    }
    this.introCam = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);

    // Zeitfahren: Geist
    this.ghostRec = [];
    this.bestTime = null;
    if (this.mode === 'tt') {
      try {
        const g = JSON.parse(localStorage.getItem('pgp_ghost_' + this.def.id) || 'null');
        if (g && g.frames && g.frames.length) {
          this.bestTime = g.time;
          const model = createKartModel(g.char, { ghost: true });
          model.root.rotation.order = 'YXZ';
          scene.add(model.root);
          this.ghost = { data: g, model };
        }
      } catch (e) { /* kein Geist */ }
    }

    this.hud = new Hud(this);
    this.audio.race = this;
    this.audio.setEngines(this.humans.length);
    this.audio.playSong(this.theme.music);
    for (const k of this.karts) k.startHold = 0;
    this.hud.bigText(this.def.name, 'title');
  }

  // Bildschirmaufteilung (y von unten)
  viewRect(i, n, W, H) {
    if (n === 1) return { x: 0, y: 0, w: W, h: H };
    if (n === 2) return { x: 0, y: i === 0 ? H / 2 : 0, w: W, h: H / 2 };
    const col = i % 2, row = Math.floor(i / 2);
    return { x: (col * W) / 2, y: row === 0 ? H / 2 : 0, w: W / 2, h: H / 2 };
  }

  announce(text) { this.humans.forEach((k, i) => this.hud.message(i, text)); }

  burst(pos, color, n = 10, glow = false) {
    if (!this.fxOn) return;
    const sys = glow ? this.fx.glow : this.fx.soft;
    for (let i = 0; i < n; i++) {
      _v.copy(pos);
      _v.y += 1;
      sys.emit(_v, _w.set((Math.random() - 0.5) * 10, Math.random() * 7, (Math.random() - 0.5) * 10), color, 0.45, 0.6, { grav: 12 });
    }
  }

  update(dt) {
    if (this.paused) return;
    this.audio.curPan = 0;
    this.clock += dt;
    this.stateT += dt;
    const N = this.track.N;

    // Ablauf
    if (this.state === 'intro' && this.stateT > 3) {
      this.state = 'countdown';
      this.stateT = 0;
      this.hud.hideBig();
      this.count = 4;
    }
    if (this.state === 'countdown') {
      const c = 3 - Math.floor(this.stateT);
      if (c !== this.count && c > 0) {
        this.count = c;
        this.hud.bigText(String(c), 'count');
        this.audio.countdown();
      }
      for (const k of this.humans) {
        const inp = this.input.read(k.human, this.humans.length, k.input);
        k.startHold = inp.throttle > 0 ? k.startHold + dt : 0;
      }
      if (this.stateT >= 3) {
        this.state = 'race';
        this.stateT = 0;
        this.hud.bigText('LOS!', 'go');
        this.audio.go();
        setTimeout(() => this.hud.hideBig(), 900);
        for (const k of this.karts) {
          k.lapStart = 0;
          if (k.human !== null) {
            if (k.startHold > 0.15 && k.startHold < 1.3) { k.boost(1.1, 2); this.hud.message(k.human, 'Super-Start! 🚀'); }
            else if (k.startHold >= 1.3) { k.stun = 0.6; this.hud.message(k.human, 'Zu früh Gas gegeben…'); }
          } else if (Math.random() < 0.45 * this.cls.ai) k.boost(0.9, 1);
        }
      }
    }
    if (this.state === 'race' || this.state === 'done') this.time += dt;

    // Eingaben
    for (const k of this.karts) {
      if (k.ai) k.ai.update(dt, this);
      else this.input.read(k.human, this.humans.length, k.input);
    }
    // Gummiband für KI
    if (this.humans.length && this.mode !== 'tt') {
      const lead = Math.max(...this.humans.map((h) => h.progress));
      for (const k of this.karts) {
        if (k.human !== null || !k.ai) { k.rubber = 1; continue; }
        const gap = (lead - k.progress) * 2;
        k.rubber = Math.max(0.9, Math.min(1.12, 1 + (gap / 450) * 0.12)) * k.ai.skill;
      }
    }

    for (const k of this.karts) k.update(dt);
    this.collide();
    this.items.update(dt);
    this.hazards.update(dt);

    // Runden + Platzierung
    for (const k of this.karts) {
      const i = k.trackIdx, prev = k.prevIdx;
      if (i > N * 0.35 && i < N * 0.65) k.halfway = true;
      if (prev > N * 0.8 && i < N * 0.2) {
        if (k.lap === 0 || k.halfway) {
          k.lap++;
          k.halfway = false;
          if (k.lap > 1) { k.lapTimes.push(this.time - k.lapStart); k.lapStart = this.time; }
          if (k.lap > this.laps && !k.finished) this.finishKart(k);
          else if (k.human !== null && k.lap > 1) {
            if (k.lap === this.laps) { this.hud.message(k.human, 'Letzte Runde!'); this.audio.finalLap(); this.audio.setTempo(1.12); }
            else { this.hud.message(k.human, `Runde ${k.lap}`); this.audio.lap(); }
          }
        }
      } else if (prev < N * 0.2 && i > N * 0.8 && k.lap > 0 && !k.halfway && !k.finished) {
        k.lap--;
        k.halfway = true;
      }
      k.prevIdx = i;
      k.progress = k.lap * N + k.loc.idx;
    }
    this.ranked = [...this.karts].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    this.ranked.forEach((k, i) => (k.rank = i + 1));

    // Zeitfahren: Geist aufnehmen/abspielen
    if (this.mode === 'tt' && this.state === 'race') {
      const k = this.humans[0];
      if (!k.finished && (this.ghostRec.length === 0 || this.time - this.ghostRec.at(-1)[0] >= 0.05))
        this.ghostRec.push([+this.time.toFixed(2), +k.pos.x.toFixed(2), +k.pos.y.toFixed(2), +k.pos.z.toFixed(2), +k.model.root.rotation.y.toFixed(3)]);
      if (this.ghost) this.playGhost();
    }

    // Ende?
    if (this.state === 'race' && this.humans.every((k) => k.finished)) {
      this.state = 'done';
      this.stateT = 0;
    }
    if (this.state === 'done' && this.stateT > 4.5 && !this.ended) {
      this.ended = true;
      this.app.onRaceEnd(this.results());
    }

    // Effekte
    for (const s of this.track.spinners || []) s.o.rotation[s.axis] += dt * 0.8;
    this.fx.glow.update(dt);
    this.fx.soft.update(dt);
    if (this.humans[0]) this.ambient.update(dt, this.humans[0].pos);
    this.updateCameras(dt);
    this.updateFur();
    this.humans.forEach((k, i) => this.audio.updateEngine(i, k.speed, k.boostTime > 0, k.drift.on && k.grounded, k.grounded && Math.abs(k.loc.lat) > this.track.hw[k.loc.i] + 0.6));
    this.hud.update(dt);
    // Schattenkamera folgt Spieler 1
    const focus = this.humans[0] ? this.humans[0].pos : this.track.P[0];
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(_v.set(45, 90, 35));
  }

  playGhost() {
    const f = this.ghost.data.frames;
    const t = this.time;
    let lo = this.ghost.i || 0;
    while (lo < f.length - 2 && f[lo + 1][0] < t) lo++;
    this.ghost.i = lo;
    const a = f[lo], b = f[Math.min(lo + 1, f.length - 1)];
    const u = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    const r = this.ghost.model.root;
    r.position.set(a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u);
    let dy = b[4] - a[4];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.rotation.y = a[4] + dy * u;
  }

  // Abgestürzt: zurück auf die Strecke vor der Lücke
  respawn(k) {
    const N = this.track.N;
    let idx = k.trackIdx;
    for (let s = 0; s < 40 && (this.track.gap[idx] || this.track.launch[idx] || this.track.bump[idx] > 0); s++) idx = (idx - 1 + N) % N;
    idx = (idx - 6 + N) % N;
    k.place(idx, 0, this.track);
    k.vel.set(0, 0, 0);
    k.speed = 0;
    k.vy = 0;
    k.grounded = true;
    k.drift.on = false;
    k.boostTime = 0;
    k.stun = 0.8;
    k.squash = 0.25;
    this.burst(k.pos, '#FFFFFF', 16);
    if (k.human !== null) {
      this.hud.message(k.human, 'Hoppla! 🪂');
      this.audio.hit(k);
    }
  }

  finishKart(k) {
    k.finished = true;
    k.finishTime = this.time;
    const place = this.karts.filter((o) => o.finished).length;
    k.place = place;
    k.cheer = place <= 3;
    if (k.human !== null) {
      k.ai = new AIDriver(k, 0.95);
      this.hud.message(k.human, place === 1 ? '🏆 Gewonnen!' : `Ziel! Platz ${place}`, 4);
      this.audio.finish(place <= 3);
      this.audio.voice(k, place <= 3 ? 'yay' : 'oh');
      if (this.mode === 'tt') this.saveGhost(k);
    }
  }

  saveGhost(k) {
    if (this.bestTime && this.bestTime <= k.finishTime) return;
    this.newRecord = true;
    this.bestTime = k.finishTime;
    try {
      localStorage.setItem('pgp_ghost_' + this.def.id, JSON.stringify({ char: k.char.id, time: k.finishTime, laps: k.lapTimes, frames: this.ghostRec }));
    } catch (e) { /* Speicher voll */ }
  }

  results() {
    const avg = 25;
    const list = this.karts.map((k) => {
      const time = k.finished ? k.finishTime : this.time + Math.max(0, (this.laps + 1) * this.track.N - k.progress) * 2 / avg;
      return { k, char: k.char, time, human: k.human, laps: k.lapTimes, est: !k.finished };
    });
    list.sort((a, b) => a.time - b.time);
    list.forEach((r, i) => (r.place = i + 1));
    return { list, mode: this.mode, track: this.def, newRecord: this.newRecord, best: this.bestTime };
  }

  collide() {
    const ks = this.karts;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      const R = 2.1 * ((a.small > 0 ? 0.6 : 1) + (b.small > 0 ? 0.6 : 1)) / 2;
      if (d2 > R * R || Math.abs(a.pos.y - b.pos.y) > 1.8) continue;
      const d = Math.sqrt(d2) || 0.01;
      const nx = dx / d, nz = dz / d;
      const over = R - d;
      const ma = a.st.mass * (a.boostTime > 0 ? 1.5 : 1), mb = b.st.mass * (b.boostTime > 0 ? 1.5 : 1);
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      a.pos.x -= nx * over * wa; a.pos.z -= nz * over * wa;
      b.pos.x += nx * over * wb; b.pos.z += nz * over * wb;
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) {
        const imp = -rv * 1.4;
        a.vel.x -= nx * imp * wa; a.vel.z -= nz * imp * wa;
        b.vel.x += nx * imp * wb; b.vel.z += nz * imp * wb;
        if (imp > 4) this.audio.bump(a.human !== null ? a : b);
      }
      this.items.passCloud(a, b);
      this.items.passCloud(b, a);
    }
  }

  updateFur() {
    if (!this.settings.fur) return;
    for (const k of this.karts) {
      let best = Infinity;
      for (const c of this.cams) best = Math.min(best, c.cam.position.distanceToSquared(k.pos));
      k.setFurVisible(best < 16 * 16 || (k.human !== null && best < 30 * 30) ? FUR.layers : 0);
    }
  }

  updateCameras(dt) {
    const intro = this.state === 'intro';
    for (const c of this.cams) {
      const k = c.k;
      if (intro) {
        const a = this.clock * 0.5 + 0.6;
        const p0 = this.track.P[0];
        c.cam.position.set(p0.x + Math.cos(a) * 34, p0.y + 12 + this.clock * 1.5, p0.z + Math.sin(a) * 34);
        c.cam.lookAt(p0.x, p0.y + 2, p0.z);
        c.yaw = k.heading;
        c.pos.copy(c.cam.position);
        continue;
      }
      if (k.finished) {
        // Kamera dreht sich vor das Gesicht
        c.yaw += dt * 0.6;
        _v.set(Math.sin(c.yaw) * 7, 2.6, Math.cos(c.yaw) * 7).add(k.pos);
        c.pos.lerp(_v, 1 - Math.exp(-dt * 3));
        c.cam.position.copy(c.pos);
        c.cam.lookAt(k.pos.x, k.pos.y + 1.3, k.pos.z);
        continue;
      }
      let target = k.heading;
      if (k.stun > 0) target = c.yaw;
      let dy = target - c.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      c.yaw += dy * Math.min(1, dt * (k.drift.on ? 3.2 : 5));
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      _v.set(k.pos.x - fx * 6.8, k.pos.y + 2.9, k.pos.z - fz * 6.8);
      if (c.pos.lengthSq() === 0) c.pos.copy(_v);
      c.pos.lerp(_v, 1 - Math.exp(-dt * 14));
      c.pos.y = Math.max(c.pos.y, k.pos.y + 1.5);
      c.cam.position.copy(c.pos);
      if (k.shake > 0) c.cam.position.y += Math.sin(this.clock * 70) * 0.15;
      c.cam.lookAt(k.pos.x + fx * 4, k.pos.y + 1.4, k.pos.z + fz * 4);
      const fov = 68 + (k.boostTime > 0 ? 10 : 0) + Math.min(6, Math.max(0, k.speed - 20) * 0.3);
      c.fov += (fov - c.fov) * Math.min(1, dt * 4);
    }
  }

  render(renderer) {
    if (this.settings.bloom && this.app.post) this.app.post.render(this);
    else this.renderViews(renderer, null);
  }

  // Zeichnet alle Ansichten: direkt auf den Bildschirm (target = null) oder in ein Zwischenbild
  renderViews(renderer, target) {
    const size = renderer.getSize(_v);
    const W = size.x, H = size.y;
    const n = this.cams.length;
    const pr = renderer.getPixelRatio();
    const set = (r) => {
      if (target) {
        target.viewport.set(r.x * pr, r.y * pr, r.w * pr, r.h * pr);
        target.scissor.copy(target.viewport);
        target.scissorTest = n > 1;
        renderer.setRenderTarget(target);
      } else {
        renderer.setRenderTarget(null);
        renderer.setScissorTest(n > 1);
        renderer.setViewport(r.x, r.y, r.w, r.h);
        renderer.setScissor(r.x, r.y, r.w, r.h);
      }
    };
    this.cams.forEach((c, i) => {
      const r = this.viewRect(i, n, W, H);
      set(r);
      c.cam.aspect = r.w / r.h;
      c.cam.fov = c.fov;
      c.cam.updateProjectionMatrix();
      const s = (r.h * pr) / (2 * Math.tan((c.cam.fov * Math.PI) / 360));
      this.fx.glow.mat.uniforms.uScale.value = s;
      this.fx.soft.mat.uniforms.uScale.value = s;
      renderer.render(this.scene, c.cam);
    });
    if (this.overview) {
      const r = { x: W / 2, y: 0, w: W / 2, h: H / 2 };
      set(r);
      const o = this.overview;
      o.aspect = r.w / r.h;
      o.updateProjectionMatrix();
      o.position.set(0, 520, 260);
      o.lookAt(0, 0, 0);
      renderer.render(this.scene, o);
    }
    if (target) {
      target.viewport.set(0, 0, target.width, target.height);
      target.scissor.set(0, 0, target.width, target.height);
      target.scissorTest = false;
    }
    renderer.setScissorTest(false);
  }
  dispose() {
    this.audio.stopEngines();
    this.hud.dispose();
    this.track.group.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.userData.shared) o.geometry.dispose();
    });
  }
}
