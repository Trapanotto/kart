// Node-only helper for the gameplay tests: pick the PhysicsSystem / TrackRuntime factories from
// environment variables, so the same suites rerun on the real physics and real tracks:
//
//   GAMEPLAY_PHYSICS="src/physics/index.ts#createPhysics"   factory(track, config) => PhysicsSystem | Promise
//   GAMEPLAY_TRACK="src/track/index.ts#loadTrack#kleeblatt"  factory(...args) => TrackRuntime | Promise
//
// Unset = stub physics / grey-box test track. Owner: gameplay.
import type { HarnessOptions } from './harness';

type AnyFn = (...args: unknown[]) => unknown;

async function load(spec: string): Promise<{ fn: AnyFn; args: string[] }> {
  const [file, name, ...args] = spec.split('#');
  const { pathToFileURL } = await import('node:url');
  const { resolve } = await import('node:path');
  const mod = (await import(/* @vite-ignore */ pathToFileURL(resolve(process.cwd(), file)).href)) as Record<string, AnyFn>;
  const fn = mod[name];
  if (typeof fn !== 'function') throw new Error(`${spec}: export ${name} is not a function`);
  return { fn, args };
}

export async function factoriesFromEnv(): Promise<Pick<HarnessOptions, 'physics' | 'track'>> {
  const out: Pick<HarnessOptions, 'physics' | 'track'> = {};
  const p = process.env.GAMEPLAY_PHYSICS, t = process.env.GAMEPLAY_TRACK;
  if (p) { const { fn } = await load(p); out.physics = (track, config) => fn(track, config) as never; }
  if (t) { const { fn, args } = await load(t); out.track = () => fn(...args) as never; }
  return out;
}

export function describeTarget(): string {
  return `physics=${process.env.GAMEPLAY_PHYSICS ?? 'stub'} track=${process.env.GAMEPLAY_TRACK ?? 'test'}`;
}
