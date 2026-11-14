// Honigfabrik sim logic (TrackDef.script). Owner: honey track. Headless and deterministic:
// math from 'three', sim.rng / sim.time only, no per-step allocations in the hot paths.
//
// - Conveyor belts in the hall: the left belt pushes karts forward (and lets them exceed top
//   speed a little), the right belt runs backwards.
// - Stamping presses: four presses alternate left / right in a fixed rhythm; a slamming press
//   squashes karts under its head. AI sees them as 'hazard.honeyPress' entities while they are
//   dangerous and follows a slalom line through the free lanes.
// - Honey flood: the declarative lap events switch the sticky patches; here the racing line is
//   moved onto the dry lanes and, in lap 3, onto the gantry (branch gain).
// - Pipe cannon (lap 3): sets the landing pose of the cannon zone.
// - Rolling honey barrels in the chute from lap 2.
import { Quaternion, Vector3 } from 'three';
import { KART } from '../../core/data';
import type { Kart, RaceSim, SimEntity, TrackFrame } from '../../core/types';
import { type BuiltTrack, poseFromFrame } from '../builder';
import type { TrackScript } from '../format';
import { resolveProgress, wrapS } from '../path';

// ---------------------------------------------------------------------------
// Tunables (shared with the view through `HonigState`)

export const PRESS = {
  /** Anchor + offsets of the presses along the main path (m) and the side they cover (-1 left, +1 right). */
  anchor: 'pressStart',
  offsets: [6, 24, 42, 60],
  sides: [-1, 1, -1, 1] as (-1 | 1)[],
  /** A press covers this fraction of the road from its side (0..1 of the full width). */
  cover: 0.5,
  /** Footprint length along the road (m). */
  length: 4.6,
  period: 2.6,
  /** Phase fractions of the cycle: warn until, slam until, down until, rise until (rest: up). */
  warn: 0.7, slam: 0.85, down: 1.35, rise: 2.0,
  /** Racing line lateral in the free lane (m). */
  lineLat: 3.3,
};

export const BELTS = [
  // left lane pushes forward, right lane backwards
  { from: 'beltStart', to: 'beltEnd', latMin: -8.6, latMax: -0.35, accel: 7.5, top: 1.16 },
  { from: 'beltStart', to: 'beltEnd', latMin: 0.35, latMax: 8.6, accel: -5.5, top: 0.86 },
];

export const BARRELS = { from: 'chute+2', to: 'jump-5', period: 1.9, speed: 11, radius: 0.75, lap: 2 };

export const CANNON = { target: 'spiralExit+16', duration: 3.4 };

/** Read-only state the theme view animates from. */
export interface HonigState {
  presses: { s: number; side: -1 | 1; lat: number; latMin: number; latMax: number; hw: number; h: number; warn: number }[];
  belts: { s0: number; s1: number; latMin: number; latMax: number; speed: number }[];
  lap: number;
  /** Seconds since the lap-3 cannon opened (or -1). */
  cannonOpen: number;
}

const smooth = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
const UP = new Vector3(0, 1, 0);
const TMP = new Vector3();
const FR: TrackFrame = { pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 8 };

/** Press head height 0 (down) .. 1 (up) and warning 0..1 at time t. */
export function pressPhase(t: number, k: number): { h: number; warn: number; danger: boolean; alert: boolean } {
  const T = PRESS.period;
  const off = PRESS.sides[k] < 0 ? 0 : T / 2;
  const u = ((((t - off) % T) + T) % T);
  let h = 1, warn = 0;
  if (u < PRESS.warn) { warn = u / PRESS.warn; h = 1; }
  else if (u < PRESS.slam) { const f = (u - PRESS.warn) / (PRESS.slam - PRESS.warn); h = 1 - f * f; warn = 1; }
  else if (u < PRESS.down) h = 0;
  else if (u < PRESS.rise) h = smooth((u - PRESS.down) / (PRESS.rise - PRESS.down));
  return { h, warn, danger: h < 0.35 && u >= PRESS.warn, alert: u >= PRESS.warn * 0.3 && u < PRESS.rise - 0.35 };
}

class PressEntity implements SimEntity {
  readonly kind = 'hazard.honeyPress';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0;
  dead = false;
  owner = -1;
  data = { h: 1, warn: 0, index: 0 };
  constructor(readonly id: number, private st: HonigState, private k: number, pos: Vector3, yaw: number) {
    this.pos.copy(pos);
    this.quat.setFromAxisAngle(UP, yaw);
    this.data.index = k;
  }
  step(sim: RaceSim): void {
    const p = pressPhase(sim.time, this.k);
    const s = this.st.presses[this.k];
    s.h = p.h; s.warn = p.warn;
    this.data.h = p.h; this.data.warn = p.warn;
    // AI perception: an obstacle only while it is about to come down or is down. The entity sits
    // near the inner edge of the head so a dodge lands in the free lane.
    this.radius = p.alert ? 2.0 : 0;
  }
}

class BarrelEntity implements SimEntity {
  readonly kind = 'hazard.honeyBarrel';
  pos = new Vector3();
  quat = new Quaternion();
  radius = BARRELS.radius;
  dead = false;
  owner = -1;
  data = { roll: 0 };
  private q = new Quaternion();
  constructor(readonly id: number, private track: BuiltTrack, private s: number, private lat: number, private end: number, private speed: number) {
    this.place();
  }
  private place(): void {
    this.track.sample(this.s, this.lat, 0, FR);
    this.pos.copy(FR.pos).addScaledVector(FR.up, 0.62);
    this.quat.setFromAxisAngle(UP, Math.atan2(FR.forward.x, FR.forward.z));
    this.q.setFromAxisAngle(TMP.set(1, 0, 0), this.data.roll);
    this.quat.multiply(this.q);
  }
  step(sim: RaceSim, dt: number): void {
    this.s += this.speed * dt;
    this.data.roll += (this.speed * dt) / 0.6;
    this.place();
    if (this.s >= this.end) this.burst(sim, 0.8);
  }
  onKart(kart: Kart, sim: RaceSim): void {
    if (kart.carried) return;
    const dir = new Vector3().subVectors(kart.pos, this.pos).setY(0).normalize();
    kart.applyHit('spin', { dir, cause: 'barrel', strength: 0.8 });
    this.burst(sim, 1);
  }
  burst(sim: RaceSim, scale: number): void {
    if (this.dead) return;
    this.dead = true;
    sim.events.emit('fx', { name: 'splash', pos: this.pos.clone(), color: '#f0a81c', scale });
    sim.events.emit('fx', { name: 'break.barrel', pos: this.pos.clone(), color: '#a8743c', scale });
  }
}

// ---------------------------------------------------------------------------

/** Press positions on the main path (also used by the view). */
export function pressLayout(t: BuiltTrack): HonigState['presses'] {
  const main = t.paths[0];
  const ps = wrapS(main, resolveProgress(main, PRESS.anchor));
  return PRESS.offsets.map((o, k) => {
    const s = wrapS(main, ps + o);
    const hw = t.sample(s, 0, 0, FR).halfWidth;
    const side = PRESS.sides[k];
    const span = 2 * hw * PRESS.cover;
    const latMin = side < 0 ? -hw - 0.5 : hw - span;
    const latMax = side < 0 ? -hw + span : hw + 0.5;
    return { s, side, lat: side * (hw - span / 2), latMin, latMax, hw, h: 1, warn: 0 };
  });
}

/** Belt lanes on the main path (also used by the view). */
export function beltLayout(t: BuiltTrack): HonigState['belts'] {
  const main = t.paths[0];
  const at = (p: string) => wrapS(main, resolveProgress(main, p));
  return BELTS.map((b) => ({ s0: at(b.from), s1: at(b.to), latMin: b.latMin, latMax: b.latMax, speed: b.accel > 0 ? 3.2 : -2.4 }));
}

function createHonig(t: BuiltTrack) {
  const main = t.paths[0];
  const L = t.length;
  const at = (p: string) => wrapS(main, resolveProgress(main, p));
  const baseLat = t.rlLat[0].slice();
  const baseSpeed = t.rlSpeed[0].slice();
  const gantry = t.branches.find((b) => t.paths[b.path].id === 'gantry');
  const gantryGain = gantry?.gain ?? 0;

  const st: HonigState = { presses: pressLayout(t), belts: beltLayout(t), lap: 0, cannonOpen: -1 };
  const barrel = { s0: at(BARRELS.from), s1: at(BARRELS.to), next: 0, list: [] as BarrelEntity[] };

  // cannon landing pose
  for (const [z, tag] of t.zoneTags) {
    if (tag !== 'cannon' || z.kind !== 'cannon') continue;
    const f = t.sample(at(CANNON.target), 0, 0);
    z.target = poseFromFrame(f, 0.6);
    z.duration = CANNON.duration;
  }

  // --- racing line overrides ------------------------------------------------
  const lat = t.rlLat[0], spd = t.rlSpeed[0];
  const n = main.count;
  const rowOf = (s: number) => Math.round(wrapS(main, s) / main.ds) % n;
  /** Blend the line towards `want(s)` between s0 and s1, easing in / out over `ease` m. */
  function pull(s0: number, s1: number, want: (s: number) => number, ease = 18): void {
    const span = (s1 - s0 + L) % L;
    for (let d = -ease; d <= span + ease; d += main.ds * 0.5) {
      const s = s0 + d;
      const i = rowOf(s);
      const w = d < 0 ? smooth((d + ease) / ease) : d > span ? 1 - smooth((d - span) / ease) : 1;
      const hw = main.hw[i];
      const v = Math.max(-hw + 1.9, Math.min(hw - 1.9, want(s)));
      lat[i] = baseLatAt(i) + (v - baseLatAt(i)) * w;
    }
  }
  let layer: Float32Array = baseLat;
  const baseLatAt = (i: number) => layer[i];

  /** Speed profile for the modified line (same model as the builder). */
  function respeed(): void {
    const drv = t.def.driving ?? {};
    const aLat = drv.lateralAccel ?? 20, aBrake = drv.brake ?? 16, aAcc = drv.accel ?? 9, top = drv.topSpeed ?? KART.topSpeed;
    const stride = 2, m = Math.floor(n / stride);
    const px = new Float64Array(m), pz = new Float64Array(m), v = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const i = k * stride;
      const r = main.right[i], rl = Math.hypot(r.x, r.z) || 1;
      px[k] = main.pos[i].x + (r.x / rl) * lat[i];
      pz[k] = main.pos[i].z + (r.z / rl) * lat[i];
    }
    for (let k = 0; k < m; k++) {
      const a = (k - 1 + m) % m, c = (k + 1) % m;
      const cross = (px[k] - px[a]) * (pz[c] - pz[a]) - (pz[k] - pz[a]) * (px[c] - px[a]);
      const la = Math.hypot(px[k] - px[a], pz[k] - pz[a]), lb = Math.hypot(px[c] - px[k], pz[c] - pz[k]), lc = Math.hypot(px[c] - px[a], pz[c] - pz[a]);
      const kap = la * lb * lc > 1e-9 ? (2 * Math.abs(cross)) / (la * lb * lc) : 0;
      const i = k * stride;
      const turn = -Math.sign(cross);
      const bank = (main.bank[i] * Math.PI) / 180;
      const acc = Math.max(aLat * 0.6, aLat + 9.8 * Math.sin(bank) * turn);
      v[k] = Math.min(baseSpeed[i] * top + 0.01, top, kap > 1e-6 ? Math.sqrt(acc / kap) : top);
    }
    const seg = main.ds * stride;
    for (let p = 0; p < 2; p++) {
      for (let k = m - 1; k >= 0; k--) v[k] = Math.min(v[k], Math.sqrt(v[(k + 1) % m] ** 2 + 2 * aBrake * seg));
      for (let k = 0; k < m; k++) v[k] = Math.min(v[k], Math.sqrt(v[(k - 1 + m) % m] ** 2 + 2 * aAcc * seg * 4));
    }
    for (let i = 0; i < n; i++) {
      const f = i / stride, k0 = Math.floor(f) % m, k1 = (k0 + 1) % m, u = f - Math.floor(f);
      spd[i] = Math.max(0.3, Math.min(1, (v[k0] + (v[k1] - v[k0]) * u) / top));
    }
  }

  /** Line for a given leader lap: belts + presses always, dry lanes per flood stage. */
  function applyLine(lap: number): void {
    lat.set(baseLat);
    layer = baseLat;
    // belts: ride the forward belt
    pull(at('beltStart') - 6, at('beltEnd') - 4, () => -4.4, 16);
    // presses: slalom through the free lanes
    layer = lat.slice();
    const p0 = st.presses[0].s - 14, p1 = st.presses[st.presses.length - 1].s + 8;
    pull(p0, p1, (s) => {
      // piecewise smooth between the press centres
      const P = st.presses;
      let k = 0;
      while (k < P.length - 1 && (s - P[k + 1].s + L) % L < L / 2) k++;
      const a = P[k], b = P[Math.min(P.length - 1, k + 1)];
      const la = -a.side * PRESS.lineLat, lb = -b.side * PRESS.lineLat;
      const d = (s - a.s + L) % L;
      if (d > L / 2) return la; // before the first press
      const g = b === a ? 0 : (b.s - a.s + L) % L;
      return g > 0 ? la + (lb - la) * smooth((d - 2.5) / Math.max(1, g - 5)) : la;
    }, 12);
    if (lap >= 2) {
      layer = lat.slice();
      // flood A: left lane flooded -> right; flood C: right lane flooded -> left
      pull(at('pressEnd') - 2, at('hallExit') - 6, () => 4.2, 12);
      layer = lat.slice();
      pull(at('hallExit') + 2, at('spiral') - 6, () => -4.0, 14);
    }
    if (lap >= 3) {
      layer = lat.slice();
      pull(at('hallExit') + 2, at('spiral') - 6, () => -6.0, 14);
      layer = lat.slice();
      pull(at('yardEnd') + 2, at('hallDoor') - 6, () => -4.6, 14);
    }
    layer = baseLat;
    respeed();
    if (gantry) gantry.gain = lap >= 3 ? Math.max(3, gantryGain) : gantryGain;
  }

  const ents: PressEntity[] = [];
  let mass = 0;
  const massOf = (k: Kart) => (k as unknown as { stats?: { mass?: number } }).stats?.mass ?? 190;
  void mass;

  return {
    state: st,
    createEntities(sim: RaceSim): SimEntity[] {
      st.lap = 0;
      st.cannonOpen = -1;
      barrel.next = 0;
      for (const b of barrel.list) b.dead = true;
      barrel.list.length = 0;
      applyLine(1);
      ents.length = 0;
      st.presses.forEach((p, k) => {
        const inner = p.side < 0 ? p.latMax - 1.4 : p.latMin + 1.4;
        const f = t.sample(p.s, inner, 0, FR);
        ents.push(new PressEntity(sim.nextEntityId(), st, k, f.pos.clone().addScaledVector(f.up, 0.6), Math.atan2(f.forward.x, f.forward.z)));
      });
      return ents;
    },
    setLap(lap: number, sim: RaceSim): void {
      st.lap = lap;
      if (lap >= 3 && st.cannonOpen < 0) st.cannonOpen = 0;
      applyLine(lap);
      void sim;
    },
    step(sim: RaceSim, dt: number): void {
      if (st.cannonOpen >= 0) st.cannonOpen += dt;
      // belts
      for (const k of sim.karts) {
        if (k.carried || k.loc.path !== 0) continue;
        const pr = k.loc.progress;
        for (let b = 0; b < st.belts.length; b++) {
          const belt = st.belts[b], def = BELTS[b];
          if (pr < belt.s0 || pr > belt.s1 || k.loc.lat < belt.latMin || k.loc.lat > belt.latMax) continue;
          if (!k.grounded || Math.abs(k.loc.height) > 1.2) continue;
          t.sample(pr, 0, 0, FR);
          const along = k.vel.dot(FR.forward);
          const cap = k.topSpeed * def.top;
          if (def.accel > 0 ? along < cap : along > 3) {
            TMP.copy(FR.forward).multiplyScalar(def.accel * dt * massOf(k));
            k.addImpulse(TMP);
          }
          k.addModifier({ id: 'honey.belt', time: 0.12, topSpeed: def.top });
          break;
        }
      }
      // presses: squash under a slamming head
      for (let i = 0; i < st.presses.length; i++) {
        const p = st.presses[i];
        const ph = pressPhase(sim.time, i);
        if (!ph.danger) continue;
        for (const k of sim.karts) {
          if (k.carried || k.loc.path !== 0 || Math.abs(k.loc.height) > 2.5) continue;
          let d = k.loc.progress - p.s;
          if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
          if (Math.abs(d) > PRESS.length / 2 + 0.8) continue;
          if (k.loc.lat < p.latMin - 0.45 || k.loc.lat > p.latMax + 0.45) continue;
          if (k.applyHit('squash', { cause: 'press', strength: 1 })) {
            sim.events.emit('fx', { name: 'dust', pos: k.pos.clone(), color: '#f4d48a', scale: 1.2 });
          }
        }
      }
      // rolling honey barrels down the chute
      for (let i = barrel.list.length - 1; i >= 0; i--) if (barrel.list[i].dead) barrel.list.splice(i, 1);
      if (st.lap >= BARRELS.lap && sim.phase === 'racing') {
        barrel.next -= dt;
        if (barrel.next <= 0) {
          barrel.next = BARRELS.period * (0.75 + sim.rng.next() * 0.5);
          const hw = t.sample(barrel.s0, 0, 0, FR).halfWidth;
          const l = (sim.rng.next() * 2 - 1) * (hw - 1.6);
          const e = new BarrelEntity(sim.nextEntityId(), t, barrel.s0, l, barrel.s1, BARRELS.speed * (0.9 + sim.rng.next() * 0.2));
          barrel.list.push(e);
          sim.addEntity(e);
        }
      }
    },
  };
}

export type HonigRuntime = ReturnType<typeof createHonig>;

export const honigScript: TrackScript = {
  create: (track: BuiltTrack) => createHonig(track),
};
