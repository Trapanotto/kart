// Headless race harness: builds a full race (rules, items, AI) on any PhysicsSystem / TrackRuntime
// and collects statistics. Used by tests/gameplay*.test.ts and the sandbox; rerun it on the real
// physics and on real tracks by passing other factories. Owner: gameplay. No DOM.
import { character, CHARACTERS, SPEED_CLASSES } from '../core/data';
import { Sim } from '../core/sim';
import { SIM_DT } from '../core/types';
import type { CharacterId, Kart, KartController, PhysicsSystem, RaceConfig, SimSystem, TrackRuntime } from '../core/types';
import { createAI } from '../ai/driver';
import { createItemSystem, type ItemSystem } from '../items/system';
import { createRaceRules, type RaceRules, type RaceRulesOptions } from './rules';

export interface HarnessOptions {
  /** Default: stub physics. */
  physics?: (track: TrackRuntime, config: RaceConfig) => PhysicsSystem | Promise<PhysicsSystem>;
  /** Default: grey-box test track. */
  track?: () => TrackRuntime | Promise<TrackRuntime>;
  seed?: number;
  laps?: number;
  /** Number of karts (1..8). Default 8, or 1 in time trial. */
  karts?: number;
  player?: CharacterId;
  mode?: RaceConfig['mode'];
  speedClass?: RaceConfig['speedClass'];
  /** Use items (default true). */
  items?: boolean;
  rules?: RaceRulesOptions;
  /** Controller for the human kart; default: AI (a bot plays the human slot). */
  humanController?: (kart: Kart, sim: Sim) => KartController;
}

export interface HitRecord {
  kart: number; cause: string; time: number; speedBefore: number; distBefore: number;
  /** Seconds lost vs. the pre-hit pace, measured over 5 s. */
  lost?: number;
  /** No other hit (and no respawn) on the same kart within the measuring window. */
  clean?: boolean;
}

export interface RaceStats {
  hits: HitRecord[];
  respawns: number;
  /** Per kart: fraction of racing steps spent off the road. */
  offroad: number[];
  /** Per kart: seconds spent flagged wrong-way. */
  wrongWay: number[];
  /** Per kart: total seconds below 3 m/s while racing and not stunned (stuck-ish). */
  slow: number[];
  rankEvents: number;
  laps: number;
}

export interface HeadlessRace {
  sim: Sim;
  rules: RaceRules;
  items: ItemSystem | null;
  stats: RaceStats;
  /** Steps for `seconds` of sim time (or until the race is over if `untilOver`). */
  advance(seconds: number, untilOver?: boolean): void;
  /** Runs until race:over or `maxSeconds`; returns true if the race ended. */
  runToEnd(maxSeconds?: number): boolean;
  dispose(): void;
}

export async function createHeadlessRace(opts: HarnessOptions = {}): Promise<HeadlessRace> {
  const track = await (opts.track ? opts.track() : (await import('../stubs/testTrack')).createTestTrack());
  const mode = opts.mode ?? 'race';
  const config: RaceConfig = {
    trackId: track.meta.id,
    speedClass: opts.speedClass ?? SPEED_CLASSES[1],
    player: opts.player ?? 'otter',
    laps: opts.laps ?? 3,
    seed: opts.seed ?? 1,
    mode,
  };
  const physics = await (opts.physics ? opts.physics(track, config) : (await import('../stubs/stubPhysics')).createStubPhysics());
  const items = opts.items === false ? null : createItemSystem();
  const rules = createRaceRules({ intro: 0.5, ...opts.rules });
  const systems: SimSystem[] = items ? [items, rules] : [rules];
  const sim = new Sim({ config, track, physics, systems });

  const n = Math.max(1, Math.min(8, opts.karts ?? (mode === 'timetrial' ? 1 : 8)));
  const others = CHARACTERS.map((c) => c.id).filter((id) => id !== config.player);
  const grid: CharacterId[] = n === 1 ? [config.player] : [...others.slice(0, n - 1), config.player];
  grid.forEach((id, i) => {
    const kart = physics.addKart({ char: character(id), isHuman: id === config.player, pose: track.startGrid[i] });
    sim.karts.push(kart);
  });
  for (const k of sim.karts) {
    sim.controllers.set(k.id, k.isHuman && opts.humanController ? opts.humanController(k, sim) : createAI(k, sim));
  }

  const stats: RaceStats = {
    hits: [], respawns: 0, offroad: sim.karts.map(() => 0), wrongWay: sim.karts.map(() => 0), slow: sim.karts.map(() => 0), rankEvents: 0, laps: sim.laps,
  };
  const racingSteps = sim.karts.map(() => 0);
  const pending: HitRecord[] = [];
  const unsub = [
    sim.events.on('kart:hit', ({ kart, absorbed, cause }) => {
      if (absorbed) return;
      const h: HitRecord = { kart: kart.id, cause, time: sim.time, speedBefore: Math.max(1, kart.topSpeed), distBefore: kart.race.distance, clean: true };
      for (const p of pending) if (p.kart === kart.id) { p.clean = false; h.clean = false; }
      stats.hits.push(h);
      pending.push(h);
    }),
    sim.events.on('kart:respawn', ({ kart }) => {
      stats.respawns++;
      for (const p of pending) if (p.kart === kart.id) p.clean = false; // fell off / stuck: not the hit's cost
    }),
    sim.events.on('race:rank', () => { stats.rankEvents++; }),
  ];
  // Time lost per hit: distance covered in the 5 s after the hit vs. what the kart covered at its pre-hit pace.
  const WINDOW = 5;
  const trackHits = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const h = pending[i];
      if (sim.time - h.time < WINDOW) continue;
      const k = sim.karts[h.kart];
      const covered = k.race.distance - h.distBefore;
      h.lost = Math.max(0, WINDOW - covered / h.speedBefore);
      pending.splice(i, 1);
    }
  };

  sim.start();
  const stepOnce = () => {
    sim.step();
    if (sim.phase === 'racing') {
      for (const k of sim.karts) {
        if (k.race.finished) continue;
        racingSteps[k.id]++;
        if (!k.loc.onRoad) stats.offroad[k.id]++;
        if (k.race.wrongWay) stats.wrongWay[k.id] += SIM_DT;
        if (Math.abs(k.speed) < 3 && k.stun <= 0 && sim.raceTime > 3) stats.slow[k.id] += SIM_DT;
      }
    }
    trackHits();
  };
  const finalize = () => {
    for (const k of sim.karts) stats.offroad[k.id] = racingSteps[k.id] ? stats.offroad[k.id] / racingSteps[k.id] : 0;
  };
  let finalized = false;

  return {
    sim, rules, items, stats,
    advance(seconds, untilOver = false) {
      const steps = Math.round(seconds / SIM_DT);
      for (let i = 0; i < steps; i++) {
        stepOnce();
        if (untilOver && rules.over) break;
      }
    },
    runToEnd(maxSeconds = 600) {
      const steps = Math.round(maxSeconds / SIM_DT);
      for (let i = 0; i < steps && !rules.over; i++) stepOnce();
      if (!finalized) { finalized = true; finalize(); }
      return rules.over;
    },
    dispose() {
      for (const u of unsub) u();
      sim.dispose();
    },
  };
}
