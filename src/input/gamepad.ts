// Gamepad input (standard mapping) and rumble. Owner: physics (input).
// Stick / d-pad steer, A or RT throttle, B or LT brake, RB or X drift, LB or Y item,
// R3 or Back look back, Start pause. Stick up/down aims the item.
import type { App, InputSource, InputState } from '../core/types';

const DEAD = 0.16;
const TRIGGER_DEAD = 0.08;

/** Standard-mapping button indices. */
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a < dz) return 0;
  return Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
}

let lastPad: Gamepad | null = null;

export function createGamepadInput(): InputSource {
  let pausePrev = false;
  let pause = false;
  let dpadSteer = 0;
  let last = 0;
  const pads = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []);

  return {
    poll(out: InputState): boolean {
      const now = performance.now();
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
      last = now;
      let pad: Gamepad | null = null;
      for (const p of pads()) if (p && p.connected) { pad = p; break; }
      lastPad = pad;
      if (!pad) return false;
      const b = (i: number) => pad!.buttons[i];
      const pressed = (i: number) => !!b(i)?.pressed;
      const value = (i: number) => b(i)?.value ?? 0;

      const start = pressed(BTN.START);
      if (start && !pausePrev) pause = true;
      pausePrev = start;

      // Stick: dead zone, then a mild curve for fine control around the centre.
      const sx = deadzone(pad.axes[0] ?? 0, DEAD);
      const sy = deadzone(pad.axes[1] ?? 0, 0.5);
      const stick = Math.sign(sx) * Math.pow(Math.abs(sx), 1.35);
      // D-pad: digital, smoothed like the keyboard.
      const dTarget = (pressed(BTN.RIGHT) ? 1 : 0) - (pressed(BTN.LEFT) ? 1 : 0);
      if (dTarget === 0) dpadSteer = Math.sign(dpadSteer) * Math.max(0, Math.abs(dpadSteer) - 9 * dt);
      else dpadSteer = Math.sign(dpadSteer) !== dTarget && dpadSteer !== 0 ? dpadSteer + dTarget * 14 * dt : dTarget * Math.min(1, Math.abs(dpadSteer) + 5.5 * dt);
      const steer = Math.max(-1, Math.min(1, Math.abs(stick) > Math.abs(dpadSteer) ? stick : dpadSteer));

      const rt = value(BTN.RT), lt = value(BTN.LT);
      const throttle = Math.max(pressed(BTN.A) ? 1 : 0, rt > TRIGGER_DEAD ? rt : 0);
      const brake = Math.max(pressed(BTN.B) ? 1 : 0, lt > TRIGGER_DEAD ? lt : 0);
      out.throttle = throttle;
      out.brake = brake;
      out.steer = steer;
      out.drift = pressed(BTN.RB) || pressed(BTN.X);
      out.item = pressed(BTN.LB) || pressed(BTN.Y);
      out.itemAim = sy > 0 || pressed(BTN.DOWN) ? -1 : sy < 0 || pressed(BTN.UP) ? 1 : 0;
      out.lookBack = pressed(BTN.R3) || pressed(BTN.BACK);

      return throttle > 0 || brake > 0 || steer !== 0 || out.drift || out.item || out.lookBack || out.itemAim !== 0;
    },
    consumePause() { const p = pause; pause = false; return p; },
  };
}

/**
 * Rumbles the most recently used gamepad. `strong` and `weak` are 0..1 motor strengths.
 * Silently does nothing without a pad or haptics support.
 */
export function rumble(strong: number, weak: number, ms: number): void {
  const pad = lastPad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null;
  const act = pad?.vibrationActuator;
  if (!act?.playEffect) return;
  act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
}

/**
 * Wires gamepad rumble to the player's race events (hits, boosts, landings, collisions),
 * respecting `app.settings.vibration`. Call once after the app exists; returns an unsubscribe.
 */
export function connectRumble(app: App): () => void {
  const ev = app.events;
  const ok = (k: { isHuman: boolean }) => k.isHuman && app.settings.vibration;
  const offs = [
    ev.on('kart:hit', ({ kart, absorbed }) => { if (ok(kart) && !absorbed) rumble(0.9, 0.6, 380); }),
    ev.on('kart:boost', ({ kart, duration }) => { if (ok(kart)) rumble(0.15, 0.6, Math.min(400, duration * 300)); }),
    ev.on('kart:land', ({ kart, impact }) => { if (ok(kart) && impact > 4) rumble(Math.min(1, impact / 16), 0.3, 120); }),
    ev.on('kart:collide', ({ kart, impulse }) => { if (ok(kart)) rumble(Math.min(1, impulse / 3000), 0.4, 110); }),
    ev.on('kart:driftLevel', ({ kart }) => { if (ok(kart)) rumble(0, 0.35, 80); }),
  ];
  return () => { for (const o of offs) o(); };
}
