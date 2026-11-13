// Track hazards (sim side): sheep herds and rolling hay bales. Owner: track. Headless.
import { Quaternion, Vector3 } from 'three';
import type { Kart, RaceSim, SimEntity, TrackFrame } from '../core/types';

export interface HazardHost {
  readonly length: number;
  sample(progress: number, lat?: number, path?: number, out?: TrackFrame): TrackFrame;
  /** Height of the highest ground (road or terrain) at x/z, near `yHint`. */
  groundAt(x: number, z: number, yHint?: number): number;
  /** Half width of the main road at a progress. */
  halfWidthAt(progress: number): number;
}

const UP = new Vector3(0, 1, 0);
const frame: TrackFrame = { pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 8 };
const tmp = new Vector3();

const smooth = (t: number) => t * t * (3 - 2 * t);

/** A sheep walking a fixed, readable path across the road and back. */
export class SheepEntity implements SimEntity {
  readonly kind = 'hazard.sheep';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0.75;
  dead = false;
  owner = -1;
  data: { walking: number; startle: number; seed: number };
  private cooldown = 0;
  private t = 0;

  constructor(
    readonly id: number,
    private host: HazardHost,
    private progress: number,
    private latA: number,
    private latB: number,
    private period: number,
    private delay: number,
    seed: number,
  ) {
    this.data = { walking: 0, startle: 0, seed };
    this.place(0);
  }

  /** Cycle: 40 % crossing A->B, 10 % grazing, 40 % crossing back, 10 % grazing. */
  private latAt(t: number): { lat: number; dir: number; walking: number } {
    const u = (((t - this.delay) / this.period) % 1 + 1) % 1;
    if (t < this.delay) return { lat: this.latA, dir: 0, walking: 0 };
    if (u < 0.4) return { lat: this.latA + (this.latB - this.latA) * smooth(u / 0.4), dir: Math.sign(this.latB - this.latA), walking: 1 };
    if (u < 0.5) return { lat: this.latB, dir: 0, walking: 0 };
    if (u < 0.9) return { lat: this.latB + (this.latA - this.latB) * smooth((u - 0.5) / 0.4), dir: Math.sign(this.latA - this.latB), walking: 1 };
    return { lat: this.latA, dir: 0, walking: 0 };
  }

  private yaw = 0;
  private place(t: number): void {
    const { lat, dir, walking } = this.latAt(t);
    this.host.sample(this.progress, lat, 0, frame);
    this.pos.copy(frame.pos);
    this.pos.y = this.host.groundAt(frame.pos.x, frame.pos.z, frame.pos.y);
    if (dir !== 0) {
      tmp.copy(frame.right).multiplyScalar(dir);
      this.yaw = Math.atan2(tmp.x, tmp.z);
    }
    this.quat.setFromAxisAngle(UP, this.yaw);
    this.data.walking = walking;
  }

  step(_sim: RaceSim, dt: number): void {
    this.t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.data.startle = Math.max(0, this.data.startle - dt);
    this.place(this.t);
  }

  onKart(kart: Kart, sim: RaceSim): void {
    if (this.cooldown > 0) return;
    this.cooldown = 1.2;
    this.data.startle = 1;
    const dir = new Vector3().subVectors(kart.pos, this.pos).setY(0).normalize();
    kart.applyHit('bump', { dir, cause: 'sheep', strength: 0.6 });
    sim.events.emit('fx', { name: 'bump', pos: this.pos.clone(), dir, color: '#f4eee4', scale: 0.8 });
    sim.events.emit('track:event', { name: 'bleat', pos: this.pos.clone() });
  }
}

/** A hay bale rolling down the slope across the road. Breaks on contact. */
export class HayBaleEntity implements SimEntity {
  readonly kind = 'hazard.hay';
  pos = new Vector3();
  quat = new Quaternion();
  radius = 0.81;
  dead = false;
  owner = -1;
  data: { roll: number };
  private lat: number;
  private roll = 0;
  private axis = new Vector3();
  private q = new Quaternion();

  constructor(
    readonly id: number,
    private host: HazardHost,
    private progress: number,
    private latFrom: number,
    private latTo: number,
    private speed: number,
  ) {
    this.lat = latFrom;
    this.data = { roll: 0 };
    this.place();
  }

  private place(): void {
    this.host.sample(this.progress, this.lat, 0, frame);
    this.pos.copy(frame.pos);
    // entity position = axle (0.765 m above the ground); local +Z = rolling direction, axle along local X
    this.pos.y = this.host.groundAt(frame.pos.x, frame.pos.z, frame.pos.y) + 0.765;
    const dir = Math.sign(this.latTo - this.latFrom) || 1;
    tmp.copy(frame.right).multiplyScalar(dir);
    this.quat.setFromAxisAngle(UP, Math.atan2(tmp.x, tmp.z));
    this.axis.set(1, 0, 0);
    this.q.setFromAxisAngle(this.axis, this.roll);
    this.quat.multiply(this.q);
  }

  step(sim: RaceSim, dt: number): void {
    const dir = Math.sign(this.latTo - this.latFrom);
    this.lat += dir * this.speed * dt;
    this.roll += (this.speed * dt) / 0.765;
    this.data.roll = this.roll;
    this.place();
    if ((this.latTo - this.lat) * dir <= 0) this.breakUp(sim, 0.7);
  }

  onKart(kart: Kart, sim: RaceSim): void {
    const dir = new Vector3().subVectors(kart.pos, this.pos).setY(0).normalize();
    kart.applyHit('spin', { dir, cause: 'hay', strength: 0.8 });
    this.breakUp(sim, 1);
  }

  private breakUp(sim: RaceSim, scale: number): void {
    if (this.dead) return;
    this.dead = true;
    sim.events.emit('fx', { name: 'break.hay', pos: this.pos.clone(), color: '#e8c867', scale });
  }
}

/** Runtime state of one hazard definition. */
export interface HazardRuntime {
  type: 'sheepHerd' | 'hayRoll';
  tag: string;
  enabled: boolean;
  /** Main progress range it occupies, for AI / tests. */
  from: number;
  to: number;
  side: -1 | 1;
  count: number;
  period: number;
  entities: SimEntity[];
  next: number;
}

export function updateHazard(h: HazardRuntime, host: HazardHost, sim: RaceSim, dt: number): void {
  // drop dead references
  for (let i = h.entities.length - 1; i >= 0; i--) if (h.entities[i].dead) h.entities.splice(i, 1);
  if (!h.enabled) {
    for (const e of h.entities) e.dead = true;
    h.entities.length = 0;
    return;
  }
  if (h.type === 'sheepHerd') {
    if (h.entities.length > 0 || h.next < 0) return;
    // Spawn once per activation: a herd in a loose column.
    const hw = host.halfWidthAt(h.from);
    const far = hw + 7;
    const latA = h.side * far, latB = -h.side * far;
    for (let i = 0; i < h.count; i++) {
      const along = h.from + ((i % 3) - 1) * 2.2 + (sim.rng.next() - 0.5) * 1.2;
      const off = (Math.floor(i / 3) - 0.5) * 1.6 * h.side;
      const e = new SheepEntity(sim.nextEntityId(), host, along, latA + off, latB + off, h.period, i * 0.35 + sim.rng.next() * 0.2, sim.rng.next());
      h.entities.push(e);
      sim.addEntity(e);
    }
    h.next = -1; // spawned
    return;
  }
  // hay: one bale every `period` seconds at a random spot on the slope section
  h.next -= dt;
  if (h.next <= 0) {
    h.next = h.period * (0.8 + sim.rng.next() * 0.4);
    const span = (h.to - h.from + host.length) % host.length;
    const p = (h.from + span * sim.rng.next()) % host.length;
    const hw = host.halfWidthAt(p);
    const e = new HayBaleEntity(sim.nextEntityId(), host, p, h.side * (hw + 16), -h.side * (hw + 9), 7.5 + sim.rng.next() * 2);
    h.entities.push(e);
    sim.addEntity(e);
  }
}
