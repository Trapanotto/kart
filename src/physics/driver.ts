// Simple line-following controller for tests, the sandbox and demos. Owner: physics.
// Deterministic (no Math.random). Not the race AI (that is gameplay's src/ai/).
import { Vector3 } from 'three';
import type { Kart, KartController, RaceSim, TrackFrame } from '../core/types';

export interface LineDriverOptions {
  /** Sideways offset from the centre line (m), positive = right. */
  lat?: number;
  throttle?: number;
  /** Steering gain. */
  gain?: number;
  /** Drift through turns whose heading change over the next 25 m exceeds this (rad). 0 = never. */
  driftTurn?: number;
  /** Brake when the turn ahead exceeds this heading change at speed (rad). 0 = never. */
  brakeTurn?: number;
}

const mk = (): TrackFrame => ({ pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 8 });
const _f = mk(), _a = mk(), _b = mk();
const _fw = new Vector3();

/** Heading change (rad, positive = left) of the road between two progress values. */
function turnBetween(sim: RaceSim, p0: number, p1: number, path: number): number {
  const a = sim.track.sample(p0, 0, path, _a).forward, b = sim.track.sample(p1, 0, path, _b).forward;
  return Math.atan2(a.z * b.x - a.x * b.z, a.x * b.x + a.z * b.z);
}

export function createLineDriver(opts: LineDriverOptions = {}): KartController & { opts: Required<LineDriverOptions> } {
  const o: Required<LineDriverOptions> = { lat: 0, throttle: 1, gain: 2.6, driftTurn: 0, brakeTurn: 0, ...opts };
  let pressT = 0;
  return {
    opts: o,
    update(kart: Kart, sim: RaceSim, dt: number) {
      const loc = kart.loc;
      const look = Math.max(6, Math.abs(kart.speed) * 0.4);
      const turnAhead = turnBetween(sim, loc.progress + 4, loc.progress + 30, loc.path);
      // Aim at the inside of upcoming turns.
      const lat = o.lat;
      const t = sim.track.sample(loc.progress + look, lat, loc.path, _f);
      const dx = t.pos.x - kart.pos.x, dz = t.pos.z - kart.pos.z;
      // Use the velocity heading while drifting (the nose points into the turn).
      if (kart.drift.active && kart.vel.lengthSq() > 4) _fw.copy(kart.vel); else _fw.set(0, 0, 1).applyQuaternion(kart.quat);
      const cross = _fw.z * dx - _fw.x * dz, dot = _fw.x * dx + _fw.z * dz;
      const angle = Math.atan2(cross, dot); // positive = target on the left
      let steer = Math.max(-1, Math.min(1, -angle * o.gain));
      kart.input.throttle = o.throttle;
      kart.input.brake = 0;
      if (o.brakeTurn > 0 && Math.abs(turnAhead) > o.brakeTurn && kart.speed > 18) { kart.input.throttle = 0; kart.input.brake = 0.6; }

      if (o.driftTurn > 0) {
        const want = Math.abs(turnAhead) > o.driftTurn && kart.speed > 14;
        if (kart.drift.active) {
          // Inside / outside steering keeps the arc on the line.
          const d = kart.drift.dir;
          steer = Math.max(-1, Math.min(1, d * Math.max(-1, Math.min(1, -angle * d * 4 + 0.1))));
          kart.input.drift = Math.abs(turnAhead) > o.driftTurn * 0.35 || kart.drift.level === 0 && Math.abs(turnAhead) > 0.1;
        } else if (want) {
          pressT += dt;
          // Press, steer into the turn; re-press if the hop did not turn into a drift.
          kart.input.drift = pressT < 0.6;
          if (pressT > 0.7) pressT = 0;
          steer = turnAhead > 0 ? -1 : 1;
        } else {
          pressT = 0;
          kart.input.drift = false;
        }
      }
      kart.input.steer = steer;
    },
  };
}
