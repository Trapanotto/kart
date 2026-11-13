// Moves item entities along the track surface using only TrackRuntime queries
// (locate / sample), no physics engine. Owner: gameplay. Headless.
import { Vector3 } from 'three';
import type { RaceSim, TrackFrame, TrackLocation } from '../core/types';

export function newLoc(): TrackLocation {
  return { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: 0 };
}

export function newFrame(): TrackFrame {
  return { pos: new Vector3(), forward: new Vector3(0, 0, 1), right: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0), halfWidth: 8 };
}

export function copyLoc(dst: TrackLocation, src: TrackLocation): TrackLocation {
  dst.path = src.path; dst.progress = src.progress; dst.lat = src.lat; dst.halfWidth = src.halfWidth;
  dst.height = src.height; dst.onRoad = src.onRoad; dst.hint = src.hint;
  return dst;
}

/** Signed difference b - a of two progress values on a loop of length L, in [-L/2, L/2). */
export function wrapDelta(a: number, b: number, L: number): number {
  let d = b - a;
  if (d >= L / 2) d -= L; else if (d < -L / 2) d += L;
  return d;
}

export const MOVE_OK = 0, MOVE_WALL = 1, MOVE_OUT = 2, MOVE_LANDED = 4;

const GRAVITY = 22;
const frame = newFrame();

/**
 * Horizontal velocity + height above the road. `pos.y` is always road height + `alt`.
 * Walls are virtual: the road edge plus `wallMargin`, which works on any track.
 */
export class TrackMover {
  readonly loc = newLoc();
  readonly vel = new Vector3();
  /** Height above the road surface (m). */
  alt = 0;
  /** Vertical speed while airborne (m/s). */
  vy = 0;
  /** Resting height (usually the radius). */
  hover = 0.4;
  /** Unwrapped progress travelled; add it to a start distance to compare with karts. */
  distance = 0;
  bounces = 0;
  wallMargin = 1.2;
  /** Rad/s the velocity turns toward the road direction (0 = straight line). */
  followRoad = 0;
  private lastProgress = 0;

  place(pos: Vector3, sim: RaceSim, hint?: TrackLocation): void {
    if (hint) copyLoc(this.loc, hint);
    sim.track.locate(pos, hint ? this.loc : undefined, this.loc);
    this.lastProgress = this.loc.progress;
    pos.y -= this.loc.height - this.alt;
    this.loc.height = this.alt;
  }

  get airborne(): boolean {
    return this.vy !== 0 || this.alt > this.hover + 1e-3;
  }

  /** Returns a bit set of MOVE_* flags. */
  step(pos: Vector3, sim: RaceSim, dt: number): number {
    let flags = MOVE_OK;
    const track = sim.track;
    pos.x += this.vel.x * dt;
    pos.z += this.vel.z * dt;
    track.locate(pos, this.loc, this.loc);
    const groundY = pos.y - this.loc.height;
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.alt += this.vy * dt;
      if (this.alt <= this.hover) { this.alt = this.hover; this.vy = 0; flags |= MOVE_LANDED; }
    } else this.alt = this.hover;
    pos.y = groundY + this.alt;
    this.loc.height = this.alt;

    this.distance += wrapDelta(this.lastProgress, this.loc.progress, track.length);
    this.lastProgress = this.loc.progress;

    if (!Number.isFinite(pos.x + pos.y + pos.z) || pos.y < track.killY || Math.abs(this.loc.lat) > this.loc.halfWidth + 30) return flags | MOVE_OUT;

    if (this.followRoad > 0 || Math.abs(this.loc.lat) > this.loc.halfWidth + this.wallMargin) {
      track.sample(this.loc.progress, 0, this.loc.path, frame);
      const rx = frame.right.x, rz = frame.right.z;
      const rl = Math.hypot(rx, rz) || 1;
      const out = Math.sign(this.loc.lat);
      const vr = (this.vel.x * rx + this.vel.z * rz) / rl;
      if (Math.abs(this.loc.lat) > this.loc.halfWidth + this.wallMargin && vr * out > 0) {
        // Reflect the sideways component and push back inside.
        this.vel.x -= (2 * vr * rx) / rl;
        this.vel.z -= (2 * vr * rz) / rl;
        const push = Math.abs(this.loc.lat) - (this.loc.halfWidth + this.wallMargin) + 0.05;
        pos.x -= (out * push * rx) / rl;
        pos.z -= (out * push * rz) / rl;
        this.bounces++;
        flags |= MOVE_WALL;
      } else if (this.followRoad > 0) {
        const speed = Math.hypot(this.vel.x, this.vel.z);
        if (speed > 0.1) {
          const dir = this.vel.x * frame.forward.x + this.vel.z * frame.forward.z >= 0 ? 1 : -1;
          const want = Math.atan2(frame.forward.x * dir, frame.forward.z * dir);
          const cur = Math.atan2(this.vel.x, this.vel.z);
          let d = want - cur;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          const max = this.followRoad * dt;
          const a = cur + Math.max(-max, Math.min(max, d));
          this.vel.x = Math.sin(a) * speed;
          this.vel.z = Math.cos(a) * speed;
        }
      }
    }
    return flags;
  }

  /** Turns the horizontal velocity toward a world point at `rate` rad/s, keeping `speed`. */
  steerToward(pos: Vector3, tx: number, tz: number, speed: number, rate: number, dt: number): void {
    const want = Math.atan2(tx - pos.x, tz - pos.z);
    const cur = Math.hypot(this.vel.x, this.vel.z) > 0.1 ? Math.atan2(this.vel.x, this.vel.z) : want;
    let d = want - cur;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const max = rate * dt;
    const a = cur + Math.max(-max, Math.min(max, d));
    this.vel.x = Math.sin(a) * speed;
    this.vel.z = Math.cos(a) * speed;
  }
}
