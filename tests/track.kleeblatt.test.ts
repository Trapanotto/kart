// Kleeblatt-Tal: validator, lap events and a headless 8-kart, 3-lap race with the stubs.
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import type { GameEvents } from '../src/core/types';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { buildTrack, TRACK_DEFS } from '../src/track';
import { validateTrack } from '../tools/track/validate';

const def = TRACK_DEFS.find((d) => d.id === 'kleeblatt')!;

describe('Kleeblatt-Tal', () => {
  const track = buildTrack(def);

  it('passes the track validator', () => {
    const r = validateTrack(track, { lapLength: [1100, 1300], minRadius: 15 });
    console.log('metrics', r.metrics, 'build ms', Math.round(track.stats.total));
    if (r.warnings.length) console.log('warnings', r.warnings);
    expect(r.errors).toEqual([]);
  });

  it('locate is fast and allocation-light with a hint', () => {
    const l = { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: -1 };
    const p = new Vector3();
    const t0 = performance.now();
    let n = 0;
    for (let s = 0; s < track.length * 5; s += 0.5, n++) {
      const f = track.sample(s, Math.sin(s * 0.05) * 6);
      p.copy(f.pos).addScaledVector(f.up, 0.5);
      track.locate(p, l, l);
    }
    const us = ((performance.now() - t0) * 1000) / n;
    console.log('locate µs/call (incl. sample)', us.toFixed(2));
    expect(us).toBeLessThan(20);
  });

  it('runs a 3-lap race with 8 stub karts and fires the lap events', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'kleeblatt', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race', seed: 7 }, track: t, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: t.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    const events: GameEvents['track:event'][] = [];
    const changed: GameEvents['track:changed'][] = [];
    const fx: string[] = [];
    const kinds = new Set<string>();
    const lapTimes: number[] = [];
    const lapStart = new Map<number, number>();
    sim.events.on('track:event', (e) => events.push(e));
    sim.events.on('track:changed', (e) => changed.push(e));
    sim.events.on('fx', (e) => fx.push(e.name));
    sim.events.on('entity:add', ({ entity }) => kinds.add(entity.kind));
    sim.events.on('race:lap', ({ kart, lap }) => {
      if (lap > 1) lapTimes.push(sim.raceTime - (lapStart.get(kart.id) ?? 0));
      lapStart.set(kart.id, sim.raceTime);
    });
    sim.start();
    let barnOpenAt = -1;
    for (let i = 0; i < 60 * 400 && !sim.karts.every((k) => k.race.finished); i++) {
      sim.step();
      // the stub rules end the race (and the stub physics stops everyone) when the player finishes:
      // keep the others driving so all 8 complete their 3 laps
      if (sim.phase === 'finished') sim.phase = 'racing';
      if (barnOpenAt < 0 && t.branches.find((b) => b.path === 3)?.enabled) barnOpenAt = sim.raceTime;
    }
    const finished = sim.karts.filter((k) => k.race.finished).length;
    const avgLap = lapTimes.reduce((a, b) => a + b, 0) / lapTimes.length;
    console.log('finished', finished, 'race time', sim.raceTime.toFixed(1), 'avg stub lap', avgLap.toFixed(1), 's; events', events.map((e) => e.name).join(','), '; fx', [...new Set(fx)].join(','));
    expect(finished).toBe(8);
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['sheepHerd', 'barnOpen', 'hayRoll']));
    expect(changed.some((c) => c.lap === 2 && c.event === 'sheepHerd')).toBe(true);
    expect(changed.some((c) => c.lap === 3 && c.event === 'barnOpen')).toBe(true);
    expect(kinds.has('hazard.sheep')).toBe(true);
    expect(kinds.has('hazard.hay')).toBe(true);
    expect(barnOpenAt).toBeGreaterThan(0);
    const door = t.colliders.find((c) => c.id === 'door.barnDoors')!;
    expect(door.enabled).toBe(false);
    sim.dispose();
  });

  it('resets lap state for a new race', () => {
    const t = buildTrack(def);
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'kleeblatt', speedClass: SPEED_CLASSES[1], player: 'otter', mode: 'race' }, track: t, physics, systems: [createStubRules()] });
    t.setLap(3, sim);
    expect(t.colliders.find((c) => c.id === 'door.barnDoors')!.enabled).toBe(false);
    t.createEntities(sim);
    expect(t.colliders.find((c) => c.id === 'door.barnDoors')!.enabled).toBe(true);
    expect(t.branches.find((b) => b.path === 3)!.enabled).toBe(false);
  });
});
