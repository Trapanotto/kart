// UI + audio sandbox: every screen, HUD state and sound reachable without the real game.
// A fake App runs a real headless grey-box race (stub physics, rules, AI) for the HUD.
import { PerspectiveCamera, Vector3 } from 'three';
import { createEventBus } from '../src/core/events';
import { character, CHARACTERS, emptyInput, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import { SIM_DT } from '../src/core/types';
import type { App, AppEvents, CharacterId, GameEvents, GameRenderer, InputSource, Kart, RaceConfig, RaceResult, Settings, TrackMeta } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createKeyboardInput, createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { createTestTrack } from '../src/stubs/testTrack';
import { createUI } from '../src/ui';
import { createAudio } from '../src/audio';
import { ITEM_ICONS } from '../src/ui/icons';
import { saveStore, store } from '../src/ui/storage';
import { podiumScreen, resultsScreen, standingsScreen, timeTrialScreen } from '../src/ui/screens/race';

// ------------------------------------------------------------------ fake app
const events = createEventBus<GameEvents & AppEvents>();
const settings: Settings = { quality: 'auto', musicVolume: 0.7, sfxVolume: 0.9, autoThrottle: false, steerAssist: false, cameraShake: true, vibration: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('tk2.settings') ?? '{}')); } catch { /* */ }
const camera = new PerspectiveCamera(65, 16 / 9, 0.3, 2000);
const testTrack = createTestTrack();
const tracks: TrackMeta[] = [
  { ...testTrack.meta, id: 'kleeblatt', name: 'Kleeblatt-Tal' },
  ...(new URLSearchParams(location.search).has('gp2') ? [{ ...testTrack.meta, id: 'bambus', name: 'Bambus-Tempel' }] : []),
  testTrack.meta,
];
const sources: InputSource[] = [createKeyboardInput()];
const playerInput = emptyInput();
let sim: Sim | null = null;
let paused = false;
let simRunning = true;
let lastConfig: RaceConfig | null = null;

const renderer = {
  ctx: { scene: null as any, camera, quality: null as any, vfx: { spawn() {} }, assets: null as any, sim: null, time: 0 },
  async init() {}, async setEnvironment() {}, setQuality() {}, setFeel() {}, bindSim() {}, resize() {}, render() {},
  stats: () => ({ fps: 60, drawCalls: 0, triangles: 0, backend: 'none' }), dispose() {},
} as unknown as GameRenderer;

const app: App & { advance(s: number): void } = {
  events, settings, renderer,
  get sim() { return sim; },
  get tracks() { return tracks; },
  async startRace(config) {
    lastConfig = config;
    endRace();
    for (let i = 0; i <= 5; i++) {
      events.emit('app:loading', { done: i, total: 5, label: i < 2 ? 'Strecke' : 'Modelle' });
      if (!new URLSearchParams(location.search).has('show')) await new Promise((r) => setTimeout(r, 120));
    }
    const track = createTestTrack();
    const physics = createStubPhysics();
    const s = new Sim({ config, track, physics, systems: [createStubRules()], events });
    const grid: CharacterId[] = config.grid ?? [...CHARACTERS.map((c) => c.id).filter((id) => id !== config.player), config.player];
    grid.forEach((id, i) => {
      const k = physics.addKart({ char: character(id), isHuman: id === config.player, pose: track.startGrid[i] });
      s.karts.push(k);
    });
    for (const k of s.karts) s.controllers.set(k.id, k.isHuman ? { update(kart) { Object.assign(kart.input, playerInput); if (config.assists?.autoThrottle && kart.input.brake === 0) kart.input.throttle = 1; if (autoDrive) { autoAi.update(kart, s, SIM_DT); } } } : createStubAI());
    const unsub = [
      events.on('race:finish', ({ kart }) => { if (kart.isHuman) s.controllers.set(kart.id, createStubAI()); }),
      events.on('race:over', ({ order }) => {
        const result: RaceResult = { config, order: order.map((k) => ({ char: k.char.id, isHuman: k.isHuman, time: k.race.finishTime, bestLap: k.race.bestLap })) };
        events.emit('app:raceEnded', { result });
      }),
    ];
    (s as any).__unsub = unsub;
    sim = s;
    s.start();
    s.interpolate(1);
    paused = false;
    events.emit('app:raceReady', { sim: s });
  },
  setPaused(p) { if (!sim || paused === p) return; paused = p; events.emit('app:pause', { paused }); },
  get paused() { return paused; },
  async restartRace() { if (lastConfig) await app.startRace(lastConfig); },
  quitToMenu() { endRace(); events.emit('app:menu', {}); },
  saveSettings() { try { localStorage.setItem('tk2.settings', JSON.stringify(settings)); } catch { /* */ } events.emit('app:settings', { settings }); },
  addInputSource(src) { sources.push(src); },
  advance(seconds) { for (let t = 0; t < seconds; t += SIM_DT) frame(SIM_DT); },
};
let autoDrive = true;
const autoAi = createStubAI();

function endRace(): void {
  if (!sim) return;
  for (const u of (sim as any).__unsub) u();
  sim.dispose();
  sim = null;
}

let acc = 0;
function frame(dt: number): void {
  let active = false;
  for (const s of sources) {
    if (!active && s.poll(playerInput)) active = true;
    if (s.consumePause?.() && sim) app.setPaused(!paused);
  }
  if (!active) Object.assign(playerInput, emptyInput());
  if (sim && !paused && simRunning) {
    acc += dt;
    let n = 0;
    while (acc >= SIM_DT && n < 5) { sim.step(); acc -= SIM_DT; n++; }
    if (n === 5) acc = 0;
    sim.interpolate(acc / SIM_DT);
    // Chase camera for audio panning.
    const p = sim.player;
    const fwd = new Vector3(0, 0, 1).applyQuaternion(p.renderQuat);
    camera.position.copy(p.renderPos).addScaledVector(fwd, -6).add(new Vector3(0, 2.5, 0));
    camera.lookAt(p.renderPos.x + fwd.x * 10, p.renderPos.y + 1, p.renderPos.z + fwd.z * 10);
    camera.updateMatrixWorld();
  }
  ui.advance(dt);
  audio?.advance?.(dt);
}

// ------------------------------------------------------------------ backdrop
const canvas = document.getElementById('game') as HTMLCanvasElement;
function drawBackdrop(): void {
  canvas.width = innerWidth; canvas.height = innerHeight;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, innerHeight * 0.55);
  sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(1, '#dff1ff');
  g.fillStyle = sky; g.fillRect(0, 0, innerWidth, innerHeight);
  g.fillStyle = '#9fd47e';
  g.beginPath(); g.moveTo(0, innerHeight * 0.55);
  for (let x = 0; x <= innerWidth; x += 20) g.lineTo(x, innerHeight * 0.52 + Math.sin(x / 140) * 22);
  g.lineTo(innerWidth, innerHeight); g.lineTo(0, innerHeight); g.fill();
  g.fillStyle = '#8a8f99';
  g.beginPath(); g.moveTo(innerWidth * 0.46, innerHeight * 0.56); g.lineTo(innerWidth * 0.54, innerHeight * 0.56); g.lineTo(innerWidth * 0.95, innerHeight); g.lineTo(innerWidth * 0.05, innerHeight); g.fill();
  g.fillStyle = '#c8552b'; g.fillRect(innerWidth * 0.46, innerHeight * 0.74, innerWidth * 0.08, innerHeight * 0.1);
}
drawBackdrop();
addEventListener('resize', drawBackdrop);

// ------------------------------------------------------------------ ui + audio
const ui = createUI(app, document.getElementById('ui')!);
const audio = createAudio(app) as (ReturnType<typeof createAudio> & { advance?(dt: number): void; board?: Record<string, () => void>; music?: any; check?(): Promise<string> }) | null;
(window as any).app = app;
(window as any).ui = ui;
(window as any).audio = audio;
(window as any).advance = (s: number) => app.advance(s);
/** For screenshots in background tabs: steps the loop and jumps finite CSS/WAAPI animations to their end. */
(window as any).settle = (s = 0.5) => {
  app.advance(s);
  for (const a of document.getAnimations()) {
    const t = a.effect?.getComputedTiming();
    if (t && t.iterations !== Infinity) { try { a.finish(); } catch { /* */ } }
  }
};

let last = performance.now();
const loop = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
requestAnimationFrame(loop);

// ------------------------------------------------------------------ dev panel
const dev = document.getElementById('dev')!;
document.getElementById('devToggle')!.onclick = () => dev.classList.toggle('hide');
const out = document.createElement('pre');
function section(title: string, buttons: [string, () => void][]): void {
  const h = document.createElement('h4'); h.textContent = title; dev.append(h);
  for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { try { fn(); } catch (e) { log(String(e)); } }; dev.append(b); }
}
function log(s: string): void { out.textContent = s + '\n' + out.textContent; }

const ctx = ui.ctx;
const cfg = (mode: RaceConfig['mode'] = 'race', laps = 2): RaceConfig => ({ trackId: 'kleeblatt', speedClass: SPEED_CLASSES[1], player: ctx.state.char, mode, laps, seed: 1, grid: mode === 'timetrial' ? [ctx.state.char] : undefined, assists: { autoThrottle: settings.autoThrottle, steerAssist: false } });
const P = (): Kart => { if (!sim) throw new Error('Kein Rennen: zuerst «Rennen starten»'); return sim.player; };
const fakeResult = (mode: RaceConfig['mode']): RaceResult => {
  const order = [...CHARACTERS].sort(() => Math.random() - 0.5).map((c, i) => ({ char: c.id, isHuman: c.id === ctx.state.char, time: 92.4 + i * 1.73 + Math.random(), bestLap: 29.8 + Math.random() * 2 }));
  return { config: { ...cfg(mode), laps: 3 }, order };
};

section('Bildschirme', [
  ['Titel', () => ctx.toTitle()], ['Menü', () => ctx.toMenu()], ['Fahrer', () => ctx.toChars()], ['Klasse', () => ctx.toClasses()],
  ['Strecke', () => { ctx.state.mode = 'race'; ctx.toTracks(); }], ['Cup (GP)', () => { ctx.state.mode = 'grandprix'; ctx.toTracks(); }],
  ['Zeitfahren-Wahl', () => { ctx.state.mode = 'timetrial'; ctx.toTracks(); }],
  ['Optionen', () => ctx.toOptions(() => ctx.toMenu('back'))], ['Steuerung', () => ctx.toControls(() => ctx.toMenu('back'))],
  ['Laden', () => events.emit('app:loading', { done: 2, total: 5, label: 'Modelle' })],
  ['Ergebnis (Rennen)', () => { ctx.state.mode = 'race'; ctx.state.gp = null; ctx.router.show((window as any).__screens.results(ctx, fakeResult('race'), () => ctx.toMenu())); }],
  ['GP-Wertung', () => { fakeGp(1); ctx.router.show((window as any).__screens.standings(ctx, () => ctx.toMenu())); }],
  ['Siegerehrung', () => { fakeGp(3); ctx.router.show((window as any).__screens.podium(ctx, () => ctx.toMenu())); }],
  ['Zeitfahren-Ergebnis', () => { ctx.router.show((window as any).__screens.tt(ctx, fakeResult('timetrial'))); }],
]);
function fakeGp(index: number): void {
  const points: Record<string, number> = {}, gained: Record<string, number> = {};
  CHARACTERS.forEach((c, i) => { gained[c.id] = [15, 12, 10, 8, 6, 4, 2, 1][(i * 3) % 8]; points[c.id] = gained[c.id] + ((i * 7) % 20); });
  ctx.state.mode = 'grandprix';
  ctx.state.gp = { tracks: [tracks[0], { ...tracks[0], id: 'b', name: 'Bambus-Tempel' }, { ...tracks[0], id: 'c', name: 'Honigfabrik' }, { ...tracks[0], id: 'd', name: 'Gletscher-Gipfel' }], index, points, gained, results: [] };
}

section('Rennen', [
  ['Rennen starten', () => { ctx.state.gp = null; ctx.state.mode = 'race'; app.startRace(cfg('race', 2)); }],
  ['Zeitfahren starten', () => { ctx.state.mode = 'timetrial'; app.startRace(cfg('timetrial', 2)); }],
  ['GP starten', () => { ctx.state.mode = 'grandprix'; ctx.startGrandPrix(); }],
  ['Sim an/aus', () => { simRunning = !simRunning; log('Sim läuft: ' + simRunning); }],
  ['Autopilot an/aus', () => { autoDrive = !autoDrive; log('Autopilot: ' + autoDrive); }],
  ['Pause', () => app.setPaused(!paused)],
  ['Beenden', () => app.quitToMenu()],
  ['Touch an', () => ui.forceTouch(true)], ['Touch aus', () => ui.forceTouch(false)], ['Touch auto', () => ui.forceTouch(null)],
  ['Hinweise zurücksetzen', () => { store.hints = []; saveStore(); log('Hinweise zurückgesetzt'); }],
]);
const emit = <K extends keyof GameEvents>(k: K, p: GameEvents[K]) => (events.emit as any)(k, p);
section('HUD-Ereignisse', [
  ['3', () => emit('race:countdown', { n: 3 })], ['2', () => emit('race:countdown', { n: 2 })], ['1', () => emit('race:countdown', { n: 1 })], ['LOS', () => emit('race:countdown', { n: 0 })],
  ['Rang +', () => { const p = P(); simRunning = false; const from = p.race.rank; p.race.rank = Math.max(1, from - 1); emit('race:rank', { kart: p, from, to: p.race.rank }); }],
  ['Rang −', () => { const p = P(); simRunning = false; const from = p.race.rank; p.race.rank = Math.min(8, from + 1); emit('race:rank', { kart: p, from, to: p.race.rank }); }],
  ['Item-Box', () => { const p = P(); emit('item:box', { kart: p, spot: 0 }); p.item.roulette = 1.4; p.item.id = null; const pick = Object.keys(ITEM_ICONS).filter((k) => k !== 'itembox'); const id = pick[Math.floor(Math.random() * pick.length)]; setTimeout(() => { p.item.roulette = 0; p.item.id = id; p.item.count = id.endsWith('3') ? 3 : 1; emit('item:got', { kart: p, item: id }); }, 1400); const tick = setInterval(() => { p.item.roulette = Math.max(0, p.item.roulette - 0.05); if (p.item.roulette <= 0) clearInterval(tick); }, 50); }],
  ['Item benutzen', () => { const p = P(); if (p.item.id) { emit('item:use', { kart: p, item: p.item.id }); p.item.count--; if (p.item.count <= 0) { p.item.id = null; p.item.count = 0; } } }],
  ['Item halten', () => { const p = P(); p.item.holding = !p.item.holding; }],
  ['Treffer', () => emit('kart:hit', { kart: P(), kind: 'spin', by: 1, cause: 'acorn', absorbed: false })],
  ['Schild', () => emit('kart:hit', { kart: P(), kind: 'spin', by: 1, cause: 'acorn', absorbed: true })],
  ['Drift 1/2/3', () => { const p = P(); p.drift.active = true; let l = 0; const t = setInterval(() => { l++; p.drift.level = l as 1; emit('kart:driftLevel', { kart: p, level: l }); if (l === 3) { clearInterval(t); setTimeout(() => { p.drift.active = false; p.drift.level = 0; emit('kart:driftEnd', { kart: p, level: 3 }); emit('kart:boost', { kart: p, duration: 1.5, power: 1.4, cause: 'drift3' }); }, 700); } }, 600); }],
  ['Turbo', () => emit('kart:boost', { kart: P(), duration: 1, power: 1.3, cause: 'carrot' })],
  ['Superstart', () => emit('kart:startBoost', { kart: P(), quality: 1 })],
  ['Sprung+Trick', () => { const p = P(); emit('kart:jump', { kart: p }); setTimeout(() => emit('kart:trick', { kart: p }), 300); setTimeout(() => emit('kart:land', { kart: p, airTime: 0.8, impact: 0.6 }), 900); }],
  ['Runde 2', () => emit('race:lap', { kart: P(), lap: 2, lapTime: 31.2, final: false })],
  ['Letzte Runde', () => { const p = P(); emit('race:lap', { kart: p, lap: sim!.laps, lapTime: 30.4, final: false }); }],
  ['Falsche Richtung', () => { const p = P(); p.race.wrongWay = !p.race.wrongWay; }],
  ['Item-Warnung', () => emit('item:warn', { kart: P(), item: 'bees', from: sim!.karts[0].id })],
  ['Ziel', () => { const p = P(); p.race.finished = true; p.race.finishTime = sim!.raceTime; emit('race:finish', { kart: p, rank: p.race.rank, time: p.race.finishTime }); }],
  ['Rennende', () => { const order = [...sim!.karts].sort((a, b) => a.race.rank - b.race.rank); emit('race:over', { order }); }],
  ['Kollision', () => emit('kart:collide', { kart: P(), other: sim!.karts[0], impulse: 6, point: P().pos.clone() })],
  ['Respawn', () => emit('kart:respawn', { kart: P() })],
]);

// Audio board (filled by the audio module).
const ab = document.createElement('div');
dev.append(ab);
function audioBoard(): void {
  ab.innerHTML = '';
  if (!audio?.board) { ab.textContent = 'Audio nicht verfügbar'; return; }
  const groups = new Map<string, [string, () => void][]>();
  for (const [k, fn] of Object.entries(audio.board)) { const [g, n] = k.includes('/') ? k.split('/') : ['Effekte', k]; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push([n, fn]); }
  for (const [g, list] of groups) {
    const h = document.createElement('h4'); h.textContent = 'Audio: ' + g; ab.append(h);
    for (const [n, fn] of list) { const b = document.createElement('button'); b.textContent = n; b.onclick = () => fn(); ab.append(b); }
  }
  const h = document.createElement('h4'); h.textContent = 'Audio-Prüfung'; ab.append(h);
  const b = document.createElement('button'); b.textContent = 'Offline rendern + prüfen';
  b.onclick = async () => { log('Rendere …'); log(await audio!.check!()); };
  ab.append(b);
}
audioBoard();
dev.append(out);

// Screen factories for the panel (results etc. need fake data).
(window as any).__screens = { results: resultsScreen, standings: standingsScreen, podium: podiumScreen, tt: timeTrialScreen };
if (new URLSearchParams(location.search).has('nodev')) dev.classList.add('hide');

// ?show=<state> recreates a screen or HUD state on load (survives hot reloads; handy for screenshots).
const show = new URLSearchParams(location.search).get('show');
async function runShow(s: string): Promise<void> {
  const settle = (window as any).settle as (t?: number) => void;
  const race = async (mode: RaceConfig['mode'] = 'race') => { ctx.state.mode = mode; await app.startRace(cfg(mode, 2)); app.advance(9); };
  if (new URLSearchParams(location.search).has('touch')) ui.forceTouch(true);
  switch (s) {
    case 'menu': ctx.toMenu(); break;
    case 'chars': ctx.state.mode = 'grandprix'; ctx.toChars(); break;
    case 'classes': ctx.toClasses(); break;
    case 'tracks': ctx.state.mode = 'race'; ctx.toTracks(); break;
    case 'tracks-tt': ctx.state.mode = 'timetrial'; ctx.toTracks(); break;
    case 'cup': ctx.state.mode = 'grandprix'; ctx.toTracks(); break;
    case 'options': ctx.toOptions(() => ctx.toMenu('back')); break;
    case 'controls': ctx.toControls(() => ctx.toMenu('back')); break;
    case 'loading': events.emit('app:loading', { done: 3, total: 5, label: 'Modelle' }); break;
    case 'results': ctx.state.mode = 'race'; ctx.state.gp = null; ctx.router.show(resultsScreen(ctx, fakeResult('race'), () => ctx.toMenu())); break;
    case 'standings': fakeGp(1); ctx.router.show(standingsScreen(ctx, () => ctx.toMenu())); settle(3); break;
    case 'podium': fakeGp(3); ctx.router.show(podiumScreen(ctx, () => ctx.toMenu())); break;
    case 'podium-win': fakeGp(3); ctx.state.gp!.points[ctx.state.char] = 60; ctx.router.show(podiumScreen(ctx, () => ctx.toMenu())); break;
    case 'tt': ctx.router.show(timeTrialScreen(ctx, fakeResult('timetrial'))); break;
    case 'hud': await race(); break;
    case 'hud-busy': {
      await race();
      const p = P(); simRunning = false;
      p.item.id = 'bees'; p.item.count = 1; emit('item:got', { kart: p, item: 'bees' });
      emit('item:warn', { kart: p, item: 'acorn', from: sim!.karts[0].id });
      p.drift.active = true; p.drift.level = 2;
      emit('race:lap', { kart: p, lap: 2, lapTime: 31.2, final: true });
      break;
    }
    case 'countdown': ctx.state.mode = 'race'; await app.startRace(cfg('race', 2)); app.advance(1.2); settle(0); return;
    case 'wrong': await race(); P().race.wrongWay = true; simRunning = false; break;
    case 'finish': await race(); { const p = P(); simRunning = false; p.race.finished = true; p.race.finishTime = sim!.raceTime; emit('race:finish', { kart: p, rank: 2, time: p.race.finishTime }); } break;
    case 'pause': await race(); app.setPaused(true); break;
    case 'hint': await race(); store.hints = []; saveStore(); ui.hud.queueHint('items'); simRunning = true; break;
  }
  settle(0.6);
}
if (show) setTimeout(() => { runShow(show).catch((e) => console.error(e)); }, 200);
