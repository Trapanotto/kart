// Eingabe: Tastatur, Gamepads, Touch
const SOLO = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftLeft', 'ShiftRight'], item: ['KeyE', 'KeyX', 'ControlLeft', 'KeyQ'],
};
const MULTI = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drift: ['Space'], item: ['KeyE'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['ShiftRight'], item: ['Enter', 'ControlRight'] },
];

export const CONTROLS_HELP = {
  solo: [['Gas', 'W / ↑'], ['Bremsen / Rückwärts', 'S / ↓'], ['Lenken', 'A D / ← →'], ['Springen + Driften', 'Leertaste / Shift'],
    ['Item benutzen', 'E / X  (mit S/↓ nach hinten)'], ['Pause', 'Esc / P']],
  multi: [['Spieler 1', 'WASD · Drift: Leertaste · Item: E'], ['Spieler 2', 'Pfeiltasten · Drift: Shift rechts · Item: Enter'],
    ['Spieler 3 + 4', 'Gamepad'], ['Gamepad', 'A/RT Gas · B/LT Bremse · RB/X Drift · LB/Y Item · Start Pause']],
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, brake: 0, drift: false, item: false };
    this.touchActive = false;
    this.pausePressed = false;
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) this.pausePressed = true;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrevStart = [];
  }

  any(list) { return list.some((c) => this.keys.has(c)); }

  pads() {
    return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
  }

  // Liest die Eingabe für Spieler pi (von n Spielern)
  read(pi, n, out) {
    out.throttle = 0; out.brake = 0; out.steer = 0; out.drift = false; out.item = false; out.back = false;
    const map = n === 1 ? SOLO : MULTI[pi];
    if (map) {
      if (this.any(map.up)) out.throttle = 1;
      if (this.any(map.down)) out.brake = 1;
      if (this.any(map.left)) out.steer -= 1;
      if (this.any(map.right)) out.steer += 1;
      if (this.any(map.drift)) out.drift = true;
      if (this.any(map.item)) out.item = true;
    }
    const pads = this.pads();
    const pad = n === 1 ? pads[0] : this.padFor(pi, n, pads);
    if (pad) {
      const b = (i) => pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5);
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.15) out.steer += ax;
      if (b(14)) out.steer -= 1;
      if (b(15)) out.steer += 1;
      if (b(0) || b(7)) out.throttle = Math.max(out.throttle, b(7) ? pad.buttons[7].value || 1 : 1);
      if (b(1) || b(6)) out.brake = 1;
      if (b(5) || b(2)) out.drift = true;
      if (b(4) || b(3)) out.item = true;
      if ((pad.axes[1] || 0) > 0.5) out.back = true;
      const st = b(9);
      if (st && !this.padPrevStart[pad.index]) this.pausePressed = true;
      this.padPrevStart[pad.index] = st;
    }
    if (pi === 0 && this.touchActive) {
      out.steer += this.touch.steer;
      out.throttle = Math.max(out.throttle, this.touch.throttle);
      out.brake = Math.max(out.brake, this.touch.brake);
      out.drift = out.drift || this.touch.drift;
      out.item = out.item || this.touch.item;
    }
    if (out.brake > 0 && map && n === 1) out.back = true;
    else if (map && this.any(map.down)) out.back = true;
    out.steer = Math.max(-1, Math.min(1, out.steer));
    return out;
  }

  // Spieler 1+2 nutzen Tastatur; Gamepads werden der Reihe nach verteilt
  padFor(pi, n, pads) {
    if (pads.length >= n) return pads[pi];
    // weniger Pads als Spieler: Pads gehen an die letzten Spieler
    const first = n - pads.length;
    return pi >= first ? pads[pi - first] : null;
  }

  consumePause() {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }

  setupTouch(el) {
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
    this.touchActive = true;
    el.innerHTML = `
      <div class="tc-left"><button data-k="left">◀</button><button data-k="right">▶</button></div>
      <div class="tc-right"><button data-k="item" class="small">🎁</button><button data-k="drift">Drift</button><button data-k="brake" class="small">⏬</button></div>`;
    const state = {};
    const sync = () => {
      this.touch.steer = (state.right ? 1 : 0) - (state.left ? 1 : 0);
      this.touch.drift = !!state.drift;
      this.touch.item = !!state.item;
      this.touch.brake = state.brake ? 1 : 0;
      this.touch.throttle = state.brake ? 0 : 1; // Auto-Gas
    };
    for (const b of el.querySelectorAll('button')) {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); state[k] = true; b.classList.add('on'); sync(); };
      const off = (e) => { e.preventDefault(); state[k] = false; b.classList.remove('on'); sync(); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
    }
    sync();
  }
}
