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
    // Melodie mit festem Zufall pro Lied
    let s = i * 7919 + 13;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const melody = [];
    for (let bar = 0; bar < 4; bar++) {
      const row = [];
      for (let st = 0; st < 8; st++) row.push(r() < 0.72 ? Math.floor(r() * song.scale.length) : -1);
      melody.push(row);
    }
    const step = 60 / song.bpm / 2; // Achtel
    let next = this.ctx.currentTime + 0.1;
    let n = 0;
    const note = (deg, oct = 0) => {
      const L = song.scale.length;
      const o = Math.floor(deg / L);
      return song.root + song.scale[((deg % L) + L) % L] + 12 * (o + oct);
    };
    const tick = () => {
      while (next < this.ctx.currentTime + 0.25) {
        const bar = Math.floor(n / 8) % 4, st = n % 8;
        const chord = song.prog[bar];
        const t = next - this.ctx.currentTime;
        const opt = { bus: this.musicBus, delay: t };
        if (st % 2 === 0) this.tone(midi(note(chord, -2)), step * 1.8, { ...opt, type: 'triangle', vol: 0.32 });
        if (st === 0 || st === 4) this.noise(0.12, { ...opt, vol: 0.35, freq: 120, type: 'lowpass' });
        if (st === 2 || st === 6) this.noise(0.08, { ...opt, vol: 0.12, freq: 2500, q: 0.6 });
        this.noise(0.03, { ...opt, vol: 0.04, freq: 8000, type: 'highpass' });
        if (st % 4 === 0) for (const d of [0, 2, 4]) this.tone(midi(note(chord + d, 0)), step * 3.5, { ...opt, type: 'sine', vol: 0.05, attack: 0.03 });
        const m = melody[(Math.floor(n / 8) + (Math.floor(n / 32) % 2) * 2) % 4][st];
        if (m >= 0 && Math.floor(n / 64) % 4 !== 3) this.tone(midi(note(m + chord, 1)), step * 0.9, { ...opt, type: song.lead, vol: song.lead === 'sawtooth' ? 0.05 : 0.08 });
        next += step;
        n++;
      }
    };
    this.songTimer = setInterval(tick, 50);
    tick();
  }
  stopSong() {
    if (this.songTimer) clearInterval(this.songTimer);
    this.songTimer = null;
  }
}
