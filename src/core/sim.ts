// Race simulation orchestrator. Owner: lead. Headless: no DOM, no renderer.
import { createEventBus } from './events';
import { createRng, KART } from './data';
import { SIM_DT } from './types';
import type {
  EventBus, GameEvents, Kart, KartController, PhysicsSystem, RaceConfig, RacePhase, RaceSim, Rng, SimEntity,
  SimSystem, TrackRuntime,
} from './types';

export interface SimParts {
  config: RaceConfig;
  track: TrackRuntime;
  physics: PhysicsSystem;
  /** Stepped after physics, in order (items, then race rules). */
  systems: SimSystem[];
  events?: EventBus<GameEvents>;
}

export class Sim implements RaceSim {
  readonly config: RaceConfig;
  readonly track: TrackRuntime;
  readonly karts: Kart[] = [];
  readonly entities: SimEntity[] = [];
  readonly events: EventBus<GameEvents>;
  readonly rng: Rng;
  readonly physics: PhysicsSystem;
  readonly systems: SimSystem[];
  readonly controllers = new Map<number, KartController>();
  time = 0;
  raceTime = -3;
  phase: RacePhase = 'intro';
  laps: number;
  private entityId = 1;
  private started = false;
  private ownsBus: boolean;

  constructor(parts: SimParts) {
    this.config = parts.config;
    this.track = parts.track;
    this.physics = parts.physics;
    this.systems = parts.systems;
    this.ownsBus = !parts.events;
    this.events = parts.events ?? createEventBus<GameEvents>();
    this.rng = createRng(parts.config.seed ?? 1);
    this.laps = parts.config.laps ?? parts.track.meta.laps;
  }

  get player(): Kart {
    return this.karts.find((k) => k.isHuman) ?? this.karts[0];
  }

  /** Call once after all karts and controllers are added. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.physics.init?.(this);
    for (const s of this.systems) s.init?.(this);
    for (const e of this.track.createEntities(this)) this.addEntity(e);
  }

  nextEntityId(): number {
    return this.entityId++;
  }

  addEntity(e: SimEntity): void {
    this.entities.push(e);
    this.events.emit('entity:add', { entity: e });
  }

  step(): void {
    const dt = SIM_DT;
    this.time += dt;
    for (const k of this.karts) {
      k.prevPos.copy(k.pos);
      k.prevQuat.copy(k.quat);
      this.controllers.get(k.id)?.update(k, this, dt);
    }
    this.track.step(this, dt);
    this.physics.step(this, dt);
    for (const k of this.karts) this.track.locate(k.pos, k.loc, k.loc);
    for (const s of this.systems) s.step(this, dt);

    // Entities: step, overlap with karts, remove the dead. Entities added during the loop
    // are stepped from the next tick on.
    const n = this.entities.length;
    for (let i = 0; i < n; i++) {
      const e = this.entities[i];
      if (e.dead) continue;
      e.step(this, dt);
      if (e.dead || e.radius <= 0 || !e.onKart) continue;
      const r = e.radius + KART.radius;
      for (const k of this.karts) {
        if (k.pos.distanceToSquared(e.pos) < r * r) {
          e.onKart(k, this);
          if (e.dead) break;
        }
      }
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      if (this.entities[i].dead) {
        const [e] = this.entities.splice(i, 1);
        this.events.emit('entity:remove', { entity: e });
      }
    }
  }

  interpolate(alpha: number): void {
    for (const k of this.karts) {
      k.renderPos.lerpVectors(k.prevPos, k.pos, alpha);
      k.renderQuat.slerpQuaternions(k.prevQuat, k.quat, alpha);
    }
  }

  dispose(): void {
    this.physics.dispose?.();
    for (const s of this.systems) s.dispose?.();
    if (this.ownsBus) this.events.clear();
  }
}
