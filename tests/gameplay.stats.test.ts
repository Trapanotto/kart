import { it } from 'vitest';
// Statistics over many seeded races (report only, no assertions). Print with:
//   N=40 npx vitest run tests/gameplay.stats.test.ts --disableConsoleIntercept
import { createHeadlessRace } from '../src/race/harness';
import { describeTarget, factoriesFromEnv } from '../src/race/envFactories';
it('race statistics', async () => {
  const F = await factoriesFromEnv();
  console.log(describeTarget());
  const lost: Record<string, number[]> = {};
  const got: Record<string, number> = {}, used: Record<string, number> = {}, hits: Record<string, number> = {}, abs: Record<string, number> = {}, blk: Record<string, number> = {};
  const spreads: number[] = [], humanRanks: number[] = [], winners: Record<string, number> = {};
  let drifts = 0, turbos = 0, bumps = 0, ms = 0, steps = 0; const starts: number[] = [];
  let flips = 0, respawns = 0, offroad = 0, slow = 0, rankEv = 0, time = 0, wrong = 0;
  const N = Number(process.env.N ?? 6);
  for (let seed = 1; seed <= N; seed++) {
    const r = await createHeadlessRace({ ...F, seed });
    const swaps: { a: number; b: number; t: number }[] = [];
    r.sim.events.on('race:rank', ({ kart, from, to }) => {
      if (to < from) {
        const other = r.rules.order[to]; // kart that was passed
        if (swaps.some((s) => s.a === other.id && s.b === kart.id && r.sim.time - s.t < 1.5)) flips++;
        swaps.push({ a: kart.id, b: other.id, t: r.sim.time });
      }
    });
    r.sim.events.on('kart:driftEnd', ({ level }) => { drifts++; if (level > 0) turbos++; });
    r.sim.events.on('kart:startBoost', ({ quality }) => { starts.push(quality); });
    r.sim.events.on('kart:collide', ({ other }) => { if (other) bumps++; });
    const t0 = performance.now();
    r.runToEnd(600);
    ms += performance.now() - t0; steps += r.sim.time * 60;
    const o = r.rules.order;
    spreads.push(o[o.length - 1].race.finishTime - o[0].race.finishTime);
    humanRanks.push(r.sim.player.race.rank);
    winners[o[0].char.id] = (winners[o[0].char.id] ?? 0) + 1;
    for (const h of r.stats.hits) if (h.lost !== undefined && h.clean) (lost[h.cause] ??= []).push(h.lost);
    const add = (dst: Record<string, number>, src: Record<string, number>) => { for (const k in src) dst[k] = (dst[k] ?? 0) + src[k]; };
    add(got, r.items!.stats.got); add(used, r.items!.stats.used); add(hits, r.items!.stats.hits); add(abs, r.items!.stats.absorbed); add(blk, r.items!.stats.blocked);
    respawns += r.stats.respawns; offroad += r.stats.offroad.reduce((a, b) => a + b, 0) / 8; slow += r.stats.slow.reduce((a, b) => a + b, 0) / 8;
    wrong += r.stats.wrongWay.reduce((a, b) => a + b, 0); rankEv += r.stats.rankEvents; time += r.sim.raceTime;
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  console.log('races', N, 'avg time', (time / N).toFixed(1), 'spread avg', avg(spreads).toFixed(2), 'min', Math.min(...spreads).toFixed(2), 'max', Math.max(...spreads).toFixed(2));
  console.log('human(bot) ranks', humanRanks.join(','), 'winners', JSON.stringify(winners));
  console.log('respawns', respawns, 'offroad frac', (offroad / N).toFixed(4), 'slow s/kart', (slow / N).toFixed(2), 'wrongway s', wrong.toFixed(1), 'rank events/race', (rankEv / N).toFixed(1), 'flip-backs<1.5s/race', (flips / N).toFixed(1));
  console.log('per race: drifts', (drifts / N).toFixed(1), 'mini-turbos', (turbos / N).toFixed(1), 'kart bumps', (bumps / N).toFixed(1), 'start boosts', starts.length / N, 'avg quality', avg(starts).toFixed(2), 'ms/step (whole sim)', (ms / steps).toFixed(3));
  console.log('item  got used hits absorbed blocked  lost(avg/max)');
  for (const id of Object.keys(got).sort()) console.log(id.padEnd(11), String(got[id] ?? 0).padStart(4), String(used[id] ?? 0).padStart(4), String(hits[id] ?? 0).padStart(4), String(abs[id] ?? 0).padStart(4), String(blk[id] ?? 0).padStart(4), lost[id] ? `${avg(lost[id]).toFixed(2)}/${Math.max(...lost[id]).toFixed(2)} n=${lost[id].length}` : '');
}, 600000);
