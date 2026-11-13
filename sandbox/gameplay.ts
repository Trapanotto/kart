// Gameplay sandbox: stub physics + test track + the real race rules, items and AI.
// Give any item to any kart, fire it, watch a top-down debug map, fast-forward.
// window.__gp exposes advance(seconds) for automated checks in background tabs.
import { character, CHARACTERS, emptyInput, SPEED_CLASSES } from '../src/core/data';
import { createEntityView, setFallbackEntityView } from '../src/core/entityViews';
import { QUALITY } from '../src/core/quality';
import { Sim } from '../src/core/sim';
import { SIM_DT } from '../src/core/types';
import type { CharacterId, InputState, Kart, KartController, RaceConfig, SimEntity, View } from '../src/core/types';
import { AIDriver, createAI } from '../src/ai';
import { createItemSystem, ITEM_IDS, type ItemSystem } from '../src/items';
import { createRaceRules, type RaceRules } from '../src/race';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createKeyboardInput } from '../src/stubs/stubSystems';
import { createStubAssets, createStubCamera, createStubEntityView, createStubKartView, createStubRenderer, createStubTrackView } from '../src/stubs/stubRender';
import { createTestTrack } from '../src/stubs/testTrack';
import * as THREE from 'three/webgpu';

setFallbackEntityView(createStubEntityView);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');
const map = $<HTMLCanvasElement>('map');
const g2 = map.getContext('2d')!;

const assets = createStubAssets();
const renderer = createStubRenderer(canvas, QUALITY.medium, assets);
await renderer.init();
renderer.setQuality(QUALITY.medium);
const ctx = renderer.ctx;
const keyboard = createKeyboardInput();
const keyInput = emptyInput();

interface Race {
  sim: Sim;
  rules: RaceRules;
  items: ItemSystem;
  views: View[];
  entityViews: Map<SimEntity, View>;
  unsub: (() => void)[];
  camera: ReturnType<typeof createStubCamera>;
}
let race: Race | null = null;
let speed = 1;
let selfDrive = false;
let topCam = false;
let selected = 0;
let acc = 0;
const fxMarks: { x: number; z: number; t: number; color: string }[] = [];
const logLines: string[] = [];
function log(s: string): void {
  logLines.unshift(`${race ? race.sim.raceTime.toFixed(1).padStart(6) : ''}  ${s}`);
  logLines.length = Math.min(logLines.length, 60);
  $('log').textContent = logLines.join('\n');
}

const humanController: KartController = {
  update(kart) { Object.assign(kart.input, keyInput); },
};
const aiControllers = new Map<number, KartController>();

async function start(): Promise<void> {
  if (race) {
    for (const u of race.unsub) u();
    for (const v of race.views) v.dispose();
    for (const v of race.entityViews.values()) v.dispose();
    race.sim.dispose();
    race = null;
  }
  logLines.length = 0;
  const mode = ($<HTMLSelectElement>('mode').value as RaceConfig['mode']);
  const config: RaceConfig = {
    trackId: 'test', speedClass: SPEED_CLASSES[Number($<HTMLSelectElement>('cls').value)], player: 'otter',
    laps: Number($<HTMLInputElement>('laps').value) || 3, seed: Number($<HTMLInputElement>('seed').value) || 1, mode,
  };
  const track = createTestTrack();
  const physics = createStubPhysics();
  const items = createItemSystem();
  const rules = createRaceRules();
  const sim = new Sim({ config, track, physics, systems: [items, rules] });
  const ids = CHARACTERS.map((c) => c.id).filter((id) => id !== config.player);
  const grid: CharacterId[] = mode === 'timetrial' ? [config.player] : [...ids, config.player];
  grid.forEach((id, i) => sim.karts.push(physics.addKart({ char: character(id), isHuman: id === config.player, pose: track.startGrid[i] })));
  aiControllers.clear();
  for (const k of sim.karts) {
    const ai = createAI(k, sim);
    aiControllers.set(k.id, ai);
    sim.controllers.set(k.id, k.isHuman && selfDrive ? humanController : ai);
  }
  const r: Race = { sim, rules, items, views: [], entityViews: new Map(), unsub: [], camera: createStubCamera(ctx) };
  r.unsub.push(
    sim.events.on('entity:add', ({ entity }) => { const v = createEntityView(entity, ctx); if (v) r.entityViews.set(entity, v); }),
    sim.events.on('entity:remove', ({ entity }) => { r.entityViews.get(entity)?.dispose(); r.entityViews.delete(entity); }),
    sim.events.on('fx', ({ pos, color }) => fxMarks.push({ x: pos.x, z: pos.z, t: sim.time, color: color ?? '#fff' })),
    sim.events.on('race:countdown', ({ n }) => log(n ? String(n) : 'LOS!')),
    sim.events.on('race:lap', ({ kart, lap, lapTime, final }) => log(`${kart.char.name} Runde ${lap}${final ? ' (letzte)' : ''} ${lapTime ? lapTime.toFixed(2) + 's' : ''}`)),
    sim.events.on('race:finish', ({ kart, rank, time }) => log(`${kart.char.name} im Ziel: ${rank}. ${time.toFixed(2)}s`)),
    sim.events.on('race:over', ({ order }) => log('Rennen vorbei: ' + order.map((k) => k.char.name).join(', '))),
    sim.events.on('item:use', ({ kart, item }) => log(`${kart.char.name} benutzt ${item}`)),
    sim.events.on('item:warn', ({ kart, item }) => log(`Warnung: ${item} -> ${kart.char.name}`)),
    sim.events.on('kart:hit', ({ kart, cause, kind, absorbed }) => log(`${kart.char.name} ${absorbed ? 'abgewehrt' : 'getroffen'}: ${cause} (${kind})`)),
    sim.events.on('kart:respawn', ({ kart }) => log(`${kart.char.name} zurückgesetzt`)),
  );
  await renderer.setEnvironment(track.meta.environment);
  renderer.bindSim(sim);
  r.views.push(await createStubTrackView(track, ctx));
  for (const k of sim.karts) r.views.push(createStubKartView(k, ctx));
  race = r;
  sim.start();
  sim.interpolate(1);
  selected = Math.min(selected, sim.karts.length - 1);
  r.camera.setTarget(sim.karts[selected]);
  fillKartSelect();
  acc = 0;
}

function fillKartSelect(): void {
  const sel = $<HTMLSelectElement>('kart');
  sel.innerHTML = '';
  race!.sim.karts.forEach((k, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${k.char.name}${k.isHuman ? ' (Spieler)' : ''}`;
    sel.appendChild(o);
  });
  sel.value = String(selected);
}

function stepSim(): void {
  if (!race) return;
  race.sim.step();
}

/** Steps the sim for `seconds` of sim time and refreshes views (works in hidden tabs). */
function advance(seconds: number): void {
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) stepSim();
  frame(0);
}

function frame(dt: number): void {
  if (keyboard.poll(keyInput) === false) Object.assign(keyInput, emptyInput());
  if (race) {
    const { sim } = race;
    acc += dt * speed;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5 * speed) { stepSim(); acc -= SIM_DT; steps++; }
    if (steps >= 5 * speed) acc = 0;
    sim.interpolate(Math.min(1, acc / SIM_DT));
    for (const v of race.views) v.update(dt, ctx);
    for (const v of race.entityViews.values()) v.update(dt, ctx);
    const target = sim.karts[selected];
    if (topCam) {
      ctx.camera.position.set(target.renderPos.x, target.renderPos.y + 70, target.renderPos.z - 25);
      ctx.camera.lookAt(target.renderPos);
    } else race.camera.update(dt, ctx);
    drawMap();
    updatePanel();
  }
  renderer.render(dt);
}

// ---------------------------------------------------------------------------
// Top-down debug map

const trackPts: { x: number; z: number; l: number; r: number; lx: number; lz: number; rx: number; rz: number }[] = [];
function drawMap(): void {
  const sim = race!.sim;
  const W = map.width, H = map.height;
  g2.clearRect(0, 0, W, H);
  if (!trackPts.length) {
    for (let p = 0; p < sim.track.length; p += 4) {
      const f = sim.track.sample(p, 0);
      trackPts.push({ x: f.pos.x, z: f.pos.z, l: 0, r: 0, lx: f.pos.x - f.right.x * f.halfWidth, lz: f.pos.z - f.right.z * f.halfWidth, rx: f.pos.x + f.right.x * f.halfWidth, rz: f.pos.z + f.right.z * f.halfWidth });
    }
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of trackPts) { minX = Math.min(minX, p.lx, p.rx); maxX = Math.max(maxX, p.lx, p.rx); minZ = Math.min(minZ, p.lz, p.rz); maxZ = Math.max(maxZ, p.lz, p.rz); }
  const sc = Math.min(W / (maxX - minX + 20), H / (maxZ - minZ + 20));
  // +X is left in kart space; mirror X so the map reads like a view from above.
  const X = (x: number) => W / 2 - (x - (minX + maxX) / 2) * sc;
  const Z = (z: number) => H / 2 - (z - (minZ + maxZ) / 2) * sc;
  g2.lineWidth = 2;
  g2.strokeStyle = '#59627a';
  for (const side of ['l', 'r'] as const) {
    g2.beginPath();
    trackPts.forEach((p, i) => { const x = side === 'l' ? p.lx : p.rx, z = side === 'l' ? p.lz : p.rz; if (i) g2.lineTo(X(x), Z(z)); else g2.moveTo(X(x), Z(z)); });
    g2.closePath();
    g2.stroke();
  }
  const s0 = sim.track.sample(0, 0);
  g2.strokeStyle = '#fff'; g2.lineWidth = 3;
  g2.beginPath(); g2.moveTo(X(s0.pos.x - s0.right.x * 8), Z(s0.pos.z - s0.right.z * 8)); g2.lineTo(X(s0.pos.x + s0.right.x * 8), Z(s0.pos.z + s0.right.z * 8)); g2.stroke();

  // Entities.
  const colors: Record<string, string> = {
    'item.box': '#ffd447', 'item.acorn': '#c98a3c', 'item.honey': '#f2a516', 'item.giftbox': '#ff5f7a', 'item.yarn': '#ff6fa5',
    'item.bees': '#ffe14d', 'item.cloud': '#a7adc4', 'item.yawn': '#b9a7ff',
  };
  for (const e of sim.entities) {
    if (e.kind === 'item.kart') continue;
    const c = colors[e.kind] ?? '#ff00ff';
    g2.fillStyle = c; g2.strokeStyle = c;
    if (e.kind === 'item.box') { if (!e.data?.active) continue; g2.fillRect(X(e.pos.x) - 4, Z(e.pos.z) - 4, 8, 8); continue; }
    if (e.kind === 'item.yawn') { g2.beginPath(); g2.arc(X(e.pos.x), Z(e.pos.z), ((e.data?.ring as number) ?? 1) * sc, 0, 7); g2.stroke(); continue; }
    if (e.kind === 'item.honey' && e.data?.state === 'puddle') { g2.globalAlpha = 0.6; g2.beginPath(); g2.arc(X(e.pos.x), Z(e.pos.z), e.radius * sc, 0, 7); g2.fill(); g2.globalAlpha = 1; continue; }
    g2.beginPath(); g2.arc(X(e.pos.x), Z(e.pos.z), Math.max(4, e.radius * sc), 0, 7); g2.fill();
    const t = e.data?.target as number | undefined;
    if (t !== undefined && t >= 0) {
      const k = sim.karts[t];
      g2.setLineDash([4, 4]); g2.beginPath(); g2.moveTo(X(e.pos.x), Z(e.pos.z)); g2.lineTo(X(k.pos.x), Z(k.pos.z)); g2.stroke(); g2.setLineDash([]);
    }
  }
  // FX marks.
  for (let i = fxMarks.length - 1; i >= 0; i--) {
    const m = fxMarks[i];
    const age = sim.time - m.t;
    if (age > 0.6 || age < 0) { fxMarks.splice(i, 1); continue; }
    g2.strokeStyle = m.color; g2.globalAlpha = 1 - age / 0.6;
    g2.beginPath(); g2.arc(X(m.x), Z(m.z), 4 + age * 40, 0, 7); g2.stroke();
    g2.globalAlpha = 1;
  }
  // Karts and AI targets.
  for (const k of sim.karts) {
    const ai = aiControllers.get(k.id);
    if (ai instanceof AIDriver && sim.controllers.get(k.id) === ai) {
      g2.strokeStyle = ai.debug.rival ? '#ff4d4d' : 'rgba(120, 220, 255, 0.7)'; g2.lineWidth = 1;
      g2.beginPath(); g2.moveTo(X(k.pos.x), Z(k.pos.z)); g2.lineTo(X(ai.debug.target.x), Z(ai.debug.target.z)); g2.stroke();
      g2.fillStyle = g2.strokeStyle; g2.fillRect(X(ai.debug.target.x) - 2, Z(ai.debug.target.z) - 2, 4, 4);
    }
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(k.quat);
    g2.save();
    g2.translate(X(k.pos.x), Z(k.pos.z));
    g2.rotate(Math.atan2(-f.x, f.z));
    g2.fillStyle = k.char.color;
    g2.strokeStyle = k.isHuman ? '#4a6cf7' : k.id === selected ? '#fff' : '#000';
    g2.lineWidth = k.isHuman || k.id === selected ? 3 : 1;
    g2.beginPath(); g2.moveTo(0, -9); g2.lineTo(6, 7); g2.lineTo(-6, 7); g2.closePath(); g2.fill(); g2.stroke();
    g2.restore();
    if (k.shield) { g2.strokeStyle = '#bfe9ff'; g2.beginPath(); g2.arc(X(k.pos.x), Z(k.pos.z), 12, 0, 7); g2.stroke(); }
    if (k.stun > 0) { g2.fillStyle = '#ff4d4d'; g2.fillText('!', X(k.pos.x) + 9, Z(k.pos.z) - 9); }
  }
}

// ---------------------------------------------------------------------------
// Panel

let panelT = 0;
function updatePanel(): void {
  const now = performance.now();
  if (now - panelT < 150) return;
  panelT = now;
  const sim = race!.sim;
  $('status').textContent = `${sim.phase} ${sim.raceTime.toFixed(1)}s ×${speed}`;
  const rows = race!.rules.order.map((k) => {
    const r = k.race;
    const ai = aiControllers.get(k.id) as AIDriver | undefined;
    const slot = k.item.roulette > 0 ? '🎲' : k.item.id ? `${k.item.id}${k.item.count > 1 ? '×' + k.item.count : ''}${k.item.holding ? ' (h)' : ''}` : '';
    const mods = k.modifiers.filter((m) => m.id !== 'ai.band').map((m) => m.id.replace('item.', '')).join(',');
    const time = r.finished ? r.finishTime.toFixed(2) : r.lapTimes.length ? r.lapTimes[r.lapTimes.length - 1].toFixed(1) : '';
    return `<tr class="${k.id === selected ? 'sel' : ''}"><td>${r.rank}</td><td style="color:${k.char.color}">■</td><td>${k.char.name}${k.isHuman ? '*' : ''}${ai?.debug.rival ? ' ⚔' : ''}</td><td>R${r.lap}</td><td>${time}</td><td>${slot}</td><td>${mods}${r.wrongWay ? ' FALSCH' : ''}${k.shield ? ' 🫧' : ''}</td><td>${ai && sim.controllers.get(k.id) === ai ? ai.debug.mode : ''}</td></tr>`;
  });
  $('order').innerHTML = rows.join('');
}

// ---------------------------------------------------------------------------
// Controls

const itemSel = $<HTMLSelectElement>('item');
for (const id of ITEM_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = id; itemSel.appendChild(o); }
$<HTMLSelectElement>('kart').onchange = (e) => { selected = Number((e.target as HTMLSelectElement).value); race?.camera.setTarget(race.sim.karts[selected]); };
const speedsRow = $('speeds');
for (const s of [0, 0.25, 1, 4, 16]) {
  const b = document.createElement('button');
  b.textContent = s === 0 ? 'Pause' : `×${s}`;
  b.onclick = () => { speed = s; for (const c of speedsRow.children) c.classList.toggle('on', c === b); };
  if (s === 1) b.classList.add('on');
  speedsRow.appendChild(b);
}
$('restart').onclick = () => void start();
$('mode').onchange = () => void start();
$('cls').onchange = () => void start();
$('drive').onclick = (e) => {
  selfDrive = !selfDrive;
  (e.target as HTMLElement).classList.toggle('on', selfDrive);
  if (race) {
    const h = race.sim.player;
    race.sim.controllers.set(h.id, selfDrive ? humanController : aiControllers.get(h.id)!);
    selected = h.id;
    race.camera.setTarget(h);
    fillKartSelect();
  }
};
$('cam').onclick = (e) => { topCam = !topCam; (e.target as HTMLElement).textContent = topCam ? 'Kamera: oben' : 'Kamera: Kart'; };

function give(kartIdx: number, item: string): void {
  if (!race) return;
  race.items.give(race.sim.karts[kartIdx], item);
}
function fire(kartIdx: number, aim: -1 | 0 | 1 = 0): boolean {
  if (!race) return false;
  return race.items.use(race.sim.karts[kartIdx], aim);
}
$('give').onclick = () => give(selected, itemSel.value);
$('fire0').onclick = () => fire(selected, 0);
$('fireF').onclick = () => fire(selected, 1);
$('fireB').onclick = () => fire(selected, -1);
$('hold').onclick = () => { if (race) { const k = race.sim.karts[selected]; if (k.item.id) k.item.holding = !k.item.holding; } };
$('giveAll').onclick = () => { if (race) for (const k of race.sim.karts) give(k.id, ITEM_IDS[Math.floor(Math.random() * ITEM_IDS.length)]); };
$('giveAllSame').onclick = () => { if (race) for (const k of race.sim.karts) give(k.id, itemSel.value); };

addEventListener('resize', () => renderer.resize(innerWidth, innerHeight));
renderer.resize(innerWidth, innerHeight);

await start();
let last = performance.now();
const tick = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(dt);
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);

(window as unknown as { __gp: unknown }).__gp = {
  get sim() { return race?.sim; },
  get rules() { return race?.rules; },
  get items() { return race?.items; },
  advance,
  give,
  fire,
  restart: start,
  select(i: number) { selected = i; race?.camera.setTarget(race.sim.karts[i]); },
  setSpeed(s: number) { speed = s; },
  setTopCam(v: boolean) { topCam = v; },
  inputOverride(inp: Partial<InputState> | null) { if (inp) Object.assign(keyInput, inp); },
};
export {};
