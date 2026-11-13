// Headless vehicle physics tests. Owner: physics.
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createLineDriver } from '../src/physics';
import { createSandboxTrack } from '../src/physics/sandboxTrack';
import type { GameEvents } from '../src/core/types';
import { createStubRules } from '../src/stubs/stubSystems';
import { ALL, drive, flatTrack, run, setup } from './physics.helpers';

const poseOn = (track: { sample: (p: number, l?: number) => { pos: Vector3; forward: Vector3 } }, progress: number, lat = 0) => {
  const f = track.sample(progress, lat);
  return { pos: f.pos.clone().add(new Vector3(0, 0.05, 0)), quat: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), f.forward) };
};

describe('vehicle physics', () => {
  it('accelerates to about its top speed in 3-4 s', async () => {
    const { sim, karts } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver());
    let t95 = -1;
    run(sim, 7, (t) => { if (t95 < 0 && k.speed >= 0.95 * k.topSpeed) t95 = t; });
    expect(k.topSpeed).toBeCloseTo(29, 0);
    expect(k.speed).toBeGreaterThan(0.96 * k.topSpeed);
    expect(k.speed).toBeLessThan(1.02 * k.topSpeed);
    expect(t95).toBeGreaterThan(2.5);
    expect(t95).toBeLessThan(4.2);
  });

  it('settles on its suspension at the origin height', async () => {
    const { sim, karts } = await setup();
    run(sim, 1.5);
    const k = karts[0];
    expect(Math.abs(k.pos.y)).toBeLessThan(0.08);
    expect(k.grounded).toBe(true);
    for (const w of k.wheels) { expect(w.grounded).toBe(true); expect(w.compression).toBeGreaterThan(0.1); expect(w.compression).toBeLessThan(0.6); }
  });

  it('positive steer turns right', async () => {
    const { sim, karts } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, drive({ throttle: 1 }));
    run(sim, 1.2);
    const p0 = k.pos.clone();
    const right0 = new Vector3(-1, 0, 0).applyQuaternion(k.quat);
    const fwd0 = new Vector3(0, 0, 1).applyQuaternion(k.quat);
    sim.controllers.set(k.id, drive({ throttle: 1, steer: 1 }));
    run(sim, 0.6);
    const d = k.pos.clone().sub(p0);
    expect(d.dot(right0)).toBeGreaterThan(1);
    const fwd1 = new Vector3(0, 0, 1).applyQuaternion(k.quat);
    expect(fwd1.dot(right0)).toBeGreaterThan(0.3);
    expect(fwd1.dot(fwd0)).toBeGreaterThan(0);
  });

  it('drives a full lap of the test track on the road', async () => {
    const { sim, karts, track } = await setup({ chars: ['otter'], systems: [createStubRules()] });
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver());
    let maxLat = 0;
    let lapTime = -1;
    sim.events.on('race:lap', (e) => { if (e.lap === 2 && lapTime < 0) lapTime = sim.raceTime; });
    run(sim, 60, () => { if (sim.phase === 'racing') maxLat = Math.max(maxLat, Math.abs(k.loc.lat)); return lapTime > 0; });
    expect(lapTime).toBeGreaterThan(0);
    expect(maxLat).toBeLessThan(track.sample(0).halfWidth);
    expect(k.surface).toBe('road');
  });

  it('drives a lap of the sandbox circuit (hills, bank, ramp, drop)', async () => {
    const track = createSandboxTrack();
    const { sim, karts } = await setup({ track });
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver({ brakeTurn: 0.75 }));
    const respawns: number[] = [];
    sim.events.on('kart:respawn', () => respawns.push(k.loc.progress));
    let dist = 0, last = k.loc.progress;
    const t = run(sim, 60, () => {
      let d = k.loc.progress - last; if (d < -track.length / 2) d += track.length; dist += d; last = k.loc.progress;
      return dist > track.length;
    });
    expect(respawns).toEqual([]);
    expect(t).toBeLessThan(35);
  });

  it('drift hops, builds three tiers and releases a mini-turbo', async () => {
    const { sim, karts } = await setup({ track: flatTrack() });
    sim.phase = 'racing';
    const k = karts[0];
    const levels: number[] = [];
    const boosts: GameEvents['kart:boost'][] = [];
    let started = false;
    sim.events.on('kart:driftLevel', (e) => levels.push(e.level));
    sim.events.on('kart:boost', (e) => boosts.push(e));
    sim.events.on('kart:driftStart', () => { started = true; });
    sim.controllers.set(k.id, drive({ throttle: 1 }));
    run(sim, 2.5);
    sim.controllers.set(k.id, drive({ throttle: 1, steer: -1, drift: true }));
    run(sim, 0.45);
    expect(started).toBe(true);
    expect(k.drift.active).toBe(true);
    expect(k.drift.dir).toBe(-1);
    // Inside steering tightens the arc, outside widens it.
    sim.controllers.set(k.id, drive({ throttle: 1, steer: -1, drift: true }));
    run(sim, 0.3);
    const tight = Math.abs(k.yawRate);
    sim.controllers.set(k.id, drive({ throttle: 1, steer: 1, drift: true }));
    run(sim, 0.4);
    const wide = Math.abs(k.yawRate);
    expect(tight).toBeGreaterThan(wide * 1.6);
    expect(k.drift.active).toBe(true);
    sim.controllers.set(k.id, drive({ throttle: 1, steer: 0, drift: true }));
    run(sim, 1.6);
    expect(levels).toEqual([1, 2, 3]);
    expect(k.drift.level).toBe(3);
    sim.controllers.set(k.id, drive({ throttle: 1, steer: 0, drift: false }));
    run(sim, 2 / 60);
    expect(k.drift.active).toBe(false);
    const b = boosts.find((x) => x.cause === 'drift');
    expect(b).toBeDefined();
    expect(b!.duration).toBeGreaterThan(1.2);
    expect(k.boost.time).toBeGreaterThan(0);
    run(sim, 0.6);
    expect(k.speed).toBeGreaterThan(k.topSpeed * 1.05);
  });

  it('drifting through a 90° corner carries more speed than gripping', async () => {
    const track = createSandboxTrack();
    const c = track.corner90;
    const result: Record<string, { time: number; exitV: number }> = {};
    for (const mode of ['grip', 'drift'] as const) {
      const { sim, karts } = await setup({ track, poses: [poseOn(track, c.entry - 110)] });
      sim.phase = 'racing';
      const k = karts[0];
      sim.controllers.set(k.id, createLineDriver(mode === 'drift' ? { driftTurn: 0.6 } : {}));
      let tIn = -1, tOut = -1;
      run(sim, 20, (t) => {
        if (tIn < 0 && k.loc.progress > c.entry - 30) tIn = t;
        if (tOut < 0 && k.loc.progress > c.exit + 40) { tOut = t; return true; }
      });
      result[mode] = { time: tOut - tIn, exitV: Math.hypot(k.vel.x, k.vel.z) };
    }
    expect(result.drift.time).toBeLessThan(result.grip.time);
    expect(result.drift.exitV).toBeGreaterThan(result.grip.exitV);
  });

  it('a spin hit stuns, then the kart recovers upright and drives on', async () => {
    const { sim, karts } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver());
    run(sim, 2);
    const v0 = k.speed;
    const hits: GameEvents['kart:hit'][] = [];
    sim.events.on('kart:hit', (e) => hits.push(e));
    expect(k.applyHit('spin', { cause: 'test' })).toBe(true);
    expect(k.stun).toBeGreaterThan(0.5);
    expect(k.stunKind).toBe('spin');
    // Invulnerable right after: a second hit is absorbed.
    expect(k.applyHit('spin')).toBe(false);
    expect(hits.map((h) => h.absorbed)).toEqual([false, true]);
    run(sim, 0.6);
    expect(Math.abs(k.speed)).toBeLessThan(v0 * 0.8);
    run(sim, 3);
    expect(k.stun).toBe(0);
    expect(k.stunKind).toBe(null);
    expect(new Vector3(0, 1, 0).applyQuaternion(k.quat).y).toBeGreaterThan(0.95);
    expect(k.speed).toBeGreaterThan(15);
  });

  it('every hit kind has a distinct reaction and recovers; shield absorbs', async () => {
    for (const kind of ['spin', 'tumble', 'squash', 'zap', 'bump'] as const) {
      const { sim, karts } = await setup({ chars: ['hedgehog'] });
      sim.phase = 'racing';
      const k = karts[0];
      sim.controllers.set(k.id, createLineDriver());
      run(sim, 2);
      k.applyHit(kind, { dir: new Vector3(1, 0, 0) });
      let maxY = k.pos.y, maxTilt = 0;
      run(sim, 4, () => { maxY = Math.max(maxY, k.pos.y); maxTilt = Math.max(maxTilt, 1 - new Vector3(0, 1, 0).applyQuaternion(k.quat).y); });
      if (kind === 'tumble') { expect(maxY).toBeGreaterThan(0.8); expect(maxTilt).toBeGreaterThan(1); }
      expect(k.stun).toBe(0);
      expect(new Vector3(0, 1, 0).applyQuaternion(k.quat).y).toBeGreaterThan(0.95);
      expect(k.speed).toBeGreaterThan(8);
    }
    const { sim, karts } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    k.shield = true;
    expect(k.applyHit('tumble')).toBe(false);
    expect(k.shield).toBe(false);
    expect(k.stun).toBe(0);
    k.invulnerable = 0;
    k.addModifier({ id: 'star', time: 5, invincible: true });
    expect(k.applyHit('spin')).toBe(false);
  });

  it('quickRecover and toughness shorten stuns', async () => {
    const { karts } = await setup({ chars: ['axolotl', 'hedgehog', 'otter'] });
    for (const k of karts) k.applyHit('spin');
    const [axo, hedge, otter] = karts.map((k) => k.stun);
    expect(axo).toBeLessThan(otter);
    expect(hedge).toBeLessThan(otter);
  });

  it('walls deflect and scrub instead of stopping the kart', async () => {
    const { sim, karts, track } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    // Aim 25° towards the outer wall on the start straight at speed.
    const f = track.sample(20, 4);
    const fwd = f.forward.clone().applyAxisAngle(new Vector3(0, 1, 0), (-25 * Math.PI) / 180);
    k.teleport({ pos: f.pos.clone().add(new Vector3(0, 0.05, 0)), quat: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), fwd) });
    k.addImpulse(fwd.clone().multiplyScalar(25 * k.stats.mass));
    const collides: number[] = [];
    sim.events.on('kart:collide', (e) => collides.push(e.impulse));
    sim.controllers.set(k.id, drive({ throttle: 1 }));
    run(sim, 1.5);
    expect(collides.length).toBeGreaterThan(0);
    expect(Math.hypot(k.vel.x, k.vel.z)).toBeGreaterThan(12);
    expect(Math.abs(k.loc.lat)).toBeLessThan(14);
    expect(new Vector3(0, 1, 0).applyQuaternion(k.quat).y).toBeGreaterThan(0.9);
  });

  it('kart bumps respect weight', async () => {
    const track = flatTrack();
    const { sim, karts } = await setup({ track, chars: ['capybara', 'sheep'] });
    sim.phase = 'racing';
    const [heavy, light] = karts;
    heavy.teleport(poseOn(track, 30, -1.7));
    light.teleport(poseOn(track, 30, 1.7));
    const f = track.sample(30).forward;
    heavy.addImpulse(f.clone().multiplyScalar(18 * heavy.stats.mass));
    light.addImpulse(f.clone().multiplyScalar(18 * light.stats.mass));
    const right = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
    const events: GameEvents['kart:collide'][] = [];
    sim.events.on('kart:collide', (e) => events.push(e));
    // Both steer into each other until they touch, then go straight.
    sim.controllers.set(heavy.id, { update(k) { k.input.throttle = 1; k.input.steer = events.length ? 0 : 0.6; } });
    sim.controllers.set(light.id, { update(k) { k.input.throttle = 1; k.input.steer = events.length ? 0 : -0.6; } });
    const h0 = heavy.pos.clone(), l0 = light.pos.clone();
    run(sim, 1.2);
    expect(events.some((e) => e.kart === heavy && e.other === light)).toBe(true);
    expect(events.some((e) => e.kart === light && e.other === heavy)).toBe(true);
    // The light kart is pushed further out than the heavy one.
    const lightOut = light.pos.clone().sub(l0).dot(right);
    const heavyOut = -heavy.pos.clone().sub(h0).dot(right);
    expect(lightOut).toBeGreaterThan(heavyOut);
  });

  it('respawns when falling below killY', async () => {
    const { sim, karts, track } = await setup();
    sim.phase = 'racing';
    const k = karts[0];
    const events: string[] = [];
    sim.events.on('kart:respawn', () => events.push('respawn'));
    k.teleport({ pos: new Vector3(0, track.killY - 1, 0), quat: new Quaternion() });
    run(sim, 0.1);
    expect(events).toEqual(['respawn']);
    expect(k.carried).toBe(true);
    run(sim, 1.5);
    expect(k.carried).toBe(false);
    expect(k.invulnerable).toBeGreaterThan(0);
    expect(k.grounded).toBe(true);
    expect(Math.abs(k.loc.lat)).toBeLessThan(8);
  });

  it('start boost for good timing, stall when held too early', async () => {
    const quality: number[] = [];
    for (const pressAt of [-2.8, -0.9]) {
      const { sim, karts } = await setup({ systems: [createStubRules()] });
      const k = karts[0];
      sim.events.on('kart:startBoost', (e) => quality.push(e.quality));
      sim.controllers.set(k.id, { update(kk, s) { kk.input.throttle = s.raceTime >= pressAt ? 1 : 0; } });
      run(sim, 3.5);
      expect(sim.phase).toBe('racing');
      if (pressAt < -2) expect(k.speed).toBeLessThan(3); else expect(k.boost.time > 0 || k.speed > 8).toBe(true);
    }
    expect(quality.length).toBe(2);
    expect(quality[0]).toBe(0);
    expect(quality[1]).toBeGreaterThan(0.8);
  });

  it('karts stand still during the countdown', async () => {
    const { sim, karts } = await setup({ systems: [createStubRules()], chars: ['otter', 'sheep'] });
    const p0 = karts.map((k) => k.pos.clone());
    for (const k of karts) sim.controllers.set(k.id, drive({ throttle: 1, steer: 1 }));
    run(sim, 2.5);
    expect(sim.phase).toBe('countdown');
    karts.forEach((k, i) => expect(Math.hypot(k.pos.x - p0[i].x, k.pos.z - p0[i].z)).toBeLessThan(0.05));
  });

  it('is deterministic', async () => {
    const final: number[][] = [];
    for (let r = 0; r < 2; r++) {
      const { sim, karts } = await setup({ chars: ['otter', 'sheep', 'capybara', 'redpanda'], systems: [createStubRules()] });
      karts.forEach((k, i) => sim.controllers.set(k.id, createLineDriver({ lat: i - 1.5, driftTurn: i % 2 ? 0.5 : 0 })));
      run(sim, 25);
      karts[1].applyHit('tumble');
      run(sim, 5);
      final.push(karts.flatMap((k) => [...k.pos.toArray(), ...k.quat.toArray(), k.speed]));
    }
    expect(final[1]).toEqual(final[0]);
  });

  it('steps 8 karts fast enough', async () => {
    const { sim, karts } = await setup({ chars: ALL, systems: [createStubRules()] });
    karts.forEach((k, i) => sim.controllers.set(k.id, createLineDriver({ lat: (i % 4) * 2 - 3 })));
    run(sim, 4); // warm up
    const t0 = performance.now();
    run(sim, 10);
    const ms = (performance.now() - t0) / 600;
    console.log(`physics step, 8 karts: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1.5);
  });
});
