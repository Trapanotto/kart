// Synthesised sound effects. Every sound is a short graph built on demand; nothing to download.
import type { CharacterId } from '../core/types';
import { envAD, envAHR, mtof, noiseBuffer, type Ctx } from './core';

export interface PlayOpts { gain?: number; pan?: number; pitch?: number; at?: number }

export class Sfx {
  constructor(private ctx: Ctx, private out: AudioNode, private send: AudioNode | null) {}

  // ------------------------------------------------------------ primitives
  private dest(o: PlayOpts, reverb = 0): AudioNode {
    const g = this.ctx.createGain();
    g.gain.value = o.gain ?? 1;
    let node: AudioNode = g;
    if (o.pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p);
      node = p;
    }
    node.connect(this.out);
    if (reverb > 0 && this.send) { const s = this.ctx.createGain(); s.gain.value = reverb; node.connect(s).connect(this.send); }
    // No manual disconnect: the graph is collected once its sources have stopped.
    return g;
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.004, glide: 'exp' | 'lin' = 'exp'): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) glide === 'exp' ? o.frequency.exponentialRampToValueAtTime(f1, t + dur) : o.frequency.linearRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.value = 0;
    o.connect(g).connect(out);
    const end = envAD(g.gain, t, attack, gain, dur);
    o.start(t); o.stop(end);
  }

  private noise(out: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.003): void {
    const s = this.ctx.createBufferSource(); s.buffer = noiseBuffer(this.ctx);
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.value = 0;
    s.connect(f).connect(g).connect(out);
    const end = envAD(g.gain, t, attack, gain, dur);
    s.start(t, Math.random() * 1.2); s.stop(end);
  }

  private fm(out: AudioNode, t: number, f: number, ratio: number, index: number, dur: number, gain: number): void {
    const c = this.ctx.createOscillator(); c.frequency.value = f;
    const m = this.ctx.createOscillator(); m.frequency.value = f * ratio;
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * index * 0.02 + 0.01, t + dur);
    m.connect(mg).connect(c.frequency);
    const g = this.ctx.createGain(); g.gain.value = 0;
    c.connect(g).connect(out);
    const end = envAD(g.gain, t, 0.002, gain, dur);
    c.start(t); m.start(t); c.stop(end); m.stop(end);
  }

  private notes(out: AudioNode, t: number, midis: number[], step: number, type: OscillatorType, dur: number, gain: number): void {
    midis.forEach((m, i) => this.tone(out, t + i * step, type, mtof(m), mtof(m), dur, gain));
  }

  private bells(out: AudioNode, t: number, midis: number[], step: number, gain: number, dur = 0.6): void {
    midis.forEach((m, i) => this.fm(out, t + i * step, mtof(m), 3.5, 1.6, dur, gain));
  }

  // ------------------------------------------------------------ catalogue
  play(name: string, o: PlayOpts = {}): void {
    const fn = (this as any)['s_' + name] as ((t: number, o: PlayOpts) => void) | undefined;
    if (!fn) return;
    fn.call(this, o.at ?? this.ctx.currentTime + 0.005, o);
  }

  names(): string[] {
    return Object.getOwnPropertyNames(Sfx.prototype).filter((n) => n.startsWith('s_')).map((n) => n.slice(2));
  }

  // UI
  s_move(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'sine', 880, 1100, 0.05, 0.16); this.tone(d, t, 'triangle', 1760, 1760, 0.03, 0.04); }
  s_confirm(t: number, o: PlayOpts) { const d = this.dest(o, 0.15); this.tone(d, t, 'sine', 520, 1040, 0.08, 0.22); this.bells(d, t + 0.05, [84, 91], 0.05, 0.08, 0.3); }
  s_back(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'sine', 700, 380, 0.1, 0.2); }
  s_toggle(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'square', 1200, 1200, 0.02, 0.05); this.tone(d, t + 0.03, 'sine', 1500, 1500, 0.04, 0.12); }
  s_slider(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'sine', 1300, 1300, 0.04, 0.14); }
  s_start(t: number, o: PlayOpts) { const d = this.dest(o, 0.25); this.bells(d, t, [72, 76, 79, 84], 0.06, 0.12, 0.7); this.noise(d, t, 0.35, 0.08, 'highpass', 3000, 9000, 0.7); }
  s_error(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'square', 220, 200, 0.08, 0.06); this.tone(d, t + 0.1, 'square', 180, 170, 0.12, 0.06); }
  s_pause(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.notes(d, t, [79, 72], 0.07, 'sine', 0.15, 0.16); }
  s_unpause(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.notes(d, t, [72, 79], 0.07, 'sine', 0.15, 0.16); }
  s_points(t: number, o: PlayOpts) { const d = this.dest(o); for (let i = 0; i < 10; i++) this.tone(d, t + i * 0.06, 'square', 1200 + i * 60, 1200 + i * 60, 0.03, 0.035); }
  s_trophy(t: number, o: PlayOpts) { const d = this.dest(o, 0.4); this.bells(d, t, [72, 76, 79, 84, 88, 91, 96], 0.07, 0.12, 1.2); this.noise(d, t + 0.3, 1.2, 0.05, 'highpass', 6000, 9000, 0.5, 0.2); }
  s_newRecord(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.bells(d, t, [79, 84, 88, 91], 0.09, 0.13, 0.9); }

  // Race flow
  s_countdown(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.tone(d, t, 'square', mtof(81), mtof(81), 0.22, 0.09, 0.003); this.tone(d, t, 'sine', mtof(81), mtof(81), 0.3, 0.2); }
  s_go(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); for (const m of [88, 93]) { this.tone(d, t, 'square', mtof(m), mtof(m), 0.6, 0.06); this.tone(d, t, 'sine', mtof(m), mtof(m), 0.7, 0.14); } this.noise(d, t, 0.5, 0.08, 'highpass', 2000, 6000, 0.6); }
  s_lap(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.bells(d, t, [84, 88, 91], 0.08, 0.14, 0.6); }
  s_finalLap(t: number, o: PlayOpts) { const d = this.dest(o, 0.35); this.notes(d, t, [79, 79, 79, 84], 0.11, 'square', 0.14, 0.07); this.notes(d, t, [67, 67, 67, 72], 0.11, 'sawtooth', 0.16, 0.05); this.bells(d, t + 0.33, [91, 96], 0.06, 0.12, 0.8); }
  s_rankUp(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.notes(d, t, [76, 83], 0.07, 'triangle', 0.14, 0.18); }
  s_rankDown(t: number, o: PlayOpts) { const d = this.dest(o); this.notes(d, t, [74, 69], 0.08, 'triangle', 0.14, 0.13); }
  s_warn(t: number, o: PlayOpts) { const d = this.dest(o); for (let i = 0; i < 3; i++) { this.tone(d, t + i * 0.13, 'square', 1250, 1250, 0.07, 0.07); this.tone(d, t + i * 0.13, 'sine', 1250, 1250, 0.08, 0.12); } }

  // Items
  s_itembox(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.noise(d, t, 0.12, 0.25, 'bandpass', 4000, 2000, 1.5); this.bells(d, t + 0.02, [88, 95, 100], 0.035, 0.1, 0.5); }
  s_rouletteTick(t: number, o: PlayOpts) { const d = this.dest(o); const f = 900 + Math.random() * 700; this.tone(d, t, 'square', f, f, 0.025, 0.04); this.tone(d, t, 'sine', f * 2, f * 2, 0.03, 0.05); }
  s_itemGot(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.bells(d, t, [84, 91, 96], 0.06, 0.13, 0.7); }
  s_use_acorn(t: number, o: PlayOpts) { const d = this.dest(o); this.noise(d, t, 0.12, 0.25, 'bandpass', 1200, 3500, 2); this.tone(d, t, 'sine', 300, 600, 0.08, 0.15); }
  s_use_honey(t: number, o: PlayOpts) { const d = this.dest(o, 0.1); this.tone(d, t, 'sine', 320, 110, 0.25, 0.35); for (let i = 0; i < 4; i++) this.tone(d, t + 0.05 + i * 0.05, 'sine', 500 + i * 120, 250, 0.05, 0.1); }
  s_use_giftbox(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.noise(d, t, 0.15, 0.16, 'bandpass', 2500, 1500, 1); this.bells(d, t + 0.05, [91, 88, 91], 0.05, 0.08, 0.4); }
  s_use_yarn(t: number, o: PlayOpts) { const d = this.dest(o); this.noise(d, t, 0.45, 0.25, 'bandpass', 400, 1600, 2); this.tone(d, t, 'triangle', 160, 260, 0.4, 0.1); }
  s_use_bees(t: number, o: PlayOpts) {
    const d = this.dest(o);
    for (const f of [210, 228, 245]) {
      const osc = this.ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
      const l = this.ctx.createOscillator(); l.frequency.value = 23 + Math.random() * 6;
      const lg = this.ctx.createGain(); lg.gain.value = f * 0.06; l.connect(lg).connect(osc.frequency);
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.5;
      const g = this.ctx.createGain(); g.gain.value = 0;
      osc.connect(bp).connect(g).connect(d);
      const end = envAHR(g.gain, t, 0.08, 0.13, 0.7, 0.3);
      osc.start(t); l.start(t); osc.stop(end); l.stop(end);
    }
  }
  s_use_bubble(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.tone(d, t, 'sine', 300, 900, 0.3, 0.25); this.bells(d, t + 0.15, [96, 100], 0.05, 0.06, 0.6); }
  s_use_carrot(t: number, o: PlayOpts) { const d = this.dest(o); this.noise(d, t, 0.06, 0.4, 'bandpass', 2500, 2500, 1.2); this.noise(d, t + 0.05, 0.08, 0.3, 'bandpass', 3200, 3200, 1.2); this.s_boost(t + 0.08, { ...o, gain: (o.gain ?? 1) * 0.9 }); }
  s_use_goldcarrot(t: number, o: PlayOpts) { this.s_use_carrot(t, o); const d = this.dest(o, 0.4); this.bells(d, t + 0.1, [84, 88, 91, 96, 100], 0.05, 0.08, 0.8); }
  s_use_lolly(t: number, o: PlayOpts) { const d = this.dest(o, 0.4); const sc = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96]; this.bells(d, t, sc, 0.045, 0.09, 0.5); this.noise(d, t, 0.9, 0.06, 'highpass', 5000, 9000, 0.5, 0.1); }
  s_use_cloud(t: number, o: PlayOpts) { const d = this.dest(o, 0.4); this.noise(d, t, 1.5, 0.45, 'lowpass', 300, 80, 0.8, 0.05); this.noise(d, t, 0.25, 0.3, 'highpass', 3000, 1200, 0.7); this.tone(d, t, 'sawtooth', 2400, 200, 0.18, 0.08); }
  s_use_yawn(t: number, o: PlayOpts) {
    const d = this.dest(o, 0.3);
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260, t); osc.frequency.linearRampToValueAtTime(330, t + 0.3); osc.frequency.exponentialRampToValueAtTime(140, t + 1.3);
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
    f1.frequency.setValueAtTime(500, t); f1.frequency.linearRampToValueAtTime(850, t + 0.4); f1.frequency.linearRampToValueAtTime(600, t + 1.3);
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 6; f2.frequency.value = 1300;
    const g = this.ctx.createGain(); g.gain.value = 0;
    osc.connect(f1).connect(g); osc.connect(f2).connect(g); g.connect(d);
    const end = envAHR(g.gain, t, 0.15, 0.5, 1.0, 0.35);
    osc.start(t); osc.stop(end);
  }

  // Hits
  s_hit_spin(t: number, o: PlayOpts) { const d = this.dest(o, 0.15); this.noise(d, t, 0.12, 0.45, 'lowpass', 1200, 300, 1); this.tone(d, t + 0.02, 'sine', 1400, 300, 0.5, 0.18, 0.01, 'exp'); this.tone(d, t, 'triangle', 180, 90, 0.2, 0.3); }
  s_hit_tumble(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.noise(d, t, 0.35, 0.55, 'lowpass', 900, 150, 0.8); this.tone(d, t, 'sine', 130, 50, 0.4, 0.5); for (let i = 0; i < 3; i++) this.noise(d, t + 0.15 + i * 0.12, 0.08, 0.2, 'bandpass', 800 - i * 150, 600, 2); }
  s_hit_squash(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'square', 260, 70, 0.25, 0.14); this.noise(d, t, 0.2, 0.3, 'lowpass', 700, 200, 2); }
  s_hit_zap(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.tone(d, t, 'sawtooth', 2000, 80, 0.35, 0.12); this.noise(d, t, 0.3, 0.2, 'highpass', 4000, 1500, 0.7); }
  s_hit_bump(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'sine', 140, 70, 0.15, 0.4); this.noise(d, t, 0.06, 0.2, 'lowpass', 1200, 400, 1); }
  s_shield(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.tone(d, t, 'sine', 500, 1200, 0.18, 0.25); this.bells(d, t + 0.05, [91], 0, 0.1, 0.5); }

  // Movement
  s_boost(t: number, o: PlayOpts) { const d = this.dest(o, 0.15); const s = o.pitch ?? 1; this.noise(d, t, 0.7, 0.35, 'bandpass', 600 * s, 3500 * s, 1.2, 0.02); this.tone(d, t, 'sawtooth', 120 * s, 260 * s, 0.5, 0.08, 0.02); }
  s_startBoost(t: number, o: PlayOpts) { this.s_boost(t, { ...o, pitch: 1.2 }); const d = this.dest(o, 0.3); this.bells(d, t, [84, 91], 0.06, 0.1, 0.5); }
  s_drift1(t: number, o: PlayOpts) { const d = this.dest(o, 0.25); this.bells(d, t, [88], 0, 0.12, 0.35); }
  s_drift2(t: number, o: PlayOpts) { const d = this.dest(o, 0.25); this.bells(d, t, [88, 91], 0.05, 0.12, 0.4); }
  s_drift3(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.bells(d, t, [88, 91, 96], 0.05, 0.13, 0.5); }
  s_hop(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'sine', 300, 520, 0.07, 0.14); }
  s_jump(t: number, o: PlayOpts) { const d = this.dest(o); this.tone(d, t, 'triangle', 200, 600, 0.18, 0.2); this.noise(d, t, 0.2, 0.12, 'bandpass', 800, 2000, 1); }
  s_trick(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.tone(d, t, 'sine', 500, 1500, 0.22, 0.2); this.bells(d, t + 0.12, [91, 96], 0.05, 0.1, 0.4); }
  s_land(t: number, o: PlayOpts) { const d = this.dest(o); const k = Math.min(1, o.pitch ?? 0.5); this.tone(d, t, 'sine', 110, 50, 0.18 + k * 0.1, 0.25 + k * 0.4); this.noise(d, t, 0.1 + k * 0.1, 0.1 + k * 0.25, 'lowpass', 900, 200, 0.8); }
  s_collide(t: number, o: PlayOpts) { const d = this.dest(o); const k = Math.min(1, o.pitch ?? 0.5); this.noise(d, t, 0.08, 0.2 + k * 0.3, 'bandpass', 900, 500, 1.5); this.tone(d, t, 'square', 180 + k * 60, 120, 0.06, 0.06 + k * 0.08); this.tone(d, t, 'sine', 90, 60, 0.12, 0.2 + k * 0.2); }
  s_respawn(t: number, o: PlayOpts) { const d = this.dest(o, 0.35); this.tone(d, t, 'sine', 300, 1200, 0.5, 0.18, 0.05); this.bells(d, t + 0.3, [84, 88, 91], 0.06, 0.08, 0.5); }
  s_slipstream(t: number, o: PlayOpts) { const d = this.dest(o); this.noise(d, t, 0.6, 0.2, 'bandpass', 500, 1500, 0.8, 0.15); }
  s_splash(t: number, o: PlayOpts) { const d = this.dest(o, 0.2); this.noise(d, t, 0.45, 0.4, 'lowpass', 3000, 600, 0.6, 0.01); for (let i = 0; i < 5; i++) this.tone(d, t + 0.05 + i * 0.04, 'sine', 600 + Math.random() * 600, 1400, 0.04, 0.05); }
  s_crunch(t: number, o: PlayOpts) { const d = this.dest(o); for (let i = 0; i < 4; i++) this.noise(d, t + i * 0.03, 0.06, 0.25, 'bandpass', 1500 + i * 300, 800, 2); }
  s_rumble(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.noise(d, t, 2.8, 0.5, 'lowpass', 180, 60, 0.7, 0.4); }

  // Finish
  s_finishWin(t: number, o: PlayOpts) { const d = this.dest(o, 0.4); this.noise(d, t, 1.2, 0.1, 'highpass', 5000, 8000, 0.5); this.bells(d, t, [84, 88, 91, 96], 0.07, 0.12, 1); }
  s_finishLose(t: number, o: PlayOpts) { const d = this.dest(o, 0.3); this.notes(d, t, [76, 74, 72], 0.15, 'triangle', 0.3, 0.14); }

  // Animal voices: formant chirps, one personality each.
  voice(char: CharacterId, o: PlayOpts = {}): void {
    const t = o.at ?? this.ctx.currentTime + 0.01;
    const d = this.dest(o, 0.2);
    const V: Record<CharacterId, { f: number[]; vow: number[]; dur: number; vib: number; noise?: boolean }> = {
      sloth: { f: [190, 170, 150], vow: [600, 500], dur: 0.7, vib: 3 },
      sheep: { f: [430, 440, 420], vow: [550, 700], dur: 0.55, vib: 13 },
      redpanda: { f: [900, 1300, 900, 1300], vow: [1200, 1800], dur: 0.32, vib: 0 },
      hedgehog: { f: [700, 900], vow: [900, 1400], dur: 0.25, vib: 0, noise: true },
      penguin: { f: [320, 360, 300], vow: [700, 900], dur: 0.4, vib: 6 },
      capybara: { f: [150, 140], vow: [450, 400], dur: 0.35, vib: 0 },
      otter: { f: [1100, 1500, 1000], vow: [1400, 2000], dur: 0.35, vib: 0 },
      axolotl: { f: [400, 900, 1200], vow: [800, 1600], dur: 0.45, vib: 5 },
    };
    const v = V[char];
    const osc = this.ctx.createOscillator(); osc.type = 'sawtooth';
    v.f.forEach((f, i) => { const tt = t + (i / Math.max(1, v.f.length - 1)) * v.dur * 0.85; i === 0 ? osc.frequency.setValueAtTime(f, tt) : osc.frequency.linearRampToValueAtTime(f, tt); });
    if (v.vib) { const l = this.ctx.createOscillator(); l.frequency.value = v.vib; const lg = this.ctx.createGain(); lg.gain.value = v.f[0] * 0.04; l.connect(lg).connect(osc.frequency); l.start(t); l.stop(t + v.dur + 0.2); }
    const f1 = this.ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 4;
    f1.frequency.setValueAtTime(v.vow[0], t); f1.frequency.linearRampToValueAtTime(v.vow[1], t + v.dur);
    const f2 = this.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 5; f2.frequency.value = v.vow[1] * 1.9;
    const g = this.ctx.createGain(); g.gain.value = 0;
    osc.connect(f1).connect(g); osc.connect(f2).connect(g); g.connect(d);
    const end = envAHR(g.gain, t, 0.03, 0.55, v.dur, 0.08);
    osc.start(t); osc.stop(end);
    if (v.noise) for (let i = 0; i < 2; i++) this.noise(d, t + i * 0.12, 0.06, 0.18, 'bandpass', 3000, 2000, 1.5);
  }
}
