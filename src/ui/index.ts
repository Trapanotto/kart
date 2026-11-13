// UI entry: menus, HUD, touch controls and the game flow (title → menu → … → race → results).
import './ui.css';
import './hud.css';
import { CHARACTERS, POINTS, SPEED_CLASSES } from '../core/data';
import { isTouchDevice } from '../core/quality';
import type { App, CharacterId, RaceConfig, RaceResult } from '../core/types';
import { audioBridge } from '../audio/bridge';
import { BASE, h } from './dom';
import { UI_ICONS } from './icons';
import { Hud } from './hud';
import { Nav, inputMode, onInputMode } from './nav';
import { Router, type Screen, type TransitionDir } from './router';
import { saveStore, store } from './storage';
import { TouchControls } from './touch';
import { cupTracks } from './tracks';
import type { FlowState, UiCtx } from './context';
import { charScreen, classScreen, controlsScreen, menuScreen, optionsScreen, titleScreen, trackScreen } from './screens/menus';
import { loadingScreen, pauseScreen, podiumScreen, resultsScreen, standingsScreen, timeTrialScreen } from './screens/race';

export interface UiHandle {
  dispose(): void;
  /** Steps UI animations manually (hidden tabs, sandbox). */
  advance(seconds: number): void;
  readonly ctx: UiCtx;
  readonly hud: Hud;
  readonly touch: TouchControls;
  /** Forces the touch layout on or off (sandbox). */
  forceTouch(on: boolean | null): void;
}

let fontInjected = false;
function injectFont(): void {
  if (fontInjected) return;
  fontInjected = true;
  const st = document.createElement('style');
  st.textContent = `@font-face{font-family:'Fredoka';src:url('${BASE}assets/fonts/fredoka-latin-wght.woff2') format('woff2');font-weight:300 700;font-style:normal;font-display:swap;}`;
  document.head.appendChild(st);
}

export function createUI(app: App, uiRoot: HTMLElement): UiHandle {
  injectFont();
  const root = h('div.tk-ui');
  const hudLayer = h('div.tk-layer');
  const screenLayer = h('div.tk-layer');
  const rotate = h('div.tk-rotate', h('div.ph', { html: UI_ICONS.phone }), h('b', 'Bitte dreh dein Handy'));
  root.append(hudLayer, screenLayer, rotate);
  uiRoot.appendChild(root);

  const nav = new Nav(root);
  const router = new Router(screenLayer, nav);
  const hud = new Hud(app);
  const touch = new TouchControls(app);
  hudLayer.append(hud.el, touch.el);
  app.addInputSource(touch);

  // Touch devices drive with a gas button by default; auto-throttle stays an option.
  // One-time reset for devices that got auto-throttle switched on by an earlier version.
  let forced: boolean | null = null;
  let touchSeen = isTouchDevice();
  if (touchSeen && !store.touchGas) {
    store.touchGas = true; saveStore();
    app.settings.autoThrottle = false;
    app.saveSettings();
  }
  touch.setLayout(store.touchLayout);
  const isTouch = () => forced ?? (touchSeen && inputMode() === 'touch');

  const syncMode = () => {
    root.classList.remove('input-kbd', 'input-pad', 'input-touch', 'input-mouse');
    root.classList.add('input-' + inputMode());
    if (inputMode() === 'touch') touchSeen = true;
    hud.setTouch(isTouch());
    hud.setPadGlyphs(inputMode() === 'pad');
    touch.setManualGas(!app.settings.autoThrottle);
    touch.show(raceActive && !app.paused && isTouch());
  };

  const def = SPEED_CLASSES.find((c) => c.id === store.lastClass) ?? SPEED_CLASSES[1];
  const state: FlowState = { mode: 'race', char: (store.lastChar ?? 'otter') as CharacterId, cls: def, trackId: null, gp: null };
  let raceActive = false;
  let resultsShown = false;
  let afterQuit: 'menu' | 'tracks' | null = null;
  let loading: ReturnType<typeof loadingScreen> | null = null;
  let endTimer = 0;

  const ctx: UiCtx = {
    app, router, nav, state,
    isTouch,
    toTitle: () => router.show(titleScreen(ctx), 'back'),
    toMenu: (dir: TransitionDir = 'fwd') => router.show(menuScreen(ctx), dir),
    toChars: (dir: TransitionDir = 'fwd') => router.show(charScreen(ctx), dir),
    toClasses: (dir: TransitionDir = 'fwd') => router.show(classScreen(ctx), dir),
    toTracks: (dir: TransitionDir = 'fwd') => router.show(trackScreen(ctx), dir),
    toOptions: (back) => router.show(optionsScreen(ctx, back, !!app.sim), 'fwd'),
    toControls: (back) => router.show(controlsScreen(ctx, back, !!app.sim), 'fwd'),
    launch,
    startGrandPrix() {
      const tracks = cupTracks(app.tracks);
      if (!tracks.length) return;
      const points: Record<string, number> = {};
      for (const c of CHARACTERS) points[c.id] = 0;
      state.gp = { tracks, index: 0, points, gained: {}, results: [] };
      launch(tracks[0].id);
    },
    quitTo(target) {
      afterQuit = target;
      if (target === 'menu') state.gp = null;
      if (app.sim) app.quitToMenu();
      else { afterQuit = null; if (target === 'tracks') ctx.toTracks('back'); else ctx.toMenu('back'); }
    },
    setTouchLayout(l) { store.touchLayout = l; saveStore(); touch.setLayout(l); },
  };

  function raceConfig(trackId: string): RaceConfig {
    const cfg: RaceConfig = {
      trackId, speedClass: state.cls, player: state.char, mode: state.mode,
      seed: (Math.random() * 1e9) | 0,
      assists: { autoThrottle: app.settings.autoThrottle, steerAssist: app.settings.steerAssist },
    };
    if (state.mode === 'timetrial') cfg.grid = [state.char];
    const gp = state.gp;
    if (state.mode === 'grandprix' && gp && gp.index > 0) {
      // Reverse order of the standings: the leader starts last. Ties keep the last race order.
      const lastOrder = gp.results[gp.results.length - 1]?.order.map((o) => o.char) ?? [];
      cfg.grid = [...CHARACTERS.map((c) => c.id)].sort((a, b) => (gp.points[a] - gp.points[b]) || (lastOrder.indexOf(b) - lastOrder.indexOf(a)));
    }
    return cfg;
  }

  function launch(trackId: string): void {
    state.trackId = trackId;
    const meta = app.tracks.find((t) => t.id === trackId);
    showLoading(meta?.name ?? 'Strecke');
    audioBridge.screenMusic(null);
    app.startRace(raceConfig(trackId)).catch((err) => {
      console.error('[ui] startRace failed', err);
      loading = null;
      ctx.toMenu('back');
    });
  }

  function showLoading(name: string): void {
    if (loading && router.current === loading) { loading.setName(name); return; }
    loading = loadingScreen(ctx, name);
    router.show(loading, 'fade');
  }

  // ------------------------------------------------------------ app events
  const ev = app.events;
  const unsub = [
    ev.on('app:loading', ({ done, total, label }) => {
      if (!loading || router.current !== loading) {
        hud.unbind(); raceActive = false; resultsShown = false; syncMode();
        const id = state.trackId;
        showLoading(app.tracks.find((t) => t.id === id)?.name ?? (app.sim?.track.meta.name ?? 'Strecke'));
      }
      loading!.progress(done, total, label);
    }),
    ev.on('app:raceReady', ({ sim }) => {
      // Adopt the race config (covers ?race= direct starts and restarts).
      state.mode = sim.config.mode; state.char = sim.config.player; state.cls = sim.config.speedClass; state.trackId = sim.config.trackId;
      loading = null;
      clearTimeout(endTimer);
      router.clear('fade');
      hud.bind(sim);
      raceActive = true;
      resultsShown = false;
      nav.enabled = false;
      syncMode();
    }),
    ev.on('app:pause', ({ paused }) => {
      if (paused) {
        if (!raceActive || resultsShown) { app.setPaused(false); return; }
        nav.enabled = true;
        audioBridge.ui('pause');
        router.show(pauseScreen(ctx), 'fade');
      } else if (raceActive && !resultsShown) {
        audioBridge.ui('unpause');
        router.clear('fade');
        nav.enabled = false;
      }
      syncMode();
    }),
    ev.on('app:raceEnded', ({ result }) => onRaceEnded(result)),
    ev.on('app:menu', () => {
      clearTimeout(endTimer);
      hud.unbind();
      raceActive = false; resultsShown = false; loading = null;
      nav.enabled = true;
      syncMode();
      const t = afterQuit; afterQuit = null;
      if (t === 'tracks') ctx.toTracks('back');
      else { state.gp = null; ctx.toMenu('back'); }
    }),
    ev.on('app:settings', () => syncMode()),
    onInputMode(() => syncMode()),
  ];

  function onRaceEnded(result: RaceResult): void {
    const gp = state.gp;
    if (state.mode === 'grandprix' && gp) {
      gp.gained = {};
      result.order.forEach((o, i) => { const p = POINTS[i] ?? 0; gp.gained[o.char] = p; gp.points[o.char] = (gp.points[o.char] ?? 0) + p; });
      gp.results.push(result);
    }
    clearTimeout(endTimer);
    endTimer = window.setTimeout(() => {
      if (!raceActive) return;
      resultsShown = true;
      app.setPaused(false);
      hud.unbind();
      nav.enabled = true;
      syncMode();
      if (state.mode === 'timetrial') router.show(timeTrialScreen(ctx, result), 'fade');
      else router.show(resultsScreen(ctx, result, () => continueGp()), 'fade');
    }, 2600);
  }

  function continueGp(): void {
    const gp = state.gp;
    if (!gp) return;
    const last = gp.index + 1 >= gp.tracks.length;
    router.show(standingsScreen(ctx, () => {
      if (last) router.show(podiumScreen(ctx, () => ctx.quitTo('menu')));
      else { gp.index++; launch(gp.tracks[gp.index].id); }
    }));
  }

  // Phones: pause when rotated to portrait mid-race.
  const portraitMq = matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 900px)');
  const onOrient = () => { if (portraitMq.matches && raceActive && !resultsShown && app.sim?.phase !== 'finished') app.setPaused(true); };
  portraitMq.addEventListener?.('change', onOrient);

  // ------------------------------------------------------------ frame loop
  let raf = 0, last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    step(dt);
    raf = requestAnimationFrame(tick);
  };
  function step(dt: number): void {
    const { start } = nav.pollPad(dt);
    if (start && raceActive && !resultsShown && app.sim) {
      // The physics team's gamepad source may toggle pause on Start too; only act if nobody else did.
      const was = app.paused;
      setTimeout(() => { if (app.paused === was && raceActive && !resultsShown) app.setPaused(!was); }, 120);
    }
    router.update(dt);
    hud.update(dt);
  }
  raf = requestAnimationFrame(tick);

  syncMode();
  if (!new URLSearchParams(location.search).has('race')) router.show(titleScreen(ctx), 'fade');

  const handle: UiHandle = {
    ctx, hud, touch,
    advance(seconds) { for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60); },
    forceTouch(on) { forced = on; syncMode(); },
    dispose() {
      cancelAnimationFrame(raf);
      for (const u of unsub) u();
      portraitMq.removeEventListener?.('change', onOrient);
      root.remove();
    },
  };
  // Debug handle for automated checks (hidden tabs do not run rAF: call __kartUI.advance()).
  (window as any).__kartUI = handle;
  return handle;
}

export type { Screen };
