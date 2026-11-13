// Track sandbox. Owner: track.
// http://localhost:5173/sandbox/track.html  (?track=kleeblatt  ?stub  ?tier=mobile  ?lap=2)
// Fly / orbit over the built track with debug overlays, a top-down map, a lap selector for the lap
// events and a drive-through with the stub physics + stub AI. window.__track.advance(seconds).
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { createEntityView, setFallbackEntityView } from '../src/core/entityViews';
import { QUALITY } from '../src/core/quality';
import { Sim } from '../src/core/sim';
import { SIM_DT, type AssetLibrary, type GameRenderer, type Kart, type QualityTier, type SimEntity, type View } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAssets, createStubEntityView, createStubKartView, createStubRenderer } from '../src/stubs/stubRender';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { BuiltTrack } from '../src/track/builder';
import { loadTrack, TRACK_DEFS } from '../src/track';
import { createTrackView } from '../src/track/view/trackView';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
const panel = document.getElementById('panel')!;
const statusEl = document.getElementById('status')!;
setFallbackEntityView(createStubEntityView);

const SURF_COL: Record<string, string> = { road: '#8a8f99', offroad: '#6fb35c', wall: '#d9a441', ice: '#bfe9ff', boost: '#ff9a2b', sticky: '#e0a020', sand: '#e6d29a', water: '#3fa0d0' };

async function makeRenderer(tier: QualityTier): Promise<{ renderer: GameRenderer; assets: AssetLibrary }> {
  if (!params.has('stub')) {
    try {
      const [{ createRenderer }, { createAssets }] = await Promise.all([import('../src/render/renderer'), import('../src/actors')]);
      const assets = createAssets();
      const renderer = createRenderer(canvas, QUALITY[tier], assets);
      await renderer.init();
      return { renderer, assets };
    } catch (e) {
      console.warn('[track sandbox] real renderer unavailable, using stubs', e);
    }
  }
  const assets = createStubAssets();
  const renderer = createStubRenderer(canvas, QUALITY[tier], assets);
  await renderer.init();
  return { renderer, assets };
}

async function main() {
  const tier = (params.get('tier') as QualityTier) || 'high';
  const { renderer } = await makeRenderer(tier);
  renderer.setQuality(QUALITY[tier]);
  const resize = () => renderer.resize(innerWidth, innerHeight);
  addEventListener('resize', resize);
  resize();
  const ctx = renderer.ctx;
  const camera = ctx.camera;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;

  let trackId = params.get('track') ?? TRACK_DEFS[0].id;
  let track!: BuiltTrack;
  let sim!: Sim;
  let views: View[] = [];
  const entityViews = new Map<SimEntity, View>();
  let trackView: View | null = null;
  const overlays = new THREE.Group();
  ctx.scene.add(overlays);
  let unsub: (() => void)[] = [];

  async function setup(): Promise<void> {
    for (const u of unsub) u();
    unsub = [];
    for (const v of views) v.dispose();
    for (const v of entityViews.values()) v.dispose();
    entityViews.clear();
    trackView?.dispose();
    views = [];
    const t0 = performance.now();
    track = (await loadTrack(trackId)) as BuiltTrack;
    const buildMs = performance.now() - t0;
    await renderer.setEnvironment(track.meta.environment);
    const physics = createStubPhysics();
    sim = new Sim({ config: { trackId, speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race', seed: 3 }, track, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: track.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    unsub.push(
      sim.events.on('entity:add', ({ entity }) => { const v = createEntityView(entity, ctx); if (v) entityViews.set(entity, v); }),
      sim.events.on('entity:remove', ({ entity }) => { entityViews.get(entity)?.dispose(); entityViews.delete(entity); }),
      sim.events.on('track:event', (e) => log(`track:event ${e.name}`)),
      sim.events.on('track:changed', (e) => log(`track:changed lap ${e.lap} ${e.event}`)),
    );
    renderer.bindSim(sim);
    const t1 = performance.now();
    trackView = await createTrackView(track, ctx);
    const viewMs = performance.now() - t1;
    for (const k of sim.karts) views.push(createStubKartView(k, ctx));
    sim.start();
    sim.interpolate(1);
    buildOverlays();
    drawMapBase();
    log(`built ${trackId}: runtime ${buildMs.toFixed(0)} ms, view ${viewMs.toFixed(0)} ms, length ${track.length.toFixed(0)} m`);
    const lap = Number(params.get('lap') ?? 0);
    if (lap > 1) track.setLap(lap, sim);
    if (!camSet) setOrbit();
  }

  // ---------------------------------------------------------------- overlays
  const layers: Record<string, THREE.Object3D> = {};
  const layerOn: Record<string, boolean> = { centre: false, line: true, zones: false, colliders: false, branches: true, grid: false, barriers: false };
  function line(pts: THREE.Vector3[], color: string, loop = false): THREE.Line {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    const l = loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
    l.renderOrder = 10;
    return l;
  }
  function buildOverlays(): void {
    overlays.clear();
    for (const k of Object.keys(layerOn)) { layers[k] = new THREE.Group(); overlays.add(layers[k]); }
    const lift = (v: THREE.Vector3) => v.clone().add(new THREE.Vector3(0, 0.15, 0));
    for (const p of track.paths) {
      const target = p.index === 0 ? layers.centre : layers.branches;
      target.add(line(p.pos.map(lift), p.index === 0 ? '#ffffff' : '#36e0ff', p.closed));
      for (const side of [-1, 1]) target.add(line(p.pos.map((v, i) => lift(v.clone().addScaledVector(p.right[i], side * p.hw[i]))), p.index === 0 ? '#bbbbbb' : '#36e0ff', p.closed));
      // racing line, coloured by target speed
      const pts: THREE.Vector3[] = [], cols: number[] = [];
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        pts.push(lift(p.pos[i].clone().addScaledVector(p.right[i], track.rlLat[p.index][i])).add(new THREE.Vector3(0, 0.1, 0)));
        c.setHSL(0.33 * Math.max(0, (track.rlSpeed[p.index][i] - 0.4) / 0.6), 1, 0.5);
        cols.push(c.r, c.g, c.b);
      }
      if (p.closed) { pts.push(pts[0]); cols.push(cols[0], cols[1], cols[2]); }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
      l.renderOrder = 11;
      layers.line.add(l);
    }
    for (const z of track.zones) {
      const pts: THREE.Vector3[] = [];
      const span = (z.to - z.from + track.length) % track.length;
      for (let d = 0; d <= span; d += 1) for (const s of [-1]) pts.push(lift(track.sample(z.from + d, s * (track.sample(z.from + d).halfWidth), z.path).pos));
      for (let d = span; d >= 0; d -= 1) pts.push(lift(track.sample(z.from + d, track.sample(z.from + d).halfWidth, z.path).pos));
      layers.zones.add(line(pts, z.kind === 'trick' ? '#ff4fd8' : '#ffe14f', true));
    }
    for (const c of track.colliders) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(c.vertices, 3));
      g.setIndex(new THREE.BufferAttribute(c.indices, 1));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c.kind === 'wall' ? '#ff3b3b' : SURF_COL[c.surface] ?? '#fff', wireframe: true, transparent: true, opacity: 0.55 }));
      m.userData.collider = c;
      m.position.y = 0.03;
      layers.colliders.add(m);
    }
    for (const g of track.startGrid) {
      const f = new THREE.Vector3(0, 0, 2.2).applyQuaternion(g.quat);
      layers.grid.add(line([lift(g.pos), lift(g.pos.clone().add(f))], '#ffef5a'));
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 2), new THREE.MeshBasicMaterial({ color: '#ffef5a', wireframe: true }));
      m.position.copy(g.pos); m.quaternion.copy(g.quat);
      layers.grid.add(m);
    }
    for (const b of track.itemBoxes) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffd447', wireframe: true }));
      m.position.copy(b.pos);
      layers.grid.add(m);
    }
    for (const b of track.barriers) layers.barriers.add(line(b.pts.map((p) => p.clone().add(new THREE.Vector3(0, b.height, 0))), b.style === 'stone' ? '#c0c0c0' : b.style === 'hedge' ? '#2fbf4f' : '#ff9a3c'));
    applyLayers();
  }
  function applyLayers(): void { for (const [k, o] of Object.entries(layers)) o.visible = layerOn[k]; }

  // ---------------------------------------------------------------- map
  const mctx = mapCanvas.getContext('2d')!;
  let mapBase: ImageData | null = null;
  let mapTf = { s: 1, ox: 0, oz: 0 };
  // map: east (= -x) to the right, north (+z) up
  const toMap = (x: number, z: number): [number, number] => [(-x - mapTf.ox) * mapTf.s, mapCanvas.height - (z - mapTf.oz) * mapTf.s];
  function drawMapBase(): void {
    const T = track.terrain;
    const W = mapCanvas.width, H = mapCanvas.height;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.paths) for (const v of p.pos) { minX = Math.min(minX, -v.x); maxX = Math.max(maxX, -v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
    const pad = 40;
    const s = Math.min(W / (maxX - minX + 2 * pad), H / (maxZ - minZ + 2 * pad));
    mapTf = { s, ox: minX - pad - ((W / s) - (maxX - minX + 2 * pad)) / 2, oz: minZ - pad - ((H / s) - (maxZ - minZ + 2 * pad)) / 2 };
    const img = mctx.createImageData(W, H);
    for (let py = 0; py < H; py += 1) for (let px = 0; px < W; px += 1) {
      const e = px / s + mapTf.ox, z = (H - py) / s + mapTf.oz, x = -e;
      const h = T.heightAt(x, z);
      const hx = T.heightAt(x - 1, z) - h, hz = T.heightAt(x, z + 1) - h;
      const shade = Math.max(0.55, Math.min(1.25, 1 + (hx - hz) * 0.35));
      const water = T.waterLevelAt(x, z) !== null;
      const band = Math.floor(h / 2) % 2 === 0 ? 1 : 0.94;
      const k = (py * W + px) * 4;
      const base = water ? [70, 140, 190] : [90 + h * 3, 140 + h * 2, 80];
      img.data[k] = base[0] * shade * band; img.data[k + 1] = base[1] * shade * band; img.data[k + 2] = base[2] * shade * band; img.data[k + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    // roads
    for (const p of track.paths) {
      mctx.beginPath();
      for (let i = 0; i <= p.count - (p.closed ? 0 : 1); i++) {
        const v = p.pos[i % p.count];
        const [mx, my] = toMap(v.x, v.z);
        if (i === 0) mctx.moveTo(mx, my); else mctx.lineTo(mx, my);
      }
      mctx.strokeStyle = p.index === 0 ? '#3a3a40' : p.enabled ? '#2e7ea8' : '#5a6a78';
      mctx.lineWidth = Math.max(2, p.hw[0] * 2 * s);
      mctx.lineJoin = 'round';
      mctx.stroke();
    }
    // barriers
    for (const b of track.barriers) {
      mctx.beginPath();
      b.pts.forEach((v, k) => { const [mx, my] = toMap(v.x, v.z); if (k === 0) mctx.moveTo(mx, my); else mctx.lineTo(mx, my); });
      mctx.strokeStyle = b.style === 'stone' ? '#ddd' : b.style === 'hedge' ? '#1d6b2c' : '#a0622c';
      mctx.lineWidth = 1.2;
      mctx.stroke();
    }
    // props
    for (const pr of track.props) {
      if (pr.detail) continue;
      const [mx, my] = toMap(pr.x, pr.z);
      mctx.fillStyle = pr.name.startsWith('tree') ? '#1f5a26' : '#d65a3a';
      mctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // racing line
    const p0 = track.paths[0];
    mctx.beginPath();
    for (let i = 0; i <= p0.count; i++) {
      const k = i % p0.count;
      const v = p0.pos[k].clone().addScaledVector(p0.right[k], track.rlLat[0][k]);
      const [mx, my] = toMap(v.x, v.z);
      if (i === 0) mctx.moveTo(mx, my); else mctx.lineTo(mx, my);
    }
    mctx.strokeStyle = '#ff5050'; mctx.lineWidth = 1; mctx.stroke();
    // pads, boxes, anchors
    for (const pad of track.pads) { const v = track.frameOn(track.paths[pad.path], pad.s0 + pad.length / 2, pad.lat).pos; const [mx, my] = toMap(v.x, v.z); mctx.fillStyle = '#ff9a2b'; mctx.fillRect(mx - 3, my - 3, 6, 6); }
    for (const b of track.itemBoxes) { const [mx, my] = toMap(b.pos.x, b.pos.z); mctx.fillStyle = '#ffe24a'; mctx.fillRect(mx - 2, my - 2, 4, 4); }
    mctx.font = '13px system-ui';
    mctx.fillStyle = '#fff';
    for (const [name, s0] of p0.anchors) { const v = track.frameOn(p0, s0).pos; const [mx, my] = toMap(v.x, v.z); mctx.fillText(`${name} ${s0.toFixed(0)}`, mx + 5, my - 4); }
    mapBase = mctx.getImageData(0, 0, W, H);
  }
  function drawMap(): void {
    if (!mapBase) return;
    mctx.putImageData(mapBase, 0, 0);
    for (const k of sim.karts) {
      const [mx, my] = toMap(k.pos.x, k.pos.z);
      mctx.fillStyle = k.char.color; mctx.strokeStyle = '#000';
      mctx.beginPath(); mctx.arc(mx, my, 5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    }
    for (const e of sim.entities) { const [mx, my] = toMap(e.pos.x, e.pos.z); mctx.fillStyle = e.kind === 'hazard.sheep' ? '#fff' : '#e8c867'; mctx.fillRect(mx - 2, my - 2, 4, 4); }
    const [cx, cy] = toMap(camera.position.x, camera.position.z);
    mctx.strokeStyle = '#ff2'; mctx.beginPath(); mctx.arc(cx, cy, 7, 0, Math.PI * 2); mctx.stroke();
  }
  mapCanvas.addEventListener('click', () => mapCanvas.classList.toggle('big'));

  // ---------------------------------------------------------------- camera modes
  type Mode = 'orbit' | 'chase' | 'eye' | 'top';
  let mode: Mode = 'orbit';
  let follow = 7;
  let eyeProgress = 0, eyeLat = 0, eyePath = 0;
  let camSet = false;
  function setOrbit(): void {
    mode = 'orbit';
    controls.enabled = true;
    const c = track.sample(0).pos;
    camera.position.set(c.x + 60, c.y + 90, c.z - 120);
    controls.target.copy(c);
    camSet = true;
  }
  function setTop(): void {
    mode = 'top';
    controls.enabled = true;
    const T = track.terrain;
    const cx = T.x0 + (T.nx * T.cell) / 2, cz = T.z0 + (T.nz * T.cell) / 2;
    camera.position.set(cx, 520, cz - 1);
    controls.target.set(cx, 0, cz);
  }
  const look = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function updateCamera(dt: number): void {
    if (mode === 'chase') {
      const k = sim.karts[follow];
      const back = tmpV.set(0, 0, 1).applyQuaternion(k.renderQuat);
      const want = k.renderPos.clone().addScaledVector(back, -7.5).add(new THREE.Vector3(0, 3.2, 0));
      camera.position.lerp(want, 1 - Math.exp(-6 * dt));
      look.copy(k.renderPos).addScaledVector(back, 6).add(new THREE.Vector3(0, 1, 0));
      camera.lookAt(look);
    } else if (mode === 'eye') {
      const f = track.sample(eyeProgress, eyeLat, eyePath);
      camera.position.copy(f.pos).addScaledVector(f.up, 1.6);
      const a = track.sample(eyeProgress + 22, eyeLat * 0.5, eyePath);
      camera.lookAt(a.pos.x, a.pos.y + 1.0, a.pos.z);
    } else controls.update();
  }

  // ---------------------------------------------------------------- UI
  const logs: string[] = [];
  function log(s: string): void { logs.unshift(s); logs.length = Math.min(logs.length, 6); console.log('[track]', s); }
  function section(title: string): HTMLElement { const h = document.createElement('h3'); h.textContent = title; panel.appendChild(h); const d = document.createElement('div'); panel.appendChild(d); return d; }
  function button(parent: HTMLElement, label: string, fn: (b: HTMLButtonElement) => void, on = false): HTMLButtonElement {
    const b = document.createElement('button'); b.textContent = label; if (on) b.classList.add('on'); b.onclick = () => fn(b); parent.appendChild(b); return b;
  }
  const trk = section('Track');
  for (const d of TRACK_DEFS) button(trk, d.name, async () => { trackId = d.id; camSet = false; await setup(); });
  const lapS = section('Lap events (leader lap)');
  for (const n of [1, 2, 3]) button(lapS, `Lap ${n}`, async () => {
    if (n < track.state.lap) { await setup(); }
    track.setLap(n, sim);
  });
  button(lapS, 'Reset', () => setup());
  const camS = section('Camera');
  button(camS, 'Orbit', () => setOrbit());
  button(camS, 'Top', () => setTop());
  button(camS, 'Chase', () => { mode = 'chase'; controls.enabled = false; });
  button(camS, 'Next kart', () => { follow = (follow + 1) % sim.karts.length; });
  button(camS, 'Driver eye', () => { mode = 'eye'; controls.enabled = false; });
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '1000'; slider.value = '0';
  slider.oninput = () => { eyeProgress = (Number(slider.value) / 1000) * track.length; mode = 'eye'; controls.enabled = false; };
  camS.appendChild(slider);
  const simS = section('Drive-through');
  let running = false;
  button(simS, 'Run / pause', (b) => { running = !running; b.classList.toggle('on', running); });
  button(simS, '+10 s', () => advance(10));
  const ovS = section('Overlays');
  for (const k of Object.keys(layerOn)) button(ovS, k, (b) => { layerOn[k] = !layerOn[k]; b.classList.toggle('on', layerOn[k]); applyLayers(); }, layerOn[k]);
  button(ovS, 'map', () => { mapCanvas.style.display = mapCanvas.style.display === 'none' ? '' : 'none'; }, true);

  // ---------------------------------------------------------------- loop
  let acc = 0;
  function frame(dt: number, stepSim: boolean): void {
    if (stepSim) {
      acc += dt;
      let n = 0;
      while (acc >= SIM_DT && n < 8) { sim.step(); acc -= SIM_DT; n++; }
      if (n === 8) acc = 0;
      sim.interpolate(acc / SIM_DT);
    }
    for (const v of views) v.update(dt, ctx);
    for (const v of entityViews.values()) v.update(dt, ctx);
    trackView?.update(dt, ctx);
    updateCamera(dt);
    renderer.render(dt);
  }
  function advance(seconds: number): void {
    for (let t = 0; t < seconds; t += SIM_DT) frame(SIM_DT, true);
  }
  let last = performance.now();
  let statAcc = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt, running);
    statAcc += dt;
    if (statAcc > 0.25) {
      statAcc = 0;
      drawMap();
      const st = renderer.stats();
      const p = sim.player as Kart;
      statusEl.textContent = `${st.backend} ${st.fps.toFixed(0)} fps  draws ${st.drawCalls}  tris ${(st.triangles / 1000).toFixed(0)}k\n` +
        `lap ${p.race.lap} leader lap ${track.state.lap}  t ${sim.raceTime.toFixed(1)}\n` +
        `cam ${camera.position.x.toFixed(0)},${camera.position.y.toFixed(0)},${camera.position.z.toFixed(0)}  eye ${eyeProgress.toFixed(0)}\n` + logs.join('\n');
    }
    requestAnimationFrame(tick);
  };
  await setup();
  requestAnimationFrame(tick);

  (window as any).__track = {
    get track() { return track; }, get sim() { return sim; }, renderer, camera, controls,
    advance,
    /** Driver-eye camera at a progress value (m), lateral offset and path. */
    eye(progress: number, lat = 0, path = 0) { mode = 'eye'; controls.enabled = false; eyeProgress = progress; eyeLat = lat; eyePath = path; frame(0.016, false); },
    orbit(x: number, y: number, z: number, tx: number, ty: number, tz: number) { mode = 'orbit'; controls.enabled = true; camera.position.set(x, y, z); controls.target.set(tx, ty, tz); controls.update(); frame(0.016, false); },
    top() { setTop(); frame(0.016, false); },
    chase(k = 7) { mode = 'chase'; controls.enabled = false; follow = k; },
    layers(on: Partial<typeof layerOn>) { Object.assign(layerOn, on); applyLayers(); frame(0.016, false); },
    setLap(n: number) { track.setLap(n, sim); },
    reset: setup,
    run(on: boolean) { running = on; },
    render() { frame(0.016, false); },
  };
}

main().catch((e) => { console.error(e); statusEl.textContent = String(e?.stack ?? e); });
