// Audio entry: Web Audio graph (master/music/effects buses + limiter), event-driven effects,
// layered engines, adaptive music. createAudio(app) is wired in src/game/modules.ts.
import { Vector3 } from 'three';
import { CHARACTERS } from '../core/data';
import type { App, CharacterId, Kart, RaceSim } from '../core/types';
import { audioBridge, type UiSound } from './bridge';
import { clamp, reverbImpulse } from './core';
import { PlayerEngine, RivalEngine } from './engine';
import { Music } from './music';
import { Sfx } from './sfx';
import { FINISH_WIN, JINGLE_LOSE, JINGLE_WIN, MENU, songForTrack } from './songs';
import { runAudioCheck } from './check';

export interface AudioHandle {
  dispose(): void;
  advance(dt: number): void;
  /** Sandbox: one button per sound. */
  board: Record<string, () => void>;
  check(part?: string): Promise<string>;
  readonly ctx: AudioContext;
  readonly music: Music;
}

const ITEM_SOUND: Record<string, string> = {
  acorn: 'use_acorn', acorn3: 'use_acorn', honey: 'use_honey', giftbox: 'use_giftbox', yarn: 'use_yarn', bees: 'use_bees',
  bubble: 'use_bubble', carrot: 'use_carrot', carrot3: 'use_carrot', goldcarrot: 'use_goldcarrot', lolly: 'use_lolly', cloud: 'use_cloud', yawn: 'use_yawn',
};

export function createAudio(app: App): AudioHandle | null {
  const AC: typeof AudioContext | undefined = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC({ latencyHint: 'interactive' });

  // ---------------------------------------------------------------- graph
  const master = ctx.createGain(); master.gain.value = 0.9;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 6; limiter.ratio.value = 14; limiter.attack.value = 0.003; limiter.release.value = 0.18;
  const out = ctx.createGain(); out.gain.value = 0.92;
  master.connect(limiter).connect(out).connect(ctx.destination);

  const reverb = ctx.createConvolver(); reverb.buffer = reverbImpulse(ctx);
  const reverbOut = ctx.createGain(); reverbOut.gain.value = 0.5;
  reverb.connect(reverbOut).connect(master);

  const musicVol = ctx.createGain();
  const musicDuck = ctx.createGain();
  const musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 20000; musicLP.Q.value = 0.5;
  musicVol.connect(musicDuck).connect(musicLP).connect(master);
  const sfxVol = ctx.createGain();
  sfxVol.connect(master);
  const engineBus = ctx.createGain(); engineBus.gain.value = 0.9;
  engineBus.connect(sfxVol);
  const sfxSend = ctx.createGain(); sfxSend.gain.value = 1; sfxSend.connect(reverb);

  const music = new Music(ctx, musicVol, reverb);
  const sfx = new Sfx(ctx, sfxVol, sfxSend);

  const applyVolumes = (time = 0.05) => {
    const s = app.settings;
    musicVol.gain.setTargetAtTime(0.55 * s.musicVolume * s.musicVolume, ctx.currentTime, time);
    sfxVol.gain.setTargetAtTime(0.95 * s.sfxVolume * s.sfxVolume, ctx.currentTime, time);
  };
  applyVolumes(0.01);

  // ---------------------------------------------------------------- unlock / suspend
  let unlocked = false;
  const unlock = () => {
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().then(() => { unlocked = true; }).catch(() => {});
    else unlocked = true;
  };
  const gesture = () => unlock();
  for (const e of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(e, gesture, { capture: true, passive: true });
  const onVis = () => { if (document.hidden) ctx.suspend().catch(() => {}); else if (unlocked) ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', onVis);

  // ---------------------------------------------------------------- music control
  let menuWanted: 'menu' | 'results' | 'resultsLose' | 'podium' | null = null;
  const duck = (depth = 0.45, hold = 0.35) => {
    const t = ctx.currentTime, g = musicDuck.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.03);
    g.setTargetAtTime(1, t + hold, 0.25);
  };

  function screenMusic(name: typeof menuWanted): void {
    menuWanted = name;
    if (name === null) { music.stop(0.8); return; }
    if (name === 'menu') { if (music.current !== 'menu') music.play(MENU, { intensity: 1, fadeOut: 0.8 }); else music.setIntensity(1); return; }
    const jingle = name === 'resultsLose' ? JINGLE_LOSE : JINGLE_WIN;
    music.play(jingle, {
      intensity: 1, fadeOut: 0.4,
      onEnd: () => { if (menuWanted === name) music.play(MENU, { intensity: name === 'podium' ? 1 : 0.5, fadeOut: 0.3 }); },
    });
  }

  // ---------------------------------------------------------------- bridge for the UI
  audioBridge.ui = (s: UiSound) => sfx.play(s, { gain: s === 'move' ? 0.5 : 0.8 });
  audioBridge.voice = (c: CharacterId) => sfx.voice(c, { gain: 0.8 });
  audioBridge.unlock = unlock;
  audioBridge.screenMusic = screenMusic;
  audioBridge.settingsChanged = () => applyVolumes();

  // ---------------------------------------------------------------- race state
  let sim: RaceSim | null = null;
  let player: PlayerEngine | null = null;
  let rivals = new Map<Kart, RivalEngine>();
  let paused = false;
  let goTime = -1;
  let finalLap = false;
  let rouletteT = 0;
  let lastRankSound = 0;
  let lastCollide = 0;
  const camPos = new Vector3(), camRight = new Vector3(), tmp = new Vector3();

  function spatial(k: Kart): { gain: number; pan: number } {
    if (!sim || k === sim.player) return { gain: 1, pan: 0 };
    const d = k.renderPos.distanceTo(sim.player.renderPos);
    if (d > 70) return { gain: 0, pan: 0 };
    tmp.copy(k.renderPos).sub(camPos).normalize();
    // camRight points to screen right
    return { gain: clamp(1 / (1 + (d / 14) ** 2), 0, 1) * 0.8, pan: tmp.dot(camRight) };
  }
  const at = (name: string, k: Kart | null, gain = 1, extra: { pitch?: number } = {}) => {
    const s = k ? spatial(k) : { gain: 1, pan: 0 };
    if (s.gain * gain < 0.02) return;
    sfx.play(name, { gain: s.gain * gain, pan: s.pan, ...extra });
  };

  function bindRace(s: RaceSim): void {
    unbindRace();
    sim = s;
    finalLap = false;
    goTime = -1;
    paused = false;
    musicLP.frequency.setTargetAtTime(20000, ctx.currentTime, 0.05);
    player = new PlayerEngine(ctx, engineBus);
    rivals = new Map();
    s.karts.forEach((k, i) => { if (k !== s.player) rivals.set(k, new RivalEngine(ctx, engineBus, 0.88 + ((i * 37) % 9) / 30)); });
    menuWanted = null;
    music.play(songForTrack(s.track.meta.id, s.track.meta.name, s.track.meta.music), { intensity: 0.12, fadeOut: 0.5 });
  }

  function unbindRace(): void {
    player?.dispose();
    player = null;
    for (const r of rivals.values()) r.dispose();
    rivals.clear();
    sim = null;
  }

  const ev = app.events;
  const isP = (k: Kart) => !!sim && k === sim.player;
  const unsub = [
    ev.on('app:raceReady', ({ sim: s }) => bindRace(s)),
    ev.on('app:menu', () => { unbindRace(); }),
    ev.on('app:loading', () => { if (sim) unbindRace(); }),
    ev.on('app:settings', () => applyVolumes()),
    ev.on('app:pause', ({ paused: p }) => {
      paused = p;
      const t = ctx.currentTime;
      musicLP.frequency.setTargetAtTime(p ? 650 : 20000, t, 0.12);
      musicDuck.gain.setTargetAtTime(p ? 0.6 : 1, t, 0.12);
    }),
    ev.on('race:countdown', ({ n }) => {
      if (n > 3) return;
      if (n > 0) sfx.play('countdown', { gain: 0.9 });
      else { sfx.play('go', { gain: 0.9 }); goTime = sim?.raceTime ?? 0; music.setIntensity(0.55, 0.4); }
    }),
    ev.on('race:lap', ({ kart, lap }) => {
      if (!isP(kart) || !sim) return;
      if (lap === sim.laps && sim.laps > 1) { finalLap = true; duck(0.6, 1.2); sfx.play('finalLap', { gain: 0.9 }); music.setFinal(true); music.setIntensity(1, 2); }
      else if (lap > 1 && lap <= sim.laps) { sfx.play('lap', { gain: 0.8 }); }
    }),
    ev.on('race:finish', ({ kart, rank }) => {
      if (!isP(kart) || !sim) return;
      const good = sim.config.mode === 'timetrial' || rank <= 3;
      sfx.play(good ? 'finishWin' : 'finishLose', { gain: 0.9 });
      // After the fanfare a calm bed keeps the wait for the others from going silent.
      const calm = () => { if (sim && !menuWanted) music.play(MENU, { intensity: 0.35, fadeOut: 0.3 }); };
      if (good) music.play(FINISH_WIN, { intensity: 1, fadeOut: 0.15, onEnd: calm }); else { music.stop(1.2); setTimeout(calm, 2500); }
    }),
    ev.on('race:rank', ({ kart, from, to }) => {
      if (!isP(kart) || !sim || sim.phase !== 'racing' || kart.race.finished) return;
      const now = ctx.currentTime;
      if (now - lastRankSound < 0.7) return;
      lastRankSound = now;
      sfx.play(to < from ? 'rankUp' : 'rankDown', { gain: to < from ? 0.6 : 0.45 });
    }),
    ev.on('kart:hit', ({ kart, kind, absorbed }) => {
      if (absorbed) { at('shield', kart, 0.8); return; }
      at('hit_' + kind, kart, 0.9);
      if (isP(kart)) duck(0.35, 0.3);
    }),
    ev.on('kart:boost', ({ kart, power, duration }) => {
      if (!isP(kart)) { at('boost', kart, 0.35); return; }
      sfx.play('boost', { gain: clamp(0.45 + (power - 1) * 0.8 + duration * 0.1, 0.45, 1), pitch: clamp(0.85 + (power - 1), 0.85, 1.4) });
    }),
    ev.on('kart:driftStart', ({ kart }) => { if (isP(kart)) sfx.play('hop', { gain: 0.5 }); }),
    ev.on('kart:driftLevel', ({ kart, level }) => { if (isP(kart) && level >= 1 && level <= 3) sfx.play('drift' + level, { gain: 0.6 }); }),
    ev.on('kart:jump', ({ kart }) => at('jump', kart, 0.6)),
    ev.on('kart:trick', ({ kart }) => at('trick', kart, 0.8)),
    ev.on('kart:land', ({ kart, impact }) => at('land', kart, clamp(0.3 + impact * 0.7, 0.3, 1), { pitch: impact })),
    ev.on('kart:collide', ({ kart, other, impulse }) => {
      if (!isP(kart) && !(other && isP(other))) return;
      const now = ctx.currentTime;
      if (now - lastCollide < 0.12) return;
      lastCollide = now;
      const k = clamp(impulse / 10, 0.1, 1);
      sfx.play('collide', { gain: 0.4 + k * 0.6, pitch: k });
    }),
    ev.on('kart:respawn', ({ kart }) => at('respawn', kart, 0.8)),
    ev.on('kart:surface', ({ kart, to }) => { if (to === 'water') at('splash', kart, 0.7); }),
    ev.on('kart:slipstream', ({ kart }) => { if (isP(kart)) sfx.play('slipstream', { gain: 0.6 }); }),
    ev.on('kart:startBoost', ({ kart, quality }) => { if (isP(kart) && quality > 0) sfx.play('startBoost', { gain: 0.8 }); }),
    ev.on('item:box', ({ kart }) => { at('itembox', kart, 0.7); if (isP(kart)) rouletteT = 0; }),
    ev.on('item:got', ({ kart }) => { if (isP(kart)) sfx.play('itemGot', { gain: 0.7 }); }),
    ev.on('item:use', ({ kart, item }) => at(ITEM_SOUND[item] ?? 'use_acorn', kart, 0.85)),
    ev.on('item:warn', ({ kart }) => { if (isP(kart)) { sfx.play('warn', { gain: 0.7 }); duck(0.3, 0.6); } }),
    ev.on('fx', ({ name, pos }) => {
      if (!sim) return;
      const d = pos.distanceTo(sim.player.renderPos);
      if (d > 50) return;
      const g = clamp(1 / (1 + (d / 12) ** 2), 0, 1);
      if (name.startsWith('break')) sfx.play('crunch', { gain: g * 0.8 });
      else if (name === 'splash') sfx.play('splash', { gain: g * 0.7 });
    }),
    ev.on('track:event', ({ name }) => { if (name === 'avalanche' || name.includes('rumble')) { sfx.play('rumble', { gain: 0.9 }); duck(0.3, 2); } }),
  ];

  // ---------------------------------------------------------------- per frame
  function step(dt: number): void {
    const t = ctx.currentTime;
    music.scheduleUntil(t + 0.3);
    if (!sim || !player) return;
    const cam = app.renderer.ctx.camera;
    camPos.setFromMatrixPosition(cam.matrixWorld);
    camRight.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    const p = sim.player;
    const active = !paused;
    player.update(p, dt, active && sim.phase !== 'intro');
    for (const [k, r] of rivals) {
      const s = spatial(k);
      r.update(k, dt, k.renderPos.distanceTo(p.renderPos), s.pan, active && s.gain > 0);
    }
    // Roulette ticks, slowing down towards the end.
    if (p.item.roulette > 0 && active) {
      rouletteT -= dt;
      if (rouletteT <= 0) { rouletteT = 0.075 + Math.max(0, 0.6 - p.item.roulette) * 0.12; sfx.play('rouletteTick', { gain: 0.45 }); }
    }
    // Adaptive intensity.
    if (sim.phase === 'racing' && !p.race.finished && goTime >= 0) {
      let target = sim.raceTime - goTime < 6 ? 0.6 : 0.7;
      if (sim.config.mode !== 'timetrial') {
        if (p.race.rank <= 3) target += 0.16;
        if (p.race.rank === 1) target += 0.04;
      } else target = 0.8;
      if (finalLap) target = 1;
      if (Math.abs(target - music.intensity) > 0.01) music.setIntensity(target, 2.5);
    }
  }

  let raf = 0, last = performance.now();
  const tick = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; step(dt); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  // rAF stops in background tabs; keep the music scheduler fed while visible but unfocused.
  const iv = window.setInterval(() => music.scheduleUntil(ctx.currentTime + 0.35), 100);

  // ---------------------------------------------------------------- sandbox board
  const board: Record<string, () => void> = {};
  for (const n of sfx.names()) board[n] = () => { unlock(); sfx.play(n); };
  for (const c of CHARACTERS) board['Stimmen/' + c.name] = () => { unlock(); sfx.voice(c.id); };
  board['Musik/Menü'] = () => { unlock(); screenMusic('menu'); };
  board['Musik/Kleeblatt-Tal'] = () => { unlock(); music.play(songForTrack('kleeblatt', 'Kleeblatt-Tal'), { intensity: 0.7 }); };
  board['Musik/Bambus-Tempel'] = () => { unlock(); music.play(songForTrack('bambus', 'Bambus-Tempel'), { intensity: 0.7 }); };
  board['Musik/Honigfabrik'] = () => { unlock(); music.play(songForTrack('honig', 'Honigfabrik'), { intensity: 0.7 }); };
  board['Musik/Gletscher-Gipfel'] = () => { unlock(); music.play(songForTrack('gletscher', 'Gletscher-Gipfel'), { intensity: 0.7 }); };
  board['Musik/Ergebnis'] = () => { unlock(); screenMusic('results'); };
  board['Musik/Verloren'] = () => { unlock(); screenMusic('resultsLose'); };
  board['Musik/Zieleinlauf'] = () => { unlock(); music.play(FINISH_WIN); };
  board['Musik/Intensität 0.15'] = () => music.setIntensity(0.15);
  board['Musik/Intensität 0.55'] = () => music.setIntensity(0.55);
  board['Musik/Intensität 0.8'] = () => music.setIntensity(0.8);
  board['Musik/Intensität 1'] = () => music.setIntensity(1);
  board['Musik/Letzte Runde an'] = () => music.setFinal(true);
  board['Musik/Letzte Runde aus'] = () => music.setFinal(false);
  board['Musik/Ducken'] = () => duck(0.6, 0.8);
  board['Musik/Stopp'] = () => { menuWanted = null; music.stop(); };
  board['Motor/Testfahrt'] = () => { unlock(); engineDemo(); };

  function engineDemo(): void {
    const eng = new PlayerEngine(ctx, engineBus);
    const k = {
      speed: 0, topSpeed: 29, grounded: true, stun: 0, boost: { time: 0, power: 1 }, surface: 'road',
      input: { throttle: 1, brake: 0 }, wheels: [{ grounded: true, slip: 0 }], drift: { active: false, level: 0 },
    } as unknown as Kart;
    let t = 0;
    const iv2 = setInterval(() => {
      const dt = 0.05; t += dt;
      const kk = k as any;
      kk.input.throttle = t < 5 || t > 6.5 ? 1 : 0;
      kk.speed = clamp(kk.speed + (kk.input.throttle ? 7 : -9) * dt, 0, 31);
      kk.drift.active = t > 3 && t < 4.6; kk.drift.level = t > 4.2 ? 3 : t > 3.8 ? 2 : t > 3.4 ? 1 : 0;
      kk.wheels[0].slip = kk.drift.active ? 0.7 : 0;
      kk.boost.time = t > 4.6 && t < 5.4 ? 1 : 0;
      kk.surface = t > 7 && t < 8 ? 'offroad' : 'road';
      eng.update(k, dt, true);
      if (t > 9) { clearInterval(iv2); eng.dispose(0.5); }
    }, 50);
  }

  return {
    ctx, music, board,
    advance(dt) { step(dt); },
    check: (part?: string) => runAudioCheck(part),
    dispose() {
      cancelAnimationFrame(raf); clearInterval(iv);
      for (const u of unsub) u();
      unbindRace(); music.stop(0.1);
      for (const e of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(e, gesture, { capture: true } as any);
      document.removeEventListener('visibilitychange', onVis);
      ctx.close().catch(() => {});
    },
  };
}
