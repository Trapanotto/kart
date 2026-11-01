// Sound: alles live mit WebAudio erzeugt (keine Audiodateien nötig)
const SONGS = [
  { bpm: 132, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 5, 3, 4], lead: 'square' },   // Wiese
  { bpm: 120, root: 62, scale: [0, 2, 4, 7, 9], prog: [0, 3, 5, 4], lead: 'triangle' },        // Bambus (pentatonisch)
  { bpm: 112, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 6, 4], lead: 'triangle' }, // Höhle
  { bpm: 138, root: 65, scale: [0, 2, 4, 5, 7, 9, 10], prog: [0, 6, 3, 4], lead: 'square' },   // Honig
  { bpm: 126, root: 64, scale: [0, 2, 4, 6, 7, 9, 11], prog: [0, 4, 5, 3], lead: 'sine' },     // Gletscher
  { bpm: 104, root: 58, scale: [0, 2, 4, 7, 9], prog: [0, 5, 3, 4], lead: 'sine' },            // Riff
  { bpm: 128, root: 67, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 3, 4, 0], lead: 'triangle' }, // Wolken
  { bpm: 146, root: 55, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 6, 5, 4], lead: 'sawtooth' }, // Vulkan
  { bpm: 116, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], lead: 'triangle' }, // Menü
];

// Komponierte Melodien: 8 Takte à 8 Achtel. Zahl = Tonleiterstufe (0 = Grundton), "-" = halten, "." = Pause
const MELODIES = [
  // Kleeblatt-Wiese – fröhlich
  '4 - 4 5 4 - 2 - | 5 - 7 - 5 4 2 - | 3 - 3 4 5 - 3 - | 4 - - - . 1 2 3 | 4 - 4 5 4 - 7 - | 9 - 7 - 5 4 5 - | 3 4 5 - 6 - 4 - | 7 - - - . . . .',
  // Bambuswald – pentatonisch, verspielt
  '2 - 3 4 3 - 2 0 | 1 - 2 - 0 - . . | 2 - 3 4 5 - 4 3 | 4 - - - 3 - 2 - | 5 - 4 3 4 - 3 2 | 3 - 2 1 2 - 0 - | 1 2 3 - 2 - 1 - | 0 - - - . . . .',
  // Pilzhöhlen – geheimnisvoll
  '0 - . 2 4 - . 3 | 2 - - - 1 - . . | 0 - . 2 4 - 5 - | 4 - - - . . . . | 7 - . 6 5 - 4 - | 5 - 3 - 4 - 2 - | 1 - 2 - 3 - 1 - | 0 - - - - - . .',
  // Honigfabrik – hüpfend
  '0 2 4 . 4 . 5 4 | 3 . 3 . 2 - . . | 0 2 4 . 4 . 7 6 | 5 - - - 4 - . . | 7 . 7 . 6 5 4 . | 5 . 5 . 4 3 2 . | 3 4 5 . 4 2 1 . | 0 - - - . . . .',
  // Gletscher – verträumt
  '4 - 3 - 4 - 6 - | 7 - - - 6 - 4 - | 3 - 2 - 3 - 4 - | 2 - - - . . . . | 4 - 3 - 4 - 7 - | 9 - - - 8 - 7 - | 6 - 4 - 3 - 2 - | 0 - - - - - . .',
  // Korallenriff – gemütlich
  '0 . 2 . 3 - 2 . | 1 . 0 . 1 - . . | 2 . 3 . 4 - 3 . | 2 - - - . . . . | 4 . 5 . 4 - 3 . | 2 . 3 . 2 - 1 . | 0 . 1 . 2 - 1 . | 0 - - - . . . .',
  // Wolkenschloss – festlich
  '7 - 6 - 7 - 4 - | 5 - - - 4 - . . | 3 - 4 - 5 - 7 - | 6 - - - . . . . | 7 - 9 - 8 - 7 - | 6 - 7 - 5 - 4 - | 3 - 4 - 2 - 1 - | 0 - - - . . . .',
  // Dschungel-Vulkan – treibend
  '0 0 . 0 2 . 3 . | 4 . 3 . 2 . 0 . | 0 0 . 0 2 . 3 . | 5 . 4 . 3 - . . | 7 . 6 . 5 . 4 . | 5 . 4 . 3 . 2 . | 3 . 2 . 1 . -1 . | 0 - - - . . . .',
  // Menü – warm
  '0 - 2 - 4 - 7 - | 5 - - - 4 - . . | 3 - 5 - 4 - 2 - | 1 - - - . . . . | 0 - 2 - 4 - 7 - | 9 - - - 7 - . . | 8 - 7 - 5 - 6 - | 7 - - - . . . .',
];

// Text -> Liste aus {step, deg, len}
function parseMelody(s) {
  const tok = s.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  tok.forEach((t, i) => {
    if (t === '-') { if (out.length && out.at(-1).open) out.at(-1).len++; return; }
    if (out.length) out.at(-1).open = false;
    if (t === '.') return;
    out.push({ step: i, deg: +t, len: 1, open: true });
  });
  return { notes: out, steps: tok.length };
}

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.music = 0.5;
    this.sfx = 0.7;
    this.race = null;
    this.engines = [];
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.music * 0.35;
    this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, len);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.pendingSong !== undefined) this.playSong(this.pendingSong);
  }

  setVolumes(music, sfx) {
    this.music = music;
    this.sfx = sfx;
    if (!this.ctx) return;
    this.musicBus.gain.value = music * 0.35;
    this.sfxBus.gain.value = sfx;
  }

  // ---------------------------------------------------------- Bausteine
  tone(freq, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0, attack = 0.005, bus } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.2, freq = 1200, q = 1, type = 'bandpass', slide = 1, delay = 0, bus } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slide !== 1) f.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus || this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  near(k) {
    if (!k || k.human !== null) return 1;
    if (!this.race) return 0;
    let best = Infinity;
    for (const h of this.race.humans) best = Math.min(best, h.pos.distanceTo(k.pos));
    return best < 40 ? 1 - best / 40 : 0;
  }

  // ---------------------------------------------------------- Effekte
  click() { this.tone(880, 0.06, { type: 'triangle', vol: 0.15 }); }
  select() { this.tone(660, 0.08, { type: 'square', vol: 0.1 }); this.tone(990, 0.12, { type: 'square', vol: 0.1, delay: 0.07 }); }
  back() { this.tone(520, 0.1, { type: 'triangle', vol: 0.12, slide: 0.7 }); }
  countdown() { this.tone(523, 0.25, { type: 'square', vol: 0.18 }); }
  go() { this.tone(1046, 0.6, { type: 'square', vol: 0.2 }); this.tone(784, 0.6, { type: 'triangle', vol: 0.15 }); }
  boost() { this.noise(0.6, { vol: 0.25, freq: 400, slide: 6, q: 2 }); this.tone(220, 0.5, { type: 'sawtooth', vol: 0.06, slide: 3 }); }
  hop(k) { const v = this.near(k); if (v) this.tone(300, 0.1, { type: 'triangle', vol: 0.12 * v, slide: 1.8 }); }
  land(k) { const v = this.near(k); if (v) this.noise(0.15, { vol: 0.2 * v, freq: 300, type: 'lowpass' }); }
  trick(k) { const v = this.near(k); if (v) { this.tone(784, 0.1, { vol: 0.12 * v }); this.tone(1175, 0.15, { vol: 0.12 * v, delay: 0.08 }); } }
  driftLevel(k, l) { const v = this.near(k); if (v && k.human !== null) this.tone([0, 880, 1175, 1568][l], 0.12, { type: 'triangle', vol: 0.12 }); }
  bump(k) { const v = this.near(k); if (v) { this.noise(0.12, { vol: 0.25 * v, freq: 250, type: 'lowpass' }); this.tone(140, 0.15, { type: 'sine', vol: 0.25 * v, slide: 0.6 }); } }
  hit(k) {
    const v = this.near(k); if (!v) return;
    this.noise(0.25, { vol: 0.3 * v, freq: 600, q: 0.7 });
    this.tone(900, 0.4, { type: 'square', vol: 0.1 * v, slide: 0.3 });
    this.tone(1400, 0.25, { type: 'sine', vol: 0.1 * v, slide: 1.6, delay: 0.1 });
  }
  pop(k) { const v = this.near(k); if (v) { this.tone(1200, 0.08, { type: 'sine', vol: 0.25 * v, slide: 0.4 }); this.noise(0.1, { vol: 0.2 * v, freq: 3000 }); } }
  splat(k) { const v = this.near(k); if (v) { this.noise(0.3, { vol: 0.3 * v, freq: 500, slide: 0.4, type: 'lowpass' }); } }
  itemBox() { this.tone(1318, 0.06, { type: 'triangle', vol: 0.12 }); this.tone(1760, 0.08, { type: 'triangle', vol: 0.1, delay: 0.05 }); }
  itemGet() { [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, { type: 'square', vol: 0.07, delay: i * 0.05 })); }
  roll() { this.tone(600 + Math.random() * 600, 0.03, { type: 'square', vol: 0.04 }); }
  throw(k) { const v = this.near(k); if (v) this.noise(0.2, { vol: 0.2 * v, freq: 1500, slide: 0.4 }); }
  drop(k) { const v = this.near(k); if (v) this.tone(300, 0.2, { type: 'sine', vol: 0.2 * v, slide: 0.5 }); }
  shield(k) { const v = this.near(k); if (v) [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, { type: 'sine', vol: 0.1 * v, delay: i * 0.04 })); }
  yawn() { this.tone(440, 1.0, { type: 'sine', vol: 0.15, slide: 0.5, attack: 0.2 }); this.tone(330, 1.1, { type: 'triangle', vol: 0.1, slide: 0.5, attack: 0.25 }); }
  cloud(k) { const v = this.near(k); if (v) this.noise(0.6, { vol: 0.15 * v, freq: 200, type: 'lowpass' }); }
  zap(k) { const v = this.near(k); if (v) { this.noise(0.4, { vol: 0.35 * v, freq: 2500, q: 0.5 }); this.tone(1800, 0.3, { type: 'sawtooth', vol: 0.08 * v, slide: 0.2 }); } }
  lap() { [659, 784, 1046].forEach((f, i) => this.tone(f, 0.15, { type: 'square', vol: 0.1, delay: i * 0.1 })); }
  finalLap() { [784, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.12, delay: i * 0.12 })); }
  finish(good) {
    const n = good ? [523, 659, 784, 1046, 784, 1046] : [523, 494, 466, 440];
    n.forEach((f, i) => this.tone(f, 0.25, { type: 'square', vol: 0.12, delay: i * 0.14 }));
  }

  // ---------------------------------------------------------- Motor
  setEngines(n) {
    if (!this.ctx) return;
    this.stopEngines();
    for (let i = 0; i < n; i++) {
      const o = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o2.type = 'square';
      f.type = 'lowpass';
      f.frequency.value = 600;
      g.gain.value = 0;
      o.connect(f);
      o2.connect(f);
      f.connect(g).connect(this.sfxBus);
      o.start();
      o2.start();
      this.engines.push({ o, o2, f, g });
    }
  }
  updateEngine(i, speed, boosting) {
    const e = this.engines[i];
    if (!e) return;
    const t = this.ctx.currentTime;
    const f = 55 + Math.abs(speed) * 3.2 + (boosting ? 40 : 0);
    e.o.frequency.setTargetAtTime(f, t, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(400 + Math.abs(speed) * 30, t, 0.05);
    e.g.gain.setTargetAtTime((0.025 + Math.min(1, Math.abs(speed) / 35) * 0.03) / Math.max(1, this.engines.length * 0.7), t, 0.08);
  }
  stopEngines() {
    for (const e of this.engines) {
      e.g.gain.value = 0;
      e.o.stop();
      e.o2.stop();
    }
    this.engines = [];
  }

  // ---------------------------------------------------------- Musik
  playSong(i) {
    this.pendingSong = i;
    if (!this.ctx) return;
    this.stopSong();
    const song = SONGS[i % SONGS.length];
    const mel = parseMelody(MELODIES[i % MELODIES.length]);
    const at = new Map(mel.notes.map((m) => [m.step, m]));
    this.tempo = 1;
    let next = this.ctx.currentTime + 0.1;
    let n = 0;
    const note = (deg, oct = 0) => {
      const L = song.scale.length;
      const o = Math.floor(deg / L);
      return song.root + song.scale[((deg % L) + L) % L] + 12 * (o + oct);
    };
    const lead = { type: song.lead, vol: song.lead === 'sawtooth' ? 0.05 : song.lead === 'sine' ? 0.11 : 0.08 };
    const tick = () => {
      const step = 60 / (song.bpm * this.tempo) / 2; // Achtel
      while (next < this.ctx.currentTime + 0.25) {
        const pos = n % mel.steps, st = pos % 8, bar = Math.floor(pos / 8);
        const pass = Math.floor(n / mel.steps);
        const chord = song.prog[bar % 4];
        const opt = { bus: this.musicBus, delay: next - this.ctx.currentTime };
        // Bass: im zweiten Durchgang mit Quinte
        if (st % 2 === 0) this.tone(midi(note(chord + (pass % 2 && st % 4 === 2 ? 4 : 0), -2)), step * 1.8, { ...opt, type: 'triangle', vol: 0.32 });
        // Schlagzeug
        if (st === 0 || st === 4 || (this.tempo > 1 && st === 6)) this.noise(0.12, { ...opt, vol: 0.35, freq: 120, type: 'lowpass' });
        if (st === 2 || st === 6) this.noise(0.08, { ...opt, vol: 0.12, freq: 2500, q: 0.6 });
        this.noise(0.03, { ...opt, vol: this.tempo > 1 ? 0.07 : 0.04, freq: 8000, type: 'highpass' });
        // Flächenklang
        if (st % 4 === 0) for (const d of [0, 2, 4]) this.tone(midi(note(chord + d, 0)), step * 3.5, { ...opt, type: 'sine', vol: 0.05, attack: 0.03 });
        // Melodie (+ Zweitstimme und Arpeggio ab dem zweiten Durchgang)
        const m = at.get(pos);
        if (m) {
          this.tone(midi(note(m.deg, 1)), step * m.len * 0.92, { ...opt, ...lead });
          if (pass % 2) this.tone(midi(note(m.deg - 2, 1)), step * m.len * 0.9, { ...opt, type: 'triangle', vol: 0.035 });
        }
        if (pass % 2) this.tone(midi(note(chord + [0, 2, 4, 7][st % 4], 1)), step * 0.8, { ...opt, type: 'square', vol: 0.018 });
        next += step;
        n++;
      }
    };    this.songTimer = setInterval(tick, 50);
    tick();
  }
  // schneller in der letzten Runde
  setTempo(t) { this.tempo = t; }
  stopSong() {
    if (this.songTimer) clearInterval(this.songTimer);
    this.songTimer = null;
  }
}
