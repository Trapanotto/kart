// Item tuning and distribution. Owner: gameplay. Headless (no DOM).
// Every number that defines how an item feels lives here, so balancing happens in one file.

export type ItemId =
  | 'acorn' | 'acorn3' | 'honey' | 'giftbox' | 'yarn' | 'bees' | 'bubble'
  | 'carrot' | 'carrot3' | 'goldcarrot' | 'lolly' | 'cloud' | 'yawn';

export const ITEM_IDS: readonly ItemId[] = [
  'acorn', 'acorn3', 'honey', 'giftbox', 'yarn', 'bees', 'bubble', 'carrot', 'carrot3', 'goldcarrot', 'lolly', 'cloud', 'yawn',
];

/** Items that can be held out behind the kart while the item button is held. */
export const HOLDABLE: ReadonlySet<string> = new Set(['acorn', 'honey', 'giftbox']);

/** Rare, strong items: never given twice in a row to the same kart, and on a global cooldown. */
export const RARE: ReadonlySet<string> = new Set(['bees', 'lolly', 'goldcarrot', 'cloud']);

/** Uses per pickup. */
export const ITEM_COUNT: Record<ItemId, number> = {
  acorn: 1, acorn3: 3, honey: 1, giftbox: 1, yarn: 1, bees: 1, bubble: 1, carrot: 1, carrot3: 3, goldcarrot: 1, lolly: 1, cloud: 1, yawn: 1,
};

export const ITEM = {
  // --- boxes / roulette ---
  roulette: 1.5,
  /** Earliest moment the roulette can be stopped by pressing the button (s after pickup). */
  rouletteMinSpin: 0.4,
  /** Remaining spin after an early stop, for the "clack" animation. */
  rouletteStopTail: 0.12,
  boxRadius: 1.0,
  boxRespawn: 2.5,
  /** A thrown item cannot hit its owner for this long (s). */
  ownerGrace: 0.6,
  /** Distance behind the kart where held / dropped items sit (m). */
  holdDistance: 2.3,

  acorn: { speed: 40, minRelSpeed: 14, backSpeed: 24, bounces: 4, life: 7, radius: 0.45, strength: 0.7, followRoad: 0.9 },
  acorn3: { orbitRadius: 1.7, orbitSpeed: 4.2 },
  honey: { dropBehind: 2.6, lobDistance: 24, lobTime: 0.75, puddleRadius: 2.0, life: 18, maxVictims: 2, slowTime: 1.4, topSpeed: 0.6, accel: 0.6, grip: 0.45 },
  giftbox: { radius: 0.75, life: 45, lobDistance: 18, lobTime: 0.6, strength: 0.75 },
  yarn: { speed: 44, life: 12, radius: 0.65, turnRate: 5, homeDist: 26, strength: 0.6, wrapTime: 1.0, wrapTopSpeed: 0.75, backSpeed: 26 },
  bees: { speed: 85, harass: 3.5, topSpeed: 0.72, steer: 0.85, boostDrain: 3, dodgeFactor: 0.5, altitude: 5, cooldown: 14 },
  bubble: { time: 10 },
  carrot: { time: 1.3, power: 1.35 },
  goldcarrot: { window: 6, time: 1.0, power: 1.35, pressCooldown: 0.25 },
  lolly: { time: 7, topSpeed: 1.15, accel: 1.5, touch: 2.4, strength: 0.7 },
  cloud: { hover: 4, strength: 0.3, zapTime: 2, zapScale: 0.6, zapTopSpeed: 0.85, passDist: 2.6, passCooldown: 0.6, minLeft: 1.0, shakeAfter: 0.3, cooldown: 8 },
  yawn: { speed: 36, radius: 22, time: 3.5, topSpeed: 0.82, steer: 0.55, accel: 0.7 },
  /** Global cooldown after any rare item was handed out (no two karts get the same rare item close together). */
  rareCooldown: 6,
} as const;

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

/**
 * Weight tables at position factors 0 (leading), 0.25, 0.5, 0.75, 1 (far behind).
 * Interpolated linearly in between. Columns follow ITEM_IDS.
 */
//                acorn acorn3 honey gift yarn bees bubble carrot carrot3 gold lolly cloud yawn
const ANCHORS: number[][] = [
  /* 0.00 */ [25, 5, 25, 20, 0, 0, 15, 10, 0, 0, 0, 0, 0],
  /* 0.25 */ [18, 10, 14, 10, 8, 0, 12, 14, 6, 0, 0, 3, 5],
  /* 0.50 */ [10, 12, 6, 4, 12, 3, 8, 12, 14, 3, 2, 6, 8],
  /* 0.75 */ [4, 8, 2, 0, 12, 8, 4, 6, 18, 10, 10, 10, 8],
  /* 1.00 */ [0, 4, 0, 0, 8, 10, 0, 0, 16, 20, 24, 12, 6],
];

/** Raw (un-normalised) weights for a position factor 0..1. Writes into `out` if given. */
export function itemWeights(p: number, out: number[] = new Array(ITEM_IDS.length).fill(0)): number[] {
  const x = Math.min(1, Math.max(0, p)) * (ANCHORS.length - 1);
  const i = Math.min(ANCHORS.length - 2, Math.floor(x));
  const t = x - i;
  for (let k = 0; k < ITEM_IDS.length; k++) out[k] = ANCHORS[i][k] * (1 - t) + ANCHORS[i + 1][k] * t;
  return out;
}

/** Gap to the leader (m) that counts as "far behind" on its own. */
export const GAP_SCALE = 220;

/**
 * Position factor 0 (leading) .. 1 (far behind) from rank and gap to the leader.
 * Last place in a tight pack is about 0.7; last and 150 m behind is 1.
 */
export function positionFactor(rank: number, karts: number, gapToLeader: number): number {
  if (karts <= 1 || rank <= 1) return 0;
  const rankFrac = (rank - 1) / (karts - 1);
  return Math.min(1, Math.max(0, 0.7 * rankFrac + 0.5 * Math.min(1, Math.max(0, gapToLeader) / GAP_SCALE)));
}

/** Weighted draw. `blocked(id)` returns true for items that may not be given right now. */
export function drawItem(r: number, p: number, blocked?: (id: ItemId) => boolean, scratch?: number[]): ItemId {
  const w = itemWeights(p, scratch);
  let total = 0;
  for (let k = 0; k < w.length; k++) {
    if (blocked?.(ITEM_IDS[k])) w[k] = 0;
    total += w[k];
  }
  if (total <= 0) return 'acorn';
  let x = r * total;
  for (let k = 0; k < w.length; k++) {
    x -= w[k];
    if (x < 0) return ITEM_IDS[k];
  }
  return ITEM_IDS[w.length - 1];
}
