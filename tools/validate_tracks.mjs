// Prüft alle Strecken: Länge, engster Kurvenradius, Mindestabstand zwischen Streckenteilen, Steigung.
// Aufruf: node tools/validate_tracks.mjs
import { TRACKS, sampleCenterline, ROAD_HALF, OFFROAD } from '../src/data.js';

const need = 2 * (ROAD_HALF + OFFROAD) + 6;
let ok = true;
for (const t of TRACKS) {
  const { points: P, length } = sampleCenterline(t.shape);
  const n = P.length;
  let minR = Infinity, minSep = Infinity, maxSlope = 0;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 5 + n) % n], b = P[i], c = P[(i + 5) % n];
    const ab = Math.hypot(b[0] - a[0], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[2] - b[2]), ca = Math.hypot(a[0] - c[0], a[2] - c[2]);
    const cross = Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]));
    if (cross > 1e-6) minR = Math.min(minR, (ab * bc * ca) / (2 * cross));
    const nx = P[(i + 1) % n];
    maxSlope = Math.max(maxSlope, Math.abs(nx[1] - b[1]) / Math.hypot(nx[0] - b[0], nx[2] - b[2]));
    for (let j = i + 40; j < n - 40 + i && j < n; j++) {
      const q = P[j];
      if (Math.abs(q[1] - b[1]) > 8) continue;
      minSep = Math.min(minSep, Math.hypot(q[0] - b[0], q[2] - b[2]));
    }
  }
  const bad = minR < 26 || minSep < need || maxSlope > 0.18;
  if (bad) ok = false;
  console.log(`${bad ? '✗' : '✓'} ${t.name.padEnd(20)} Länge ${length.toFixed(0).padStart(5)}  Radius ${minR.toFixed(1).padStart(6)}  Abstand ${minSep.toFixed(1).padStart(6)} (min ${need})  Steigung ${(maxSlope * 100).toFixed(1)}%`);
}
process.exit(ok ? 0 : 1);
