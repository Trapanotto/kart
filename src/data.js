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
];

export const ITEMS = {
  acorn:   { icon: '🌰', name: 'Eichel-Wurf' },
  honey:   { icon: '🍯', name: 'Honigpfütze' },
  yarn:    { icon: '🧶', name: 'Wollknäuel' },
  bubble:  { icon: '🫧', name: 'Seifenblasen-Schild' },
  carrot:  { icon: '🥕', name: 'Karotten-Turbo' },
  carrot3: { icon: '🥕', name: '3× Karotten-Turbo', count: 3 },
  cloud:   { icon: '🌧️', name: 'Gewitterwölkchen' },
  yawn:    { icon: '💤', name: 'Gähn-Welle' },
};

// r = 0 (Führung) .. 1 (letzter Platz)
export function itemWeights(r) {
  return {
    acorn: 28 * (1 - r) + 8,
    honey: 22 * (1 - r) + 4,
    yarn: 4 + 22 * r,
    bubble: 12,
    carrot: 8 + 22 * r,
    carrot3: r > 0.3 ? 4 + 22 * r : 0,
    cloud: r < 0.35 ? 9 : 0,
    yawn: r > 0.6 ? 10 * r : 0,
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
    shape: { type: 'radial', R0: 175, sx: 1.25, sz: 0.85, k: [[2, 0.1, 0.3], [3, 0.07, 1.0]], h0: 2, hk: [[1, 2.5, 0], [2, 1.5, 1]] },
    ramps: [0.42], pads: [[0.16, 0], [0.7, -0.4], [0.7, 0.4]], items: [0.27, 0.58, 0.86] },
  { id: 'bamboo', name: 'Bambuswald-Tempel', cup: 0, theme: 'bamboo',
    shape: { type: 'radial', R0: 185, sx: 1.05, sz: 1.0, k: [[3, 0.17, 0.3], [5, 0.04, 1.2]], h0: 7, hk: [[2, 6, 0.5], [3, 3, 0]] },
    ramps: [0.22, 0.74], pads: [[0.5, 0.45], [0.5, -0.45], [0.9, 0]], items: [0.12, 0.4, 0.64, 0.84] },
  { id: 'cave', name: 'Pilzhöhlen', cup: 0, theme: 'cave',
    shape: { type: 'radial', R0: 170, sx: 1.15, sz: 0.95, k: [[4, 0.12, 0.0], [2, 0.1, 2.0]], h0: 5, hk: [[1, 4, 0], [4, 1.5, 0.6]] },
    ramps: [0.6], pads: [[0.1, 0.5], [0.35, -0.5], [0.82, 0]], items: [0.2, 0.47, 0.72, 0.92] },
  { id: 'honey', name: 'Honigfabrik', cup: 0, theme: 'honey',
    shape: { type: 'radial', R0: 180, sx: 1.3, sz: 0.8, k: [[2, 0.14, 0.5], [3, 0.11, 0.0], [6, 0.025, 0]], h0: 4, hk: [[2, 3, 0.2]] },
    ramps: [0.32, 0.8], pads: [[0.55, 0], [0.95, 0.45]], items: [0.15, 0.45, 0.68, 0.9],
    puddles: [[0.24, 0.35], [0.24, -0.5], [0.52, -0.3], [0.62, 0.5], [0.88, -0.2]] },
  { id: 'glacier', name: 'Gletscher-Gipfel', cup: 1, theme: 'glacier',
    shape: { type: 'radial', R0: 190, sx: 1.1, sz: 1.0, k: [[3, 0.19, 1.0], [1, 0.08, 0.0]], h0: 16, hk: [[1, 13, 0], [2, 4, 1]] },
    ramps: [0.55], pads: [[0.2, 0], [0.8, -0.45], [0.8, 0.45]], items: [0.1, 0.35, 0.65, 0.88],
    ice: [[0.28, 0.45], [0.68, 0.78]] },
  { id: 'reef', name: 'Korallenriff', cup: 1, theme: 'reef',
    shape: { type: 'radial', R0: 180, sx: 1.0, sz: 1.1, k: [[5, 0.08, 0.2], [2, 0.12, 1.5]], h0: 6, hk: [[3, 4, 0]] },
    ramps: [0.3, 0.66], pads: [[0.12, 0.45], [0.12, -0.45], [0.5, 0], [0.86, 0]], items: [0.2, 0.42, 0.58, 0.78] },
  { id: 'clouds', name: 'Wolkenschloss', cup: 1, theme: 'clouds',
    shape: { type: 'lemniscate', a: 250, b: 330, h0: 16, h1: 11, h3: 2 },
    ramps: [0.62], pads: [[0.2, 0], [0.45, 0.45], [0.45, -0.45], [0.92, 0]], items: [0.1, 0.33, 0.55, 0.8] },
  { id: 'volcano', name: 'Dschungel-Vulkan', cup: 1, theme: 'volcano',
    shape: { type: 'radial', R0: 200, sx: 1.1, sz: 1.0, k: [[3, 0.14, 0.0], [4, 0.07, 0.7], [7, 0.02, 0]], h0: 9, hk: [[1, 8, 0], [3, 3, 0.5]] },
    ramps: [0.18, 0.5, 0.84], pads: [[0.35, 0.45], [0.35, -0.45], [0.7, 0]], items: [0.08, 0.28, 0.45, 0.62, 0.92] },
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
  return { points: out, length: L };
}
