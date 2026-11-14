// Bambus-Tempel sim logic (TrackDef.script). Owner: track 2. Headless and deterministic: math
// from 'three', sim.rng / sim.time only.
//
// - build(): splits the bridge deck out of the main road collider into 6 x 3 breakable plank
//   cells ('road.bridge.<seg>.<lane>').
// - Lap 2: rain (declarative lap event) and the bridge breaks in two stages; lap 3: a third
//   stage. Every stage warns for WARN seconds (planks shake), then the cells fall: their
//   colliders switch off and the AI racing line weaves around the holes.
// - Karts that fall into the gorge are put back before the bridge.
// - Lap 3: a lantern swings across the temple courtyard lane, bamboo logs roll across the
//   second downhill leg, the gong rings when karts pass.
import { Quaternion, Vector3 } from 'three';
import type { Kart, RaceSim, SimEntity, TrackCollider, TrackFrame } from '../../core/types';
import type { BuiltTrack } from '../builder';
import type { TrackScript } from '../format';
import { resolveProgress, type BuiltPath } from '../path';

/** Map scale of the track file (map metres -> world metres). */
export const BAMBUS_SCALE = 1.1;
/** Bridge deck: 54 m between the anchors, 6 segments x 3 lanes of breakable planks. */
export const BAMBUS_BRIDGE = { from: 'bridge-27', to: 'bridge+27', segments: 6, lanes: 3 };
/** Gorge (map e, n): karts below `floorY` inside it are put back on the road. */
export const BAMBUS_GORGE = { e: 250 * BAMBUS_SCALE, n0: 160 * BAMBUS_SCALE, n1: 262 * BAMBUS_SCALE, half: 26, floorY: 16 };
/** Lap 3 lantern in the courtyard (branch 'temple', anchor 'courtyard'). */
export const BAMBUS_LANTERN = { pivot: 7.4, length: 5.6, amp: 0.72, period: 3.4 };
/** Lap 3 rolling logs (main path, from the uphill / left side). */
export const BAMBUS_LOGS = { at: 'leg2-2', to: 'leg2+22', period: 2.6 };

/**
 * Holes per stage as [segment, lane] (lane 0 = left, 1 = centre, 2 = right). Lap 2 the left side of
 * the middle span crumbles (the wide centre lane stays safe); lap 3 the middle of segment 2 gives way
 * too, so the right lane (it never breaks) is the only way across there.
 */
export const BRIDGE_STAGES: { lap: number; delay: number; holes: [number, number][] }[] = [
  { lap: 2, delay: 0, holes: [[2, 0]] },
  { lap: 2, delay: 20, holes: [[3, 0]] },
  { lap: 3, delay: 0, holes: [[2, 1]] },
];
/** Lane edges as fractions of the half width: narrow side lanes, a wide centre lane. */
export const BRIDGE_LANES = [-1, -0.45, 0.45, 1];
const WARN = 3.2;

export interface BridgeCell {
  seg: number;
  lane: number;
  collider: TrackCollider;
  /** 0 intact, 1 warning (shaking), 2 fallen. */
  state: 0 | 1 | 2;
  /** Sim time of the last state change. */
  since: number;
}

export interface BambusBuild {
  main: BuiltPath;
  s0: number;
  s1: number;
  segLen: number;
  cells: BridgeCell[];
  /** Lateral lane edges as fractions of the half width. */
  laneEdges: number[];
  baseLat: Float32Array;
  baseSpeed: Float32Array;
}

/** Runtime state, readable by the theme view through `track.script.state`. */
export interface BambusState {
  build: BambusBuild;
  rain: boolean;
  stage: number;
  /** Sim time of the last gong ring (-1 never). */
  gong: number;
  lanternOn: boolean;
  logsOn: boolean;
}

const builds = new WeakMap<object, BambusBuild>();
/** Bridge build data of a built track (for the view; available right after buildTrack). */
export function bambusBuild(track: object): BambusBuild | undefined { return builds.get(track); }
const F: TrackFrame = { pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 0 };
const V = new Vector3();
const UP = new Vector3(0, 1, 0);

function frame(t: BuiltTrack, p: BuiltPath, s: number, lat: number, out: TrackFrame = F): TrackFrame {
  return t.frameOn(p, s, lat, out);
}

function buildBridge(t: BuiltTrack): void {
  const main = t.paths[0];
  const s0 = resolveProgress(main, BAMBUS_BRIDGE.from), s1 = resolveProgress(main, BAMBUS_BRIDGE.to);
  const nSeg = BAMBUS_BRIDGE.segments, nLane = BAMBUS_BRIDGE.lanes;
  const segLen = (s1 - s0) / nSeg;
  const laneEdges = BRIDGE_LANES;
  // 1. cut the deck out of the main road collider
  const road = t.colliders.find((c) => c.id === 'road');
  if (road) {
    const v = road.vertices, idx = road.indices;
    const keep: number[] = [];
    const loc = { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: -1 };
    for (let k = 0; k < idx.length; k += 3) {
      const a = idx[k] * 3, b = idx[k + 1] * 3, c = idx[k + 2] * 3;
      V.set((v[a] + v[b] + v[c]) / 3, (v[a + 1] + v[b + 1] + v[c + 1]) / 3, (v[a + 2] + v[b + 2] + v[c + 2]) / 3);
      t.locate(V, undefined, loc);
      const s = loc.progress;
      if (loc.path === 0 && s > s0 && s < s1 && Math.abs(loc.height) < 0.5) continue;
      keep.push(idx[k], idx[k + 1], idx[k + 2]);
    }
    road.indices = new Uint32Array(keep);
  }
  // 2. one collider per plank cell, sampled every metre
  const cells: BridgeCell[] = [];
  for (let seg = 0; seg < nSeg; seg++) {
    for (let lane = 0; lane < nLane; lane++) {
      const vs: number[] = [], is: number[] = [];
      const sa = s0 + seg * segLen, sb = sa + segLen;
      const n = Math.max(2, Math.ceil(segLen));
      for (let r = 0; r <= n; r++) {
        const s = sa + ((sb - sa) * r) / n;
        frame(t, main, s, 0);
        const hw = F.halfWidth;
        for (const e of [laneEdges[lane], laneEdges[lane + 1]]) {
          frame(t, main, s, e * hw);
          vs.push(F.pos.x, F.pos.y, F.pos.z);
        }
        if (r > 0) {
          const l0 = (r - 1) * 2, r0 = l0 + 1, l1 = r * 2, r1 = l1 + 1;
          is.push(l0, r0, l1, r0, r1, l1);
        }
      }
      const c: TrackCollider = { id: `road.bridge.${seg}.${lane}`, kind: 'ground', surface: 'road', vertices: new Float32Array(vs), indices: new Uint32Array(is), enabled: true };
      t.colliders.push(c);
      cells.push({ seg, lane, collider: c, state: 0, since: 0 });
    }
  }
  builds.set(t, { main, s0, s1, segLen, cells, laneEdges, baseLat: new Float32Array(t.rlLat[0]), baseSpeed: new Float32Array(t.rlSpeed[0]) });
}

const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

/** AI line over the bridge for the holes that exist (or are about to) after `stage` stages. */
function bridgeLine(t: BuiltTrack, b: BambusBuild, stage: number): void {
  const L = t.rlLat[0], S = t.rlSpeed[0];
  L.set(b.baseLat);
  S.set(b.baseSpeed);
  if (stage <= 0) return;
  const p = b.main;
  const n = BAMBUS_BRIDGE.segments;
  const holes = new Set<string>();
  for (let k = 0; k < Math.min(stage, BRIDGE_STAGES.length); k++) for (const [s, l] of BRIDGE_STAGES[k].holes) holes.add(`${s}:${l}`);
  const ok = (seg: number, l: number) => seg < 0 || seg >= n || !holes.has(`${seg}:${l}`);
  // lane per segment: stay if it is open here and in the next segment, else the nearest that is
  const lanes: number[] = [];
  let cur = 1;
  for (let seg = 0; seg < n; seg++) {
    const order = [0, 1, 2].sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur) || Math.abs(x - 1) - Math.abs(y - 1));
    const pick = order.find((l) => ok(seg, l) && ok(seg + 1, l)) ?? order.find((l) => ok(seg, l)) ?? 1;
    lanes.push(pick);
    cur = pick;
  }
  // a broken centre: take a side lane that is intact all the way across (no weaving)
  for (const side of [2, 0]) {
    if ([...holes].some((h) => h.endsWith(':1')) && lanes.every((_, k) => ok(k, side))) { lanes.fill(side); break; }
  }
  // lane changes happen inside a segment where both lanes are intact
  const start = lanes.slice(), end = lanes.slice();
  for (let k = 0; k < n - 1; k++) {
    const a = lanes[k], c = lanes[k + 1];
    if (a === c) continue;
    if (ok(k, c)) end[k] = c; else start[k + 1] = a;
  }
  // the centre lane is biased away from the broken left side
  const laneLat = (l: number, hw: number) => (l === 1 ? 0.9 : ((b.laneEdges[l] + b.laneEdges[l + 1]) / 2) * hw);
  const pre = 26;
  const slow = stage >= BRIDGE_STAGES.length ? 0.66 : 0.8;
  for (let i = 0; i < p.count; i++) {
    const s = i * p.ds;
    if (s < b.s0 - pre || s > b.s1 + pre) continue;
    const hw = p.hw[i];
    let lat: number;
    if (s < b.s0) lat = laneLat(start[0], hw);
    else if (s >= b.s1) lat = laneLat(end[n - 1], hw);
    else {
      const f = (s - b.s0) / b.segLen;
      const k = Math.min(n - 1, Math.floor(f));
      const u = f - k;
      // AI steers towards a point ahead: reach a side lane early, leave it late
      const out = Math.abs(end[k] - 1) > Math.abs(start[k] - 1);
      const t = out ? smooth(u / 0.55) : smooth((u - 0.45) / 0.55);
      lat = laneLat(start[k], hw) + (laneLat(end[k], hw) - laneLat(start[k], hw)) * t;
    }
    const w = s < b.s0 ? smooth((s - (b.s0 - pre)) / pre) : s > b.s1 ? 1 - smooth((s - b.s1) / pre) : 1;
    L[i] = b.baseLat[i] + (lat - b.baseLat[i]) * w;
    if (s >= b.s0 - 20 && s <= b.s1) S[i] = Math.min(S[i], slow);
  }
}

/** Invisible marker in a broken plank cell, so the AI's hazard avoidance keeps away from it. */
class HoleMarker implements SimEntity {
  readonly kind = 'hazard.bambooHole';
  pos = new Vector3();
  quat = new Quaternion();
  radius: number;
  dead = false;
  owner = -1;
  constructor(readonly id: number, pos: Vector3, radius: number) { this.pos.copy(pos); this.radius = radius; }
  step(): void { /* static */ }
}

/** A paper lantern swinging across the courtyard lane on lap 3. */
class LanternEntity implements SimEntity {
  readonly kind = 'hazard.bambooLantern';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0.95;
  dead = false;
  owner = -1;
  data: { angle: number; pivot: Vector3; right: Vector3; hit: number };
  private cooldown = 0;
  private base: Vector3;
  constructor(readonly id: number, base: TrackFrame, private t0: number) {
    this.base = base.pos.clone();
    const right = base.right.clone().setY(0).normalize();
    const fwd = base.forward.clone().setY(0).normalize();
    this.quat.setFromAxisAngle(UP, Math.atan2(fwd.x, fwd.z));
    this.data = { angle: 0, pivot: this.base.clone().addScaledVector(UP, BAMBUS_LANTERN.pivot), right, hit: -1 };
    this.place(0);
  }
  private place(time: number): void {
    const L = BAMBUS_LANTERN;
    const a = L.amp * Math.sin(((time - this.t0) / L.period) * Math.PI * 2);
    this.data.angle = a;
    this.pos.copy(this.data.pivot).addScaledVector(this.data.right, Math.sin(a) * L.length).addScaledVector(UP, -Math.cos(a) * L.length);
  }
  step(sim: RaceSim, dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.place(sim.time);
  }
  onKart(kart: Kart, sim: RaceSim): void {
    if (this.cooldown > 0) return;
    this.cooldown = 0.8;
    this.data.hit = sim.time;
    const dir = V.subVectors(kart.pos, this.pos).setY(0).normalize().clone();
    kart.applyHit('spin', { dir, cause: 'lantern', strength: 0.7 });
    sim.events.emit('fx', { name: 'sparks', pos: this.pos.clone(), dir, color: '#ffb347', scale: 1 });
    sim.events.emit('track:event', { name: 'lanternHit', pos: this.pos.clone() });
  }
}

/** A bundle of bamboo stalks rolling down the slope across the road. Breaks on contact. */
class LogEntity implements SimEntity {
  readonly kind = 'hazard.bambooLog';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 1.15;
  dead = false;
  owner = -1;
  data: { roll: number };
  private lat: number;
  private roll = 0;
  private yaw = 0;
  private q = new Quaternion();
  constructor(readonly id: number, private t: BuiltTrack, private s: number, private latFrom: number, private latTo: number, private speed: number) {
    this.lat = latFrom;
    this.data = { roll: 0 };
    frame(t, t.paths[0], s, 0);
    this.yaw = Math.atan2(F.forward.x, F.forward.z); // log axis along the road, rolls sideways
    this.place();
  }
  private place(): void {
    frame(this.t, this.t.paths[0], this.s, this.lat);
    this.pos.copy(F.pos);
    this.pos.y = this.t.groundAt(F.pos.x, F.pos.z, F.pos.y) + 0.42;
    this.quat.setFromAxisAngle(UP, this.yaw);
    this.q.setFromAxisAngle(V.set(0, 0, 1), -this.roll * Math.sign(this.latTo - this.latFrom));
    this.quat.multiply(this.q);
  }
  step(sim: RaceSim, dt: number): void {
    const dir = Math.sign(this.latTo - this.latFrom);
    this.lat += dir * this.speed * dt;
    this.roll += (this.speed * dt) / 0.42;
    this.data.roll = this.roll;
    this.place();
    if ((this.latTo - this.lat) * dir <= 0) this.breakUp(sim, 0.7);
  }
  onKart(kart: Kart, sim: RaceSim): void {
    const dir = new Vector3().subVectors(kart.pos, this.pos).setY(0).normalize();
    kart.applyHit('spin', { dir, cause: 'log', strength: 0.75 });
    this.breakUp(sim, 1);
  }
  private breakUp(sim: RaceSim, scale: number): void {
    if (this.dead) return;
    this.dead = true;
    sim.events.emit('fx', { name: 'break.crate', pos: this.pos.clone(), color: '#b9c46a', scale });
  }
}

function respawnKart(t: BuiltTrack, k: Kart, sim: RaceSim): void {
  const phys = k as unknown as { respawn?: (sim: RaceSim) => void };
  if (typeof phys.respawn === 'function') { phys.respawn(sim); return; }
  k.teleport(t.respawn(k.loc));
  sim.events.emit('kart:respawn', { kart: k });
}

export const bambusScript: TrackScript = {
  build(track: BuiltTrack) {
    buildBridge(track);
  },
  create(track: BuiltTrack) {
    const b = builds.get(track)!;
    const state: BambusState = { build: b, rain: false, stage: 0, gong: -1, lanternOn: false, logsOn: false };
    const pending: { at: number; stage: number }[] = [];
    let lantern: LanternEntity | null = null;
    const logs: LogEntity[] = [];
    const markers: HoleMarker[] = [];
    let nextLog = 0;
    const temple = track.paths.find((p) => p.id === 'temple');
    const gongS = temple ? resolveProgress(temple, 'courtyard+7') : 0;
    const gongPos = new Vector3();
    if (temple) gongPos.copy(frame(track, temple, gongS, -4.5).pos);
    let gongCool = 0;
    const logFrom = resolveProgress(b.main, BAMBUS_LOGS.at), logTo = resolveProgress(b.main, BAMBUS_LOGS.to);
    const gx = -BAMBUS_GORGE.e;

    const startStage = (k: number, sim: RaceSim) => {
      const st = BRIDGE_STAGES[k];
      for (const [seg, lane] of st.holes) {
        const c = b.cells.find((q) => q.seg === seg && q.lane === lane)!;
        if (c.state === 0) { c.state = 1; c.since = sim.time; }
      }
      // invisible markers over the broken cells, so overtaking AI keeps clear (one per hole span)
      for (const m of markers) m.dead = true;
      markers.length = 0;
      for (let seg = 0; seg < BAMBUS_BRIDGE.segments; seg++) {
        const gone = b.cells.filter((q) => q.seg === seg && q.state > 0).map((q) => q.lane);
        if (!gone.length) continue;
        const lo = b.laneEdges[Math.min(...gone)] * 6, hi = b.laneEdges[Math.max(...gone) + 1] * 6;
        const r = Math.max(1.0, (hi - lo) / 2 - 0.6);
        for (const f of [0.25, 0.75]) {
          const m = new HoleMarker(sim.nextEntityId(), frame(track, b.main, b.s0 + (seg + f) * b.segLen, (lo + hi) / 2).pos.clone().addScaledVector(UP, 0.4), r);
          markers.push(m);
          sim.addEntity(m);
        }
      }
      state.stage = Math.max(state.stage, k + 1);
      bridgeLine(track, b, state.stage);
      const mid = track.sample(b.s0 + b.segLen * 3).pos.clone();
      sim.events.emit('track:event', { name: 'bridgeCreak', pos: mid });
    };

    const api = {
      state,
      createEntities(sim: RaceSim) {
        for (const c of b.cells) { c.state = 0; c.since = 0; c.collider.enabled = true; }
        state.rain = false; state.stage = 0; state.gong = -1; state.lanternOn = false; state.logsOn = false;
        pending.length = 0;
        if (lantern) lantern.dead = true;
        lantern = null;
        for (const l of logs) l.dead = true;
        logs.length = 0;
        for (const m of markers) m.dead = true;
        markers.length = 0;
        nextLog = 0;
        bridgeLine(track, b, 0);
        void sim;
        return [];
      },
      setLap(lap: number, sim: RaceSim) {
        if (lap >= 2) state.rain = true;
        BRIDGE_STAGES.forEach((st, k) => {
          if (st.lap <= lap && k >= state.stage && !pending.some((p) => p.stage === k)) pending.push({ at: sim.time + st.delay, stage: k });
        });
        if (lap >= 3 && !state.lanternOn && temple) {
          state.lanternOn = true;
          state.logsOn = true;
          frame(track, temple, resolveProgress(temple, 'courtyard-3'), 0);
          lantern = new LanternEntity(sim.nextEntityId(), F, sim.time);
          sim.addEntity(lantern);
          sim.events.emit('track:event', { name: 'logRoll', pos: track.sample(logFrom).pos.clone() });
        }
      },
      step(sim: RaceSim, dt: number) {
        // bridge stages: warn, then fall
        for (let i = pending.length - 1; i >= 0; i--) {
          if (sim.time >= pending[i].at) { startStage(pending[i].stage, sim); pending.splice(i, 1); }
        }
        for (const c of b.cells) {
          if (c.state === 1 && sim.time - c.since >= WARN) {
            c.state = 2; c.since = sim.time; c.collider.enabled = false;
            const f = frame(track, b.main, b.s0 + (c.seg + 0.5) * b.segLen, ((b.laneEdges[c.lane] + b.laneEdges[c.lane + 1]) / 2) * 6);
            sim.events.emit('fx', { name: 'break.crate', pos: f.pos.clone(), color: '#a8774d', scale: 1.4 });
            sim.events.emit('track:event', { name: 'bridgeBreak', pos: f.pos.clone() });
          }
        }
        // karts in the gorge go back on the road
        for (const k of sim.karts) {
          if (k.carried) continue;
          const p = k.pos;
          if (p.y < BAMBUS_GORGE.floorY && Math.abs(p.x - gx) < BAMBUS_GORGE.half && p.z > BAMBUS_GORGE.n0 && p.z < BAMBUS_GORGE.n1) respawnKart(track, k, sim);
        }
        // gong
        gongCool = Math.max(0, gongCool - dt);
        if (temple && temple.enabled && gongCool <= 0) {
          for (const k of sim.karts) {
            if (k.loc.path === temple.index && k.pos.distanceToSquared(gongPos) < 36) {
              state.gong = sim.time; gongCool = 1.5;
              sim.events.emit('track:event', { name: 'gong', pos: gongPos.clone() });
              break;
            }
          }
        }
        // rolling logs (lap 3)
        if (state.logsOn) {
          for (let i = logs.length - 1; i >= 0; i--) if (logs[i].dead) logs.splice(i, 1);
          nextLog -= dt;
          if (nextLog <= 0) {
            nextLog = BAMBUS_LOGS.period * (0.8 + sim.rng.next() * 0.4);
            const s = logFrom + (logTo - logFrom) * sim.rng.next();
            const hw = frame(track, b.main, s, 0).halfWidth;
            const e = new LogEntity(sim.nextEntityId(), track, s, -(hw + 12), hw + 8, 6.5 + sim.rng.next() * 2);
            logs.push(e);
            sim.addEntity(e);
          }
        }
      },
    };
    return api;
  },
};
