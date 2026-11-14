// Synthesised instruments for the music. Each call schedules one note and cleans up after itself.
import { envAD, envAHR, mtof, noiseBuffer, type Ctx } from './core';

export type InstrumentName = 'flute' | 'fiddle' | 'bell' | 'pluck' | 'keys' | 'pad' | 'bass' | 'brass' | 'marimba'
  | 'koto' | 'shaku' | 'mallet' | 'clav' | 'buzz' | 'pipe' | 'icelead' | 'glass' | 'icepad' | 'horn';

export interface Inst {
  (ctx: Ctx, out: AudioNode, t: number, midi: number, dur: number, vel: number): void;
}

function voice(ctx: Ctx, out: AudioNode, type: OscillatorType, f: number, detune = 0): { o: OscillatorNode; g: GainNode } {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.value = 0;
  o.connect(g).connect(out);
  return { o, g };
}

function vibrato(ctx: Ctx, target: AudioParam, t: number, end: number, rate: number, cents: number, delay: number): void {
  const l = ctx.createOscillator();
  l.frequency.value = rate;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.linearRampToValueAtTime(0, t + delay);
  lg.gain.linearRampToValueAtTime(cents, t + delay + 0.25);
  l.connect(lg).connect(target);
  l.start(t); l.stop(end);
}

/** Breathy toy flute / ocarina. */
const flute: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 6); lp.Q.value = 0.5;
  lp.connect(out);
  const a = voice(ctx, lp, 'triangle', f);
  const b = voice(ctx, lp, 'sine', f * 2, 3);
  const end = envAHR(a.g.gain, t, 0.025, 0.42 * vel, dur, 0.12, 0.85);
  envAHR(b.g.gain, t, 0.03, 0.09 * vel, dur, 0.1, 0.7);
  vibrato(ctx, a.o.detune, t, end, 5.4, 9, Math.min(0.18, dur * 0.5));
  vibrato(ctx, b.o.detune, t, end, 5.4, 9, Math.min(0.18, dur * 0.5));
  // breath chiff
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 3; bp.Q.value = 2;
  const ng = ctx.createGain(); ng.gain.value = 0;
  n.connect(bp).connect(ng).connect(out);
  envAD(ng.gain, t, 0.005, 0.05 * vel, 0.06);
  n.start(t, Math.random()); n.stop(t + 0.12);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Bright bowed lead for the country theme. */
const fiddle: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(7000, f * 4.5); lp.Q.value = 1.2;
  const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2400; pk.gain.value = 4; pk.Q.value = 1.4;
  lp.connect(pk).connect(out);
  const a = voice(ctx, lp, 'sawtooth', f, -4);
  const b = voice(ctx, lp, 'sawtooth', f, 5);
  const end = envAHR(a.g.gain, t, 0.035, 0.13 * vel, dur, 0.09, 0.9);
  envAHR(b.g.gain, t, 0.045, 0.11 * vel, dur, 0.09, 0.9);
  vibrato(ctx, a.o.detune, t, end, 6, 14, 0.12);
  vibrato(ctx, b.o.detune, t, end, 6.2, 14, 0.12);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Glockenspiel-like FM bell. */
const bell: Inst = (ctx, out, t, m, _dur, vel) => {
  const f = mtof(m);
  const car = ctx.createOscillator(); car.frequency.value = f;
  const mod = ctx.createOscillator(); mod.frequency.value = f * 3.5;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 2.2, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
  mod.connect(mg).connect(car.frequency);
  const g = ctx.createGain(); g.gain.value = 0;
  car.connect(g).connect(out);
  const end = envAD(g.gain, t, 0.002, 0.22 * vel, 1.1);
  car.start(t); mod.start(t); car.stop(end); mod.stop(end);
};

/** Banjo-ish pluck (chords, arps). */
const pluck: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
  lp.frequency.setValueAtTime(Math.min(10000, f * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), t + 0.25);
  lp.connect(out);
  const a = voice(ctx, lp, 'sawtooth', f);
  const b = voice(ctx, lp, 'square', f * 2, 4);
  const d = Math.min(0.55, Math.max(0.18, dur));
  const end = envAD(a.g.gain, t, 0.002, 0.12 * vel, d);
  envAD(b.g.gain, t, 0.002, 0.03 * vel, d * 0.5);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Soft electric piano. */
const keys: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const a = voice(ctx, out, 'sine', f);
  const b = voice(ctx, out, 'sine', f * 2, 2);
  const c = voice(ctx, out, 'triangle', f * 4.02);
  const end = envAHR(a.g.gain, t, 0.006, 0.17 * vel, dur, 0.25, 0.55);
  envAD(b.g.gain, t, 0.004, 0.06 * vel, 0.5);
  envAD(c.g.gain, t, 0.002, 0.025 * vel, 0.12);
  for (const v of [a, b, c]) { v.o.start(t); v.o.stop(end); }
};

/** Warm detuned pad. */
const pad: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.4;
  lp.connect(out);
  const a = voice(ctx, lp, 'sawtooth', f, -9);
  const b = voice(ctx, lp, 'sawtooth', f, 9);
  const end = envAHR(a.g.gain, t, 0.25, 0.045 * vel, dur, 0.5);
  envAHR(b.g.gain, t, 0.3, 0.045 * vel, dur, 0.5);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Round, punchy bass. */
const bass: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
  lp.frequency.setValueAtTime(f * 7, t);
  lp.frequency.exponentialRampToValueAtTime(f * 2.2, t + 0.15);
  lp.connect(out);
  const a = voice(ctx, lp, 'triangle', f);
  const b = voice(ctx, lp, 'square', f, 0);
  const s = voice(ctx, out, 'sine', f / 2 > 30 ? f : f);
  const end = envAHR(a.g.gain, t, 0.006, 0.42 * vel, Math.max(0.08, dur * 0.92), 0.06, 0.75);
  envAHR(b.g.gain, t, 0.006, 0.07 * vel, Math.max(0.08, dur * 0.92), 0.06, 0.6);
  envAHR(s.g.gain, t, 0.008, 0.2 * vel, Math.max(0.08, dur * 0.92), 0.06, 0.8);
  for (const v of [a, b, s]) { v.o.start(t); v.o.stop(end); }
};

/** Brassy fanfare voice. */
const brass: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
  lp.frequency.setValueAtTime(f * 1.2, t);
  lp.frequency.linearRampToValueAtTime(f * 6, t + 0.06);
  lp.frequency.setTargetAtTime(f * 3.5, t + 0.08, 0.2);
  lp.connect(out);
  const a = voice(ctx, lp, 'sawtooth', f, -6);
  const b = voice(ctx, lp, 'sawtooth', f, 6);
  const end = envAHR(a.g.gain, t, 0.04, 0.12 * vel, dur, 0.15, 0.85);
  envAHR(b.g.gain, t, 0.05, 0.12 * vel, dur, 0.15, 0.85);
  vibrato(ctx, a.o.detune, t, end, 5, 8, 0.25);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Wooden marimba. */
const marimba: Inst = (ctx, out, t, m, _dur, vel) => {
  const f = mtof(m);
  const a = voice(ctx, out, 'sine', f);
  const b = voice(ctx, out, 'sine', f * 4, 0);
  const end = envAD(a.g.gain, t, 0.002, 0.3 * vel, 0.45);
  envAD(b.g.gain, t, 0.001, 0.08 * vel, 0.05);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

// ---------------------------------------------------------------- Bambus-Tempel

/** Plucked koto: twangy attack with a tiny pitch drop, short ringing decay. */
const koto: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
  lp.frequency.setValueAtTime(Math.min(11000, f * 10), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.8), t + 0.3);
  lp.connect(out);
  const a = voice(ctx, lp, 'sawtooth', f);
  a.o.frequency.setValueAtTime(f * 1.015, t);
  a.o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
  const b = voice(ctx, out, 'triangle', f * 3, 3);
  const d = Math.min(1.1, Math.max(0.35, dur * 1.6));
  const end = envAD(a.g.gain, t, 0.002, 0.115 * vel, d);
  envAD(b.g.gain, t, 0.001, 0.03 * vel, 0.09);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Shakuhachi: airy bamboo flute that scoops into the note, lots of breath. */
const shaku: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(8000, f * 4); lp.Q.value = 0.7;
  lp.connect(out);
  const a = voice(ctx, lp, 'triangle', f);
  a.o.detune.setValueAtTime(-70, t);
  a.o.detune.linearRampToValueAtTime(0, t + 0.09);
  const b = voice(ctx, lp, 'sine', f * 2, 4);
  const end = envAHR(a.g.gain, t, 0.06, 0.34 * vel, dur, 0.18, 0.78);
  envAHR(b.g.gain, t, 0.08, 0.07 * vel, dur, 0.15, 0.6);
  vibrato(ctx, a.o.detune, t, end, 4.6, 16, Math.min(0.3, dur * 0.6));
  const n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx); n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(9000, f * 2); bp.Q.value = 1.6;
  const ng = ctx.createGain(); ng.gain.value = 0;
  n.connect(bp).connect(ng).connect(out);
  envAHR(ng.gain, t, 0.015, 0.075 * vel, dur, 0.12, 0.35);
  n.start(t, Math.random()); n.stop(end);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

// ---------------------------------------------------------------- Honigfabrik

/** Vibraphone mallet: bar partials 1:4 with a motor tremolo. */
const mallet: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const trem = ctx.createGain(); trem.gain.value = 0.82; trem.connect(out);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 5.6;
  const lg = ctx.createGain(); lg.gain.value = 0.18;
  lfo.connect(lg).connect(trem.gain);
  const a = voice(ctx, trem, 'sine', f);
  const b = voice(ctx, trem, 'sine', f * 4);
  const d = Math.max(0.45, Math.min(1.4, dur + 0.35));
  const end = envAD(a.g.gain, t, 0.002, 0.3 * vel, d);
  envAD(b.g.gain, t, 0.001, 0.09 * vel, 0.16);
  lfo.start(t); lfo.stop(end);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Funky clavinet: snappy filtered pulse for stabs. */
const clav: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
  lp.frequency.setValueAtTime(Math.min(10000, f * 11), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, f * 2.5), t + 0.12);
  lp.connect(out);
  const a = voice(ctx, lp, 'square', f);
  const b = voice(ctx, lp, 'sawtooth', f * 2, 4);
  const d = Math.min(0.3, Math.max(0.1, dur));
  const end = envAD(a.g.gain, t, 0.002, 0.065 * vel, d);
  envAD(b.g.gain, t, 0.002, 0.03 * vel, d * 0.6);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Busy-bee kazoo: nasal buzzing lead with a fast flutter. */
const buzz: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(5000, Math.max(900, f * 2.5)); bp.Q.value = 1.1;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 6); lp.Q.value = 0.5;
  bp.connect(out); lp.connect(out);
  const a = voice(ctx, bp, 'sawtooth', f, -5);
  const b = voice(ctx, lp, 'triangle', f, 5);
  const end = envAHR(a.g.gain, t, 0.02, 0.28 * vel, dur, 0.08, 0.85);
  envAHR(b.g.gain, t, 0.02, 0.2 * vel, dur, 0.08, 0.85);
  vibrato(ctx, a.o.detune, t, end, 11, 18, 0.05);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Struck copper pipe: hollow, slightly inharmonic ring. */
const pipe: Inst = (ctx, out, t, m, _dur, vel) => {
  const f = mtof(m);
  const a = voice(ctx, out, 'triangle', f);
  const b = voice(ctx, out, 'sine', f * 2.76);
  const end = envAD(a.g.gain, t, 0.002, 0.2 * vel, 0.9);
  envAD(b.g.gain, t, 0.001, 0.06 * vel, 0.3);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

// ---------------------------------------------------------------- Gletscher-Gipfel

/** Bright icy synth lead. */
const icelead: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
  lp.frequency.setValueAtTime(Math.min(9000, f * 8), t);
  lp.frequency.setTargetAtTime(Math.min(7000, f * 4.5), t + 0.02, 0.12);
  lp.connect(out);
  const a = voice(ctx, lp, 'square', f, -7);
  const b = voice(ctx, lp, 'sawtooth', f, 7);
  const end = envAHR(a.g.gain, t, 0.008, 0.06 * vel, dur, 0.1, 0.8);
  envAHR(b.g.gain, t, 0.008, 0.1 * vel, dur, 0.1, 0.8);
  vibrato(ctx, b.o.detune, t, end, 5.8, 12, 0.2);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Glass bell: pure tone with a slightly beating octave. */
const glass: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const a = voice(ctx, out, 'sine', f);
  const b = voice(ctx, out, 'sine', f * 2.006);
  const d = Math.min(1.2, Math.max(0.3, dur * 3));
  const end = envAD(a.g.gain, t, 0.002, 0.17 * vel, d);
  envAD(b.g.gain, t, 0.001, 0.08 * vel, d * 0.6);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Cold, airy pad. */
const icepad: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 0.6;
  lp.connect(out);
  const a = voice(ctx, lp, 'triangle', f, -8);
  const b = voice(ctx, lp, 'sine', f * 2, 7);
  const end = envAHR(a.g.gain, t, 0.35, 0.1 * vel, dur, 0.6);
  envAHR(b.g.gain, t, 0.45, 0.045 * vel, dur, 0.6);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

/** Alphorn: warm, swelling, scoops into the note. */
const horn: Inst = (ctx, out, t, m, dur, vel) => {
  const f = mtof(m);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(f * 1.4, t);
  lp.frequency.linearRampToValueAtTime(f * 3.6, t + 0.18);
  lp.connect(out);
  const a = voice(ctx, lp, 'sawtooth', f);
  a.o.detune.setValueAtTime(-45, t);
  a.o.detune.linearRampToValueAtTime(0, t + 0.12);
  const b = voice(ctx, out, 'sine', f);
  const end = envAHR(a.g.gain, t, 0.09, 0.16 * vel, dur, 0.22, 0.85);
  envAHR(b.g.gain, t, 0.07, 0.16 * vel, dur, 0.22, 0.85);
  vibrato(ctx, a.o.detune, t, end, 4.8, 10, 0.3);
  for (const v of [a, b]) { v.o.start(t); v.o.stop(end); }
};

export const INSTRUMENTS: Record<InstrumentName, Inst> = {
  flute, fiddle, bell, pluck, keys, pad, bass, brass, marimba,
  koto, shaku, mallet, clav, buzz, pipe, icelead, glass, icepad, horn,
};

// ---------------------------------------------------------------- drums

export type DrumName = 'kick' | 'snare' | 'hat' | 'ohat' | 'clap' | 'shaker' | 'tom' | 'crash' | 'block'
  | 'taiko' | 'clank' | 'press' | 'sleigh';

export function drum(ctx: Ctx, out: AudioNode, name: DrumName, t: number, vel: number): void {
  const nb = noiseBuffer(ctx);
  const noise = (dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.001) => {
    const s = ctx.createBufferSource(); s.buffer = nb;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(out);
    const end = envAD(g.gain, t, attack, gain * vel, dur);
    s.start(t, Math.random() * 1.5); s.stop(end);
  };
  const tone = (f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(g).connect(out);
    const end = envAD(g.gain, t, 0.002, gain * vel, dur);
    o.start(t); o.stop(end);
  };
  switch (name) {
    case 'kick': tone(160, 48, 0.32, 0.85); noise(0.012, 'lowpass', 2500, 0.7, 0.18); break;
    case 'snare': tone(220, 170, 0.09, 0.25, 'triangle'); noise(0.17, 'bandpass', 2100, 0.8, 0.42); break;
    case 'hat': noise(0.035, 'highpass', 7500, 0.7, 0.16); break;
    case 'ohat': noise(0.22, 'highpass', 7000, 0.7, 0.12); break;
    case 'clap':
      for (let i = 0; i < 3; i++) {
        const s = ctx.createBufferSource(); s.buffer = nb;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 1.2;
        const g = ctx.createGain(); g.gain.value = 0;
        s.connect(f).connect(g).connect(out);
        const tt = t + i * 0.011;
        g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.32 * vel, tt + 0.002);
        g.gain.exponentialRampToValueAtTime(0.001, tt + (i === 2 ? 0.16 : 0.01)); g.gain.linearRampToValueAtTime(0, tt + (i === 2 ? 0.17 : 0.012));
        s.start(tt, Math.random()); s.stop(tt + 0.2);
      }
      break;
    case 'shaker': noise(0.05, 'bandpass', 6500, 1.2, 0.09, 0.012); break;
    case 'tom': tone(180, 95, 0.25, 0.5); break;
    case 'crash': noise(1.3, 'highpass', 4500, 0.5, 0.16); noise(0.6, 'bandpass', 3000, 0.8, 0.06); break;
    case 'block': tone(1100, 1000, 0.05, 0.25, 'sine'); break;
    case 'taiko': tone(125, 60, 0.5, 0.72); noise(0.05, 'lowpass', 900, 0.8, 0.25); break;
    case 'clank': tone(587, 560, 0.09, 0.06, 'square'); tone(1373, 1340, 0.06, 0.04, 'square'); noise(0.03, 'highpass', 5000, 0.7, 0.1); break;
    case 'press': tone(95, 40, 0.22, 0.55); noise(0.3, 'bandpass', 1500, 0.6, 0.15, 0.02); break;
    case 'sleigh': noise(0.09, 'bandpass', 9000, 3, 0.2, 0.003); noise(0.06, 'bandpass', 6200, 4, 0.12, 0.01); break;
  }
}
