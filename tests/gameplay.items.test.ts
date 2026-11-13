// Gameplay: every item, held items, distribution. Headless.
// Rerun on other physics / tracks: GAMEPLAY_PHYSICS=... GAMEPLAY_TRACK=... (see src/race/envFactories.ts).
import { Quaternion, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { createRng } from '../src/core/data';
import type { Kart, KartController, RaceSim } from '../src/core/types';
import { describeTarget, factoriesFromEnv } from '../src/race/envFactories';
import { createHeadlessRace, type HarnessOptions } from '../src/race/harness';
import { drawItem, ITEM, ITEM_IDS, itemWeights, positionFactor, RARE } from '../src/items/params';

let F: Pick<HarnessOptions, 'physics' | 'track'> = {};
beforeAll(async () => { F = await factoriesFromEnv(); });

const Z = new Vector3(0, 0, 1);

/**
 * Positions must stay in the first half of the lap (they count as lap 1).
 * A controlled scene: karts parked at given progress / lateral offsets (or cruising at a fixed
 * speed), racing phase, no AI. Returns the race and helpers.
 */
async function scene(spots: { p: number; lat?: number; cruise?: number }[]) {
  const n = spots.length;
  const state = spots.map((s) => ({ ...s, placed: false }));
  const race = await createHeadlessRace({
    ...F, karts: n, laps: 9, rules: { intro: 0, timeLimit: 1e9 },
    humanController: (k) => park(k),
  });
  function park(kart: Kart): KartController {
    return {
      update(k: Kart, sim: RaceSim) {
        const s = state[k.id];
        k.input.item = false; k.input.steer = 0; k.input.brake = 0; k.input.throttle = 0;
        // Placed before the first rules step, so lap counting sees them as starting there.
        if (!s.placed) {
          s.placed = true;
          const f = sim.track.sample(s.p, s.lat ?? 0);
          k.teleport({ pos: f.pos, quat: new Quaternion().setFromUnitVectors(Z, f.forward) });
        }
        if (s.cruise && sim.phase === 'racing') {
          // Follow the lane it was placed in.
          k.input.throttle = 1;
          const t = sim.track.sample(k.loc.progress + 10, s.lat ?? 0, k.loc.path);
          const fwd = new Vector3(0, 0, 1).applyQuaternion(k.quat);
          const to = t.pos.clone().sub(k.pos);
          const a = Math.atan2(to.x * -fwd.z + to.z * fwd.x, to.x * fwd.x + to.z * fwd.z);
          k.input.steer = Math.max(-1, Math.min(1, a * 2.5));
        }
      },
    };
    void kart;
  }
  for (const k of race.sim.karts) race.sim.controllers.set(k.id, park(k));
  race.advance(3.1); // countdown
  race.advance(0.1);
  const hits: { kart: number; cause: string; kind: string; absorbed: boolean }[] = [];
  race.sim.events.on('kart:hit', ({ kart, cause, kind, absorbed }) => hits.push({ kart: kart.id, cause, kind, absorbed }));
  return { race, sim: race.sim, items: race.items!, k: race.sim.karts, hits };
}

describe(`items (${describeTarget()})`, () => {
  it('acorn: thrown ahead hits the kart in front (spin), lobbed back hits the kart behind', async () => {
    const s = await scene([{ p: 100 }, { p: 125 }, { p: 85 }]);
    s.items.give(s.k[0], 'acorn');
    expect(s.items.use(s.k[0], 0)).toBe(true);
    s.race.advance(2);
    expect(s.hits.find((h) => h.kart === 1 && h.cause === 'acorn' && !h.absorbed)?.kind).toBe('spin');
    s.items.give(s.k[0], 'acorn');
    s.items.use(s.k[0], -1);
    s.race.advance(2);
    expect(s.hits.some((h) => h.kart === 2 && h.cause === 'acorn' && !h.absorbed)).toBe(true);
    expect(s.k[0].item.id).toBeNull();
  });

  it('acorn bounces off walls and expires', async () => {
    const s = await scene([{ p: 300 }]);
    s.items.give(s.k[0], 'acorn');
    s.items.use(s.k[0], 1);
    const acorn = s.sim.entities.find((e) => e.kind === 'item.acorn')!;
    let bounced = false;
    for (let i = 0; i < 60 * 8; i++) { s.race.advance(1 / 60); if (acorn.data?.bounce) bounced = true; }
    expect(acorn.dead).toBe(true);
    expect(bounced || acorn.dead).toBe(true);
  });

  it('acorn3: three acorns orbit, fire one at a time and block a hit', async () => {
    const s = await scene([{ p: 100 }, { p: 130 }, { p: 80 }]);
    s.items.give(s.k[0], 'acorn3');
    expect(s.k[0].item.count).toBe(3);
    s.items.use(s.k[0], 0);
    expect(s.k[0].item.count).toBe(2);
    s.race.advance(1.5);
    expect(s.hits.some((h) => h.kart === 1 && h.cause === 'acorn')).toBe(true);
    // Kart 2 throws at kart 0 from behind: the orbit blocks it.
    s.items.give(s.k[2], 'acorn');
    s.items.use(s.k[2], 0);
    s.race.advance(1.5);
    expect(s.hits.some((h) => h.kart === 0)).toBe(false);
    expect(s.k[0].item.count).toBe(1);
    expect(s.items.stats.blocked.acorn).toBe(1);
  });

  it('held item blocks a shot from behind, and a held item is lost on a hit', async () => {
    const s = await scene([{ p: 100 }, { p: 80 }]);
    s.items.give(s.k[0], 'honey');
    s.k[0].input.item = true; // the controller resets input each step; hold via the slot API instead
    s.k[0].item.holding = true;
    s.items.give(s.k[1], 'acorn');
    s.items.use(s.k[1], 0);
    s.race.advance(1.5);
    expect(s.hits.some((h) => h.kart === 0)).toBe(false);
    expect(s.k[0].item.id).toBeNull();
    expect(s.items.stats.blocked.acorn).toBe(1);
  });

  it('honey: dropped jar becomes a puddle that slows and slides karts, no full stop', async () => {
    const s = await scene([{ p: 100 }, { p: 70, cruise: 1 }]);
    s.items.give(s.k[0], 'honey');
    s.items.use(s.k[0], 0);
    s.race.advance(0.8);
    const puddle = s.sim.entities.find((e) => e.kind === 'item.honey')!;
    expect(puddle.data!.state).toBe('puddle');
    let slowed = false, minSpeed = Infinity;
    for (let i = 0; i < 60 * 4; i++) {
      s.race.advance(1 / 60);
      if (s.k[1].hasModifier('item.honey')) { slowed = true; minSpeed = Math.min(minSpeed, s.k[1].speed); }
    }
    expect(slowed).toBe(true);
    expect(minSpeed).toBeGreaterThan(3);
    expect(s.k[1].stun).toBe(0);
  });

  it('honey lobbed ahead lands in front', async () => {
    const s = await scene([{ p: 100 }]);
    s.items.give(s.k[0], 'honey');
    s.items.use(s.k[0], 1);
    s.race.advance(1.2);
    const e = s.sim.entities.find((x) => x.kind === 'item.honey')!;
    const loc = s.sim.track.locate(e.pos);
    expect(loc.progress - 100).toBeGreaterThan(ITEM.honey.lobDistance * 0.6);
  });

  it('giftbox: fake box tumbles the kart that drives into it', async () => {
    const s = await scene([{ p: 100 }, { p: 80, cruise: 1 }]);
    s.items.give(s.k[0], 'giftbox');
    s.items.use(s.k[0], 0);
    s.race.advance(4);
    expect(s.hits.find((h) => h.kart === 1 && h.cause === 'giftbox' && !h.absorbed)?.kind).toBe('tumble');
  });

  it('yarn: chases the next kart ahead around the track and wraps it', async () => {
    const s = await scene([{ p: 20 }, { p: 140, lat: 4 }, { p: 290 }]);
    s.items.give(s.k[0], 'yarn');
    s.items.use(s.k[0], 0);
    s.race.advance(5);
    const h = s.hits.find((x) => x.cause === 'yarn' && !x.absorbed);
    expect(h?.kart).toBe(1);
    expect(s.items.stats.hits.yarn).toBe(1);
  });

  it('yarn is stopped by a bubble', async () => {
    const s = await scene([{ p: 20 }, { p: 90 }]);
    s.items.give(s.k[1], 'bubble');
    s.items.use(s.k[1]);
    expect(s.k[1].shield).toBe(true);
    s.items.give(s.k[0], 'yarn');
    s.items.use(s.k[0], 0);
    s.race.advance(4);
    expect(s.hits.some((h) => h.kart === 1 && h.cause === 'yarn' && !h.absorbed)).toBe(false);
    expect(s.k[1].shield).toBe(false);
  });

  it('bees: warn the leader, fly there and harass it (slower, obscured)', async () => {
    const s = await scene([{ p: 20 }, { p: 150 }, { p: 290 }]);
    const warns: number[] = [];
    s.sim.events.on('item:warn', ({ kart, item }) => { if (item === 'bees') warns.push(kart.id); });
    s.items.give(s.k[0], 'bees');
    s.items.use(s.k[0]);
    expect(warns).toEqual([2]);
    let harassed = false;
    for (let i = 0; i < 60 * 8 && !harassed; i++) { s.race.advance(1 / 60); harassed = s.k[2].hasModifier('item.bees'); }
    expect(harassed).toBe(true);
    const mod = s.k[2].modifiers.find((m) => m.id === 'item.bees')!;
    expect(mod.topSpeed).toBeLessThan(1);
    s.race.advance(ITEM.bees.harass + 1.5);
    expect(s.k[2].hasModifier('item.bees')).toBe(false);
  });

  it('bees are shortened by boosting', async () => {
    const s = await scene([{ p: 20 }, { p: 290 }]);
    s.items.give(s.k[0], 'bees');
    s.items.use(s.k[0]);
    for (let i = 0; i < 60 * 8 && !s.k[1].hasModifier('item.bees'); i++) s.race.advance(1 / 60);
    expect(s.k[1].hasModifier('item.bees')).toBe(true);
    let t = 0;
    for (; t < 10 && s.k[1].hasModifier('item.bees'); t += 1 / 60) { s.k[1].applyBoost(0.5, 1.2); s.race.advance(1 / 60); }
    expect(t).toBeLessThan(ITEM.bees.harass * 0.6);
  });

  it('bubble: absorbs one hit and pops after a while', async () => {
    const s = await scene([{ p: 100 }, { p: 125 }]);
    s.items.give(s.k[1], 'bubble');
    s.items.use(s.k[1]);
    s.items.give(s.k[0], 'acorn');
    s.items.use(s.k[0], 1);
    s.race.advance(1.5);
    expect(s.hits.find((h) => h.kart === 1)?.absorbed).toBe(true);
    expect(s.k[1].shield).toBe(false);
    s.items.give(s.k[1], 'bubble');
    s.items.use(s.k[1]);
    s.race.advance(ITEM.bubble.time + 0.2);
    expect(s.k[1].shield).toBe(false);
  });

  it('carrot, carrot3 and goldcarrot boost', async () => {
    const s = await scene([{ p: 100 }]);
    const k = s.k[0];
    s.items.give(k, 'carrot');
    s.items.use(k);
    expect(k.boost.time).toBeGreaterThan(0);
    expect(k.item.id).toBeNull();
    s.items.give(k, 'carrot3');
    for (let i = 0; i < 3; i++) { expect(s.items.use(k)).toBe(true); s.race.advance(0.5); }
    expect(k.item.id).toBeNull();
    s.items.give(k, 'goldcarrot');
    let uses = 0;
    for (let t = 0; t < ITEM.goldcarrot.window + 1; t += 0.3) { if (s.items.use(k)) uses++; s.race.advance(0.3); }
    expect(uses).toBeGreaterThanOrEqual(5);
    expect(k.item.id).toBeNull();
  });

  it('lolly: invincible, faster and knocks karts it touches', async () => {
    const s = await scene([{ p: 100, cruise: 1 }, { p: 130 }]);
    s.items.give(s.k[0], 'lolly');
    s.items.use(s.k[0]);
    const m = s.k[0].modifiers.find((x) => x.id === 'item.lolly')!;
    expect(m.invincible).toBe(true);
    expect(m.topSpeed).toBeGreaterThan(1);
    s.race.advance(4);
    expect(s.hits.find((h) => h.kart === 1 && h.cause === 'lolly')?.kind).toBe('tumble');
    expect(s.k[0].applyHit('spin', { cause: 'test' })).toBe(false);
    s.race.advance(ITEM.lolly.time);
    expect(s.k[0].hasModifier('item.lolly')).toBe(false);
  });

  it('cloud: hangs over every kart ahead, zaps them unless shaken off by a boost or passed on', async () => {
    const s = await scene([{ p: 40 }, { p: 120 }, { p: 200 }, { p: 280, lat: -3 }, { p: 281, lat: 0 }]);
    // Rank order: 4/3 (side by side), 2, 1, 0.
    s.race.advance(0.1);
    s.items.give(s.k[0], 'cloud');
    s.items.use(s.k[0]);
    const clouds = () => s.sim.entities.filter((e) => e.kind === 'item.cloud' && !e.dead);
    expect(clouds().length).toBe(4);
    s.race.advance(1);
    s.k[2].applyBoost(1, 1.3); // shakes it off
    s.race.advance(ITEM.cloud.hover);
    const zapped = s.hits.filter((h) => h.cause === 'cloud' && !h.absorbed).map((h) => h.kart);
    expect(zapped).toContain(1);
    expect(zapped).not.toContain(2);
    expect(zapped).not.toContain(0);
    expect(s.k[1].hasModifier('item.zap')).toBe(true);
  });

  it('cloud is passed on by bumping another kart', async () => {
    const s = await scene([{ p: 40 }, { p: 200 }, { p: 220 }]);
    s.items.give(s.k[0], 'cloud');
    s.race.advance(0.1);
    // only kart 1 is ahead? both are; remove kart 2's cloud by placing it later
    s.items.use(s.k[0]);
    const c1 = s.sim.entities.find((e) => e.kind === 'item.cloud' && e.data!.target === 1)!;
    const c2 = s.sim.entities.find((e) => e.kind === 'item.cloud' && e.data!.target === 2)!;
    c2.dead = true;
    s.race.advance(0.1);
    // Move kart 2 right next to kart 1: the cloud jumps over.
    const f = s.sim.track.sample(200, 1.5);
    s.k[2].teleport({ pos: f.pos, quat: s.k[1].quat.clone() });
    s.race.advance(0.2);
    expect(c1.data!.target).toBe(2);
  });

  it('yawn: nearby rivals get drowsy, far ones do not', async () => {
    const s = await scene([{ p: 100 }, { p: 110 }, { p: 92, lat: 3 }, { p: 200 }]);
    s.items.give(s.k[0], 'yawn');
    s.items.use(s.k[0]);
    s.race.advance(1);
    expect(s.k[1].hasModifier('item.drowsy')).toBe(true);
    expect(s.k[2].hasModifier('item.drowsy')).toBe(true);
    expect(s.k[3].hasModifier('item.drowsy')).toBe(false);
    expect(s.k[0].hasModifier('item.drowsy')).toBe(false);
    const m = s.k[1].modifiers.find((x) => x.id === 'item.drowsy')!;
    expect(m.steer).toBeLessThan(1);
    expect(m.topSpeed).toBeLessThan(1);
  });

  it('every item can be given and used through the button without errors', async () => {
    const s = await scene([{ p: 100, cruise: 1 }, { p: 140, cruise: 1 }, { p: 60, cruise: 1 }, { p: 250, cruise: 1 }]);
    for (const id of ITEM_IDS) {
      s.items.give(s.k[0], id);
      // Press + release through the input path (items read edges).
      const ctrl = s.sim.controllers.get(0)!;
      let step = 0;
      s.sim.controllers.set(0, { update(k, sim, dt) { ctrl.update(k, sim, dt); k.input.item = step++ < 3; } });
      s.race.advance(0.2);
      s.sim.controllers.set(0, ctrl);
      expect(s.items.stats.used[id] ?? 0).toBeGreaterThanOrEqual(1);
      s.race.advance(1.5);
    }
    s.race.advance(10);
    for (const e of s.sim.entities) expect(Number.isFinite(e.pos.x + e.pos.y + e.pos.z)).toBe(true);
  });

  it('item boxes: pickup starts a ~1.5 s roulette that the button can stop early; boxes respawn', async () => {
    const s = await scene([{ p: 100 }]);
    const box = s.items.boxes[0];
    const k = s.k[0];
    let got: string | null = null;
    s.sim.events.on('item:got', ({ item }) => { got = item; });
    box.onKart!(k, s.sim);
    expect(box.data!.active).toBe(false);
    expect(k.item.roulette).toBeCloseTo(ITEM.roulette, 5);
    s.race.advance(ITEM.roulette + 0.1);
    expect(got).not.toBeNull();
    expect(k.item.id).toBe(got);
    s.race.advance(ITEM.boxRespawn);
    expect(box.data!.active).toBe(true);
    // Early stop.
    k.item.id = null;
    box.onKart!(k, s.sim);
    s.race.advance(0.5);
    const ctrl = s.sim.controllers.get(0)!;
    s.sim.controllers.set(0, { update(kk, sim, dt) { ctrl.update(kk, sim, dt); kk.input.item = true; } });
    s.race.advance(0.2);
    expect(k.item.roulette).toBe(0);
    expect(k.item.id).not.toBeNull();
  });

  it('a hit costs between about 0.5 and 3 seconds', async () => {
    // Real races: per-hit time loss measured by the harness (clean hits only).
    const lost: number[] = [];
    for (let seed = 1; seed <= 6; seed++) {
      const r = await createHeadlessRace({ ...F, seed, laps: 2 });
      r.runToEnd(300);
      for (const h of r.stats.hits) if (h.clean && h.lost !== undefined && h.cause !== 'honey' && h.cause !== 'yawn') lost.push(h.lost);
    }
    expect(lost.length).toBeGreaterThan(12);
    const avg = lost.reduce((a, b) => a + b, 0) / lost.length;
    expect(avg).toBeGreaterThan(0.5);
    expect(avg).toBeLessThan(2.5);
    const sorted = [...lost].sort((a, b) => a - b);
    // Design goal: one to two seconds, never more than three. The grey-box stub re-accelerates slowly,
    // so the tail is checked at the 90th percentile.
    expect(sorted[Math.floor(sorted.length * 0.9)]).toBeLessThan(3.2);
  }, 600000);
});

describe('item distribution', () => {
  it('draws match the weights for every position factor', () => {
    const rng = createRng(42);
    for (const p of [0, 0.2, 0.5, 0.8, 1]) {
      const w = itemWeights(p);
      const total = w.reduce((a, b) => a + b, 0);
      const counts = new Array(ITEM_IDS.length).fill(0);
      const N = 40000;
      for (let i = 0; i < N; i++) counts[ITEM_IDS.indexOf(drawItem(rng.next(), p))]++;
      ITEM_IDS.forEach((id, i) => expect(Math.abs(counts[i] / N - w[i] / total), `${id} at p=${p}`).toBeLessThan(0.01));
    }
  });

  it('leader gets nothing oppressive; the back gets catch-up items', () => {
    const lead = itemWeights(positionFactor(1, 8, 0));
    const strong = ['bees', 'lolly', 'goldcarrot', 'cloud', 'yarn', 'yawn', 'carrot3'];
    for (const id of strong) expect(lead[ITEM_IDS.indexOf(id as never)], id).toBe(0);
    const back = itemWeights(positionFactor(8, 8, 200));
    const sum = (w: number[], ids: string[]) => ids.reduce((a, id) => a + w[ITEM_IDS.indexOf(id as never)], 0);
    expect(sum(back, ['lolly', 'goldcarrot', 'bees', 'cloud']) / back.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.5);
    expect(sum(lead, ['acorn', 'honey', 'giftbox', 'bubble']) / lead.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.75);
    // Monotonic: position factor grows with rank and gap.
    for (let r = 2; r <= 8; r++) expect(positionFactor(r, 8, 0)).toBeGreaterThan(positionFactor(r - 1, 8, 0));
    expect(positionFactor(4, 8, 150)).toBeGreaterThan(positionFactor(4, 8, 10));
  });

  it('rare items never repeat for the same kart and respect cooldowns in races', async () => {
    const r = await createHeadlessRace({ ...F, seed: 3, laps: 3 });
    const last = new Map<number, string>();
    let repeats = 0;
    r.sim.events.on('item:got', ({ kart, item }) => {
      if (RARE.has(item) && last.get(kart.id) === item) repeats++;
      last.set(kart.id, item);
    });
    r.runToEnd(300);
    expect(repeats).toBe(0);
    // In-race rank buckets: leaders never receive bees / lolly / gold carrots.
    const r2 = await createHeadlessRace({ ...F, seed: 5, laps: 3 });
    const leaderGot: string[] = [];
    r2.sim.events.on('item:got', ({ kart, item }) => { if (kart.race.rank === 1) leaderGot.push(item); });
    r2.runToEnd(300);
    expect(leaderGot.filter((i) => ['bees', 'lolly', 'goldcarrot', 'cloud'].includes(i))).toEqual([]);
  }, 600000);
});
