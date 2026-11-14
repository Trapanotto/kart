// Rapier loader shared by the physics system, sandbox and tests. Owner: physics.
// The engine (several MB with its WASM) is imported on demand, so it is not part of the start-up
// download: the title screen appears first and the engine arrives in the background.
import type RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Loads and initialises the Rapier WASM module once (works in the browser and in Node). */
export function loadRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = import('@dimforge/rapier3d-compat').then((m) => m.default.init().then(() => m.default));
  return ready;
}

export type Rapier = typeof RAPIER;
