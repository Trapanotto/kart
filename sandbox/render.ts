// Render look-dev sandbox. Owner: render.
// http://localhost:5173/sandbox/render.html  (?webgl forces WebGL2, ?debug shows the stats overlay, ?tier=mobile)
import {
  BoxGeometry, CircleGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three/webgpu';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { QUALITY } from '../src/core/quality';
import { Sim } from '../src/core/sim';
import { SIM_DT, type EnvironmentDef, type QualityTier, type SurfaceType, type View } from '../src/core/types';
import { applyWind, emissivePulse, roadMaterial, stylizedWater, toonPBR } from '../src/render/materials';
import { STAGE_KEYS } from '../src/render/post';
import { createRenderer } from '../src/render/renderer';
import { EFFECT_NAMES } from '../src/render/vfx/effects';
import { WEATHER_KINDS } from '../src/render/vfx/weather';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAssets, createStubCamera, createStubKartView, createStubTrackView } from '../src/stubs/stubRender';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { createTestTrack } from '../src/stubs/testTrack';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const panel = document.getElementById('panel')!;
const statusEl = document.getElementById('status')!;

const ENVS: Record<string, EnvironmentDef> = {
  day: { hdr: null, skyTop: '#4f9fe8', skyHorizon: '#dbefff', sunDir: [0.45, 0.75, 0.35], sunColor: '#fff2dc', sunIntensity: 3.2, ambientIntensity: 1, fogColor: '#cfe6ff', fogDensity: 0.0025, exposure: 1 },
  hdr: { hdr: 'meadow_day', skyTop: '#4f9fe8', skyHorizon: '#dbefff', sunDir: [0.45, 0.75, 0.35], sunColor: '#fff2dc', sunIntensity: 3.2, ambientIntensity: 1, fogColor: '#cfe6ff', fogDensity: 0.0025, exposure: 1 },
  sunset: { hdr: null, skyTop: '#3a5fa8', skyHorizon: '#ffb37a', sunDir: [-0.7, 0.18, 0.5], sunColor: '#ffb070', sunIntensity: 3.0, ambientIntensity: 0.7, fogColor: '#f3b48c', fogDensity: 0.004, weather: 'pollen', exposure: 1.1 },
  rain: { hdr: null, skyTop: '#7d8a9c', skyHorizon: '#c6ced8', sunDir: [0.3, 0.8, 0.2], sunColor: '#e6ecf5', sunIntensity: 1.4, ambientIntensity: 1.2, fogColor: '#b9c3cf', fogDensity: 0.006, weather: 'rain', exposure: 1.1 },
  snow: { hdr: null, skyTop: '#8fb7e6', skyHorizon: '#f2f7ff', sunDir: [0.3, 0.5, -0.6], sunColor: '#fff8ef', sunIntensity: 2.6, ambientIntensity: 1.2, fogColor: '#e9f1ff', fogDensity: 0.004, weather: 'snow', exposure: 0.95 },
  dusk: { hdr: null, skyTop: '#1c2450', skyHorizon: '#7a5c9a', sunDir: [0.6, 0.2, -0.5], sunColor: '#ff9a7a', sunIntensity: 1.2, ambientIntensity: 0.5, fogColor: '#5a4a7a', fogDensity: 0.005, weather: 'fireflies', exposure: 1.3 },
  petals: { hdr: null, skyTop: '#5aa9e6', skyHorizon: '#ffe6f0', sunDir: [0.4, 0.7, 0.4], sunColor: '#fff0e6', sunIntensity: 3, ambientIntensity: 1, fogColor: '#f5e0ec', fogDensity: 0.0025, weather: 'petals', exposure: 1 },
};

async function main() {
  const tier = (params.get('tier') as QualityTier) || 'high';
  const assets = createStubAssets();
  const renderer = createRenderer(canvas, QUALITY[tier], assets);
  await renderer.init();
  renderer.setQuality(QUALITY[tier]);
  const ctx = renderer.ctx;
  const resize = () => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  addEventListener('resize', resize);
  resize();

  // ---- race on the test track with stubs
  const track = createTestTrack();
  const physics = createStubPhysics();
  const sim = new Sim({ config: { trackId: 'test', speedClass: SPEED_CLASSES[1], player: 'otter', laps: 99, mode: 'race' }, track, physics, systems: [createStubRules()] });
  CHARACTERS.forEach((c, i) => {
    const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: track.startGrid[i] });
    sim.karts.push(k);
    sim.controllers.set(k.id, createStubAI());
  });
  let envName = params.get('env') || 'day';
  await renderer.setEnvironment(ENVS[envName]);
  renderer.bindSim(sim);
  const views: View[] = [await createStubTrackView(track, ctx)];
  for (const k of sim.karts) views.push(createStubKartView(k, ctx));
  const chase = createStubCamera(ctx);
  chase.setTarget(sim.player);
  sim.start();
  sim.interpolate(1);

  // ---- look-dev scene inside the oval (x -40..-18)
  const S = ctx.scene;
  const add = (m: Mesh | InstancedMesh, cast = true) => { m.castShadow = cast; m.receiveShadow = true; S.add(m); return m; };
  // Road strip with the road helper (wetness toggle).
  const road = roadMaterial({ color: '#6f6a66' });
  const roadMesh = add(new Mesh(new PlaneGeometry(6, 60), road), false);
  roadMesh.rotation.x = -Math.PI / 2; roadMesh.position.set(-24, 0.01, 0);
  // Spheres
  const sphereDefs: [string, number, number][] = [['#ff6f91', 0.55, 0], ['#ffd447', 0.35, 0], ['#5fb8ff', 0.7, 0], ['#d8d8e0', 0.18, 1], ['#9be37a', 0.9, 0], ['#c58cff', 0.25, 0]];
  sphereDefs.forEach(([c, r, m], i) => {
    const mat = m > 0 ? new MeshStandardMaterial({ color: c, roughness: r, metalness: m }) : toonPBR({ color: c, roughness: r });
    const s = add(new Mesh(new SphereGeometry(0.9, 48, 32), mat));
    s.position.set(-31, 0.9, -12 + i * 3.2);
  });
  // Boxes / crates
  for (let i = 0; i < 4; i++) {
    const b = add(new Mesh(new BoxGeometry(1.4, 1.4, 1.4), toonPBR({ color: ['#c98b52', '#f2efe8', '#ef8a5a', '#7aa0c8'][i], roughness: 0.8 })));
    b.position.set(-35, 0.7, -8 + i * 4); b.rotation.y = i * 0.4;
  }
  // Boost pad and item box with emissive pulse
  const pad = new MeshStandardMaterial({ color: '#ff9a2b', roughness: 0.4 }) as unknown as Parameters<typeof emissivePulse>[0];
  const padMesh = add(new Mesh(new BoxGeometry(3, 0.12, 4), toonPBR({ color: '#ff9a2b', roughness: 0.4 })), false);
  emissivePulse(padMesh.material as never, { color: '#ffa030', intensity: 2.2, speed: 2 });
  padMesh.position.set(-24, 0.06, 14);
  void pad;
  const boxMesh = add(new Mesh(new BoxGeometry(1.2, 1.2, 1.2), toonPBR({ color: '#ffd447', roughness: 0.3, rim: 0.6 })));
  emissivePulse(boxMesh.material as never, { color: '#ffcf40', intensity: 1.2, speed: 1 });
  boxMesh.position.set(-24, 1.4, -14);
  // Trees: instanced trunks + wind-swayed foliage
  const N = 26;
  const trunks = new InstancedMesh(new CylinderGeometry(0.18, 0.28, 2.4, 8).translate(0, 1.2, 0), toonPBR({ color: '#7a5434', roughness: 0.9, sss: 0 }), N);
  const leafMat = toonPBR({ color: '#5fae4a', roughness: 0.85, sss: 0.6, sssColor: '#c6ff7a' });
  applyWind(leafMat, { strength: 0.25, height: 4.2 });
  const crowns = new InstancedMesh(new IcosahedronGeometry(1.4, 1).translate(0, 3.2, 0), leafMat, N);
  const m4 = new Matrix4(), q4 = new Quaternion(), p4 = new Vector3(), s4 = new Vector3();
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    p4.set(-12 + Math.cos(a) * 9 + (i % 3), 0, Math.sin(a) * 50);
    if (i % 2) p4.set(-75 - (i % 4) * 3, 0, -60 + i * 5);
    const sc = 0.8 + (i % 5) * 0.12;
    m4.compose(p4, q4.setFromAxisAngle(new Vector3(0, 1, 0), i), s4.set(sc, sc, sc));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4);
  }
  add(trunks); add(crowns);
  // Pond with stylised water, a sand mound and rocks poking through for shoreline foam.
  const water = stylizedWater({ sceneDepth: renderer.ctx.quality.tier !== 'mobile' });
  const pond = add(new Mesh(new CircleGeometry(7, 48), water), false);
  pond.rotation.x = -Math.PI / 2; pond.position.set(-30, 0.35, 24);
  pond.receiveShadow = false;
  const sand = add(new Mesh(new SphereGeometry(3, 32, 16), toonPBR({ color: '#e7d49c', roughness: 1 })));
  sand.scale.set(1, 0.18, 1); sand.position.set(-28, 0, 25);
  for (let i = 0; i < 5; i++) {
    const rock = add(new Mesh(new DodecahedronGeometry(0.7 + i * 0.12, 0), toonPBR({ color: '#9a958c', roughness: 0.9 })));
    rock.position.set(-34 + i * 1.6, 0.2, 20 + (i % 2) * 6);
  }

  // Stub views do not opt into shadows; do it here so the look-dev shows grounded objects.
  S.traverse((o) => { if ((o as Mesh).isMesh && !o.name.startsWith('vfx')) { o.receiveShadow = true; if (!(o as Mesh).userData.collider) o.castShadow = true; } });
  pond.receiveShadow = false; pond.castShadow = false;

  // ---- loop
  let acc = 0;
  let camMode: 'chase' | 'lookdev' = (params.get('cam') as 'chase') || 'chase';
  let orbit = 0.6;
  let fixedCam: [Vector3, Vector3] | null = null;
  const camAt = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => { camMode = 'lookdev'; fixedCam = [new Vector3(px, py, pz), new Vector3(tx, ty, tz)]; };
  const look = new Vector3(-29, 1.2, 4);
  function frame(dt: number) {
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < 5) { sim.step(); acc -= SIM_DT; steps++; }
    if (steps === 5) acc = 0;
    sim.interpolate(acc / SIM_DT);
    for (const v of views) v.update(dt, ctx);
    if (camMode === 'chase') chase.update(dt, ctx);
    else if (fixedCam) { ctx.camera.position.copy(fixedCam[0]); ctx.camera.lookAt(fixedCam[1]); }
    else {
      orbit += dt * 0.05;
      ctx.camera.position.set(look.x - Math.cos(orbit) * 22, 7, look.z - Math.sin(orbit) * 22);
      ctx.camera.lookAt(look);
    }
    const p = sim.player;
    renderer.setFeel({ speed: Math.min(1, Math.abs(p.speed) / (p.topSpeed * 1.3)), boost: p.boost.time > 0 ? 1 : 0, hit: p.stun > 0 ? 1 : 0 });
    renderer.render(dt);
  }
  let last = performance.now();
  const tick = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const advance = (seconds: number) => { for (let t = 0; t < seconds; t += SIM_DT) frame(SIM_DT); };

  // ---- panel
  const c = renderer.controls;
  const section = (title: string) => { const h = document.createElement('h3'); h.textContent = title; panel.appendChild(h); const d = document.createElement('div'); panel.appendChild(d); return d; };
  const button = (parent: HTMLElement, label: string, fn: () => void, on?: () => boolean) => {
    const b = document.createElement('button'); b.textContent = label;
    const refresh = () => b.classList.toggle('on', !!on?.());
    b.onclick = () => { fn(); refreshAll(); };
    parent.appendChild(b); refreshers.push(refresh); return b;
  };
  const refreshers: (() => void)[] = [];
  const refreshAll = () => refreshers.forEach((r) => r());

  const tiers = section('Quality tier');
  for (const t of ['high', 'medium', 'mobile'] as QualityTier[]) button(tiers, t, () => c.setTier(t), () => ctx.quality.tier === t);
  button(tiers, 'dynres', () => { c.dynres.enabled = !c.dynres.enabled; if (!c.dynres.enabled) c.dynres.scale = 1; }, () => c.dynres.enabled);
  const st = section('Post stages');
  for (const k of STAGE_KEYS) button(st, k, () => c.setStages({ [k]: !c.stages()[k] }), () => c.stages()[k]);
  const cam = section('Camera');
  button(cam, 'chase', () => (camMode = 'chase'), () => camMode === 'chase');
  button(cam, 'look-dev', () => { camMode = 'lookdev'; fixedCam = null; }, () => camMode === 'lookdev');
  const fx = section('VFX one-shots (at look-dev / ahead of player)');
  const fxPos = new Vector3(), fwd = new Vector3();
  for (const n of [...EFFECT_NAMES, 'respawn', 'unknown']) button(fx, n, () => {
    if (camMode === 'lookdev') fxPos.set(-26, 0.5, 2);
    else { fwd.set(0, 0, 1).applyQuaternion(sim.player.renderQuat); fxPos.copy(sim.player.renderPos).addScaledVector(fwd, 9).setY(0.6); }
    ctx.vfx.spawn(n, fxPos, { scale: 1 });
  });
  const ks = section('Player kart state');
  const pl = sim.player;
  for (let lv = 0; lv <= 3; lv++) button(ks, `drift ${lv}`, () => { const on = !(pl.drift.active && pl.drift.level === lv); pl.drift.active = on; pl.drift.level = lv as 0; pl.drift.dir = 1; if (on) sim.events.emit('kart:driftLevel', { kart: pl, level: lv }); }, () => pl.drift.active && pl.drift.level === lv);
  button(ks, 'boost', () => pl.applyBoost(2.5, 1.3), () => pl.boost.time > 0);
  button(ks, 'slipstream', () => (pl.slipstream = pl.slipstream > 0 ? 0 : 0.9), () => pl.slipstream > 0);
  button(ks, 'hit', () => pl.applyHit('spin'));
  button(ks, 'land', () => sim.events.emit('kart:land', { kart: pl, airTime: 1, impact: 8 }));
  button(ks, 'collide', () => sim.events.emit('kart:collide', { kart: pl, other: sim.karts[0], impulse: 20, point: pl.renderPos.clone().add(new Vector3(0.8, 0.5, 0.5)) }));
  button(ks, 'respawn', () => sim.events.emit('kart:respawn', { kart: pl }));
  const surfs: SurfaceType[] = ['road', 'offroad', 'sand', 'water', 'ice', 'sticky'];
  const setSurface = (s: SurfaceType) => { pl.surface = s; for (const w of pl.wheels) { w.surface = s; w.slip = s === 'road' ? 0 : 0.2; } };
  for (const s of surfs) button(ks, s, () => setSurface(s), () => pl.surface === s);
  button(ks, 'skid', () => { for (const w of pl.wheels) w.slip = w.slip > 0.5 ? 0 : 0.8; }, () => pl.wheels[2].slip > 0.5);
  const we = section('Environment / weather');
  for (const e of Object.keys(ENVS)) button(we, e, () => { envName = e; void renderer.setEnvironment(ENVS[e]); }, () => envName === e);
  const wx = section('Weather only');
  for (const w of [...WEATHER_KINDS, 'none']) button(wx, w, () => c.weather.set(w === 'none' ? null : w, ctx.quality.density), () => (c.weather.current ?? 'none') === w);
  const misc = section('Materials');
  button(misc, 'wet road', () => { const wv = (road.userData.wetness as { value: number }); wv.value = wv.value > 0 ? 0 : 1; }, () => (road.userData.wetness as { value: number }).value > 0);

  addEventListener('keydown', (e) => { if (e.code === 'KeyH') panel.style.display = panel.style.display === 'none' ? '' : 'none'; });
  setInterval(() => {
    const s = renderer.stats();
    statusEl.textContent = `${s.backend} | ${ctx.quality.tier}\n${s.fps.toFixed(0)} fps ${c.frameMs().toFixed(1)} ms\ndraws ${s.drawCalls} tris ${(s.triangles / 1000).toFixed(0)}k\nscale ${c.scale().toFixed(2)} target ${c.dynres.target}`;
    refreshAll();
  }, 400);
  refreshAll();

  /** Renders one frame and returns the canvas as a data URL (works while the tab is in the background). */
  const snap = (type = 'image/jpeg') => { frame(SIM_DT); return canvas.toDataURL(type, 0.92); };
  Object.assign(window, { ENVS, snap, advance, sim, renderer, ctx, setCam: (m: 'chase' | 'lookdev') => { camMode = m; fixedCam = null; }, camAt });
}

main().catch((e) => { statusEl.textContent = String(e?.stack ?? e); console.error(e); });
