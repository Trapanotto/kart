// Screen router with animated transitions, plus shared building blocks for screens.
import type { CharacterDef } from '../core/types';
import { audioBridge } from '../audio/bridge';
import { h, luminance, BASE } from './dom';
import { UI_ICONS } from './icons';
import type { Nav, NavScope } from './nav';

export interface Screen {
  name: string;
  el: HTMLElement;
  /** Back action; omitted = no back. */
  back?: () => void;
  escBack?: boolean;
  initial?: () => HTMLElement | null;
  onEnter?(): void;
  onLeave?(): void;
  update?(dt: number): void;
  /** Title-style screens: any key / tap continues. */
  anyKey?: () => void;
}

export type TransitionDir = 'fwd' | 'back' | 'fade';

export class Router {
  current: Screen | null = null;

  constructor(private layer: HTMLElement, private nav: Nav) {}

  show(s: Screen, dir: TransitionDir = 'fwd'): void {
    const prev = this.current;
    if (prev === s) return;
    if (prev) this.dismiss(prev, dir);
    this.current = s;
    s.el.classList.remove('tk-leave', 'tk-fade-out', 'back');
    s.el.classList.add(dir === 'fade' ? 'tk-fade-in' : 'tk-enter');
    if (dir === 'back') s.el.classList.add('back');
    this.layer.appendChild(s.el);
    const scope: NavScope = { root: s.el, back: s.back, escBack: s.escBack };
    this.nav.setScope(scope, s.initial?.() ?? null);
    this.nav.anyKey = s.anyKey ?? null;
    s.onEnter?.();
    s.el.addEventListener('animationend', () => s.el.classList.remove('tk-enter', 'tk-fade-in'), { once: true });
  }

  /** Removes the current screen (e.g. when the HUD takes over). */
  clear(dir: TransitionDir = 'fade'): void {
    if (!this.current) return;
    this.dismiss(this.current, dir);
    this.current = null;
    this.nav.setScope(null);
    this.nav.anyKey = null;
  }

  private dismiss(s: Screen, dir: TransitionDir): void {
    s.onLeave?.();
    const el = s.el;
    el.classList.remove('tk-enter', 'tk-fade-in', 'back');
    el.classList.add(dir === 'fade' ? 'tk-fade-out' : 'tk-leave');
    if (dir === 'back') el.classList.add('back');
    const done = () => { if (this.current !== s) el.remove(); el.classList.remove('tk-leave', 'tk-fade-out', 'back'); };
    setTimeout(done, 240);
  }

  update(dt: number): void { this.current?.update?.(dt); }
}

// ---------------------------------------------------------------- building blocks

const portraitOk = new Map<string, boolean>();

export function portrait(c: CharacterDef, small = false): HTMLElement {
  const el = h('div.tk-portrait');
  el.style.setProperty('--pc', c.color);
  el.style.setProperty('--pf', luminance(c.color) > 0.55 ? '#24304f' : '#fff');
  el.append(h('span.ini' + (small ? '.sm' : ''), c.name[0]));
  if (portraitOk.get(c.id) !== false) {
    const img = h<HTMLImageElement>('img', { alt: '', draggable: 'false', decoding: 'async' });
    img.onload = () => { portraitOk.set(c.id, true); el.classList.add('has-img'); };
    img.onerror = () => { portraitOk.set(c.id, false); img.remove(); };
    img.src = `${BASE}assets/portraits/${c.id}.webp`;
    el.append(img);
  }
  return el;
}

export function button(label: string, opts: { icon?: string; cls?: string; sub?: string; onClick?: () => void; sound?: 'confirm' | 'start' | 'none' } = {}): HTMLElement {
  const content = opts.sub
    ? h('span.txt', h('span', label), h('small', opts.sub))
    : h('span', label);
  const el = h('div.tk-btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), { role: 'button', 'data-focus': true, tabindex: '-1' },
    opts.icon ? h('span.ico', { html: opts.icon }) : null,
    content,
  );
  el.addEventListener('click', () => {
    if (el.hasAttribute('data-disabled')) return;
    if (opts.sound !== 'none') audioBridge.ui(opts.sound ?? 'confirm');
    opts.onClick?.();
  });
  return el;
}

export function header(title: string, back?: () => void, extra?: HTMLElement | null): HTMLElement {
  return h('div.tk-head',
    back ? h('div.tk-back', { role: 'button', 'data-focus': true, 'aria-label': 'Zurück', html: UI_ICONS.back, onclick: () => { audioBridge.ui('back'); back(); } }) : null,
    h('div.tk-title-chip', title),
    h('div.tk-spacer'),
    extra ?? null,
  );
}

export function footer(confirm = 'Auswählen', back: string | null = 'Zurück'): HTMLElement {
  return h('div.tk-foot',
    h('span.hint', h('span.glyph.kbd-only', 'Enter'), h('span.glyph.round.a.pad-only', 'A'), confirm),
    back ? h('span.hint', h('span.glyph.kbd-only', 'Esc'), h('span.glyph.round.b.pad-only', 'B'), back) : null,
  );
}

export function screenEl(cls: string, scrim: 'light' | 'solid' | 'dim' | 'none' = 'light', ...kids: (HTMLElement | null)[]): HTMLElement {
  return h('div.tk-screen.' + cls, scrim !== 'none' ? h('div.tk-scrim' + (scrim === 'light' ? '' : '.' + scrim)) : null, ...kids);
}

/** Sets --i on children for staggered entrance animations. */
export function stagger(el: HTMLElement): HTMLElement {
  el.classList.add('stagger');
  [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty('--i', String(i)));
  return el;
}
