// Tuning probe: prints the feel numbers reported in the physics team's report.
// Run: npx vitest run tests/physics.probe.test.ts --silent=false
import { it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createLineDriver } from '../src/physics';
import { createSandboxTrack } from '../src/physics/sandboxTrack';
import { drive, flatTrack, run, setup } from './physics.helpers';

it('feel numbers', async () => {
  const out: string[] = [];
  // Acceleration
  {
    const { sim, karts } = await setup({ track: flatTrack() });
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, drive({ throttle: 1 }));
    const marks: Record<string, number> = {};
    run(sim, 8, (t) => { for (const f of [0.5, 0.9, 0.95, 0.99]) if (marks[f] === undefined && k.speed >= f * k.topSpeed) marks[f] = t; });
    out.push(`accel: top ${k.topSpeed.toFixed(1)} m/s; 50% ${marks[0.5]?.toFixed(2)}s 90% ${marks[0.9]?.toFixed(2)}s 95% ${marks[0.95]?.toFixed(2)}s 99% ${marks[0.99]?.toFixed(2)}s`);
    // Full-lock grip turn at speed
    for (const v of [10, 20, 29]) {
      const s2 = await setup({ track: flatTrack() });
      s2.sim.phase = 'racing';
      const kk = s2.karts[0];
      run(s2.sim, 0.3);
      kk.addImpulse(new Vector3(0, 0, 1).applyQuaternion(kk.quat).multiplyScalar(v * kk.stats.mass));
      s2.sim.controllers.set(kk.id, { update(x) { x.input.steer = 1; x.input.throttle = x.speed < v ? 1 : 0; } });
      run(s2.sim, 2);
      out.push(`grip full lock @${v}: yaw ${Math.abs(kk.yawRate).toFixed(2)} rad/s, radius ${(Math.hypot(kk.vel.x, kk.vel.z) / Math.abs(kk.yawRate)).toFixed(1)} m, speed ${Math.hypot(kk.vel.x, kk.vel.z).toFixed(1)}`);
    }
    // Drift radii at speed
    for (const steer of [1, 0, -1]) {
      const s3 = await setup({ track: flatTrack() });
      s3.sim.phase = 'racing';
      const kk = s3.karts[0];
      s3.sim.controllers.set(kk.id, drive({ throttle: 1 }));
      run(s3.sim, 4);
      s3.sim.controllers.set(kk.id, drive({ throttle: 1, steer: 1, drift: true }));
      run(s3.sim, 0.5);
      s3.sim.controllers.set(kk.id, drive({ throttle: 1, steer, drift: true }));
      run(s3.sim, 1.5);
      const sp = Math.hypot(kk.vel.x, kk.vel.z);
      out.push(`drift right steer ${steer}: speed ${sp.toFixed(1)} radius ${(sp / Math.abs(kk.yawRate)).toFixed(1)} m tier ${kk.drift.level}`);
    }
  }
  // 90° corner and laps on the sandbox circuit
  const track = createSandboxTrack();
  const c = track.corner90;
  for (const mode of ['grip', 'gripBrake', 'drift']) {
    const f = track.sample(c.entry - 110, 0);
    const pose = { pos: f.pos.clone().add(new Vector3(0, 0.05, 0)), quat: new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), f.forward) };
    const { sim, karts } = await setup({ track, poses: [pose] });
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver(mode === 'drift' ? { driftTurn: 0.6 } : mode === 'gripBrake' ? { brakeTurn: 0.9 } : {}));
    let tIn = -1, tOut = -1, minV = 99, entryV = 0;
    run(sim, 20, (t) => {
      const p = k.loc.progress;
      if (tIn < 0 && p > c.entry - 30) { tIn = t; entryV = Math.hypot(k.vel.x, k.vel.z); }
      if (tIn >= 0 && p < c.exit) minV = Math.min(minV, Math.hypot(k.vel.x, k.vel.z));
      if (tOut < 0 && p > c.exit + 40) { tOut = t; return true; }
    });
    out.push(`T1 (R15, 90°) ${mode}: entry ${entryV.toFixed(1)} min ${minV.toFixed(1)} exit ${Math.hypot(k.vel.x, k.vel.z).toFixed(1)} m/s, segment ${(tOut - tIn).toFixed(2)}s`);
  }
  for (const [name, opts] of [['grip+brake', { brakeTurn: 0.75 }], ['drift', { driftTurn: 0.6, brakeTurn: 1.2 }]] as const) {
    const { sim, karts } = await setup({ track });
    sim.phase = 'racing';
    const k = karts[0];
    sim.controllers.set(k.id, createLineDriver(opts));
    let resp = 0, dist = 0, last = k.loc.progress, laps: number[] = [], lapStart = 0;
    sim.events.on('kart:respawn', () => resp++);
    run(sim, 80, (t) => {
      let d = k.loc.progress - last; if (d < -track.length / 2) d += track.length; dist += d; last = k.loc.progress;
      if (dist > track.length * (laps.length + 1)) { laps.push(t - lapStart); lapStart = t; }
      return laps.length >= 2;
    });
    out.push(`sandbox lap ${name}: ${laps.map((x) => x.toFixed(2)).join(', ')} s, respawns ${resp}`);
  }
  console.log(out.join('\n'));
});
