// Title, main menu, character, class and track selection, options, controls.
import { CHARACTERS, SPEED_CLASSES, character } from '../../core/data';
import type { CharacterDef, QualityTier, Settings } from '../../core/types';
import { audioBridge } from '../../audio/bridge';
import { h, fmtTime } from '../dom';
import { UI_ICONS, gaugeIcon, trackTheme } from '../icons';
import { onAdjust } from '../nav';
import { button, footer, header, portrait, screenEl, stagger, type Screen } from '../router';
import { pbFor, saveStore, store, trophyFor, type Trophy } from '../storage';
import { CUP, cupSlots } from '../tracks';
import type { UiCtx } from '../context';

// ---------------------------------------------------------------- title
export function titleScreen(ctx: UiCtx): Screen {
  const go = () => { audioBridge.unlock(); audioBridge.ui('start'); ctx.toMenu(); };
  const logo = buildLogo(true);
  const parade = h('div.tk-parade', CHARACTERS.map((c, i) => { const p = portrait(c, true); p.style.setProperty('--i', String(i)); return p; }));
  const press = h('div.tk-press', ctx.isTouch() ? 'Tippe, um zu starten' : 'Drücke eine Taste');
  const el = screenEl('tk-title', 'light', logo, press, parade, h('div.tk-version', 'Meilenstein 1'));
  el.addEventListener('click', go);
  return { name: 'title', el, anyKey: go, onEnter: () => audioBridge.screenMusic('menu') };
}

export function buildLogo(big: boolean): HTMLElement {
  const letters = (s: string, off: number) => [...s].map((ch, i) => { const sp = h('span', ch); sp.style.setProperty('--i', String(i + off)); return sp; });
  return h('div.tk-logo-wrap',
    h('div.tk-logo',
      h('div.l1', letters('Trapanotto', 0)),
      h('div.l2', letters('Kart', 10), h('span.paw', { html: UI_ICONS.paw })),
      big ? h('div.badge', 'Pfoten aufs Gas!') : null,
    ),
  );
}

// ---------------------------------------------------------------- main menu
export function menuScreen(ctx: UiCtx): Screen {
  const pick = (mode: 'grandprix' | 'race' | 'timetrial') => () => { ctx.state.mode = mode; ctx.state.gp = null; ctx.toChars(); };
  const col = h('div.col',
    buildLogo(false),
    button('Grand Prix', { cls: 'sun', sub: 'Vier Strecken, ein Pokal', icon: '', onClick: pick('grandprix') }),
    button('Einzelrennen', { cls: 'coral', sub: 'Eine Strecke, freie Wahl', onClick: pick('race') }),
    button('Zeitfahren', { cls: 'sky', sub: 'Jag deine Bestzeit', onClick: pick('timetrial') }),
    button('Optionen', { cls: '', sub: 'Grafik, Ton und Steuerung', onClick: () => ctx.toOptions(() => ctx.toMenu('back')) }),
  );
  // Put icons into bubbles.
  const icons = [UI_ICONS.trophy, UI_ICONS.flag, UI_ICONS.clock, UI_ICONS.gear];
  [...col.querySelectorAll('.tk-btn')].forEach((b, i) => { b.querySelector('.ico')?.remove(); b.prepend(h('span.ico-bubble', { html: icons[i] })); });
  stagger(col);

  const shelf = h('div.tk-panel.pad.tk-shelf',
    h('div.tk-label', 'Pokalvitrine'),
    h('h2', CUP.name),
    h('div.cups', SPEED_CLASSES.map((c) => {
      const t = trophyFor(CUP.id, c.id);
      return h('div.cup', h('div.t' + (t ? '.' + t : ''), { html: UI_ICONS.trophy }), c.name, t ? null : h('div', { style: { fontWeight: '500', color: 'var(--ink-3)', fontSize: '.85em' } }, 'noch leer'));
    })),
  );
  const side = h('div.side', shelf);
  const el = screenEl('tk-menu', 'light', col, side);
  return {
    name: 'menu', el, back: () => ctx.toTitle(),
    initial: () => col.querySelector('.tk-btn'),
    onEnter: () => audioBridge.screenMusic('menu'),
  };
}

// ---------------------------------------------------------------- character select
const STAT_LABELS: [keyof CharacterDef, string, string][] = [
  ['speed', 'Tempo', '#ff7a5c'], ['accel', 'Beschleunigung', '#ffb02e'], ['handling', 'Handling', '#4fd1a5'],
  ['drift', 'Drift', '#9b7bf0'], ['weight', 'Gewicht', '#6ec6f5'], ['tough', 'Robustheit', '#ff8fb8'],
];

export function charScreen(ctx: UiCtx): Screen {
  const det = {
    portraitHost: h('div'),
    name: h('div.nm'),
    animal: h('div.an'),
    perk: h('span'),
    bars: STAT_LABELS.map(() => h('div.tk-bar', [h('i'), h('i'), h('i'), h('i'), h('i')])),
  };
  const detail = h('div.tk-panel.tk-detail',
    h('div.top', det.portraitHost, h('div', det.name, det.animal, h('div.tk-perk', h('span', { html: UI_ICONS.star }), det.perk))),
    h('div.tk-stats', STAT_LABELS.flatMap(([, label, color], i) => { det.bars[i].style.setProperty('--bc', color); return [h('span.k', label), det.bars[i]]; })),
  );
  let shown: string | null = null;
  const showChar = (c: CharacterDef) => {
    if (shown === c.id) return;
    shown = c.id;
    det.portraitHost.replaceChildren(portrait(c));
    det.name.textContent = c.name;
    det.animal.textContent = c.animal;
    det.perk.textContent = c.perk;
    STAT_LABELS.forEach(([k], i) => {
      const v = c[k] as number;
      [...det.bars[i].children].forEach((pip, j) => pip.classList.toggle('on', j < v));
    });
    det.portraitHost.firstElementChild?.animate([{ transform: 'scale(.7) rotate(-8deg)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2,1.5,.45,1)' });
  };
  const cards = CHARACTERS.map((c) => {
    const card = h('div.tk-card.tk-char', { role: 'button', 'data-focus': true, 'aria-label': c.name }, portrait(c), h('div.nm', c.name));
    card.style.setProperty('--pc', c.color);
    card.addEventListener('tkfocus', () => showChar(c));
    card.addEventListener('click', () => {
      showChar(c);
      ctx.state.char = c.id;
      store.lastChar = c.id; saveStore();
      audioBridge.voice(c.id);
      audioBridge.ui('confirm');
      card.classList.add('picked');
      ctx.toClasses();
    });
    return card;
  });
  const grid = stagger(h('div.tk-grid', cards));
  const title = ctx.state.mode === 'grandprix' ? 'Grand Prix' : ctx.state.mode === 'timetrial' ? 'Zeitfahren' : 'Einzelrennen';
  const el = screenEl('tk-chars', 'light',
    header(`${title}: Wer fährt?`, () => ctx.toMenu('back')),
    h('div.body', grid, detail),
    footer('Fahren', 'Zurück'),
  );
  return {
    name: 'chars', el, back: () => ctx.toMenu('back'),
    initial: () => { const i = CHARACTERS.findIndex((c) => c.id === ctx.state.char); showChar(CHARACTERS[Math.max(0, i)]); return cards[Math.max(0, i)]; },
  };
}

// ---------------------------------------------------------------- speed class
const CLASS_INFO: Record<string, { desc: string; color: string; level: 1 | 2 | 3; cls: string }> = {
  easy: { desc: 'Gemütlich cruisen und die Aussicht geniessen.', color: '#4fd1a5', level: 1, cls: 'mint' },
  normal: { desc: 'Der flotte Klassiker für alle Pfoten.', color: '#ffb02e', level: 2, cls: 'sun' },
  turbo: { desc: 'Nur für echte Profis. Halt dich fest!', color: '#ff7a5c', level: 3, cls: 'coral' },
};

export function classScreen(ctx: UiCtx): Screen {
  const cards = SPEED_CLASSES.map((c) => {
    const info = CLASS_INFO[c.id];
    const t: Trophy | null = ctx.state.mode === 'grandprix' ? trophyFor(CUP.id, c.id) : null;
    const card = h('div.tk-card.tk-class', { role: 'button', 'data-focus': true },
      t ? h('div.tro.' + t, { html: UI_ICONS.trophy }) : null,
      h('div.g', { html: gaugeIcon(info.level, info.color) }),
      h('div.nm', c.name),
      h('div.ds', info.desc),
    );
    card.addEventListener('click', () => {
      audioBridge.ui('confirm');
      ctx.state.cls = c;
      store.lastClass = c.id; saveStore();
      ctx.toTracks();
    });
    return card;
  });
  const ch = character(ctx.state.char);
  const el = screenEl('tk-classes', 'light',
    header('Wie schnell?', () => ctx.toChars('back'), h('div.tk-sub', `${ch.name} fährt`)),
    stagger(h('div.body', cards)),
    footer(),
  );
  return {
    name: 'classes', el, back: () => ctx.toChars('back'),
    initial: () => cards[Math.max(0, SPEED_CLASSES.findIndex((c) => c.id === ctx.state.cls.id))],
  };
}

// ---------------------------------------------------------------- track / cup select
function trackCard(name: string, idx: number | null, meta: { laps?: number } | null, sub: string | null, onPick: (() => void) | null): HTMLElement {
  const th = trackTheme(name);
  const locked = !onPick;
  const card = h('div.tk-card.tk-track' + (locked ? '.locked' : ''), { role: 'button', 'data-focus': true },
    h('div.art', h('span', { html: th.emblem, style: { display: 'contents' } })),
    idx !== null ? h('div.num', String(idx)) : null,
    locked ? h('div.lock', h('span', h('span', { html: UI_ICONS.lock }), 'Bald verfügbar')) : null,
    h('div.info', h('div.nm', name), h('div.meta', h('span', meta ? `${meta.laps ?? 3} Runden` : 'In Arbeit'), sub ? h('span.pb', sub) : null)),
  );
  card.style.setProperty('--tf', th.from);
  card.style.setProperty('--tt', th.to);
  card.addEventListener('click', () => {
    if (!onPick) { audioBridge.ui('error'); card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 240 }); return; }
    audioBridge.ui('start');
    onPick();
  });
  return card;
}

export function trackScreen(ctx: UiCtx): Screen {
  const { slots, extras } = cupSlots(ctx.app.tracks);
  const cls = ctx.state.cls;
  const back = () => ctx.toClasses('back');
  let body: HTMLElement;
  let first: HTMLElement | null = null;
  if (ctx.state.mode === 'grandprix') {
    const playable = slots.some((s) => s.meta) || extras.length > 0;
    const go = button('Grand Prix starten', { cls: 'sun center go',icon: UI_ICONS.play, sound: 'start', onClick: () => ctx.startGrandPrix() });
    if (!playable) go.setAttribute('data-disabled', '');
    const tro = h('div.tro', SPEED_CLASSES.map((c) => { const t = trophyFor(CUP.id, c.id); return h('i' + (t ? '.' + t : ''), { html: UI_ICONS.trophy, title: c.name }); }));
    const minis = slots.map((s, i) => {
      const th = trackTheme(s.name);
      const m = h('div.mini' + (s.meta ? '' : '.locked'), h('div.art', h('span', { html: th.emblem, style: { display: 'contents' } })), s.meta ? null : h('span.lk', h('span', { html: UI_ICONS.lock }), 'Bald'), h('div.nm', `${i + 1}. ${s.name}`));
      m.style.setProperty('--tf', th.from); m.style.setProperty('--tt', th.to);
      return m;
    });
    const note = !slots.some((s) => s.meta) && extras.length
      ? h('div', { style: { textAlign: 'center', color: 'var(--ink-2)', fontSize: '.9em' } }, `Vorschau: Der Cup wird auf ${extras.map((e) => e.name).join(', ')} gefahren.`)
      : null;
    const cup = h('div.tk-panel.tk-cup',
      h('div.hd', h('div.t', { html: UI_ICONS.trophy }), h('div', h('div.tk-label', `Klasse ${cls.name}`), h('div.nm', CUP.name)), tro),
      h('div.list', minis), note, go);
    first = go;
    body = stagger(h('div.body', cup));
  } else {
    const tt = ctx.state.mode === 'timetrial';
    const cards: HTMLElement[] = [];
    slots.forEach((s, i) => {
      const pb = tt && s.meta ? pbFor(s.meta.id, cls.id) : null;
      cards.push(trackCard(s.name, i + 1, s.meta, pb ? `Rekord ${fmtTime(pb.time)}` : null, s.meta ? () => ctx.launch(s.meta!.id) : null));
    });
    extras.forEach((m) => {
      const pb = tt ? pbFor(m.id, cls.id) : null;
      cards.push(trackCard(m.name, null, m, pb ? `Rekord ${fmtTime(pb.time)}` : null, () => ctx.launch(m.id)));
    });
    const idx = ctx.state.trackId ? [...slots.map((s) => s.meta?.id), ...extras.map((e) => e.id)].indexOf(ctx.state.trackId) : -1;
    first = cards[idx >= 0 ? idx : Math.max(0, slots.findIndex((s) => s.meta))] ?? cards[0];
    if (!slots.some((s) => s.meta) && extras.length) first = cards[slots.length];
    body = stagger(h('div.body', cards));
  }
  const el = screenEl('tk-tracks', 'light',
    header(ctx.state.mode === 'grandprix' ? 'Wähle deinen Cup' : 'Wähle eine Strecke', back, h('div.tk-sub', `${character(ctx.state.char).name} · ${cls.name}`)),
    body,
    footer('Los geht’s'),
  );
  return { name: 'tracks', el, back, initial: () => first };
}

// ---------------------------------------------------------------- options
function row(label: string, sub: string | null, control: HTMLElement, onConfirm?: () => void, onAdj?: (d: -1 | 1) => void): HTMLElement {
  const r = h('div.tk-row', { role: 'button', 'data-focus': true }, h('span.k', label, sub ? h('small', sub) : null), control);
  if (onConfirm) r.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.tk-slider')) return; onConfirm(); });
  if (onAdj) onAdjust(r, onAdj);
  return r;
}

function segmented<T extends string>(opts: [T, string][], get: () => T, set: (v: T) => void): { el: HTMLElement; cycle: (d: -1 | 1) => void } {
  const spans = opts.map(([v, l]) => {
    const s = h('span', l);
    s.addEventListener('click', (e) => { e.stopPropagation(); set(v); sync(); audioBridge.ui('toggle'); });
    return s;
  });
  const sync = () => spans.forEach((s, i) => s.classList.toggle('on', opts[i][0] === get()));
  sync();
  return {
    el: h('div.tk-seg', spans),
    cycle: (d) => {
      const i = opts.findIndex((o) => o[0] === get());
      const n = Math.max(0, Math.min(opts.length - 1, i + d));
      if (n !== i) { set(opts[n][0]); sync(); audioBridge.ui('toggle'); }
    },
  };
}

function toggle(get: () => boolean, set: (v: boolean) => void): { el: HTMLElement; flip: () => void } {
  const el = h('div.tk-toggle');
  const sync = () => el.classList.toggle('on', get());
  sync();
  return { el, flip: () => { set(!get()); sync(); audioBridge.ui('toggle'); } };
}

function slider(get: () => number, set: (v: number) => void, commit: () => void): { el: HTMLElement; step: (d: -1 | 1) => void } {
  const fill = h('div.fill'), knob = h('div.knob'), val = h('span.v');
  const tr = h('div.tr', fill, knob);
  const sync = () => {
    const v = get();
    fill.style.transform = `scaleX(${v})`;
    knob.style.left = `${v * 100}%`;
    val.textContent = String(Math.round(v * 10));
  };
  sync();
  let dragging = false;
  const fromEvent = (e: PointerEvent) => {
    const r = tr.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    set(Math.round(v * 20) / 20); sync();
  };
  tr.addEventListener('pointerdown', (e) => { dragging = true; tr.setPointerCapture(e.pointerId); fromEvent(e); e.stopPropagation(); });
  tr.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const end = () => { if (dragging) { dragging = false; audioBridge.ui('slider'); commit(); } };
  tr.addEventListener('pointerup', end);
  tr.addEventListener('pointercancel', end);
  return {
    el: h('div.tk-slider', tr, val),
    step: (d) => { const v = Math.max(0, Math.min(1, Math.round((get() + d * 0.1) * 10) / 10)); if (v !== get()) { set(v); sync(); audioBridge.ui('slider'); commit(); } },
  };
}

export function optionsScreen(ctx: UiCtx, back: () => void, inRace: boolean): Screen {
  const s = ctx.app.settings;
  let dirty = false;
  const save = () => { ctx.app.saveSettings(); dirty = false; };
  const live = () => { dirty = true; audioBridge.settingsChanged(); };

  const q = segmented<Settings['quality']>([['auto', 'Auto'], ['high', 'Hoch'], ['medium', 'Mittel'], ['mobile', 'Handy']], () => s.quality, (v) => { s.quality = v as QualityTier | 'auto'; save(); });
  const mus = slider(() => s.musicVolume, (v) => { s.musicVolume = v; live(); }, save);
  const sfx = slider(() => s.sfxVolume, (v) => { s.sfxVolume = v; live(); }, save);
  const tg = (k: 'autoThrottle' | 'steerAssist' | 'cameraShake' | 'vibration') => toggle(() => s[k], (v) => { s[k] = v; save(); });
  const at = tg('autoThrottle'), sa = tg('steerAssist'), cs = tg('cameraShake'), vb = tg('vibration');
  const tl = segmented<'stick' | 'zones'>([['stick', 'Stick'], ['zones', 'Tasten']], () => store.touchLayout, (v) => ctx.setTouchLayout(v));

  const colA = h('div.tk-panel.col',
    h('h2', h('span', { html: UI_ICONS.sound }), 'Grafik & Ton'),
    row('Grafik', 'Auto wählt passend zum Gerät', q.el, () => q.cycle(1), q.cycle),
    row('Musik', null, mus.el, undefined, mus.step),
    row('Effekte', null, sfx.el, undefined, sfx.step),
    row('Kamerawackeln', 'Bei Treffern und Turbos', cs.el, cs.flip, () => cs.flip()),
    row('Vibration', 'Auf Handys und Gamepads', vb.el, vb.flip, () => vb.flip()),
  );
  const colB = h('div.tk-panel.col',
    h('h2', h('span', { html: UI_ICONS.gamepad }), 'Steuerung & Hilfen'),
    row('Auto-Gas', inRace ? 'Gilt ab dem nächsten Rennen' : 'Dein Kart gibt von selbst Gas', at.el, at.flip, () => at.flip()),
    row('Lenkhilfe', inRace ? 'Gilt ab dem nächsten Rennen' : 'Hält dich sanft auf der Strecke', sa.el, sa.flip, () => sa.flip()),
    row('Touch-Lenkung', 'Stick oder zwei Lenktasten', tl.el, () => tl.cycle(store.touchLayout === 'stick' ? 1 : -1), tl.cycle),
    row('Steuerung', 'Alle Tasten im Überblick', h('span.go', { html: UI_ICONS.next }), () => { audioBridge.ui('confirm'); if (dirty) save(); ctx.toControls(() => ctx.toOptions(back)); }),
  );
  const leave = () => { if (dirty) save(); back(); };
  const el = screenEl('tk-options', inRace ? 'dim' : 'light',
    header('Optionen', leave),
    stagger(h('div.body', colA, colB)),
    footer('Ändern', 'Zurück'),
  );
  return { name: 'options', el, back: leave, initial: () => colA.querySelector('.tk-row') };
}

export function controlsScreen(_ctx: UiCtx, back: () => void, inRace: boolean): Screen {
  const k = (...keys: string[]) => h('dt', keys.map((x) => h('span.tk-key', x)));
  const d = (t: string) => h('dd', t);
  const panel = h('div.tk-panel.tk-controls',
    h('div', h('h3', h('span', { html: UI_ICONS.keyboard }), 'Tastatur'), h('dl',
      k('W', '↑'), d('Gas'), k('S', '↓'), d('Bremsen, rückwärts'), k('A', 'D'), d('Lenken'),
      k('Leertaste'), d('Springen und driften'), k('E'), d('Item einsetzen'), k('S', '+', 'E'), d('Item nach hinten'),
      k('Q'), d('Nach hinten schauen'), k('Esc'), d('Pause'))),
    h('div', h('h3', h('span', { html: UI_ICONS.gamepad }), 'Gamepad'), h('dl',
      k('A', 'RT'), d('Gas'), k('B', 'LT'), d('Bremsen, rückwärts'), k('Stick'), d('Lenken'),
      k('RB', 'X'), d('Springen und driften'), k('LB', 'Y'), d('Item einsetzen'), k('↓', '+', 'LB'), d('Item nach hinten'),
      k('R3'), d('Nach hinten schauen'), k('Start'), d('Pause'))),
    h('div', h('h3', h('span', { html: UI_ICONS.touch }), 'Touch'), h('dl',
      k('Links'), d('Lenken mit dem Daumen'), k('Drift'), d('Springen und driften'), k('Item'), d('Antippen zum Einsetzen'),
      k('Item ↓'), d('Runterziehen: nach hinten'), k('Bremse'), d('Bremsen, rückwärts'), k('Auto-Gas'), d('Gibt automatisch Gas'))),
  );
  const ok = button('Alles klar', { cls: 'sun center', onClick: back });
  const el = screenEl('tk-options', inRace ? 'dim' : 'light',
    header('Steuerung', back),
    h('div.body', { style: { flexDirection: 'column', alignItems: 'center', gap: '1.2em', justifyContent: 'center' } }, panel, ok),
    footer('OK', 'Zurück'),
  );
  return { name: 'controls', el, back, initial: () => ok };
}
