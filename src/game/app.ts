// Application shell: owns the frame loop and wires modules together. Owner: lead.
import { createEventBus } from '../core/events';
import { character, CHARACTERS, emptyInput, SPEED_CLASSES } from '../core/data';
import { createEntityView } from '../core/entityViews';
import { detectTier, QUALITY } from '../core/quality';
import { Sim } from '../core/sim';
import { SIM_DT } from '../core/types';
import type {
  App, AppEvents, CameraRig, CharacterId, GameEvents, InputSource, InputState, Kart, KartController, RaceConfig,
  RaceResult, RaceSim, RenderContext, Settings, SimEntity, View,
} from '../core/types';
import { modules } from './modules';

const SETTINGS_KEY = 'tk2.settings';
const DEFAULT_SETTINGS: Settings = { quality: 'auto', musicVolume: 0.7, sfxVolume: 0.9, autoThrottle: false, steerAssist: false, cameraShake: true, vibration: true };

function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
}

interface Race {
  sim: Sim;
  views: View[];
  entityViews: Map<SimEntity, View>;
  camera: CameraRig;
  unsub: (() => void)[];
  config: RaceConfig;
}

export interface DebugApp extends App {
  /** Runs the loop manually for `seconds` (works in hidden tabs and tests). */
  advance(seconds: number): void;
  readonly playerInput: InputState;
  /** While set, replaces device input for the player (tests / demos). */
  inputOverride: Partial<InputState> | null;
}

export async function createApp(canvas: HTMLCanvasElement, uiRoot: HTMLElement): Promise<DebugApp> {
  const events = createEventBus<GameEvents & AppEvents>();
  const settings = loadSettings();
  const quality = () => QUALITY[settings.quality === 'auto' ? detectTier() : settings.quality];
  const assets = modules.createAssets();
  const renderer = modules.createRenderer(canvas, quality(), assets);
  await renderer.init();
  renderer.setQuality(quality());
  const sources: InputSource[] = modules.createInputSources();
  const playerInput = emptyInput();
  let race: Race | null = null;
  let paused = false;
  let loading = false;
  let acc = 0;

  const ctx = (): RenderContext => renderer.ctx;

  const playerController: KartController = {
    update(kart) {
      Object.assign(kart.input, playerInput);
      if (app.inputOverride) Object.assign(kart.input, app.inputOverride);
      if (race?.config.assists?.autoThrottle && kart.input.brake === 0) kart.input.throttle = 1;
    },
  };

  function endRace(): void {
    if (!race) return;
    for (const u of race.unsub) u();
    for (const v of race.views) v.dispose();
    for (const v of race.entityViews.values()) v.dispose();
    race.camera.dispose();
    renderer.bindSim(null);
    race.sim.dispose();
    race = null;
  }

  async function startRace(config: RaceConfig): Promise<void> {
    if (loading) return;
    loading = true;
    try {
      endRace();
      const cfg: RaceConfig = { ...config, assists: config.assists ?? { autoThrottle: settings.autoThrottle, steerAssist: settings.steerAssist } };
      events.emit('app:loading', { done: 0, total: 1, label: 'Strecke' });
      const track = await modules.loadTrack(cfg.trackId);
      await assets.load(modules.raceAssets(cfg), (done, total) => events.emit('app:loading', { done, total, label: 'Modelle' }));
      const physics = await modules.createPhysics(track, cfg);
      const items = modules.createItemSystem();
      const sim = new Sim({ config: cfg, track, physics, systems: [...(items ? [items] : []), modules.createRaceRules()], events });

      // Grid: player starts last unless a grid is given.
      const others = CHARACTERS.map((c) => c.id).filter((id) => id !== cfg.player);
      const grid: CharacterId[] = cfg.grid ?? [...others, cfg.player];
      grid.forEach((id, i) => {
        const kart = physics.addKart({ char: character(id), isHuman: id === cfg.player, pose: track.startGrid[i] });
        sim.karts.push(kart);
      });
      for (const k of sim.karts) sim.controllers.set(k.id, k.isHuman ? playerController : modules.createAI(k, sim));

      const r: Race = { sim, views: [], entityViews: new Map(), camera: modules.createCameraRig(ctx()), unsub: [], config: cfg };
      r.unsub.push(
        events.on('entity:add', ({ entity }) => { const v = createEntityView(entity, ctx()); if (v) r.entityViews.set(entity, v); }),
        events.on('entity:remove', ({ entity }) => { r.entityViews.get(entity)?.dispose(); r.entityViews.delete(entity); }),
        events.on('race:finish', ({ kart }) => { if (kart.isHuman) sim.controllers.set(kart.id, modules.createAI(kart, sim)); }),
        events.on('race:over', ({ order }) => {
          const result: RaceResult = { config: cfg, order: order.map((k) => ({ char: k.char.id, isHuman: k.isHuman, time: k.race.finishTime, bestLap: k.race.bestLap })) };
          events.emit('app:raceEnded', { result });
        }),
      );
      await renderer.setEnvironment(track.meta.environment);
      renderer.bindSim(sim);
      r.views.push(await modules.createTrackView(track, ctx()));
      for (const k of sim.karts) r.views.push(modules.createKartView(k, ctx()));
      r.camera.setTarget(sim.player);
      race = r;
      sim.start();
      sim.interpolate(1);
      paused = false;
      acc = 0;
      events.emit('app:raceReady', { sim });
    } finally {
      loading = false;
    }
  }

  function frame(dt: number): void {
    // Input: the first active source wins.
    let active = false;
    for (const s of sources) {
      if (!active && s.poll(playerInput)) active = true;
      if (s.consumePause?.() && race) app.setPaused(!paused);
    }
    if (!active) Object.assign(playerInput, emptyInput());

    if (race) {
      const { sim } = race;
      if (!paused) {
        acc += dt;
        let steps = 0;
        while (acc >= SIM_DT && steps < 5) { sim.step(); acc -= SIM_DT; steps++; }
        if (steps === 5) acc = 0;
        sim.interpolate(acc / SIM_DT);
      }
      const c = ctx();
      for (const v of race.views) v.update(dt, c);
      for (const v of race.entityViews.values()) v.update(dt, c);
      race.camera.update(dt, c);
      const p = sim.player;
      renderer.setFeel({ speed: Math.min(1, Math.abs(p.speed) / (p.topSpeed * 1.3)), boost: p.boost.time > 0 ? 1 : 0, hit: p.stun > 0 ? 1 : 0 });
    }
    renderer.render(dt);
  }

  const app: DebugApp = {
    events,
    settings,
    get sim(): RaceSim | null { return race?.sim ?? null; },
    renderer,
    get tracks() { return modules.trackList(); },
    startRace,
    setPaused(p) { if (!race || paused === p) return; paused = p; events.emit('app:pause', { paused }); },
    get paused() { return paused; },
    async restartRace() { if (race) await startRace(race.config); },
    quitToMenu() { endRace(); events.emit('app:menu', {}); },
    saveSettings() {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
      renderer.setQuality(quality());
      events.emit('app:settings', { settings });
    },
    addInputSource(src) { sources.push(src); },
    advance(seconds) { for (let t = 0; t < seconds; t += SIM_DT) frame(SIM_DT); },
    playerInput,
    inputOverride: null,
  };

  const resize = () => renderer.resize(Math.max(1, canvas.clientWidth || innerWidth), Math.max(1, canvas.clientHeight || innerHeight));
  window.addEventListener('resize', resize);
  resize();
  document.addEventListener('visibilitychange', () => { if (document.hidden && race && race.sim.phase === 'racing') app.setPaused(true); });

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const ui = modules.createUI(app, uiRoot);
  modules.createAudio(app);

  // Direct start for development: ?race=<trackId>&char=<id>&class=<easy|normal|turbo>&laps=<n>
  const q = new URLSearchParams(location.search);
  if (q.has('race') || !ui) {
    await startRace({
      trackId: q.get('race') || modules.trackList()[0].id,
      player: (q.get('char') as CharacterId) || 'otter',
      speedClass: SPEED_CLASSES.find((c) => c.id === q.get('class')) ?? SPEED_CLASSES[1],
      laps: q.has('laps') ? Number(q.get('laps')) : undefined,
      seed: q.has('seed') ? Number(q.get('seed')) : 1,
      mode: 'race',
    });
  }
  return app;
}
