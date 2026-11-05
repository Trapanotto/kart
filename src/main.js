// Trapanotto Kart – Einstieg
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAll } from './assets.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Race } from './race.js';
import { Menu } from './menu.js';
import { Showroom } from './showroom.js';
import { Post } from './post.js';
import { loadBaked } from './bake.js';
import { CLASSES } from './data.js';
import { loadProgress } from './progress.js';
import { TRACKS, POINTS, CHARACTERS, THEMES } from './data.js';

const DEFAULTS = { fur: true, shadows: true, bloom: true, grade: true, speedfx: true, envmap: true, haptics: true, baked: true, weather: true, quality: 1, music: 0.5, sfx: 0.7 };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('pgp_settings') || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}

class App {
  constructor() {
    this.settings = loadSettings();
    this.progress = loadProgress();
    this.vsWins = {};
    const canvas = document.getElementById('game');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(r);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    try { this.post = new Post(r); } catch (e) { console.warn('Kein Bloom', e); this.post = null; }
    this.input = new Input();
    this.audio = new Audio();
    this.race = null;
    this.gp = null;
    this.applySettings();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  async init() {
    const bar = document.querySelector('#loading .fill');
    await loadAll((p) => { bar.style.width = Math.round(p * 100) + '%'; });
    this.showroom = new Showroom(this);
    this.menu = new Menu(this);
    this.input.setupTouch(document.getElementById('touch'));
    document.getElementById('loading').classList.add('done');
    this.menu.title();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applySettings() {
    try { localStorage.setItem('pgp_settings', JSON.stringify(this.settings)); } catch (e) { /* egal */ }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.settings.quality));
    this.renderer.shadowMap.enabled = this.settings.shadows;
    this.audio.setVolumes(this.settings.music, this.settings.sfx);
    this.resize();
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (this.post) this.post.resize();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.race) {
      if (!this.race.paused && this.race.state !== 'done' && this.input.consumePause()) this.pause();
      else if (this.race.paused) this.input.consumePause();
      const steps = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < steps; i++) this.race.update(dt / steps);
      this.race.render(this.renderer);
      document.body.classList.toggle('racing', !this.race.paused && !this.menu.visible());
    } else if (this.demo && this.showroom.mode === 'title') {
      // Startbildschirm: laufendes Rennen mit Kamerafahrten
      this.input.consumePause();
      const steps = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < steps; i++) this.demo.update(dt / steps);
      this.demo.render(this.renderer);
      document.body.classList.remove('racing');
      this.demoT += dt;
      if (this.demoT > 40) { this.demoT = -1e9; this.startDemo(true); }
      const tag = document.getElementById('demo-tag');
      if (tag) {
        const lead = this.demo.ranked[0];
        const txt = `<i></i> LIVE · ${this.demo.def.name} · Runde ${Math.min(3, Math.max(1, lead.lap))}/3 · vorne: ${lead.char.name}`;
        if (tag.dataset.t !== txt) { tag.dataset.t = txt; tag.innerHTML = txt; }
      }
    } else {
      this.input.consumePause();
      this.showroom.update(dt);
      this.showroom.render(this.renderer);
      document.body.classList.remove('racing');
    }
    this.menu.update(dt);
  }

  // ------------------------------------------------------------ Rennen
  // Startbildschirm-Demo: zufällige Strecke, 8 Computer-Fahrer; switch = mit Abblende zur nächsten Strecke
  async startDemo(switchTrack = false) {
    if (this.demoBusy || (this.demo && !switchTrack)) return;
    this.demoBusy = true;
    const fade = document.getElementById('demo-fade');
    try {
      if (switchTrack && fade) { fade.classList.add('on'); await new Promise((r) => setTimeout(r, 550)); }
      const choices = TRACKS.map((t, i) => i).filter((i) => i !== this.demoTrack);
      const ti = choices[Math.floor(Math.random() * choices.length)];
      const cfg = { mode: 'demo', track: ti, cls: 1, players: [] };
      cfg.baked = this.settings.baked !== false ? await loadBaked(TRACKS[ti].id, this.settings.quality) : null;
      if (this.race) return; // inzwischen wurde ein Rennen gestartet
      const old = this.demo;
      this.demo = new Race(this, cfg);
      this.demoTrack = ti;
      this.demoT = 0;
      if (old) old.dispose();
    } catch (e) {
      console.warn('Demo-Rennen nicht möglich', e);
    } finally {
      this.demoBusy = false;
      if (fade) fade.classList.remove('on');
    }
  }

  stopDemo() {
    if (this.demo) this.demo.dispose();
    this.demo = null;
  }

  async startRace(cfg) {
    this.stopDemo();
    this.endRace();
    this.lastCfg = cfg;
    this.lastPlayers = cfg.players.length;
    // gebackenes Licht (falls vorhanden; im Spiegel-Modus nicht, dort waeren die Schatten seitenverkehrt)
    cfg.baked = null;
    if (this.settings.baked !== false && !CLASSES[cfg.cls].mirror) cfg.baked = await loadBaked(TRACKS[cfg.track].id, this.settings.quality);
    this.menu.hide();
    this.race = new Race(this, cfg);
    this.stopDemo(); // falls die Demo inzwischen fertig geladen wurde
  }

  endRace() {
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
  }

  restartRace() {
    if (!this.lastCfg) return;
    this.startRace(this.lastCfg);
  }

  quitRace(toTitle = true) {
    this.endRace();
    this.gp = null;
    if (toTitle) this.menu.title();
  }

  pause() {
    this.race.paused = true;
    this.menu.pause();
  }

  resume() {
    if (!this.race) return;
    this.race.paused = false;
    this.input.pausePressed = false;
    this.menu.hide();
  }

  onRaceEnd(res) {
    if (this.gp) {
      // Qualifikation: mindestens ein Spieler muss Platz 4 oder besser schaffen
      const best = Math.min(...res.list.filter((r) => r.human !== null).map((r) => r.place));
      res.failed = best > 4;
      if (!res.failed) for (const r of res.list) this.gp.points[r.char.id] = (this.gp.points[r.char.id] || 0) + (POINTS[r.place - 1] || 0);
    }
    if (res.mode === 'vs') {
      const w = res.list[0];
      this.vsWins[w.human] = (this.vsWins[w.human] || 0) + 1;
    }
    this.menu.results(res);
  }

  // ------------------------------------------------------------ Grand Prix
  gpTracks() {
    return TRACKS.map((t, i) => (t.cup === this.gp.cup ? i : -1)).filter((i) => i >= 0);
  }

  startGp(cup, cls, players) {
    this.gp = { cup, cls, players, race: 0, points: {} };
    for (const c of CHARACTERS) this.gp.points[c.id] = 0;
    this.startRace({ mode: 'gp', track: this.gpTracks()[0], cls, players });
  }

  nextGpRace() {
    const gp = this.gp;
    gp.race++;
    // Startaufstellung: Schlechteste vorne, Führende hinten
    const grid = Object.entries(gp.points).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const gpSaved = gp;
    this.startRace({ mode: 'gp', track: this.gpTracks()[gp.race], cls: gp.cls, players: gp.players, grid });
    this.gp = gpSaved;
  }
}

// Entwicklung: Strecke fürs Backen in Blender exportieren (nur mit `node tools/serve.mjs --dev`)
App.prototype.exportBake = async function (trackIndex) {
  const { Track } = await import('./track.js');
  const { exportTrack } = await import('./bake.js');
  const def = TRACKS[trackIndex];
  const scene = new THREE.Scene();
  const track = new Track(def, THEMES[def.theme], false);
  track.build(scene, { ...this.settings, shadows: true });
  const { glb, meta } = await exportTrack(track);
  const post = (file, body) => fetch('/__save?file=' + file, { method: 'POST', body }).then((r) => { if (!r.ok) throw new Error('Speichern verboten – Server mit --dev starten'); });
  await post(def.id + '.glb', new Blob([glb]));
  const th = THEMES[def.theme];
  await post(def.id + '.json', JSON.stringify({ ...meta, sun: th.sun, hemi: th.hemi, sky: th.sky, fog: th.fog, night: !!th.night, underwater: !!th.underwater, ground: th.ground }));
  return meta;
};

const app = new App();
window.pgp = app;
app.init().catch((e) => {
  console.error(e);
  document.querySelector('#loading p').textContent = 'Fehler beim Laden: ' + e.message;
});
