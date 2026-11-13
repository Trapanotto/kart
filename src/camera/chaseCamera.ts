// Chase camera rig. Owner: physics (camera). Render side: reads sim state, never writes it.
//
// - Spring follow with heading lag in turns, drift offset (shows the slide angle).
// - FOV opens with speed and kicks on boost; landing dip; shake impulses (trauma model).
// - Look back, 'orbit' (intro) and 'finish' (swings to the front of the kart).
// - Never clips into the ground or through walls: rays against the physics world, with
//   a track-height fallback.
// - Mode 'auto' (default): orbit in intro, blends to chase during the countdown, finish once
//   the target kart has finished. setMode() pins a mode; setMode is sticky until called again.
import { Vector3 } from 'three/webgpu';
import type { CameraRig, GameEvents, Kart, RaceSim, RenderContext, TrackLocation } from '../core/types';
import { activePhysics } from '../physics/system';

export interface ChaseCameraOptions {
  /** Shake enabled (settings.cameraShake). Default: read from saved settings. */
  shake?: boolean;
  distance?: number;
  height?: number;
  baseFov?: number;
}

export interface ChaseCameraRig extends CameraRig {
  setShakeEnabled(on: boolean): void;
  /** Current mode including 'auto'. */
  readonly mode: 'auto' | 'chase' | 'orbit' | 'finish';
}

const SETTINGS_KEY = 'tk2.settings';
function savedShake(): boolean {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); return s.cameraShake !== false; } catch { return true; }
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
function wrapAngle(a: number): number { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export function createChaseCamera(_ctx: RenderContext, opts: ChaseCameraOptions = {}): ChaseCameraRig {
  let target: Kart | null = null;
  let mode: 'auto' | 'chase' | 'orbit' | 'finish' = 'auto';
  let shakeOn = opts.shake ?? savedShake();
  const DIST = opts.distance ?? 4.5, HEIGHT = opts.height ?? 2.0, FOV = opts.baseFov ?? 58;

  let first = true;
  const pos = new Vector3(), look = new Vector3();
  const want = new Vector3(), wantLook = new Vector3(), dir = new Vector3(), tmp = new Vector3(), tmp2 = new Vector3();
  const chasePos = new Vector3(), chaseLook = new Vector3(), altPos = new Vector3(), altLook = new Vector3();
  let yaw = 0;           // smoothed camera heading
  let sideOff = 0;       // drift side offset
  let fov = FOV, fovKick = 0;
  let dip = 0, dipVel = 0;
  let trauma = 0, shakeT = 0;
  let orbitAngle = 0;
  let finishT = 0;
  let lookBackBlend = 0;
  let wasLookBack = false;
  const fromP = new Vector3();
  let settingsCheck = 0;
  let boundSim: RaceSim | null = null;
  let unsub: (() => void)[] = [];
  const loc: TrackLocation = { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: 0 };
  let locValid = false;

  function bind(sim: RaceSim | null): void {
    for (const u of unsub) u();
    unsub = [];
    boundSim = sim;
    if (!sim) return;
    const ev = sim.events;
    const mine = (k: Kart) => k === target;
    unsub.push(
      ev.on('kart:hit', (e: GameEvents['kart:hit']) => { if (mine(e.kart) && !e.absorbed) rig.shake(e.kind === 'bump' ? 0.3 : 0.7); }),
      ev.on('kart:land', (e: GameEvents['kart:land']) => { if (mine(e.kart)) { dipVel -= Math.min(3, e.impact * 0.12); if (e.impact > 8) rig.shake(Math.min(0.5, e.impact / 40)); } }),
      ev.on('kart:boost', (e: GameEvents['kart:boost']) => { if (mine(e.kart)) fovKick = Math.max(fovKick, e.cause === 'pad' || e.cause === 'item' ? 1 : 0.7); }),
      ev.on('kart:collide', (e: GameEvents['kart:collide']) => { if (mine(e.kart)) rig.shake(Math.min(0.6, e.impulse / 6000)); }),
      ev.on('kart:respawn', (e: GameEvents['kart:respawn']) => { if (mine(e.kart)) first = true; }),
    );
  }

  /** Keeps `p` above the ground and in front of walls as seen from `from`. */
  function resolve(p: Vector3, from: Vector3, sim: RaceSim | null): void {
    const phys = activePhysics();
    if (phys) {
      tmp.subVectors(p, from);
      const d = tmp.length();
      if (d > 0.01) {
        tmp.divideScalar(d);
        const hit = phys.raycast(from, tmp, d + 0.3, true);
        if (hit >= 0 && hit < d + 0.3) p.copy(from).addScaledVector(tmp, Math.max(0.6, hit - 0.35));
      }
      tmp2.set(p.x, p.y + 2.5, p.z);
      tmp.set(0, -1, 0);
      const g = phys.raycast(tmp2, tmp, 6, false);
      if (g >= 0) { const gy = tmp2.y - g; if (p.y < gy + 0.7) p.y = gy + 0.7; }
    } else if (sim) {
      sim.track.locate(p, locValid ? loc : undefined, loc);
      locValid = true;
      if (Math.abs(loc.lat) < loc.halfWidth + 6 && loc.height < 0.7) p.y += 0.7 - loc.height;
    }
  }

  const rig: ChaseCameraRig = {
    get mode() { return mode; },
    setTarget(k) { target = k; first = true; finishT = 0; },
    shake(amount) { if (shakeOn) trauma = Math.min(1, trauma + amount); },
    setMode(m) { mode = m; if (m === 'finish') finishT = 0; },
    setShakeEnabled(on) { shakeOn = on; if (!on) trauma = 0; },
    update(dtRaw, ctx) {
      const dt = Math.min(0.1, Math.max(0, dtRaw));
      const sim = ctx.sim;
      if (sim !== boundSim) bind(sim);
      if (!target) return;
      if ((settingsCheck -= dt) <= 0 && opts.shake === undefined) { settingsCheck = 1; shakeOn = savedShake(); }
      const k = target;
      const cam = ctx.camera;

      // Kart heading (horizontal), blended towards the velocity while drifting.
      dir.set(0, 0, 1).applyQuaternion(k.renderQuat);
      let heading = Math.atan2(dir.x, dir.z);
      const vh = Math.hypot(k.vel.x, k.vel.z);
      if (k.drift.active && vh > 3) heading += wrapAngle(Math.atan2(k.vel.x, k.vel.z) - heading) * 0.65;
      if (first) yaw = heading;
      // Heading lag: looser at low speed, tighter when fast.
      yaw += wrapAngle(heading - yaw) * damp(k.carried ? 2.5 : 5 + vh * 0.06, dt);
      yaw = wrapAngle(yaw);
      sideOff += ((k.drift.active ? -k.drift.dir * 0.9 : 0) - sideOff) * damp(3, dt);

      const speedN = Math.min(1.4, Math.abs(k.speed) / Math.max(1, k.topSpeed));
      const dist = DIST + speedN * 0.6;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      // Right vector (kart convention: +X is left, so right = (-fz, 0, fx)... in world: (−cos, 0, sin)).
      const rx = -fz, rz = fx;

      // Landing dip spring.
      dipVel += (-dip * 90 - dipVel * 12) * dt;
      dip += dipVel * dt;

      chasePos.set(k.renderPos.x - fx * dist + rx * sideOff, k.renderPos.y + HEIGHT + dip * 0.6, k.renderPos.z - fz * dist + rz * sideOff);
      chaseLook.set(k.renderPos.x + fx * 3.5, k.renderPos.y + 1.0 + dip * 0.25, k.renderPos.z + fz * 3.5);

      // Look back.
      lookBackBlend = k.input.lookBack && !k.race.finished ? 1 : 0;
      if (lookBackBlend > 0.01) {
        altPos.set(k.renderPos.x + fx * 4.8, k.renderPos.y + 2.2, k.renderPos.z + fz * 4.8);
        altLook.set(k.renderPos.x - fx * 6, k.renderPos.y + 0.8, k.renderPos.z - fz * 6);
        chasePos.copy(altPos);
        chaseLook.copy(altLook);
      }

      // Mode selection.
      let m = mode;
      let orbitW = 0;
      if (m === 'auto') {
        if (k.race.finished) m = 'finish';
        else if (sim && sim.phase === 'intro') { m = 'orbit'; orbitW = 1; }
        else if (sim && sim.phase === 'countdown') { m = 'chase'; orbitW = 1 - smooth((sim.raceTime + 2.8) / 2.2); }
        else m = 'chase';
      } else if (m === 'orbit') orbitW = 1;

      want.copy(chasePos);
      wantLook.copy(chaseLook);
      if (orbitW > 0) {
        orbitAngle += dt * 0.35;
        const a = yaw + Math.PI * 0.85 + orbitAngle;
        altPos.set(k.renderPos.x + Math.sin(a) * 9, k.renderPos.y + 3.2, k.renderPos.z + Math.cos(a) * 9);
        altLook.set(k.renderPos.x, k.renderPos.y + 0.9, k.renderPos.z);
        want.lerp(altPos, orbitW);
        wantLook.lerp(altLook, orbitW);
      } else orbitAngle = 0;
      if (m === 'finish') {
        finishT = Math.min(1, finishT + dt / 2.2);
        const s = smooth(finishT);
        const a = yaw + Math.PI * (1 - s) + 0.35 * s; // from behind to the front-left
        const r = DIST + 0.5 - 1.2 * s;
        altPos.set(k.renderPos.x - Math.sin(a) * r, k.renderPos.y + HEIGHT - 0.9 * s, k.renderPos.z - Math.cos(a) * r);
        altLook.set(k.renderPos.x, k.renderPos.y + 1.0, k.renderPos.z);
        want.copy(altPos); wantLook.copy(altLook);
      } else finishT = 0;

      // Keep the camera out of the ground and walls, seen from above the kart.
      fromP.set(k.renderPos.x, k.renderPos.y + 1.6, k.renderPos.z);
      resolve(want, fromP, sim);

      const lb = lookBackBlend > 0.5;
      if (lb !== wasLookBack) { wasLookBack = lb; first = true; }
      if (first) { pos.copy(want); look.copy(wantLook); first = false; }
      // Position: firm horizontal follow (the heading lag already gives the turn feel), softer vertical.
      const ph = damp(16, dt), pv = damp(8, dt);
      pos.x += (want.x - pos.x) * ph;
      pos.z += (want.z - pos.z) * ph;
      pos.y += (want.y - pos.y) * pv;
      if (pos.y < want.y - 1.2) pos.y = want.y - 1.2; // never lag far below (ground)
      look.lerp(wantLook, damp(18, dt));

      // Shake (trauma²), decays.
      trauma = Math.max(0, trauma - dt * 1.4);
      shakeT += dt;
      const sh = shakeOn ? trauma * trauma : 0;
      cam.position.copy(pos);
      if (sh > 0) {
        cam.position.x += sh * 0.35 * (Math.sin(shakeT * 37.1) + 0.5 * Math.sin(shakeT * 71.3));
        cam.position.y += sh * 0.25 * Math.sin(shakeT * 43.7 + 1.3);
        cam.position.z += sh * 0.35 * Math.sin(shakeT * 29.9 + 2.1);
      }
      cam.up.set(0, 1, 0);
      cam.lookAt(look);

      // FOV: opens with speed, kicks on boost.
      fovKick = Math.max(0, fovKick - dt * 1.6);
      const boosting = k.boost.time > 0 ? 1 : 0;
      const targetFov = FOV + 8 * Math.min(1, speedN) + 6 * boosting + 6 * fovKick;
      fov += (targetFov - fov) * damp(4, dt);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    },
    dispose() { bind(null); target = null; },
  };
  return rig;
}
