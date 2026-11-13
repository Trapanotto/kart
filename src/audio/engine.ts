// Kart engine sounds: a layered engine for the player and cheap panned voices for rivals.
import type { Kart, SurfaceType } from '../core/types';
import { clamp, engineWave, noiseBuffer, softClip, type Ctx } from './core';

const TC = 0.035; // smoothing time constant for parameter changes

function loopNoise(ctx: Ctx): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  return s;
}

const RUMBLE: Partial<Record<SurfaceType, number>> = { offroad: 1, sand: 0.8, water: 0.6, sticky: 0.5, ice: 0.15 };

/** Player engine: putt-putt core + sub + whine + intake noise + boost + tyre squeal + surface rumble + drift sparkle. */
export class PlayerEngine {
  private nodes: AudioScheduledSourceNode[] = [];
  private out: GainNode;
  private core: OscillatorNode;
  private saw: OscillatorNode;
  private sub: OscillatorNode;
  private whine: OscillatorNode;
  private am: GainNode;
  private amLfo: OscillatorNode;
  private lp: BiquadFilterNode;
  private coreGain: GainNode;
  private whineGain: GainNode;
  private intakeF: BiquadFilterNode;
  private intakeG: GainNode;
  private boostG: GainNode;
  private boostF: BiquadFilterNode;
  private squealG: GainNode;
  private squealF: BiquadFilterNode;
  private rumbleG: GainNode;
  private sparkG: GainNode;
  private spark: OscillatorNode;
  private rpm = 0;
  private flutter = 0;

  constructor(private ctx: Ctx, dest: AudioNode, seedPitch = 1) {
    const t = ctx.currentTime;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, t, 0.3);
    this.out.connect(dest);

    // core tone
    const shaper = ctx.createWaveShaper(); shaper.curve = softClip(1.8); shaper.oversample = '2x';
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 2.2; this.lp.frequency.value = 900;
    this.am = ctx.createGain(); this.am.gain.value = 0.75;
    this.coreGain = ctx.createGain(); this.coreGain.gain.value = 0.22;
    this.core = ctx.createOscillator(); this.core.setPeriodicWave(engineWave(ctx));
    this.saw = ctx.createOscillator(); this.saw.type = 'sawtooth'; this.saw.detune.value = 7;
    this.sub = ctx.createOscillator(); this.sub.type = 'triangle'; this.sub.detune.value = -6;
    const sawG = ctx.createGain(); sawG.gain.value = 0.22;
    const subG = ctx.createGain(); subG.gain.value = 0.55;
    this.core.connect(this.am);
    this.saw.connect(sawG).connect(this.am);
    this.sub.connect(subG).connect(this.am);
    this.am.connect(shaper).connect(this.lp).connect(this.coreGain).connect(this.out);
    // single-cylinder flutter
    this.amLfo = ctx.createOscillator(); this.amLfo.type = 'sine';
    const amDepth = ctx.createGain(); amDepth.gain.value = 0.25;
    this.amLfo.connect(amDepth).connect(this.am.gain);

    // electric toy whine
    this.whine = ctx.createOscillator(); this.whine.type = 'triangle';
    const wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.frequency.value = 1800; wbp.Q.value = 1;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(wbp).connect(this.whineGain).connect(this.out);

    // intake / exhaust hiss
    const n1 = loopNoise(ctx);
    this.intakeF = ctx.createBiquadFilter(); this.intakeF.type = 'bandpass'; this.intakeF.Q.value = 1.4;
    this.intakeG = ctx.createGain(); this.intakeG.gain.value = 0;
    n1.connect(this.intakeF).connect(this.intakeG).connect(this.out);

    // boost
    const n2 = loopNoise(ctx);
    this.boostF = ctx.createBiquadFilter(); this.boostF.type = 'bandpass'; this.boostF.frequency.value = 2400; this.boostF.Q.value = 0.8;
    this.boostG = ctx.createGain(); this.boostG.gain.value = 0;
    n2.connect(this.boostF).connect(this.boostG).connect(this.out);

    // tyre squeal: two resonances, wobbling
    const n3 = loopNoise(ctx);
    this.squealF = ctx.createBiquadFilter(); this.squealF.type = 'bandpass'; this.squealF.frequency.value = 2100; this.squealF.Q.value = 9;
    const sq2 = ctx.createBiquadFilter(); sq2.type = 'bandpass'; sq2.frequency.value = 3150; sq2.Q.value = 12;
    const sqLfo = ctx.createOscillator(); sqLfo.frequency.value = 7.5;
    const sqDepth = ctx.createGain(); sqDepth.gain.value = 140;
    sqLfo.connect(sqDepth).connect(this.squealF.frequency);
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    n3.connect(this.squealF).connect(this.squealG);
    n3.connect(sq2).connect(this.squealG);
    this.squealG.connect(this.out);

    // surface rumble
    const n4 = loopNoise(ctx);
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 170; rlp.Q.value = 0.9;
    const rAm = ctx.createGain(); rAm.gain.value = 0.6;
    const rLfo = ctx.createOscillator(); rLfo.frequency.value = 11;
    const rDepth = ctx.createGain(); rDepth.gain.value = 0.4;
    rLfo.connect(rDepth).connect(rAm.gain);
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0;
    n4.connect(rlp).connect(rAm).connect(this.rumbleG).connect(this.out);

    // drift sparkle
    this.spark = ctx.createOscillator(); this.spark.type = 'triangle'; this.spark.frequency.value = 1760;
    const trem = ctx.createGain(); trem.gain.value = 0.5;
    const tLfo = ctx.createOscillator(); tLfo.frequency.value = 18;
    const tDepth = ctx.createGain(); tDepth.gain.value = 0.5;
    tLfo.connect(tDepth).connect(trem.gain);
    this.sparkG = ctx.createGain(); this.sparkG.gain.value = 0;
    this.spark.connect(trem).connect(this.sparkG).connect(this.out);

    this.nodes = [this.core, this.saw, this.sub, this.amLfo, this.whine, n1, n2, n3, sqLfo, n4, rLfo, this.spark, tLfo];
    for (const n of this.nodes) n.start(t);
    this.rpm = 0;
    this.core.detune.value = (seedPitch - 1) * 1200;
  }

  update(k: Kart, dt: number, active: boolean): void {
    const t = this.ctx.currentTime;
    const top = Math.max(5, k.topSpeed);
    const speedFrac = clamp(Math.abs(k.speed) / top, 0, 1.5);
    const throttle = active && k.stun <= 0 ? Math.max(k.input.throttle, k.input.brake > 0 && Math.abs(k.speed) < 1 ? 0.6 : 0) : 0;
    // Free revving in the air, otherwise tied to wheel speed.
    const target = k.grounded ? 0.12 + speedFrac * 0.8 + throttle * 0.08 : Math.min(1.25, this.rpm + throttle * dt * 1.5);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 5 : 3));
    const boost = k.boost.time > 0 ? 1 : 0;
    const rpm = this.rpm + boost * 0.12;
    const f = 36 + rpm * 118;
    const load = throttle * (0.6 + 0.4 * (1 - speedFrac));
    this.flutter += dt;

    this.core.frequency.setTargetAtTime(f, t, TC);
    this.saw.frequency.setTargetAtTime(f * 2, t, TC);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, TC);
    this.amLfo.frequency.setTargetAtTime(f * 0.5, t, TC);
    this.lp.frequency.setTargetAtTime(380 + load * 2200 + rpm * 1300 + boost * 900, t, TC * 2);
    this.coreGain.gain.setTargetAtTime(active ? 0.13 + load * 0.08 + rpm * 0.05 : 0, t, TC * 2);
    this.whine.frequency.setTargetAtTime(f * 6.2, t, TC);
    this.whineGain.gain.setTargetAtTime(active ? speedFrac * 0.03 + boost * 0.02 : 0, t, TC * 2);
    this.intakeF.frequency.setTargetAtTime(f * 9, t, TC);
    this.intakeG.gain.setTargetAtTime(active ? 0.012 + load * 0.05 : 0, t, TC * 2);
    this.boostG.gain.setTargetAtTime(active ? boost * 0.14 : 0, t, 0.08);
    this.boostF.frequency.setTargetAtTime(1800 + rpm * 1500, t, 0.1);

    let slip = 0;
    for (const w of k.wheels) if (w.grounded) slip = Math.max(slip, w.slip);
    if (k.drift.active) slip = Math.max(slip, 0.35);
    const squeal = active && k.grounded && Math.abs(k.speed) > 4 && k.surface !== 'offroad' && k.surface !== 'sand' && k.surface !== 'water' ? clamp((slip - 0.25) / 0.6, 0, 1) : 0;
    this.squealG.gain.setTargetAtTime(squeal * 0.075, t, 0.05);

    const rum = active && k.grounded ? (RUMBLE[k.surface] ?? 0.05) * clamp(Math.abs(k.speed) / 10, 0, 1) : 0;
    this.rumbleG.gain.setTargetAtTime(rum * 0.5, t, 0.08);

    const lv = k.drift.active ? k.drift.level : 0;
    this.spark.frequency.setTargetAtTime([0, 1760, 2093, 2637][lv], t, 0.02);
    this.sparkG.gain.setTargetAtTime(active && lv > 0 ? 0.012 + lv * 0.006 : 0, t, 0.05);
  }

  dispose(fade = 0.25): void {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    for (const n of this.nodes) { try { n.stop(t + fade + 0.1); } catch { /* */ } }
  }
}

/** Cheap rival engine: one wave, one filter, distance gain and stereo pan (no Doppler). */
export class RivalEngine {
  private osc: OscillatorNode;
  private lp: BiquadFilterNode;
  private g: GainNode;
  private pan: StereoPannerNode;
  private rpm = 0.1;

  constructor(private ctx: Ctx, dest: AudioNode, private pitch: number) {
    this.osc = ctx.createOscillator(); this.osc.setPeriodicWave(engineWave(ctx));
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 900; this.lp.Q.value = 1.2;
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.osc.connect(this.lp).connect(this.g).connect(this.pan).connect(dest);
    this.osc.start();
  }

  update(k: Kart, dt: number, dist: number, pan: number, active: boolean): void {
    const t = this.ctx.currentTime;
    const sf = clamp(Math.abs(k.speed) / Math.max(5, k.topSpeed), 0, 1.4);
    this.rpm += (0.12 + sf * 0.85 - this.rpm) * Math.min(1, dt * 4);
    const f = (38 + this.rpm * 115) * this.pitch;
    this.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.lp.frequency.setTargetAtTime(500 + this.rpm * 1400, t, 0.05);
    const att = 1 / (1 + (dist / 9) ** 2);
    this.g.gain.setTargetAtTime(active ? 0.16 * att : 0, t, 0.06);
    this.pan.pan.setTargetAtTime(clamp(pan, -1, 1) * 0.85, t, 0.06);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    this.g.gain.setTargetAtTime(0, t, 0.05);
    try { this.osc.stop(t + 0.3); } catch { /* */ }
  }
}
