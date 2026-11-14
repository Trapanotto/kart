// All hand-authored track definitions, in cup order. Owner: track.
import type { TrackDef } from '../format';
import { kleeblattTal } from './kleeblattTal';
import { bambusTempel } from './bambusTempel';
import { gletscherGipfel } from './gletscherGipfel';
import { honigfabrik } from './honigfabrik';

export const TRACK_DEFS: TrackDef[] = [kleeblattTal, bambusTempel, honigfabrik, gletscherGipfel];
