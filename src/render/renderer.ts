// The game renderer: WebGPU with WebGL2 fallback, lighting, post, dynamic resolution, VFX. Owner: render.
// Use `?webgl` to force the WebGL2 backend and `?debug` for the stats overlay.
import { Color, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Scene, WebGPURenderer, Vector3 } from 'three/webgpu';
import { QUALITY } from '../core/quality';
import type {
  AssetLibrary, EnvironmentDef, GameRenderer, QualitySettings, QualityTier, RaceSim, RenderContext, VfxApi,
} from '../core/types';
import { createDebugOverlay } from './debug';
import { DynamicResolution } from './dynres';
import { createLighting, type Lighting } from './environment';
import { createPost, post, stagesFor, type Post, type PostStages } from './post';
import { renderTime, windDirection, windStrength } from './shared';
import { Effects } from './vfx/effects';
import { bindSimFx, type SimFx } from './vfx/simFx';
import { SkidMarks } from './vfx/skids';
import { Weather } from './vfx/weather';

/** Optional colour grade an environment may carry (duck-typed; not part of the contract yet). */
export interface GradeDef {
  lift?: [number, number, number];
  gamma?: [number, number, number];
  gain?: [number, number, number];
  saturation?: number;
  contrast?: number;
  tint?: string;
  vignette?: number;
}

/** Extra controls for the sandbox and debug tools. */
export interface RenderControls {
  readonly three: WebGPURenderer;
  readonly backend: 'webgpu' | 'webgl2';
  readonly effects: Effects;
  readonly weather: Weather;
  readonly dynres: DynamicResolution;
  readonly lighting: Lighting;
  stages(): PostStages;
  setStages(s: Partial<PostStages>): void;
  setTier(t: QualityTier): void;
  frameMs(): number;
  /** Render scale (dynamic resolution). */
  scale(): number;
}

export type FullRenderer = GameRenderer & { controls: RenderControls };

const TIERS: QualityTier[] = ['high', 'medium', 'mobile'];

export function createRenderer(canvas: HTMLCanvasElement, quality: QualitySettings, assets: AssetLibrary): FullRenderer {
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.has('webgl');
  const debug = params.has('debug');

  const makeThree = () => {
    const r = new WebGPURenderer({ canvas, antialias: false, forceWebGL, powerPreference: 'high-performance' } as ConstructorParameters<typeof WebGPURenderer>[0]);
    r.toneMapping = NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.info.autoReset = false;
    return r;
  };
  let three = makeThree();

  const scene = new Scene();
  const camera = new PerspectiveCamera(65, 1, 0.3, 2000);
  camera.position.set(0, 5, -10);
  camera.lookAt(0, 0, 0);

  let q = quality;
  const effects = new Effects(q.density, q.tier !== 'mobile');
  effects.addTo(scene);
  const skids = new SkidMarks(3000);
  skids.addTo(scene);
  const weather = new Weather(scene);
  const dyn = new DynamicResolution();

  const vfx: VfxApi = { spawn: (name, pos, opts) => effects.spawn(name, pos, opts) };
  const ctx: { -readonly [K in keyof RenderContext]: RenderContext[K] } = { scene, camera, quality: q, vfx, assets, sim: null, time: 0 };

  const lighting = createLighting(() => three, scene, camera, q);
  let pipeline: Post | null = null;
  let stages: PostStages = stagesFor(q);
  let simFx: SimFx | null = null;
  let envDef: EnvironmentDef | null = null;

  let width = 1, height = 1, hidden = true;
  let time = 0, frames = 0, fps = 0, fpsAcc = 0;
  let lastNow = 0, frameMs = 16.7, sinceRender = 0, lastFrameId = -1;
  let lost = false, recovering = false, disposed = false, ready = false;
  let backend: 'webgpu' | 'webgl2' = 'webgpu';
  let overlay: ReturnType<typeof createDebugOverlay> | null = null;

  // Feel state
  const feel = { speed: 0, boost: 0, hit: 0, underwater: false };
  let boostS = 0, prevBoost = 0, prevHit = 0, kick = 0, flash = 0, desat = 0, speedS = 0;

  function applyPixelRatio() {
    three.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    if (!hidden) three.setSize(width, height, false);
  }

  function dynBounds(t: QualityTier) {
    if (t === 'high') dyn.reset(0.6, 1);
    else if (t === 'medium') dyn.reset(0.6, 1);
    else dyn.reset(0.5, 1);
  }

  function buildPost() {
    pipeline?.dispose();
    pipeline = createPost(three, scene, camera, stages);
    pipeline.setResolutionScale(dyn.scale);
  }

  function playerHit() { flash = 1; desat = 0.85; }

  async function initThree() {
    await three.init();
    backend = (three.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    three.onDeviceLost = onDeviceLost;
    applyPixelRatio();
    buildPost();
  }

  function onDeviceLost(info: { api: string; message: string; reason?: string | null }) {
    if (disposed || recovering) return;
    console.warn('[render] device lost:', info.api, info.message, info.reason ?? '');
    lost = true;
    if (backend === 'webgl2') {
      canvas.addEventListener('webglcontextrestored', () => void recover(), { once: true });
    } else {
      setTimeout(() => void recover(), 300);
    }
  }

  async function recover() {
    if (disposed || recovering) return;
    recovering = true;
    try {
      pipeline?.dispose(); pipeline = null;
      try { three.dispose(); } catch { /* already gone */ }
      three = makeThree();
      await initThree();
      if (envDef) await lighting.setEnvironment(envDef);
      lost = false;
      console.info('[render] recovered after device loss on', backend);
    } catch (e) {
      console.error('[render] recovery failed', e);
    } finally {
      recovering = false;
    }
  }

  function applyGrade(env: EnvironmentDef) {
    const g = (env as EnvironmentDef & { grade?: GradeDef }).grade ?? {};
    post.lift.value.set(...(g.lift ?? [0.0, 0.0, 0.012]));
    post.gamma.value.set(...(g.gamma ?? [1, 1, 1]));
    post.gain.value.set(...(g.gain ?? [1.02, 1.0, 0.98]));
    post.saturation.value = g.saturation ?? 1.1;
    post.contrast.value = g.contrast ?? 1.05;
    post.vignette.value = g.vignette ?? 0.3;
    // Default tint: a whisper of the sun colour, so warm sunsets stay warm after tone mapping.
    if (g.tint) post.tint.value.set(g.tint);
    else post.tint.value.setRGB(1, 1, 1).lerp(new Color(env.sunColor), 0.15);
  }

  const self: FullRenderer = {
    ctx,
    async init() {
      await initThree();
      ready = true;
      if (debug) overlay = createDebugOverlay(debugSource);
      (window as unknown as { __render?: FullRenderer }).__render = self;
    },
    async setEnvironment(env) {
      envDef = env;
      three.toneMappingExposure = env.exposure ?? 1;
      await lighting.setEnvironment(env);
      applyGrade(env);
      weather.set(env.weather, q.density);
      const sd = new Vector3(...env.sunDir);
      windDirection.value.set(-sd.z, 0, sd.x).normalize();
      windStrength.value = env.weather === 'rain' ? 1.2 : 0.6;
    },
    setQuality(nq) {
      const same = JSON.stringify(nq) === JSON.stringify(q) && pipeline;
      q = nq; ctx.quality = nq;
      if (same) return;
      lighting.setQuality(nq);
      effects.setDensity(nq.density);
      effects.setSoftParticles(nq.tier !== 'mobile');
      if (envDef) weather.set(envDef.weather, nq.density);
      dynBounds(nq.tier);
      stages = stagesFor(nq);
      applyPixelRatio();
      if (ready) buildPost();
    },
    setFeel(f) {
      feel.speed = f.speed; feel.boost = f.boost; feel.hit = f.hit; feel.underwater = !!f.underwater;
    },
    bindSim(sim: RaceSim | null) {
      simFx?.dispose(); simFx = null;
      effects.clear(); skids.clear();
      ctx.sim = sim;
      if (sim) simFx = bindSimFx(sim, effects, skids, playerHit);
    },
    resize(w, h) {
      if (w < 4 || h < 4) { hidden = true; return; }
      hidden = false;
      width = w; height = h;
      three.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      lighting.onResize();
    },
    render(dt) {
      if (disposed) return;
      time += dt;
      ctx.time = time;
      renderTime.value = time;
      const now = performance.now();
      const real = lastNow ? now - lastNow : 16.7;
      lastNow = now;
      // A hidden or zero-sized canvas makes zero-sized render targets: skip the GPU work entirely.
      if (!ready || lost || hidden || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;

      // Feel: smooth and edge-detect.
      const a = 1 - Math.exp(-6 * dt);
      speedS += (feel.speed - speedS) * a;
      const bRate = feel.boost > boostS ? 10 : 3;
      boostS += (feel.boost - boostS) * (1 - Math.exp(-bRate * dt));
      if (feel.boost > 0.5 && prevBoost <= 0.5) kick = 1;
      if (feel.hit > 0.5 && prevHit <= 0.5) playerHit();
      prevBoost = feel.boost; prevHit = feel.hit;
      kick *= Math.exp(-7 * dt); flash *= Math.exp(-6 * dt); desat *= Math.exp(-2.2 * dt);
      post.speed.value = speedS; post.boost.value = boostS; post.kick.value = kick;
      post.flash.value = flash; post.desat.value = desat;
      post.underwater.value += ((feel.underwater ? 1 : 0) - post.underwater.value) * a;

      // VFX
      effects.setTime(time);
      skids.now = time;
      simFx?.update(dt, camera);
      effects.flush();
      skids.flush();

      // Optional 30 Hz mode on weak devices: render every other display frame.
      sinceRender += real;
      if (dyn.target === 30 && sinceRender < 1000 / 30 - 4) return;
      sinceRender = 0;

      const scale = dyn.update(now);
      frameMs += (real - frameMs) * 0.1;
      pipeline!.setResolutionScale(scale);
      camera.updateMatrixWorld();
      lighting.update(camera);
      pipeline!.updateSun(camera);
      // three advances its node frame (once-per-frame passes, TSL time) from its own internal rAF loop. When
      // frames are driven manually (advance() in a background tab) that loop does not run, so every pass would
      // think it already rendered this frame: advance the node frame ourselves when it has not moved.
      const nf = (three as unknown as { _nodes?: { nodeFrame?: { frameId: number; update(): void } } })._nodes?.nodeFrame;
      if (nf) {
        if (nf.frameId === lastFrameId) { nf.update(); (three.info as { frame: number }).frame = nf.frameId; }
        lastFrameId = nf.frameId;
      }
      three.info.reset();
      pipeline!.render();

      frames++; fpsAcc += real;
      if (fpsAcc >= 500) { fps = (frames * 1000) / fpsAcc; frames = 0; fpsAcc = 0; }
      overlay?.update();
    },
    async precompile() {
      if (!ready || disposed || !pipeline) return;
      try { camera.updateMatrixWorld(); await pipeline.precompile(); } catch (e) { console.warn('[render] precompile failed', e); }
    },
    stats: () => ({ fps, drawCalls: three.info.render.drawCalls, triangles: three.info.render.triangles, backend }),
    dispose() {
      disposed = true;
      overlay?.dispose();
      simFx?.dispose();
      effects.dispose(); skids.dispose(); weather.dispose();
      lighting.dispose();
      pipeline?.dispose();
      three.dispose();
    },
    controls: {
      get three() { return three; },
      get backend() { return backend; },
      effects, weather, dynres: dyn, lighting,
      stages: () => ({ ...stages }),
      setStages(s) { stages = { ...stages, ...s }; if (ready) buildPost(); },
      setTier(t) { self.setQuality(QUALITY[t]); },
      frameMs: () => frameMs,
      scale: () => dyn.scale,
    },
  };

  const debugSource = {
    stats: () => self.stats(),
    frameMs: () => frameMs,
    scale: () => dyn.scale,
    dynTarget: () => dyn.target,
    tier: () => q.tier,
    stages: () => stages,
    cycleTier() { self.setQuality(QUALITY[TIERS[(TIERS.indexOf(q.tier) + 1) % TIERS.length]]); },
    toggleStage(k: keyof PostStages) { self.controls.setStages({ [k]: !stages[k] }); },
    toggleDynRes() { dyn.enabled = !dyn.enabled; if (!dyn.enabled) { dyn.scale = 1; } return dyn.enabled; },
    dynEnabled: () => dyn.enabled,
  };

  dynBounds(q.tier);
  return self;
}
