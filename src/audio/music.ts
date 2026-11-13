// Step sequencer for the composed songs: parses the song text once, schedules ahead on the
// AudioContext clock, and exposes adaptive controls (intensity layers, tempo, transposition).
import { drum, INSTRUMENTS, type DrumName, type InstrumentName } from './instruments';
import { clamp, type Ctx } from './core';
import type { BassPat, CompPat, DrumPat, PercPat, SectionDef, SongDef } from './songs';

export type Layer = 'drums' | 'perc' | 'bass' | 'comp' | 'lead' | 'counter';
const LAYERS: Layer[] = ['drums', 'perc', 'bass', 'comp', 'lead', 'counter'];
const LAYER_LEVEL: Record<Layer, number> = { drums: 0.62, perc: 0.42, bass: 0.6, comp: 0.5, lead: 0.62, counter: 0.36 };

const SCALE = [0, 2, 4, 5, 7, 9, 11];

// ---------------------------------------------------------------- parsing

interface NoteEv { deg: number; semis: number; steps: number; }
interface Chord { root: number; tones: number[]; }
interface Bar { chords: Chord[]; lead: (NoteEv | null)[]; }
interface Section { def: SectionDef; bars: Bar[]; }
export interface ParsedSong { def: SongDef; sections: Section[]; }

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

export function parseChord(sym: string): Chord {
  const m = /^(b|#)?([ivIV]+)(°|dim)?(maj7|7|sus4|sus2|add9|6)?$/.exec(sym.trim());
  if (!m) throw new Error('chord ' + sym);
  const idx = ROMAN.indexOf(m[2].toLowerCase());
  const root = (SCALE[idx] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0) + 12) % 12;
  const minor = m[2] === m[2].toLowerCase();
  const dim = !!m[3];
  let tones = [0, minor || dim ? 3 : 4, dim ? 6 : 7];
  if (m[4] === 'sus4') tones = [0, 5, 7];
  if (m[4] === 'sus2') tones = [0, 2, 7];
  if (m[4] === '7') tones.push(minor || dim ? 10 : 10);
  if (m[4] === 'maj7') tones.push(11);
  if (m[4] === 'add9') tones.push(14);
  if (m[4] === '6') tones.push(9);
  return { root, tones };
}

function parseDegree(tok: string): { deg: number; semis: number } {
  const m = /^(#|b)?([1-7])([',]*)$/.exec(tok);
  if (!m) throw new Error('note ' + tok);
  const d = Number(m[2]) - 1;
  let s = SCALE[d] + (m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0);
  for (const c of m[3]) s += c === '\'' ? 12 : -12;
  return { deg: d + 7 * ([...m[3]].filter((c) => c === '\'').length - [...m[3]].filter((c) => c === ',').length), semis: s };
}

function parseLead(text: string | undefined, bars: number): (NoteEv | null)[][] {
  const out: (NoteEv | null)[][] = [];
  const barTexts = (text ?? '').split('|').map((b) => b.trim().split(/\s+/).filter(Boolean));
  for (let b = 0; b < bars; b++) {
    const toks = barTexts[b] ?? [];
    const steps: (NoteEv | null)[] = new Array(16).fill(null);
    for (let i = 0; i < 8; i++) {
      const t = toks[i];
      if (!t || t === '.' || t === '-') continue;
      if (t.includes('_')) {
        const [a, c] = t.split('_');
        steps[i * 2] = { ...parseDegree(a), steps: 1 };
        steps[i * 2 + 1] = { ...parseDegree(c), steps: 1 };
        continue;
      }
      let holds = 0;
      for (let j = i + 1; j < 8 && toks[j] === '-'; j++) holds++;
      steps[i * 2] = { ...parseDegree(t), steps: 2 + holds * 2 };
    }
    out.push(steps);
  }
  return out;
}

export function parseSong(def: SongDef): ParsedSong {
  const sections = def.order.map((name) => {
    const s = def.sections[name];
    if (!s) throw new Error('section ' + name);
    const chordBars = s.chords.split('|').map((b) => b.trim().split(/\s+/).filter(Boolean).map(parseChord));
    const leads = parseLead(s.lead, s.bars);
    const bars: Bar[] = [];
    for (let b = 0; b < s.bars; b++) bars.push({ chords: chordBars[b % chordBars.length], lead: leads[b] });
    return { def: s, bars };
  });
  return { def, sections };
}

// ---------------------------------------------------------------- patterns

const BASS: Record<BassPat, string> = {
  whole: 'R - - - - - - -', half: 'R - - - F - - -', country: 'R . F . R . F .', pop: 'R - . R - . F -',
  drive: 'R R R R R R R R', walk: 'R - T - F - A -', bounce: 'R . O . R . F A', none: '',
};
type DrumLine = Partial<Record<DrumName, string>>;
const DRUMS: Record<DrumPat, DrumLine> = {
  none: {},
  light: { kick: 'x.......x.......', shaker: '..x...x...x...x.' },
  pop: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
  country: { kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', shaker: 'xxxxxxxxxxxxxxxx' },
  half: { kick: 'x.........x.....', snare: '........x.......', hat: 'x...x...x...x...' },
  drive: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx' },
  march: { kick: 'x...x...x...x...', snare: '..x...x.x.x...xx' },
};
const FILL: DrumLine = { kick: 'x.......x.......', snare: '....x...x.x.xxxx', tom: '........x.x.....' };
const PERC: Record<PercPat, DrumLine> = {
  none: {},
  claps: { clap: '....x.......x...', ohat: '..x...x...x...x.' },
  shaker: { shaker: 'x.xxx.xxx.xxx.xx', block: '......x.......x.' },
};
const COMP: Record<CompPat, string> = {
  block: 'x-----x---x-----', stab: '....x.......x...', offbeat: '..x...x...x...x.', strum8: 'x.x.x.x.x.x.x.x.',
  pad: 'x---------------', arp: 'a.a.a.a.a.a.a.a.', arp16: 'aaaaaaaaaaaaaaaa', none: '',
};
const COUNTER = '....x.......x.x.';

// ---------------------------------------------------------------- engine

interface Playing {
  song: ParsedSong;
  out: GainNode;
  layers: Record<Layer, GainNode>;
  sec: number;
  bar: number;
  step: number;
  next: number;
  voicing: number[];
  arpI: number;
  stopped: boolean;
  onEnd?: () => void;
}

export class Music {
  private p: Playing | null = null;
  private fading: Playing[] = [];
  intensity = 1;
  private tempoMul = 1;
  private transpose = 0;
  private pendingTempo = 1;
  private pendingTranspose = 0;
  private parsed = new Map<string, ParsedSong>();
  rnd: () => number = Math.random;

  constructor(private ctx: Ctx, private out: AudioNode, private send: AudioNode | null) {}

  get current(): string | null { return this.p && !this.p.stopped ? this.p.song.def.id : null; }

  private parse(def: SongDef): ParsedSong {
    let s = this.parsed.get(def.id);
    if (!s) { s = parseSong(def); this.parsed.set(def.id, s); }
    return s;
  }

  play(def: SongDef, opts: { at?: number; intensity?: number; onEnd?: () => void; fadeOut?: number } = {}): void {
    this.stop(opts.fadeOut ?? 0.6);
    const ctx = this.ctx;
    const t0 = Math.max(ctx.currentTime + 0.06, opts.at ?? 0);
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.out);
    if (this.send) {
      const s = ctx.createGain(); s.gain.value = 0.22;
      out.connect(s).connect(this.send);
    }
    const layers = {} as Record<Layer, GainNode>;
    for (const l of LAYERS) { const g = ctx.createGain(); g.gain.value = 0; g.connect(out); layers[l] = g; }
    this.tempoMul = this.pendingTempo = 1;
    this.transpose = this.pendingTranspose = 0;
    if (opts.intensity !== undefined) this.intensity = opts.intensity;
    this.p = { song: this.parse(def), out, layers, sec: 0, bar: 0, step: 0, next: t0, voicing: [], arpI: 0, stopped: false, onEnd: opts.onEnd };
    this.applyIntensity(0.01, t0);
  }

  /** Skips ahead `bars` bars without scheduling anything (offline checks of later sections). */
  seek(bars: number): void {
    const p = this.p;
    if (!p) return;
    const t0 = p.next;
    for (let i = 0; i < bars * 16 && !p.stopped; i++) this.advance(p);
    p.next = t0;
  }

  stop(fade = 0.6): void {
    const p = this.p;
    if (!p) return;
    p.stopped = true;
    const t = this.ctx.currentTime;
    p.out.gain.cancelScheduledValues(t);
    p.out.gain.setValueAtTime(p.out.gain.value, t);
    p.out.gain.linearRampToValueAtTime(0, t + Math.max(0.02, fade));
    const out = p.out;
    setTimeout(() => { try { out.disconnect(); } catch { /* */ } }, (fade + 2.5) * 1000);
    this.p = null;
  }

  /** 0 = barely there, 1 = everything. */
  setIntensity(v: number, time = 1.2): void {
    this.intensity = clamp(v, 0, 1);
    this.applyIntensity(time);
  }

  private applyIntensity(time: number, at = this.ctx.currentTime): void {
    const p = this.p;
    if (!p) return;
    const i = this.intensity;
    const ramp = (a: number, b: number) => clamp((i - a) / (b - a), 0, 1);
    const target: Record<Layer, number> = {
      comp: 0.65 + 0.35 * ramp(0, 0.3),
      bass: ramp(0.05, 0.2),
      drums: ramp(0.22, 0.4),
      lead: ramp(0.42, 0.56),
      counter: ramp(0.72, 0.88),
      perc: ramp(0.84, 0.98),
    };
    for (const l of LAYERS) {
      const g = p.layers[l].gain;
      g.cancelScheduledValues(at);
      g.setTargetAtTime(target[l] * LAYER_LEVEL[l], at, Math.max(0.01, time / 3));
    }
  }

  /** Final lap: faster and one semitone up, from the next bar on. */
  setFinal(on: boolean): void {
    this.pendingTempo = on ? 1.1 : 1;
    this.pendingTranspose = on ? 1 : 0;
  }

  /** Schedules everything that starts before `until` (AudioContext time). */
  scheduleUntil(until: number): void {
    const p = this.p;
    if (!p || p.stopped) return;
    if (p.next < this.ctx.currentTime - 0.2) p.next = this.ctx.currentTime + 0.02; // fell behind (tab hidden)
    let guard = 0;
    while (p.next < until && !p.stopped && guard++ < 20000) {
      this.scheduleStep(p);
      this.advance(p);
    }
  }

  private stepDur(p: Playing): number { return 60 / (p.song.def.bpm * this.tempoMul) / 4; }

  private advance(p: Playing): void {
    p.next += this.stepDur(p);
    p.step++;
    if (p.step < 16) return;
    p.step = 0;
    p.bar++;
    this.tempoMul = this.pendingTempo;
    this.transpose = this.pendingTranspose;
    if (p.bar >= p.song.sections[p.sec].bars.length) {
      p.bar = 0;
      p.sec++;
      if (p.sec >= p.song.sections.length) {
        if (p.song.def.loopTo < 0) {
          p.stopped = true;
          const end = p.next + 2.5;
          const cb = p.onEnd;
          const ctx = this.ctx;
          if (!('startRendering' in ctx)) {
            if (cb) setTimeout(cb, Math.max(0, (p.next - ctx.currentTime) * 1000));
            const out = p.out;
            setTimeout(() => { try { out.disconnect(); } catch { /* */ } }, Math.max(0, (end - ctx.currentTime) * 1000));
          }
          if (this.p === p) this.p = null;
          return;
        }
        p.sec = p.song.def.loopTo;
      }
    }
  }

  private scheduleStep(p: Playing): void {
    const ctx = this.ctx;
    const def = p.song.def;
    const sec = p.song.sections[p.sec];
    const sd = sec.def;
    const bar = sec.bars[p.bar];
    const step = p.step;
    const dur = this.stepDur(p);
    const t = p.next + (step % 2 === 1 ? def.swing * dur : 0);
    const key = def.key + this.transpose;
    const chord = bar.chords.length > 1 && step >= 8 ? bar.chords[1] : bar.chords[0];
    const lastBar = p.bar === sec.bars.length - 1;
    const hum = () => 0.92 + this.rnd() * 0.12;

    // chord change: new voicing
    if (step === 0 || (step === 8 && bar.chords.length > 1)) p.voicing = this.voice(chord, key, p.voicing);

    // drums
    const lines = sd.fill && lastBar ? FILL : DRUMS[sd.drums];
    for (const k in lines) {
      const c = lines[k as DrumName]![step];
      if (c === 'x' || c === 'X') {
        let v = c === 'X' ? 1 : 0.85;
        if (k === 'hat' || k === 'shaker') v *= step % 4 === 0 ? 1 : 0.7;
        if (sd.fill && lastBar && k === 'snare') v *= 0.55 + (step / 16) * 0.5;
        drum(ctx, p.layers.drums, k as DrumName, t, v * hum());
      }
    }
    if (sd.crash && p.bar === 0 && step === 0) drum(ctx, p.layers.drums, 'crash', t, 0.9);
    const perc = PERC[sd.perc ?? 'none'];
    for (const k in perc) if (perc[k as DrumName]![step] === 'x') drum(ctx, p.layers.perc, k as DrumName, t, 0.8 * hum());

    // bass (8th grid)
    const bp = BASS[sd.bass];
    if (bp && step % 2 === 0) {
      const toks = bp.split(' ');
      const tok = toks[step / 2];
      if (tok && tok !== '.' && tok !== '-') {
        let holds = 0;
        for (let j = step / 2 + 1; j < 8 && toks[j] === '-'; j++) holds++;
        const root = this.bassRoot(chord.root, key);
        let n = root;
        if (tok === 'F') n = root + 7;
        else if (tok === 'O') n = root + 12;
        else if (tok === 'T') n = root + chord.tones[1];
        else if (tok === 'A') {
          const nextBar = sec.bars[p.bar + 1] ?? p.song.sections[(p.sec + 1) % p.song.sections.length]?.bars[0] ?? bar;
          const nr = this.bassRoot(nextBar.chords[0].root, key);
          n = nr + (nr > root ? -1 : 1);
        }
        INSTRUMENTS.bass(ctx, p.layers.bass, t, n, (1 + holds) * 2 * dur * 0.9, hum());
      }
    }

    // comp
    const cp = COMP[sd.comp];
    const compInst = INSTRUMENTS[sd.compInst ?? def.compInst];
    const c = cp[step];
    if (c === 'x') {
      let holds = 0;
      for (let j = step + 1; j < 16 && cp[j] === '-'; j++) holds++;
      const d = (1 + holds) * dur * (holds ? 0.95 : 1.4);
      const strum = sd.comp === 'strum8' || sd.comp === 'offbeat' || sd.comp === 'stab' ? 0.012 : 0.004;
      p.voicing.forEach((n, i) => compInst(ctx, p.layers.comp, t + i * strum, n, d, (step % 4 === 0 ? 0.85 : 0.7) * hum()));
    } else if (c === 'a') {
      const tones = [...p.voicing, ...p.voicing.map((n) => n + 12)];
      const n = tones[p.arpI % tones.length];
      p.arpI = (p.arpI + (sd.comp === 'arp16' ? 1 : 1)) % tones.length;
      compInst(ctx, p.layers.comp, t, n, dur * 2.2, (step % 4 === 0 ? 0.8 : 0.6) * hum());
    }
    if (step === 0) p.arpI = 0;

    // lead (+ harmony)
    const ev = bar.lead[step];
    if (ev) {
      const inst = INSTRUMENTS[sd.leadInst ?? def.leadInst];
      const n = key + ev.semis;
      const d = ev.steps * dur * 0.95;
      inst(ctx, p.layers.lead, t, n, d, (step % 4 === 0 ? 1 : 0.86) * hum());
      if (sd.harmony) {
        const below = this.diatonicBelow(ev, key);
        INSTRUMENTS[def.counterInst](ctx, p.layers.counter, t, below, d, 0.7 * hum());
      }
    }

    // counter (bell arpeggio)
    if (sd.counter && COUNTER[step] === 'x') {
      const top = p.voicing.map((n) => n + 12);
      const n = top[(step >> 2) % top.length];
      INSTRUMENTS[def.counterInst](ctx, p.layers.counter, t, n, dur * 4, 0.75 * hum());
    }
  }

  private bassRoot(root: number, key: number): number {
    let n = key - 24 + root;
    if (root > 6) n -= 12;
    return n;
  }

  /** Close voicing near the middle register with minimal movement from the previous chord. */
  private voice(ch: Chord, key: number, prev: number[]): number[] {
    const tones = ch.tones.slice(0, 4).map((x) => (ch.root + x) % 12);
    const centre = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : key + 2;
    let best: number[] = [], bestD = Infinity;
    for (let base = key - 9; base <= key + 4; base++) {
      if (!tones.includes(((base - key) % 12 + 12) % 12)) continue;
      const v = [base];
      const order = tones.slice();
      const start = order.indexOf(((base - key) % 12 + 12) % 12);
      for (let i = 1; i < order.length; i++) {
        const pc = order[(start + i) % order.length];
        let n = v[v.length - 1] + 1;
        while (((n - key) % 12 + 12) % 12 !== pc) n++;
        v.push(n);
      }
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const d = Math.abs(mean - centre) + Math.abs(mean - (key + 2)) * 0.5;
      if (d < bestD) { bestD = d; best = v; }
    }
    return best.map((n) => n);
  }

  private diatonicBelow(ev: NoteEv, key: number): number {
    // Third below in the major scale.
    const d = ev.deg;
    const target = d - 2;
    const oct = Math.floor(target / 7);
    const idx = ((target % 7) + 7) % 7;
    return key + SCALE[idx] + oct * 12;
  }
}

/** Static check: lead notes on strong beats that sit a semitone off every chord tone. */
export function findClashes(def: SongDef): string[] {
  const song = parseSong(def);
  const out: string[] = [];
  song.sections.forEach((sec, si) => {
    sec.bars.forEach((bar, bi) => {
      for (const step of [0, 4, 8, 12]) {
        const ev = bar.lead[step];
        if (!ev) continue;
        const ch = bar.chords.length > 1 && step >= 8 ? bar.chords[1] : bar.chords[0];
        const pcs = ch.tones.map((x) => (ch.root + x) % 12);
        const pc = ((ev.semis % 12) + 12) % 12;
        if (pcs.includes(pc)) continue;
        if (pcs.some((q) => { const d = (q - pc + 12) % 12; return d === 1 || d === 11; })) {
          out.push(`${def.id}/${def.order[si]} Takt ${bi + 1} Schritt ${step}: Ton ${pc} gegen Akkord [${pcs.join(',')}]`);
        }
      }
    });
  });
  return out;
}
