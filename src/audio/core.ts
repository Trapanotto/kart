// Shared Web Audio helpers: noise buffers, reverb impulse, click-free envelopes.
// Everything takes a BaseAudioContext so the same code renders live and offline.

export type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
/** 2 s of white noise, cached per context. */
export function noiseBuffer(ctx: Ctx): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A soft, bright room impulse response for the reverb send. */
export function reverbImpulse(ctx: Ctx, seconds = 1.3, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 99;
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const t = i / len;
      const pre = i < ctx.sampleRate * 0.012 ? 0 : 1;
      d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - t, decay) * pre * 0.6;
    }
  }
  return b;
}

/** Attack–decay envelope on a gain param, click-free (starts and ends at 0). */
export function envAD(p: AudioParam, t: number, attack: number, peak: number, decay: number, curve: 'exp' | 'lin' = 'exp'): number {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.002, attack));
  const end = t + Math.max(0.002, attack) + decay;
  if (curve === 'exp') { p.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.001), end); p.linearRampToValueAtTime(0, end + 0.01); }
  else p.linearRampToValueAtTime(0, end);
  return end + 0.02;
}

/** Attack–hold–release envelope (for sustained notes). */
export function envAHR(p: AudioParam, t: number, attack: number, peak: number, hold: number, release: number, sustain = 1): number {
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.003, attack));
  if (sustain < 1) p.setTargetAtTime(peak * sustain, t + attack, Math.max(0.02, hold * 0.35));
  const relAt = t + Math.max(attack + 0.005, hold);
  p.setTargetAtTime(0, relAt, Math.max(0.01, release / 4));
  p.setValueAtTime(0, relAt + release * 1.6);
  return relAt + release * 1.6 + 0.02;
}

export function mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

/** tanh soft clip curve. */
export function softClip(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  return c;
}

/** Periodic wave with a toy-engine "putt" spectrum. */
export function engineWave(ctx: Ctx): PeriodicWave {
  const N = 24;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let k = 1; k < N; k++) {
    const formant = Math.exp(-((k - 5) ** 2) / 8) * 0.6;
    im[k] = (1 / Math.pow(k, 0.85)) * (k % 2 ? 1 : 0.7) + formant / k;
    re[k] = k % 3 === 0 ? 0.15 / k : 0;
  }
  return ctx.createPeriodicWave(re, im);
}

export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
