// UI-owned persistent state: trophies, personal bests, seen hints, UI preferences.
import type { CharacterId } from '../core/types';

export type Trophy = 'gold' | 'silver' | 'bronze';
export interface PersonalBest { time: number; lap: number; char: CharacterId; date: number }

export interface UiStore {
  touchLayout: 'stick' | 'zones';
  hints: string[];
  trophies: Record<string, Trophy>;
  pb: Record<string, PersonalBest>;
  lastChar: CharacterId | null;
  lastClass: string | null;
  touchInit: boolean;
  touchGas: boolean;
}

const KEY = 'tk2.ui';
const DEFAULTS: UiStore = { touchLayout: 'stick', hints: [], trophies: {}, pb: {}, lastChar: null, lastClass: null, touchInit: false, touchGas: false };

function load(): UiStore {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}

export const store: UiStore = load();

export function saveStore(): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

const RANK: Record<Trophy, number> = { gold: 3, silver: 2, bronze: 1 };

/** Stores a trophy if it is better than the previous one. Returns true if it improved. */
export function awardTrophy(cup: string, cls: string, t: Trophy): boolean {
  const k = `${cup}:${cls}`;
  const prev = store.trophies[k];
  if (prev && RANK[prev] >= RANK[t]) return false;
  store.trophies[k] = t;
  saveStore();
  return true;
}

export function trophyFor(cup: string, cls: string): Trophy | null {
  return store.trophies[`${cup}:${cls}`] ?? null;
}

export function pbFor(track: string, cls: string): PersonalBest | null {
  return store.pb[`${track}:${cls}`] ?? null;
}

/** Returns the previous best (or null) and stores the new one if better. */
export function submitPb(track: string, cls: string, pb: PersonalBest): { prev: PersonalBest | null; improved: boolean } {
  const k = `${track}:${cls}`;
  const prev = store.pb[k] ?? null;
  const improved = !prev || pb.time < prev.time;
  if (improved) { store.pb[k] = pb; saveStore(); }
  return { prev, improved };
}

export function hintSeen(id: string): boolean { return store.hints.includes(id); }
export function markHint(id: string): void { if (!hintSeen(id)) { store.hints.push(id); saveStore(); } }
