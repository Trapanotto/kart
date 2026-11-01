// Computer-Fahrer
import { ROAD_HALF } from './data.js';

export class AIDriver {
  constructor(kart, skill) {
    this.k = kart;
    this.skill = skill;              // ~0.9 .. 1.05
    this.lane = (Math.random() - 0.5) * 0.9;
    this.laneTimer = 0;
    this.itemHold = 0;
    this.stuck = 0;
    this.reverse = 0;
    this.mistake = 0;
  }

  update(dt, race) {
    const k = this.k, tr = race.track, inp = k.input;
    const N = tr.N;
    const i = k.trackIdx < 0 ? 0 : k.trackIdx;

    // Spur wechseln
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 2 + Math.random() * 4;
      this.lane = Math.max(-0.75, Math.min(0.75, this.lane + (Math.random() - 0.5) * 0.8));
      // manchmal Item-Box anpeilen
      if (!k.item && Math.random() < 0.6) this.lane = (Math.round((Math.random() - 0.5) * 4) * 3.4) / ROAD_HALF;
    }

    // Kurve voraus
    const look = Math.floor(7 + k.speed * 0.45);
    const Ti = tr.T[i], Ta = tr.T[(i + 25) % N], Tb = tr.T[(i + 12) % N];
    const curve = Math.atan2(Ti.x * Ta.z - Ti.z * Ta.x, Ti.x * Ta.x + Ti.z * Ta.z); // >0: Rechtskurve
    const curveNear = Math.atan2(Ti.x * Tb.z - Ti.z * Tb.x, Ti.x * Tb.x + Ti.z * Tb.z);

    // Innenbahn in Kurven
    const hw = tr.hw[i];
    let lane = this.lane * hw;
    if (Math.abs(curve) > 0.25) lane = lane * 0.4 + (curve > 0 ? 1 : -1) * hw * 0.45;
    // Vor einer Lücke: mittig und mit Vollgas auf die Rampe
    let gapAhead = false;
    for (let g = 0; g < 45; g += 3) if (tr.gap[(i + g) % N] || tr.launch[(i + g) % N]) { gapAhead = true; break; }
    if (gapAhead) lane = 0;
    // Honigpfützen ausweichen
    for (const e of race.items.ents) {
      if (e.type !== 'honey') continue;
      const dx = e.pos.x - k.pos.x, dz = e.pos.z - k.pos.z;
      if (dx * dx + dz * dz < 900) {
        const loc = tr.locate(e.pos, k.trackIdx, this._l || (this._l = {}));
        let ahead = loc.i - i;
        if (ahead < -N / 2) ahead += N;
        if (ahead > 0 && ahead < 15 && Math.abs(loc.lat - lane) < 4) lane = loc.lat + (loc.lat > 0 ? -5 : 5);
      }
    }
    // Hindernissen ausweichen (geschickte Fahrer öfter)
    if (race.hazards && Math.random() < this.skill) for (const h of race.hazards.list) {
      const dx = h.pos.x - k.pos.x, dz = h.pos.z - k.pos.z;
      if (dx * dx + dz * dz > 1600) continue;
      const loc = tr.locate(h.pos, k.trackIdx, this._h || (this._h = {}));
      let ahead = loc.i - i;
      if (ahead < -N / 2) ahead += N;
      if (ahead > 0 && ahead < 18 && Math.abs(loc.lat - lane) < h.r + 2.5) {
        lane = loc.lat + (loc.lat > 0 ? -1 : 1) * (h.r + 3);
        lane = Math.max(-hw + 1, Math.min(hw - 1, lane));
      }
    }
    const target = tr.pointAt(i + look, lane);
    const dx = target.x - k.pos.x, dz = target.z - k.pos.z;
    const f = k.forward;
    const right = -f.z * dx + f.x * dz; // >0: Ziel liegt rechts
    const fwd = f.x * dx + f.z * dz;
    let ang = Math.atan2(right, fwd);
    let steer = Math.max(-1, Math.min(1, ang * 2.6));

    // Fehler ab und zu (je schwächer, desto öfter)
    this.mistake -= dt;
    if (this.mistake < -6 + this.skill * 3 && Math.random() < 0.004) this.mistake = 0.5;
    if (this.mistake > 0) steer += Math.sin(race.time * 7) * 0.6;

    let throttle = 1;
    if (!gapAhead && Math.abs(curve) > 0.9 && k.speed > k.st.maxSpeed * 0.8 && !k.drift.on) throttle = 0.6;

    // Drift in längeren Kurven
    let drift = false;
    if (k.drift.on) {
      drift = Math.abs(curveNear) > 0.12 && Math.sign(curveNear) === k.drift.dir;
      drift = drift || (Math.abs(curve) > 0.3 && Math.sign(curve) === k.drift.dir);
    } else if (!gapAhead && Math.abs(curve) > 0.45 && k.speed > 18 && this.skill > 0.88 && Math.random() < 0.08 * this.skill) {
      drift = true;
      steer = curve > 0 ? 1 : -1;
    }

    // Feststecken
    if (k.speed < 2 && race.state === 'race' && k.stun <= 0) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 1.5) { this.reverse = 0.9; this.stuck = 0; }
    if (this.reverse > 0) {
      this.reverse -= dt;
      inp.throttle = 0; inp.brake = 1; inp.steer = -steer; inp.drift = false;
    } else {
      inp.throttle = throttle; inp.brake = 0; inp.steer = steer; inp.drift = drift;
    }

    // Items
    inp.item = false;
    inp.back = false;
    if (k.item) {
      this.itemHold += dt;
      const ahead = race.ranked.find((o) => o.rank === k.rank - 1);
      const behind = race.ranked.find((o) => o.rank === k.rank + 1);
      const dist = (o) => (o ? o.pos.distanceTo(k.pos) : Infinity);
      switch (k.item) {
        case 'acorn':
          if (this.itemHold > 1 && ahead && dist(ahead) < 45) {
            const ox = ahead.pos.x - k.pos.x, oz = ahead.pos.z - k.pos.z;
            const a = Math.atan2(-f.z * ox + f.x * oz, f.x * ox + f.z * oz);
            if (Math.abs(a) < 0.12) inp.item = true;
          }
          if (this.itemHold > 1 && behind && dist(behind) < 14) { inp.item = true; inp.back = true; }
          if (this.itemHold > 9) inp.item = true;
          break;
        case 'honey':
          if ((behind && dist(behind) < 22 && this.itemHold > 0.8) || this.itemHold > 8) inp.item = true;
          break;
        case 'carrot': case 'carrot3':
          if (this.itemHold > 0.7 && Math.abs(curve) < 0.25) inp.item = true;
          break;
        default:
          if (this.itemHold > 1 + Math.random() * 2) inp.item = true;
      }
      if (inp.item) this.itemHold = 0;
      // Taste kurz loslassen für mehrfache Items
      if (inp.item && k.prevItem) inp.item = false;
    } else this.itemHold = 0;
  }
}
