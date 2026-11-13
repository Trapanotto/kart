// The planned cup and how the available tracks (app.tracks) map onto it.
import type { TrackMeta } from '../core/types';

export interface Slot { key: string; name: string; meta: TrackMeta | null }

const PLANNED = [
  { key: 'klee', name: 'Kleeblatt-Tal' },
  { key: 'bambus', name: 'Bambus-Tempel' },
  { key: 'honig', name: 'Honigfabrik' },
  { key: 'gletscher', name: 'Gletscher-Gipfel' },
];

export const CUP = { id: 'kleeblatt', name: 'Kleeblatt-Cup' };

const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöü]/g, '');

export function cupSlots(tracks: readonly TrackMeta[]): { slots: Slot[]; extras: TrackMeta[] } {
  const used = new Set<TrackMeta>();
  const slots = PLANNED.map((p) => {
    const meta = tracks.find((t) => !used.has(t) && (norm(t.name).includes(p.key) || norm(t.id).includes(p.key))) ?? null;
    if (meta) used.add(meta);
    return { key: p.key, name: meta?.name ?? p.name, meta };
  });
  return { slots, extras: tracks.filter((t) => !used.has(t)) };
}

/** Tracks a Grand Prix runs through, in order. Falls back to whatever exists. */
export function cupTracks(tracks: readonly TrackMeta[]): TrackMeta[] {
  const { slots, extras } = cupSlots(tracks);
  const real = slots.map((s) => s.meta).filter((m): m is TrackMeta => !!m);
  return real.length ? real : extras.slice(0, 4);
}
