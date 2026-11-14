// Compositions. Melodies are scale degrees on an 8th-note grid, one bar per `|`:
//   1..7 degree (# / b accidentals), ' = octave up, , = octave down, - = hold, . = rest, 3_4 = two 16ths.
// Chords are roman numerals, one or two per bar. Patterns are defined in music.ts.
import type { InstrumentName } from './instruments';

export type BassPat = 'whole' | 'half' | 'country' | 'pop' | 'drive' | 'walk' | 'bounce' | 'none'
  | 'sparse' | 'octave' | 'funk' | 'synco';
export type DrumPat = 'none' | 'light' | 'pop' | 'country' | 'half' | 'drive' | 'march'
  | 'temple' | 'taiko' | 'taiko2' | 'conveyor' | 'factory' | 'factory2' | 'rush' | 'avalanche';
export type CompPat = 'block' | 'stab' | 'offbeat' | 'strum8' | 'pad' | 'arp' | 'arp16' | 'none' | 'arp3' | 'funk';
export type PercPat = 'claps' | 'shaker' | 'none' | 'wood' | 'rain' | 'press' | 'steam' | 'ice';
/** Drum fill played in the last bar of sections with `fill`. */
export type FillPat = 'std' | 'taiko' | 'clank' | 'avalanche';

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
  /** Drum fill style (default 'std'). */
  fill?: FillPat;
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

// ---------------------------------------------------------------- Bambus-Tempel: "Nebel im Bambushain"
// C minor pentatonic over Eb major chords (tonic = vi), straight 16ths, shakuhachi over koto and taiko.
const BA_A = '6, . 1 2 3 - 2_1 6, | 1 . 6, 1 2 - 1 6, | 5, . 6, 2 3 2 5 - | 6 - - . 5_6 5 3 . | 6, . 1 2 3 - 5 6 | 1\' - 6 5 6 . 1\' 2\' | 3\' . 2\' 3\' 5\' - 3\' 2\' | 6 - - - - . 5_6 1\'';
const BA_A2 = '6, . 1 2 3 - 2_1 6, | 1 . 6, 1 2 - 1 6, | 5, . 6, 2 3 2 5 - | 6 - - . 5_6 5 3 . | 1\' . 6 1\' 2\' - 1\' 6 | 5 - 6 5 1 . 2 1 | 2 . 5, 6, 2 - 3 2 | 6, - - - - - . .';
const BA_B = '6_1\' 6 5_6 1\' 6 . 5_6 1\' | 2\' . 6_5 6 2\' 1\' 6 5 | 3\' - 2\'_1\' 6 1\' - 6 5 | 5 - - . 3_5 6 1\' 2\' | 1\' . 6 1\' 2\' 1\' 6 5 | 6 . 5 6 2\' - 3\' 2\' | 1\' 2\' 3\' . 5\' - 3\' 2\' | 2\' - - - 6_5 3 2 5,';
const BA_BRK = '6 - - - 5 - 3 - | 1\' - - - 6 - - - | 3 - 5 - 6 - 1\' - | 2\' - - - - - . .';
const BA_CH_A = 'vi | IV | V | vi | vi | IV | iii | vi';
const BA_CH_A2 = 'vi | IV | V | vi | vi | IV | V | vi';
const BA_CH_B = 'IV | V | vi | I | IV | V | vi | V';

export const BAMBUS: SongDef = {
  id: 'bambus', bpm: 112, key: 63, swing: 0, leadInst: 'shaku', counterInst: 'koto', compInst: 'koto', fill: 'taiko',
  sections: {
    intro: { bars: 4, chords: 'vi7 | IVmaj7 | vi7 | V', lead: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 2 - 5, .', bass: 'sparse', drums: 'temple', comp: 'arp3', fill: true },
    A: { bars: 8, chords: BA_CH_A, lead: BA_A, bass: 'sparse', drums: 'taiko', perc: 'wood', comp: 'arp3', crash: true },
    A2: { bars: 8, chords: BA_CH_A2, lead: BA_A2, bass: 'sparse', drums: 'taiko', perc: 'wood', comp: 'arp3', fill: true },
    B: { bars: 8, chords: BA_CH_B, lead: BA_B, leadInst: 'koto', bass: 'half', drums: 'taiko2', perc: 'rain', comp: 'pad', compInst: 'pad', crash: true, fill: true },
    brk: { bars: 4, chords: 'vi7 | IVmaj7 | vi7 | V', lead: BA_BRK, bass: 'whole', drums: 'temple', perc: 'rain', comp: 'arp', counter: true, fill: true },
    A3: { bars: 8, chords: BA_CH_A, lead: BA_A, bass: 'sparse', drums: 'taiko2', perc: 'wood', comp: 'arp3', counter: true, crash: true },
    Bh: { bars: 8, chords: BA_CH_B, lead: BA_B, leadInst: 'koto', harmony: true, bass: 'half', drums: 'taiko2', perc: 'rain', comp: 'pad', compInst: 'pad', fill: true },
    A4: { bars: 8, chords: BA_CH_A2, lead: BA_A2, harmony: true, bass: 'sparse', drums: 'taiko2', perc: 'wood', comp: 'arp16', crash: true, fill: true },
  },
  order: ['intro', 'A', 'A2', 'B', 'brk', 'A3', 'Bh', 'A4'],
  loopTo: 1,
};

// ---------------------------------------------------------------- Honigfabrik: "Summende Maschinen"
// Bb major shuffle-funk: vibraphone and bee kazoo over clavinet, clanking machine drums and steam presses.
const HO_A = '1 . 3 5 1\' . 5 3 | 6 5 3 . 5 . 1 . | 4 . 6 1\' 4\' . 1\' 6 | 5 - 7 - 2\' . . 5_5 | 1\' . 1\' 2\' 3\' . 1\' 5 | 6 . 5 3 5 . 3 1 | 4 . 6 . 5 . 7 . | 1 . 5, . 1 - . .';
const HO_A2 = '1 . 3 5 1\' . 5 3 | 6 5 3 . 5 . 1 . | 4 . 6 1\' 4\' . 1\' 6 | 5 - 7 - 2\' . . 5_5 | 3\' . 2\' 1\' 5 . 1\' . | 6, . 1 3 6 . 3 1 | 2 . 4 6 5 . 7 2\' | 1\' - - . . . . .';
const HO_B = '6 6 . 6 5 . 4 . | 5 5 . 5 7 . 2\' . | 6 6 . 6 5 . 3 . | 6 - 1\' - 3\' - - . | 2\' 2\' . 2\' 1\' . 6 . | 7 7 . 7 2\' . 5 . | 1\' . 3\' . 2\' . 3\' 1\' | 2\' - 7 - 5 - 4 3';
const HO_BRK = '6 . 1\' 6 . . 3 . | 4 . 6 4 . . 1\' . | 2 . 4 2 . . 6 . | 5 . 7 . 2\' . 4\' .';
const HO_CH_A = 'I | I | IV | V | I | I | IV V | I';
const HO_CH_A2 = 'I | I | IV | V | I | vi | ii V7 | I';
const HO_CH_B = 'IV | V | iii | vi | ii | V | I | V7';

export const HONIG: SongDef = {
  id: 'honig', bpm: 118, key: 70, swing: 0.2, leadInst: 'mallet', counterInst: 'pipe', compInst: 'clav', fill: 'clank',
  sections: {
    intro: { bars: 4, chords: 'I | IV | I | V', lead: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 5 . 5_5 7,', bass: 'funk', drums: 'conveyor', comp: 'offbeat', fill: true },
    A: { bars: 8, chords: HO_CH_A, lead: HO_A, bass: 'funk', drums: 'factory', perc: 'press', comp: 'funk', crash: true },
    A2: { bars: 8, chords: HO_CH_A2, lead: HO_A2, bass: 'funk', drums: 'factory', perc: 'press', comp: 'offbeat', fill: true },
    B: { bars: 8, chords: HO_CH_B, lead: HO_B, leadInst: 'buzz', bass: 'octave', drums: 'factory2', perc: 'steam', comp: 'arp', compInst: 'mallet', crash: true, fill: true },
    brk: { bars: 4, chords: 'vi | IV | ii | V7', lead: HO_BRK, bass: 'whole', drums: 'conveyor', perc: 'steam', comp: 'stab', counter: true, fill: true },
    A3: { bars: 8, chords: HO_CH_A, lead: HO_A, bass: 'octave', drums: 'factory2', perc: 'press', comp: 'funk', counter: true, crash: true },
    Bh: { bars: 8, chords: HO_CH_B, lead: HO_B, leadInst: 'buzz', harmony: true, bass: 'octave', drums: 'factory2', perc: 'steam', comp: 'arp', compInst: 'mallet', fill: true },
    A4: { bars: 8, chords: HO_CH_A2, lead: HO_A2, harmony: true, bass: 'funk', drums: 'factory2', perc: 'press', comp: 'arp16', crash: true, fill: true },
  },
  order: ['intro', 'A', 'A2', 'B', 'brk', 'A3', 'Bh', 'A4'],
  loopTo: 1,
};

// ---------------------------------------------------------------- Gletscher-Gipfel: "Lawinenlauf"
// F# minor over A major chords (tonic = vi), fast and straight: icy synth lead, glass-bell arpeggios,
// an alphorn calm before the avalanche, then double-time kicks.
const GL_A = '6, . 3 . 6 3 1 3 | 4 . 1 . 6 4 1 6, | 5 . 3 . 1\' 5 3 1 | 7, . 2 5 7 - 5 2 | 6, 1 3 6 1\' - 6 3 | 4 6 1\' 6 4\' - 1\' 6 | 2\' - 7 5 7 . 2\' 3\' | 2\' - - - 7 . 5 .';
const GL_A2 = '6, . 3 . 6 3 1 3 | 4 . 1 . 6 4 1 6, | 5 . 3 . 1\' 5 3 1 | 7, . 2 5 7 - 5 2 | 1\' . 6 1\' 3\' - 1\' 6 | 4\' - 2\' 1\' 6 . 4 6 | 5 . 7 . 2\' 3\' 2\' 7 | 6 - - - - - . .';
const GL_B = '6 - - - 1\' - - - | 7 - - - 5 - 7 - | 3\' - - - 5 - 7 - | 6 - - - - - 3\' 1\' | 2\' - - - 1\' - 6 - | 7 - - - 2\' - 3\' 2\' | 1\' - 3\' - 5 - 1\' - | 7 - - - - . 5_6 7';
const GL_BRK = '6, - - - 1 - 3 - | 4 - - - 6, - 1 - | 2 - - - 4 - 6 - | 5 - - - 7, - - .';
const GL_CH_A = 'vi | IV | I | V | vi | IV | V | V';
const GL_CH_A2 = 'vi | IV | I | V | vi | IV | V | vi';
const GL_CH_B = 'IV | V | iii | vi | IV | V | I | V';

export const GLETSCHER: SongDef = {
  id: 'gletscher', bpm: 152, key: 69, swing: 0, leadInst: 'icelead', counterInst: 'glass', compInst: 'glass', fill: 'avalanche',
  sections: {
    intro: { bars: 4, chords: 'vi | IV | I | V', lead: '. . . . . . . . | . . . . . . . . | . . . . . . . . | . . . . 3 2 7, .', bass: 'synco', drums: 'light', comp: 'arp', fill: true },
    A: { bars: 8, chords: GL_CH_A, lead: GL_A, bass: 'drive', drums: 'rush', perc: 'ice', comp: 'arp', crash: true },
    A2: { bars: 8, chords: GL_CH_A2, lead: GL_A2, bass: 'synco', drums: 'rush', perc: 'ice', comp: 'arp', fill: true },
    B: { bars: 8, chords: GL_CH_B, lead: GL_B, bass: 'half', drums: 'half', comp: 'pad', compInst: 'icepad', counter: true, crash: true },
    brk: { bars: 4, chords: 'vi | IV | ii | V', lead: GL_BRK, leadInst: 'horn', bass: 'whole', drums: 'none', comp: 'pad', compInst: 'icepad', fill: true },
    lawine: { bars: 8, chords: GL_CH_A, lead: GL_A, bass: 'drive', drums: 'avalanche', perc: 'ice', comp: 'arp16', counter: true, crash: true },
    Bh: { bars: 8, chords: GL_CH_B, lead: GL_B, harmony: true, bass: 'synco', drums: 'rush', perc: 'ice', comp: 'arp', fill: true },
    A4: { bars: 8, chords: GL_CH_A2, lead: GL_A2, harmony: true, bass: 'drive', drums: 'avalanche', perc: 'ice', comp: 'arp16', crash: true, fill: true },
  },
  order: ['intro', 'A', 'A2', 'B', 'brk', 'lawine', 'Bh', 'A4'],
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

export const SONGS: Record<string, SongDef> = {
  menu: MENU, kleeblatt: KLEEBLATT, bambus: BAMBUS, honig: HONIG, gletscher: GLETSCHER,
  win: JINGLE_WIN, lose: JINGLE_LOSE, finishWin: FINISH_WIN,
};

/** Race songs by track id, in cup order. */
export const RACE_SONGS: Record<string, SongDef> = { kleeblatt: KLEEBLATT, bambus: BAMBUS, honig: HONIG, gletscher: GLETSCHER };

/** Song for a track: meta.music wins, then the track id, then a match in the name, else Kleeblatt. */
export function songForTrack(id: string, name: string, music?: string): SongDef {
  if (music && SONGS[music]) return SONGS[music];
  if (RACE_SONGS[id]) return RACE_SONGS[id];
  const n = name.toLowerCase();
  for (const k in RACE_SONGS) if (n.includes(k)) return RACE_SONGS[k];
  return KLEEBLATT;
}
