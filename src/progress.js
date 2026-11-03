// Spielfortschritt: Pokale, Freischaltungen (im Browser gespeichert)
const KEY = 'tk_progress';

export function loadProgress() {
  try {
    return { trophies: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (e) {
    return { trophies: {} };
  }
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* Speicher nicht verfügbar */ }
}

// 1 = Gold, 2 = Silber, 3 = Bronze, 0 = keiner
export function trophy(p, cls, cup) {
  return p.trophies[cls + '-' + cup] || 0;
}

// Speichert den Pokal, wenn er besser ist als der bisherige. Gibt true zurück, wenn neu.
export function award(p, cls, cup, place) {
  const k = cls + '-' + cup;
  if (place <= 3 && (!p.trophies[k] || place < p.trophies[k])) {
    p.trophies[k] = place;
    saveProgress(p);
    return true;
  }
  return false;
}

// Spiegel-Modus: Gold in allen Cups in der Klasse „Flott“ oder „Turbo“
export function mirrorUnlocked(p, cups = 2) {
  for (let cup = 0; cup < cups; cup++) if (![1, 2].some((cls) => p.trophies[cls + '-' + cup] === 1)) return false;
  return true;
}

export const TROPHY_ICON = ['', '🥇', '🥈', '🥉'];

// Zeitfahr-Medaillen abhängig von der Streckenlänge (3 Runden)
export function medalTimes(length) {
  return { gold: (length * 3) / 32, silver: (length * 3) / 29.5, bronze: (length * 3) / 27 };
}
export function medalFor(time, length) {
  if (!time) return 0;
  const m = medalTimes(length);
  return time <= m.gold ? 1 : time <= m.silver ? 2 : time <= m.bronze ? 3 : 0;
}
