// Vehicle physics system: Rapier world with the track's static trimeshes and one PhysKart per kart.
// Owner: physics.
import { Vector3 } from 'three';
import type { Collider, EventQueue, World } from '@dimforge/rapier3d-compat';
import { SIM_DT } from '../core/types';
import type { Kart, KartSpawn, PhysicsSystem, RaceConfig, RaceSim, SurfaceType, TrackCollider, TrackRuntime } from '../core/types';
import { loadRapier } from './rapier';
import type { Rapier } from './rapier';
import { KART_GROUPS, PhysKart } from './kart';
import type { KartHost } from './kart';
import { PHYS } from './tuning';

const GROUND = 0x1, WALL = 0x2, KARTS = 0x4;
const GROUND_GROUPS = (GROUND << 16) | KARTS;
const WALL_GROUPS = (WALL << 16) | KARTS;
/** Wheel rays: see ground only. */
const RAY_GROUPS = (KARTS << 16) | GROUND;
/** Camera / generic queries: ground and walls. */
const SCENE_GROUPS = (KARTS << 16) | GROUND | WALL;

/** Extra queries the camera and sandbox use. */
export interface PhysicsQueries {
  /** Distance along `dir` (unit) to the first ground or wall hit, or -1. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, walls?: boolean): number;
}

export interface KartPhysicsSystem extends PhysicsSystem, PhysicsQueries {
  readonly world: World;
  readonly karts: readonly PhysKart[];
  /** Milliseconds spent in the last step (for perf readouts). */
  lastStepMs: number;
}

let active: KartPhysicsSystem | null = null;
/** The physics system of the running race, if any (used by the camera for ground checks). */
export function activePhysics(): KartPhysicsSystem | null { return active; }

export async function createPhysics(track: TrackRuntime, config: RaceConfig): Promise<KartPhysicsSystem> {
  const R = await loadRapier();
  return createPhysicsSync(R, track, config);
}

export function createPhysicsSync(R: Rapier, track: TrackRuntime, config: RaceConfig): KartPhysicsSystem {
  const world = new R.World({ x: 0, y: -PHYS.gravity, z: 0 });
  world.timestep = SIM_DT;
  const events: EventQueue = new R.EventQueue(true);
  const surfaceByHandle = new Map<number, SurfaceType>();
  const colliders: { def: TrackCollider; col: Collider }[] = [];
  const kartByHandle = new Map<number, PhysKart>();
  const karts: PhysKart[] = [];
  let sim: RaceSim | null = null;
  let unsub: (() => void) | null = null;

  for (const def of track.colliders) {
    const desc = R.ColliderDesc.trimesh(def.vertices, def.indices)
      .setCollisionGroups(def.kind === 'ground' ? GROUND_GROUPS : WALL_GROUPS)
      .setFriction(def.kind === 'ground' ? 0.3 : 0)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(def.kind === 'wall' ? 0.2 : 0)
      .setEnabled(def.enabled);
    const col = world.createCollider(desc);
    surfaceByHandle.set(col.handle, def.surface);
    colliders.push({ def, col });
  }
  const enabledFlags = colliders.map((c) => c.def.enabled);
  const syncEnabled = () => {
    for (let i = 0; i < colliders.length; i++) {
      const e = colliders[i].def.enabled;
      if (e !== enabledFlags[i]) { enabledFlags[i] = e; colliders[i].col.setEnabled(e); }
    }
  };

  const host: KartHost = {
    R, world,
    get sim() { return sim; },
    rayGroups: RAY_GROUPS,
    surfaceOf: (h) => surfaceByHandle.get(h) ?? 'road',
  };

  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

  const onContact = (e: { collider1(): number; collider2(): number }) => {
    const a = kartByHandle.get(e.collider1()), b = kartByHandle.get(e.collider2());
    if (a && b) { a.contactKart = b; b.contactKart = a; }
    else if (a) a.contactStatic = true;
    else if (b) b.contactStatic = true;
  };

  const system: KartPhysicsSystem = {
    world,
    karts,
    lastStepMs: 0,
    addKart(spawn: KartSpawn): Kart {
      const k = new PhysKart(karts.length, spawn.char, spawn.isHuman, spawn.pose, host, config.speedClass.speed);
      karts.push(k);
      kartByHandle.set(k.collider.handle, k);
      return k;
    },
    init(s: RaceSim) {
      sim = s;
      active = system;
      unsub = s.events.on('track:changed', syncEnabled);
      syncEnabled();
    },
    step(s: RaceSim, dt: number) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      sim = s;
      syncEnabled();
      for (const k of karts) k.preStep(s, dt);
      world.timestep = dt;
      world.step(events);
      events.drainContactForceEvents(onContact);
      for (const k of karts) k.postStep(s, dt);
      if (t0) system.lastStepMs = performance.now() - t0;
    },
    raycast(origin, dir, maxDist, walls = true) {
      ray.origin.x = origin.x; ray.origin.y = origin.y; ray.origin.z = origin.z;
      ray.dir.x = dir.x; ray.dir.y = dir.y; ray.dir.z = dir.z;
      const hit = world.castRay(ray, maxDist, true, undefined, walls ? SCENE_GROUPS : RAY_GROUPS);
      return hit ? hit.timeOfImpact : -1;
    },
    dispose() {
      unsub?.();
      if (active === system) active = null;
      sim = null;
      events.free();
      world.free();
      karts.length = 0;
    },
  };
  return system;
}

export { KART_GROUPS };
