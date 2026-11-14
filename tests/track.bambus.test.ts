// Bambus-Tempel: validator, lap events (rain, breaking bridge, temple gate), stub race and a
// headless race with the real physics + AI (respawns, lap times).
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { Vector3 } from 'three';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { GameEvents } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { buildTrack, loadTrack, TRACK_DEFS } from '../src/track';
import type { BambusState } from '../src/track/scripts/bambus';
import { validateTrack } from '../tools/track/validate';

const def = TRACK_DEFS.find((d) => d.id === 'bambus')!;
const hasStack = existsSync('src/race/harness.ts') && existsSync('src/physics/index.ts');

describe('Bambus-Tempel', () => {
  const track = buildTrack(def);

  it('passes the track validator', () => {
    const r = validateTrack(track, { lapLength: [1150, 1350], minRadius: 15 });
    const ys = track.paths[0].pos.map((p) => p.y);
    console.log('metrics', r.metrics, 'elevation', (Math.max(...ys) - Math.min(...ys)).toFixed(1), 'build ms', Math.round(track.stats.total), 'stats', track.stats);
    if (r.warnings.length) console.log('warnings', r.warnings);
    expect(r.errors).toEqual([]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(18);
    expect(track.colliders.filter((c) => c.id.startsWith('road.bridge.')).length).toBe(18);
  });

  it.skipIf(!process.env.BAMBUS_DEV)('dev: anchors and terrain cut / fill', () => {
    const m = track.paths[0];
    console.log('anchors', [...m.anchors].map(([k, v]) => `${k}@${(v * m.ds).toFixed(0)}`).join(' '));
    const out: string[] = [];
    for (let s = 0; s < track.length; s += 20) {
      const f = track.sample(s, 0);
      const nat = track.terrain.natural(f.pos.x, f.pos.z);
      const l = track.sample(s, -f.halfWidth - 12), r = track.sample(s, f.halfWidth + 12);
      out.push(`${s}: y${f.pos.y.toFixed(1)} nat${(nat - f.pos.y).toFixed(1)} L${(track.terrain.natural(l.pos.x, l.pos.z) - f.pos.y).toFixed(0)} R${(track.terrain.natural(r.pos.x, r.pos.z) - f.pos.y).toFixed(0)}`);
    }
    console.log(out.join('\n'));
    const st = (track.script as unknown as { state: BambusState } | null)?.state;
    void st;
    const b = track.colliders.filter((c) => c.id.startsWith('road.bridge'));
    console.log('bridge cells', b.map((c) => {
      let y = 0, x = 0, z = 0;
      for (let k = 0; k < c.vertices.length; k += 3) { x += c.vertices[k]; y += c.vertices[k + 1]; z += c.vertices[k + 2]; }
      const n = c.vertices.length / 3;
      const l = track.locate(new Vector3(x / n, y / n + 0.5, z / n));
      return `${c.id}: p${l.progress.toFixed(1)} lat${l.lat.toFixed(1)} y${(y / n).toFixed(1)}`;
    }).join('\n'));
  });

  it('runs a 3-lap stub race and fires every lap event', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'bambus', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race', seed: 3 }, track: t, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: t.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    const events: GameEvents['track:event'][] = [];
    const kinds = new Set<string>();
    sim.events.on('track:event', (e) => events.push(e));
    sim.events.on('entity:add', ({ entity }) => kinds.add(entity.kind));
    sim.start();
    for (let i = 0; i < 60 * 400 && !sim.karts.every((k) => k.race.finished); i++) {
      sim.step();
      if (sim.phase === 'finished') sim.phase = 'racing';
    }
    const names = [...new Set(events.map((e) => e.name))];
    console.log('stub: finished', sim.karts.filter((k) => k.race.finished).length, 'events', names.join(','));
    expect(sim.karts.filter((k) => k.race.finished).length).toBe(8);
    expect(names).toEqual(expect.arrayContaining(['rain', 'bridgeCreak', 'bridgeBreak', 'templeOpen', 'logRoll']));
    expect(kinds.has('hazard.bambooLantern')).toBe(true);
    expect(kinds.has('hazard.bambooLog')).toBe(true);
    const st = (t.script as unknown as { state: BambusState }).state;
    expect(st.build.cells.filter((c) => c.state === 2).length).toBe(3);
    expect(t.branches.find((b) => b.path === 2)!.enabled).toBe(true);
    // a new race restores the bridge and closes the gate
    t.createEntities(sim);
    expect(st.build.cells.every((c) => c.collider.enabled)).toBe(true);
    expect(t.branches.find((b) => b.path === 2)!.enabled).toBe(false);
    expect(t.colliders.find((c) => c.id === 'door.templeDoors')!.enabled).toBe(true);
    sim.dispose();
  });

  it.skipIf(!hasStack)('real physics + AI: 8 karts finish 3 laps, few respawns', async () => {
    const { createHeadlessRace } = await import('../src/race/harness');
    const { createPhysics } = await import('../src/physics/index');
    const spots: string[] = [];
    let total = 0;
    const seeds = Number(process.env.N ?? 3);
    const best: number[] = [];
    const finished: number[] = [];
    const allNames: string[][] = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const r = await createHeadlessRace({ physics: createPhysics as any, track: () => loadTrack('bambus'), seed, rules: { grace: 90 } } as any);
      const hist = new Map<number, string[]>();
      const names = new Set<string>();
      r.sim.events.on('track:event', (e) => names.add(e.name));
      let tick = 0;
      const orig = r.sim.step.bind(r.sim);
      (r.sim as any).step = () => {
        orig();
        if (++tick % 30 === 0) for (const k of r.sim.karts) {
          const h = hist.get(k.id) ?? [];
          h.push(`${k.loc.path}:${k.loc.progress.toFixed(0)}/${k.loc.lat.toFixed(1)}/${k.speed.toFixed(1)}`);
          if (h.length > 6) h.shift();
          hist.set(k.id, h);
        }
      };
      r.sim.events.on('kart:respawn', ({ kart }) => { total++; spots.push(`seed${seed} ${kart.char.id} lap${kart.race.lap} path${kart.loc.path} p${kart.loc.progress.toFixed(0)} lat${kart.loc.lat.toFixed(1)} h${kart.loc.height.toFixed(1)} t${r.sim.raceTime.toFixed(0)} holes[${((r.sim.track as any).script?.state as BambusState | undefined)?.build.cells.filter((c) => c.state > 0).map((c) => `${c.seg}.${c.lane}${c.state === 1 ? 'w' : ''}`).join(' ')}] | ${(hist.get(kart.id) ?? []).join(' ')}`); });
      const over = r.runToEnd(600);
      const o = r.rules.order;
      const fin = r.sim.karts.filter((k) => k.race.finished).length;
      const bl = Math.min(...o.map((k) => k.race.bestLap));
      best.push(bl);
      console.log('seed', seed, 'over', over, 'finished', fin, 'spread', (o[o.length - 1].race.finishTime - o[0].race.finishTime).toFixed(1), 'best lap', bl.toFixed(1),
        'laps', o[0].race.lapTimes.map((x) => x.toFixed(1)).join('/'), 'events', [...names].join(','));
      for (const k of r.sim.karts) if (!k.race.finished) console.log('  unfinished', k.char.id, 'lap', k.race.lap, (hist.get(k.id) ?? []).join(' '));
      finished.push(fin);
      allNames.push([...names]);
      r.dispose();
    }
    console.log('respawns', total, 'per race', (total / seeds).toFixed(2), '\n' + spots.join('\n'));
    for (const f of finished) expect(f).toBe(8);
    for (const n of allNames) expect(n).toEqual(expect.arrayContaining(['rain', 'bridgeBreak', 'templeOpen']));
    expect(total / seeds).toBeLessThan(2);
  }, 900000);
});
