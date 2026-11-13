// Hand-drawn inline SVG icons: items, UI glyphs, track emblems. All original artwork.

const INK = '#24304f';
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const wrap = (body: string, vb = '0 0 64 64') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const acornG = `<g ${S}>
<path d="M17 29c0 14 7 25 15 28 8-3 15-14 15-28z" fill="#e3a45e"/>
<path d="M11 30c0-10 9-17 21-17s21 7 21 17c-7 3.5-35 3.5-42 0z" fill="#8b5a2b"/>
<path d="M32 13c0-4 2-7 6-8" fill="none"/>
<path d="M19 22l5 5M28 17l5 8M38 18l4 7" stroke="#5e3a18" stroke-width="2.2" fill="none"/>
<path d="M23 36c1 6 3 11 7 15" stroke="#fff" stroke-opacity=".6" fill="none"/>
</g>`;

const carrotG = (body: string, ridge: string) => `<g ${S}>
<path d="M42 20c-2-8 0-14 4-15 2 6 1 11-1 15z" fill="#5cc25c"/>
<path d="M44 22c5-6 11-7 14-3-4 5-9 6-13 6z" fill="#5cc25c"/>
<path d="M41 20c-6-4-9-9-7-13 5 2 8 7 8 11z" fill="#48a84a"/>
<path d="M38 18c6-1 11 3 10 10L19 55c-2 2-6 0-5-3L33 21c1-2 3-3 5-3z" fill="${body}"/>
<path d="M28 34l5 3M22 44l4 3M35 26l4 2" stroke="${ridge}" stroke-width="2.4" fill="none"/>
<path d="M33 25L21 47" stroke="#fff" stroke-opacity=".55" fill="none"/>
</g>`;

const spark = (x: number, y: number, r: number, c = '#fff') =>
  `<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}z" fill="${c}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;

function lollySlices(): string {
  const cols = ['#ff6f8e', '#ffa23f', '#ffd23f', '#5ed37a', '#4fb6ff', '#a07bff'];
  let out = '';
  const cx = 32, cy = 26, r = 18;
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2;
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    out += `<path d="M${cx} ${cy}L${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}z" fill="${cols[i]}"/>`;
  }
  return out;
}

export const ITEM_ICONS: Record<string, string> = {
  acorn: wrap(acornG),
  acorn3: wrap(`<g transform="translate(1 14) scale(.62)">${acornG}</g><g transform="translate(23 14) scale(.62)">${acornG}</g><g transform="translate(12 -2) scale(.62)">${acornG}</g>`),
  honey: wrap(`<g ${S}>
<path d="M13 31c0-6 5-9 19-9s19 3 19 9v13c0 9-8 14-19 14s-19-5-19-14z" fill="#f2a52b"/>
<rect x="15" y="14" width="34" height="9" rx="4.5" fill="#ffcf5c"/>
<path d="M19 23v5c0 3 4 3 4 0v-2c0 4 5 4 5 0v-3M37 23v6c0 3 4 3 4 0v-6" fill="#ffcf5c"/>
<rect x="21" y="35" width="22" height="13" rx="5" fill="#fff6dc"/>
<path d="M32 37.5l4 2.3v4.4l-4 2.3-4-2.3v-4.4z" fill="#f2a52b" stroke-width="2"/>
<path d="M17 38c0 5 2 9 5 11" stroke="#fff" stroke-opacity=".6" fill="none"/>
</g>`),
  giftbox: wrap(`<g ${S}>
<rect x="12" y="28" width="40" height="28" rx="4" fill="#ff6f8e"/>
<rect x="9" y="20" width="46" height="10" rx="3" fill="#ff93a8"/>
<path d="M28 20h8v36h-8z" fill="#ffd23f"/>
<path d="M32 20c-4-9-15-11-15-4s11 5 15 4zM32 20c4-9 15-11 15-4s-11 5-15 4z" fill="#ffd23f"/>
<path d="M16 34v16" stroke="#fff" stroke-opacity=".55" fill="none"/>
</g>`),
  yarn: wrap(`<g ${S}>
<path d="M46 44c7 3 11 9 7 14" fill="none"/>
<circle cx="29" cy="33" r="20" fill="#f78fb3"/>
<path d="M12 27c9 4 23 3 34-5M10 37c12 4 26 3 38-7M17 48c8-6 18-20 21-33M27 53c3-10 12-23 19-26" fill="none" stroke="#c9577f" stroke-width="2.4"/>
<path d="M18 22c3-4 7-6 11-6" stroke="#fff" stroke-opacity=".7" fill="none"/>
</g>`),
  bees: wrap(`<g ${S}>
<g transform="translate(34 2) scale(.45)">
<ellipse cx="26" cy="20" rx="7" ry="10" fill="#e8f7ff" transform="rotate(-20 26 20)"/><ellipse cx="38" cy="19" rx="7" ry="10" fill="#e8f7ff" transform="rotate(20 38 19)"/>
<ellipse cx="32" cy="36" rx="17" ry="13" fill="#ffd23f"/><path d="M28 24v24M37 24.5v23" stroke-width="5"/><circle cx="20" cy="33" r="2.4" fill="${INK}"/>
</g>
<ellipse cx="22" cy="22" rx="7" ry="10" fill="#e8f7ff" transform="rotate(-20 22 22)"/>
<ellipse cx="34" cy="21" rx="7" ry="10" fill="#e8f7ff" transform="rotate(20 34 21)"/>
<ellipse cx="28" cy="39" rx="18" ry="14" fill="#ffd23f"/>
<path d="M25 26v26M35 26.5v25" stroke-width="5"/>
<path d="M46 39h6" />
<circle cx="16" cy="36" r="2.4" fill="${INK}" stroke="none"/>
<path d="M13 43c2 2 4 2 6 0" fill="none" stroke-width="2.2"/>
</g>`),
  bubble: wrap(`<g ${S}>
<circle cx="32" cy="32" r="23" fill="#bfe8ff" fill-opacity=".85"/>
<path d="M15 40a19 19 0 0 0 15 12" stroke="#ff9ad5" stroke-width="3" fill="none"/>
<path d="M44 16a19 19 0 0 1 6 10" stroke="#8fe3c0" stroke-width="3" fill="none"/>
<ellipse cx="23" cy="22" rx="7" ry="4.5" fill="#fff" stroke="none" transform="rotate(-38 23 22)"/>
<circle cx="42" cy="44" r="2.5" fill="#fff" stroke="none"/>
</g>`),
  carrot: wrap(carrotG('#ff8a2b', '#d9641a')),
  carrot3: wrap(`<g transform="rotate(-28 32 52) translate(6 10) scale(.75)">${carrotG('#ff8a2b', '#d9641a')}</g><g transform="rotate(26 32 52) translate(10 12) scale(.75)">${carrotG('#ff8a2b', '#d9641a')}</g><g transform="translate(8 6) scale(.78)">${carrotG('#ff8a2b', '#d9641a')}</g>`),
  goldcarrot: wrap(`${carrotG('#ffd23f', '#d99a0c')}${spark(14, 18, 7, '#fff7c2')}${spark(52, 46, 6, '#fff7c2')}${spark(20, 40, 4, '#fff')}`),
  lolly: wrap(`<g ${S}>
<rect x="29" y="38" width="6" height="22" rx="3" fill="#fff"/>
<g stroke-width="0">${lollySlices()}</g>
<circle cx="32" cy="26" r="18" fill="none"/>
<path d="M32 26c0-3 4-3 4 0 0 5-8 5-8 0 0-7 12-7 12 0 0 9-16 9-16 0" fill="none" stroke="#fff" stroke-width="2.6"/>
<path d="M19 18a15 15 0 0 1 7-6" stroke="#fff" stroke-opacity=".8" fill="none"/>
</g>`),
  cloud: wrap(`<g ${S}>
<path d="M16 40c-6 0-10-5-8-11 2-4 6-5 9-4 1-8 9-12 16-9 5-6 15-4 17 3 6 0 10 6 8 12-1 5-6 9-12 9z" fill="#8f99bf"/>
<path d="M35 39l-8 12h7l-4 10 13-15h-7l4-7z" fill="#ffd23f"/>
<path d="M24 29l5 2.5M42 29l-5 2.5" fill="none" stroke-width="2.6"/>
<path d="M17 28c1-3 4-4 6-3" stroke="#fff" stroke-opacity=".55" fill="none"/>
</g>`),
  yawn: wrap(`<g ${S}>
<circle cx="27" cy="37" r="20" fill="#c9b6ff"/>
<path d="M15 33c2.5 2.5 6 2.5 8 0M31 33c2.5 2.5 6 2.5 8 0" fill="none" stroke-width="2.6"/>
<ellipse cx="27" cy="46" rx="5" ry="6.5" fill="#7a3b5a"/>
<circle cx="14" cy="41" r="2.5" fill="#ff9ab8" stroke="none"/><circle cx="40" cy="41" r="2.5" fill="#ff9ab8" stroke="none"/>
<path d="M43 7h10l-10 11h10" fill="none"/>
<path d="M50 23h6l-6 7h6" fill="none" stroke-width="2.5"/>
</g>`),
  itembox: wrap(`<g ${S}>
<rect x="9" y="9" width="46" height="46" rx="11" fill="#ffd23f"/>
<path d="M14 18c1-3 3-5 6-5" stroke="#fff" stroke-opacity=".8" fill="none"/>
<path d="M24 26c0-5 3.5-8.5 8-8.5s8 3 8 7.5c0 6-8 6.5-8 12.5" fill="none" stroke-width="5"/>
<circle cx="32" cy="46.5" r="3.4" fill="${INK}" stroke="none"/>
</g>`),
};

export const ITEM_NAMES: Record<string, string> = {
  acorn: 'Eichel', acorn3: '3 Eicheln', honey: 'Honig', giftbox: 'Geschenk', yarn: 'Wollknäuel', bees: 'Bienen',
  bubble: 'Seifenblase', carrot: 'Karotte', carrot3: '3 Karotten', goldcarrot: 'Goldkarotte', lolly: 'Regenbogen-Lolly',
  cloud: 'Gewitterwolke', yawn: 'Gähnen',
};

export function itemIcon(id: string | null): string {
  if (!id) return '';
  return ITEM_ICONS[id] ?? ITEM_ICONS.itembox;
}

// --- UI glyphs (24 grid, currentColor) ---
const g = (body: string, fill = false) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const UI_ICONS = {
  back: g('<path d="M14.5 5l-7 7 7 7"/>'),
  next: g('<path d="M9.5 5l7 7-7 7"/>'),
  lock: g('<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  pause: g('<rect x="6.5" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.4" fill="currentColor" stroke="none"/>'),
  play: g('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  trophy: g('<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 4M17 6h2.5a2.5 2.5 0 0 1-3 4M12 14v3M8.5 20h7M9.5 17h5"/>'),
  flag: g('<path d="M6 21V4"/><path d="M6 4h12l-2.5 4L18 12H6" fill="currentColor"/>'),
  clock: g('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M10 3h4M12 3v3"/>'),
  gear: g('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9M18.5 18.5l-1.9-1.9M7.4 7.4L5.5 5.5"/><circle cx="12" cy="12" r="6.3"/>'),
  restart: g('<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4v4.5h4.5"/>'),
  exit: g('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>'),
  star: g('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>'),
  music: g('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="17.5" cy="16" r="2.5" fill="currentColor"/>'),
  sound: g('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  phone: g('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
  rotate: g('<rect x="3" y="7" width="18" height="10" rx="2.5"/><path d="M6 4.5A8 8 0 0 1 14 3l-1.6-1.4M18 19.5A8 8 0 0 1 10 21l1.6 1.4"/>'),
  close: g('<path d="M6 6l12 12M18 6L6 18"/>'),
  warn: g('<path d="M12 3.5l9.5 16.5h-19z" fill="currentColor"/><path d="M12 10v4.5M12 17.4v.1" stroke="#fff"/>'),
  uturn: g('<path d="M8 20V10a5 5 0 0 1 10 0v4"/><path d="M14.5 11l3.5 3.5 3.5-3.5"/>'),
  paw: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="currentColor"><ellipse cx="12" cy="15.6" rx="5.4" ry="4.6"/><ellipse cx="5.4" cy="10.4" rx="2.2" ry="2.8" transform="rotate(-20 5.4 10.4)"/><ellipse cx="9.6" cy="6.6" rx="2.2" ry="2.9" transform="rotate(-6 9.6 6.6)"/><ellipse cx="14.4" cy="6.6" rx="2.2" ry="2.9" transform="rotate(6 14.4 6.6)"/><ellipse cx="18.6" cy="10.4" rx="2.2" ry="2.8" transform="rotate(20 18.6 10.4)"/></svg>`,
  keyboard: g('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.1M9.5 10h.1M13 10h.1M16.5 10h.1M7.5 14h9"/>'),
  gamepad: g('<path d="M7 8h10a4.5 4.5 0 0 1 4.3 5.8l-1 3.3a2.3 2.3 0 0 1-4 .8L14.5 16h-5l-1.8 1.9a2.3 2.3 0 0 1-4-.8l-1-3.3A4.5 4.5 0 0 1 7 8z"/><path d="M7.5 11v3M6 12.5h3M16 11.5h.1M18 13.5h.1"/>'),
  touch: g('<path d="M9 11.5V5a1.6 1.6 0 0 1 3.2 0v5.5"/><path d="M12.2 10V8.6a1.6 1.6 0 0 1 3.2 0V11M15.4 10.2a1.6 1.6 0 0 1 3.1.4v3.9a6.5 6.5 0 0 1-6.5 6.5h-.8a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 15.5"/>'),
};

/** A gauge glyph with 1..3 filled segments, used for speed classes. */
export function gaugeIcon(level: 1 | 2 | 3, color: string): string {
  const seg = (i: number) => {
    const a0 = Math.PI * (1 - i / 3) - 0.06, a1 = Math.PI * (1 - (i + 1) / 3) + 0.06;
    const r = 34, cx = 50, cy = 56;
    const p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy - Math.sin(a) * r).toFixed(1)}`;
    return `<path d="M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}" stroke="${i < level ? color : '#d9d2c3'}" stroke-width="13" fill="none" stroke-linecap="round"/>`;
  };
  const ang = Math.PI * (1 - (level - 0.5) / 3);
  const nx = 50 + Math.cos(ang) * 26, ny = 56 - Math.sin(ang) * 26;
  return `<svg viewBox="0 0 100 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${seg(0)}${seg(1)}${seg(2)}
<path d="M50 56L${nx.toFixed(1)} ${ny.toFixed(1)}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="56" r="7" fill="${INK}"/></svg>`;
}

// --- Track emblems (100 grid) ---
function clover(): string {
  const heart = 'M0 0C-3-6-17-11-16-22C-15-30-4-31 0-23C4-31 15-30 16-22C17-11 3-6 0 0Z';
  let leaves = '';
  for (const a of [45, 135, 225, 315]) leaves += `<path d="${heart}" transform="translate(50 46) rotate(${a})" fill="#5ccf5c"/>`;
  return `<g ${S}><path d="M10 92c12-14 26-18 40-12s28 4 40-6v26H10z" fill="#9fe07f" stroke="none"/>
<path d="M52 50c4 12 12 22 22 28" fill="none" stroke-width="5"/><path d="M52 50c4 12 12 22 22 28" fill="none" stroke="#3f9a3f" stroke-width="2"/>
${leaves}<circle cx="50" cy="46" r="4" fill="#3f9a3f"/>
<path d="M38 30c-3-3-3-7 0-9" stroke="#fff" stroke-opacity=".7" fill="none"/></g>`;
}
function bamboo(): string {
  const stalk = (x: number, h: number) => `<rect x="${x}" y="${96 - h}" width="9" height="${h}" rx="4" fill="#7fcf6a"/>${[0.3, 0.6].map((f) => `<path d="M${x} ${96 - h * f}h9" />`).join('')}`;
  return `<g ${S}>${stalk(10, 76)}${stalk(81, 64)}
<path d="M22 50h56l-7 10H29z" fill="#e2483d"/><path d="M14 44q36-14 72 0l-6 6H20z" fill="#ff6a4f"/>
<rect x="33" y="60" width="34" height="26" fill="#ffe2a8"/><path d="M45 86V70a5 5 0 0 1 10 0v16" fill="#8b4a2b"/>
<path d="M26 34q24-12 48 0l-5 6H31z" fill="#ff6a4f"/><path d="M50 22v-8" /><circle cx="50" cy="12" r="3.5" fill="#ffd23f"/></g>`;
}
function honey(): string {
  const hex = (x: number, y: number, r: number, f: string) => {
    let d = '';
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`; }
    return `<path d="${d}Z" fill="${f}"/>`;
  };
  return `<g ${S}>${hex(36, 40, 17, '#ffcf3f')}${hex(65, 40, 17, '#f5a623')}${hex(50.5, 65, 17, '#ffb92f')}
<path d="M28 33l5-4M57 33l5-4" stroke="#fff" stroke-opacity=".7"/>
<path d="M44 72c0 6 3 11 6.5 11S57 78 57 72c0-4-6.5-12-6.5-12S44 68 44 72z" fill="#f28c0c"/></g>`;
}
function glacier(): string {
  return `<g ${S}><path d="M4 90L34 36l14 20 14-34 34 68z" fill="#8fc7f0"/>
<path d="M27 49l7-13 7 10-5 4-4-4zM55 38l7-16 8 17-6 5-4-6-5 4z" fill="#fff"/>
<path d="M4 90c20-6 40-6 92 0" fill="none"/>
<path d="M76 24l2-6 2 6 6 2-6 2-2 6-2-6-6-2z" fill="#fff" stroke-width="1.6"/></g>`;
}
function flag(): string {
  let sq = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) if ((r + c) % 2 === 0) sq += `<rect x="${30 + c * 8}" y="${22 + r * 8}" width="8" height="8" fill="${INK}"/>`;
  return `<g ${S}><path d="M28 88V16"  stroke-width="5"/><rect x="30" y="22" width="48" height="32" fill="#fff"/>${sq}<rect x="30" y="22" width="48" height="32" fill="none"/></g>`;
}

export interface TrackTheme { emblem: string; from: string; to: string }

export function trackTheme(nameOrId: string): TrackTheme {
  const n = nameOrId.toLowerCase();
  if (n.includes('klee')) return { emblem: wrap(clover(), '0 0 100 100'), from: '#b4f08f', to: '#3fae5a' };
  if (n.includes('bambus')) return { emblem: wrap(bamboo(), '0 0 100 100'), from: '#b8ecc0', to: '#2f8f6a' };
  if (n.includes('honig')) return { emblem: wrap(honey(), '0 0 100 100'), from: '#ffe28a', to: '#f08a1a' };
  if (n.includes('gletscher')) return { emblem: wrap(glacier(), '0 0 100 100'), from: '#dff3ff', to: '#4f9fe0' };
  return { emblem: wrap(flag(), '0 0 100 100'), from: '#d6d2ff', to: '#7f78e0' };
}
