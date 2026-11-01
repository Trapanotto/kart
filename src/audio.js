// Sound: alles live mit WebAudio erzeugt (keine Audiodateien nötig)
// ------------------------------------------------------------------ Musik
// Eigene Kompositionen: schnelle, fröhliche Kart-Musik.
// chords: 16 Takte (A-Teil + B-Teil), a/b: Melodie je Takt 8 Achtel. Noten wie C5, F#4, Bb5; "-" halten, "." Pause.
const SONGS = [
  { name: 'Wiese', bpm: 160, tr: 0, swing: 0.08, lead: 'brass',
    chords: 'C Am F G C Am Dm7 G7 F G Em Am F G C C',
    a: 'E5 - G5 - C6 - B5 A5 | G5 - E5 - . C5 E5 G5 | A5 - - G5 F5 - A5 - | G5 - - - . D5 E5 F5 | E5 - G5 - C6 - D6 E6 | D6 C6 - A5 - . G5 A5 | F5 - E5 D5 C5 - D5 - | B4 - - - . G4 A4 B4',
    b: 'C5 - A4 C5 F5 - A5 - | G5 F5 E5 D5 B4 - G4 - | E5 - G5 - B5 - G5 - | A5 - - - E5 - C5 - | A5 - C6 - A5 G5 F5 - | G5 - B5 - D6 - B5 - | C6 - G5 - E5 - G5 - | C6 - - - . . . .' },
  { name: 'Bambus', bpm: 150, tr: 2, swing: 0.12, lead: 'marimba',
    chords: 'C F C G Am F G C F G Em Am F G Am G',
    a: 'C5 D5 E5 G5 - E5 D5 C5 | A4 - C5 - D5 - C5 - | E5 G5 A5 G5 - E5 G5 - | D5 - - - . E5 D5 C5 | A4 C5 E5 - A5 - G5 E5 | D5 C5 A4 C5 - D5 E5 - | G5 - E5 D5 - E5 G5 A5 | C6 - - - . . . .',
    b: 'A5 - G5 - C5 - A4 - | D5 - G5 - D5 E5 G5 - | E5 - G5 - B5 - G5 E5 | A5 - - - E5 - C5 - | C6 - A5 - G5 - A5 C6 | D6 - B5 G5 - D5 G5 - | E5 - C5 - A4 - C5 E5 | D5 - - - . D5 E5 G5' },
  { name: 'Hoehle', bpm: 146, tr: 0, swing: 0.15, lead: 'synth',
    chords: 'Am Am F E Am Dm E Am Dm Am E Am F G E E',
    a: 'A4 - C5 E5 - A5 G5 E5 | D5 - C5 - B4 - C5 - | A4 - C5 - F5 - E5 D5 | E5 - - - G#4 - B4 - | C5 - E5 - A5 - C6 - | D6 - C6 A5 - F5 - D5 | E5 - G#5 - B5 - G#5 - | A5 - - - . E5 D5 C5',
    b: 'D5 - F5 - A5 - F5 D5 | C5 - E5 - A5 - E5 C5 | B4 - D5 - E5 - G#5 - | A5 - - - C5 - E5 - | F5 - A5 - C6 - A5 F5 | G5 - B5 - D6 - B5 G5 | G#5 - B5 - E6 - D6 B5 | G#5 - - - . . . .' },
  { name: 'Honig', bpm: 166, tr: 5, swing: 0.1, lead: 'brass',
    chords: 'C C7 F Fm C A7 Dm7 G7 F G Em7 A7 Dm7 G7 C G7',
    a: 'C5 . E5 . G5 . A5 G5 | Bb5 - A5 G5 E5 - C5 - | A5 . A5 . C6 . A5 F5 | Ab5 - G5 F5 C5 - . . | E5 . G5 . C6 . E6 D6 | C#6 - A5 - E5 - G5 - | F5 . E5 . D5 . C5 D5 | B4 - - - . G4 B4 D5',
    b: 'F5 . A5 . C6 - A5 - | G5 . B5 . D6 - B5 - | E5 . G5 . B5 - D6 - | C#6 - A5 - E5 - G5 - | F5 - A5 - D6 - C6 A5 | G5 - F5 - D5 - B4 - | C5 . E5 . G5 . C6 . | D6 - - - . . . .' },
  { name: 'Gletscher', bpm: 156, tr: 4, swing: 0.05, lead: 'bell',
    chords: 'C D Em Am F G C G Am Em F C Dm G C C',
    a: 'G5 - E5 - G5 - C6 - | A5 - F#5 - D5 - F#5 A5 | B5 - G5 - E5 - G5 B5 | C6 - - - A5 - E5 - | F5 - A5 - C6 - A5 - | B5 - D6 - B5 - G5 - | E6 - D6 C6 - G5 - E5 | D5 - - - . . . .',
    b: 'E5 - A5 - C6 - B5 A5 | G5 - E5 - B4 - E5 - | F5 - A5 - C6 - D6 C6 | G5 - - - E5 - G5 - | F5 - D5 - A5 - F5 - | G5 - B5 - D6 - F6 - | E6 - - - C6 - G5 - | C6 - - - . . . .' },
  { name: 'Riff', bpm: 142, tr: -2, swing: 0.18, lead: 'marimba',
    chords: 'C F G C Am F G G F C G Am F C G C',
    a: 'E5 - - C5 - E5 G5 - | A5 - - F5 - A5 C6 - | B5 - A5 G5 - D5 - - | E5 - - - . . G5 G5 | A5 - C6 - B5 A5 - E5 | F5 - - A5 - C6 - A5 | G5 - - B5 - D6 - B5 | G5 - - - . D5 E5 F5',
    b: 'A5 - - C6 - A5 - F5 | G5 - - E5 - C5 - E5 | D5 - - G5 - B5 - D6 | C6 - B5 A5 - E5 - - | F5 - A5 - C6 - A5 - | G5 - E5 - C5 - E5 G5 | B5 - D6 - B5 - G5 - | C6 - - - . . . .' },
  { name: 'Wolken', bpm: 150, tr: 7, swing: 0.0, lead: 'brass',
    chords: 'C G Am Em F C Dm G F G C Am F G C C',
    a: 'C5 . C5 . E5 . G5 . | B4 - D5 - G5 - D5 - | C5 . C5 . E5 . A5 . | G5 - E5 - B4 - E5 - | A5 . A5 . F5 . C6 . | G5 - E5 - C5 - E5 - | F5 - A5 - D6 - C6 A5 | B5 - - - D5 - G5 -',
    b: 'A5 - C6 - F6 - C6 - | B5 - D6 - G6 - D6 - | C6 - G5 - E5 - G5 - | A5 - E5 - C5 - E5 - | F5 . A5 . C6 . F6 . | D6 . B5 . G5 . B5 . | C6 - - - G5 - E5 - | C6 - - - . . . .' },
  { name: 'Vulkan', bpm: 172, tr: 0, swing: 0.0, lead: 'synth',
    chords: 'Am G F E Am G F E F G Am Am F G E E',
    a: 'A4 A4 . A4 C5 . E5 . | D5 - B4 - G4 - B4 D5 | C5 C5 . C5 F5 . A5 . | G#5 - E5 - B4 - E5 - | A5 . G5 . E5 . C5 E5 | D5 . B4 . G4 . B4 D5 | F5 . E5 . C5 . A4 C5 | B4 - - - E5 - - -',
    b: 'C6 - A5 - F5 - A5 C6 | D6 - B5 - G5 - B5 D6 | E6 - - C6 - A5 - - | A5 . B5 . C6 . E6 . | F6 - E6 D6 C6 - A5 - | D6 - C6 B5 G5 - D5 - | E5 - G#5 - B5 - E6 - | D6 - B5 - G#5 - E5 -' },
  { name: 'Menue', bpm: 140, tr: 0, swing: 0.16, lead: 'bell',
    chords: 'C Am Dm G C Am Dm G7 F Fm C A7 Dm7 G7 C C',
    a: 'G5 - E5 - C5 - E5 G5 | A5 - - - E5 - C5 - | D5 - F5 - A5 - F5 D5 | G5 - - - . G5 A5 B5 | C6 - B5 - A5 - G5 - | A5 - G5 - E5 - C5 - | D5 - F5 - A5 - C6 - | B5 - - - . . . .',
    b: 'A5 - C6 - F6 - C6 - | Ab5 - C6 - F6 - C6 - | G5 - E5 - C5 - E5 - | C#6 - A5 - E5 - G5 - | F5 - A5 - D6 - C6 - | B5 - G5 - F5 - D5 - | C6 - - - G5 - E5 - | C6 - - - . . . .' },
];

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteMidi(n) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) return null;
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
function chordNotes(s) {
  const m = /^([A-G])(#|b)?(m)?(maj7|7)?$/.exec(s);
  const root = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const iv = [0, m[3] ? 3 : 4, 7];
  if (m[4] === '7') iv.push(10);
  if (m[4] === 'maj7') iv.push(11);
  return { root, iv };
}
// Melodie-Text -> Noten je Achtel
function parseLine(s) {
  const tok = s.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  tok.forEach((t, i) => {
    if (t === '-') { if (out.length && out.at(-1).open) out.at(-1).len++; return; }
    if (out.length) out.at(-1).open = false;
    if (t === '.') return;
    out.push({ step: i, midi: noteMidi(t), len: 1, open: true });
  });
  return out;
}
// Stimmlage pro Tier: Tonhöhe, Formant-Verschiebung, Vibrato, Tempo
const VOICES = {
  sloth: { pitch: 210, formant: 0.85, vib: 0.02, vibRate: 5, len: 1.6 },
  sheep: { pitch: 430, formant: 1.05, vib: 0.09, vibRate: 17, len: 1.1 },
  redpanda: { pitch: 560, formant: 1.15, vib: 0.02, vibRate: 6, len: 0.85 },
  hedgehog: { pitch: 680, formant: 1.25, vib: 0.03, vibRate: 8, len: 0.8 },
  penguin: { pitch: 500, formant: 1.1, vib: 0.04, vibRate: 9, len: 0.9 },
  capybara: { pitch: 170, formant: 0.8, vib: 0.01, vibRate: 4, len: 1.4 },
  otter: { pitch: 470, formant: 1.05, vib: 0.03, vibRate: 7, len: 0.95 },
  axolotl: { pitch: 620, formant: 1.2, vib: 0.05, vibRate: 11, len: 0.9 },
};

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
  out(bus, pan) {
    bus = bus || this.sfxBus;
    if (!pan || bus !== this.sfxBus) return bus;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(bus);
    return p;
  }

  tone(freq, dur, { type = 'square', vol = 0.2, slide = 0, delay = 0, attack = 0.005, bus, pan } = {}) {
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
    o.connect(g).connect(this.out(bus, pan ?? this.curPan));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(dur, { vol = 0.2, freq = 1200, q = 1, type = 'bandpass', slide = 1, delay = 0, bus, pan } = {}) {
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
    s.connect(f).connect(g).connect(this.out(bus, pan ?? this.curPan));
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  // Lautstärke nach Entfernung + Links/Rechts aus Sicht von Spieler 1
  near(k) {
    this.curPan = 0;
    if (!k || k.human !== null) return 1;
    if (!this.race) return 0;
    let best = Infinity;
    for (const h of this.race.humans) best = Math.min(best, h.pos.distanceTo(k.pos));
    const cam = this.race.cams[0];
    if (cam && this.race.humans.length === 1) {
      const c = cam.cam;
      const dx = k.pos.x - c.position.x, dz = k.pos.z - c.position.z;
      const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
      const d = Math.hypot(dx, dz) || 1;
      this.curPan = ((-fz * dx + fx * dz) / d) * 0.8; // rechts = positiv
    }
    return best < 45 ? 1 - best / 45 : 0;
  }

  // ---------------------------------------------------------- Tierstimmen (Formant-Synthese)
  voice(k, kind) {
    if (!this.ctx || !k) return;
    const v = this.near(k);
    if (!v) return;
    if ((k._voiceT || 0) > this.ctx.currentTime) return;
    k._voiceT = this.ctx.currentTime + 0.7;
    const V = VOICES[k.char.id] || VOICES.otter;
    const shapes = {
      hit:   [[1.25, 'o', 0], [0.8, 'u', 0.28]],
      yay:   [[1.0, 'u', 0], [1.45, 'i', 0.14], [1.3, 'a', 0.3]],
      hehe:  [[1.4, 'e', 0], [1.4, 'e', 0.12], [1.5, 'e', 0.24]],
      wii:   [[1.0, 'i', 0], [1.7, 'i', 0.3]],
      oh:    [[1.1, 'o', 0], [0.9, 'o', 0.35]],
    }[kind];
    if (!shapes) return;
    const F = { a: [800, 1250], e: [500, 1900], i: [320, 2400], o: [480, 850], u: [350, 700] };
    const t0 = this.ctx.currentTime + 0.01;
    const end = t0 + shapes.at(-1)[2] + 0.22 * V.len;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const vib = this.ctx.createOscillator();
    const vibG = this.ctx.createGain();
    vib.frequency.value = V.vibRate;
    vibG.gain.value = V.pitch * V.vib;
    vib.connect(vibG).connect(o.frequency);
    const f1 = this.ctx.createBiquadFilter(), f2 = this.ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.Q.value = 6; f2.Q.value = 9;
    const g = this.ctx.createGain();
    const mix = this.ctx.createGain();
    mix.gain.value = 1;
    o.connect(f1).connect(mix);
    o.connect(f2).connect(mix);
    mix.connect(g).connect(this.out(this.sfxBus, this.curPan));
    g.gain.setValueAtTime(0.0001, t0);
    for (const [p, vow, at] of shapes) {
      const t = t0 + at * V.len;
      o.frequency.linearRampToValueAtTime(V.pitch * p, t + 0.04);
      f1.frequency.linearRampToValueAtTime(F[vow][0] * V.formant, t + 0.04);
      f2.frequency.linearRampToValueAtTime(F[vow][1] * V.formant, t + 0.04);
      g.gain.linearRampToValueAtTime(0.5 * v, t + 0.03);
      if (kind === 'hehe') g.gain.linearRampToValueAtTime(0.05, t + 0.1);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.frequency.setValueAtTime(V.pitch, t0);
    o.start(t0); vib.start(t0);
    o.stop(end + 0.05); vib.stop(end + 0.05);
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
    this.voice(k, 'hit');
  }
  boing(k) { const v = this.near(k); if (v) { this.tone(220, 0.35, { type: 'sine', vol: 0.3 * v, slide: 2.6 }); this.tone(330, 0.25, { type: 'triangle', vol: 0.12 * v, slide: 2.2, delay: 0.03 }); } }
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
  // Motor-Klang: aufgenommene „Zündungen“ (synthetisch), Tempo = Drehzahl
  engineBuffer() {
    if (this.engBuf) return this.engBuf;
    const sr = this.ctx.sampleRate, cyc = 1 / 30, cycles = 8;
    const per = Math.floor(sr * cyc);
    const buf = this.ctx.createBuffer(1, per * cycles, sr);
    const d = buf.getChannelData(0);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let c = 0; c < cycles; c++) {
      const amp = 0.7 + 0.3 * rnd();
      const f0 = 88 + rnd() * 14;
      for (let n = 0; n < per; n++) {
        const t = n / sr;
        const env = Math.exp(-t * 48);
        const body = Math.sin(2 * Math.PI * f0 * t) * env + 0.45 * Math.sin(2 * Math.PI * f0 * 2.02 * t) * env * env;
        const click = (rnd() * 2 - 1) * Math.exp(-t * 350) * 0.6;
        const rumble = (rnd() * 2 - 1) * 0.06 * env;
        d[c * per + n] = amp * (body * 0.85 + click + rumble);
      }
    }
    let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    for (let i = 0; i < d.length; i++) d[i] /= m;
    return (this.engBuf = buf);
  }

  setEngines(n) {
    if (!this.ctx) return;
    this.stopEngines();
    const loopNoise = (type, freq, q) => {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.sfxBus);
      s.start();
      return { s, f, g };
    };
    for (let i = 0; i < n; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.engineBuffer();
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      f.Q.value = 1.5;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      // leiser Oberton für etwas „Surren“
      const hum = this.ctx.createOscillator();
      hum.type = 'triangle';
      const humG = this.ctx.createGain();
      humG.gain.value = 0;
      hum.connect(humG).connect(f);
      src.connect(f).connect(g).connect(this.sfxBus);
      src.start(0, Math.random() * 0.2);
      hum.start();
      const screech = loopNoise('bandpass', 2600, 4);
      const rumble = loopNoise('lowpass', 260, 1);
      this.engines.push({ src, f, g, hum, humG, screech, rumble, gear: 0, rpm: 1 });
    }
  }

  updateEngine(i, speed, boosting, drifting = false, offroad = false) {
    const e = this.engines[i];
    if (!e) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0, speed);
    // Gänge: Drehzahl steigt im Gang und fällt beim Hochschalten
    const G = [0, 9, 17, 25, 33, 99];
    let gear = 0;
    while (gear < G.length - 2 && s > G[gear + 1]) gear++;
    const frac = Math.min(1, (s - G[gear]) / (G[gear + 1] - G[gear]));
    let rpm = (gear === 0 ? 1.0 : 1.55) + frac * 2.0 + (boosting ? 0.5 : 0);
    if (speed < -0.5) rpm = 1.4 + Math.min(1, -speed / 10);
    const share = 1 / Math.max(1, this.engines.length * 0.7);
    if (gear !== e.gear && gear > e.gear) {
      e.g.gain.setValueAtTime(e.g.gain.value * 0.5, t); // kurzes Schalten
    }
    e.gear = gear;
    e.src.playbackRate.setTargetAtTime(rpm, t, 0.06);
    e.hum.frequency.setTargetAtTime(30 * rpm * 4, t, 0.06);
    e.humG.gain.setTargetAtTime(0.05 + frac * 0.05, t, 0.1);
    e.f.frequency.setTargetAtTime(500 + rpm * 520 + (boosting ? 900 : 0), t, 0.06);
    e.g.gain.setTargetAtTime((0.07 + Math.min(1, s / 35) * 0.06) * share, t, 0.07);
    e.screech.f.frequency.setTargetAtTime(2200 + s * 25, t, 0.1);
    e.screech.g.gain.setTargetAtTime(drifting && s > 8 ? 0.05 * share : 0, t, 0.06);
    e.rumble.g.gain.setTargetAtTime(offroad && s > 4 ? Math.min(0.25, s / 120) * share : 0, t, 0.08);
  }

  stopEngines() {
    for (const e of this.engines) {
      e.g.gain.value = 0;
      e.src.stop();
      e.hum.stop();
      e.screech.s.stop();
      e.rumble.s.stop();
    }
    this.engines = [];
  }
  // ---------------------------------------------------------- Musik
  // Instrumente für die Melodie
  inst(kind, f, dur, t, vol) {
    const ctx = this.ctx, at = ctx.currentTime + t, bus = this.musicBus;
    const opt = { bus, delay: t };
    if (kind === 'brass') {
      const g = ctx.createGain(), fl = ctx.createBiquadFilter();
      fl.type = 'lowpass'; fl.Q.value = 2;
      fl.frequency.setValueAtTime(500, at);
      fl.frequency.linearRampToValueAtTime(3400, at + 0.035);
      fl.frequency.exponentialRampToValueAtTime(1400, at + 0.25);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.02);
      g.gain.setValueAtTime(vol * 0.8, at + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.08);
      for (const det of [-7, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        o.connect(fl); o.start(at); o.stop(at + dur + 0.12);
      }
      fl.connect(g).connect(bus);
    } else if (kind === 'marimba') {
      this.tone(f, 0.4, { ...opt, type: 'sine', vol: vol * 1.3 });
      this.tone(f * 4, 0.07, { ...opt, type: 'sine', vol: vol * 0.5 });
    } else if (kind === 'bell') {
      this.tone(f, dur + 0.35, { ...opt, type: 'triangle', vol: vol * 1.2 });
      this.tone(f * 2, 0.3, { ...opt, type: 'sine', vol: vol * 0.6 });
    } else {
      this.tone(f, dur, { ...opt, type: 'square', vol: vol * 0.55 });
      this.tone(f * 1.006, dur, { ...opt, type: 'sawtooth', vol: vol * 0.4 });
    }
  }

  drum(kind, t) {
    const bus = this.musicBus;
    if (kind === 'kick') {
      const at = this.ctx.currentTime + t;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.setValueAtTime(155, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      g.gain.setValueAtTime(0.9, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      o.connect(g).connect(bus);
      o.start(at); o.stop(at + 0.22);
    } else if (kind === 'snare') {
      this.noise(0.15, { bus, delay: t, vol: 0.38, freq: 1900, q: 0.8 });
      this.tone(190, 0.08, { bus, delay: t, type: 'triangle', vol: 0.22 });
    } else if (kind === 'hat') this.noise(0.03, { bus, delay: t, vol: 0.08, freq: 9000, type: 'highpass' });
    else if (kind === 'open') this.noise(0.2, { bus, delay: t, vol: 0.07, freq: 7000, type: 'highpass' });
    else if (kind === 'crash') this.noise(1.1, { bus, delay: t, vol: 0.13, freq: 5500, type: 'highpass' });
  }

  playSong(i) {
    this.pendingSong = i;
    if (!this.ctx) return;
    this.stopSong();
    const song = SONGS[i % SONGS.length];
    const tr = song.tr;
    const chords = song.chords.split(/\s+/).map(chordNotes);
    const map = (line) => new Map(parseLine(line).map((x) => [x.step, x]));
    const A = map(song.a), B = map(song.b);
    this.tempo = 1;
    let next = this.ctx.currentTime + 0.12;
    let n = 0;
    const tick = () => {
      const step = 60 / (song.bpm * this.tempo) / 2; // Achtel
      while (next < this.ctx.currentTime + 0.3) {
        const pos = n % 128, st = pos % 8, bar = Math.floor(pos / 8);
        const pass = Math.floor(n / 128);
        const ch = chords[bar];
        const sw = st % 2 ? song.swing * step : 0;
        const t = next - this.ctx.currentTime + sw;
        const opt = { bus: this.musicBus, delay: t };
        const rootLow = 36 + ((ch.root + tr + 12) % 12);
        // Bass: hüpfend Grundton / Oktave, am Taktende Quinte
        const bn = st === 6 ? rootLow + 7 : st % 2 ? rootLow + 12 : rootLow;
        this.tone(midi(bn), step * 0.85, { ...opt, type: 'triangle', vol: 0.34 });
        this.tone(midi(bn), step * 0.5, { ...opt, type: 'square', vol: 0.045 });
        // Nachschlag-Akkorde
        if (st % 2) for (const iv of ch.iv) this.tone(midi(60 + ((ch.root + tr + iv) % 12)), step * 0.45, { ...opt, type: 'square', vol: 0.022 });
        if (st === 0) for (const iv of ch.iv) this.tone(midi(48 + ((ch.root + tr + iv) % 12) + 12), step * 7, { ...opt, type: 'sine', vol: 0.03, attack: 0.05 });
        // Schlagzeug
        const fill = bar % 8 === 7 && st >= 4;
        if (st === 0 && bar % 8 === 0) this.drum('crash', t);
        if (st === 0 || st === 4 || (st === 3 && bar % 2)) this.drum('kick', t);
        if (st === 2 || st === 6 || fill) this.drum('snare', t);
        this.drum(st === 7 && bar % 2 ? 'open' : 'hat', t);
        // Melodie (+ zweiter Durchgang mit Oktav-Doppelung und Arpeggio)
        const m = (bar < 8 ? A : B).get((bar % 8) * 8 + st);
        if (m && m.midi) {
          this.inst(song.lead, midi(m.midi + tr), step * m.len * 0.92, t, 0.075);
          if (pass % 2) this.tone(midi(m.midi + tr - 12), step * m.len * 0.9, { ...opt, type: 'triangle', vol: 0.045 });
        }
        if (pass % 2 && bar >= 8) this.tone(midi(72 + ((ch.root + tr + ch.iv[st % ch.iv.length]) % 12)), step * 0.6, { ...opt, type: 'sine', vol: 0.025 });
        next += step;
        n++;
      }
    };
    this.songTimer = setInterval(tick, 40);
    tick();
  }
  // schneller in der letzten Runde
  setTempo(t) { this.tempo = t; }
  stopSong() {
    if (this.songTimer) clearInterval(this.songTimer);
    this.songTimer = null;
  }
}
