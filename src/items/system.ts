// Item system: boxes, roulette, distribution, use, held items, kart effects. Owner: gameplay.
// Headless and deterministic: uses sim.rng / sim.time only.
import { Vector3 } from 'three';
import type { HitKind, Kart, RaceSim, SimSystem } from '../core/types';
import {
  AcornEntity, BeesEntity, CloudEntity, GiftEntity, HoneyEntity, ItemBoxEntity, ItemEntity, KartAttachEntity, YarnEntity,
  YawnEntity, kartForward,
} from './entities';
import { drawItem, HOLDABLE, ITEM, ITEM_COUNT, ITEM_IDS, positionFactor, RARE, type ItemId } from './params';

export interface ItemStats {
  boxes: number;
  got: Record<string, number>;
  used: Record<string, number>;
  /** Landed hits per cause (item id). */
  hits: Record<string, number>;
  /** Absorbed by shield / invincibility / post-hit protection / boost dodge. */
  absorbed: Record<string, number>;
  /** Blocked by a held item or orbiting acorns. */
  blocked: Record<string, number>;
}

export interface ItemSystemOptions {
  /** Spawn item boxes (default true; false in time trial). */
  boxes?: boolean;
}

interface KartItemState {
  prevBtn: boolean;
  pending: ItemId | null;
  spun: number;
  goldTime: number;
  goldCd: number;
  lastRare: string | null;
  bubbleTime: number;
  attach: KartAttachEntity;
  holdTime: number;
}

export interface ItemSystem extends SimSystem {
  readonly stats: ItemStats;
  /** Puts an item straight into a kart's slot (debug panel, tests, time trial). */
  give(kart: Kart, id: string, count?: number): void;
  /** Uses the kart's current item now, bypassing the button (debug / tests). */
  use(kart: Kart, aim?: -1 | 0 | 1): boolean;
  /** Seconds left of an active golden-carrot window, 0 if none. */
  goldTime(kart: Kart): number;
  /** Cloud entity currently hanging over a kart, if any. */
  cloudOn(kart: Kart): CloudEntity | null;
  /** Bee swarm currently flying toward or harassing a kart, if any. */
  beesOn(kart: Kart): BeesEntity | null;
  readonly boxes: readonly ItemBoxEntity[];
  /** The kart directly ahead in the race (yarn target), or null for the leader. */
  nextAhead(kart: Kart): Kart | null;
}

const registry = new WeakMap<RaceSim, ItemSystemImpl>();

/** The item system running in a sim (used by the AI), or null. */
export function itemSystemOf(sim: RaceSim): ItemSystem | null {
  return registry.get(sim) ?? null;
}

const fwd = new Vector3(), rel = new Vector3();
const MANUAL = new Set(['honey', 'yawn', 'bees']);

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

export class ItemSystemImpl implements ItemSystem {
  sim!: RaceSim;
  readonly stats: ItemStats = { boxes: 0, got: {}, used: {}, hits: {}, absorbed: {}, blocked: {} };
  readonly boxes: ItemBoxEntity[] = [];
  private states: KartItemState[] = [];
  private rareUntil = new Map<string, number>();
  private unsub: (() => void)[] = [];
  private weights: number[] = new Array(ITEM_IDS.length).fill(0);
  private readonly useBoxes: boolean;

  constructor(opts: ItemSystemOptions = {}) {
    this.useBoxes = opts.boxes ?? true;
  }

  init(sim: RaceSim): void {
    this.sim = sim;
    registry.set(sim, this);
    const timeTrial = sim.config.mode === 'timetrial';
    for (const k of sim.karts) {
      const attach = new KartAttachEntity(this, k);
      this.states[k.id] = { prevBtn: false, pending: null, spun: 0, goldTime: 0, goldCd: 0, lastRare: null, bubbleTime: 0, attach, holdTime: 0 };
      sim.addEntity(attach);
      if (timeTrial) this.give(k, 'carrot3');
    }
    if (this.useBoxes && !timeTrial) {
      for (const spot of sim.track.itemBoxes) {
        const b = new ItemBoxEntity(this, spot.id, spot.pos);
        this.boxes.push(b);
        sim.addEntity(b);
      }
    }
    this.unsub.push(
      sim.events.on('kart:hit', ({ kart, absorbed, cause }) => {
        // honey / yawn / bees count themselves and are not real hits.
        if (MANUAL.has(cause)) return;
        if (ITEM_IDS.includes(cause as ItemId)) bump(absorbed ? this.stats.absorbed : this.stats.hits, cause);
        if (absorbed) return;
        // A hit knocks a held item out of your hands.
        const slot = kart.item;
        if (slot.holding && slot.id) {
          this.fx('burst', kart.pos, '#ffffff', 0.6);
          this.clearSlot(kart);
        }
      }),
    );
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
  }

  // -------------------------------------------------------------------------

  step(sim: RaceSim, dt: number): void {
    const racing = sim.phase === 'racing';
    for (const k of sim.karts) {
      const st = this.states[k.id];
      if (!st) continue;
      const slot = k.item;
      const btn = k.input.item;
      const press = btn && !st.prevBtn;
      const release = !btn && st.prevBtn;
      st.prevBtn = btn;

      if (slot.roulette > 0) {
        st.spun += dt;
        if (press && racing && st.spun >= ITEM.rouletteMinSpin) slot.roulette = Math.min(slot.roulette, ITEM.rouletteStopTail);
        slot.roulette -= dt;
        if (slot.roulette <= 0) {
          slot.roulette = 0;
          // Drawn when the roulette stops, from the position at that moment.
          const id = st.pending ?? this.draw(k);
          st.pending = null;
          this.give(k, id);
        }
      } else if (slot.id && racing && !k.race.finished) {
        const canAct = k.stun <= 0 && !k.carried;
        if (slot.holding) {
          st.holdTime += dt;
          if (release) { slot.holding = false; if (canAct) this.use(k, k.input.itemAim); }
        } else if (press && canAct) {
          if (HOLDABLE.has(slot.id)) { slot.holding = true; st.holdTime = 0; } else this.use(k, k.input.itemAim);
        }
      }

      // Golden carrot window.
      if (st.goldTime > 0) {
        st.goldTime -= dt;
        st.goldCd -= dt;
        if (st.goldTime <= 0) { st.goldTime = 0; if (slot.id === 'goldcarrot') this.clearSlot(k); }
      }
      // Bubble lifetime.
      if (st.bubbleTime > 0) {
        st.bubbleTime -= dt;
        if (!k.shield) st.bubbleTime = 0;
        else if (st.bubbleTime <= 0) this.popShield(k);
      }
      // Lollipop: knock karts it touches.
      if (racing && k.hasModifier('item.lolly')) {
        const r = ITEM.lolly.touch;
        for (const o of sim.karts) {
          if (o === k || o.race.finished || o.carried || o.hasModifier('item.lolly')) continue;
          if (o.pos.distanceToSquared(k.pos) < r * r && o.invulnerable <= 0 && o.stun <= 0) {
            this.hitKart(o, 'tumble', ITEM.lolly.strength, k.id, 'lolly', k.pos, true);
          }
        }
      }
      // Attachment view state.
      const d = st.attach.data;
      d.item = slot.id;
      d.count = slot.count;
      d.holding = slot.holding;
      d.roulette = slot.roulette;
      d.shield = k.shield;
      d.bubble = st.bubbleTime;
      d.gold = st.goldTime;
      d.lolly = k.hasModifier('item.lolly');
      d.drowsy = k.hasModifier('item.drowsy');
      d.sticky = k.hasModifier('item.honey');
      d.zap = k.hasModifier('item.zap');
      d.bees = k.hasModifier('item.bees');
    }
    this.collideProjectiles();
  }

  /** Projectiles destroy each other (acorn vs giftbox, yarn vs acorn, ...). */
  private collideProjectiles(): void {
    const es = this.sim.entities;
    for (let i = 0; i < es.length; i++) {
      const a = es[i] as ItemEntity;
      if (!(a instanceof ItemEntity) || !a.breakable || a.dead) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j] as ItemEntity;
        if (!(b instanceof ItemEntity) || !b.breakable || b.dead) continue;
        if (a.age < 0.15 && b.age < 0.15) continue;
        const r = a.radius + b.radius;
        if (a.pos.distanceToSquared(b.pos) < r * r) {
          a.kill('burst', '#ffffff', 0.7);
          b.kill();
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Boxes and distribution

  pickup(kart: Kart, box: ItemBoxEntity): void {
    this.stats.boxes++;
    this.fx('burst', box.pos, '#ffd447', 1);
    this.sim.events.emit('item:box', { kart, spot: box.spot });
    const slot = kart.item;
    if (slot.id || slot.roulette > 0 || kart.race.finished) return;
    const st = this.states[kart.id];
    st.pending = null;
    st.spun = 0;
    slot.roulette = ITEM.roulette;
  }

  /** Position factor of a kart right now (0 leading .. 1 far behind). */
  positionFactor(kart: Kart): number {
    let leaderDist = -Infinity;
    for (const k of this.sim.karts) leaderDist = Math.max(leaderDist, k.race.distance);
    return positionFactor(kart.race.rank, this.sim.karts.length, leaderDist - kart.race.distance);
  }

  private draw(kart: Kart): ItemId {
    const st = this.states[kart.id];
    const p = this.positionFactor(kart);
    const now = this.sim.time;
    const id = drawItem(this.sim.rng.next(), p, (item) => {
      if (RARE.has(item) && (st.lastRare === item || (this.rareUntil.get(item) ?? -1) > now)) return true;
      if (item === 'bees' && this.sim.entities.some((e) => e.kind === 'item.bees')) return true;
      if (item === 'cloud' && kart.race.rank <= 1) return true;
      return false;
    }, this.weights);
    if (RARE.has(id)) {
      st.lastRare = id;
      const cd = id === 'bees' ? ITEM.bees.cooldown : id === 'cloud' ? ITEM.cloud.cooldown : ITEM.rareCooldown;
      this.rareUntil.set(id, now + cd);
    } else if (st.lastRare) {
      // One ordinary item in between lifts the "no repeat" block.
      st.lastRare = null;
    }
    return id;
  }

  give(kart: Kart, id: string, count?: number): void {
    const st = this.states[kart.id];
    const slot = kart.item;
    slot.id = id;
    slot.count = count ?? ITEM_COUNT[id as ItemId] ?? 1;
    slot.roulette = 0;
    slot.holding = false;
    if (st) { st.pending = null; st.goldTime = 0; }
    bump(this.stats.got, id);
    this.sim.events.emit('item:got', { kart, item: id });
  }

  private clearSlot(kart: Kart): void {
    const slot = kart.item;
    slot.id = null;
    slot.count = 0;
    slot.holding = false;
  }

  private consume(kart: Kart): void {
    const slot = kart.item;
    slot.count--;
    slot.holding = false;
    if (slot.count <= 0) this.clearSlot(kart);
  }

  // -------------------------------------------------------------------------
  // Using items

  use(kart: Kart, aim: -1 | 0 | 1 = 0): boolean {
    const slot = kart.item;
    const id = slot.id as ItemId | null;
    if (!id) return false;
    const sim = this.sim;
    const st = this.states[kart.id];
    switch (id) {
      case 'acorn':
        sim.addEntity(new AcornEntity(this, kart, aim));
        break;
      case 'acorn3': {
        // Fire the orbiting acorn that is closest to the throw direction.
        sim.addEntity(new AcornEntity(this, kart, aim));
        break;
      }
      case 'honey':
        sim.addEntity(new HoneyEntity(this, kart, aim));
        break;
      case 'giftbox':
        sim.addEntity(new GiftEntity(this, kart, aim));
        break;
      case 'yarn':
        sim.addEntity(new YarnEntity(this, kart, aim, this.nextAhead(kart)));
        break;
      case 'bees': {
        const target = this.beesTarget(kart);
        if (target) {
          sim.addEntity(new BeesEntity(this, kart, target));
          sim.events.emit('item:warn', { kart: target, item: 'bees', from: kart.id });
        } else this.fx('dust', kart.pos, '#ffd23f', 0.8);
        break;
      }
      case 'bubble':
        kart.shield = true;
        st.bubbleTime = ITEM.bubble.time;
        this.fx('splash', kart.pos, '#bfe9ff', 0.8);
        break;
      case 'carrot':
      case 'carrot3':
        kart.applyBoost(ITEM.carrot.time, ITEM.carrot.power);
        break;
      case 'goldcarrot': {
        if (st.goldTime <= 0) st.goldTime = ITEM.goldcarrot.window;
        if (st.goldCd > 0) return false;
        st.goldCd = ITEM.goldcarrot.pressCooldown;
        kart.applyBoost(ITEM.goldcarrot.time, ITEM.goldcarrot.power);
        bump(this.stats.used, id);
        sim.events.emit('item:use', { kart, item: id });
        return true; // the window, not the count, ends the item
      }
      case 'lolly': {
        const p = ITEM.lolly;
        kart.addModifier({ id: 'item.lolly', time: p.time, topSpeed: p.topSpeed, accel: p.accel, invincible: true });
        this.fx('confetti', kart.pos, '#ff7ad9', 1.2);
        break;
      }
      case 'cloud': {
        let any = false;
        for (const k of sim.karts) {
          if (k === kart || k.race.finished || k.race.rank >= kart.race.rank || this.cloudOn(k)) continue;
          sim.addEntity(new CloudEntity(this, kart.id, k));
          sim.events.emit('item:warn', { kart: k, item: 'cloud', from: kart.id });
          any = true;
        }
        if (!any) this.fx('dust', kart.pos, '#8a8fa8', 0.8);
        break;
      }
      case 'yawn':
        sim.addEntity(new YawnEntity(this, kart));
        break;
    }
    bump(this.stats.used, id);
    sim.events.emit('item:use', { kart, item: id });
    this.consume(kart);
    return true;
  }

  /** The kart directly ahead in the race order, or null for the leader. */
  nextAhead(kart: Kart): Kart | null {
    let best: Kart | null = null;
    for (const k of this.sim.karts) {
      if (k === kart || k.race.finished) continue;
      if (k.race.distance > kart.race.distance && (!best || k.race.distance < best.race.distance)) best = k;
    }
    return best;
  }

  private beesTarget(kart: Kart): Kart | null {
    let best: Kart | null = null;
    for (const k of this.sim.karts) {
      if (k === kart || k.race.finished) continue;
      if (!best || k.race.distance > best.race.distance) best = k;
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Effects on karts

  /**
   * Central hit resolution. Orbiting acorns block from any side, a held item blocks from behind,
   * then the kart's own applyHit decides (shield, invincible, post-hit protection).
   */
  hitKart(kart: Kart, kind: HitKind, strength: number, by: number, cause: string, from: Vector3 | null, unblockable = false): 'hit' | 'absorbed' | 'blocked' {
    const slot = kart.item;
    if (!unblockable && slot.id === 'acorn3' && slot.count > 0) {
      bump(this.stats.blocked, cause);
      this.consume(kart);
      this.fx('burst', kart.pos, '#a0642a', 0.8);
      return 'blocked';
    }
    if (!unblockable && from && slot.holding && slot.id && HOLDABLE.has(slot.id)) {
      kartForward(kart, fwd);
      rel.copy(from).sub(kart.pos);
      if (rel.dot(fwd) < 0.3) {
        bump(this.stats.blocked, cause);
        this.clearSlot(kart);
        this.fx('burst', from, '#ffffff', 0.8);
        return 'blocked';
      }
    }
    if (from) rel.copy(kart.pos).sub(from).normalize();
    const landed = kart.applyHit(kind, { strength, by, cause, dir: from ? rel.clone() : undefined });
    return landed ? 'hit' : 'absorbed';
  }

  /** Honey: slows and slides, no full stop. Returns false if it had no effect. */
  sticky(kart: Kart, by: number): boolean {
    if (kart.modifiers.some((m) => m.invincible) || kart.invulnerable > 0) { bump(this.stats.absorbed, 'honey'); return false; }
    const p = ITEM.honey;
    kart.addModifier({ id: 'item.honey', time: p.slowTime, topSpeed: p.topSpeed, accel: p.accel, grip: p.grip });
    bump(this.stats.hits, 'honey');
    this.fx('splash', kart.pos, '#f2a516', 0.8);
    this.sim.events.emit('kart:hit', { kart, kind: 'bump', by, cause: 'honey', absorbed: false });
    return true;
  }

  /** Yawn: drowsy for a few seconds. A bubble absorbs it. */
  drowsy(kart: Kart, by: number): void {
    if (kart.modifiers.some((m) => m.invincible)) { bump(this.stats.absorbed, 'yawn'); return; }
    if (kart.shield) { this.popShield(kart); bump(this.stats.absorbed, 'yawn'); return; }
    const p = ITEM.yawn;
    kart.addModifier({ id: 'item.drowsy', time: p.time, topSpeed: p.topSpeed, steer: p.steer, accel: p.accel });
    bump(this.stats.hits, 'yawn');
    this.sim.events.emit('kart:hit', { kart, kind: 'bump', by, cause: 'yawn', absorbed: false });
  }

  popShield(kart: Kart): void {
    kart.shield = false;
    const st = this.states[kart.id];
    if (st) st.bubbleTime = 0;
    this.fx('splash', kart.pos, '#bfe9ff', 1.2);
  }

  goldTime(kart: Kart): number {
    return this.states[kart.id]?.goldTime ?? 0;
  }

  cloudOn(kart: Kart): CloudEntity | null {
    for (const e of this.sim.entities) if (e instanceof CloudEntity && !e.dead && e.target === kart) return e;
    return null;
  }

  beesOn(kart: Kart): BeesEntity | null {
    for (const e of this.sim.entities) if (e instanceof BeesEntity && !e.dead && e.target === kart && e.state !== 'leave') return e;
    return null;
  }

  count(kind: 'hits' | 'absorbed' | 'blocked', cause: string): void {
    bump(this.stats[kind], cause);
  }

  fx(name: string, pos: Vector3, color?: string, scale = 1): void {
    this.sim.events.emit('fx', { name, pos: pos.clone(), color, scale });
  }
}

export function createItemSystem(opts?: ItemSystemOptions): ItemSystem {
  return new ItemSystemImpl(opts);
}
