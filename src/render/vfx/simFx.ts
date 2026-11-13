// Per-race effects driven by sim events and kart state. Owner: render.
// Reads kart.renderPos / renderQuat / wheels[] only; never writes sim state.
import { Vector3, type PerspectiveCamera } from 'three/webgpu';
import type { Kart, RaceSim, SurfaceType } from '../../core/types';
import { DRIFT_COLORS, type Effects } from './effects';
import { Shape } from './particles';
import type { SkidMarks } from './skids';

const rnd = Math.random;
const range = (a: number, b: number) => a + (b - a) * rnd();

interface WheelTrack {
  active: boolean;
  lx: number; ly: number; lz: number; // last left edge
  rx: number; ry: number; rz: number; // last right edge
  cx: number; cy: number; cz: number; // last centre
  strength: number;
}

interface KartFx {
  acc: Float32Array; // emission accumulators
  tracks: [WheelTrack, WheelTrack];
  lastBoost: number;
}

const newTrack = (): WheelTrack => ({ active: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, cx: 0, cy: 0, cz: 0, strength: 0 });

// Accumulator slots
const A_DRIFT = 0, A_FLAME = 1, A_SURF = 2, A_SMOKE = 3, A_SLIP = 4, A_STREAK = 5;

const fwd = new Vector3(), left = new Vector3(), up = new Vector3(), tmp = new Vector3(), tmp2 = new Vector3();
const rear: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const camPos = new Vector3();

export interface SimFx {
  update(dt: number, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function bindSimFx(sim: RaceSim, fx: Effects, skids: SkidMarks, onPlayerHit: () => void): SimFx {
  const state = new Map<Kart, KartFx>();
  const get = (k: Kart): KartFx => {
    let s = state.get(k);
    if (!s) { s = { acc: new Float32Array(8), tracks: [newTrack(), newTrack()], lastBoost: 0 }; state.set(k, s); }
    return s;
  };

  const basis = (k: Kart) => {
    fwd.set(0, 0, 1).applyQuaternion(k.renderQuat);
    left.set(1, 0, 0).applyQuaternion(k.renderQuat);
    up.set(0, 1, 0).applyQuaternion(k.renderQuat);
  };

  /** Rear wheel contact points on the ground (falls back to kart geometry if wheels are not simulated). */
  const rearWheels = (k: Kart) => {
    let n = 0;
    const ws = k.wheels;
    if (ws && ws.length >= 4) {
      for (let i = 0; i < ws.length && n < 2; i++) {
        const w = ws[i];
        tmp.copy(w.pos).sub(k.pos);
        if (tmp.lengthSq() > 9 || tmp.lengthSq() < 1e-6) continue;
        if (tmp.dot(fwd) >= 0) continue;
        rear[n++].copy(tmp).add(k.renderPos);
      }
    }
    if (n < 2) {
      rear[0].copy(k.renderPos).addScaledVector(left, 0.55).addScaledVector(fwd, -0.65);
      rear[1].copy(k.renderPos).addScaledVector(left, -0.55).addScaledVector(fwd, -0.65);
    }
    // Project to the kart's base plane (ground contact).
    for (const p of rear) {
      tmp.copy(p).sub(k.renderPos);
      p.addScaledVector(up, -tmp.dot(up) + 0.03);
    }
  };

  const wsOut: { grounded: boolean; surface: SurfaceType; slip: number } = { grounded: false, surface: 'road', slip: 0 };
  const wheelSurface = (k: Kart, side: number) => {
    const ws = k.wheels;
    if (ws && ws.length >= 4) {
      const w = ws[2 + side];
      wsOut.grounded = w.grounded && k.grounded; wsOut.surface = w.surface ?? k.surface; wsOut.slip = w.slip ?? 0;
    } else { wsOut.grounded = k.grounded; wsOut.surface = k.surface; wsOut.slip = 0; }
    return wsOut;
  };

  const emitRate = (s: KartFx, slot: number, rate: number, dt: number): number => {
    s.acc[slot] += rate * dt * fx.density;
    const n = Math.floor(s.acc[slot]);
    s.acc[slot] -= n;
    return n;
  };

  const kartSpawn = (k: Kart, name: string, yOff = 0.6, scale = 1) => {
    tmp2.copy(k.renderPos).addScaledVector(up.set(0, 1, 0).applyQuaternion(k.renderQuat), yOff);
    fx.spawn(name, tmp2, { scale });
  };

  const exhaust = (k: Kart, out: Vector3, side: number) => {
    basis(k);
    out.copy(k.renderPos).addScaledVector(fwd, -1.05).addScaledVector(left, side * 0.32).addScaledVector(up, 0.45);
  };

  const flameBurst = (k: Kart, count: number, power: number) => {
    for (let side = -1; side <= 1; side += 2) {
      exhaust(k, tmp2, side);
      for (let i = 0; i < count; i++) {
        const s = fx.spec(tmp2.x, tmp2.y, tmp2.z);
        const v = range(4, 8) * power;
        s.vx = -fwd.x * v + range(-1.5, 1.5); s.vy = range(0.5, 2.5); s.vz = -fwd.z * v + range(-1.5, 1.5);
        s.life = range(0.25, 0.45); s.r = 3.6; s.g = 1.7; s.b = 0.45; s.shape = Shape.Glow;
        s.size0 = 0.7 * power; s.size1 = 0.2; s.drag = 3; s.gravity = -2;
        fx.glow.emit(s);
      }
    }
  };

  const unsub = [
    sim.events.on('kart:driftLevel', ({ kart, level }) => {
      basis(kart); rearWheels(kart);
      const c = DRIFT_COLORS[Math.max(0, Math.min(3, level))];
      for (const p of rear) {
        for (let i = 0; i < fx.n(10); i++) {
          const s = fx.spec(p.x, p.y + 0.1, p.z);
          s.vx = range(-3, 3); s.vy = range(2, 5); s.vz = range(-3, 3);
          s.life = range(0.3, 0.5); s.r = c[0]; s.g = c[1]; s.b = c[2]; s.shape = Shape.Star;
          s.size0 = 0.32; s.size1 = 0.05; s.gravity = 6; s.drag = 2; s.spin = 6;
          fx.glow.emit(s);
        }
      }
    }),
    sim.events.on('kart:driftEnd', ({ kart, level }) => { if (level > 0) flameBurst(kart, fx.n(6 + level * 3), 0.9 + level * 0.15); }),
    sim.events.on('kart:boost', ({ kart, power }) => { flameBurst(kart, fx.n(8), Math.max(1, power)); }),
    sim.events.on('kart:startBoost', ({ kart, quality }) => {
      if (quality > 0) { flameBurst(kart, fx.n(10), 1.2); basis(kart); rearWheels(kart); fx.dust(rear[0].x, rear[0].y, rear[0].z, 1, '#e8dcc4'); fx.dust(rear[1].x, rear[1].y, rear[1].z, 1, '#e8dcc4'); }
      else kartSpawn(kart, 'smoke', 0.6, 0.8);
    }),
    sim.events.on('kart:land', ({ kart, impact, airTime }) => {
      const sc = Math.min(1.6, 0.5 + airTime * 0.8 + impact * 0.05);
      const p = kart.renderPos;
      if (kart.surface === 'water') fx.splash(p.x, p.y, p.z, sc);
      else if (kart.surface === 'offroad') { fx.puffRing(p.x, p.y, p.z, sc, 12, '#cbbf94', 0.7); fx.leaves(p.x, p.y, p.z, sc * 0.4); }
      else if (kart.surface === 'ice') fx.puffRing(p.x, p.y, p.z, sc, 14, '#ffffff', 0.85);
      else fx.puffRing(p.x, p.y, p.z, sc, 12, '#e4ddd0', 0.7);
    }),
    sim.events.on('kart:collide', ({ kart, other, impulse, point }) => {
      if (impulse < 0.5) return;
      const sc = Math.min(1.5, 0.4 + impulse * 0.05);
      tmp.copy(point);
      if (other) tmp2.copy(kart.renderPos).sub(other.renderPos).normalize(); else tmp2.copy(kart.renderPos).sub(point).normalize();
      tmp2.y = Math.max(tmp2.y, 0.4);
      fx.spawn('sparks', tmp, { dir: tmp2, scale: sc });
    }),
    sim.events.on('kart:hit', ({ kart, kind, absorbed }) => {
      if (absorbed) { kartSpawn(kart, 'shield.pop', 0, 1); return; }
      if (kind === 'zap') kartSpawn(kart, 'zap', 0, 1);
      else if (kind === 'squash') kartSpawn(kart, 'dust', 0.1, 1.4);
      else kartSpawn(kart, 'burst', 0.7, 0.8);
      kartSpawn(kart, 'stars', 0.3, 1);
      if (kart.isHuman) onPlayerHit();
    }),
    sim.events.on('kart:respawn', ({ kart }) => kartSpawn(kart, 'respawn', 0, 1)),
    sim.events.on('kart:trick', ({ kart }) => {
      const p = kart.renderPos;
      for (let i = 0; i < fx.n(10); i++) {
        const s = fx.spec(p.x, p.y + 1, p.z);
        s.vx = range(-3, 3); s.vy = range(1, 4); s.vz = range(-3, 3);
        s.life = range(0.4, 0.7); s.r = 3; s.g = 2.6; s.b = 1; s.shape = Shape.Star; s.size0 = 0.35; s.size1 = 0.05; s.drag = 2; s.spin = 5;
        fx.glow.emit(s);
      }
    }),
    sim.events.on('item:box', ({ kart }) => kartSpawn(kart, 'pickup', 0.8, 1)),
    sim.events.on('fx', ({ name, pos, dir, color, scale }) => fx.spawn(name, pos, { dir, color, scale })),
  ];

  const SKID_SEG = 0.3;

  function updateSkids(k: Kart, s: KartFx, skidding: boolean[]) {
    for (let side = 0; side < 2; side++) {
      const tr = s.tracks[side];
      const p = rear[side];
      const want = skidding[side];
      if (!want) { tr.active = false; continue; }
      // Edges of the mark: across the kart's left axis.
      const hw = 0.13;
      const lx = p.x + left.x * hw, ly = p.y + left.y * hw, lz = p.z + left.z * hw;
      const rx = p.x - left.x * hw, ry = p.y - left.y * hw, rz = p.z - left.z * hw;
      const str = Math.min(1, 0.5 + (k.drift.active ? 0.5 : 0));
      if (!tr.active) {
        tr.active = true;
        tr.lx = lx; tr.ly = ly; tr.lz = lz; tr.rx = rx; tr.ry = ry; tr.rz = rz; tr.cx = p.x; tr.cy = p.y; tr.cz = p.z; tr.strength = 0;
        continue;
      }
      const dx = p.x - tr.cx, dz = p.z - tr.cz, dy = p.y - tr.cy;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 25) { tr.active = false; continue; } // teleport / respawn
      if (d2 < SKID_SEG * SKID_SEG) continue;
      skids.add(tr.lx, tr.ly, tr.lz, tr.rx, tr.ry, tr.rz, lx, ly, lz, rx, ry, rz, tr.strength, str);
      tr.lx = lx; tr.ly = ly; tr.lz = lz; tr.rx = rx; tr.ry = ry; tr.rz = rz; tr.cx = p.x; tr.cy = p.y; tr.cz = p.z; tr.strength = str;
    }
  }

  const skidFlags = [false, false];

  return {
    update(dt, camera) {
      if (dt <= 0) return;
      camPos.copy(camera.position);
      for (const k of sim.karts) {
        const s = get(k);
        const dist = k.renderPos.distanceTo(camPos);
        const lod = dist < 45 ? 1 : dist < 100 ? 0.4 : 0;
        basis(k);
        rearWheels(k);
        const speed = Math.abs(k.speed);
        const sNorm = Math.min(1.2, speed / 29);

        // ---- drift sparks
        if (k.drift.active && k.grounded && lod > 0) {
          const c = DRIFT_COLORS[k.drift.level];
          const rate = (k.drift.level > 0 ? 70 : 25) * lod;
          const n = emitRate(s, A_DRIFT, rate, dt);
          for (let i = 0; i < n; i++) {
            const p = rear[i & 1];
            const sp = fx.spec(p.x, p.y + 0.05, p.z);
            const out = k.drift.dir * (i & 1 ? -1 : 1) >= 0 ? 1 : 0.4;
            const v = range(3, 7);
            sp.vx = -fwd.x * v + left.x * range(-2, 2) * out + k.vel.x * 0.4;
            sp.vy = range(1.5, 4.5);
            sp.vz = -fwd.z * v + left.z * range(-2, 2) * out + k.vel.z * 0.4;
            sp.life = range(0.18, 0.4); sp.r = c[0]; sp.g = c[1]; sp.b = c[2];
            sp.shape = Shape.Spark; sp.size0 = k.drift.level > 0 ? 0.14 : 0.09; sp.size1 = 0.03; sp.gravity = 14; sp.drag = 2; sp.stretch = 2.5;
            fx.glow.emit(sp);
          }
          if (k.drift.level > 0 && rnd() < dt * 20 * lod) {
            // Little glow at the contact point.
            const p = rear[(rnd() * 2) | 0];
            const sp = fx.spec(p.x, p.y + 0.15, p.z);
            sp.life = 0.08; sp.r = c[0]; sp.g = c[1]; sp.b = c[2]; sp.shape = Shape.Glow; sp.size0 = 0.7; sp.size1 = 0.5;
            fx.glow.emit(sp);
          }
        } else s.acc[A_DRIFT] = 0;

        // ---- boost flames + streaks
        if (k.boost.time > 0 && lod > 0) {
          const n = emitRate(s, A_FLAME, 90 * lod, dt);
          for (let i = 0; i < n; i++) {
            exhaust(k, tmp2, i & 1 ? 1 : -1);
            const sp = fx.spec(tmp2.x, tmp2.y, tmp2.z);
            const v = range(3, 6);
            sp.vx = k.vel.x * 0.85 - fwd.x * v + range(-0.5, 0.5);
            sp.vy = k.vel.y * 0.85 + range(0.2, 1.2);
            sp.vz = k.vel.z * 0.85 - fwd.z * v + range(-0.5, 0.5);
            const hot = rnd();
            sp.life = range(0.1, 0.18); sp.r = 2.6; sp.g = 1.0 + hot * 1.0; sp.b = 0.25 + hot * 0.4; sp.shape = Shape.Glow;
            sp.size0 = range(0.28, 0.42); sp.size1 = 0.08; sp.drag = 4;
            fx.glow.emit(sp);
          }
          if (k.isHuman) {
            const ns = emitRate(s, A_STREAK, 30, dt);
            for (let i = 0; i < ns; i++) {
              const a = rnd() * 6.283, r = range(1.8, 4);
              tmp2.copy(k.renderPos).addScaledVector(fwd, range(4, 14)).addScaledVector(left, Math.cos(a) * r).addScaledVector(up, 0.8 + Math.sin(a) * r * 0.6);
              const sp = fx.spec(tmp2.x, tmp2.y, tmp2.z);
              sp.vx = k.vel.x * 0.4 - fwd.x * 10; sp.vy = 0; sp.vz = k.vel.z * 0.4 - fwd.z * 10;
              sp.life = range(0.2, 0.35); sp.r = 1.2; sp.g = 1.3; sp.b = 1.5; sp.shape = Shape.Spark;
              sp.size0 = 0.06; sp.size1 = 0.04; sp.stretch = 6; sp.opacity = 0.6;
              fx.glow.emit(sp);
            }
          }
        }
        if (k.boost.time > 0 && s.lastBoost <= 0 && lod > 0) flameBurst(k, fx.n(4), 1);
        s.lastBoost = k.boost.time;

        // ---- surface dust / grass / spray / snow / smoke + skid marks
        skidFlags[0] = skidFlags[1] = false;
        if (speed > 4 && lod > 0) {
          for (let side = 0; side < 2; side++) {
            const w = wheelSurface(k, side);
            if (!w.grounded) continue;
            const p = rear[side];
            const slip = Math.max(w.slip, k.drift.active ? 0.6 : 0);
            switch (w.surface) {
              case 'offroad': {
                const n = emitRate(s, A_SURF, 22 * sNorm * lod, dt);
                for (let i = 0; i < n; i++) {
                  const sp = fx.spec(p.x, p.y + 0.05, p.z);
                  sp.vx = -fwd.x * range(1, 3) + range(-1.5, 1.5); sp.vy = range(2, 4.5); sp.vz = -fwd.z * range(1, 3) + range(-1.5, 1.5);
                  const g = range(0.3, 0.6);
                  sp.life = range(0.4, 0.7); sp.r = g * 0.55; sp.g = g; sp.b = g * 0.2; sp.shape = Shape.Blade;
                  sp.size0 = 0.22; sp.size1 = 0.2; sp.gravity = 12; sp.drag = 1; sp.spin = range(-12, 12);
                  fx.soft.emit(sp);
                }
                if (rnd() < dt * 8 * sNorm * lod) dustPuff(p, '#c9b98d', 0.6);
                break;
              }
              case 'sand': {
                if (rnd() < dt * 18 * sNorm * lod * fx.density) dustPuff(p, '#e2cf9f', 0.75);
                break;
              }
              case 'water': {
                const n = emitRate(s, A_SURF, 40 * sNorm * lod, dt);
                for (let i = 0; i < n; i++) {
                  const sp = fx.spec(p.x, p.y + 0.05, p.z);
                  const sideOut = side === 0 ? 1 : -1;
                  sp.vx = left.x * sideOut * range(2, 4) - fwd.x * range(0, 2) + k.vel.x * 0.3; sp.vy = range(2.5, 5);
                  sp.vz = left.z * sideOut * range(2, 4) - fwd.z * range(0, 2) + k.vel.z * 0.3;
                  sp.life = range(0.4, 0.7); sp.r = 0.8; sp.g = 0.92; sp.b = 1; sp.shape = Shape.Drop;
                  sp.size0 = 0.14; sp.size1 = 0.09; sp.gravity = 14; sp.stretch = 1.4; sp.opacity = 0.8;
                  fx.soft.emit(sp);
                }
                if (rnd() < dt * 10 * lod) dustPuff(p, '#eef8ff', 0.5);
                break;
              }
              case 'ice': {
                if (rnd() < dt * 16 * sNorm * lod * fx.density) dustPuff(p, '#ffffff', 0.8);
                skidFlags[side] = slip > 0.3;
                break;
              }
              case 'sticky': {
                if (rnd() < dt * 8 * lod) {
                  const sp = fx.spec(p.x, p.y + 0.05, p.z);
                  sp.vx = range(-1, 1); sp.vy = range(1.5, 3); sp.vz = range(-1, 1);
                  sp.life = 0.6; sp.r = 1; sp.g = 0.55; sp.b = 0.06; sp.shape = Shape.Drop; sp.size0 = 0.18; sp.size1 = 0.1; sp.gravity = 12; sp.stretch = 0.6;
                  fx.soft.emit(sp);
                }
                break;
              }
              case 'road':
              case 'boost':
              default: {
                if (slip > 0.35) {
                  const n = emitRate(s, A_SMOKE, 14 * slip * lod, dt);
                  for (let i = 0; i < n; i++) dustPuff(p, '#eeeeee', 0.45 * slip);
                  skidFlags[side] = true;
                }
              }
            }
          }
        }
        updateSkids(k, s, skidFlags);

        // ---- slipstream wind streaks
        if (k.slipstream > 0.15 && lod > 0.5) {
          const n = emitRate(s, A_SLIP, 40 * k.slipstream, dt);
          for (let i = 0; i < n; i++) {
            const a = rnd() * 6.283, r = range(0.9, 1.8);
            tmp2.copy(k.renderPos).addScaledVector(fwd, range(1, 4)).addScaledVector(left, Math.cos(a) * r).addScaledVector(up, 0.7 + Math.sin(a) * r * 0.7);
            const sp = fx.spec(tmp2.x, tmp2.y, tmp2.z);
            sp.vx = k.vel.x * 0.8 - fwd.x * 6; sp.vy = k.vel.y * 0.8; sp.vz = k.vel.z * 0.8 - fwd.z * 6;
            sp.life = range(0.25, 0.4); sp.r = 0.9; sp.g = 1.0; sp.b = 1.2; sp.shape = Shape.Spark; sp.size0 = 0.05; sp.size1 = 0.03;
            sp.stretch = 5; sp.opacity = 0.35 + 0.4 * k.slipstream;
            fx.glow.emit(sp);
          }
        }
      }
    },
    dispose() { for (const u of unsub) u(); state.clear(); },
  };

  function dustPuff(p: Vector3, color: string, opacity: number) {
    const c = fx.color(color, color);
    const sp = fx.spec(p.x + range(-0.15, 0.15), p.y + 0.15, p.z + range(-0.15, 0.15));
    sp.vx = -fwd.x * range(0.5, 2) + range(-0.6, 0.6); sp.vy = range(0.4, 1.4); sp.vz = -fwd.z * range(0.5, 2) + range(-0.6, 0.6);
    sp.life = range(0.7, 1.3); sp.r = c.r; sp.g = c.g; sp.b = c.b;
    sp.size0 = 0.35; sp.size1 = range(1.3, 2.0); sp.drag = 2; sp.gravity = -0.5; sp.spin = range(-1, 1); sp.opacity = opacity;
    fx.soft.emit(sp);
  }
}
