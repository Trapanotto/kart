// Rapier loader shared by the physics system, sandbox and tests. Owner: physics.
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Initialises the Rapier WASM module once (works in the browser and in Node). */
export function loadRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export type Rapier = typeof RAPIER;
