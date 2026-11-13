// Grey-box race rules, AI and keyboard input. Owner: lead.
// Real versions: src/race/, src/ai/, src/input/.
import type { InputSource, InputState, KartController, SimSystem } from '../core/types';

/** Countdown, laps, ranking. Minimal but correct enough to finish a race. */
export function createStubRules(): SimSystem {
  let lastCount = 99;
  return {
    step(sim, dt) {
      sim.raceTime += dt;
      if (sim.phase === 'intro') { sim.phase = 'countdown'; sim.events.emit('race:phase', { phase: sim.phase }); }
      if (sim.phase === 'countdown') {
        const n = Math.ceil(-sim.raceTime);
        if (n !== lastCount && n >= 0) { lastCount = n; sim.events.emit('race:countdown', { n }); }
        if (sim.raceTime >= 0) { sim.phase = 'racing'; sim.events.emit('race:phase', { phase: sim.phase }); }
        return;
      }
      const L = sim.track.length;
      for (const k of sim.karts) {
        const r = k.race;
        if (r.finished) continue;
        if (r.lap === 0) { r.lap = 1; r.distance = k.loc.progress - L; continue; }
        const prev = ((r.distance % L) + L) % L;
        let d = k.loc.progress - prev;
        if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
        r.distance += d;
        const lap = Math.floor(r.distance / L) + 1;
        if (lap > r.lap) {
          r.lap = lap;
          const final = lap > sim.laps;
          sim.events.emit('race:lap', { kart: k, lap, lapTime: 0, final });
          if (final) {
            r.finished = true; r.finishTime = sim.raceTime;
            sim.events.emit('race:finish', { kart: k, rank: r.rank, time: r.finishTime });
          }
        }
      }
      const order = [...sim.karts].sort((a, b) => (a.race.finished !== b.race.finished ? (a.race.finished ? -1 : 1) : a.race.finished ? a.race.finishTime - b.race.finishTime : b.race.distance - a.race.distance));
      order.forEach((k, i) => (k.race.rank = i + 1));
      if (sim.phase === 'racing' && sim.player.race.finished) {
        sim.phase = 'finished';
        sim.events.emit('race:phase', { phase: sim.phase });
        sim.events.emit('race:over', { order });
      }
    },
  };
}

/** Follows the racing line. */
export function createStubAI(): KartController {
  const offset = Math.random() * 6 - 3;
  return {
    update(kart, sim) {
      const line = sim.track.racingLine(kart.loc.progress + 12);
      const target = sim.track.sample(kart.loc.progress + 12, line.lat + offset, kart.loc.path);
      const dx = target.pos.x - kart.pos.x, dz = target.pos.z - kart.pos.z;
      const want = Math.atan2(dx, dz);
      const fx = kart.vel.lengthSq() > 1 ? kart.vel.x : target.forward.x, fz = kart.vel.lengthSq() > 1 ? kart.vel.z : target.forward.z;
      let diff = want - Math.atan2(fx, fz);
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      kart.input.steer = Math.max(-1, Math.min(1, -diff * 3));
      kart.input.throttle = 0.9;
      kart.input.brake = 0;
    },
  };
}

export function createKeyboardInput(): InputSource {
  const keys = new Set<string>();
  let pause = false;
  const down = (e: KeyboardEvent) => { keys.add(e.code); if (e.code === 'Escape' || e.code === 'KeyP') pause = true; if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); };
  const up = (e: KeyboardEvent) => keys.delete(e.code);
  const blur = () => keys.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  const has = (...c: string[]) => c.some((k) => keys.has(k));
  return {
    poll(out: InputState) {
      out.throttle = has('KeyW', 'ArrowUp') ? 1 : 0;
      out.brake = has('KeyS', 'ArrowDown') ? 1 : 0;
      out.steer = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
      out.drift = has('Space', 'ShiftLeft', 'ShiftRight');
      out.item = has('KeyE', 'KeyX');
      out.itemAim = has('KeyS', 'ArrowDown') ? -1 : 0;
      out.lookBack = has('KeyQ');
      return keys.size > 0;
    },
    consumePause() { const p = pause; pause = false; return p; },
    dispose() { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); },
  };
}
