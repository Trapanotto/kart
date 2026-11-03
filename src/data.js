// Spieldaten: Fahrer, Items, Strecken. Reine Daten, ohne three.js (auch in Node nutzbar).

// Werte 1..5
export const CHARACTERS = [
  { id: 'sloth', name: 'Fauli', animal: 'Faultier', art: 'das', color: '#8C6B4F', speed: 3, accel: 2, handling: 5, drift: 3, weight: 2, tough: 3,
    perk: 'Bestes Handling', desc: 'Tiefenentspannt. Lenkt butterweich durch jede Kurve.' },
  { id: 'sheep', name: 'Wolke', animal: 'Schaf', art: 'das', color: '#F4EEE4', speed: 2, accel: 5, handling: 3, drift: 3, weight: 1, tough: 3,
    perk: 'Beste Beschleunigung', desc: 'Flauschig, tollpatschig und blitzschnell vom Start weg.' },
  { id: 'redpanda', name: 'Rubi', animal: 'Rotpanda', art: 'der', color: '#C8552B', speed: 3, accel: 4, handling: 3, drift: 5, weight: 1, tough: 2,
    perk: 'Stärkster Drift-Boost', desc: 'Frech und flink. Liebt lange Drifts.' },
  { id: 'hedgehog', name: 'Stupsi', animal: 'Igel', art: 'der', color: '#C69C72', speed: 3, accel: 3, handling: 3, drift: 3, weight: 1, tough: 5,
    perk: 'Kaum zu erschüttern', desc: 'Schüchtern, aber stachelig. Treffer stecken Stupsi leicht weg.' },
  { id: 'penguin', name: 'Pingo', animal: 'Pinguin', art: 'der', color: '#2C3350', speed: 3, accel: 3, handling: 4, drift: 3, weight: 2, tough: 3,
    perk: 'Voller Grip auf Eis', desc: 'Elegant auf jedem Untergrund, besonders auf Eis.', iceGrip: true },
  { id: 'capybara', name: 'Kapi', animal: 'Capybara', art: 'das', color: '#A0724B', speed: 5, accel: 1, handling: 2, drift: 2, weight: 3, tough: 4,
    perk: 'Höchstgeschwindigkeit', desc: 'Die Ruhe selbst. Einmal in Fahrt, kaum zu stoppen.' },
  { id: 'otter', name: 'Otti', animal: 'Otter', art: 'der', color: '#7A5034', speed: 3, accel: 3, handling: 3, drift: 4, weight: 2, tough: 3,
    perk: 'Ausgeglichen', desc: 'Verspielt und vielseitig. Gut für Einsteiger.' },
  { id: 'axolotl', name: 'Axi', animal: 'Axolotl', art: 'der', color: '#F7A8C6', speed: 3, accel: 4, handling: 3, drift: 3, weight: 1, tough: 2,
    perk: 'Schnell wieder auf den Beinen', desc: 'Immer gut gelaunt. Erholt sich blitzschnell.', recover: true },
];

export const CLASSES = [
  { id: 'easy', name: 'Gemütlich', icon: '🐌', speed: 0.82, ai: 0.9 },
  { id: 'normal', name: 'Flott', icon: '🐇', speed: 1.0, ai: 0.97 },
  { id: 'hard', name: 'Turbo', icon: '🐆', speed: 1.16, ai: 1.02 },
  { id: 'mirror', name: 'Spiegel', icon: '🪞', speed: 1.16, ai: 1.03, mirror: true },
];

export const ITEMS = {
  acorn:      { icon: '🌰', name: 'Eichel-Wurf', hold: true },
  acorn3:     { icon: '🌰', name: '3 kreisende Eicheln', count: 3 },
  honey:      { icon: '🍯', name: 'Honigpfütze', hold: true },
  fakebox:    { icon: '🎁', name: 'Falsche Geschenkbox', hold: true },
  yarn:       { icon: '🧶', name: 'Wollknäuel' },
  bees:       { icon: '🐝', name: 'Bienenschwarm' },
  bubble:     { icon: '🫧', name: 'Seifenblasen-Schild' },
  carrot:     { icon: '🥕', name: 'Karotten-Turbo' },
  carrot3:    { icon: '🥕', name: '3× Karotten-Turbo', count: 3 },
  goldcarrot: { icon: '✨', name: 'Goldene Karotte' },
  lolly:      { icon: '🍭', name: 'Regenbogen-Lolli' },
  cloud:      { icon: '🌧️', name: 'Gewitterwölkchen' },
  yawn:       { icon: '💤', name: 'Gähn-Welle' },
};

// r = 0 (Führung) .. 1 (letzter Platz)
export function itemWeights(r) {
  return {
    acorn: 26 * (1 - r) + 6,
    honey: 20 * (1 - r) + 3,
    fakebox: 10 * (1 - r),
    acorn3: r > 0.15 && r < 0.8 ? 12 : 0,
    yarn: r > 0.1 ? 4 + 18 * r : 0,
    bees: r > 0.5 ? 7 * r : 0,
    bubble: 10,
    carrot: 8 + 18 * r,
    carrot3: r > 0.3 ? 4 + 18 * r : 0,
    goldcarrot: r > 0.45 ? 10 * r : 0,
    lolly: r > 0.6 ? 9 * r : 0,
    cloud: r < 0.35 ? 8 : 0,
    yawn: r > 0.6 ? 7 * r : 0,
  };
}
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

// Strecken -----------------------------------------------------------------
// shape.type 'radial': r(θ) = R0 * (1 + Σ a cos(kθ + φ)), Höhe y(θ) = H0 + Σ h cos(kθ + φ)
// shape.type 'lemniscate': Acht mit Brücke
// Positionen (ramps, pads, items, ...) als Anteil der Runde 0..1
export const THEMES = {
  meadow: { sky: ['#7EC8FF', '#E6F6FF'], fog: '#CFEFFF', fogNear: 160, fogFar: 650, ground: '#7BC96F', ground2: '#69B85F',
    road: '#B9A58F', road2: '#A8937C', offroad: '#9ED36A', curb: ['#FFFFFF', '#FF7A8A'], fence: '#FFD447', fence2: '#FF8FA3',
    sun: 2.6, hemi: 1.1, props: [['Tree', 0.35], ['Flower', 0.9], ['Rock', 0.15], ['Mushroom', 0.1]], hills: '#8ED081', particles: 'petals', music: 0 },
  bamboo: { sky: ['#9AD7E8', '#FFF4D6'], fog: '#E8F3DA', fogNear: 120, fogFar: 520, ground: '#8DC26A', ground2: '#7AB35A',
    road: '#C9B48F', road2: '#B8A07A', offroad: '#A9CF6E', curb: ['#FFFFFF', '#C8552B'], fence: '#C8552B', fence2: '#F2E2B8',
    sun: 2.4, hemi: 1.0, props: [['Bamboo', 1.0], ['Rock', 0.2], ['Flower', 0.3]], hills: '#6FA85A', particles: 'leaves', music: 1 },
  cave: { sky: ['#1B1440', '#3B2A6E'], fog: '#2B2156', fogNear: 60, fogFar: 330, ground: '#3C3366', ground2: '#332B59',
    road: '#6E6488', road2: '#615879', offroad: '#4D4380', curb: ['#B6F3FF', '#7C5CFF'], fence: '#7C5CFF', fence2: '#B6F3FF',
    sun: 0.6, hemi: 0.55, props: [['GlowShroom', 0.8], ['Mushroom', 0.25], ['Rock', 0.3], ['Crystal', 0.15]], hills: '#2A2250', particles: 'fireflies', night: true, bloom: 0.8, music: 2 },
  honey: { sky: ['#FFC86B', '#FFF1C9'], fog: '#FFE3A3', fogNear: 140, fogFar: 560, ground: '#E9B949', ground2: '#DCA93A',
    road: '#C98B4E', road2: '#B87A40', offroad: '#F2C75C', curb: ['#FFFFFF', '#E8901E'], fence: '#FFC233', fence2: '#8A5A2B',
    sun: 2.6, hemi: 1.1, props: [['Honeycomb', 0.6], ['HoneyJar', 0.4], ['Flower', 0.5]], hills: '#D69A35', particles: 'pollen', music: 3 },
  glacier: { sky: ['#8EC9F0', '#F2FBFF'], fog: '#E4F4FF', fogNear: 120, fogFar: 560, ground: '#F4FAFF', ground2: '#E2EEF8',
    road: '#A7B9CC', road2: '#97A9BD', offroad: '#E8F2FA', curb: ['#FFFFFF', '#4FA3E0'], fence: '#4FA3E0', fence2: '#FFFFFF',
    ice: '#BFE9FF', sun: 2.4, hemi: 1.2, props: [['Pine', 0.8], ['Crystal', 0.35], ['Rock', 0.2]], hills: '#DCEAF6', particles: 'snow', bloom: 0.2, music: 4 },
  reef: { sky: ['#0B4F7A', '#3FC1D9'], fog: '#2A93B5', fogNear: 60, fogFar: 380, ground: '#E8D6A8', ground2: '#D9C590',
    road: '#7FB7C9', road2: '#6FA7B9', offroad: '#E3CF9C', curb: ['#FFFFFF', '#FF7A8A'], fence: '#FF7A8A', fence2: '#FFD447',
    sun: 1.8, hemi: 1.0, props: [['Coral', 0.7], ['Seaweed', 0.9], ['Rock', 0.25]], hills: '#1F7E9E', particles: 'bubbles', underwater: true, music: 5 },
  clouds: { sky: ['#B8A6FF', '#FFE2F1'], fog: '#F6E8FF', fogNear: 160, fogFar: 700, ground: '#FFFFFF', ground2: '#F3E9FF',
    road: '#D7C8F2', road2: '#C9B8EA', offroad: '#FFFFFF', curb: ['#FFFFFF', '#B59CFF'], fence: '#FF8FA3', fence2: '#FFFFFF',
    sun: 2.4, hemi: 1.25, props: [['Cloud', 0.5], ['Tower', 0.08]], hills: '#FFFFFF', particles: 'sparkles', cloudGround: true, bloom: 0.25, music: 6 },
  volcano: { sky: ['#5A1E2E', '#FF9A5A'], fog: '#C8604A', fogNear: 110, fogFar: 520, ground: '#4A3A3E', ground2: '#3C2E33',
    road: '#7A6A6E', road2: '#6C5C60', offroad: '#8A4A2A', curb: ['#FFD447', '#FF4E1A'], fence: '#FF6A1A', fence2: '#2B2226',
    sun: 2.0, hemi: 0.85, props: [['Palm', 0.5], ['LavaRock', 0.45], ['Rock', 0.25]], hills: '#3A2B30', particles: 'embers', volcano: true, bloom: 0.65, music: 7 },
};

export const TRACKS = [
  { id: 'meadow', name: 'Kleeblatt-Wiese', cup: 0, theme: 'meadow',
    shape: { type: 'eight', a: 230, b: 255, c: 34, h0: 8, h1: 7, h3: 1, start: 0.25 },
    banking: 0.8,
    forks: [{ a: 0.52, b: 0.65, m: 3, pads: -1 }, { a: 0.84, b: 0.95, m: 3, pads: 1 }],
    loops: [0.43],
    pads: [[0.06, 0]], items: [0.12, 0.36, 0.72],
    hazards: [{ type: 'bumper', f: 0.78, lat: 0 }] },
  { id: 'bamboo', name: 'Bambuswald-Tempel', cup: 0, theme: 'bamboo',
    shape: { type: 'trefoil', s: 62, h0: 12, h1: 10 },
    banking: 0.6,
    halfpipes: [[0.05, 0.16, 6.5]],
    crumble: [[0.45, 22]],
    forks: [{ a: 0.5, b: 0.6, m: 3, pads: -1 }],
    ramps: [0.22], gaps: [0.74], bigjumps: [0.88], pads: [[0.83, 0], [0.84, 0]], items: [0.12, 0.3, 0.64],
    hazards: [{ type: 'log', f: 0.35 }, { type: 'log', f: 0.58 }] },
  { id: 'cave', name: 'Pilzhöhlen', cup: 0, theme: 'cave',
    shape: { type: 'limacon', s: 92, a: 2.3, b: 1.05, h0: 10, h1: 9, rot: 0.4 },
    banking: 0.7,
    loops: [0.33],
    forks: [{ a: 0.44, b: 0.55, m: 3, pads: -1 }, { a: 0.66, b: 0.78, m: 3.5, pads: -1 }],
    gaps: [0.58], pads: [[0.29, 0], [0.88, 0]], items: [0.2, 0.47, 0.92],
    hazards: [{ type: 'bumper', f: 0.12, lat: -0.45 }, { type: 'bumper', f: 0.12, lat: 0.45 }, { type: 'barrelroll', f: 0.45 },
      { type: 'bumper', f: 0.84, lat: -0.5 }, { type: 'bumper', f: 0.84, lat: 0.5 }] },
  { id: 'honey', name: 'Honigfabrik', cup: 0, theme: 'honey',
    shape: { type: 'eight', a: 215, b: 240, c: -48, h0: 9, h1: 8, h3: 1.5, start: 0.75 },
    banking: 0.8,
    forks: [{ a: 0.52, b: 0.62, m: 3, pads: 1 }, { a: 0.88, b: 0.96, m: 3, pads: -1 }],
    ramps: [0.32], bigjumps: [0.82], pads: [[0.77, 0], [0.97, 0.45]], items: [0.06, 0.25, 0.68, 0.92],
    puddles: [[0.24, 0.35], [0.24, -0.5], [0.6, 0.4], [0.88, -0.2]],
    hazards: [{ type: 'barrel', f: 0.36 }, { type: 'barrelroll', f: 0.62 }, { type: 'barrelroll', f: 0.93 }] },
  { id: 'glacier', name: 'Gletscher-Gipfel', cup: 1, theme: 'glacier',
    shape: { type: 'limacon', s: 100, a: 2.4, b: 1.2, h0: 18, h1: 14, h2: 3, rot: -1.2, sz: 0.85 },
    banking: 0.6,
    halfpipes: [[0.29, 0.44, 7]],
    forks: [{ a: 0.45, b: 0.53, m: 3, pads: -1 }],
    bigjumps: [0.56], glides: [[0.72, 30]],
    narrow: [[0.84, 0.93, 6.5]],
    pads: [[0.2, 0], [0.5, -0.4], [0.5, 0.4], [0.68, 0]], items: [0.1, 0.25, 0.62, 0.88],
    ice: [[0.28, 0.45], [0.6, 0.66]],
    hazards: [{ type: 'snowball', f: 0.12 }, { type: 'snowball', f: 0.62 }] },
  { id: 'reef', name: 'Korallenriff', cup: 1, theme: 'reef',
    shape: { type: 'radial', R0: 180, sx: 1.0, sz: 1.1, k: [[5, 0.1, 0.2], [2, 0.13, 1.5], [3, 0.05, 0]], h0: 12, hk: [[3, 7, 0], [1, 5, 1]] },
    banking: 0.5,
    underwater: [[0.14, 0.33, 9]],
    loops: [0.5],
    forks: [{ a: 0.7, b: 0.82, m: 3, pads: -1 }],
    narrow: [[0.37, 0.45, 6]],
    gaps: [0.9], pads: [[0.46, 0], [0.12, 0]], items: [0.08, 0.26, 0.58, 0.95],
    hazards: [{ type: 'crab', f: 0.2 }, { type: 'crab', f: 0.28 }, { type: 'crab', f: 0.41 }, { type: 'crab', f: 0.62 }] },
  { id: 'clouds', name: 'Wolkenschloss', cup: 1, theme: 'clouds',
    shape: { type: 'lemniscate', a: 250, b: 330, h0: 16, h1: 11, h3: 2, start: 0.75 },
    narrow: [[0.12, 0.28, 5.5]],
    glides: [[0.3, 34], [0.8, 34]], crumble: [[0.5, 20]],
    gaps: [0.64], pads: [[0.26, 0], [0.76, 0], [0.92, 0]], items: [0.08, 0.38, 0.58, 0.88],
    hazards: [{ type: 'bumper', f: 0.42, lat: -0.4 }, { type: 'bumper', f: 0.42, lat: 0.4 }, { type: 'bumper', f: 0.96, lat: 0 }] },
  { id: 'volcano', name: 'Dschungel-Vulkan', cup: 1, theme: 'volcano',
    shape: { type: 'spiral2', R0: 122, A: 44, sx: 1.1, h0: 16, h1: 13 },
    banking: 0.7,
    forks: [{ a: 0.54, b: 0.64, m: 3, pads: -1 }],
    bigjumps: [0.5], crumble: [[0.68, 14]],
    ramps: [0.18, 0.86], pads: [[0.45, 0], [0.46, 0], [0.73, 0]], items: [0.08, 0.26, 0.42, 0.62, 0.92],
    hazards: [{ type: 'vent', f: 0.38, lat: -0.45 }, { type: 'vent', f: 0.38, lat: 0.45 }, { type: 'vent', f: 0.62, lat: -0.3 },
      { type: 'boulder', f: 0.2 }, { type: 'boulder', f: 0.92 }, { type: 'vent', f: 0.78, lat: 0.4 }] },
];
export const CUPS = [
  { id: 'acorn', name: 'Eichel-Cup', icon: '🌰' },
  { id: 'snow', name: 'Schneeflocken-Cup', icon: '❄️' },
];

export const ROAD_HALF = 9;     // halbe Fahrbahnbreite
export const OFFROAD = 5;       // Wiese neben der Fahrbahn bis zur Bande
export const SPACING = 2;       // Abstand der Streckenpunkte

// Mittellinie der Strecke als dichte Punktliste [x, y, z] im Abstand SPACING
export function sampleCenterline(shape) {
  const M = 6000;
  const raw = [];
  for (let i = 0; i < M; i++) {
    const t = (i / M) * Math.PI * 2;
    let x, z, y;
    if (shape.type === 'radial') {
      let r = 1;
      for (const [k, a, p] of shape.k) r += a * Math.cos(k * t + p);
      r *= shape.R0;
      x = shape.sx * r * Math.cos(t);
      z = shape.sz * r * Math.sin(t);
      y = shape.h0;
      for (const [k, h, p] of shape.hk) y += h * Math.cos(k * t + p);
    } else if (shape.type === 'trefoil') {
      // Kleeblatt-Knoten: 3 Kreuzungen, abwechselnd oben/unten
      x = shape.s * (Math.sin(t) + 2 * Math.sin(2 * t));
      z = shape.s * (Math.cos(t) - 2 * Math.cos(2 * t)) * (shape.sz || 1);
      y = shape.h0 + shape.h1 * Math.sin(3 * t + (shape.ph || 0));
    } else if (shape.type === 'limacon') {
      // Schleife mit innerer Kurve, die unter sich durchführt
      const r = shape.s * (shape.b + shape.a * Math.cos(t));
      x = r * Math.cos(t + (shape.rot || 0));
      z = r * Math.sin(t + (shape.rot || 0)) * (shape.sz || 1);
      y = shape.h0 + shape.h1 * Math.sin(t) + (shape.h2 || 0) * Math.cos(2 * t);
    } else if (shape.type === 'spiral2') {
      // Doppelspirale: zwei Runden, die sich zweimal überkreuzen
      const R = shape.R0 + shape.A * Math.cos(t);
      x = (shape.sx || 1) * R * Math.cos(2 * t);
      z = R * Math.sin(2 * t);
      y = shape.h0 + shape.h1 * Math.sin(t);
    } else if (shape.type === 'eight') {
      // Acht mit einstellbaren Schlaufen
      x = shape.a * Math.sin(t);
      z = (shape.b / 2) * Math.sin(2 * t) + (shape.c || 0) * Math.sin(t);
      y = shape.h0 + shape.h1 * Math.cos(t) + (shape.h3 || 0) * Math.cos(3 * t);
    } else {
      // Lemniskate (Acht) – Start auf der oberen Brücke
      x = shape.a * Math.sin(t);
      z = (shape.b / 2) * Math.sin(2 * t);
      y = shape.h0 + shape.h1 * Math.cos(t) + shape.h3 * Math.cos(3 * t);
    }
    raw.push([x, y, z]);
  }
  // Bogenlänge
  const cum = [0];
  for (let i = 1; i <= M; i++) {
    const a = raw[i - 1], b = raw[i % M];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const L = cum[M];
  const n = Math.round(L / SPACING);
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = (i / n) * L;
    while (cum[j + 1] < s) j++;
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const a = raw[j], b = raw[(j + 1) % M];
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
  }
  // Startpunkt verschieben (z. B. weg von einer Kreuzung)
  const s0 = Math.round((shape.start || 0) * n);
  const rot = s0 ? out.slice(s0).concat(out.slice(0, s0)) : out;
  return { points: rot, length: L };
}
