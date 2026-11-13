// Minimal DOM helpers. No framework: elements are built once and updated in place.

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

function isAttrs(v: unknown): v is Attrs {
  return !!v && typeof v === 'object' && !(v instanceof Node) && !Array.isArray(v);
}

function append(el: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}

/** `h('div.panel.big', { onclick }, 'text', child)`; tag defaults to div. */
export function h<T extends HTMLElement = HTMLElement>(sel: string, attrs?: Attrs | Child, ...kids: Child[]): T {
  const parts = sel.split('.');
  const el = document.createElement(parts[0] || 'div') as T;
  if (parts.length > 1) el.className = parts.slice(1).join(' ');
  if (isAttrs(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  } else if (attrs !== undefined) kids.unshift(attrs as Child);
  append(el, kids);
  return el;
}

/** Parses an SVG string into an element. */
export function svg(markup: string): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGSVGElement;
}

/** A text node whose value is only written when it changes. */
export class LiveText {
  readonly node = document.createTextNode('');
  private v = '';
  set(v: string): void {
    if (v !== this.v) { this.v = v; this.node.data = v; }
  }
}

/** Sets a class only when it changes. */
export function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function fmtTime(t: number, cs = true): string {
  if (!isFinite(t) || t <= 0) return cs ? '–:––.––' : '–:––';
  const m = Math.floor(t / 60), s = t - m * 60;
  const ss = Math.floor(s).toString().padStart(2, '0');
  if (!cs) return `${m}:${ss}`;
  const c = Math.floor((s - Math.floor(s)) * 100).toString().padStart(2, '0');
  return `${m}:${ss}.${c}`;
}

export function fmtDelta(d: number): string {
  const sign = d < 0 ? '−' : '+';
  return sign + Math.abs(d).toFixed(2);
}

/** Relative luminance 0..1 of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export const BASE = (import.meta as any).env?.BASE_URL ?? '/';

export function vibrate(on: boolean, pattern: number | number[]): void {
  if (on && 'vibrate' in navigator) { try { navigator.vibrate(pattern); } catch { /* unsupported */ } }
}
