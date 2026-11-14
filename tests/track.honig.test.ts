// Honigfabrik: validator, lap events (flood stages, cannon), script hazards, and a headless
// 8-kart 3-lap race with the real physics + AI (respawn hot spots, lap times).
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { Vector3 } from 'three';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { GameEvents } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { buildTrack, loadTrack, TRACK_DEFS } from '../src/track';
import { validateTrack } from '../tools/track/validate';

const def = TRACK_DEFS.find((d) => d.id === 'honig')!;
const hasStack = existsSync('src/race/harness.ts') && existsSync('src/physics/index.ts');

describe('Honigfabrik', () => {
  const track = buildTrack(def);

  it('passes the track validator', () => {
    const r = validateTrack(track, { lapLength: [1150, 1350], minRadius: 15 });
    const anchors = [...track.paths[0].anchors].map(([k, v]) => `${k}@${v.toFixed(0)}`).join(' ');
    console.log('metrics', r.metrics, 'build ms', Math.round(track.stats.total), '\nanchors', anchors,
      '\nbranches', track.branches.map((b) => `${track.paths[b.path].id}: gain ${b.gain} side ${b.side}`).join(', '));
    if (r.warnings.length) console.log('warnings', r.warnings);
    expect(r.errors).toEqual([]);
  });

  it('runs a 3-lap stub race and fires the flood and cannon events', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'honig', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race', seed: 3 }, track: t, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: t.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    const events: GameEvents['track:event'][] = [];
    const kinds = new Set<string>();
    sim.events.on('track:event', (e) => events.push(e));
    sim.events.on('entity:add', ({ entity }) => kinds.add(entity.kind));
    const flood = t.colliders.filter((c) => c.id.startsWith('patch.sticky:flood'));
    expect(flood.length).toBe(5);
    sim.start();
    expect(flood.every((c) => !c.enabled)).toBe(true);
    expect(t.zones.find((z) => z.kind === 'cannon')!.enabled).toBe(false);
    let lap2Flood = -1;
    for (let i = 0; i < 60 * 400 && !sim.karts.every((k) => k.race.finished); i++) {
      sim.step();
      if (sim.phase === 'finished') sim.phase = 'racing';
      if (lap2Flood < 0 && t.colliders.find((c) => c.id === 'patch.sticky:floodA2')!.enabled) lap2Flood = t.state.lap;
    }
    expect(sim.karts.filter((k) => k.race.finished).length).toBe(8);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['honeyFlood2', 'honeyFlood3', 'cannonOpen']));
    expect(lap2Flood).toBe(2);
    expect(flood.every((c) => c.enabled)).toBe(true);
    const cannon = t.zones.find((z) => z.kind === 'cannon')!;
    expect(cannon.enabled).toBe(true);
    expect(cannon.target).toBeDefined();
    expect(kinds.has('hazard.honeyPress')).toBe(true);
    expect(kinds.has('hazard.honeyBarrel')).toBe(true);
    // a fresh race resets everything
    t.createEntities(sim);
    expect(flood.every((c) => !c.enabled)).toBe(true);
    expect(cannon.enabled).toBe(false);
    expect(t.colliders.find((c) => c.id === 'door.cannonLid')?.enabled ?? true).toBe(true);
    sim.dispose();
  });

  it.skipIf(!hasStack)('real physics + AI: 3 laps, lap events, respawns', async () => {
    const { createHeadlessRace } = await import('../src/race/harness');
    const { createPhysics } = await import('../src/physics/index');
    const seeds = Number(process.env.N ?? 3);
    let respawns = 0;
    const spots: string[] = [];
    const bests: number[] = [], spreads: number[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = await createHeadlessRace({ physics: createPhysics as any, track: () => loadTrack('honig'), seed, rules: { grace: 150 } } as any);
      const names: string[] = [];
      const hits = new Map<string, number>();
      let cannonShots = 0, gantry = 0;
      r.sim.events.on('track:event', (e) => names.push(e.name));
      r.sim.events.on('kart:hit', (e) => { if (!e.absorbed) { hits.set(e.cause, (hits.get(e.cause) ?? 0) + 1); if (e.cause === 'press' && process.env.PRESSDBG) console.log('press hit', e.kart.char.id, e.kart.loc.progress.toFixed(1), e.kart.loc.lat.toFixed(2), e.kart.speed.toFixed(1)); } });
      r.sim.events.on('fx', (e) => { if (e.name === 'cannon') cannonShots++; });
      const hist = new Map<number, string[]>();
      let tick = 0;
      const orig = r.sim.step.bind(r.sim);
      const gantryPath = (r.sim.track as any).paths.findIndex((p: any) => p.id === 'gantry');
      const onGantry = new Set<string>();
      (r.sim as any).step = () => {
        orig();
        if (++tick % 30 === 0) for (const k of r.sim.karts) {
          const h = hist.get(k.id) ?? [];
          h.push(`${k.loc.path}:${k.loc.progress.toFixed(0)}/${k.loc.lat.toFixed(1)}/${k.speed.toFixed(1)}`);
          if (h.length > 8) h.shift();
          hist.set(k.id, h);
          if (k.loc.path === gantryPath) onGantry.add(`${k.id}:${k.race.lap}`);
        }
      };
      r.sim.events.on('kart:respawn', ({ kart }) => { respawns++; spots.push(`seed${seed} ${kart.char.id} lap${kart.race.lap} path${kart.loc.path} p${kart.loc.progress.toFixed(0)} lat${kart.loc.lat.toFixed(1)} h${kart.loc.height.toFixed(1)} | ${(hist.get(kart.id) ?? []).join(' ')}`); });
      const over = r.runToEnd(600);
      gantry = onGantry.size;
      const o = r.rules.order;
      const best = Math.min(...o.map((k) => k.race.bestLap));
      const spread = o[o.length - 1].race.finishTime - o[0].race.finishTime;
      bests.push(best); spreads.push(spread);
      console.log(`seed ${seed} over ${over} finished ${o.filter((k) => k.race.finished).length} best lap ${best.toFixed(1)} spread ${spread.toFixed(1)} events ${[...new Set(names)].join(',')} cannon ${cannonShots} gantry ${gantry} hits ${[...hits].map(([k, v]) => k + ':' + v).join(' ')} laps ${o.map((k) => k.race.lapTimes.map((x) => x.toFixed(1)).join('/')).join(' ')}`);
      expect(o.every((k) => k.race.finished)).toBe(true);
      expect(names).toEqual(expect.arrayContaining(['honeyFlood2', 'honeyFlood3', 'cannonOpen']));
      r.dispose();
    }
    console.log('respawns', respawns, 'per race', (respawns / seeds).toFixed(2), 'best', bests.map((b) => b.toFixed(1)).join(' '), 'spread', spreads.map((b) => b.toFixed(1)).join(' '), '\n' + spots.join('\n'));
  }, 900000);
});
