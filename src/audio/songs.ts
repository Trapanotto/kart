// Compositions. Melodies are scale degrees on an 8th-note grid, one bar per `|`:
//   1..7 degree (# / b accidentals), ' = octave up, , = octave down, - = hold, . = rest, 3_4 = two 16ths.
// Chords are roman numerals, one or two per bar. Patterns are defined in music.ts.
import type { InstrumentName } from './instruments';

export type BassPat = 'whole' | 'half' | 'country' | 'pop' | 'drive' | 'walk' | 'bounce' | 'none';
export type DrumPat = 'none' | 'light' | 'pop' | 'country' | 'half' | 'drive' | 'march';
export type CompPat = 'block' | 'stab' | 'offbeat' | 'strum8' | 'pad' | 'arp' | 'arp16' | 'none';
export type PercPat = 'claps' | 'shaker' | 'none';

export interface SectionDef {
  bars: number;
  chords: string;
  lead?: string;
  leadInst?: InstrumentName;
  /** Diatonic third below the lead on the counter layer. */
  harmony?: boolean;
  /** Bell arpeggio on the counter layer. */
  counter?: boolean;
  bass: BassPat;
  drums: DrumPat;
  perc?: PercPat;
  comp: CompPat;
  compInst?: InstrumentName;
  /** Drum fill in the last bar. */
  fill?: boolean;
  crash?: boolean;
}

export interface SongDef {
  id: string;
  bpm: number;
  /** MIDI note of the tonic used for degree 1 of the melody. */
  key: number;
  swing: number;
  leadInst: InstrumentName;
  counterInst: InstrumentName;
  compInst: InstrumentName;
  sections: Record<string, SectionDef>;
  order: string[];
  /** Index in `order` to loop back to; -1 = play once. */
  loopTo: number;
}

// ---------------------------------------------------------------- Menu: "Pfotenparade" (F major)
const MENU_A = '5 . 3 . 1 - 3 5 | 4 3 2 . 7, . 2 . | 3 . 1 . 6, - 1 3 | 4 - 6 - 5 4 2 1 | 5 . 3 . 1\' - 5 6 | 5 - 2 - 7, . 2 . | 6 5 4 . 6 5 4 2 | 3 - 2 - 5 - - .';
const MENU_A2 = '5 . 3 . 1 - 3 5 | 4 3 2 . 7, . 2 . | 3 . 1 . 6, - 1 3 | 4 - 6 - 5 4 2 1 | 1\' . 3\' . 5\' - 3\' 1\' | 2\' - 7 - 5 . 7 . | 6 . 1\' . 4\' - 2\' 1\' | 1\' - - - - . . .';
const MENU_B = '4\' - 2\' - 1\' - 6 . | 7 - 2\' - 7 - 5 . | 3\' - 2\' 1\' 7 - 5 . | 6 - 1\' - 3\' - - . | 4\' - 2\' - 6 - 2\' . | 7 - 2\' - 5\' - 4\' 3\' | 1\' - - - . 5 6 7 | 2\' - 7 - 5 - . .';
const MENU_C = '3 - - - 2 - 1 - | 1 - - - 6, - - - | 5 - - - 3 - 5 - | 5 - 4 3 2 - - . | 3 - - - 5 - 6 - | 6 - - - 5 - 4 - | 4 - 2 - 6, - 2 - | 7, - 2 - 5 - 4 -';

export const MENU: SongDef = {
  id: 'menu', bpm: 108, key: 65, swing: 0.14, leadInst: 'flute', counterInst: 'bell', compInst: 'keys',
  sections: {
    intro: { bars: 4, chords: 'I | vi | IV | V', lead: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 5, 6, 7, 1', bass: 'whole', drums: 'none', comp: 'arp', compInst: 'marimba', fill: true },
    A: { bars: 8, chords: 'I | V | vi | IV | I | V | IV | V', lead: MENU_A, bass: 'pop', drums: 'pop', comp: 'offbeat', crash: true },
    B: { bars: 8, chords: 'IV | V | iii | vi | ii | V | I | V7', lead: MENU_B, bass: 'drive', drums: 'pop', comp: 'block', fill: true },
    A2: { bars: 8, chords: 'I | V | vi | IV | I | V | IV | I', lead: MENU_A2, bass: 'pop', drums: 'pop', comp: 'offbeat', counter: true, crash: true },
    C: { bars: 8, chords: 'vi | IV | I | V | vi | IV | ii | V7', lead: MENU_C, leadInst: 'keys', bass: 'whole', drums: 'half', comp: 'pad', compInst: 'pad', counter: true, fill: true },
    Ah: { bars: 8, chords: 'I | V | vi | IV | I | V | IV | V', lead: MENU_A, leadInst: 'marimba', harmony: true, bass: 'bounce', drums: 'pop', comp: 'offbeat', crash: true },
    B2: { bars: 8, chords: 'IV | V | iii | vi | ii | V | I | V7', lead: MENU_B, bass: 'drive', drums: 'pop', comp: 'block', counter: true, fill: true },
  },
  order: ['intro', 'A', 'B', 'A2', 'C', 'Ah', 'B2'],
  loopTo: 1,
};

// ---------------------------------------------------------------- Kleeblatt-Tal: "Klee und Kurven" (G major, country hoedown)
const KL_A = '5 . 5 6 5 3 1 2 | 4 . 5 4 6 . 4 . | 5 . 5 6 5 3 1 3 | 2 . 7, 2 5 - . . | 1\' . 3\' 2\' 1\' 5 3 . | 6 . 5 4 4 . 6 . | 5 . 4 3 2 . 7, . | 1 - 3 - 1 . . .';
const KL_A2 = '5 . 5 6 5 3 1 2 | 4 . 5 4 6 . 4 . | 5 . 5 6 5 3 1 3 | 2 . 7, 2 5 - . . | 3\' . 2\' 1\' 5 . 3 . | 4\' . 2\' 1\' 6 . 4 . | 7 . 6 7 2\' - 7 . | 1\' - - - - . . .';
const KL_B = '3\' - 2\' - 1\' - 5 - | 6 - - - 1\' - - - | 5 - 1\' - 3\' - 2\' - | 2\' - - - . . 7 1\' | 3\' - 2\' - 1\' - 5 - | 1\' - 6 - 4 - 6 - | 5 - 6 - 7 - 2\' - | 2\' - - - . . . .';
const KL_BREAK = '1\' . . 5 . . 3 . | 4 . . 6 . . 1\' . | 2\' . . 7 . . 5 . | 2\' - 7 - 5 - 2 -';

export const KLEEBLATT: SongDef = {
  id: 'kleeblatt', bpm: 128, key: 67, swing: 0.06, leadInst: 'fiddle', counterInst: 'bell', compInst: 'pluck',
  sections: {
    intro: { bars: 4, chords: 'I | IV | I | V', lead: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 5, 6, 7, .', bass: 'country', drums: 'light', comp: 'offbeat', fill: true },
    A: { bars: 8, chords: 'I | IV | I | V | I | IV | V | I', lead: KL_A, bass: 'country', drums: 'country', perc: 'claps', comp: 'offbeat', crash: true },
    A2: { bars: 8, chords: 'I | IV | I | V | I | IV | V | I', lead: KL_A2, bass: 'bounce', drums: 'country', perc: 'claps', comp: 'offbeat', fill: true },
    B: { bars: 8, chords: 'vi | IV | I | V | vi | IV | V | V7', lead: KL_B, bass: 'walk', drums: 'pop', perc: 'shaker', comp: 'strum8', crash: true, fill: true },
    brk: { bars: 4, chords: 'I | IV | V | V', lead: KL_BREAK, leadInst: 'flute', bass: 'whole', drums: 'half', comp: 'stab', counter: true, fill: true },
    A3: { bars: 8, chords: 'I | IV | I | V | I | IV | V | I', lead: KL_A, bass: 'country', drums: 'drive', perc: 'claps', comp: 'offbeat', counter: true, crash: true },
    Bh: { bars: 8, chords: 'vi | IV | I | V | vi | IV | V | V7', lead: KL_B, harmony: true, bass: 'walk', drums: 'pop', perc: 'shaker', comp: 'strum8', fill: true },
    A4: { bars: 8, chords: 'I | IV | I | V | I | IV | V | I', lead: KL_A2, leadInst: 'marimba', harmony: true, bass: 'bounce', drums: 'drive', perc: 'claps', comp: 'arp16', counter: false, crash: true, fill: true },
  },
  order: ['intro', 'A', 'A2', 'B', 'brk', 'A3', 'Bh', 'A4'],
  loopTo: 1,
};

// ---------------------------------------------------------------- Jingles (C major, play once)
export const JINGLE_WIN: SongDef = {
  id: 'win', bpm: 122, key: 60, swing: 0, leadInst: 'brass', counterInst: 'bell', compInst: 'brass',
  sections: {
    w: { bars: 4, chords: 'I | IV | V | I', lead: '1 . 3 . 5 . 1\' - | 6 . 4 . 6 . 1\' - | 7 . 5 . 2\' . 7 - | 1\' - - - - - - -', bass: 'half', drums: 'march', comp: 'block', counter: true, crash: true },
  },
  order: ['w'],
  loopTo: -1,
};

export const JINGLE_LOSE: SongDef = {
  id: 'lose', bpm: 100, key: 60, swing: 0.1, leadInst: 'flute', counterInst: 'bell', compInst: 'keys',
  sections: {
    l: { bars: 4, chords: 'vi | IV | V | I', lead: '3 . 2 . 1 . 6, - | 6 . 4 . 2 - - - | 2 - 7, - 5, - - - | 1 - - - - - - -', bass: 'whole', drums: 'none', comp: 'pad', compInst: 'keys' },
  },
  order: ['l'],
  loopTo: -1,
};

/** Short fanfare when crossing the line. */
export const FINISH_WIN: SongDef = {
  id: 'finishWin', bpm: 150, key: 67, swing: 0, leadInst: 'brass', counterInst: 'bell', compInst: 'brass',
  sections: { f: { bars: 2, chords: 'IV V | I', lead: '5 5 5 . 6 . 7 . | 1\' - - - - - - -', bass: 'half', drums: 'march', comp: 'block', crash: true } },
  order: ['f'], loopTo: -1,
};

export const SONGS: Record<string, SongDef> = { menu: MENU, kleeblatt: KLEEBLATT, win: JINGLE_WIN, lose: JINGLE_LOSE, finishWin: FINISH_WIN };

/** Song for a track (meta.music wins, otherwise by name). */
export function songForTrack(id: string, name: string, music?: string): SongDef {
  if (music && SONGS[music]) return SONGS[music];
  return KLEEBLATT;
}
