// Headless smoke test of the grey box: stub AI must finish a race on the test track.
import { describe, expect, it } from 'vitest';
import { character, CHARACTERS, SPEED_CLASSES } from '../src/core/data';
import { Sim } from '../src/core/sim';
import { createStubPhysics } from '../src/stubs/stubPhysics';
import { createStubAI, createStubRules } from '../src/stubs/stubSystems';
import { createTestTrack } from '../src/stubs/testTrack';

describe('grey box', () => {
  it('finishes a one-lap race headless', () => {
    const track = createTestTrack();
    const physics = createStubPhysics();
    const sim = new Sim({ config: { trackId: 'test', speedClass: SPEED_CLASSES[1], player: 'otter', laps: 1, mode: 'race' }, track, physics, systems: [createStubRules()] });
    CHARACTERS.forEach((c, i) => {
      const k = physics.addKart({ char: character(c.id), isHuman: c.id === 'otter', pose: track.startGrid[i] });
      sim.karts.push(k);
      sim.controllers.set(k.id, createStubAI());
    });
    sim.start();
    for (let i = 0; i < 60 * 90 && sim.phase !== 'finished'; i++) sim.step();
    expect(sim.phase).toBe('finished');
    expect(sim.player.race.finished).toBe(true);
  });
});
