// Item entities: boxes, projectiles, hazards and attachments. Owner: gameplay. Headless.
// Moving items follow the track surface through TrackMover; hits go through ItemSystemImpl.hitKart
// so held items, orbiting acorns, shields and post-hit invulnerability are respected everywhere.
import { Quaternion, Vector3 } from 'three';
import type { Kart, RaceSim, SimEntity } from '../core/types';
import { ITEM } from './params';
import { MOVE_LANDED, MOVE_OUT, MOVE_WALL, TrackMover, newFrame } from './mover';
import type { ItemSystemImpl } from './system';

const UP = new Vector3(0, 1, 0);
const v1 = new Vector3();
const frame = newFrame();

export function kartForward(kart: Kart, out: Vector3): Vector3 {
  return out.set(0, 0, 1).applyQuaternion(kart.quat);
}

export abstract class ItemEntity implements SimEntity {
  readonly id: number;
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0;
  dead = false;
  data: Record<string, unknown> = {};
  age = 0;
  /** Can be destroyed by other projectiles (acorn vs giftbox etc.). */
  breakable = false;

  constructor(readonly sys: ItemSystemImpl, readonly kind: string, readonly owner: number) {
    this.id = sys.sim.nextEntityId();
  }

  step(sim: RaceSim, dt: number): void {
    this.age += dt;
    this.update(sim, dt);
  }

  abstract update(sim: RaceSim, dt: number): void;

  /** Owner is immune for a moment after throwing. */
  protected ownerImmune(kart: Kart): boolean {
    return kart.id === this.owner && this.age < ITEM.ownerGrace;
  }

  kill(fx?: string, color?: string, scale = 1): void {
    if (this.dead) return;
    this.dead = true;
    if (fx) this.sys.fx(fx, this.pos, color, scale);
  }
}

// ---------------------------------------------------------------------------

export class ItemBoxEntity extends ItemEntity {
  constructor(sys: ItemSystemImpl, readonly spot: number, pos: Vector3) {
    super(sys, 'item.box', -1);
    this.pos.copy(pos);
    this.radius = ITEM.boxRadius;
    this.data = { active: true, respawn: 0, spot, popAt: -1 };
  }

  update(_sim: RaceSim, dt: number): void {
    if (this.data.active) return;
    const t = (this.data.respawn as number) - dt;
    this.data.respawn = t;
    if (t <= 0) this.data.active = true;
  }

  onKart(kart: Kart, sim: RaceSim): void {
    if (!this.data.active || sim.phase !== 'racing' || kart.carried) return;
    this.data.active = false;
    this.data.respawn = ITEM.boxRespawn;
    this.data.popAt = sim.time;
    this.sys.pickup(kart, this);
  }
}

/** One per kart: carries per-kart item state for the attachment view (held item, orbit, bubble...). */
export class KartAttachEntity extends ItemEntity {
  constructor(sys: ItemSystemImpl, readonly kart: Kart) {
    super(sys, 'item.kart', kart.id);
    this.data = { kart: kart.id };
  }
  update(): void {
    this.pos.copy(this.kart.pos);
    this.quat.copy(this.kart.quat);
  }
}

// ---------------------------------------------------------------------------

export class AcornEntity extends ItemEntity {
  readonly mover = new TrackMover();

  constructor(sys: ItemSystemImpl, kart: Kart, aim: -1 | 0 | 1, from?: Vector3) {
    super(sys, 'item.acorn', kart.id);
    const p = ITEM.acorn;
    this.radius = p.radius;
    this.breakable = true;
    const f = kartForward(kart, v1);
    f.y = 0; f.normalize();
    const m = this.mover;
    m.hover = p.radius;
    if (aim < 0) {
      this.pos.copy(from ?? kart.pos).addScaledVector(f, -2.2);
      m.vel.copy(f).multiplyScalar(-p.backSpeed);
      m.alt = 1.2; m.vy = 4;
    } else {
      this.pos.copy(from ?? kart.pos).addScaledVector(f, 1.8);
      const fwdSpeed = Math.max(0, kart.vel.dot(f));
      m.vel.copy(f).multiplyScalar(Math.max(p.speed, fwdSpeed + p.minRelSpeed));
      m.alt = p.radius;
    }
    m.followRoad = p.followRoad;
    m.place(this.pos, sys.sim, kart.loc);
    this.data = { bounce: 0, spin: 0 };
  }

  update(sim: RaceSim, dt: number): void {
    const f = this.mover.step(this.pos, sim, dt);
    if (f & MOVE_OUT) return this.kill('dust');
    if (f & MOVE_WALL) {
      this.data.bounce = this.age;
      this.sys.fx('sparks', this.pos, '#c98a3c', 0.5);
      if (this.mover.bounces > ITEM.acorn.bounces) return this.kill('burst', '#a0642a', 0.6);
    }
    if (this.age > ITEM.acorn.life) this.kill('burst', '#a0642a', 0.6);
    const speed = Math.hypot(this.mover.vel.x, this.mover.vel.z);
    this.data.spin = (this.data.spin as number) + (speed * dt) / this.radius;
    if (speed > 0.1) this.quat.setFromAxisAngle(UP, Math.atan2(this.mover.vel.x, this.mover.vel.z));
  }

  onKart(kart: Kart, _sim: RaceSim): void {
    if (this.ownerImmune(kart) || kart.carried) return;
    this.sys.hitKart(kart, 'spin', ITEM.acorn.strength, this.owner, 'acorn', this.pos);
    this.kill('burst', '#a0642a', 0.8);
  }
}

// ---------------------------------------------------------------------------

export class HoneyEntity extends ItemEntity {
  readonly mover = new TrackMover();
  puddle = false;
  victims = 0;
  private lastHit = new Map<number, number>();

  constructor(sys: ItemSystemImpl, kart: Kart, aim: -1 | 0 | 1) {
    super(sys, 'item.honey', kart.id);
    const p = ITEM.honey;
    const f = kartForward(kart, v1);
    f.y = 0; f.normalize();
    const m = this.mover;
    m.hover = 0.3;
    this.breakable = true;
    this.radius = 0.45;
    if (aim > 0) {
      this.pos.copy(kart.pos).addScaledVector(f, 1.5);
      const fwdSpeed = Math.max(0, kart.vel.dot(f));
      m.vel.copy(f).multiplyScalar(fwdSpeed + p.lobDistance / p.lobTime);
      m.alt = 1.2; m.vy = (22 * p.lobTime) / 2;
    } else {
      this.pos.copy(kart.pos).addScaledVector(f, -p.dropBehind);
      m.vel.copy(kart.vel).multiplyScalar(0.15); m.vel.y = 0;
      m.alt = 0.9; m.vy = 2;
    }
    m.place(this.pos, sys.sim, kart.loc);
    this.data = { state: 'jar', fade: 1, landedAt: -1 };
  }

  private land(sim: RaceSim): void {
    this.puddle = true;
    this.breakable = false;
    this.radius = ITEM.honey.puddleRadius;
    this.mover.vel.set(0, 0, 0);
    this.data.state = 'puddle';
    this.data.landedAt = sim.time;
    this.age = 0;
    this.sys.fx('splash', this.pos, '#f2a516', 1.2);
  }

  update(sim: RaceSim, dt: number): void {
    if (!this.puddle) {
      const f = this.mover.step(this.pos, sim, dt);
      if (f & MOVE_OUT) return this.kill('splash', '#f2a516', 0.6);
      if (f & MOVE_LANDED) this.land(sim);
      return;
    }
    // Align the puddle with the road.
    sim.track.sample(this.mover.loc.progress, this.mover.loc.lat, this.mover.loc.path, frame);
    this.quat.setFromUnitVectors(UP, frame.up);
    const ending = this.victims >= ITEM.honey.maxVictims || this.age > ITEM.honey.life;
    if (ending) {
      const fade = (this.data.fade as number) - dt * 2;
      this.data.fade = fade;
      if (fade <= 0) this.dead = true;
    }
  }

  onKart(kart: Kart, sim: RaceSim): void {
    if (kart.carried) return;
    if (!this.puddle) {
      if (this.ownerImmune(kart)) return;
      // A jar that hits a kart bursts on it.
      this.sys.sticky(kart, this.owner);
      this.land(sim);
      this.victims++;
      this.lastHit.set(kart.id, sim.time);
      return;
    }
    if ((this.data.fade as number) < 1 || kart.airTime > 0.2) return;
    const last = this.lastHit.get(kart.id);
    if (last !== undefined && sim.time - last < 2.5) return;
    if (kart.id === this.owner && this.age < 1.0) return;
    this.lastHit.set(kart.id, sim.time);
    if (this.sys.sticky(kart, this.owner)) this.victims++;
  }
}

// ---------------------------------------------------------------------------

export class GiftEntity extends ItemEntity {
  readonly mover = new TrackMover();

  constructor(sys: ItemSystemImpl, kart: Kart, aim: -1 | 0 | 1) {
    super(sys, 'item.giftbox', kart.id);
    const p = ITEM.giftbox;
    this.radius = p.radius;
    this.breakable = true;
    const f = kartForward(kart, v1);
    f.y = 0; f.normalize();
    const m = this.mover;
    m.hover = 0.6;
    if (aim > 0) {
      this.pos.copy(kart.pos).addScaledVector(f, 1.5);
      const fwdSpeed = Math.max(0, kart.vel.dot(f));
      m.vel.copy(f).multiplyScalar(fwdSpeed + p.lobDistance / p.lobTime);
      m.alt = 1.2; m.vy = (22 * p.lobTime) / 2;
    } else {
      this.pos.copy(kart.pos).addScaledVector(f, -ITEM.holdDistance);
      m.vel.copy(kart.vel).multiplyScalar(0.1); m.vel.y = 0;
      m.alt = 0.9; m.vy = 1;
    }
    m.place(this.pos, sys.sim, kart.loc);
    this.quat.copy(kart.quat);
    this.data = { landed: false };
  }

  update(sim: RaceSim, dt: number): void {
    if (!this.data.landed) {
      const f = this.mover.step(this.pos, sim, dt);
      if (f & MOVE_OUT) return this.kill('dust');
      if (f & MOVE_LANDED) { this.data.landed = true; this.mover.vel.set(0, 0, 0); this.sys.fx('dust', this.pos, '#e8d9b0', 0.6); }
    }
    if (this.age > ITEM.giftbox.life) this.kill('confetti', '#ff5fa2', 0.5);
  }

  onKart(kart: Kart, _sim: RaceSim): void {
    if (this.ownerImmune(kart) || kart.carried) return;
    this.sys.hitKart(kart, 'tumble', ITEM.giftbox.strength, this.owner, 'giftbox', this.pos);
    this.kill('confetti', '#ff5fa2', 1.2);
  }
}

// ---------------------------------------------------------------------------

export class YarnEntity extends ItemEntity {
  readonly mover = new TrackMover();
  target: Kart | null;
  dist: number;
  private homing: boolean;

  constructor(sys: ItemSystemImpl, kart: Kart, aim: -1 | 0 | 1, target: Kart | null) {
    super(sys, 'item.yarn', kart.id);
    const p = ITEM.yarn;
    this.radius = p.radius;
    this.breakable = true;
    this.homing = aim >= 0;
    this.target = this.homing ? target : null;
    const f = kartForward(kart, v1);
    f.y = 0; f.normalize();
    const m = this.mover;
    m.hover = p.radius;
    if (this.homing) {
      this.pos.copy(kart.pos).addScaledVector(f, 1.9);
      m.vel.copy(f).multiplyScalar(p.speed);
    } else {
      this.pos.copy(kart.pos).addScaledVector(f, -2.2);
      m.vel.copy(f).multiplyScalar(-p.backSpeed);
      m.followRoad = 0.9;
    }
    m.place(this.pos, sys.sim, kart.loc);
    this.dist = kart.race.distance + (this.homing ? 1.9 : -2.2);
    this.data = { target: this.target?.id ?? -1, spin: 0 };
  }

  update(sim: RaceSim, dt: number): void {
    const p = ITEM.yarn;
    const m = this.mover;
    const before = m.distance;
    const t = this.target;
    if (t && !t.race.finished) {
      const gap = t.race.distance - this.dist;
      if (gap < p.homeDist && gap > -6) {
        // Close: home in on the kart itself, leading it slightly.
        m.steerToward(this.pos, t.pos.x + t.vel.x * 0.12, t.pos.z + t.vel.z * 0.12, p.speed, p.turnRate * 1.6, dt);
      } else {
        // Far: roll along the road, drifting toward the target's lane as it gets closer.
        const lat = gap < 70 ? t.loc.lat : sim.track.racingLine(m.loc.progress + 14, m.loc.path).lat;
        const cl = Math.max(-m.loc.halfWidth + 1, Math.min(m.loc.halfWidth - 1, lat));
        sim.track.sample(m.loc.progress + 14, cl, m.loc.path, frame);
        m.steerToward(this.pos, frame.pos.x, frame.pos.z, p.speed, p.turnRate, dt);
      }
    } else if (this.homing) {
      sim.track.sample(m.loc.progress + 14, sim.track.racingLine(m.loc.progress + 14, m.loc.path).lat, m.loc.path, frame);
      m.steerToward(this.pos, frame.pos.x, frame.pos.z, p.speed, p.turnRate, dt);
    }
    const f = m.step(this.pos, sim, dt);
    this.dist += m.distance - before;
    if (f & MOVE_OUT) return this.kill('dust');
    if ((f & MOVE_WALL) && !this.homing && m.bounces > 3) return this.kill('burst', '#e05a8a', 0.6);
    if (this.age > p.life) this.kill('burst', '#e05a8a', 0.6);
    this.data.spin = (this.data.spin as number) + (p.speed * dt) / this.radius;
    this.quat.setFromAxisAngle(UP, Math.atan2(m.vel.x, m.vel.z));
  }

  onKart(kart: Kart, _sim: RaceSim): void {
    if (this.ownerImmune(kart) || kart.carried) return;
    const r = this.sys.hitKart(kart, 'spin', ITEM.yarn.strength, this.owner, 'yarn', this.pos);
    if (r === 'hit') kart.addModifier({ id: 'item.yarn', time: ITEM.yarn.wrapTime, topSpeed: ITEM.yarn.wrapTopSpeed });
    this.kill('burst', '#e05a8a', 1);
  }
}

// ---------------------------------------------------------------------------

export class BeesEntity extends ItemEntity {
  state: 'fly' | 'harass' | 'leave' = 'fly';
  dist: number;
  remaining = 0;
  private lat: number;

  constructor(sys: ItemSystemImpl, kart: Kart, public target: Kart) {
    super(sys, 'item.bees', kart.id);
    this.dist = kart.race.distance;
    this.lat = kart.loc.lat;
    this.pos.copy(kart.pos).addScaledVector(UP, 2);
    this.data = { target: target.id, state: 'fly' };
  }

  update(sim: RaceSim, dt: number): void {
    const p = ITEM.bees;
    const t = this.target;
    if (this.state === 'fly') {
      if (t.race.finished) { this.state = 'leave'; this.age = 0; return; }
      const gap = t.race.distance - this.dist;
      if (gap > 30) {
        this.dist += p.speed * dt;
        const L = sim.track.length;
        const prog = ((this.dist % L) + L) % L;
        this.lat += (t.loc.lat - this.lat) * Math.min(1, dt * 1.5);
        sim.track.sample(prog, this.lat, 0, frame);
        v1.copy(frame.pos).addScaledVector(frame.up, p.altitude);
        this.pos.lerp(v1, Math.min(1, dt * 10));
      } else {
        // Final approach: fly straight at the kart.
        v1.copy(t.pos).addScaledVector(UP, 1.8).sub(this.pos);
        const d = v1.length();
        const step = p.speed * 0.8 * dt;
        if (d <= Math.max(1.5, step)) this.arrive(sim);
        else this.pos.addScaledVector(v1, step / d);
        this.dist = t.race.distance - Math.min(30, d);
      }
      this.data.state = this.state;
      return;
    }
    if (this.state === 'harass') {
      this.pos.copy(t.pos).addScaledVector(UP, 1.8);
      this.remaining -= dt * (t.boost.time > 0 ? p.boostDrain : 1);
      const mod = t.modifiers.find((m) => m.id === 'item.bees');
      if (mod) mod.time = Math.max(0.01, this.remaining);
      if (this.remaining <= 0 || !mod) {
        t.removeModifier('item.bees');
        this.state = 'leave';
        this.age = 0;
      }
      this.data.state = this.state;
      return;
    }
    // Leaving: drift up and away, then vanish.
    this.pos.y += 6 * dt;
    if (this.age > 1.2) this.dead = true;
    this.data.state = this.state;
  }

  private arrive(sim: RaceSim): void {
    const t = this.target;
    const p = ITEM.bees;
    this.age = 0;
    if (t.modifiers.some((m) => m.invincible)) { this.state = 'leave'; this.sys.count('absorbed', 'bees'); return; }
    if (t.shield) {
      this.sys.popShield(t);
      this.state = 'leave';
      this.sys.count('absorbed', 'bees');
      return;
    }
    this.remaining = p.harass * (t.boost.time > 0 ? p.dodgeFactor : 1);
    this.state = 'harass';
    t.addModifier({ id: 'item.bees', time: this.remaining, topSpeed: p.topSpeed, steer: p.steer });
    this.sys.count('hits', 'bees');
    this.sys.fx('burst', this.pos, '#ffd23f', 1);
    sim.events.emit('kart:hit', { kart: t, kind: 'bump', by: this.owner, cause: 'bees', absorbed: false });
  }
}

// ---------------------------------------------------------------------------

export class CloudEntity extends ItemEntity {
  remaining: number = ITEM.cloud.hover;
  passCooldown = 0;
  private lastBoost: number;

  constructor(sys: ItemSystemImpl, owner: number, public target: Kart) {
    super(sys, 'item.cloud', owner);
    this.pos.copy(target.pos).addScaledVector(UP, 7);
    this.lastBoost = target.boost.time;
    this.data = { target: target.id, left: 1, passed: 0 };
  }

  update(sim: RaceSim, dt: number): void {
    const p = ITEM.cloud;
    const t = this.target;
    v1.copy(t.pos).addScaledVector(UP, 2.8);
    this.pos.lerp(v1, Math.min(1, dt * 8));
    this.remaining -= dt;
    this.passCooldown -= dt;
    this.data.left = this.remaining / p.hover;
    this.data.target = t.id;
    if (t.race.finished) return this.kill('dust', '#8a8fa8');
    // Shake it off by firing a new boost while it hangs overhead.
    const boosted = t.boost.time > this.lastBoost + 0.05;
    this.lastBoost = t.boost.time;
    if (this.age > p.shakeAfter && boosted) {
      this.sys.count('absorbed', 'cloud');
      return this.kill('dust', '#cfd3e6', 1.4);
    }
    // Pass it on by bumping into another kart.
    if (this.passCooldown <= 0) {
      for (const k of sim.karts) {
        if (k === t || k.race.finished || this.sys.cloudOn(k)) continue;
        if (k.pos.distanceToSquared(t.pos) < p.passDist * p.passDist) {
          this.target = k;
          this.lastBoost = k.boost.time;
          this.passCooldown = p.passCooldown;
          this.remaining = Math.max(this.remaining, p.minLeft);
          this.data.passed = (this.data.passed as number) + 1;
          sim.events.emit('item:warn', { kart: k, item: 'cloud', from: t.id });
          this.sys.fx('sparks', this.pos, '#fff36b', 0.6);
          break;
        }
      }
    }
    if (this.remaining <= 0) {
      const r = this.sys.hitKart(this.target, 'zap', p.strength, this.owner, 'cloud', null);
      if (r === 'hit') this.target.addModifier({ id: 'item.zap', time: p.zapTime, scale: p.zapScale, topSpeed: p.zapTopSpeed });
      this.kill('sparks', '#fff36b', 1.6);
    }
  }
}

// ---------------------------------------------------------------------------

export class YawnEntity extends ItemEntity {
  ring = 0;
  private hit = new Set<number>();

  constructor(sys: ItemSystemImpl, readonly kart: Kart) {
    super(sys, 'item.yawn', kart.id);
    this.pos.copy(kart.pos);
    this.data = { ring: 0, max: ITEM.yawn.radius };
  }

  update(sim: RaceSim, dt: number): void {
    const p = ITEM.yawn;
    this.pos.copy(this.kart.pos);
    this.ring += p.speed * dt;
    this.data.ring = this.ring;
    for (const k of sim.karts) {
      if (k === this.kart || this.hit.has(k.id) || k.race.finished) continue;
      if (k.pos.distanceTo(this.pos) <= this.ring) {
        this.hit.add(k.id);
        this.sys.drowsy(k, this.owner);
      }
    }
    if (this.ring >= p.radius) this.dead = true;
  }
}

