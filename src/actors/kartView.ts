// Kart + driver view: wheels, suspension, body lean, squash/stretch, animation state machine,
// facial expressions and fur. Reads sim state only. Owner: actors.
import * as THREE from 'three/webgpu';
import { float, length, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import type { HitKind, Kart, RenderContext, View } from '../core/types';
import { addFurShells, furMaterial, glossMaterial } from './fur';

/** Steering-wheel rotation at full lock; the steer clips are baked with the hands at this angle. */
export const STEER_MAX = 0.75;

const LOOPS = ['idle', 'steer_l', 'steer_r', 'drift_l', 'drift_r', 'boost', 'look_back', 'win', 'lose'] as const;
const ONESHOTS = ['hit', 'squash', 'cheer', 'throw'] as const;
type LoopName = (typeof LOOPS)[number];
type OneShotName = (typeof ONESHOTS)[number];
/** Steering-node rotation (about its local +Y column axis) each clip was authored with; a right turn is negative. */
const CLIP_WHEEL: Partial<Record<LoopName, number>> = { steer_l: STEER_MAX, steer_r: -STEER_MAX, drift_l: STEER_MAX * 1.15, drift_r: -STEER_MAX * 1.15 };
const ONESHOT_PRIORITY: Record<OneShotName, number> = { hit: 3, squash: 3, throw: 2, cheer: 1 };

const WHEELS = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _inv = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Tyre radius the physics uses for its wheel centres (PHYS.wheelRadius). */
const SIM_WHEEL_R = 0.3;
/** Height of the axis the chassis rolls about, and how much of the sim's lean it shows. */
const ROLL_PIVOT_Y = 0.3, ROLL_GAIN = 0.2;

/** Soft dark patch under the kart: ties it to the road where the sun shadow is faint or absent. */
let contactGeo: THREE.PlaneGeometry | null = null;
function contactShadow(): { mesh: THREE.Mesh; strength: { value: number } } {
  contactGeo ??= new THREE.PlaneGeometry(1.75, 2.45).rotateX(-Math.PI / 2);
  const strength = uniform(1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.colorNode = float(0);
  const d = length(uv().sub(0.5).mul(vec2(2, 2)));
  mat.opacityNode = smoothstep(1, 0.35, d).mul(0.5).mul(strength);
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const mesh = new THREE.Mesh(contactGeo, mat);
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return { mesh, strength };
}

interface WheelRig { node: THREE.Object3D; base: THREE.Vector3; baseQ: THREE.Quaternion; offset: number; bottom: number }
interface Face { mesh: THREE.Mesh; blink: number; happy: number; hurt: number }

export function createKartView(kart: Kart, ctx: RenderContext): View {
  const id = kart.char.id;
  const root = new THREE.Group();
  root.name = `kartview:${id}`;
  root.userData.kartId = kart.id;
  const body = new THREE.Group();          // lean, pitch, squash, visual spins
  root.add(body);

  const kartObj = ctx.assets.model(`kart.${id}`);
  body.add(kartObj);
  const find = (n: string) => kartObj.getObjectByName(n) ?? null;
  const wheels: (WheelRig | null)[] = WHEELS.map((n) => {
    const node = find(n);
    if (!node) return null;
    // lowest point of the tyre in kart space, so it can be set down exactly on the road
    const bottom = new THREE.Box3().setFromObject(node).min.y;
    return { node, base: node.position.clone(), baseQ: node.quaternion.clone(), offset: 0, bottom };
  });
  // Everything except the wheels sits in a chassis group: it pitches and rolls on the suspension
  // while the wheels stay planted on the road.
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  const wheelParent = wheels.find((w) => w)?.node.parent ?? kartObj;
  for (const c of [...wheelParent.children]) if (!WHEELS.includes(c.name)) chassis.add(c);
  wheelParent.add(chassis);
  const steering = find('steering');
  const steeringBase = steering?.quaternion.clone() ?? new THREE.Quaternion();
  const seat = find('seat');

  const driver = ctx.assets.model(`char.${id}`);
  if (seat) seat.add(driver);
  else { driver.position.set(0, 0.3, -0.22); body.add(driver); }

  // --- materials, shadows ---
  let furOn = ctx.quality.fur;
  const furMeshes: THREE.Mesh[] = [];
  const faces: Face[] = [];
  const skeletons: THREE.Skeleton[] = [];
  driver.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;   // skinned poses leave the bind-pose bounds
    const name = (m.material as THREE.Material)?.name ?? '';
    if (name.startsWith('fur')) { m.userData.fur = true; furMeshes.push(m); m.material = furMaterial(furOn); }
    else if (name === 'gloss') m.material = glossMaterial();
    const sk = (m as THREE.SkinnedMesh).skeleton;
    if (sk && !skeletons.includes(sk)) skeletons.push(sk);
    const dict = m.morphTargetDictionary;
    if (dict && 'blink' in dict) faces.push({ mesh: m, blink: dict.blink, happy: dict.happy ?? -1, hurt: dict.hurt ?? -1 });
  });
  kartObj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  let shells: THREE.Object3D[] = [];
  const wantShells = () => ctx.quality.fur && ctx.quality.tier === 'high' && kart.isHuman;
  if (wantShells()) shells = addFurShells(driver);

  const contact = contactShadow();
  root.add(contact.mesh);
  let contactK = 1;

  ctx.scene.add(root);

  // --- animation ---
  const mixer = new THREE.AnimationMixer(driver);
  const clips = ctx.assets.clips(`char.${id}`);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const c of clips) {
    const a = mixer.clipAction(c);
    if ((ONESHOTS as readonly string[]).includes(c.name)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else {
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(c.name === 'idle' ? 1 : 0);
    }
    actions.set(c.name, a);
  }
  // desynchronise idle cycles between karts
  mixer.update(Math.random() * 2);

  const st = {
    steer: 0, drift: 0, driftDir: 1, boost: 0, look: 0, end: 0, endClip: 'win' as LoopName,
    shot: null as OneShotName | null, shotT: 0, shotDur: 0,
    blinkT: 1 + Math.random() * 3, blink: 0, happy: 0, hurt: 0, happyHold: 0, hurtHold: 0,
    prevSpeed: kart.speed, accel: 0, pitch: 0, lean: 0, leanSeen: false,
    sq: 0, sqV: 0, flat: 0, scale: 1,
    trickT: -1, trickDir: 1,
    spinT: -1, spinDur: 1, spinTurns: 2, spinKind: 'spin' as HitKind, spinAxis: AY, physSpin: false,
    prevQ: kart.renderQuat.clone(), angRate: 0, yawRate: 0, prevYaw: 0,
  };

  function play(name: OneShotName): void {
    const a = actions.get(name);
    if (!a) return;
    if (st.shot && st.shotT < st.shotDur && ONESHOT_PRIORITY[st.shot] > ONESHOT_PRIORITY[name]) return;
    if (st.shot && st.shot !== name) actions.get(st.shot)?.stop();
    a.reset();
    a.setEffectiveWeight(0);
    a.play();
    st.shot = name;
    st.shotT = 0;
    st.shotDur = a.getClip().duration;
  }

  // --- sim events ---
  const unsub: (() => void)[] = [];
  const ev = ctx.sim?.events;
  if (ev) {
    unsub.push(
      ev.on('kart:hit', (e) => {
        if (e.kart !== kart || e.absorbed) return;
        if (e.kind === 'squash') { play('squash'); st.hurtHold = 1.6; return; }
        play('hit');
        st.hurtHold = 1.4;
        if (e.kind === 'spin' || e.kind === 'tumble') {
          st.spinT = 0; st.spinKind = e.kind; st.physSpin = false;
          st.spinDur = e.kind === 'spin' ? 1.0 : 0.8; st.spinTurns = e.kind === 'spin' ? 2 : 1;
          st.spinAxis = e.kind === 'spin' ? AY : AX;
        }
      }),
      ev.on('kart:land', (e) => { if (e.kart === kart) st.sqV += Math.min(4, 0.6 + e.impact * 0.25); }),
      ev.on('kart:jump', (e) => { if (e.kart === kart) st.sqV -= 1.6; }),
      ev.on('kart:trick', (e) => {
        if (e.kart !== kart) return;
        st.trickT = 0; st.trickDir = kart.input.steer > 0.2 ? -1 : 1;
        play('cheer'); st.happyHold = 1.0;
      }),
      ev.on('race:rank', (e) => { if (e.kart === kart && e.to < e.from && kart.stun <= 0) { play('cheer'); st.happyHold = 1.2; } }),
      ev.on('item:use', (e) => { if (e.kart === kart) play('throw'); }),
      ev.on('kart:boost', (e) => { if (e.kart === kart && e.cause !== 'pad') st.happyHold = Math.max(st.happyHold, 0.5); }),
      ev.on('race:finish', (e) => {
        if (e.kart !== kart) return;
        st.endClip = e.rank <= 3 ? 'win' : 'lose';
        if (st.endClip === 'win') st.happyHold = 1e9;
      }),
    );
  }

  const weights: Record<string, number> = {};

  function updateAnimation(dt: number): number {
    const k = kart;
    st.steer = damp(st.steer, Math.max(-1, Math.min(1, k.input.steer)), 9, dt);
    if (k.drift.active && k.drift.dir !== 0) st.driftDir = k.drift.dir;
    st.drift = damp(st.drift, k.drift.active ? 1 : 0, 10, dt);
    st.boost = damp(st.boost, k.boost.time > 0 ? 1 : 0, 7, dt);
    st.look = damp(st.look, k.input.lookBack ? 1 : 0, 8, dt);
    st.end = damp(st.end, k.race.finished ? 1 : 0, 2.5, dt);

    for (const n of LOOPS) weights[n] = 0;
    for (const n of ONESHOTS) weights[n] = 0;
    const s = st.steer;
    weights.idle = 1 - Math.abs(s);
    weights.steer_l = Math.max(0, -s);
    weights.steer_r = Math.max(0, s);
    const mixIn = (name: string, w: number) => {
      for (const n in weights) weights[n] *= 1 - w;
      weights[name] += w;
    };
    mixIn(st.driftDir < 0 ? 'drift_l' : 'drift_r', st.drift);
    mixIn('boost', st.boost * 0.7);
    mixIn('look_back', st.look);
    mixIn(st.endClip, st.end);
    if (st.shot) {
      st.shotT += dt;
      const t = st.shotT, d = st.shotDur;
      const w = t >= d ? 0 : Math.min(1, t / 0.1) * Math.min(1, (d - t) / 0.2);
      mixIn(st.shot, w);
      if (t >= d) { actions.get(st.shot)?.stop(); st.shot = null; }
    }
    let wheel = 0;
    for (const [name, a] of actions) {
      const w = weights[name] ?? 0;
      a.setEffectiveWeight(w);
      wheel += w * (CLIP_WHEEL[name as LoopName] ?? 0);
    }
    mixer.update(dt);
    if (!actions.size) wheel = -s * STEER_MAX;
    return wheel;
  }

  function updateFace(dt: number): void {
    st.blinkT -= dt;
    if (st.blinkT <= 0) { st.blink = 0.16; st.blinkT = 1.8 + Math.random() * 3.5; if (Math.random() < 0.15) st.blinkT = 0.25; }
    const blinkW = st.blink > 0 ? Math.sin((1 - st.blink / 0.16) * Math.PI) : 0;
    st.blink = Math.max(0, st.blink - dt);
    st.happyHold -= dt; st.hurtHold -= dt;
    const hurtT = st.hurtHold > 0 || (kart.stun > 0) || (kart.race.finished && st.endClip === 'lose') ? 1 : 0;
    const happyT = hurtT ? 0 : st.happyHold > 0 ? 1 : 0;
    st.hurt = damp(st.hurt, hurtT, 12, dt);
    st.happy = damp(st.happy, happyT, 10, dt);
    for (const f of faces) {
      const inf = f.mesh.morphTargetInfluences;
      if (!inf) continue;
      const busy = Math.max(st.hurt, st.happy);
      inf[f.blink] = blinkW * (1 - busy);
      if (f.happy >= 0) inf[f.happy] = st.happy;
      if (f.hurt >= 0) inf[f.hurt] = st.hurt;
    }
  }

  function updateBody(dt: number): void {
    const k = kart;
    // angular speed of the sim body (detects whether physics already spins / tumbles the kart)
    _q.copy(st.prevQ).invert().multiply(k.renderQuat);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    st.angRate = dt > 0 ? damp(st.angRate, ang / dt, 20, dt) : st.angRate;
    _v.set(0, 0, 1).applyQuaternion(k.renderQuat);
    const yaw = Math.atan2(_v.x, _v.z);
    let dy = yaw - st.prevYaw; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
    st.yawRate = dt > 0 ? damp(st.yawRate, dy / dt, 10, dt) : st.yawRate;
    st.prevYaw = yaw;
    st.prevQ.copy(k.renderQuat);

    // acceleration pitch
    if (dt > 0) st.accel = damp(st.accel, (k.speed - st.prevSpeed) / dt, 6, dt);
    st.prevSpeed = k.speed;
    const pitchT = Math.max(-0.07, Math.min(0.07, -st.accel * 0.0045)) - (k.boost.time > 0 ? 0.03 : 0);
    st.pitch = damp(st.pitch, k.grounded ? pitchT : -0.04, 6, dt);
    // lean: physics value if it provides one, otherwise derived from the turn rate
    if (Math.abs(k.lean) > 1e-4) st.leanSeen = true;
    const leanT = st.leanSeen ? k.lean : Math.max(-0.2, Math.min(0.2, st.yawRate * k.speed * 0.007));
    st.lean = damp(st.lean, leanT, 10, dt);

    // squash & stretch spring
    const kS = 220, dS = 16;
    st.sqV += (-kS * st.sq - dS * st.sqV) * dt;
    st.sq += st.sqV * dt;
    st.sq = Math.max(-0.35, Math.min(0.35, st.sq));
    // flattened by a squash hit
    const flatT = k.stunKind === 'squash' || k.hasModifier('squash') ? 1 : 0;
    st.flat = damp(st.flat, flatT, flatT ? 25 : 5, dt);
    // shrink / grow from modifiers
    let sc = 1;
    for (const m of k.modifiers) if (m.scale) sc *= m.scale;
    st.scale = damp(st.scale, sc, 6, dt);

    const sy = (1 - st.sq * 0.6) * (1 - 0.58 * st.flat);
    const sxz = (1 + st.sq * 0.35) * (1 + 0.3 * st.flat);
    body.scale.set(sxz * st.scale, sy * st.scale, sxz * st.scale);

    // Chassis only: pitch from acceleration and a little body roll to the outside of the turn,
    // like a sprung car. The wheels are not part of it and stay on the road.
    chassis.quaternion.setFromAxisAngle(AX, st.pitch);
    _q2.setFromAxisAngle(AZ, -st.lean * ROLL_GAIN);
    chassis.quaternion.multiply(_q2);
    chassis.position.set(0, ROLL_PIVOT_Y, 0).applyQuaternion(chassis.quaternion).negate();
    chassis.position.y += ROLL_PIVOT_Y;
    body.quaternion.identity();

    // visual spin for hits when the sim does not rotate the body itself (grey-box physics)
    if (st.spinT >= 0) {
      st.spinT += dt;
      if (st.spinT < 0.3 && st.angRate > 4) st.physSpin = true;
      if (st.spinT >= st.spinDur || st.physSpin) st.spinT = -1;
      else {
        const u = st.spinT / st.spinDur;
        const e = 1 - Math.pow(1 - u, 2.2);
        _q2.setFromAxisAngle(st.spinAxis, e * st.spinTurns * Math.PI * 2 * (st.spinKind === 'tumble' ? -1 : 1));
        if (st.spinKind === 'tumble') { body.position.y = Math.sin(u * Math.PI) * 0.9; }
        body.quaternion.multiply(_q2);
      }
    } else body.position.y = damp(body.position.y, 0, 14, dt);
    // trick: barrel roll in the air
    if (st.trickT >= 0) {
      st.trickT += dt;
      const u = Math.min(1, st.trickT / 0.5);
      const e = u * u * (3 - 2 * u);
      _q2.setFromAxisAngle(AZ, st.trickDir * e * Math.PI * 2);
      body.quaternion.multiply(_q2);
      if (u >= 1) st.trickT = -1;
    }
  }

  function updateWheels(dt: number, wheelAngle: number): void {
    // Sim pose, not the interpolated one: the wheel positions belong to the same sim step.
    _inv.copy(kart.quat).invert();
    for (let i = 0; i < 4; i++) {
      const r = wheels[i];
      const w = kart.wheels[i];
      if (!r || !w) continue;
      // Set the tyre down where the sim's wheel touches the road (the sim's wheel centre minus
      // its radius, in kart space); in the air the sim extends the strut and the wheel hangs.
      const valid = w.pos.lengthSq() > 1e-6 && w.pos.distanceToSquared(kart.pos) < 9;
      const target = valid ? _v.copy(w.pos).sub(kart.pos).applyQuaternion(_inv).y - SIM_WHEEL_R - r.bottom : 0;
      r.offset = damp(r.offset, Math.max(-0.2, Math.min(0.14, target)), 40, dt);
      r.node.position.set(r.base.x, r.base.y + r.offset, r.base.z);
      r.node.quaternion.copy(r.baseQ);
      if (i < 2) r.node.quaternion.multiply(_q.setFromAxisAngle(AY, w.steer));
      r.node.quaternion.multiply(_q.setFromAxisAngle(AX, w.spin));
    }
    if (steering) steering.quaternion.copy(steeringBase).multiply(_q.setFromAxisAngle(AY, wheelAngle));
  }

  return {
    update(dt) {
      root.position.copy(kart.renderPos);
      root.quaternion.copy(kart.renderQuat);
      if (ctx.quality.fur !== furOn) {
        furOn = ctx.quality.fur;
        for (const m of furMeshes) m.material = furMaterial(furOn);
      }
      if (wantShells() !== shells.length > 0) {
        if (shells.length) { for (const s of shells) s.removeFromParent(); shells = []; }
        else shells = addFurShells(driver);
      }
      const wheelAngle = updateAnimation(dt);
      updateFace(dt);
      updateBody(dt);
      updateWheels(dt, wheelAngle);
      contactK = damp(contactK, kart.grounded ? 1 : 0, 12, dt);
      contact.strength.value = contactK;
      contact.mesh.visible = contactK > 0.02;
      // The WebGPU skinning node does not reliably refresh bone matrices of cloned rigs when the
      // renderer is driven without its own animation loop, so push them explicitly each frame.
      root.updateMatrixWorld(true);
      for (const sk of skeletons) sk.update();
    },
    dispose() {
      for (const u of unsub) u();
      mixer.stopAllAction();
      mixer.uncacheRoot(driver);
      for (const s of shells) s.removeFromParent();
      (contact.mesh.material as THREE.Material).dispose();
      ctx.scene.remove(root);
    },
  };
}
