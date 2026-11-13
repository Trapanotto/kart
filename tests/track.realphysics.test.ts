// Kleeblatt-Tal with the real physics + gameplay rules/AI (if present): where do karts respawn or stall?
import { it } from 'vitest';
import { existsSync } from 'node:fs';
import { loadTrack } from '../src/track';

const hasStack = existsSync('src/race/harness.ts') && existsSync('src/physics/index.ts');

it.skipIf(!hasStack)('real physics: respawn / stall hot spots on Kleeblatt-Tal', async () => {
  const { createHeadlessRace } = await import('../src/race/harness');
  const { createPhysics } = await import('../src/physics/index');
  const spots: string[] = [];
  let total = 0;
  for (let seed = 1; seed <= Number(process.env.N ?? 4); seed++) {
    const r = await createHeadlessRace({ physics: createPhysics as any, track: () => loadTrack('kleeblatt'), seed } as any);
    const hist = new Map<number, string[]>();
    r.sim.events.on('race:countdown', () => {});
    let tick = 0;
    const orig = r.sim.step.bind(r.sim);
    (r.sim as any).step = () => {
      orig();
      if (++tick % 30 === 0) for (const k of r.sim.karts) {
        const h = hist.get(k.id) ?? [];
        h.push(`${k.loc.path}:${k.loc.progress.toFixed(0)}/${k.loc.lat.toFixed(1)}/${k.speed.toFixed(1)}`);
        if (h.length > 10) h.shift();
        hist.set(k.id, h);
      }
    };
    r.sim.events.on('kart:respawn', ({ kart }) => { total++; spots.push(`seed${seed} ${kart.char.id} path${kart.loc.path} p${kart.loc.progress.toFixed(0)} lat${kart.loc.lat.toFixed(1)} h${kart.loc.height.toFixed(1)} | before: ${(hist.get(kart.id) ?? []).join(' ')}`); });
    r.runToEnd(600);
    const o = r.rules.order;
    console.log('seed', seed, 'spread', (o[o.length - 1].race.finishTime - o[0].race.finishTime).toFixed(1), 'best lap', Math.min(...o.map((k) => k.race.bestLap)).toFixed(1));
  }
  console.log('respawns', total, '\n' + spots.join('\n'));
}, 600000);
