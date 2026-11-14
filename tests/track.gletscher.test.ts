// Gletscher-Gipfel: validator, lap events (cave crack, avalanche) and headless races with the real
// physics + gameplay AI. Prints lap times, finish spread and every respawn with its history.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { GameEvents } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { buildTrack, loadTrack, TRACK_DEFS } from '../src/track';
import type { GletscherState } from '../src/track/scripts/gletscher';
import { validateTrack } from '../tools/track/validate';

const def = TRACK_DEFS.find((d) => d.id === 'gletscher')!;
const hasStack = existsSync('src/race/harness.ts') && existsSync('src/physics/index.ts');

describe('Gletscher-Gipfel', () => {
  const track = buildTrack(def);

  it('passes the track validator', () => {
    const r = validateTrack(track, { lapLength: [1300, 1500], minRadius: 15 });
    let ymin = Infinity, ymax = -Infinity;
    for (const v of track.paths[0].pos) { ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y); }
    console.log('metrics', r.metrics, 'elevation', ymin.toFixed(1), '..', ymax.toFixed(1), 'build ms', Math.round(track.stats.total));
    if (r.warnings.length) console.log('warnings', r.warnings);
    expect(r.errors).toEqual([]);
    expect(ymax - ymin).toBeGreaterThan(35);
    expect(ymax - ymin).toBeLessThan(45);
  });

  it('lap events toggle the cave, the avalanche pile and the lake detour; a new race resets them', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'gletscher', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race' }, track: t, physics, systems: [createStubRules()] });
    const ents = t.createEntities(sim);
    expect(ents.filter((e) => e.kind === 'hazard.icicle').length).toBeGreaterThan(10);
    const col = (id: string) => t.colliders.find((c) => c.id === id)!;
    const br = (id: string) => t.branches.find((b) => t.paths[b.path].id === id)!;
    expect(col('door.caveSeal').enabled).toBe(true);
    expect(col('door.avalanchePile').enabled).toBe(false);
    expect(br('caveHole').enabled).toBe(false);
    // lap-event walls stand on the road they block (props seat on the lowest ground nearby)
    for (const [id, tag] of [['door.caveSeal', 'glacier_seal'], ['door.avalanchePile', 'glacier_snowpile']]) {
      const c = col(id);
      let top = -Infinity;
      for (let k = 1; k < c.vertices.length; k += 3) top = Math.max(top, c.vertices[k]);
      const p = t.props.find((q) => q.name === tag)!;
      const road = t.groundAt(p.x, p.z, p.y + 3);
      expect(top - road, id).toBeGreaterThan(3);
      expect(Math.abs(p.y - road), tag).toBeLessThan(0.3);
    }
    const names: string[] = [];
    sim.events.on('track:event', (e) => names.push(e.name));
    t.setLap(2, sim);
    expect(col('door.caveSeal').enabled).toBe(false);
    expect(br('caveHole').enabled).toBe(true);
    // a kart on the shore road just before the pile when it lands must end up on the detour
    const kart = physics.addKart({ char: character('otter'), isHuman: true, pose: t.startGrid[0] });
    sim.karts.push(kart);
    const pileAt = t.paths[0].anchors.get('avalanche')!;
    kart.teleport(t.respawn({ path: 0, progress: pileAt - 16, lat: 0, halfWidth: 9, height: 0, onRoad: true, hint: -1 }));
    t.locate(kart.pos, undefined, kart.loc);
    expect(kart.loc.path).toBe(0);
    t.setLap(3, sim);
    expect(br('lakeDetour').enabled).toBe(true);
    expect(col('door.avalanchePile').enabled).toBe(false); // still rumbling
    for (let i = 0; i < 60 * 7; i++) { sim.time += 1 / 60; t.step(sim, 1 / 60); }
    expect(col('door.avalanchePile').enabled).toBe(true);
    t.locate(kart.pos, undefined, kart.loc);
    expect(t.paths[kart.loc.path].id).toBe('lakeDetour');
    // respawns on the buried road go to the detour too
    const pose = t.respawn({ path: 0, progress: pileAt - 3, lat: 0, halfWidth: 9, height: 0, onRoad: true, hint: -1 });
    expect(t.paths[t.locate(pose.pos.clone().setY(pose.pos.y + 0.5)).path].id).toBe('lakeDetour');
    expect(names).toEqual(['caveCrack', 'avalancheRumble', 'avalanche']);
    t.createEntities(sim);
    expect(col('door.avalanchePile').enabled).toBe(false);
    expect(col('door.caveSeal').enabled).toBe(true);
    expect(br('lakeDetour').enabled).toBe(false);
  });

  it('runs a 3-lap race with 8 stub karts and fires the lap events', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'gletscher', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race', seed: 7 }, track: t, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: t.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    const events: GameEvents['track:event'][] = [];
    sim.events.on('track:event', (e) => events.push(e));
    sim.start();
    for (let i = 0; i < 60 * 400 && !sim.karts.every((k) => k.race.finished); i++) {
      sim.step();
      if (sim.phase === 'finished') sim.phase = 'racing';
    }
    expect(sim.karts.filter((k) => k.race.finished).length).toBe(8);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['caveCrack', 'avalancheRumble', 'avalanche']));
    sim.dispose();
  });

  it.skipIf(!hasStack)('real physics + AI: 3 laps for all 8 karts, events driven, few respawns', async () => {
    const { createHeadlessRace } = await import('../src/race/harness');
    const { createPhysics } = await import('../src/physics/index');
    const seeds = Number(process.env.N ?? 4);
    let respawns = 0, finishedAll = 0, races = 0;
    const spots: string[] = [];
    const bestLaps: number[] = [];
    for (let seed = Number(process.env.S0 ?? 1); seed <= seeds; seed++) {
      const r = await createHeadlessRace({ physics: createPhysics as any, track: () => loadTrack('gletscher'), seed, rules: { grace: 150 } } as any);
      const t = r.sim.track as ReturnType<typeof buildTrack>;
      const hist = new Map<number, string[]>();
      const used = new Map<string, Set<number>>();
      const names: string[] = [];
      r.sim.events.on('track:event', (e) => names.push(e.name));
      let tick = 0;
      const orig = r.sim.step.bind(r.sim);
      (r.sim as any).step = () => {
        orig();
        if (++tick % 30 === 0) for (const k of r.sim.karts) {
          const h = hist.get(k.id) ?? [];
          h.push(`${k.loc.path}:${k.loc.progress.toFixed(0)}/${k.loc.lat.toFixed(1)}/${k.speed.toFixed(1)}` + (process.env.XZ ? `@${k.pos.x.toFixed(0)},${k.pos.y.toFixed(1)},${k.pos.z.toFixed(0)}` : ''));
          if (h.length > 8) h.shift();
          hist.set(k.id, h);
        }
        for (const k of r.sim.karts) if (k.loc.path > 0) {
          const id = t.paths[k.loc.path].id;
          (used.get(id) ?? used.set(id, new Set()).get(id)!).add(k.id);
        }
      };
      r.sim.events.on('kart:respawn', ({ kart }) => {
        respawns++;
        spots.push(`seed${seed} ${kart.char.id} lap${kart.race.lap} path${kart.loc.path} p${kart.loc.progress.toFixed(0)} lat${kart.loc.lat.toFixed(1)} h${kart.loc.height.toFixed(1)} | ${(hist.get(kart.id) ?? []).join(' ')}`);
      });
      r.runToEnd(600);
      const o = r.rules.order;
      const fin = r.sim.karts.filter((k) => k.race.finished).length;
      races++;
      if (fin === 8) finishedAll++;
      for (const k of r.sim.karts) if (!k.race.finished) console.log('NOT FINISHED', k.char.id, 'lap', k.race.lap, 'path', k.loc.path, 'p', k.loc.progress.toFixed(0), 'lat', k.loc.lat.toFixed(1), (hist.get(k.id) ?? []).join(' '));
      const best = Math.min(...o.map((k) => k.race.bestLap));
      bestLaps.push(best);
      const st = (t.script as any)?.state as GletscherState;
      console.log(`seed ${seed}: finished ${fin}/8, best lap ${best.toFixed(1)} s, spread ${(o[o.length - 1].race.finishTime - o[0].race.finishTime).toFixed(1)} s, `
        + `events ${names.join(',')}, branch users ${[...used].map(([k, v]) => `${k}:${v.size}`).join(' ')}, moved by avalanche ${st?.karts}`);
      expect(names).toEqual(expect.arrayContaining(['caveCrack', 'avalancheRumble', 'avalanche']));
      expect(used.get('lakeDetour')?.size ?? 0).toBeGreaterThan(4);
      r.dispose();
    }
    console.log('respawns', respawns, `(${(respawns / races).toFixed(2)} per race)`, '\n' + spots.join('\n'));
    expect(finishedAll).toBe(races);
  }, 900000);
});
