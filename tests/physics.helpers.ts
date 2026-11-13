// Shared helpers for the physics tests. Owner: physics.
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { CharacterId, KartController, Pose, RaceSim, SimSystem, TrackRuntime } from '../src/core/types';
import { createPhysics } from '../src/physics';
import type { KartPhysicsSystem, PhysKart } from '../src/physics';
import { createTestTrack } from '../src/stubs/testTrack';

/** Puts the sim straight into 'racing' (no countdown). */
export const racingNow: SimSystem = { step(sim) { if (sim.phase !== 'racing' && sim.phase !== 'finished') { sim.phase = 'racing'; sim.raceTime = 0; } else sim.raceTime += 1 / 60; } };

export interface Setup {
  sim: Sim;
  physics: KartPhysicsSystem;
  karts: PhysKart[];
  track: TrackRuntime;
}

export async function setup(opts: { chars?: CharacterId[]; track?: TrackRuntime; systems?: SimSystem[]; poses?: Pose[]; seed?: number } = {}): Promise<Setup> {
  const track = opts.track ?? createTestTrack();
  const cfg = { trackId: 'test', speedClass: SPEED_CLASSES[1], player: (opts.chars?.[0] ?? 'otter') as CharacterId, laps: 3, mode: 'race' as const, seed: opts.seed ?? 1 };
  const physics = await createPhysics(track, cfg);
  const sim = new Sim({ config: cfg, track, physics, systems: opts.systems ?? [racingNow] });
  const chars = opts.chars ?? ['otter'];
  chars.forEach((id, i) => {
    const k = physics.addKart({ char: character(id), isHuman: i === 0, pose: opts.poses?.[i] ?? track.startGrid[i] });
    sim.karts.push(k);
  });
  sim.start();
  return { sim, physics, karts: sim.karts as PhysKart[], track };
}

export function run(sim: RaceSim, seconds: number, each?: (t: number) => boolean | void): number {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    sim.step();
    if (each && each(i / 60) === true) return i / 60;
  }
  return seconds;
}

export function drive(ctrl: Partial<{ throttle: number; brake: number; steer: number; drift: boolean }>): KartController {
  return { update(k) { Object.assign(k.input, ctrl); } };
}

export const ALL = CHARACTERS.map((c) => c.id);

/** The test track's frame functions over one huge flat tarmac plane (room for drift circles). */
export function flatTrack(): TrackRuntime {
  const base = createTestTrack();
  const G = 500;
  return Object.assign(Object.create(null), base, {
    colliders: [{ id: 'pad', kind: 'ground', surface: 'road', vertices: new Float32Array([-G, 0, -G, G, 0, -G, G, 0, G, -G, 0, G]), indices: new Uint32Array([0, 2, 1, 0, 3, 2]), enabled: true }],
  }) as TrackRuntime;
}
