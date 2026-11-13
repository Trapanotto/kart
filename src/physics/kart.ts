// One physical kart: a Rapier rigid body with four ray-cast suspension struts and an
// arcade tyre model. Owner: physics.
//
// Model in short
// - The chassis is a dynamic rigid body (rounded box) so walls and other karts collide for real.
// - Each wheel casts a ray along the body's down axis. Spring + damper impulses are applied at
//   the strut mount, which gives pitch, roll, landing squash and bump response for free.
// - Drive, brake and lateral grip act at the centre of mass (no roll moment, so no flips),
//   as velocity changes in the ground plane, clamped by surface grip.
// - Yaw is steered directly: the yaw rate is blended towards a target derived from steering,
//   speed and handling. Drifting rotates the velocity along an arc instead, with the body
//   held at a slip angle into the turn.
// - Tilt is self-righting: towards the ground normal on partial contact, world up in the air.
import { Quaternion, Vector3 } from 'three';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import { emptyInput, emptyProgress, emptySlot, KART, SURFACES } from '../core/data';
import type {
  CharacterDef, HitKind, HitOptions, Kart, KartModifier, Pose, RaceSim, SurfaceType, TrackLocation, WheelState,
} from '../core/types';
import { kartStats, PHYS } from './tuning';
import type { KartStats } from './tuning';
import type { Rapier } from './rapier';

const TAU = Math.PI * 2;
const WORLD_UP = new Vector3(0, 1, 0);

/** Wheel mount points in kart space: fl, fr, rl, rr (+X = left). */
export const WHEEL_LOCAL: readonly Vector3[] = [
  new Vector3(PHYS.wheelX, PHYS.mountY, PHYS.wheelZFront),
  new Vector3(-PHYS.wheelX, PHYS.mountY, PHYS.wheelZFront),
  new Vector3(PHYS.wheelX, PHYS.mountY, PHYS.wheelZRear),
  new Vector3(-PHYS.wheelX, PHYS.mountY, PHYS.wheelZRear),
];

/** What a kart needs from the physics system. */
export interface KartHost {
  readonly R: Rapier;
  readonly world: World;
  readonly sim: RaceSim | null;
  /** Interaction groups for wheel rays (ground only). */
  readonly rayGroups: number;
  surfaceOf(colliderHandle: number): SurfaceType;
}

// Scratch objects (single-threaded, never escape a call).
const _v = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3(), _v4 = new Vector3();
const _q = new Quaternion(), _qi = new Quaternion();
const _r = { x: 0, y: 0, z: 0 };
const _rq = { x: 0, y: 0, z: 1, w: 0 };

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Carry {
  kind: 'cannon' | 'respawn';
  from: Vector3;
  to: Vector3;
  qFrom: Quaternion;
  qTo: Quaternion;
  t: number;
  dur: number;
  height: number;
  exitSpeed: number;
}

export class PhysKart implements Kart {
  input = emptyInput();
  pos = new Vector3();
  quat = new Quaternion();
  vel = new Vector3();
  speed = 0;
  topSpeed: number;
  grounded = false;
  airTime = 0;
  surface: SurfaceType = 'road';
  wheels: WheelState[];
  lean = 0;
  drift = { active: false, dir: 0 as -1 | 0 | 1, charge: 0, level: 0 as 0 | 1 | 2 | 3 };
  boost = { time: 0, power: 1 };
  stun = 0;
  stunKind: HitKind | null = null;
  invulnerable = 0;
  trick = false;
  slipstream = 0;
  carried = false;
  modifiers: KartModifier[] = [];
  shield = false;
  loc: TrackLocation = { path: 0, progress: 0, lat: 0, halfWidth: KART.roadHalfWidth, height: 0, onRoad: true, hint: 0 };
  race = emptyProgress();
  item = emptySlot();
  renderPos = new Vector3();
  renderQuat = new Quaternion();
  prevPos = new Vector3();
  prevQuat = new Quaternion();

  // --- physics internals (read-only for others; exposed for the sandbox readout) ---
  readonly stats: KartStats;
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly angVel = new Vector3();
  readonly groundNormal = new Vector3(0, 1, 0);
  nGrounded = 0;
  /** Suspension length per wheel (mount to wheel centre). */
  readonly suspLen = [PHYS.suspMax, PHYS.suspMax, PHYS.suspMax, PHYS.suspMax];
  /** Cause of the last boost, for the readout. */
  boostCause = '';
  /** Yaw rate about the ground normal (rad/s), positive = left. */
  yawRate = 0;

  private host: KartHost;
  private springK: number;
  private damperC: number;
  private inertia: Vector3;
  private prevDriftBtn = false;
  private prevThrottle = 0;
  private hopTimer = 99;
  private driftPending = false;
  private pendingDir: -1 | 0 | 1 = 0;
  private pendingTimer = 0;
  private lastDriftPress = 99;
  private launchVy = 0;
  private launchByHop = false;
  private takeoffInTrick = false;
  private jumpEmitted = false;
  private fallSpeed = 0;
  private stall = 0;
  private startPress = NaN;
  private lastPhase = '';
  private spinRate = 0;
  private tumbleTime = 0;
  private tumbleAxisSign = 1;
  private zapPhase = 0;
  private onPad = false;
  private slipCooldown = 0;
  private upsideTime = 0;
  private stuckTime = 0;
  private outsideTime = 0;
  private carry: Carry | null = null;
  private cannonCooldown = 0;
  private collideCooldown = 0;
  /** Velocity set before the world step, for collision detection afterwards. */
  readonly velBefore = new Vector3();
  /** Contact flags written by the system from contact events during the world step. */
  contactStatic = false;
  contactKart: PhysKart | null = null;
  private modTop = 1;
  private modAccel = 1;
  private modGrip = 1;
  private modSteer = 1;
  private invincible = false;

  constructor(readonly id: number, readonly char: CharacterDef, readonly isHuman: boolean, pose: Pose, host: KartHost, classSpeed: number) {
    this.host = host;
    this.stats = kartStats(char, classSpeed);
    this.topSpeed = this.stats.topSpeed;
    const m = this.stats.mass;
    this.springK = (m * PHYS.gravity) / (4 * (PHYS.suspMax - PHYS.sagLength));
    this.damperC = 2 * PHYS.dampingRatio * Math.sqrt(this.springK * (m / 4));
    const s = m / 230;
    // Principal inertia (pitch X, yaw Y, roll Z). Inflated over a plain box for stability.
    this.inertia = new Vector3(120 * s, 130 * s, 70 * s);
    this.wheels = WHEEL_LOCAL.map(() => ({ pos: new Vector3(), compression: 0, spin: 0, steer: 0, grounded: false, surface: 'road' as SurfaceType, slip: 0 }));

    const { R, world } = host;
    const bd = R.RigidBodyDesc.dynamic()
      .setTranslation(pose.pos.x, pose.pos.y, pose.pos.z)
      .setRotation({ x: pose.quat.x, y: pose.quat.y, z: pose.quat.z, w: pose.quat.w })
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAdditionalMassProperties(m, { x: 0, y: PHYS.comHeight, z: 0 }, { x: this.inertia.x, y: this.inertia.y, z: this.inertia.z }, { x: 0, y: 0, z: 0, w: 1 });
    this.body = world.createRigidBody(bd);
    const h = PHYS.chassisHalf, rr = PHYS.chassisRound;
    const cd = R.ColliderDesc.roundCuboid(h.x - rr, h.y - rr, h.z - rr, rr)
      .setTranslation(0, PHYS.chassisCentreY, 0)
      .setDensity(0)
      .setFriction(0)
      .setFrictionCombineRule(R.CoefficientCombineRule.Min)
      .setRestitution(0.15)
      .setCollisionGroups(KART_GROUPS)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(m * 30);
    this.collider = world.createCollider(cd, this.body);
    this.syncFromBody();
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat);
    this.updateWheelPositions();
  }

  private get sim(): RaceSim | null { return this.host.sim; }

  // -------------------------------------------------------------------------
  // Control API
  // -------------------------------------------------------------------------

  applyHit(kind: HitKind, opts: HitOptions = {}): boolean {
    const protectedNow = this.invulnerable > 0 || this.invincible || this.modifiers.some((m) => m.invincible);
    const absorbed = protectedNow || this.shield;
    if (this.shield && !protectedNow) { this.shield = false; this.invulnerable = 0.6; }
    this.sim?.events.emit('kart:hit', { kart: this, kind, by: opts.by ?? -1, cause: opts.cause ?? '', absorbed });
    if (absorbed) return false;

    const scale = (opts.strength ?? 1) * this.stats.hitScale;
    this.endDrift(false);
    this.driftPending = false;
    this.boost.time = 0;
    this.stunKind = kind;
    const v = _v.copy(this.vel);
    const up = _v2.set(0, 1, 0).applyQuaternion(this.quat);
    switch (kind) {
      case 'spin': {
        this.stun = 1.05 * scale;
        const turns = this.stun > 0.8 ? 2 : 1;
        const side = opts.dir ? Math.sign(_v3.set(1, 0, 0).applyQuaternion(this.quat).dot(opts.dir)) || 1 : (this.sim && this.sim.rng.next() < 0.5 ? -1 : 1);
        this.spinRate = side * turns * TAU / this.stun;
        v.multiplyScalar(0.75);
        this.invulnerable = this.stun + 1.0;
        break;
      }
      case 'tumble': {
        this.stun = 1.5 * scale;
        this.tumbleTime = 0.75;
        this.tumbleAxisSign = this.sim && this.sim.rng.next() < 0.5 ? -1 : 1;
        v.multiplyScalar(0.45).addScaledVector(up, 7.5);
        this.invulnerable = this.stun + 1.2;
        break;
      }
      case 'squash': {
        this.stun = 1.3 * scale;
        v.multiplyScalar(0.35).addScaledVector(up, -3);
        this.addModifier({ id: 'squash', time: this.stun + 0.6, topSpeed: 0.6, steer: 0.7 });
        this.invulnerable = this.stun + 0.8;
        break;
      }
      case 'zap': {
        this.stun = 0.8 * scale;
        this.zapPhase = 0;
        v.multiplyScalar(0.15).addScaledVector(up, 2.5);
        this.invulnerable = this.stun + 0.8;
        break;
      }
      case 'bump': {
        this.stun = 0.35 * scale;
        if (opts.dir) { _v3.copy(opts.dir); _v3.addScaledVector(up, -_v3.dot(up)); if (_v3.lengthSq() > 1e-6) v.addScaledVector(_v3.normalize(), 4.5 * (opts.strength ?? 1)); }
        v.addScaledVector(up, 2);
        this.invulnerable = 0.4;
        break;
      }
    }
    this.setLinvel(v);
    return true;
  }

  applyBoost(duration: number, power: number = PHYS.boostPower): void {
    this.giveBoost(duration, power, 'item');
  }

  /** Boost with a cause for the 'kart:boost' event ('drift', 'trick', 'start', 'slipstream', 'pad', 'item'). */
  giveBoost(duration: number, power: number, cause: string, silent = false): void {
    this.boost.power = this.boost.time > 0 ? Math.max(this.boost.power, power) : power;
    this.boost.time = Math.max(this.boost.time, duration);
    this.boostCause = cause;
    if (!silent) this.sim?.events.emit('kart:boost', { kart: this, duration, power, cause });
  }

  addImpulse(impulse: Vector3): void {
    if (this.carried) return;
    // Applied directly (Rapier's mass properties are only valid after the first world step).
    const lv = this.body.linvel();
    _v.set(lv.x, lv.y, lv.z).addScaledVector(impulse, 1 / this.stats.mass);
    this.setLinvel(_v);
  }

  addModifier(mod: KartModifier): void {
    this.removeModifier(mod.id);
    this.modifiers.push(mod);
  }

  removeModifier(id: string): void {
    for (let i = this.modifiers.length - 1; i >= 0; i--) if (this.modifiers[i].id === id) this.modifiers.splice(i, 1);
  }

  hasModifier(id: string): boolean {
    for (const m of this.modifiers) if (m.id === id) return true;
    return false;
  }

  teleport(pose: Pose, keepSpeed = false): void {
    const sp = keepSpeed ? Math.max(0, this.speed) : 0;
    if (this.carry) this.finishCarry(false);
    _r.x = pose.pos.x; _r.y = pose.pos.y; _r.z = pose.pos.z;
    this.body.setTranslation(_r, true);
    _rq.x = pose.quat.x; _rq.y = pose.quat.y; _rq.z = pose.quat.z; _rq.w = pose.quat.w;
    this.body.setRotation(_rq, true);
    _v.set(0, 0, 1).applyQuaternion(pose.quat).multiplyScalar(sp);
    this.setLinvel(_v);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.pos.copy(pose.pos); this.quat.copy(pose.quat); this.vel.copy(_v); this.angVel.set(0, 0, 0);
    this.prevPos.copy(this.pos); this.prevQuat.copy(this.quat);
    this.renderPos.copy(this.pos); this.renderQuat.copy(this.quat);
    this.speed = sp;
    this.updateWheelPositions();
  }

  // -------------------------------------------------------------------------
  // Step: before the world step
  // -------------------------------------------------------------------------

  preStep(sim: RaceSim, dt: number): void {
    this.tickTimers(sim, dt);
    if (this.carry) { this.stepCarry(dt); return; }
    this.syncFromBody();

    const q = this.quat;
    const up = _v.set(0, 1, 0).applyQuaternion(q);
    const m = this.stats.mass;
    const com = _v4.copy(this.pos).addScaledVector(up, PHYS.comHeight);

    // --- suspension ---
    const lin = this.vel; // modified in place, written back at the end
    const ang = this.angVel;
    const torque = _tq.set(0, 0, 0);
    const n = this.groundNormal.set(0, 0, 0);
    let grounded = 0;
    const { world, R } = this.host;
    const rayLen = PHYS.suspMax + PHYS.wheelRadius;
    // Damping uses the velocity at the start of the step for all four struts (Jacobi), so the
    // order of the wheels does not bias the attitude.
    const lin0 = _lin0.copy(lin);
    let liftJ = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const mount = _mount.copy(WHEEL_LOCAL[i]).applyQuaternion(q).add(this.pos);
      _ray.origin.x = mount.x; _ray.origin.y = mount.y; _ray.origin.z = mount.z;
      _ray.dir.x = -up.x; _ray.dir.y = -up.y; _ray.dir.z = -up.z;
      const hit = world.castRayAndGetNormal(_ray as any, rayLen, true, undefined, this.host.rayGroups);
      if (!hit) {
        this.suspLen[i] = Math.min(PHYS.suspMax, this.suspLen[i] + 4 * dt);
        w.grounded = false; w.compression = 0;
        continue;
      }
      const L = Math.max(0, hit.timeOfImpact - PHYS.wheelRadius);
      this.suspLen[i] = L;
      w.grounded = true;
      w.surface = this.host.surfaceOf(hit.collider.handle);
      w.compression = clamp((PHYS.suspMax - L) / (PHYS.suspMax - PHYS.suspMin), 0, 1);
      _hn.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (_hn.dot(up) < 0) _hn.negate();
      n.add(_hn);
      grounded++;
      // Spring + damper along the strut, at the mount point.
      const arm = _arm.copy(mount).sub(com);
      const pv = _pv.crossVectors(ang, arm).add(lin0);
      const vn = pv.dot(up);
      let f = this.springK * (PHYS.suspMax - L) - this.damperC * vn;
      if (L < PHYS.suspMin) f += this.springK * PHYS.bumpStopRate * (PHYS.suspMin - L) - this.damperC * 1.5 * Math.min(0, vn);
      if (f <= 0) continue;
      const j = f * dt;
      liftJ += j;
      torque.add(_jt.crossVectors(arm, _jd.copy(up).multiplyScalar(j)));
    }
    lin.addScaledVector(up, liftJ / m);
    this.nGrounded = grounded;
    if (grounded > 0) n.normalize(); else n.copy(WORLD_UP);
    this.addAngularImpulse(torque);

    // --- surface ---
    this.updateSurface(sim);
    const surf = SURFACES[this.surface];
    let surfGrip = surf.grip, surfSpeed = surf.speed, surfDrag = surf.drag;
    if (this.surface === 'ice' && this.char.iceGrip) surfGrip = 1;
    if (this.invincible || this.boost.time > 0) { surfSpeed = 1; surfDrag = 0; }

    // --- ground frame ---
    const fwd = _f.set(0, 0, 1).applyQuaternion(q);
    fwd.addScaledVector(n, -fwd.dot(n));
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1).applyQuaternion(q);
    fwd.normalize();
    const right = _rt.crossVectors(fwd, n).normalize();
    let vf = lin.dot(fwd), vr = lin.dot(right);
    const vn = lin.dot(n);
    const traction = Math.min(1, grounded / 2);
    const air = grounded === 0;

    // --- input ---
    const phase = sim.phase;
    const frozen = phase === 'intro' || phase === 'countdown';
    const inp = this.input;
    let throttle = clamp(inp.throttle, 0, 1), brake = clamp(inp.brake, 0, 1), steer = clamp(inp.steer, -1, 1);
    const driftBtn = inp.drift;
    const driftEdge = driftBtn && !this.prevDriftBtn;
    this.prevDriftBtn = driftBtn;
    this.updateStartBoost(sim, throttle);
    if (this.stall > 0) throttle = 0;
    if (this.isHuman && sim.config.assists?.steerAssist && !this.drift.active && !air && !frozen) steer = this.assistSteer(sim, steer, fwd);
    const stunned = this.stun > 0;
    if (stunned) {
      if (this.stunKind === 'squash') { throttle *= 0.5; steer *= 0.6; brake *= 0.5; }
      else { throttle = 0; brake = 0; steer = 0; }
    }

    // --- hop / drift / trick state ---
    if (driftEdge) this.lastDriftPress = 0;
    if (driftEdge && !stunned && !frozen) {
      if (grounded >= 2 && Math.abs(vf) > 3 && this.hopTimer > 0.25) {
        lin.addScaledVector(n, PHYS.hopSpeed);
        this.hopTimer = 0;
        this.driftPending = !this.drift.active;
        this.pendingDir = Math.abs(steer) > 0.3 ? (steer > 0 ? 1 : -1) : 0;
        this.pendingTimer = 0;
      } else if (air && !this.trick && this.airTime < 0.4 && (this.launchVy > 2.5 && !this.launchByHop || this.takeoffInTrick)) {
        this.doTrick(sim);
      }
    }
    if (this.driftPending) {
      this.pendingTimer += dt;
      if (!driftBtn || stunned) this.driftPending = false;
      else {
        if (this.pendingDir === 0 && Math.abs(steer) > 0.3) this.pendingDir = steer > 0 ? 1 : -1;
        if (!air && this.pendingTimer > 0.06 && this.pendingDir !== 0 && vf > PHYS.driftMinSpeed) this.startDrift(this.pendingDir);
        else if (!air && this.pendingTimer > 0.7) this.driftPending = false;
      }
    }
    if (this.drift.active) {
      if (!driftBtn) this.endDrift(true);
      else if (stunned || vf < PHYS.driftMinSpeed * 0.6 || this.airTime > 1.2) this.endDrift(false);
    }

    // --- longitudinal ---
    const vmax = this.topSpeed * (this.boost.time > 0 ? this.boost.power : surfSpeed);
    let dvf = 0;
    const drifting = this.drift.active && !air;
    const sp = drifting ? Math.hypot(vf, vr) : vf;
    if (!air && !frozen) {
      const A = this.stats.accel * this.modAccel;
      if (this.boost.time > 0 && sp < vmax) {
        dvf += Math.min(vmax - sp, PHYS.boostAccel * dt);
      } else if (throttle > 0 && sp >= -0.5 && sp < vmax) {
        const x = Math.max(0, sp) / vmax;
        dvf += Math.min(vmax - sp, A * throttle * (1 - x * x) * dt);
      }
      if (sp > vmax) dvf -= Math.min(sp - vmax, (PHYS.overspeedDecel + PHYS.dragDecel * surfDrag) * dt);
      if (brake > 0) {
        if (sp > 0.5) dvf -= Math.min(sp, PHYS.brakeDecel * brake * dt);
        else if (throttle === 0 && sp > -PHYS.reverseMax) dvf -= Math.min(PHYS.reverseMax + sp, PHYS.reverseAccel * brake * dt);
      }
      if (throttle > 0 && sp < -0.5) dvf += Math.min(-sp, PHYS.brakeDecel * throttle * dt);
      if (throttle === 0 && brake === 0) {
        const c = (PHYS.coastDecel + surfDrag * 3) * dt;
        dvf -= clamp(sp, -c, c);
        // Parking: hold still on slopes.
        if (Math.abs(sp) < 1.5) dvf -= sp + _g.set(0, -PHYS.gravity, 0).dot(fwd) * dt;
      } else if (surfDrag > 0 && this.boost.time <= 0) {
        const c = surfDrag * 3 * dt;
        dvf -= clamp(sp, -c, c);
      }
      if (stunned && this.stunKind !== 'squash' && this.stunKind !== 'bump') {
        const c = (this.stunKind === 'zap' ? 30 : 9) * dt;
        dvf -= clamp(sp, -c, c);
      }
      dvf *= traction;
    }

    // --- yaw target ---
    const steerMul = this.modSteer;
    const speedAbs = Math.abs(vf);
    const yn = ang.dot(n);
    let yawTarget = 0;
    let yawResp = PHYS.yawResponse;
    if (frozen) {
      yawTarget = 0; yawResp = 20;
    } else if (stunned && this.stunKind === 'spin') {
      yawTarget = this.spinRate; yawResp = 30;
    } else if (stunned && this.stunKind === 'zap') {
      this.zapPhase += dt;
      yawTarget = Math.sin(this.zapPhase * 45) * 3; yawResp = 30;
    } else if (drifting) {
      // Arc radius from inside / outside steering.
      const dir = this.drift.dir;
      const t = clamp(steer * dir, -1, 1);
      const radius = lerp(PHYS.driftWide, PHYS.driftTight, (t + 1) / 2) * this.stats.driftRadiusScale / steerMul;
      const w = Math.min(PHYS.driftMaxYaw * steerMul, sp / radius);
      // Rotate the planar velocity along the arc.
      const ang1 = -dir * w * dt;
      _v2.copy(lin).addScaledVector(n, -vn); // planar velocity
      _q.setFromAxisAngle(n, ang1);
      _v2.applyQuaternion(_q);
      lin.copy(_v2).addScaledVector(n, vn);
      // Hold the body at a slip angle into the turn relative to the velocity.
      const slip = PHYS.driftSlip * (0.8 + 0.25 * (t + 1) / 2);
      _v3.copy(_v2).normalize().applyAxisAngle(n, -dir * slip); // desired body forward
      const err = Math.atan2(_v4.crossVectors(fwd, _v3).dot(n), fwd.dot(_v3));
      yawTarget = -dir * w + err * 7;
      yawResp = 14;
      // Charge
      if (sp > 10) this.chargeDrift(sim, dt * (0.8 + 0.4 * (t + 1) / 2));
    } else {
      const dirSign = vf >= -0.3 ? 1 : -1;
      const yHigh = this.stats.yawHigh, yLow = this.stats.yawLow;
      const cap = lerp(yLow, yHigh, clamp(speedAbs / KART.topSpeed, 0, 1.3));
      // Pivot authority when (nearly) stopped and on the pedals, so a kart can always turn
      // away from a wall it is stuck against.
      const pivot = speedAbs < 4 ? 0.9 * Math.max(throttle, brake) : 0;
      const yawMax = Math.max(pivot, Math.min(speedAbs / PHYS.minRadius, cap)) * steerMul;
      yawTarget = -steer * dirSign * yawMax;
      if (air) { yawTarget *= PHYS.airYaw; yawResp = 2.5; }
      if (stunned && this.stunKind === 'tumble') { yawTarget = 0; yawResp = 0; }
    }
    const ynNew = yn + (yawTarget - yn) * Math.min(1, yawResp * dt);
    ang.addScaledVector(n, ynNew - yn);
    this.yawRate = ynNew;

    // --- lateral grip ---
    if (frozen) {
      lin.addScaledVector(fwd, -vf).addScaledVector(right, -vr);
      vf = 0; vr = 0;
    } else if (!air) {
      if (!drifting) {
        const grip = PHYS.latGrip * surfGrip * this.stats.grip * this.modGrip * traction;
        const c = grip * dt;
        const dvr = -clamp(vr, -c, c);
        lin.addScaledVector(right, dvr);
        // Cornering scrub: hard grip turns bleed speed, drifting does not.
        const latAcc = Math.abs(vf * ynNew);
        if (latAcc > PHYS.scrubFree && vf > 0) dvf -= (latAcc - PHYS.scrubFree) * PHYS.scrubRate * dt;
      }
      if (drifting) {
        // Drive along the velocity, not the nose.
        _v2.copy(lin).addScaledVector(n, -lin.dot(n));
        if (_v2.lengthSq() > 0.01) lin.addScaledVector(_v2.normalize(), dvf);
      } else {
        lin.addScaledVector(fwd, dvf);
      }
    }

    // --- tilt: self-righting and damping ---
    this.stepTilt(n, grounded, dt);

    // --- boost pads ---
    let pad = false;
    for (const w of this.wheels) if (w.grounded && w.surface === 'boost') pad = true;
    if (pad) this.giveBoost(PHYS.padBoost, PHYS.boostPower + 0.05, 'pad', this.onPad);
    this.onPad = pad;

    // --- wheel visuals ---
    const steerAngle = drifting ? this.drift.dir * 0.25 - steer * 0.2 : -steer * 0.42 * Math.max(0.35, 1 - speedAbs / 60);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer = i < 2 ? steerAngle : 0;
      if (frozen) w.spin += throttle * 25 * dt;
      else if (w.grounded || this.boost.time > 0) w.spin += (vf / PHYS.wheelRadius) * dt;
      else w.spin += (vf / PHYS.wheelRadius) * dt * 0.98;
      const latSlip = Math.abs(vr) / Math.max(4, Math.abs(vf));
      w.slip = !w.grounded ? 0 : drifting ? (i < 2 ? 0.45 : 0.85) : clamp(latSlip * 3 + (this.surface === 'ice' && !this.char.iceGrip ? 0.2 : 0), 0, 1);
    }

    // --- write back ---
    this.velBefore.copy(lin);
    this.setLinvel(lin);
    _r.x = ang.x; _r.y = ang.y; _r.z = ang.z;
    this.body.setAngvel(_r, true);
    this.grounded = grounded > 0;
    this.prevThrottle = throttle;
  }

  // -------------------------------------------------------------------------
  // Step: after the world step
  // -------------------------------------------------------------------------

  postStep(sim: RaceSim, dt: number): void {
    if (this.carry) { this.updateWheelPositions(); return; }
    this.syncFromBody();
    const up = _v.set(0, 1, 0).applyQuaternion(this.quat);
    const fwd = _f.set(0, 0, 1).applyQuaternion(this.quat);
    this.speed = this.vel.dot(fwd);

    this.handleContacts(sim, up, dt);

    // Air time, jump and landing.
    if (!this.grounded) {
      if (this.airTime === 0) {
        this.launchVy = this.vel.y;
        this.launchByHop = this.hopTimer < 0.2;
        this.takeoffInTrick = this.inZone(sim, 'trick');
        // Pressed drift at the lip of a ramp (just before leaving the ground).
        if (this.launchByHop && this.takeoffInTrick && !this.trick) this.doTrick(sim);
      }
      this.airTime += dt;
      this.fallSpeed = Math.max(0, -this.vel.y);
      if (!this.jumpEmitted && this.airTime > 0.15 && !this.launchByHop) { this.jumpEmitted = true; sim.events.emit('kart:jump', { kart: this }); }
      if (!this.jumpEmitted && this.launchByHop && this.airTime > 0.45) { this.jumpEmitted = true; sim.events.emit('kart:jump', { kart: this }); }
    } else if (this.airTime > 0) {
      if (this.jumpEmitted || this.airTime > 0.3) sim.events.emit('kart:land', { kart: this, airTime: this.airTime, impact: this.fallSpeed });
      if (this.trick) {
        this.trick = false;
        if (this.stun <= 0) this.giveBoost(PHYS.trickBoost, PHYS.boostPower, 'trick');
      }
      if (this.input.drift && !this.drift.active && !this.driftPending && this.stun <= 0) {
        this.driftPending = true; this.pendingTimer = 0.1;
        this.pendingDir = Math.abs(this.input.steer) > 0.3 ? (this.input.steer > 0 ? 1 : -1) : 0;
      }
      this.airTime = 0;
      this.jumpEmitted = false;
      this.fallSpeed = 0;
    }

    // Lean for views: into the turn, positive = right.
    const latAcc = this.speed * this.yawRate;
    let leanT = clamp(-latAcc * 0.007, -0.28, 0.28);
    if (this.drift.active) leanT += this.drift.dir * 0.12;
    this.lean += (leanT - this.lean) * Math.min(1, 10 * dt);

    this.updateWheelPositions();
    this.checkRespawn(sim, up, dt);
    this.checkZones(sim);
    this.updateSlipstream(sim, dt);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  syncFromBody(): void {
    const t = this.body.translation(), r = this.body.rotation(), l = this.body.linvel(), a = this.body.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(l.x, l.y, l.z);
    this.angVel.set(a.x, a.y, a.z);
  }

  private setLinvel(v: Vector3): void {
    _r.x = v.x; _r.y = v.y; _r.z = v.z;
    this.body.setLinvel(_r, true);
    this.vel.copy(v);
  }

  /** Applies a world-space angular impulse to `angVel` using the body inertia. */
  private addAngularImpulse(t: Vector3): void {
    _qi.copy(this.quat).invert();
    _v3.copy(t).applyQuaternion(_qi);
    _v3.x /= this.inertia.x; _v3.y /= this.inertia.y; _v3.z /= this.inertia.z;
    this.angVel.add(_v3.applyQuaternion(this.quat));
  }

  private stepTilt(n: Vector3, grounded: number, dt: number): void {
    if (this.stun > 0 && this.stunKind === 'tumble' && this.tumbleTime > 0) {
      // Barrel roll around the forward axis.
      const f = _v2.set(0, 0, 1).applyQuaternion(this.quat);
      const rate = this.tumbleAxisSign * TAU / 0.75;
      const cur = this.angVel.dot(f);
      this.angVel.addScaledVector(f, rate - cur);
      this.tumbleTime -= dt;
      return;
    }
    const up = _v2.set(0, 1, 0).applyQuaternion(this.quat);
    const target = grounded >= 3 ? n : WORLD_UP;
    const axis = _v3.crossVectors(up, target);
    const s = axis.length();
    const angle = Math.atan2(s, up.dot(target));
    // Tilt components of the angular velocity (perpendicular to the body up).
    const yawPart = this.angVel.dot(up);
    const tilt = _tilt.copy(this.angVel).addScaledVector(up, -yawPart);
    let k: number, rate: number;
    if (grounded === 4) { k = angle > 0.35 ? PHYS.rightGround : 0; rate = PHYS.tiltDamping; }
    else if (grounded > 0) { k = PHYS.rightGround; rate = 8; }
    else { k = PHYS.rightAir; rate = angle > 1.2 ? 6 : 3; }
    const want = _want.set(0, 0, 0);
    if (s > 1e-5 && k > 0) want.copy(axis).multiplyScalar((angle * k) / s);
    tilt.lerp(want, Math.min(1, rate * dt));
    this.angVel.copy(tilt).addScaledVector(up, yawPart);
  }

  private updateSurface(sim: RaceSim): void {
    if (this.nGrounded === 0) return;
    // Majority of grounded wheels; ties go to the slower surface.
    let best: SurfaceType = this.surface, bestN = 0;
    for (const w of this.wheels) {
      if (!w.grounded) continue;
      let c = 0;
      for (const o of this.wheels) if (o.grounded && o.surface === w.surface) c++;
      if (c > bestN || (c === bestN && SURFACES[w.surface].speed < SURFACES[best].speed)) { best = w.surface; bestN = c; }
    }
    if (best !== this.surface) {
      const from = this.surface;
      this.surface = best;
      sim.events.emit('kart:surface', { kart: this, from, to: best });
    }
  }

  private tickTimers(sim: RaceSim, dt: number): void {
    let top = 1, acc = 1, grip = 1, steer = 1, inv = false;
    for (let i = this.modifiers.length - 1; i >= 0; i--) {
      const m = this.modifiers[i];
      m.time -= dt;
      if (m.time <= 0) { this.modifiers.splice(i, 1); continue; }
      if (m.topSpeed !== undefined) top *= m.topSpeed;
      if (m.accel !== undefined) acc *= m.accel;
      if (m.grip !== undefined) grip *= m.grip;
      if (m.steer !== undefined) steer *= m.steer;
      if (m.invincible) inv = true;
    }
    this.modTop = top; this.modAccel = acc; this.modGrip = grip; this.modSteer = steer; this.invincible = inv;
    this.topSpeed = this.stats.topSpeed * top;
    this.boost.time = Math.max(0, this.boost.time - dt);
    if (this.boost.time === 0) this.boost.power = 1;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    if (this.stun > 0) {
      this.stun = Math.max(0, this.stun - dt);
      if (this.stun === 0) { this.stunKind = null; this.spinRate = 0; this.tumbleTime = 0; }
    }
    this.stall = Math.max(0, this.stall - dt);
    this.hopTimer += dt;
    this.lastDriftPress += dt;
    this.slipCooldown = Math.max(0, this.slipCooldown - dt);
    this.cannonCooldown = Math.max(0, this.cannonCooldown - dt);
    this.collideCooldown = Math.max(0, this.collideCooldown - dt);
    void sim;
  }

  private updateStartBoost(sim: RaceSim, throttle: number): void {
    const phase = sim.phase;
    if (phase === 'intro' || phase === 'countdown') {
      if (throttle > 0.5 && this.prevThrottle <= 0.5) this.startPress = phase === 'intro' ? -99 : sim.raceTime;
      else if (throttle <= 0.5) this.startPress = NaN;
    } else if (phase === 'racing' && this.lastPhase === 'countdown') {
      const p = this.startPress;
      if (!Number.isNaN(p)) {
        if (p < -1.6) {
          this.stall = 0.9;
          sim.events.emit('kart:startBoost', { kart: this, quality: 0 });
          sim.events.emit('fx', { name: 'smoke', pos: this.pos.clone(), scale: 1 });
        } else if (p >= -1.4 && p <= -0.15) {
          const quality = clamp(1 - Math.abs(p + 0.85) / 0.75, 0.25, 1);
          sim.events.emit('kart:startBoost', { kart: this, quality });
          this.giveBoost(0.45 + 1.0 * quality, PHYS.boostPower, 'start');
        }
      }
      this.startPress = NaN;
    }
    this.lastPhase = phase;
  }

  private startDrift(dir: -1 | 1): void {
    this.driftPending = false;
    this.drift.active = true;
    this.drift.dir = dir;
    this.drift.charge = 0;
    this.drift.level = 0;
    this.sim?.events.emit('kart:driftStart', { kart: this });
  }

  private chargeDrift(sim: RaceSim, amount: number): void {
    const d = this.drift;
    d.charge += amount;
    const tiers = PHYS.driftTiers;
    const lvl = (d.charge >= tiers[2] ? 3 : d.charge >= tiers[1] ? 2 : d.charge >= tiers[0] ? 1 : 0) as 0 | 1 | 2 | 3;
    if (lvl !== d.level) {
      d.level = lvl;
      sim.events.emit('kart:driftLevel', { kart: this, level: lvl });
    }
  }

  /** Ends a drift; `release` grants the mini-turbo for the reached tier. */
  endDrift(release: boolean): void {
    const d = this.drift;
    if (!d.active) return;
    const level = d.level;
    d.active = false; d.dir = 0; d.charge = 0; d.level = 0;
    this.sim?.events.emit('kart:driftEnd', { kart: this, level });
    if (release && level > 0) this.giveBoost(PHYS.driftBoost[level] * this.stats.driftBoostScale, PHYS.boostPower + (level === 3 ? 0.05 : 0), 'drift');
  }

  private doTrick(sim: RaceSim): void {
    this.trick = true;
    sim.events.emit('kart:trick', { kart: this });
    sim.events.emit('fx', { name: 'trick', pos: this.pos.clone(), color: this.char.color });
  }

  private inZone(sim: RaceSim, kind: string): boolean {
    const loc = this.loc;
    for (const z of sim.track.zones) {
      if (!z.enabled || z.kind !== kind || z.path !== loc.path) continue;
      if (loc.progress < z.from || loc.progress > z.to) continue;
      if (z.latMin !== undefined && loc.lat < z.latMin) continue;
      if (z.latMax !== undefined && loc.lat > z.latMax) continue;
      return true;
    }
    return false;
  }

  private assistSteer(sim: RaceSim, steer: number, fwd: Vector3): number {
    const loc = this.loc, hw = loc.halfWidth;
    if (Math.abs(loc.lat) > hw + 6) return steer;
    const look = Math.max(7, Math.abs(this.speed) * 0.6);
    const keep = Math.max(0, hw - 2.5);
    const frame = sim.track.sample(loc.progress + look, clamp(loc.lat, -keep, keep) * 0.85, loc.path, _frame);
    const dx = frame.pos.x - this.pos.x, dz = frame.pos.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return steer;
    // Signed angle from forward to the aim point, positive = target is to the left.
    const fx = fwd.x, fz = fwd.z;
    const fl = Math.hypot(fx, fz) || 1;
    const cross = (fz * dx - fx * dz) / (fl * len); // +Y component of fwd × dir
    const dot = (fx * dx + fz * dz) / (fl * len);
    if (dot < 0) return steer;
    const angle = Math.atan2(cross, dot);
    const desired = clamp(-angle * 2.4, -1, 1);
    const edge = clamp((Math.abs(loc.lat) / hw - 0.45) / 0.55, 0, 1);
    const w = (0.2 + 0.55 * edge * edge) * (1 - 0.5 * Math.abs(steer));
    return clamp(steer + (desired - steer) * w, -1, 1);
  }

  private handleContacts(sim: RaceSim, up: Vector3, dt: number): void {
    const other = this.contactKart;
    const hitStatic = this.contactStatic;
    this.contactKart = null;
    this.contactStatic = false;
    if (!other && !hitStatic) return;
    // Velocity change not explained by gravity = contact impulse.
    const dv = _v2.copy(this.vel).sub(this.velBefore);
    dv.y += PHYS.gravity * dt;
    dv.addScaledVector(up, -dv.dot(up));
    const dvl = dv.length();
    if (dvl < 0.8) return;
    const nrm = _v3.copy(dv).divideScalar(dvl); // pushes away from the obstacle
    const impulse = dvl * this.stats.mass;

    if (other) {
      // Arcade bump: shove apart, lighter karts fly further.
      const mo = other.stats.mass, me = this.stats.mass;
      _v4.copy(this.pos).sub(other.pos);
      _v4.addScaledVector(up, -_v4.dot(up));
      if (_v4.lengthSq() > 1e-4) {
        _v4.normalize();
        const k = PHYS.kartBump * (2 * mo / (mo + me)) * Math.min(1, dvl / 4 + 0.3);
        this.vel.addScaledVector(_v4, k);
        this.setLinvel(this.vel);
      }
      if (other.invincible && !this.invincible) this.applyHit('bump', { by: other.id, dir: _v4, cause: 'star' });
    } else {
      // Wall: deflect and scrub instead of a dead stop.
      const v = this.vel;
      const vh = _tilt.copy(v).addScaledVector(up, -v.dot(up));
      const sp = vh.length();
      if (sp > 0.5) {
        const head = Math.min(1, dvl / (sp + dvl));
        vh.multiplyScalar(1 - PHYS.wallScrub * head);
        v.copy(vh).addScaledVector(up, this.vel.dot(up));
      }
      v.addScaledVector(nrm, PHYS.wallBounce * Math.min(1, dvl / 6));
      this.setLinvel(v);
      // Turn the nose along the wall.
      const f = _f.set(0, 0, 1).applyQuaternion(this.quat);
      const into = -f.dot(nrm);
      if (into > 0.1 && this.speed > 2) {
        const side = Math.sign(_want.crossVectors(f, nrm).dot(up)) || 1; // rotate away from the wall
        _r.x = this.angVel.x - up.x * side * into * 3; _r.y = this.angVel.y - up.y * side * into * 3; _r.z = this.angVel.z - up.z * side * into * 3;
        this.body.setAngvel(_r, true);
      }
      if (this.drift.active && head(dvl, sp) > 0.5) this.endDrift(false);
    }
    if (this.collideCooldown <= 0 && dvl > 2) {
      this.collideCooldown = 0.25;
      const point = _pt.copy(this.pos).addScaledVector(nrm, -0.8).addScaledVector(up, 0.5).clone();
      sim.events.emit('kart:collide', { kart: this, other, impulse, point });
    }
  }

  private checkRespawn(sim: RaceSim, up: Vector3, dt: number): void {
    if (this.carry) return;
    let reason = false;
    if (this.pos.y < sim.track.killY) reason = true;
    if (up.y < 0.1 && this.stun <= 0) this.upsideTime += dt; else this.upsideTime = 0;
    if (this.upsideTime > 1.3) reason = true;
    const racing = sim.phase === 'racing' || sim.phase === 'finished';
    if (racing && this.stun <= 0 && (this.input.throttle > 0.3 || this.input.brake > 0.3) && Math.abs(this.speed) < 1.2) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime > 4) reason = true;
    if (Math.abs(this.loc.lat) > this.loc.halfWidth + 40) this.outsideTime += dt; else this.outsideTime = 0;
    if (this.outsideTime > 1.5) reason = true;
    if (!reason && this.inZone(sim, 'respawn')) reason = true;
    if (reason) this.respawn(sim);
  }

  /** Puts the kart back on the road with a short drop-in. */
  respawn(sim: RaceSim): void {
    const pose = sim.track.respawn(this.loc);
    this.endDrift(false);
    this.driftPending = false;
    this.boost.time = 0; this.stun = 0; this.stunKind = null; this.trick = false; this.slipstream = 0;
    this.upsideTime = 0; this.stuckTime = 0; this.outsideTime = 0;
    this.invulnerable = 2.5;
    const up = _v.set(0, 1, 0).applyQuaternion(pose.quat);
    const to = pose.pos.clone().addScaledVector(up, 0.3);
    const from = pose.pos.clone().addScaledVector(up, 4);
    this.startCarry('respawn', from, pose.quat, to, pose.quat, 0.9, 0, 0, true);
    sim.events.emit('kart:respawn', { kart: this });
  }

  /** Cannon zones carry the kart to their target. 'glide' zones are a documented no-op for now. */
  private checkZones(sim: RaceSim): void {
    if (this.cannonCooldown > 0 || this.carry) return;
    const loc = this.loc;
    for (const z of sim.track.zones) {
      if (!z.enabled || z.kind !== 'cannon' || !z.target || z.path !== loc.path) continue;
      if (loc.progress < z.from || loc.progress > z.to) continue;
      if (z.latMin !== undefined && loc.lat < z.latMin) continue;
      if (z.latMax !== undefined && loc.lat > z.latMax) continue;
      const dist = this.pos.distanceTo(z.target.pos);
      const dur = z.duration ?? Math.max(1.2, dist / 30);
      this.endDrift(true);
      this.startCarry('cannon', this.pos.clone(), this.quat, z.target.pos.clone(), z.target.quat, dur, Math.max(6, dist * 0.25), Math.max(this.speed, this.topSpeed), false);
      sim.events.emit('fx', { name: 'cannon', pos: this.pos.clone() });
      return;
    }
  }

  private startCarry(kind: Carry['kind'], from: Vector3, qFrom: Quaternion, to: Vector3, qTo: Quaternion, dur: number, height: number, exitSpeed: number, snap: boolean): void {
    this.carry = { kind, from, to, qFrom: qFrom.clone(), qTo: qTo.clone(), t: 0, dur, height, exitSpeed };
    this.carried = true;
    this.body.setBodyType(this.host.R.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (snap) {
      this.pos.copy(from); this.quat.copy(qFrom);
      _r.x = from.x; _r.y = from.y; _r.z = from.z;
      this.body.setTranslation(_r, true);
      _rq.x = qFrom.x; _rq.y = qFrom.y; _rq.z = qFrom.z; _rq.w = qFrom.w;
      this.body.setRotation(_rq, true);
      this.prevPos.copy(from); this.prevQuat.copy(qFrom);
    }
    this.vel.set(0, 0, 0);
    this.grounded = false;
    for (const w of this.wheels) { w.grounded = false; w.compression = 0; w.slip = 0; }
  }

  private stepCarry(dt: number): void {
    const c = this.carry!;
    c.t += dt;
    const s = Math.min(1, c.t / c.dur);
    const e = c.kind === 'respawn' ? s * s : s;
    _v.copy(c.from).lerp(c.to, e);
    _v.y += c.height * 4 * s * (1 - s);
    _q.copy(c.qFrom).slerp(c.qTo, Math.min(1, s * 1.5));
    this.vel.copy(_v).sub(this.pos).divideScalar(dt);
    this.pos.copy(_v); this.quat.copy(_q);
    _r.x = _v.x; _r.y = _v.y; _r.z = _v.z;
    this.body.setNextKinematicTranslation(_r);
    _rq.x = _q.x; _rq.y = _q.y; _rq.z = _q.z; _rq.w = _q.w;
    this.body.setNextKinematicRotation(_rq);
    this.speed = this.vel.dot(_v2.set(0, 0, 1).applyQuaternion(_q));
    if (s >= 1) this.finishCarry(true);
  }

  private finishCarry(launch: boolean): void {
    const c = this.carry!;
    this.carry = null;
    this.carried = false;
    this.body.setBodyType(this.host.R.RigidBodyType.Dynamic, true);
    if (launch) {
      _r.x = c.to.x; _r.y = c.to.y; _r.z = c.to.z;
      this.body.setTranslation(_r, true);
      _rq.x = c.qTo.x; _rq.y = c.qTo.y; _rq.z = c.qTo.z; _rq.w = c.qTo.w;
      this.body.setRotation(_rq, true);
      _v.set(0, 0, 1).applyQuaternion(c.qTo).multiplyScalar(c.exitSpeed);
      this.setLinvel(_v);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.pos.copy(c.to); this.quat.copy(c.qTo);
    }
    if (c.kind === 'cannon') this.cannonCooldown = 1.5;
    this.airTime = 0.01;
  }

  private updateSlipstream(sim: RaceSim, dt: number): void {
    if (sim.phase !== 'racing' || this.slipCooldown > 0 || !this.grounded || this.speed < 18 || this.stun > 0 || this.inZone(sim, 'slipstreamOff')) {
      this.slipstream = Math.max(0, this.slipstream - dt * 0.8);
      return;
    }
    const f = _f.set(0, 0, 1).applyQuaternion(this.quat);
    let found = false;
    for (const o of sim.karts) {
      if (o === this || o.carried || o.speed < 10) continue;
      const dx = o.pos.x - this.pos.x, dy = o.pos.y - this.pos.y, dz = o.pos.z - this.pos.z;
      const along = dx * f.x + dy * f.y + dz * f.z;
      if (along < 3.5 || along > PHYS.slipstreamRange) continue;
      const side = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
      if (side > 1.3 + along * 0.05) continue;
      _v2.set(0, 0, 1).applyQuaternion(o.quat);
      if (_v2.dot(f) < 0.8) continue;
      found = true;
      break;
    }
    if (!found) { this.slipstream = Math.max(0, this.slipstream - dt * 0.8); return; }
    this.slipstream = Math.min(1, this.slipstream + dt / PHYS.slipstreamTime);
    if (this.slipstream >= 1) {
      this.slipstream = 0;
      this.slipCooldown = 2.5;
      sim.events.emit('kart:slipstream', { kart: this });
      this.giveBoost(PHYS.slipstreamBoost, PHYS.slipstreamPower, 'slipstream');
    }
  }

  updateWheelPositions(): void {
    for (let i = 0; i < 4; i++) {
      const L = this.suspLen[i];
      _v.copy(WHEEL_LOCAL[i]);
      _v.y -= L;
      this.wheels[i].pos.copy(_v.applyQuaternion(this.quat).add(this.pos));
    }
  }
}

function head(dvl: number, sp: number): number { return dvl / (sp + dvl + 1e-6); }

export const KART_GROUPS = (0x4 << 16) | 0x7;

const _lin0 = new Vector3();
const _tq = new Vector3(), _mount = new Vector3(), _hn = new Vector3(), _arm = new Vector3(), _pv = new Vector3();
const _jt = new Vector3(), _jd = new Vector3(), _f = new Vector3(), _rt = new Vector3(), _g = new Vector3();
const _tilt = new Vector3(), _want = new Vector3(), _pt = new Vector3();
// Reused ray (Rapier only reads origin and dir).
const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } };
const _frame = { pos: new Vector3(), forward: new Vector3(), right: new Vector3(), up: new Vector3(), halfWidth: 8 };
