// Physics sandbox: drivable test circuit with debug rendering. Owner: physics.
// http://localhost:5173/sandbox/physics.html  (?ai=0 no opponents, ?char=capybara, ?class=turbo)
// window.__sb.advance(seconds) steps the loop manually (hidden tabs, scripted laps).
import * as THREE from 'three/webgpu';
import { character, emptyInput, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import { SIM_DT } from '../src/core/types';
import type { CharacterId, HitKind, InputState, KartController, RaceConfig, SimSystem } from '../src/core/types';
import { createPhysics, createLineDriver, PHYS } from '../src/physics';
import type { PhysKart } from '../src/physics';
import { WHEEL_LOCAL } from '../src/physics/kart';
import { createSandboxTrack } from '../src/physics/sandboxTrack';
import { createInputSources } from '../src/input';
import { createChaseCamera } from '../src/camera';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const speedEl = document.getElementById('speed')!;
const tierEls = [...document.querySelectorAll('#tier i')] as HTMLElement[];
const panel = document.getElementById('panel')!;

// --- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
await renderer.init();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3ff');
scene.fog = new THREE.Fog('#cfe8ff', 120, 520);
const camera = new THREE.PerspectiveCamera(64, 1, 0.2, 1500);
scene.add(new THREE.HemisphereLight('#ffffff', '#5d7d4c', 1.3));
const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
sun.position.set(80, 160, 60);
scene.add(sun);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize);
resize();

// --- sim --------------------------------------------------------------------
const track = createSandboxTrack();
const player: CharacterId = (q.get('char') as CharacterId) || 'otter';
const config: RaceConfig = {
  trackId: track.meta.id, player, mode: 'race', seed: 1,
  speedClass: SPEED_CLASSES.find((c) => c.id === q.get('class')) ?? SPEED_CLASSES[1],
  assists: { autoThrottle: false, steerAssist: q.get('assist') === '1' },
};

let countdown = false;
const lapTimes: number[] = [];
let lapStart = 0, lastProgress = 0;
const rules: SimSystem = {
  step(sim, dt) {
    sim.raceTime += dt;
    if (sim.phase === 'intro') sim.phase = countdown ? 'countdown' : 'racing';
    if (sim.phase === 'countdown' && sim.raceTime >= 0) { sim.phase = 'racing'; lapStart = sim.time; }
    const p = sim.player.loc.progress;
    if (lastProgress > track.length - 30 && p < 30) { lapTimes.unshift(sim.time - lapStart); lapTimes.length = Math.min(lapTimes.length, 5); lapStart = sim.time; }
    lastProgress = p;
  },
};

const aiCount = Number(q.get('ai') ?? 5);
const aiAll: { char: CharacterId; ctrl: KartController | null }[] = [
  { char: 'capybara', ctrl: createLineDriver({ lat: -3, throttle: 0.92 }) },
  { char: 'sheep', ctrl: createLineDriver({ lat: 3, throttle: 0.9, driftTurn: 0.5 }) },
  { char: 'hedgehog', ctrl: createLineDriver({ lat: 0, throttle: 0.88 }) },
  { char: 'penguin', ctrl: null }, // parked: something to bump into
  { char: 'sloth', ctrl: null },
  { char: 'redpanda', ctrl: createLineDriver({ lat: -1, throttle: 0.95, driftTurn: 0.5 }) },
  { char: 'axolotl', ctrl: createLineDriver({ lat: 2, throttle: 0.85 }) },
];
const aiDefs = aiAll.slice(0, aiCount);

let sim!: Sim;
let karts: PhysKart[] = [];
const playerInput: InputState = emptyInput();
let inputOverride: Partial<InputState> | null = null;
const playerCtrl: KartController = { update(k) { Object.assign(k.input, playerInput); if (inputOverride) Object.assign(k.input, inputOverride); } };
let physics!: Awaited<ReturnType<typeof createPhysics>>;

async function build(): Promise<void> {
  if (sim) { sim.dispose(); for (const v of kartViews) v.dispose(); kartViews.length = 0; }
  physics = await createPhysics(track, config);
  sim = new Sim({ config, track, physics, systems: [rules] });
  if (countdown) sim.raceTime = -3;
  const grid = [player, ...aiDefs.map((a) => a.char)];
  grid.forEach((id, i) => {
    const pose = i === 0 || aiDefs[i - 1].ctrl ? track.startGrid[i] : parkedPose(i);
    const k = physics.addKart({ char: character(id), isHuman: i === 0, pose });
    sim.karts.push(k);
    sim.controllers.set(k.id, i === 0 ? playerCtrl : aiDefs[i - 1].ctrl ?? { update(kk) { Object.assign(kk.input, emptyInput()); } });
  });
  karts = sim.karts as PhysKart[];
  sim.start();
  for (const k of karts) kartViews.push(createKartView(k));
  cam.setTarget(sim.player);
  lapStart = sim.time; lastProgress = sim.player.loc.progress;
  for (const ev of ['kart:driftStart', 'kart:driftEnd', 'kart:driftLevel', 'kart:boost', 'kart:jump', 'kart:land', 'kart:trick', 'kart:collide', 'kart:surface', 'kart:respawn', 'kart:hit', 'kart:startBoost', 'kart:slipstream'] as const) {
    sim.events.on(ev, (e: any) => {
      if (e.kart !== sim.player) return;
      const extra = e.cause ?? e.level ?? (e.impact !== undefined ? e.impact.toFixed(1) : undefined) ?? e.to ?? (e.quality !== undefined ? e.quality.toFixed(2) : undefined) ?? (e.impulse !== undefined ? Math.round(e.impulse) : '');
      log.unshift(`${sim.time.toFixed(1)} ${ev.slice(5)} ${extra ?? ''}`);
      log.length = Math.min(log.length, 8);
    });
  }
}
const log: string[] = [];

function parkedPose(i: number) {
  // Parked karts sit on the S3 straight and on the hill.
  const spots = [track.features[7].progress + 45, track.features[5].progress + 20];
  const f = track.sample(spots[(i - 1) % 2] + i * 3, i % 2 ? 3 : -2);
  return { pos: f.pos.clone().addScaledVector(f.up, 0.1), quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.forward) };
}

// --- track view ---------------------------------------------------------------
const colors: Record<string, string> = { road: '#8a8f99', offroad: '#6fb35c', wall: '#d9a441', ice: '#bfe9ff', boost: '#ff9a2b', sticky: '#e0a020', sand: '#e6d29a', water: '#3fa0d0' };
for (const c of track.colliders) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(c.vertices, 3));
  g.setIndex(new THREE.BufferAttribute(c.indices, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: colors[c.surface] ?? '#888', side: THREE.DoubleSide, roughness: 0.9, flatShading: c.kind === 'wall' || c.id.startsWith('bump') || c.id === 'ramp', polygonOffset: c.id !== 'road' && c.kind === 'ground', polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  scene.add(new THREE.Mesh(g, mat));
}
// Lane stripes and the start line, to read speed and position.
{
  const pts: number[] = [];
  const f = { pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 8 };
  for (let s = 0; s < track.length; s += 6) for (const lat of [-7.6, 7.6, 0]) {
    if (lat === 0 && Math.floor(s / 6) % 2) continue;
    track.sample(s, lat, 0, f); const a = f.pos.clone().addScaledVector(f.up, 0.04);
    track.sample(s + 3, lat, 0, f); const b = f.pos.clone().addScaledVector(f.up, 0.04);
    pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff' })));
}
const debugLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff3366' }));
debugLines.visible = false;
scene.add(debugLines);

// --- kart view (debug look) -----------------------------------------------------
interface KV { update(): void; dispose(): void }
const kartViews: KV[] = [];
const tierColors = ['#ffffff', '#59b8ff', '#ff9b2f', '#d066ff'];
function createKartView(k: PhysKart): KV {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const h = PHYS.chassisHalf;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(h.x * 2, h.y * 1.4, h.z * 2), new THREE.MeshStandardMaterial({ color: k.char.color, roughness: 0.6 }));
  chassis.position.y = PHYS.chassisCentreY - 0.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 12), new THREE.MeshStandardMaterial({ color: k.char.color, roughness: 0.8 }));
  head.position.set(0, 1.25, -0.2);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), new THREE.MeshStandardMaterial({ color: '#222' }));
  nose.position.set(0, 0.55, h.z);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: '#fff' }));
  spark.position.set(0, 0.2, -1.0);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), new THREE.MeshBasicMaterial({ color: '#7fd0ff', transparent: true, opacity: 0.25 }));
  shield.position.y = 0.6;
  body.add(chassis, head, nose, spark, shield);
  root.add(body);
  const wheels = WHEEL_LOCAL.map(() => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(PHYS.wheelRadius, PHYS.wheelRadius, 0.26, 14), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.9 }));
    m.rotation.z = Math.PI / 2;
    const pivot = new THREE.Group(); pivot.add(m);
    const spinner = new THREE.Group(); spinner.add(pivot);
    root.add(spinner);
    return { spinner, pivot, m };
  });
  scene.add(root);
  return {
    update() {
      root.position.copy(k.renderPos);
      root.quaternion.copy(k.renderQuat);
      body.rotation.z = k.lean * 0.6; // lean + = right; rotating about +Z lifts the left (+X) side
      const lvl = k.drift.active ? k.drift.level : 0;
      spark.visible = k.drift.active || k.boost.time > 0;
      (spark.material as THREE.MeshBasicMaterial).color.set(k.boost.time > 0 ? '#ffd23f' : tierColors[lvl]);
      spark.scale.setScalar(k.boost.time > 0 ? 2 : 1 + lvl * 0.5);
      shield.visible = k.shield || k.invulnerable > 0 && Math.floor(performance.now() / 90) % 2 === 0;
      for (let i = 0; i < 4; i++) {
        const w = wheels[i];
        w.spinner.position.set(WHEEL_LOCAL[i].x, WHEEL_LOCAL[i].y - k.suspLen[i], WHEEL_LOCAL[i].z);
        w.spinner.rotation.y = k.wheels[i].steer;
        w.pivot.rotation.x = k.wheels[i].spin;
        (w.m.material as THREE.MeshStandardMaterial).color.set(k.wheels[i].grounded ? '#222' : '#c33');
      }
    },
    dispose() { scene.remove(root); },
  };
}

// --- camera + input ---------------------------------------------------------------
const ctx = { scene, camera, quality: null as any, vfx: { spawn() {} }, assets: null as any, sim: null as Sim | null, time: 0 };
const cam = createChaseCamera(ctx as any);
const sources = createInputSources();
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (keys.has(e.code)) return;
  keys.add(e.code);
  const hits: Record<string, HitKind> = { Digit1: 'spin', Digit2: 'tumble', Digit3: 'squash', Digit4: 'zap', Digit5: 'bump' };
  if (hits[e.code]) sim.player.applyHit(hits[e.code], { dir: new THREE.Vector3(1, 0, 0).applyQuaternion(sim.player.quat), cause: 'sandbox' });
  if (e.code === 'KeyR') (sim.player as PhysKart).respawn(sim);
  if (e.code === 'KeyB') sim.player.applyBoost(1.5);
  if (e.code === 'KeyF') debugLines.visible = !debugLines.visible;
  if (e.code === 'KeyC') { countdown = true; build().then(() => { countdown = false; }); }
});
addEventListener('keyup', (e) => keys.delete(e.code));

// --- panel ---------------------------------------------------------------------
function button(row: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(b); b.blur(); }; row.appendChild(b); return b;
}
function section(title: string): HTMLElement {
  const t = document.createElement('b'); t.textContent = title; panel.appendChild(t);
  const r = document.createElement('div'); r.className = 'row'; panel.appendChild(r); return r;
}
const tp = section('Teleport');
for (const f of track.features) button(tp, f.name, () => teleportTo(f.name));
const opt = section('Options');
button(opt, 'Steer assist', (b) => { config.assists!.steerAssist = !config.assists!.steerAssist; b.classList.toggle('on', config.assists!.steerAssist); });
button(opt, 'Shield', () => { sim.player.shield = true; });
button(opt, 'Star', () => sim.player.addModifier({ id: 'star', time: 6, invincible: true, topSpeed: 1.15 }));
button(opt, 'Countdown', () => { countdown = true; build().then(() => { countdown = false; }); });
button(opt, 'Colliders', () => { debugLines.visible = !debugLines.visible; });

function teleportTo(name: string, speed = 0): void {
  const f = track.features.find((x) => x.name === name);
  if (f) place(f.progress, f.lat ?? 0, speed);
}
function place(progress: number, lat = 0, speed = 0): void {
  const fr = track.sample(progress, lat);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fr.forward);
  sim.player.teleport({ pos: fr.pos.clone().addScaledVector(fr.up, 0.15), quat }, false);
  if (speed > 0) sim.player.addImpulse(fr.forward.clone().multiplyScalar(speed * (sim.player as PhysKart).stats.mass));
  track.locate(sim.player.pos, undefined, sim.player.loc);
}

// --- loop ---------------------------------------------------------------------
let acc = 0, fps = 0, frames = 0, fpsT = 0, stepMs = 0;
function frame(dt: number): void {
  let active = false;
  for (const s of sources) if (!active && s.poll(playerInput)) active = true;
  if (!active) Object.assign(playerInput, emptyInput());
  acc += dt;
  let steps = 0;
  while (acc >= SIM_DT && steps < 5) {
    const t0 = performance.now();
    sim.step();
    stepMs = stepMs * 0.95 + (performance.now() - t0) * 0.05;
    acc -= SIM_DT; steps++;
  }
  if (steps === 5) acc = 0;
  sim.interpolate(acc / SIM_DT);
  ctx.sim = sim; ctx.time += dt;
  for (const v of kartViews) v.update();
  cam.update(dt, ctx as any);
  if (debugLines.visible) {
    const buf = physics.world.debugRender();
    debugLines.geometry.setAttribute('position', new THREE.BufferAttribute(buf.vertices, 3));
  }
  drawHud();
  renderer.render(scene, camera);
}

function drawHud(): void {
  const k = sim.player as PhysKart;
  speedEl.innerHTML = `${(Math.abs(k.speed) * 3.6).toFixed(0)}<small> km/h</small>`;
  tierEls.forEach((el, i) => { el.style.background = k.drift.active && k.drift.level > i ? tierColors[k.drift.level] : '#fff3'; });
  const surfaces = k.wheels.map((w) => (w.grounded ? w.surface[0] : '-')).join('');
  hud.textContent = [
    `speed   ${k.speed.toFixed(1)} / ${k.topSpeed.toFixed(1)} m/s`,
    `phase   ${sim.phase} ${sim.raceTime < 0 ? sim.raceTime.toFixed(1) : ''}`,
    `ground  ${k.nGrounded}/4 ${k.grounded ? '' : 'AIR ' + k.airTime.toFixed(2)}  ${surfaces}`,
    `surface ${k.surface}`,
    `drift   ${k.drift.active ? (k.drift.dir > 0 ? 'R' : 'L') + ' tier ' + k.drift.level + ' (' + k.drift.charge.toFixed(1) + 's)' : '-'}`,
    `boost   ${k.boost.time > 0 ? k.boost.time.toFixed(2) + 's x' + k.boost.power.toFixed(2) + ' ' + k.boostCause : '-'}`,
    `slip    ${k.slipstream.toFixed(2)}  yaw ${k.yawRate.toFixed(2)}  lean ${k.lean.toFixed(2)}`,
    `stun    ${k.stun > 0 ? k.stunKind + ' ' + k.stun.toFixed(2) : '-'}  inv ${k.invulnerable.toFixed(1)}`,
    `loc     ${k.loc.progress.toFixed(0)}m lat ${k.loc.lat.toFixed(1)} h ${k.loc.height.toFixed(2)}`,
    `laps    ${lapTimes.map((t) => t.toFixed(2)).join('  ') || '-'}   cur ${(sim.time - lapStart).toFixed(1)}`,
    `perf    ${fps.toFixed(0)} fps  step ${stepMs.toFixed(2)} ms (${karts.length} karts)`,
    '',
    ...log,
  ].join('\n');
}

await build();
let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  frame(dt);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Debug handle for scripted checks.
(window as any).__sb = {
  get sim() { return sim; },
  get player() { return sim.player; },
  track, PHYS, cam,
  advance(seconds: number) { for (let t = 0; t < seconds - 1e-9; t += SIM_DT) frame(SIM_DT); },
  set input(v: Partial<InputState> | null) { inputOverride = v; },
  get input() { return inputOverride; },
  teleportTo,
  place,
  rebuild: build,
  lapTimes,
  log,
};
