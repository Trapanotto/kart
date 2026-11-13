// Offline verification: renders music, effects and the engine into OfflineAudioContexts and reports
// headroom, per-bar loudness (no silent bars) and static harmony clashes.
import type { Kart } from '../core/types';
import { reverbImpulse } from './core';
import { PlayerEngine } from './engine';
import { findClashes, Music } from './music';
import { Sfx } from './sfx';
import { SONGS, type SongDef } from './songs';

const SR = 44100;
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

function stats(buf: AudioBuffer, from = 0, to = buf.length): { peak: number; rms: number } {
  let peak = 0, sum = 0, n = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = from; i < Math.min(to, d.length); i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; n++; }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)) };
}

function songBars(def: SongDef): number { return def.order.reduce((a, s) => a + def.sections[s].bars, 0); }

export async function renderSong(def: SongDef, opts: { bars?: number; from?: number; intensity?: number; final?: boolean; volume?: number } = {}): Promise<AudioBuffer> {
  const bars = opts.bars ?? songBars(def);
  const barDur = (4 * 60) / def.bpm / (opts.final ? 1.1 : 1);
  const dur = bars * barDur + 0.3 + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const vol = ctx.createGain(); vol.gain.value = opts.volume ?? 0.55; // live music bus at full volume setting
  const master = ctx.createGain(); master.gain.value = 0.9;
  vol.connect(master).connect(ctx.destination);
  const rev = ctx.createConvolver(); rev.buffer = reverbImpulse(ctx);
  const revOut = ctx.createGain(); revOut.gain.value = 0.5;
  rev.connect(revOut).connect(master);
  const m = new Music(ctx, vol, rev);
  let seed = 7;
  m.rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  m.play(def, { intensity: opts.intensity ?? 1 });
  if (opts.final) m.setFinal(true);
  if (opts.from) m.seek(opts.from);
  m.scheduleUntil(dur - 2);
  return ctx.startRendering();
}

export async function runAudioCheck(part = 'all'): Promise<string> {
  const lines: string[] = [];
  const t0 = performance.now();
  const want = (p: string) => part === 'all' || part === p || (p.startsWith('song:') && part === 'songs');

  // Harmony
  if (want('harmony')) for (const def of Object.values(SONGS)) {
    const c = findClashes(def);
    lines.push(c.length ? `HARMONIE ${def.id}: ${c.length} Reibungen\n  ` + c.join('\n  ') : `Harmonie ${def.id}: keine Halbton-Reibungen auf starken Zählzeiten`);
  }

  // Music levels per bar. Rendered in 8-bar chunks: scheduling a whole song into one offline
  // context makes the render cost grow quadratically (every pending node is processed).
  for (const def of Object.values(SONGS)) {
    const m = /^song:(\w+)(?::(\d+))?(?::(\d+))?$/.exec(part);
    if (!want('song:' + def.id) && !(m && m[1] === def.id)) continue;
    const total = songBars(def);
    const from = m?.[3] ? Number(m[2]) : 0;
    const count = m?.[3] ? Number(m[3]) : m?.[2] ? Number(m[2]) : total;
    const n = Math.min(total, from + count);
    const barDur = (4 * 60) / def.bpm;
    const start = 0.06;
    let minRms = Infinity, maxRms = 0, minBar = 0, peak = 0, sum = 0;
    const quiet: number[] = [];
    for (let c = from; c < n; c += 8) {
      const len = Math.min(8, n - c);
      const buf = await renderSong(def, { from: c, bars: len });
      for (let b = 0; b < len; b++) {
        const s = stats(buf, Math.floor((start + b * barDur) * SR), Math.floor((start + (b + 1) * barDur) * SR));
        if (s.rms < minRms) { minRms = s.rms; minBar = c + b + 1; }
        maxRms = Math.max(maxRms, s.rms);
        peak = Math.max(peak, s.peak);
        sum += s.rms * s.rms;
        if (db(s.rms) < -40) quiet.push(c + b + 1);
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, n - from));
    lines.push(`Musik ${def.id}: Takte ${from + 1}-${n}, Spitze ${db(peak).toFixed(1)} dBFS, RMS ${db(rms).toFixed(1)} dB, Takt-RMS ${db(minRms).toFixed(1)} (Takt ${minBar}) bis ${db(maxRms).toFixed(1)} dB` +
      (quiet.length ? `, LEISE TAKTE: ${quiet.join(',')}` : ', keine stillen Takte') + (peak > 0.89 ? ' ACHTUNG: wenig Reserve' : ''));
  }
  // Final-lap variant and low intensity
  if (want('final')) {
    const buf = await renderSong(SONGS.kleeblatt, { from: 12, bars: 8, final: true });
    const s = stats(buf);
    lines.push(`Musik kleeblatt (letzte Runde): Spitze ${db(s.peak).toFixed(1)} dBFS, RMS ${db(s.rms).toFixed(1)} dB`);
    const low = stats(await renderSong(SONGS.kleeblatt, { bars: 8, intensity: 0.12 }));
    lines.push(`Musik kleeblatt (Countdown-Intensität): RMS ${db(low.rms).toFixed(1)} dB, Spitze ${db(low.peak).toFixed(1)} dBFS`);
  }

  // Effects (live chain: sfx volume 0.95 at full setting, master 0.9)
  if (want('sfx')) {
    const probe = new Sfx(new OfflineAudioContext(2, SR, SR), new GainNode(new OfflineAudioContext(2, SR, SR)), null);
    const names = probe.names();
    const loud: string[] = [];
    let worst = 0, worstName = '';
    for (const name of names) {
      const ctx = new OfflineAudioContext(2, Math.ceil(SR * 3.2), SR);
      const g = ctx.createGain(); g.gain.value = 0.95 * 0.9;
      g.connect(ctx.destination);
      const fx = new Sfx(ctx, g, null);
      fx.play(name, { gain: 0.9, at: 0.01 });
      const buf = await ctx.startRendering();
      const s = stats(buf);
      if (s.peak > worst) { worst = s.peak; worstName = name; }
      if (s.peak > 0.95) loud.push(`${name} ${db(s.peak).toFixed(1)}`);
      if (s.peak < 0.01) loud.push(`${name} STUMM`);
    }
    lines.push(`Effekte: ${names.length} geprüft, lautester ${worstName} ${db(worst).toFixed(1)} dBFS` + (loud.length ? `, auffällig: ${loud.join(', ')}` : ', alle unter -0.5 dBFS'));
  }

  // Engine at full throttle: top speed, boost, drift squeal
  if (want('engine')) {
    const ctx = new OfflineAudioContext(2, SR * 2, SR);
    const g = ctx.createGain(); g.gain.value = 0.9 * 0.95 * 0.9;
    g.connect(ctx.destination);
    const eng = new PlayerEngine(ctx, g);
    const k = { speed: 33, topSpeed: 29, grounded: true, stun: 0, boost: { time: 1, power: 1.3 }, surface: 'road', input: { throttle: 1, brake: 0 }, wheels: [{ grounded: true, slip: 1 }], drift: { active: true, level: 3 } } as unknown as Kart;
    for (let i = 0; i < 60; i++) eng.update(k, 1 / 30, true);
    const s = stats(await ctx.startRendering(), SR * 0.8);
    lines.push(`Motor (Vollgas+Turbo+Drift): Spitze ${db(s.peak).toFixed(1)} dBFS, RMS ${db(s.rms).toFixed(1)} dB`);
  }
  lines.push(`Fertig in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return lines.join('\n');
}
