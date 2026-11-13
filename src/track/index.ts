// Track module entry (headless part): list and load tracks. Owner: track.
// The view lives in ./view/trackView.ts (render side).
import type { TrackMeta, TrackRuntime } from '../core/types';
import { createTestTrack } from '../stubs/testTrack';
import { BuiltTrack, buildTrack } from './builder';
import { TRACK_DEFS } from './tracks';

export { BuiltTrack, buildTrack };
export { TRACK_DEFS };

/** Metadata of every track, cup order first; the grey-box test track stays available as 'test'. */
export function trackList(): TrackMeta[] {
  const metas = [...TRACK_DEFS]
    .sort((a, b) => a.cup - b.cup || (a.order ?? 0) - (b.order ?? 0))
    .map((d) => ({ id: d.id, name: d.name, laps: d.laps, cup: d.cup, environment: d.environment, music: d.music }));
  return [...metas, createTestTrack().meta];
}

/** Builds a fresh runtime (lap state, collider flags) for one race. */
export async function loadTrack(id: string): Promise<TrackRuntime> {
  if (id === 'test') return createTestTrack();
  const def = TRACK_DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown track '${id}'`);
  return buildTrack(def);
}
