// AI drivers. Owner: gameplay. Headless and deterministic (sim.rng only).
// Uses only the contract: kart.loc, track.sample / racingLine / branches / zones, other karts'
// public state and the item system's public queries. Reads actual speed, heading and slip.
import { Vector3 } from 'three';
import { KART } from '../core/data';
import type { Kart, KartController, RaceSim, SimEntity, TrackCollider, TrackLocation, TrackRuntime } from '../core/types';
import { newFrame, newLoc, wrapDelta } from '../items/mover';
import { HOLDABLE } from '../items/params';
import { itemSystemOf } from '../items/system';
import { AI, PERSONAS, type PersonaStyle } from './tuning';

// ---------------------------------------------------------------------------
// Track analysis (shared per track and path)

const STEP = 2;
interface PathInfo { yaw: Float32Array; n: number }
const pathCache = new WeakMap<TrackRuntime, Map<number, PathInfo>>();
const frameA = newFrame();

function pathInfo(track: TrackRuntime, path: number): PathInfo {
  let m = pathCache.get(track);
  if (!m) pathCache.set(track, (m = new Map()));
  let info = m.get(path);
  if (!info) {
    const n = Math.max(8, Math.ceil(track.length / STEP));
    const yaw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      track.sample(i * STEP, 0, path, frameA);
      yaw[i] = Math.atan2(frameA.forward.x, frameA.forward.z);
    }
    info = { yaw, n };
    m.set(path, info);
  }
  return info;
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function yawIndex(info: PathInfo, s: number): number {
  const i = Math.round(s / STEP) % info.n;
  return i < 0 ? i + info.n : i;
}

/** Signed heading change from a to b along the path (rad, positive = turning left). */
function turnBetween(info: PathInfo, a: number, b: number): number {
  let i = yawIndex(info, a);
  const steps = Math.max(0, Math.round((b - a) / STEP));
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    const j = (i + 1) % info.n;
    sum += wrapAngle(info.yaw[j] - info.yaw[i]);
    i = j;
  }
  return sum;
}

function curvatureAt(info: PathInfo, s: number): number {
  return Math.abs(turnBetween(info, s - 4, s + 4)) / 8;
}

// ---------------------------------------------------------------------------
// Shared per-race context (rival, entity locations)

interface AIContext {
  rival: number;
  rivalResolved: boolean;
  entLoc: Map<number, { time: number; loc: TrackLocation }>;
  boxLoc: Map<number, TrackLocation>;
}
const contexts = new WeakMap<RaceSim, AIContext>();

function context(sim: RaceSim): AIContext {
  let c = contexts.get(sim);
  if (!c) contexts.set(sim, (c = { rival: -1, rivalResolved: false, entLoc: new Map(), boxLoc: new Map() }));
  return c;
}

/** The designated rival of the human player in this race, or null. */
export function rivalOf(sim: RaceSim): Kart | null {
  const c = context(sim);
  resolveRival(sim, c);
  return c.rival >= 0 ? sim.karts.find((k) => k.id === c.rival) ?? null : null;
}

function resolveRival(sim: RaceSim, c: AIContext): void {
  if (c.rivalResolved || sim.karts.length < 2) return;
  c.rivalResolved = true;
  const human = sim.karts.find((k) => k.isHuman);
  if (!human || sim.config.mode === 'timetrial') return;
  // The closest AI on the grid with a fiery persona; ties go to the earlier grid slot.
  let best: Kart | null = null, bestScore = Infinity;
  const hi = sim.karts.indexOf(human);
  sim.karts.forEach((k, i) => {
    if (k === human) return;
    const fiery = k.char.persona === 'attacker' || k.char.persona === 'hothead';
    const score = Math.abs(i - hi) + (fiery ? 0 : 2.5) + i * 0.01;
    if (score < bestScore) { bestScore = score; best = k; }
  });
  c.rival = best ? (best as Kart).id : -1;
}

function entityLoc(sim: RaceSim, c: AIContext, e: SimEntity): TrackLocation {
  let r = c.entLoc.get(e.id);
  if (!r) c.entLoc.set(e.id, (r = { time: -1, loc: newLoc() }));
  if (r.time !== sim.time) {
    sim.track.locate(e.pos, r.time >= 0 ? r.loc : undefined, r.loc);
    r.time = sim.time;
  }
  return r.loc;
}

// ---------------------------------------------------------------------------
// Static obstacles: wall colliders that stand inside the road (props, posts, barn walls).

interface Obstacle { path: number; progress: number; lat: number; r: number; collider: TrackCollider }
const obstacleCache = new WeakMap<TrackRuntime, Obstacle[]>();

/** Clusters wall triangles that lie on the drivable road into round obstacles (track coords). */
export function roadObstacles(track: TrackRuntime): Obstacle[] {
  let list = obstacleCache.get(track);
  if (list) return list;
  list = [];
  const CELL = 3;
  const c = new Vector3();
  const loc = newLoc();
  let hinted = false;
  for (const col of track.colliders) {
    if (col.kind !== 'wall') continue;
    const v = col.vertices, idx = col.indices;
    const cells = new Map<string, { path: number; p: number; l: number; n: number; minX: number; maxX: number; minZ: number; maxZ: number }>();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
      c.set((v[a] + v[b] + v[d]) / 3, (v[a + 1] + v[b + 1] + v[d + 1]) / 3, (v[a + 2] + v[b + 2] + v[d + 2]) / 3);
      track.locate(c, hinted ? loc : undefined, loc);
      hinted = true;
      if (Math.abs(loc.lat) > loc.halfWidth - 0.5) continue; // edge walls and rails are handled by the lane clamp
      const roadY = c.y - loc.height;
      const minY = Math.min(v[a + 1], v[b + 1], v[d + 1]);
      if (minY - roadY > 2.0 || Math.max(v[a + 1], v[b + 1], v[d + 1]) - roadY < 0.25) continue; // overhead, or flat
      const key = `${loc.path}|${Math.round(loc.progress / CELL)}|${Math.round(loc.lat / CELL)}`;
      let cell = cells.get(key);
      if (!cell) cells.set(key, (cell = { path: loc.path, p: 0, l: 0, n: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }));
      cell.p += loc.progress; cell.l += loc.lat; cell.n++;
      for (const k of [a, b, d]) {
        cell.minX = Math.min(cell.minX, v[k]); cell.maxX = Math.max(cell.maxX, v[k]);
        cell.minZ = Math.min(cell.minZ, v[k + 2]); cell.maxZ = Math.max(cell.maxZ, v[k + 2]);
      }
    }
    for (const cell of cells.values()) {
      // Footprint from the triangles' world extent (a cell can catch part of a big prop).
      const r = Math.min(6, Math.max(0.8, Math.hypot(cell.maxX - cell.minX, cell.maxZ - cell.minZ) / 2 + 0.2));
      list.push({ path: cell.path, progress: cell.p / cell.n, lat: cell.l / cell.n, r, collider: col });
    }
  }
  obstacleCache.set(track, list);
  return list;
}

const HAZARDS = ['item.honey', 'item.giftbox', 'item.acorn', 'item.yarn', 'hazard.'];
function isHazard(e: SimEntity): boolean {
  if (e.radius <= 0 || e.dead) return false;
  for (const h of HAZARDS) if (e.kind.startsWith(h)) return true;
  return false;
}

// ---------------------------------------------------------------------------

const fwd = new Vector3(), right = new Vector3(), to = new Vector3();
const frame = newFrame(), frameB = newFrame();

export interface AIDebug {
  target: Vector3;
  lat: number;
  vTarget: number;
  mode: string;
  rival: boolean;
  path: number;
  item: string;
}

type Mistake = { kind: 'wide' | 'lift' | 'wobble'; t: number; dir: number } | null;

export class AIDriver implements KartController {
  readonly debug: AIDebug = { target: new Vector3(), lat: 0, vTarget: 0, mode: 'drive', rival: false, path: 0, item: '' };
  readonly style: PersonaStyle;
  skill = 0.75;
  private ctx: AIContext;
  private thinkT = 0;
  private thinkDt = 0.15;
  private planT = 0;
  private vAllow = 30;
  private steerOut = 0;
  private noise = 0;
  private noiseTarget = 0;
  private noiseT = 0;
  private wanderPhase: number;
  private wanderFreq: number;
  private homeLat: number;
  // tactical
  private overtakeOff = 0;
  private overtakeT = 0;
  private defendOff = 0;
  private hazardOff = 0;
  private boxOff = 0;
  private cloudChase = 0;
  private mistake: Mistake = null;
  private branch = -1;
  private branchDecided = new Map<string, boolean>();
  // driving state
  private drifting = false;
  private driftDir = 0;
  private driftKick = 0;
  private driftT = 0;
  private branchQ = NaN;
  private branchQPath = -1;
  private cornerDeclined = false;
  private turnSign = 1;
  private stuckT = 0;
  private reverseT = 0;
  private bestDist = -Infinity;
  private noProgressT = 0;
  private startPressAt = -0.85;
  private trickPulse = 0;
  private trickTried = false;
  // items
  private holdBtn = false;
  private tap = false;
  private releaseNext = false;
  private aim: -1 | 0 | 1 = 0;
  private itemHeldT = 0;
  private itemDelay = 0;
  private lastItem: string | null = null;

  constructor(readonly kart: Kart, sim: RaceSim) {
    this.ctx = context(sim);
    this.style = PERSONAS[kart.char.persona] ?? PERSONAS.steady;
    const rng = sim.rng;
    this.wanderPhase = rng.next() * Math.PI * 2;
    this.wanderFreq = 0.15 + rng.next() * 0.25;
    this.homeLat = (rng.next() - 0.5) * 1.6;
    this.setSkill(sim);
    const s = this.skill;
    const early = rng.next() < AI.start.earlyChance * (1 - s);
    this.startPressAt = early ? -2.2 : -AI.start.press + (rng.next() - 0.5) * AI.start.jitter * (1 - s) * 2;
    this.thinkT = rng.next() * this.thinkDt;
  }

  private setSkill(sim: RaceSim): void {
    resolveRival(sim, this.ctx);
    const rival = this.ctx.rival === this.kart.id;
    this.skill = Math.min(1, sim.config.speedClass.ai + (rival ? AI.rival.skillBonus : 0));
    this.thinkDt = AI.think[0] + (AI.think[1] - AI.think[0]) * this.skill;
    this.debug.rival = rival;
  }

  update(kart: Kart, sim: RaceSim, dt: number): void {
    const inp = kart.input;
    if (sim.phase === 'intro' || sim.phase === 'countdown') {
      inp.throttle = sim.phase === 'countdown' && sim.raceTime >= this.startPressAt ? 1 : 0;
      inp.brake = 0; inp.steer = 0; inp.drift = false; inp.item = false; inp.itemAim = 0; inp.lookBack = false;
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT += this.thinkDt;
      if (!this.ctx.rivalResolved) this.setSkill(sim);
      this.think(kart, sim);
    }
    this.drive(kart, sim, dt);
    // Item button: taps last one step, holds last until released.
    if (this.tap) { inp.item = true; this.tap = false; this.releaseNext = true; }
    else if (this.releaseNext) { inp.item = false; this.releaseNext = false; }
    else inp.item = this.holdBtn;
    inp.itemAim = this.aim;
  }

  // -------------------------------------------------------------------------
  // Driving (every step)

  private drive(kart: Kart, sim: RaceSim, dt: number): void {
    const inp = kart.input;
    const track = sim.track;
    const loc = kart.loc;
    const s = loc.progress;
    const speed = kart.speed;
    const absV = Math.abs(speed);
    const look = Math.min(AI.look.max, Math.max(AI.look.min, AI.look.base + AI.look.perSpeed * absV));
    const tPath = this.targetPath(sim, s, look);
    this.debug.path = tPath;

    // Target lateral position: racing line + personal line + tactics + wander + mistakes.
    // On branches progress is main-equivalent (stretched or squeezed), so look ahead by physical distance.
    const q = tPath > 0 ? this.aheadOnBranch(sim, tPath, kart.pos, s, look) : s + look;
    const line = track.racingLine(q, tPath);
    this.wanderPhase += dt * this.wanderFreq * 2 * Math.PI;
    let lat = line.lat + this.homeLat * 0.5 + Math.sin(this.wanderPhase) * AI.lineNoise * (1 - this.skill);
    lat += this.overtakeOff + this.defendOff + this.hazardOff + this.boxOff + this.cloudChase;
    if (this.mistake?.kind === 'wide') lat += this.mistake.dir * 3;
    track.sample(q, 0, tPath, frame);
    const lim = Math.max(0.5, frame.halfWidth - 1.1);
    lat = Math.max(-lim, Math.min(lim, lat));
    this.debug.lat = lat;
    const target = this.debug.target.copy(frame.pos).addScaledVector(frame.right, lat);

    // Heading: velocity direction when moving forward (correct while drifting), else the nose.
    fwd.set(0, 0, 1).applyQuaternion(kart.quat);
    if (speed > 4) fwd.set(kart.vel.x, 0, kart.vel.z);
    fwd.y = 0; fwd.normalize();
    right.set(-fwd.z, 0, fwd.x);
    to.copy(target).sub(kart.pos);
    let a = Math.atan2(to.dot(right), to.dot(fwd));
    // Hysteresis when the target is right behind us (wrong way): keep turning one way.
    if (Math.abs(a) > 2.5) a = Math.abs(a) * this.turnSign; else this.turnSign = Math.sign(a) || 1;

    // Steering noise: smooth random walk scaled by skill, stronger during a wobble mistake.
    this.noiseT -= dt;
    if (this.noiseT <= 0) {
      this.noiseT = 0.25 + sim.rng.next() * 0.35;
      this.noiseTarget = (sim.rng.next() * 2 - 1) * AI.steerNoise * (1 - this.skill) * (this.mistake?.kind === 'wobble' ? 4 : 1);
    }
    this.noise += (this.noiseTarget - this.noise) * Math.min(1, dt * 4);
    let steer = Math.max(-1, Math.min(1, a * AI.steerGain + this.noise));

    // Speed: plan corner speeds ahead (every 0.1 s).
    this.planT -= dt;
    if (this.planT <= 0) { this.planT = 0.1; this.vAllow = this.plan(kart, sim, s, tPath); }
    let vT = this.vAllow;
    if (Math.abs(a) > 0.6) vT = Math.min(vT, Math.max(8, kart.topSpeed * (1.2 - Math.abs(a) * 0.6)));
    this.debug.vTarget = vT;
    let throttle = 1, brake = 0;
    if (speed > vT + 3) { throttle = 0; brake = Math.min(1, (speed - vT) / 6); }
    else if (speed > vT + 0.5) throttle = 0.25;
    if (this.mistake?.kind === 'lift') throttle *= 0.4;
    // Slip feedback: if the wheels slide hard outside a drift, ease off.
    if (!this.drifting && kart.wheels.length) {
      let slip = 0;
      for (const w of kart.wheels) slip += w.slip;
      slip /= kart.wheels.length;
      if (slip > 0.65) throttle *= 0.6;
    }

    // Drifting.
    const info = pathInfo(track, tPath);
    const stunned = kart.stun > 0 || kart.carried;
    if (!this.drifting) {
      const turn = turnBetween(info, s + AI.drift.window[0], s + AI.drift.window[1]);
      if (Math.abs(turn) < AI.drift.minAngle * 0.5) this.cornerDeclined = false;
      // Only clean, one-way corners that are tight enough for the physics drift arc (no S-bends).
      let maxK = 0, against = 0;
      if (Math.abs(turn) > AI.drift.minAngle) {
        const sgn = Math.sign(turn);
        for (let d = AI.drift.window[0]; d <= AI.drift.window[1] + 16; d += 4) {
          maxK = Math.max(maxK, d <= AI.drift.window[1] ? curvatureAt(info, s + d) : 0);
          const part = turnBetween(info, s + d, s + d + 4);
          if (part * sgn < 0) against -= part * sgn;
        }
      }
      const tightEnough = maxK > 1 / AI.drift.maxRadius && against < 0.12;
      if (!this.cornerDeclined && tightEnough && Math.abs(turn) > AI.drift.minAngle && absV > AI.drift.minSpeed && kart.grounded && !stunned && this.reverseT <= 0) {
        if (sim.rng.next() < 0.25 + this.skill * 0.75) {
          this.drifting = true;
          // turn > 0 is a left turn (yaw grows toward +X); steer is positive to the right.
          this.driftDir = turn > 0 ? -1 : 1;
          this.driftKick = 0.2;
          this.driftT = 0;
        }
        else this.cornerDeclined = true;
      }
    } else {
      this.driftT += dt;
      const rest = turnBetween(info, s, s + 18);
      // turn > 0 is left, driftDir -1 is left: the corner ahead flips direction -> let go.
      const flips = rest * -this.driftDir < -0.05;
      const edge = Math.abs(loc.lat) > loc.halfWidth - 0.8;
      if (flips || edge || (this.driftT > 0.5 && Math.abs(rest) < AI.drift.releaseAngle) || this.driftT > 6 || Math.abs(a) > AI.drift.abortError || absV < AI.drift.minSpeed * 0.7 || stunned) {
        this.drifting = false;
        this.cornerDeclined = true;
      }
    }

    // Hop into the drift with a clear steering input so physics knows the direction.
    if (this.drifting && this.driftKick > 0) {
      this.driftKick -= dt;
      steer = this.driftDir * Math.max(0.6, Math.abs(steer));
    }

    // Tricks on jumps.
    let drift = this.drifting;
    if (kart.grounded) { this.trickTried = false; this.trickPulse = 0; }
    else if (!this.trickTried && kart.airTime > 0.06 && !kart.trick) {
      this.trickTried = true;
      const chance = AI.trick.chance[0] + (AI.trick.chance[1] - AI.trick.chance[0]) * this.skill;
      const inZone = track.zones.length === 0 || track.zones.some((z) => z.kind === 'trick' && z.enabled && wrapDelta(z.from, s, track.length) >= -5 && wrapDelta(s, z.to, track.length) >= -5);
      if (inZone && sim.rng.next() < chance) this.trickPulse = 0.12;
    }
    if (this.trickPulse > 0) { this.trickPulse -= dt; drift = this.trickPulse > 0 && kart.airTime > 0.06; }

    // Recovery: stuck against something -> reverse out.
    if (sim.phase === 'racing' && !stunned && throttle > 0.5 && absV < AI.stuck.speed && this.reverseT <= 0) {
      this.stuckT += dt;
      if (this.stuckT > AI.stuck.time) { this.reverseT = AI.stuck.reverse; this.stuckT = 0; }
    } else this.stuckT = 0;
    let mode = this.drifting ? 'drift' : 'drive';
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      throttle = 0; brake = 1; drift = false;
      steer = -Math.sign(a || 1);
      mode = 'reverse';
    } else if (speed < -1) {
      steer = -steer; // still rolling backwards: steer like reversing
    }
    this.steerOut += (steer - this.steerOut) * Math.min(1, AI.steerSmooth * dt);

    inp.steer = this.steerOut;
    inp.throttle = throttle;
    inp.brake = brake;
    inp.drift = drift;
    inp.lookBack = false;
    if (this.hazardOff) mode += '+dodge' + this.hazardOff.toFixed(1);
    this.debug.mode = this.mistake ? mode + ':' + this.mistake.kind : mode;
    if (this.mistake) { this.mistake.t -= dt; if (this.mistake.t <= 0) this.mistake = null; }
  }

  /** Progress on a branch path that lies `look` metres ahead of the kart along that branch. */
  private aheadOnBranch(sim: RaceSim, path: number, pos: Vector3, s: number, look: number): number {
    const track = sim.track;
    const b = track.branches.find((x) => x.path === path);
    if (!b) return s + look;
    const L = track.length;
    const lo = b.from - 10, hi = b.to + 10;
    const unwrap = (x: number) => (x < lo - L / 2 ? x + L : x > hi + L / 2 ? x - L : x);
    let best = NaN, bestD = Infinity;
    const scan = (from: number, to: number, step: number) => {
      for (let x = Math.max(lo, from); x <= Math.min(hi, to); x += step) {
        track.sample(x, 0, path, frameB);
        const d = frameB.pos.distanceToSquared(pos);
        if (d < bestD) { bestD = d; best = x; }
      }
    };
    if (this.branchQPath === path && Number.isFinite(this.branchQ)) scan(this.branchQ - 6, this.branchQ + 12, 0.5);
    if (!(bestD < 15 * 15)) { bestD = Infinity; scan(Math.min(unwrap(s), b.from) - 10, hi, 2); }
    this.branchQ = best;
    this.branchQPath = path;
    track.sample(best, 0, path, frameB);
    to.copy(frameB.pos);
    let x = best;
    for (let i = 0; i < 80; i++) {
      x += 1;
      track.sample(x, 0, path, frameB);
      if (frameB.pos.distanceToSquared(to) >= look * look) break;
    }
    return x;
  }

  private plan(kart: Kart, sim: RaceSim, s: number, path: number): number {
    const info = pathInfo(sim.track, path);
    const top = Math.max(1, kart.topSpeed);
    const latA = AI.latAccel * (0.82 + 0.25 * this.skill);
    let v = Infinity;
    for (let d = 0; d <= AI.scanAhead; d += 5) {
      const k = curvatureAt(info, s + d);
      let vc = Math.sqrt(latA / Math.max(k, 1e-4));
      const rl = sim.track.racingLine(s + d, path).speed;
      if (rl < 0.999) vc = Math.min(vc, rl * top);
      v = Math.min(v, Math.sqrt(vc * vc + 2 * AI.brakeDecel * d));
    }
    return Math.max(8, v);
  }

  private targetPath(sim: RaceSim, s: number, look: number): number {
    const L = sim.track.length;
    const branches = sim.track.branches;
    if (this.kart.loc.path > 0) {
      const b = branches.find((x) => x.path === this.kart.loc.path);
      if (!b || wrapDelta(b.to, s + look, L) > 0) return 0;
      return b.path;
    }
    if (this.branch >= 0) {
      const b = branches[this.branch];
      if (!b || !b.enabled) { this.branch = -1; return 0; }
      const g = wrapDelta(b.from, s + look, L);
      if (g >= 0 && wrapDelta(b.to, s + look, L) < 0) return b.path;
      if (wrapDelta(b.to, s, L) > 0) this.branch = -1; // passed it
    }
    return 0;
  }

  // -------------------------------------------------------------------------
  // Thinking (every thinkDt): perception, tactics, items

  private think(kart: Kart, sim: RaceSim): void {
    const dt = this.thinkDt;
    const L = sim.track.length;
    const s = kart.loc.progress;
    const myLat = kart.loc.lat;
    const racing = sim.phase === 'racing';

    // Nearest karts ahead and behind (main-path progress).
    let ahead: Kart | null = null, aheadGap = Infinity, behind: Kart | null = null, behindGap = Infinity;
    let pressure = false;
    for (const o of sim.karts) {
      if (o === kart) continue;
      const g = wrapDelta(s, o.loc.progress, L);
      const dl = Math.abs(o.loc.lat - myLat);
      if (Math.abs(g) < 7 && dl < 4) pressure = true;
      if (g > 0 && g < AI.overtake.ahead && g < aheadGap && dl < AI.overtake.latClear + 1.5) { ahead = o; aheadGap = g; }
      if (g < 0 && -g < AI.defend.behind && -g < behindGap) { behind = o; behindGap = -g; }
    }

    // Overtaking: pick a side and commit to it for a while.
    this.overtakeT -= dt;
    if (ahead && Math.abs(ahead.loc.lat - (myLat + 0)) < AI.overtake.latClear && kart.speed > ahead.speed - 1) {
      if (this.overtakeT <= 0) {
        const hw = kart.loc.halfWidth - 1.2;
        const off = AI.overtake.offset + this.style.overtakeBias;
        const left = ahead.loc.lat - off, rightLat = ahead.loc.lat + off;
        const lOk = left > -hw, rOk = rightLat < hw;
        const pick = lOk && rOk ? (Math.abs(left - myLat) < Math.abs(rightLat - myLat) ? left : rightLat) : lOk ? left : rightLat;
        const lineLat = sim.track.racingLine(s + 10, kart.loc.path).lat;
        this.overtakeOff = pick - lineLat - this.homeLat * 0.5;
        this.overtakeT = AI.overtake.hold;
      }
    } else if (this.overtakeT <= 0) this.overtakeOff *= 0.5;

    // Defending: shade toward the attacker behind (defenders, leaders, held items).
    const defends = this.style.holdsBehind || kart.race.rank === 1 || (kart.item.holding && !!kart.item.id);
    if (behind && defends && !ahead) this.defendOff = (behind.loc.lat - myLat) * AI.defend.share;
    else this.defendOff *= 0.5;

    // Hazards ahead: dodge if noticed.
    this.hazardOff = 0;
    // The lane we would drive without dodging (same frame as drive()'s target lateral).
    const planned = sim.track.racingLine(s + 12, kart.loc.path).lat + this.homeLat * 0.5 + this.overtakeOff + this.defendOff;
    const notice = AI.notice[0] + (AI.notice[1] - AI.notice[0]) * this.skill;
    for (const e of sim.entities) {
      if (!isHazard(e)) continue;
      if (e.owner === kart.id && (e.kind === 'item.acorn' || e.kind === 'item.yarn')) continue;
      if (e.data?.state === 'jar') continue;
      const el = entityLoc(sim, this.ctx, e);
      const g = wrapDelta(s, el.progress, L);
      if (g < 2 || g > AI.hazard.look) continue;
      const need = e.radius + AI.hazard.clearance + KART.width / 2;
      if (Math.abs(el.lat - planned) > need) continue;
      // Deterministic per (hazard, kart) noticing.
      const h = ((e.id * 2654435761 + kart.id * 40503) >>> 0) % 1000 / 1000;
      if (h > notice) continue;
      const hw = kart.loc.halfWidth - 1;
      const l = el.lat - need, r = el.lat + need;
      const go = l > -hw && (Math.abs(l - planned) < Math.abs(r - planned) || r > hw) ? l : r;
      this.hazardOff = go - planned;
      break;
    }

    // Static obstacles on the road (props, posts): always known, always avoided.
    if (!this.hazardOff) {
      let bestG = Infinity;
      for (const o of roadObstacles(sim.track)) {
        if (!o.collider.enabled || (o.path !== kart.loc.path && o.path !== this.debug.path)) continue;
        const g = wrapDelta(s, o.progress, L);
        if (g < 1 || g > AI.hazard.look || g > bestG) continue;
        const need = o.r + KART.width / 2 + 1.3;
        if (Math.abs(o.lat - planned) > need && Math.abs(o.lat - myLat) > need) continue;
        const hw = kart.loc.halfWidth - 0.9;
        const l = o.lat - need, r = o.lat + need;
        // Pass on the side we are already on (less steering), unless it is too narrow.
        const go = l > -hw && (myLat < o.lat || r > hw) ? l : r;
        this.hazardOff = go - planned;
        bestG = g;
      }
    }

    // Item boxes: lean toward one if the slot is empty.
    this.boxOff = 0;
    const sys = itemSystemOf(sim);
    if (sys && !kart.item.id && kart.item.roulette <= 0 && !this.hazardOff) {
      let best = Infinity;
      for (const b of sys.boxes) {
        if (!b.data.active) continue;
        let bl = this.ctx.boxLoc.get(b.spot);
        if (!bl) { bl = sim.track.locate(b.pos, undefined, newLoc()); this.ctx.boxLoc.set(b.spot, bl); }
        const g = wrapDelta(s, bl.progress, L);
        if (g < 8 || g > 45) continue;
        const d = bl.lat - planned;
        if (Math.abs(d) < AI.boxPull && Math.abs(d) < Math.abs(best)) best = d;
      }
      if (best !== Infinity) this.boxOff = best;
    }

    // Branches: decide once per branch and lap.
    if (kart.loc.path === 0 && this.branch < 0) {
      sim.track.branches.forEach((b, i) => {
        if (!b.enabled) return;
        const g = wrapDelta(s, b.from, L);
        if (g <= 0 || g > 90) return;
        const key = i + ':' + kart.race.lap;
        if (this.branchDecided.has(key)) { if (this.branchDecided.get(key)) this.branch = i; return; }
        const hasBoost = !!kart.item.id && /carrot/.test(kart.item.id);
        let score = b.gain * (0.6 + this.skill * 0.6) - b.risk * (1.6 - this.skill) * 3;
        if (b.needsBoost && !hasBoost) score -= 4;
        score += (sim.rng.next() - 0.5) * 1.5;
        const take = score > 0.3;
        this.branchDecided.set(key, take);
        if (take) this.branch = i;
      });
    }

    // Mistakes under pressure.
    if (racing && !this.mistake && pressure) {
      const rate = AI.mistakeRate * (1 - this.skill) * this.style.nerves;
      if (sim.rng.next() < rate * dt) {
        const kinds = ['wide', 'lift', 'wobble'] as const;
        this.mistake = { kind: kinds[sim.rng.int(3)], t: AI.mistakeTime[0] + sim.rng.next() * (AI.mistakeTime[1] - AI.mistakeTime[0]), dir: sim.rng.next() < 0.5 ? -1 : 1 };
      }
    }

    // Rubber band (mild, capped) and rival pacing.
    this.band(kart, sim);

    // Progress watchdog: respawn if no progress for a long time.
    if (racing && !kart.race.finished) {
      if (kart.race.distance > this.bestDist + AI.stuck.minProgress) { this.bestDist = kart.race.distance; this.noProgressT = 0; }
      else if (kart.stun <= 0 && !kart.carried) this.noProgressT += dt;
      if (this.noProgressT > AI.stuck.respawnAfter) {
        this.noProgressT = 0;
        this.bestDist = kart.race.distance;
        kart.teleport(sim.track.respawn(kart.loc));
        // Whatever we were trying did not work: no branch until next lap.
        if (this.branch >= 0) this.branchDecided.set(this.branch + ':' + kart.race.lap, false);
        this.branch = -1;
        this.branchQ = NaN;
        sim.events.emit('kart:respawn', { kart });
      }
    }

    this.cloudChase *= 0.5;
    if (racing && !kart.race.finished) this.items(kart, sim, dt);
    else { this.holdBtn = false; }
  }

  private band(kart: Kart, sim: RaceSim): void {
    const player = sim.karts.find((k) => k.isHuman);
    if (!player || player === kart || player.race.finished || kart.race.finished || sim.config.mode === 'timetrial' || sim.phase !== 'racing') {
      if (kart.hasModifier('ai.band')) kart.removeModifier('ai.band');
      return;
    }
    const rival = this.ctx.rival === kart.id;
    const p = rival ? AI.rival : AI.band;
    const gap = player.race.distance - kart.race.distance;
    const mul = gap > 0 ? 1 + p.maxUp * Math.min(1, gap / p.gapFull) : 1 - p.maxDown * Math.min(1, -gap / p.gapFull);
    kart.addModifier({ id: 'ai.band', time: 1, topSpeed: mul });
  }

  // -------------------------------------------------------------------------
  // Item tactics

  private fire(aim: -1 | 0 | 1): void {
    this.aim = aim;
    if (this.holdBtn) this.holdBtn = false; // releasing a held item fires it
    else this.tap = true;
  }

  private items(kart: Kart, sim: RaceSim, dt: number): void {
    const slot = kart.item;
    this.debug.item = slot.id ?? (slot.roulette > 0 ? '?' : '');
    if (!slot.id || slot.roulette > 0) { this.holdBtn = false; this.itemHeldT = 0; this.lastItem = null; return; }
    if (slot.id !== this.lastItem) {
      this.lastItem = slot.id;
      this.itemHeldT = 0;
      // Reaction: a moment to "read" the item.
      this.itemDelay = 0.25 + (1 - this.skill) * 0.6 + sim.rng.next() * 0.4;
    }
    this.itemHeldT += dt;
    if (this.itemHeldT < this.itemDelay || this.tap || this.releaseNext) return;
    if (kart.stun > 0) return;

    const id = slot.id;
    const L = sim.track.length;
    const s = kart.loc.progress;
    const st = this.style;
    const sys = itemSystemOf(sim);
    const info = pathInfo(sim.track, kart.loc.path);
    const straight = Math.abs(turnBetween(info, s, s + 45)) < 0.3;
    const rivalId = this.ctx.rival === kart.id ? sim.karts.find((k) => k.isHuman)?.id ?? -1 : -1;
    const overdue = this.itemHeldT > st.maxHold;

    // Threats against me.
    const bees = sys?.beesOn(kart) ?? null;
    const beesClose = !!bees && bees.state === 'fly' && bees.dist > kart.race.distance - 30;
    const cloud = sys?.cloudOn(kart) ?? null;
    let yarnInbound = false;
    for (const e of sim.entities) {
      if (e.kind === 'item.yarn' && e.data?.target === kart.id && e.pos.distanceToSquared(kart.pos) < 22 * 22) yarnInbound = true;
    }

    // Cloud overhead and nothing to shake it: aggressive drivers try to pass it on.
    if (cloud && st.aggression > 0.8) {
      let near: Kart | null = null, nd = 12;
      for (const o of sim.karts) { if (o === kart) continue; const d = o.pos.distanceTo(kart.pos); if (d < nd) { nd = d; near = o; } }
      if (near) this.cloudChase = (near.loc.lat - kart.loc.lat) * 0.8;
    }

    // Targets.
    let shot: Kart | null = null, shotGap = Infinity, back: Kart | null = null, backGap = Infinity;
    for (const o of sim.karts) {
      if (o === kart || o.race.finished) continue;
      const g = wrapDelta(s, o.loc.progress, L);
      const dl = Math.abs(o.loc.lat - kart.loc.lat);
      const tol = 1.4 + (o.id === rivalId ? 0.6 : 0);
      if (g > 5 && g < 40 && dl < tol + g * 0.02 && g < shotGap) { shot = o; shotGap = g; }
      if (g < -3 && g > -20 && dl < tol + 0.6 && -g < backGap) { back = o; backGap = -g; }
    }
    const aimedStraight = straight && Math.abs(turnBetween(info, s, s + Math.min(40, shotGap))) < 0.2;
    const someoneBehind = sim.karts.some((o) => o !== kart && !o.race.finished && wrapDelta(s, o.loc.progress, L) < 0 && wrapDelta(s, o.loc.progress, L) > -30);
    const eager = (p: number) => sim.rng.next() < p * (0.5 + st.aggression * 0.5);

    switch (id) {
      case 'acorn':
      case 'honey':
      case 'giftbox': {
        const forwardWeapon = id === 'acorn';
        if (forwardWeapon && shot && aimedStraight && eager(0.7)) return this.fire(1);
        if (back && eager(0.6)) return this.fire(id === 'acorn' ? -1 : 0);
        if (id === 'honey' && shot && shotGap > 14 && shotGap < 32 && st.aggression > 0.8 && eager(0.3)) return this.fire(1);
        // Hold behind as protection while someone is close behind (or always for defenders).
        const hold = HOLDABLE.has(id) && (someoneBehind || st.holdsBehind) && !overdue;
        if (hold) { this.holdBtn = true; this.aim = 0; return; }
        if (overdue || (!someoneBehind && this.itemHeldT > st.maxHold * 0.5)) return this.fire(forwardWeapon ? 1 : 0);
        this.holdBtn = false;
        return;
      }
      case 'acorn3':
        if (shot && aimedStraight && eager(0.6)) return this.fire(1);
        if (back && eager(0.4)) return this.fire(-1);
        if (overdue && eager(0.3)) return this.fire(1);
        return;
      case 'yarn': {
        const target = sys?.nextAhead(kart) ?? null;
        if (target && (target.id === rivalId || eager(0.5) || overdue)) return this.fire(0);
        if (!target && back && eager(0.5)) return this.fire(-1);
        return;
      }
      case 'bees':
        if (kart.race.rank > 1 && (eager(0.5) || overdue)) return this.fire(0);
        if (overdue && this.itemHeldT > st.maxHold * 2) return this.fire(0);
        return;
      case 'bubble':
        if (beesClose || yarnInbound || (cloud && cloud.remaining < 1.2)) return this.fire(0);
        if (st === PERSONAS.hothead || overdue) return this.fire(0);
        return;
      case 'carrot':
      case 'carrot3':
      case 'goldcarrot': {
        const gold = id === 'goldcarrot' && (sys?.goldTime(kart) ?? 0) > 0;
        if (gold) { if (kart.boost.time < 0.15) this.fire(0); return; }
        if (kart.boost.time > 0.1 || !kart.grounded) return;
        const emergency = beesClose || !!cloud || kart.hasModifier('item.bees');
        const branch = this.branch >= 0 ? sim.track.branches[this.branch] : null;
        const boostBranch = !!branch && branch.needsBoost && (kart.loc.path === branch.path || (wrapDelta(s, branch.from, L) > 0 && wrapDelta(s, branch.from, L) < 12));
        const slow = kart.speed < kart.topSpeed * 0.55;
        if (emergency || boostBranch) return this.fire(0);
        if ((straight || !st.patientBoost) && (slow || eager(0.35) || overdue)) return this.fire(0);
        return;
      }
      case 'lolly':
        if (straight || kart.race.rank > 4 || overdue) { if (eager(0.6) || overdue) return this.fire(0); }
        return;
      case 'cloud':
        if (kart.race.rank > 1 && (eager(0.5) || overdue)) return this.fire(0);
        return;
      case 'yawn': {
        let near = 0;
        for (const o of sim.karts) if (o !== kart && !o.race.finished && o.pos.distanceTo(kart.pos) < 16) near++;
        if (near >= (st === PERSONAS.steady ? 2 : 1) || overdue) return this.fire(0);
        return;
      }
    }
  }
}

export function createAI(kart: Kart, sim: RaceSim): KartController {
  return new AIDriver(kart, sim);
}
