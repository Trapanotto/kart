// Grey-box kart physics: kinematic, glued to the road. Good enough to test everything
// else headless. Owner: lead. The real physics lives in src/physics/.
import { Quaternion, Vector3 } from 'three';
import { emptyInput, emptyProgress, emptySlot, KART, SURFACES } from '../core/data';
import { emptyFrame, emptyLocation } from './testTrack';
import type { HitKind, HitOptions, Kart, KartModifier, KartSpawn, PhysicsSystem, Pose, RaceSim, WheelState } from '../core/types';

const FWD = new Vector3(0, 0, 1), UP = new Vector3(0, 1, 0);

class StubKart implements Kart {
  input = emptyInput();
  pos = new Vector3(); quat = new Quaternion(); vel = new Vector3();
  speed = 0; topSpeed = KART.topSpeed; grounded = true; airTime = 0; surface = 'road' as const;
  wheels: WheelState[] = [0, 1, 2, 3].map(() => ({ pos: new Vector3(), compression: 0.5, spin: 0, steer: 0, grounded: true, surface: 'road', slip: 0 }));
  lean = 0;
  drift = { active: false, dir: 0 as -1 | 0 | 1, charge: 0, level: 0 as 0 | 1 | 2 | 3 };
  boost = { time: 0, power: 1 };
  stun = 0; stunKind: HitKind | null = null; invulnerable = 0; trick = false; slipstream = 0; carried = false;
  modifiers: KartModifier[] = []; shield = false;
  loc = emptyLocation(); race = emptyProgress(); item = emptySlot();
  renderPos = new Vector3(); renderQuat = new Quaternion(); prevPos = new Vector3(); prevQuat = new Quaternion();
  yaw = 0;
  sim!: RaceSim;

  constructor(readonly id: number, readonly char: KartSpawn['char'], readonly isHuman: boolean, pose: Pose) {
    this.teleport(pose);
  }

  applyHit(kind: HitKind, opts: HitOptions = {}): boolean {
    const absorbed = this.shield || this.invulnerable > 0 || this.modifiers.some((m) => m.invincible);
    if (this.shield && this.invulnerable <= 0) { this.shield = false; this.invulnerable = 0.5; }
    if (!absorbed) { this.stun = 1.1 * (opts.strength ?? 1); this.stunKind = kind; this.speed *= 0.3; this.boost.time = 0; this.invulnerable = this.stun + 1; }
    this.sim?.events.emit('kart:hit', { kart: this, kind, by: opts.by ?? -1, cause: opts.cause ?? '', absorbed });
    return !absorbed;
  }
  applyBoost(duration: number, power = KART.boostPower): void {
    this.boost.time = Math.max(this.boost.time, duration); this.boost.power = power;
    this.sim?.events.emit('kart:boost', { kart: this, duration, power, cause: '' });
  }
  addImpulse(impulse: Vector3): void { this.vel.addScaledVector(impulse, 1 / 100); }
  addModifier(mod: KartModifier): void { this.removeModifier(mod.id); this.modifiers.push(mod); }
  removeModifier(id: string): void { this.modifiers = this.modifiers.filter((m) => m.id !== id); }
  hasModifier(id: string): boolean { return this.modifiers.some((m) => m.id === id); }
  teleport(pose: Pose, keepSpeed = false): void {
    this.pos.copy(pose.pos); this.quat.copy(pose.quat);
    const f = FWD.clone().applyQuaternion(pose.quat);
    this.yaw = Math.atan2(f.x, f.z);
    if (!keepSpeed) { this.speed = 0; this.vel.set(0, 0, 0); }
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat); this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat);
  }
}

export function createStubPhysics(): PhysicsSystem {
  const karts: StubKart[] = [];
  let sim: RaceSim | null = null;
  const frame = emptyFrame(), f = new Vector3();
  return {
    addKart(spawn) {
      const k = new StubKart(karts.length, spawn.char, spawn.isHuman, spawn.pose);
      karts.push(k);
      return k;
    },
    init(s) { sim = s; for (const k of karts) k.sim = s; },
    step(s, dt) {
      for (const k of karts) {
        k.sim = s;
        for (const m of k.modifiers) m.time -= dt;
        k.modifiers = k.modifiers.filter((m) => m.time > 0);
        k.boost.time = Math.max(0, k.boost.time - dt);
        k.invulnerable = Math.max(0, k.invulnerable - dt);
        k.stun = Math.max(0, k.stun - dt);
        if (k.stun <= 0) k.stunKind = null;
        const racing = s.phase === 'racing' && k.stun <= 0 && !k.carried;
        const inp = k.input;
        let mul = 1;
        for (const m of k.modifiers) mul *= m.topSpeed ?? 1;
        const surf = k.loc.onRoad ? SURFACES.road : SURFACES.offroad;
        const base = (KART.topSpeed + (k.char.speed - 3) * 1.2) * s.config.speedClass.speed * mul;
        k.topSpeed = base;
        const max = base * (k.boost.time > 0 ? k.boost.power : surf.speed);
        const accel = (11 + k.char.accel * 2.5) * s.config.speedClass.speed;
        if (racing) {
          if (k.boost.time > 0) k.speed = Math.min(max, k.speed + 50 * dt);
          else if (inp.throttle > 0) k.speed += accel * inp.throttle * Math.max(0, 1 - k.speed / max) * dt;
          if (inp.brake > 0) k.speed = Math.max(-8, k.speed - 30 * inp.brake * dt);
          if (inp.throttle === 0 && inp.brake === 0) k.speed *= 1 - 0.6 * dt;
          const turn = (1.3 + k.char.handling * 0.12) * Math.min(1, Math.abs(k.speed) / 6);
          k.yaw -= inp.steer * turn * Math.sign(k.speed || 1) * dt;
        } else k.speed *= 1 - 2 * dt;
        if (k.speed > max) k.speed += (max - k.speed) * Math.min(1, 3 * dt);
        f.set(Math.sin(k.yaw), 0, Math.cos(k.yaw));
        k.pos.addScaledVector(f, k.speed * dt);
        s.track.locate(k.pos, k.loc, k.loc);
        k.pos.y -= k.loc.height;
        // Keep inside the fence
        const lim = k.loc.halfWidth + 5;
        if (Math.abs(k.loc.lat) > lim) {
          s.track.sample(k.loc.progress, Math.sign(k.loc.lat) * lim, k.loc.path, frame);
          k.pos.copy(frame.pos); k.speed *= 0.9;
        }
        k.quat.setFromAxisAngle(UP, k.yaw);
        k.vel.copy(f).multiplyScalar(k.speed);
        const spin = (k.speed * dt) / 0.3;
        for (const w of k.wheels) { w.spin += spin; w.steer = -inp.steer * 0.4; }
      }
    },
    dispose() { sim = null; karts.length = 0; },
  };
}
