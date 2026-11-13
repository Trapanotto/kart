// Keyboard input with smoothed digital steering. Owner: physics (input).
// W/A/S/D or arrows drive, Space/Shift drift, E/X item, Q look back, S/Down while using an item
// aims backwards, Esc/P pause.
import type { InputSource, InputState } from '../core/types';

export interface KeyboardOptions {
  /** Steering ramp-up speed (1/s) and return-to-centre speed (1/s). */
  steerRise?: number;
  steerFall?: number;
  target?: Window;
}

export function createKeyboardInput(opts: KeyboardOptions = {}): InputSource {
  const rise = opts.steerRise ?? 5.5, fall = opts.steerFall ?? 9;
  const win = opts.target ?? window;
  const keys = new Set<string>();
  let pause = false;
  let steer = 0;
  let last = 0;

  const isTyping = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const down = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) pause = true;
    keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();
  win.addEventListener('keydown', down);
  win.addEventListener('keyup', up);
  win.addEventListener('blur', blur);
  const has = (a: string, b?: string) => keys.has(a) || (b !== undefined && keys.has(b));

  return {
    poll(out: InputState): boolean {
      const now = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      const right = has('KeyD', 'ArrowRight'), left = has('KeyA', 'ArrowLeft');
      const target = (right ? 1 : 0) - (left ? 1 : 0);
      // Smoothed digital steering: ramps in, snaps back faster, reverses through zero quickly.
      if (target === 0) steer = Math.sign(steer) * Math.max(0, Math.abs(steer) - fall * dt);
      else if (Math.sign(steer) !== target && steer !== 0) steer = Math.sign(steer) * Math.max(0, Math.abs(steer) - fall * 1.5 * dt);
      else steer = target * Math.min(1, Math.abs(steer) + rise * dt);
      const back = has('KeyS', 'ArrowDown');
      out.throttle = has('KeyW', 'ArrowUp') ? 1 : 0;
      out.brake = back ? 1 : 0;
      out.steer = steer;
      out.drift = has('Space') || has('ShiftLeft', 'ShiftRight');
      out.item = has('KeyE', 'KeyX');
      out.itemAim = back ? -1 : has('KeyW', 'ArrowUp') && out.item ? 1 : 0;
      out.lookBack = has('KeyQ');
      return keys.size > 0 || steer !== 0;
    },
    consumePause() { const p = pause; pause = false; return p; },
    dispose() {
      win.removeEventListener('keydown', down);
      win.removeEventListener('keyup', up);
      win.removeEventListener('blur', blur);
    },
  };
}
