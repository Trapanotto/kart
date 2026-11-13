// Actors sandbox: a turntable of all drivers in their karts with buttons for every clip and state,
// plus a small driving demo on the grey-box test track (stub physics, rules and AI).
// window.__actors.advance(seconds) steps everything manually (works in background tabs).
import * as THREE from 'three/webgpu';
import { character, CHARACTERS, emptyInput, SPEED_CLASSES } from '../src/core/data';
import { createEventBus } from '../src/core/events';
import { setFallbackEntityView } from '../src/core/entityViews';
import { QUALITY } from '../src/core/quality';
import { Sim } from '../src/core/sim';
import { SIM_DT } from '../src/core/types';
import type { GameEvents, Kart, KartController, QualityTier, RaceConfig, RaceSim, RenderContext, View } from '../src/core/types';
import { createAssets, createKartView, raceAssets } from '../src/actors';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createKeyboardInput, createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { createStubCamera, createStubEntityView, createStubRenderer, createStubTrackView } from '../src/stubs/stubRender';
import { createTestTrack } from '../src/stubs/testTrack';
import { createPhysics } from '../src/physics';

setFallbackEntityView(createStubEntityView);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('game');

const params = new URLSearchParams(location.search);
let tier: QualityTier = (params.get('tier') as QualityTier) || 'medium';
$<HTMLSelectElement>('tier').value = tier;
const assets = createAssets();
const renderer = createStubRenderer(canvas, QUALITY[tier], assets);
await renderer.init();
renderer.setQuality(QUALITY[tier]);
const baseCtx = renderer.ctx;
const resize = () => renderer.resize(Math.max(1, innerWidth), Math.max(1, innerHeight));
addEventListener('resize', resize);
resize();

await assets.load(raceAssets({ trackId: 'test', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race' }));

// ------------------------------------------------------------------ showroom
const scene = baseCtx.scene;
const events = createEventBus<GameEvents>();
const fakeSim = { events, karts: [] as Kart[] } as unknown as RaceSim;
const showCtx: RenderContext = {
  get scene() { return baseCtx.scene; }, get camera() { return baseCtx.camera; }, get quality() { return baseCtx.quality; },
  get vfx() { return baseCtx.vfx; }, get assets() { return baseCtx.assets; }, get time() { return baseCtx.time; }, sim: fakeSim,
};
const showGroup = new THREE.Group();
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: '#cfd8c4', roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
showGroup.add(floor);

const stubPhysics = createStubPhysics();
const showKarts: Kart[] = [];
const showViews: View[] = [];
const SPACING = 2.6;
CHARACTERS.forEach((c, i) => {
  const pos = new THREE.Vector3((i - 3.5) * SPACING, 0, 0);
  const k = stubPhysics.addKart({ char: c, isHuman: i === 6, pose: { pos, quat: new THREE.Quaternion() } });
  showKarts.push(k);
});
(fakeSim as unknown as { karts: Kart[] }).karts = showKarts;

let mode: 'show' | 'drive' = 'show';
let turning = true;
let turnAngle = 0.5;
let focus = -1;
const flags = { drift: 0, boost: false, look: false, finished: '' as '' | 'win' | 'lose', squash: false, shrink: false, air: false };

function buildShowroom(): void {
  scene.add(showGroup);
  for (const k of showKarts) showViews.push(createKartView(k, showCtx));
}
function clearShowroom(): void {
  for (const v of showViews) v.dispose();
  showViews.length = 0;
  scene.remove(showGroup);
}

function showTargets(): Kart[] { return focus < 0 ? showKarts : [showKarts[focus]]; }

let squashT = 0;
function updateShowroom(dt: number): void {
  if (squashT > 0) { squashT -= dt; flags.squash = squashT > 0; }
  if (turning) turnAngle += dt * 0.5;
  const steer = Number($<HTMLInputElement>('steer').value);
  for (const k of showKarts) {
    k.renderQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turnAngle);
    k.renderPos.copy(k.pos);
    k.input.steer = steer;
    k.drift.active = flags.drift !== 0;
    k.drift.dir = flags.drift as -1 | 0 | 1;
    k.boost.time = flags.boost ? 1 : 0;
    k.input.lookBack = flags.look;
    k.race.finished = flags.finished !== '';
    k.stunKind = flags.squash ? 'squash' : null;
    k.modifiers = flags.shrink ? [{ id: 'item.zap', time: 1, scale: 0.6 }] : [];
    k.speed = 12;
    for (const w of k.wheels) { w.spin += dt * 12 / 0.24; w.steer = -steer * 0.4; }
  }
  const cam = baseCtx.camera;
  if (focus < 0) { cam.position.set(0, 4.2, 11.5); cam.lookAt(0, 0.7, 0); }
  else { const p = showKarts[focus].pos; cam.position.set(p.x + 0.9, 1.35, p.z + 2.5); cam.lookAt(p.x, 0.8, p.z); }
  for (const v of showViews) v.update(dt, showCtx);
}

function stateButtons(): void {
  const states: [string, () => void][] = [
    ['Normal', () => { Object.assign(flags, { drift: 0, boost: false, look: false, finished: '', squash: false, shrink: false }); $<HTMLInputElement>('steer').value = '0'; }],
    ['Drift L', () => { flags.drift = -1; $<HTMLInputElement>('steer').value = '-0.8'; }],
    ['Drift R', () => { flags.drift = 1; $<HTMLInputElement>('steer').value = '0.8'; }],
    ['Boost', () => { flags.boost = !flags.boost; }],
    ['Zurückschauen', () => { flags.look = !flags.look; }],
    ['Sieg', () => { flags.finished = 'win'; for (const k of showTargets()) events.emit('race:finish', { kart: k, rank: 1, time: 60 }); }],
    ['Niederlage', () => { flags.finished = 'lose'; for (const k of showTargets()) events.emit('race:finish', { kart: k, rank: 8, time: 90 }); }],
    ['Platt', () => { flags.squash = !flags.squash; }],
    ['Geschrumpft', () => { flags.shrink = !flags.shrink; }],
  ];
  for (const [label, fn] of states) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    $('states').appendChild(b);
  }
  const shots: [string, (k: Kart) => void][] = [
    ['Treffer Dreher', (k) => events.emit('kart:hit', { kart: k, kind: 'spin', by: -1, cause: 'acorn', absorbed: false })],
    ['Überschlag', (k) => events.emit('kart:hit', { kart: k, kind: 'tumble', by: -1, cause: 'bees', absorbed: false })],
    ['Plattgemacht', (k) => { events.emit('kart:hit', { kart: k, kind: 'squash', by: -1, cause: 'giftbox', absorbed: false }); squashT = 1.4; }],
    ['Überholt', (k) => events.emit('race:rank', { kart: k, from: 3, to: 2 })],
    ['Werfen', (k) => events.emit('item:use', { kart: k, item: 'acorn' })],
    ['Trick', (k) => events.emit('kart:trick', { kart: k })],
    ['Landung', (k) => events.emit('kart:land', { kart: k, airTime: 0.8, impact: 6 })],
    ['Sprung', (k) => events.emit('kart:jump', { kart: k })],
  ];
  for (const [label, fn] of shots) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { for (const k of showTargets()) fn(k); };
    $('shots').appendChild(b);
  }
  for (const c of assets.clips('char.otter')) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.onclick = () => playClipDirect(c.name);
    $('clips').appendChild(b);
  }
  CHARACTERS.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = `${c.name} (${c.id})`;
    $('focus').appendChild(o);
  });
  $<HTMLSelectElement>('focus').onchange = (e) => { focus = Number((e.target as HTMLSelectElement).value); };
  $('turn').onclick = () => { turning = !turning; $('turn').classList.toggle('on', turning); };
}

// Clip preview: a separate mixer on a bare driver so each clip can be checked in isolation.
let direct: { root: THREE.Object3D; mixer: THREE.AnimationMixer } | null = null;
function playClipDirect(name: string): void {
  const id = focus < 0 ? 'otter' : showKarts[focus].char.id;
  if (direct) { scene.remove(direct.root); direct = null; }
  const kartObj = assets.model(`kart.${id}`);
  const drv = assets.model(`char.${id}`);
  kartObj.getObjectByName('seat')?.add(drv);
  kartObj.position.set(0, 0, 3.2);
  scene.add(kartObj);
  const mixer = new THREE.AnimationMixer(drv);
  const clip = assets.clips(`char.${id}`).find((c) => c.name === name);
  if (clip) mixer.clipAction(clip).play();
  direct = { root: kartObj, mixer };
}

// ------------------------------------------------------------------ driving demo
let drive: { sim: Sim; views: View[]; camera: ReturnType<typeof createStubCamera>; acc: number } | null = null;
const keyboard = createKeyboardInput();
const keyInput = emptyInput();
let autopilot = true;
let realPhysics = params.get('physics') === 'real';
const ai = createStubAI();
const player: KartController = {
  update(kart, sim, dt) {
    if (autopilot) ai.update(kart, sim, dt);
    else Object.assign(kart.input, keyInput);
  },
};

async function startDrive(): Promise<void> {
  stopDrive();
  const config: RaceConfig = { trackId: 'test', speedClass: SPEED_CLASSES[1], player: 'otter', laps: 3, seed: 1, mode: 'race' };
  const track = createTestTrack();
  const physics = realPhysics ? await createPhysics(track, config) : createStubPhysics();
  const sim = new Sim({ config, track, physics, systems: [createStubRules()] });
  const others = CHARACTERS.map((c) => c.id).filter((id) => id !== 'otter');
  [...others, 'otter' as const].forEach((id, i) => {
    const k = physics.addKart({ char: character(id), isHuman: id === 'otter', pose: track.startGrid[i] });
    sim.karts.push(k);
    sim.controllers.set(k.id, k.isHuman ? player : createStubAI());
  });
  (baseCtx as { sim: RaceSim | null }).sim = sim;
  const ctx = baseCtx;
  const views: View[] = [await createStubTrackView(track, ctx)];
  for (const k of sim.karts) views.push(createKartView(k, ctx));
  const camera = createStubCamera(ctx);
  camera.setTarget(sim.player);
  sim.start();
  sim.interpolate(1);
  drive = { sim, views, camera, acc: 0 };
}
function stopDrive(): void {
  if (!drive) return;
  for (const v of drive.views) v.dispose();
  drive.sim.dispose();
  (baseCtx as { sim: RaceSim | null }).sim = null;
  drive = null;
}

function updateDrive(dt: number): void {
  if (!drive) return;
  keyboard.poll(keyInput);
  const { sim } = drive;
  drive.acc += dt;
  let n = 0;
  while (drive.acc >= SIM_DT && n < 5) { sim.step(); drive.acc -= SIM_DT; n++; }
  if (n === 5) drive.acc = 0;
  sim.interpolate(drive.acc / SIM_DT);
  for (const v of drive.views) v.update(dt, baseCtx);
  drive.camera.update(dt, baseCtx);
}

// ------------------------------------------------------------------ UI + loop
$('mShow').onclick = async () => { if (mode === 'show') return; mode = 'show'; stopDrive(); buildShowroom(); syncUI(); };
$('mDrive').onclick = async () => { if (mode === 'drive') return; mode = 'drive'; clearShowroom(); if (direct) { scene.remove(direct.root); direct = null; } await startDrive(); syncUI(); };
$('auto').onclick = () => { autopilot = !autopilot; $('auto').classList.toggle('on', autopilot); };
$('restart').onclick = () => { void startDrive(); };
$('phys').onclick = () => { realPhysics = !realPhysics; $('phys').textContent = realPhysics ? 'Physik: echt' : 'Physik: Stub'; void startDrive(); };
$('phys').textContent = realPhysics ? 'Physik: echt' : 'Physik: Stub';
$<HTMLSelectElement>('tier').onchange = (e) => { tier = (e.target as HTMLSelectElement).value as QualityTier; renderer.setQuality(QUALITY[tier]); };
function syncUI(): void {
  $('mShow').classList.toggle('on', mode === 'show');
  $('mDrive').classList.toggle('on', mode === 'drive');
  $('showUI').style.display = mode === 'show' ? '' : 'none';
  $('driveUI').style.display = mode === 'drive' ? '' : 'none';
}

stateButtons();
buildShowroom();
scene.background = new THREE.Color('#9fb9d6');

let infoT = 0;
function frame(dt: number): void {
  if (mode === 'show') updateShowroom(dt);
  else updateDrive(dt);
  if (direct) {
    direct.mixer.update(dt);
    direct.root.updateMatrixWorld(true);
    direct.root.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.update());
  }
  renderer.render(dt);
  infoT -= dt;
  if (infoT <= 0) {
    infoT = 0.5;
    const s = renderer.stats();
    $('info').textContent = `${s.backend}  ${s.fps.toFixed(0)} fps  ${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(0)}k tris\nfehlend: ${[...assets.missing].join(', ') || '-'}`;
  }
}

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

(window as unknown as { __actors: unknown }).__actors = {
  advance(seconds: number) { for (let t = 0; t < seconds; t += 1 / 60) frame(1 / 60); },
  get mode() { return mode; },
  setMode(m: 'show' | 'drive') { $(m === 'drive' ? 'mDrive' : 'mShow').click(); },
  setFocus(i: number) { focus = i; $<HTMLSelectElement>('focus').value = String(i); },
  flags, events, showKarts, assets, renderer,
  get drive() { return drive; },
  setPhysics(real: boolean) { realPhysics = real; return startDrive(); },
  playClipDirect,
  setTurn(a: number) { turning = false; turnAngle = a; },
  /** Renders one frame and returns it as a PNG blob (for automated visual checks). */
  async capture(): Promise<Blob | null> {
    return new Promise((r) => { frame(1 / 60); canvas.toBlob(r, 'image/png'); });
  },
  camera: baseCtx.camera,
};
