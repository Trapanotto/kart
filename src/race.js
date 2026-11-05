// Ein Rennen: Szene, Karts, Regeln, Kameras, Splitscreen
import * as THREE from 'three';
import { Director } from './director.js';
const _ventV = new THREE.Vector3(), _ventP = new THREE.Vector3();
import { CHARACTERS, CLASSES, TRACKS, THEMES } from './data.js';
import { Track } from './track.js';
import { Kart } from './kart.js';
import { AIDriver } from './ai.js';
import { ItemManager } from './items.js';
import { Hazards } from './hazards.js';
import { Particles, Ambient, Skids } from './effects.js';
import { Hud } from './hud.js';
import { createKartModel, FUR } from './assets.js';
import { underwater } from './features.js';
import { captureEnvironment } from './env.js';
import { applyBaked } from './bake.js';
import { Weather } from './weather.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function loadHints() {
  try { return JSON.parse(localStorage.getItem('tk_hints') || '{}'); } catch (e) { return {}; }
}

// weicher Schatten unter dem Kart (bei gebackenem Licht gibt es keine Schattenkarte auf der Strecke)
let blobTex = null;
function blobShadow() {
  if (!blobTex) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 96;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(32, 48, 2, 32, 48, 44);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.38)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.setTransform(0.7, 0, 0, 1, 9.6, 0);
    g.fillStyle = grd; g.fillRect(0, 0, 64, 96);
    blobTex = new THREE.CanvasTexture(cv);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.geometry.rotateX(-Math.PI / 2);
  m.renderOrder = 1;
  return m;
}
function placeBlob(m, k) {
  const ground = k.loc && Number.isFinite(k.loc.y) ? k.loc.y : k.pos.y;
  const h = Math.max(0, k.pos.y - ground);
  m.position.set(k.pos.x, ground + 0.06, k.pos.z);
  m.rotation.y = k.heading;
  const s = 1 + Math.min(0.6, h * 0.08);
  m.scale.set(s, 1, s);
  m.material.opacity = Math.max(0, 1 - h / 8);
  m.visible = m.material.opacity > 0.02 && !k.rail;
}

// schluckt alle Aufrufe (für HUD und Ton im Demo-Modus)
const NOP = new Proxy(function () {}, { get: (t, p) => (p === 'humans' ? [] : p === 'then' || typeof p === 'symbol' ? undefined : NOP), set: () => true, apply: () => undefined });

export class Race {
  constructor(app, cfg) {
    this.app = app;
    this.cfg = cfg;
    this.mode = cfg.mode;
    this.settings = app.settings;
    this.audio = app.audio;
    this.input = app.input;
    // Demo auf dem Startbildschirm: nur Computer-Fahrer, kein HUD, kein Ton (Titelmusik läuft weiter)
    this.demo = cfg.mode === 'demo';
    if (this.demo) this.audio = NOP;
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

    this.track = new Track(this.def, th, !!this.cls.mirror);
    this.track.build(scene, this.settings);
    // gebackenes Licht: Sonne wirft dann keine Echtzeit-Schatten mehr (spart Rechenzeit),
    // Karts bekommen einen weichen Kontaktschatten
    this.baked = !!(cfg.baked && applyBaked(this.track, cfg.baked));
    if (this.baked) { sun.castShadow = false; this.hemi.intensity *= 0.85; }
    this.fx = { glow: new Particles(scene, 2500, true), soft: new Particles(scene, 2500, false) };
    this.ambient = new Ambient(this.fx, th.particles);
    this.skids = new Skids(scene);

    // Karts
    const humans = cfg.players.map((p) => CHARACTERS.find((c) => c.id === p.char));
    const used = new Set(humans.map((c) => c.id));
    const noAI = this.mode === 'tt' || this.mode === 'vs';
    const ai = noAI ? [] : CHARACTERS.filter((c) => !used.has(c.id));
    const total = noAI ? humans.length : Math.max(8, humans.length);
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
    // Rivale: ein besonders starker Computerfahrer
    const aiKarts = this.karts.filter((k) => k.ai);
    if (aiKarts.length) {
      this.rival = aiKarts[Math.floor(Math.random() * aiKarts.length)];
      this.rival.rival = true;
      this.rival.ai.skill = Math.min(1.09, this.rival.ai.skill * 1.07);
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

    // Spiegelungen: die fertige Strecke einmal rundum aufnehmen (statt eines Standardraums)
    if (this.settings.envmap !== false) {
      try {
        const p0 = this.track.P[0];
        this.envTex = captureEnvironment(app.renderer, scene, new THREE.Vector3(p0.x, p0.y + 9, p0.z));
        scene.environmentIntensity = th.night ? 0.6 : th.underwater ? 0.7 : 1.0;
      } catch (e) { console.warn('Keine Umgebungsaufnahme', e); scene.environment = app.envMap; }
    }

    this.hud = this.demo ? NOP : new Hud(this);
    this.audio.race = this;
    this.audio.setEngines(this.humans.length);
    this.audio.playSong(this.theme.music);
    for (const k of this.karts) k.startHold = 0;
    if (this.baked) this.blobs = this.karts.map(() => { const b = blobShadow(); scene.add(b); return b; });
    // Wetter und Ereignisse der Welt (im Zeitfahren aus, damit Zeiten vergleichbar bleiben)
    if (this.settings.weather !== false && this.mode !== 'tt') this.weather = new Weather(this);
    this.passState = new Map();
    this.hints = loadHints();
    this.hud.bigText(this.def.name, 'title');
    if (this.demo) {
      this.cams = [{ cam: new THREE.PerspectiveCamera(60, 1, 0.1, 3000), k: this.karts[0], yaw: 0, pos: new THREE.Vector3(), fov: 60, shake: 0 }];
      this.director = new Director(this);
      // gleich mitten ins Rennen: Start überspringen und ein paar Sekunden vorfahren
      this.state = 'race';
      for (const k of this.karts) { k.lapStart = 0; if (Math.random() < 0.5) k.boost(0.9, 1); }
      for (let i = 0; i < 150; i++) this.update(1 / 30);
      this.director.next();
    }
  }

  // Bildschirmaufteilung (y von unten)
  viewRect(i, n, W, H) {
    if (n === 1) return { x: 0, y: 0, w: W, h: H };
    if (n === 2) return { x: 0, y: i === 0 ? H / 2 : 0, w: W, h: H / 2 };
    const col = i % 2, row = Math.floor(i / 2);
    return { x: (col * W) / 2, y: row === 0 ? H / 2 : 0, w: W / 2, h: H / 2 };
  }

  // Erschuetterung fuer einen Spieler: Kamera wackelt, Gamepad/Handy vibriert
  impact(k, strength = 0.5) {
    if (k.human === null) return;
    const c = this.cams.find((c) => c.k === k);
    if (c) c.shake = Math.max(c.shake, Math.min(1, strength));
    this.haptic(k, 60 + strength * 160, strength);
  }

  haptic(k, ms, strength) {
    if (k.human === null || this.settings.haptics === false) return;
    const n = this.humans.length;
    try {
      const pads = this.input.pads();
      const pad = n === 1 ? pads[0] : this.input.padFor(k.human, n, pads);
      pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: Math.round(ms), strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) });
    } catch (e) { /* kein Rumble */ }
    try { if (n === 1 && navigator.vibrate && matchMedia('(pointer: coarse)').matches) navigator.vibrate(Math.round(ms)); } catch (e) { /* nicht erlaubt */ }
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
        if (this.rival) setTimeout(() => this.announce(`⚔️ Dein Rivale: ${this.rival.char.name}`), 1200);
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

    if (this.weather) { this.weather.update(dt); for (const k of this.karts) this.weather.apply(k); }
    for (const k of this.karts) k.update(dt);
    this.collide();
    this.items.update(dt);
    this.hazards.update(dt);

    // Runden + Platzierung
    for (const k of this.karts) {
      const i = k.trackIdx, prev = k.prevIdx;
      if (i > N * 0.35 && i < N * 0.65) k.halfway = true;
      { const fd = (i - prev + N) % N; if (fd > 3 && fd < N / 2 && ((Math.floor(N / 2) - prev + N) % N) <= fd) k.halfway = true; }
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
    if (this.state === 'race') { this.overtakes(); this.updateHints(); }

    // Zeitfahren: Geist aufnehmen/abspielen
    if (this.mode === 'tt' && this.state === 'race') {
      const k = this.humans[0];
      if (!k.finished && (this.ghostRec.length === 0 || this.time - this.ghostRec.at(-1)[0] >= 0.05))
        this.ghostRec.push([+this.time.toFixed(2), +k.pos.x.toFixed(2), +k.pos.y.toFixed(2), +k.pos.z.toFixed(2), +k.model.root.rotation.y.toFixed(3)]);
      if (this.ghost) this.playGhost();
    }

    // Ende?
    if (this.state === 'race' && !this.demo && this.humans.every((k) => k.finished)) {
      this.state = 'done';
      this.stateT = 0;
    }
    if (this.state === 'done' && this.stateT > 4.5 && !this.ended) {
      this.ended = true;
      this.app.onRaceEnd(this.results());
    }

    // Effekte
    for (const s of this.track.spinners || []) s.o.rotation[s.axis] += dt * 0.8;
    this.track.updateFans(this.clock);
    this.track.update(dt, this.clock);
    this.fx.glow.update(dt);
    this.fx.soft.update(dt);
    if (this.humans[0]) this.ambient.update(dt, this.humans[0].pos);
    // Dampf und Gischt an Wahrzeichen
    for (const v of this.track.vents || []) {
      v.acc = (v.acc || 0) + v.rate * dt;
      while (v.acc > 1) {
        v.acc -= 1;
        _ventV.set((Math.random() - 0.5) * v.spread, v.up * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * v.spread);
        this.fx.soft.emit(_ventP.copy(v.p).add(_ventV.clone().multiplyScalar(0.3)), _ventV, v.color, v.size * (0.7 + Math.random() * 0.6), v.life, { grow: 2.2, drag: 0.4 });
      }
    }
    this.updateCameras(dt);
    this.updateFur();
    if (this.blobs) this.karts.forEach((k, i) => placeBlob(this.blobs[i], k));
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
    k.rail = null; k.cannon = null; k.glide = false;
    k.model.root.quaternion.identity();
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
      if (a.lolly > 0 && !(b.lolly > 0)) b.hit();
      if (b.lolly > 0 && !(a.lolly > 0)) a.hit();
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
    if (this.director) return this.director.update(dt);
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
      if (k.rail && k.railFwd) {
        const f = k.railFwd, u = k.railUp;
        _v.copy(k.pos).addScaledVector(f, -7).addScaledVector(u, 2.6);
        c.pos.lerp(_v, 1 - Math.exp(-dt * 12));
        c.cam.position.copy(c.pos);
        c.cam.up.copy(u);
        c.cam.lookAt(_w.copy(k.pos).addScaledVector(f, 3).addScaledVector(u, 1.2));
        c.yaw = k.heading;
        continue;
      }
      c.cam.up.set(0, 1, 0);
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
      if (c.shake > 0.01) {
        // Wackeln bei Landung, Treffer und Bandenkontakt
        const a = c.shake * c.shake * 0.45, t = this.clock;
        c.cam.position.x += Math.sin(t * 61) * a; c.cam.position.y += Math.sin(t * 47 + 1) * a; c.cam.position.z += Math.sin(t * 53 + 2) * a;
        c.shake *= Math.exp(-dt * 5);
      }
      c.cam.lookAt(k.pos.x + fx * 4, k.pos.y + 1.4, k.pos.z + fz * 4);
      const fov = 68 + (k.boostTime > 0 ? 10 : 0) + Math.min(6, Math.max(0, k.speed - 20) * 0.3);
      c.fov += (fov - c.fov) * Math.min(1, dt * 4);
    }
  }

  render(renderer) {
    const post = this.app.post;
    if (post && (this.settings.bloom || this.settings.grade !== false)) {
      const now = performance.now();
      const dt = this.lastRender ? Math.min(0.1, (now - this.lastRender) / 1000) : 1 / 60;
      this.lastRender = now;
      post.render(this, this.viewInfo(renderer), dt);
    } else this.renderViews(renderer, null);
  }

  // Ansichten fuer die Nachbearbeitung: Rechteck (0..1), Tempo und Turbo je Spieler
  viewInfo(renderer) {
    const size = renderer.getSize(_v);
    const W = size.x, H = size.y, n = this.cams.length;
    const views = this.cams.map((c, i) => {
      const r = this.viewRect(i, n, W, H), k = c.k;
      const racing = this.state === 'race' && !k.finished && !this.paused;
      const ratio = k.speed / Math.max(1, k.st.maxSpeed);
      return {
        rect: { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H },
        speed: racing ? Math.max(0, Math.min(1, (ratio - 0.65) / 0.45 + (k.boostTime > 0 ? 0.35 : 0))) : 0,
        boost: racing && k.boostTime > 0 ? 1 : 0,
      };
    });
    if (this.overview) views.push({ rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, speed: 0, boost: 0 });
    return views;
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
      // Unter Wasser: blauer Nebel
      const uw = underwater(this.track, c.cam.position);
      const fog = this.scene.fog, th = this.theme;
      const fo = this.fogOverride;
      if (uw) { fog.color.set('#0B4870'); fog.near = 0; fog.far = 48; } else if (fo) { fog.color.set(fo.color); fog.near = fo.near; fog.far = fo.far; } else { fog.color.set(th.fog); fog.near = th.fogNear; fog.far = th.fogFar; }
      (this.camUw ||= [])[i] = !!uw;
      if (i === 0) this.audio.setUnderwater(!!uw);
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
  // Ueberholen: knapp vorbei gibt einen kleinen Turbo, der Rivale wird angesagt
  overtakes() {
    const N = this.track.N;
    for (const h of this.humans) {
      if (h.finished) continue;
      for (const o of this.karts) {
        if (o === h) continue;
        const key = h.slot + '_' + o.slot;
        const ahead = h.progress > o.progress;
        const prev = this.passState.get(key);
        this.passState.set(key, ahead);
        if (prev === undefined || prev === ahead) continue;
        if (Math.abs(h.progress - o.progress) > 4) continue; // Runden-Sprung, kein echtes Ueberholen
        if (ahead) {
          const close = h.pos.distanceTo(o.pos) < 3.2 && h.grounded && h.speed > 15;
          if (close) { h.boost(0.45, 1); this.hud.message(h.human, 'Knapp vorbei! 💨', 1.2); this.haptic(h, 60, 0.3); }
          else if (o.rival) this.hud.message(h.human, `⚔️ ${o.char.name} überholt!`, 1.4);
        } else if (o.rival) this.hud.message(h.human, `⚔️ ${o.char.name} ist vorbei`, 1.4);
      }
    }
  }

  // Hinweise fuer Einsteiger: einmal pro Thema, gemerkt im Browser
  hint(k, key, text) {
    if (k.human === null || this.hints[key] || this.mode === 'tt') return;
    this.hints[key] = 1;
    try { localStorage.setItem('tk_hints', JSON.stringify(this.hints)); } catch (e) { /* egal */ }
    this.hud.message(k.human, text, 3.2);
  }

  updateHints() {
    const tr = this.track, N = tr.N;
    for (const k of this.humans) {
      if (this.time > 3) this.hint(k, 'drift', '💡 Springen + Lenken = Drift. Lang driften gibt Turbo!');
      if (k.item && this.time > 6) this.hint(k, 'item', '💡 Item halten: hinter dir als Schutz – loslassen zum Werfen');
      if (k.glide) this.hint(k, 'glide', '💡 Gleiter: in der Luft kannst du lenken');
      const i = k.trackIdx;
      for (let s = 0; s < 40; s += 4) {
        const j = (i + s) % N;
        if (tr.loops.some((L) => L.c === j)) { this.hint(k, 'loop', '💡 Looping voraus – mit Schwung rein!'); break; }
        if (tr.island[j] > 0) { this.hint(k, 'fork', '💡 Weggabelung: links oder rechts – eine Seite ist kürzer'); break; }
      }
      if (this.weather && k.surface) this.hint(k, 'weather-' + k.surface, { puddle: '💡 Pfütze: Aquaplaning – nicht scharf lenken', ice: '💡 Eis: wenig Grip (Pingo rutscht nicht)', honey: '💡 Honig klebt – lieber drumherum', lava: '💡 Lava bremst stark – andere Spur nehmen' }[k.surface] || '');
    }
  }

  dispose() {
    if (this.weather) this.weather.dispose();
    if (this.envTex) this.envTex.dispose();
    this.audio.stopEngines();
    this.hud.dispose();
    this.track.group.traverse((o) => {
      if (o.isMesh && !o.isInstancedMesh && !o.userData.shared) o.geometry.dispose();
    });
  }
}
