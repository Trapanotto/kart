// Shared game data. Owner: lead.
import type { CharacterDef, CharacterId, InputState, ItemSlot, RaceProgress, Rng, SpeedClass, SurfaceProps, SurfaceType } from './types';

export const CHARACTERS: CharacterDef[] = [
  { id: 'sloth', name: 'Fauli', animal: 'Faultier', color: '#8C6B4F', persona: 'steady', speed: 3, accel: 2, handling: 5, drift: 3, weight: 2, tough: 3, perk: 'Bestes Handling' },
  { id: 'sheep', name: 'Wolke', animal: 'Schaf', color: '#F4EEE4', persona: 'attacker', speed: 2, accel: 5, handling: 3, drift: 3, weight: 1, tough: 3, perk: 'Beste Beschleunigung' },
  { id: 'redpanda', name: 'Rubi', animal: 'Rotpanda', color: '#C8552B', persona: 'hothead', speed: 3, accel: 4, handling: 3, drift: 5, weight: 1, tough: 2, perk: 'Stärkster Drift-Boost' },
  { id: 'hedgehog', name: 'Stupsi', animal: 'Igel', color: '#C69C72', persona: 'defender', speed: 3, accel: 3, handling: 3, drift: 3, weight: 1, tough: 5, perk: 'Kaum zu erschüttern' },
  { id: 'penguin', name: 'Pingo', animal: 'Pinguin', color: '#2C3350', persona: 'steady', speed: 3, accel: 3, handling: 4, drift: 3, weight: 2, tough: 3, perk: 'Voller Grip auf Eis', iceGrip: true },
  { id: 'capybara', name: 'Kapi', animal: 'Capybara', color: '#A0724B', persona: 'defender', speed: 5, accel: 1, handling: 2, drift: 2, weight: 3, tough: 4, perk: 'Höchstgeschwindigkeit' },
  { id: 'otter', name: 'Otti', animal: 'Otter', color: '#7A5034', persona: 'steady', speed: 3, accel: 3, handling: 3, drift: 4, weight: 2, tough: 3, perk: 'Ausgeglichen' },
  { id: 'axolotl', name: 'Axi', animal: 'Axolotl', color: '#F7A8C6', persona: 'attacker', speed: 3, accel: 4, handling: 3, drift: 3, weight: 1, tough: 2, perk: 'Schnell wieder auf den Beinen', quickRecover: true },
];

export function character(id: CharacterId): CharacterDef {
  return CHARACTERS.find((c) => c.id === id)!;
}

export const SPEED_CLASSES: SpeedClass[] = [
  { id: 'easy', name: 'Gemütlich', speed: 0.85, ai: 0.55 },
  { id: 'normal', name: 'Flott', speed: 1.0, ai: 0.75 },
  { id: 'turbo', name: 'Turbo', speed: 1.15, ai: 0.92 },
];

/**
 * Reference feel numbers (class 'normal', average character). Physics may tune them,
 * but tracks are designed around these.
 */
export const KART = {
  length: 2.0,
  width: 1.3,
  height: 1.2,
  /** Collision sphere radius used by items and hazards. */
  radius: 1.0,
  topSpeed: 29,
  boostPower: 1.3,
  /** Typical road half width tracks use (m). */
  roadHalfWidth: 8,
};

export const SURFACES: Record<SurfaceType, SurfaceProps> = {
  road: { grip: 1, speed: 1, drag: 0 },
  offroad: { grip: 0.8, speed: 0.55, drag: 0.6 },
  ice: { grip: 0.35, speed: 1, drag: 0 },
  boost: { grip: 1, speed: 1, drag: 0 },
  sticky: { grip: 1.1, speed: 0.45, drag: 1.2 },
  sand: { grip: 0.7, speed: 0.7, drag: 0.4 },
  water: { grip: 0.75, speed: 0.8, drag: 0.5 },
  wall: { grip: 1, speed: 1, drag: 0 },
};

export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export function emptyInput(): InputState {
  return { throttle: 0, brake: 0, steer: 0, drift: false, item: false, itemAim: 0, lookBack: false };
}

export function emptyProgress(): RaceProgress {
  return { lap: 0, distance: 0, rank: 1, finished: false, finishTime: 0, lapTimes: [], bestLap: Infinity, wrongWay: false };
}

export function emptySlot(): ItemSlot {
  return { id: null, count: 0, roulette: 0, holding: false };
}

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}
