// Focus navigation for keyboard, gamepad, mouse and touch. Elements opt in with `data-focus`.
import { audioBridge } from '../audio/bridge';

export type InputMode = 'kbd' | 'pad' | 'touch' | 'mouse';
export type Dir = 'up' | 'down' | 'left' | 'right';

let mode: InputMode = (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) ? 'touch' : 'kbd';
const modeListeners = new Set<(m: InputMode) => void>();
export function inputMode(): InputMode { return mode; }
export function onInputMode(fn: (m: InputMode) => void): () => void { modeListeners.add(fn); return () => modeListeners.delete(fn); }
function setMode(m: InputMode): void {
  if (m === mode) return;
  mode = m;
  for (const fn of modeListeners) fn(m);
}

const adjusters = new WeakMap<Element, (dir: -1 | 1) => void>();
/** Left/right on a focused element calls this instead of moving focus. */
export function onAdjust(el: Element, fn: (dir: -1 | 1) => void): void { adjusters.set(el, fn); }

export interface NavScope {
  root: HTMLElement;
  /** Back action (Esc / B). Return nothing. Omit to disable back. */
  back?: () => void;
  /** Whether Escape maps to back (false in the pause menu, where the game's own pause key toggles). */
  escBack?: boolean;
}

export class Nav {
  scope: NavScope | null = null;
  focused: HTMLElement | null = null;
  /** Gamepad / keyboard navigation active (false while racing). */
  enabled = true;
  /** Called for any confirm press while there is no focusable element (title screen). */
  anyKey: (() => void) | null = null;

  private prevButtons: boolean[] = [];
  private held: Dir | null = null;
  private repeatT = 0;
  private lastAxes = 0;

  constructor(private uiRoot: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    uiRoot.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        if (mode !== 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) setMode('mouse');
        if (mode !== 'mouse') return;
        const t = (e.target as HTMLElement).closest?.('[data-focus]') as HTMLElement | null;
        if (t && t !== this.focused && this.scope?.root.contains(t) && !t.hasAttribute('data-disabled')) this.focus(t, true);
      }
    });
    window.addEventListener('pointerdown', (e) => { setMode(e.pointerType === 'touch' ? 'touch' : 'mouse'); audioBridge.unlock(); }, true);
  }

  setScope(scope: NavScope | null, initial?: HTMLElement | null): void {
    this.scope = scope;
    this.blur();
    if (!scope) return;
    const first = initial ?? scope.root.querySelector<HTMLElement>('[data-focus]:not([data-disabled])');
    if (first) this.focus(first, false);
  }

  blur(): void {
    this.focused?.classList.remove('focus');
    this.focused = null;
  }

  focus(el: HTMLElement, sound = true): void {
    if (this.focused === el) return;
    this.focused?.classList.remove('focus');
    this.focused = el;
    el.classList.add('focus');
    el.dispatchEvent(new CustomEvent('tkfocus'));
    const sc = el.closest('.scroll, .col') as HTMLElement | null;
    if (sc && sc.scrollHeight > sc.clientHeight) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (sound) audioBridge.ui('move');
  }

  private candidates(): HTMLElement[] {
    if (!this.scope) return [];
    return [...this.scope.root.querySelectorAll<HTMLElement>('[data-focus]')].filter((e) => !e.hasAttribute('data-disabled') && e.offsetParent !== null);
  }

  move(dir: Dir): void {
    const f = this.focused;
    if (f && (dir === 'left' || dir === 'right')) {
      const adj = adjusters.get(f);
      if (adj) { adj(dir === 'left' ? -1 : 1); return; }
    }
    const list = this.candidates();
    if (!list.length) return;
    if (!f || !list.includes(f)) { this.focus(list[0]); return; }
    const r = f.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of list) {
      if (el === f) continue;
      const q = el.getBoundingClientRect();
      const qx = q.left + q.width / 2, qy = q.top + q.height / 2;
      const dx = qx - cx, dy = qy - cy;
      let main: number, side: number;
      if (dir === 'left') { if (q.right > r.left + 2 && dx > -4) continue; main = -dx; side = Math.abs(dy); }
      else if (dir === 'right') { if (q.left < r.right - 2 && dx < 4) continue; main = dx; side = Math.abs(dy); }
      else if (dir === 'up') { if (q.bottom > r.top + 2 && dy > -4) continue; main = -dy; side = Math.abs(dx); }
      else { if (q.top < r.bottom - 2 && dy < 4) continue; main = dy; side = Math.abs(dx); }
      if (main <= 0) continue;
      const score = main + side * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
  }

  confirm(): void {
    if (this.focused && this.scope?.root.contains(this.focused)) {
      this.focused.classList.add('press');
      const el = this.focused;
      setTimeout(() => el.classList.remove('press'), 120);
      el.click();
    } else this.anyKey?.();
  }

  back(): void {
    if (this.scope?.back) { audioBridge.ui('back'); this.scope.back(); }
  }

  private onKey(e: KeyboardEvent): void {
    audioBridge.unlock();
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) setMode('kbd');
    if (!this.enabled || !this.scope) return;
    const c = e.code;
    let handled = true;
    if (c === 'ArrowUp' || c === 'KeyW') this.move('up');
    else if (c === 'ArrowDown' || c === 'KeyS') this.move('down');
    else if (c === 'ArrowLeft' || c === 'KeyA') this.move('left');
    else if (c === 'ArrowRight' || c === 'KeyD') this.move('right');
    else if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') { if (!e.repeat) this.confirm(); }
    else if (c === 'Backspace' || (c === 'Escape' && this.scope.escBack !== false)) { if (!e.repeat) this.back(); }
    else if (this.anyKey && !e.repeat && c !== 'Escape' && c !== 'Tab') this.anyKey();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  /** Gamepad polling; call once per frame. Returns true if Start was pressed this frame. */
  pollPad(dt: number): { start: boolean } {
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return { start: false };
    const btn = (i: number) => !!pad!.buttons[i]?.pressed;
    const now: boolean[] = [];
    for (let i = 0; i < 17; i++) now[i] = btn(i);
    const edge = (i: number) => now[i] && !this.prevButtons[i];
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const axesActive = Math.abs(ax) > 0.5 || Math.abs(ay) > 0.5;
    if (now.some(Boolean) || (axesActive && this.lastAxes === 0)) { setMode('pad'); audioBridge.unlock(); }
    this.lastAxes = axesActive ? 1 : 0;

    let dir: Dir | null = null;
    if (now[12] || ay < -0.5) dir = 'up';
    else if (now[13] || ay > 0.5) dir = 'down';
    else if (now[14] || ax < -0.5) dir = 'left';
    else if (now[15] || ax > 0.5) dir = 'right';

    const start = edge(9);
    if (this.enabled && this.scope) {
      if (dir) {
        if (dir !== this.held) { this.held = dir; this.repeatT = 0.38; this.move(dir); }
        else { this.repeatT -= dt; if (this.repeatT <= 0) { this.repeatT = 0.11; this.move(dir); } }
      } else this.held = null;
      if (edge(0)) this.confirm();
      else if (edge(1)) this.back();
      else if (start && this.anyKey) this.anyKey();
    } else this.held = null;
    this.prevButtons = now;
    return { start };
  }
}
