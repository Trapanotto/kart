// Gameplay: race rules, AI races, determinism, time trial. Headless.
// Rerun on other physics / tracks: GAMEPLAY_PHYSICS=... GAMEPLAY_TRACK=... (see src/race/envFactories.ts).
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Kart, KartController, RaceSim } from '../src/core/types';
import { createHeadlessRace, type HarnessOptions } from '../src/race/harness';
import { describeTarget, factoriesFromEnv } from '../src/race/envFactories';

let F: Pick<HarnessOptions, 'physics' | 'track'> = {};
beforeAll(async () => { F = await factoriesFromEnv(); });

const Z = new Vector3(0, 0, 1);

/** Moves a kart along the track by script: { to } drives (unwrapped progress), { jump } teleports. */
function scripted(steps: ({ to: number; v?: number } | { jump: number })[]): KartController & { done: boolean } {
  let i = 0, p = NaN;
  const c = {
    done: false,
    update(kart: Kart, sim: RaceSim) {
      if (sim.phase !== 'racing') return;
      if (Number.isNaN(p)) p = kart.loc.progress - sim.track.length; // start behind the line
      const s = steps[i];
      if (!s) { c.done = true; return; }
      if ('jump' in s) { p = s.jump; i++; }
      else {
        const v = s.v ?? 0.8;
        const d = s.to - p;
        if (Math.abs(d) <= v) { p = s.to; i++; } else p += Math.sign(d) * v;
      }
      const f = sim.track.sample(p, 0);
      kart.teleport({ pos: f.pos, quat: new Quaternion().setFromUnitVectors(Z, f.forward) });
      kart.input.throttle = 0;
    },
  };
  return c;
}

async function lapRace(steps: Parameters<typeof scripted>[0], laps = 3) {
  const ctrl = scripted(steps);
  const race = await createHeadlessRace({ ...F, karts: 1, items: false, laps, humanController: () => ctrl, rules: { timeLimit: 1e9 } });
  const lapEvents: number[] = [];
  race.sim.events.on('race:lap', ({ lap }) => lapEvents.push(lap));
  let finished = false;
  race.sim.events.on('race:finish', () => { finished = true; });
  for (let i = 0; i < 60 * 400 && !ctrl.done && !race.rules.over; i++) race.advance(1 / 60);
  race.advance(0.2);
  return { race, lapEvents, finished, L: race.sim.track.length };
}

describe(`race rules (${describeTarget()})`, () => {
  it('runs intro, 3-2-1-GO countdown and phases in order', async () => {
    const race = await createHeadlessRace({ ...F, laps: 1, rules: { intro: 1 } });
    const phases: string[] = [], counts: number[] = [];
    race.sim.events.on('race:phase', ({ phase }) => phases.push(phase));
    race.sim.events.on('race:countdown', ({ n }) => counts.push(n));
    race.advance(0.5);
    expect(race.sim.phase).toBe('intro');
    expect(race.sim.raceTime).toBeCloseTo(-3, 5);
    race.advance(4);
    expect(race.sim.phase).toBe('racing');
    expect(counts).toEqual([3, 2, 1, 0]);
    expect(race.runToEnd(300)).toBe(true);
    expect(phases).toEqual(['intro', 'countdown', 'racing', 'finished']);
   }, 600000);

  it('counts laps for a clean drive and finishes', async () => {
    const L0 = (await createHeadlessRace({ ...F, karts: 1 })).sim.track.length;
    const { lapEvents, finished, race } = await lapRace([{ to: 3 * L0 + 5 }], 3);
    expect(lapEvents).toEqual([1, 2, 3]);
    expect(finished).toBe(true);
    const r = race.sim.karts[0].race;
    expect(r.lapTimes.length).toBe(3);
    expect(r.finishTime).toBeCloseTo(r.lapTimes.reduce((a, b) => a + b, 0), 1);
    expect(r.bestLap).toBe(Math.min(...r.lapTimes));
  });

  it('takes the lap back when a kart reverses over the line', async () => {
    const L = (await createHeadlessRace({ ...F, karts: 1 })).sim.track.length;
    // Cross (lap 1), reverse back over the line, cross again, then wiggle over it repeatedly.
    const wiggle = Array.from({ length: 6 }, (_, i) => ({ to: i % 2 ? 15 : -15 }));
    const { lapEvents, race } = await lapRace([{ to: 25 }, { to: -40 }, ...wiggle, { to: 60 }], 3);
    expect(lapEvents).toEqual([1]);
    expect(race.sim.karts[0].race.lap).toBe(1);
    expect(race.sim.karts[0].race.distance).toBeLessThan(L * 0.2);
  });

  it('rejects a kart that skips half the track', async () => {
    const L = (await createHeadlessRace({ ...F, karts: 1 })).sim.track.length;
    // Lap 1 starts, then the kart "teleports" across the infield and drives over the line.
    const { lapEvents: a, race: ra } = await lapRace([{ to: 30 }, { jump: 0.55 * L }, { to: L + 30 }], 3);
    expect(a).toEqual([1]);
    expect(ra.sim.karts[0].race.lap).toBe(1);
    // A smaller cut (a third of the lap) is not counted either.
    const { lapEvents: b, race: rb } = await lapRace([{ to: 30 }, { jump: 0.36 * L }, { to: L + 30 }], 3);
    expect(b).toEqual([1]);
    expect(rb.sim.karts[0].race.lap).toBe(1);
    // After cheating, a full clean lap still counts.
    const { lapEvents: c } = await lapRace([{ to: 30 }, { jump: 0.55 * L }, { to: L + 30 }, { to: 2 * L + 30 }], 3);
    expect(c).toEqual([1, 2]);
  });

  it('flags driving the wrong way', async () => {
    let turned = false;
    const ctrl: KartController = {
      update(kart, sim) {
        if (sim.phase !== 'racing') return;
        if (!turned) {
          turned = true;
          const f = sim.track.sample(60, 0);
          kart.teleport({ pos: f.pos, quat: new Quaternion().setFromUnitVectors(Z, f.forward.clone().negate()) });
        }
        kart.input.throttle = 1;
        kart.input.steer = 0;
      },
    };
    const race = await createHeadlessRace({ ...F, karts: 1, items: false, humanController: () => ctrl });
    race.advance(3.7);
    expect(race.sim.karts[0].race.wrongWay).toBe(false);
    race.advance(2.5);
    expect(race.sim.karts[0].race.wrongWay).toBe(true);
  });
});

describe(`AI races (${describeTarget()})`, () => {
  it('8 karts finish 3 laps with a sane order and nobody stuck', async () => {
    const race = await createHeadlessRace({ ...F, seed: 7, laps: 3 });
    let over: Kart[] | null = null;
    race.sim.events.on('race:over', ({ order }) => { over = order; });
    expect(race.runToEnd(400)).toBe(true);
    expect(over).not.toBeNull();
    const order = over! as Kart[];
    expect(order.length).toBe(8);
    // Finishing times ascend along the final order; ranks match.
    for (let i = 1; i < order.length; i++) expect(order[i].race.finishTime).toBeGreaterThanOrEqual(order[i - 1].race.finishTime);
    order.forEach((k, i) => expect(k.race.rank).toBe(i + 1));
    // Every kart got around the track; at least 7 truly crossed the line (the last may be estimated).
    expect(order.filter((k) => k.race.finished).length).toBeGreaterThanOrEqual(7);
    for (const k of order) expect(k.race.lap).toBeGreaterThanOrEqual(3);
    const spread = order[7].race.finishTime - order[0].race.finishTime;
    expect(spread).toBeLessThan(30);
    expect(race.stats.respawns).toBeLessThanOrEqual(2);
    for (const s of race.stats.slow) expect(s).toBeLessThan(6);
   }, 600000);

  it('is deterministic for a seed', async () => {
    const run = async (seed: number) => {
      const r = await createHeadlessRace({ ...F, seed, laps: 2 });
      r.runToEnd(300);
      return r.rules.order.map((k) => `${k.char.id}:${k.race.finishTime.toFixed(4)}`).join(' ') + JSON.stringify(r.items!.stats);
    };
    const a = await run(11), b = await run(11), c = await run(12);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
   }, 600000);

  it('runs many seeded races without errors or stuck karts', async () => {
    let respawns = 0, slow = 0;
    for (let seed = 100; seed < 106; seed++) {
      const r = await createHeadlessRace({ ...F, seed, laps: 2 });
      expect(r.runToEnd(300)).toBe(true);
      respawns += r.stats.respawns;
      slow += r.stats.slow.reduce((x, y) => x + y, 0);
      expect(r.sim.entities.every((e) => Number.isFinite(e.pos.x + e.pos.y + e.pos.z))).toBe(true);
    }
    expect(respawns).toBeLessThanOrEqual(3);
    expect(slow / (6 * 8)).toBeLessThan(2);
   }, 600000);
});

describe(`time trial (${describeTarget()})`, () => {
  it('one kart, three carrots, no item boxes, lap and total times', async () => {
    const race = await createHeadlessRace({ ...F, mode: 'timetrial', laps: 3 });
    const k = race.sim.karts[0];
    expect(race.sim.karts.length).toBe(1);
    expect(k.item.id).toBe('carrot3');
    expect(k.item.count).toBe(3);
    expect(race.sim.entities.some((e) => e.kind === 'item.box')).toBe(false);
    let boosts = 0;
    race.sim.events.on('item:use', ({ item }) => { if (item === 'carrot3') boosts++; });
    expect(race.runToEnd(300)).toBe(true);
    expect(k.race.finished).toBe(true);
    expect(k.race.lapTimes.length).toBe(3);
    expect(k.race.finishTime).toBeCloseTo(k.race.lapTimes.reduce((a, b) => a + b, 0), 1);
    expect(boosts).toBe(3);
    expect(k.item.id).toBeNull();
    expect(race.items!.stats.boxes).toBe(0);
   }, 600000);
});
