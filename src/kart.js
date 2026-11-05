// Kart: Arcade-Fahrphysik, Drift, Boost, Treffer, Animation des Fahrers
import * as THREE from 'three';
import { createKartModel } from './assets.js';
import { loopFrame, LOOP_LEN, LOOP_SHIFT, underwater } from './features.js';

const DRIFT_LEVELS = [0.9, 1.8, 2.8];
const DRIFT_COLORS = ['#FFFFFF', '#4FC3FF', '#FF9A2B', '#C77DFF'];
const BOOST_TIME = [0, 0.6, 1.05, 1.6];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _u = new THREE.Vector3();
const _f = new THREE.Vector3(), _up = new THREE.Vector3(), _x = new THREE.Vector3(), _m4 = new THREE.Matrix4();

export function kartStats(c, cls) {
  return {
    maxSpeed: (27 + c.speed * 1.6) * cls.speed,
    accel: (12 + c.accel * 3.4) * cls.speed,
    steer: 1.45 + c.handling * 0.13,
    driftMul: 0.85 + c.drift * 0.08,
    mass: 0.8 + c.weight * 0.35,
    stunMul: (1.3 - c.tough * 0.1) * (c.recover ? 0.7 : 1),
  };
}

export class Kart {
  constructor(race, char, slot, human = null) {
    this.race = race;
    this.char = char;
    this.slot = slot;
    this.human = human; // Spielerindex oder null
    this.st = kartStats(char, race.cls);
    this.model = createKartModel(char.id, { fur: race.settings.fur, ghost: false });
    race.scene.add(this.model.root);
    this.model.root.rotation.order = 'YXZ';
    // Gleiter-Flügel (nur beim Gleiten sichtbar)
    const wing = new THREE.Group();
    const sail = new THREE.Mesh(new THREE.ConeGeometry(3.2, 0.25, 3), new THREE.MeshStandardMaterial({ color: char.color, roughness: 0.5, side: THREE.DoubleSide }));
    sail.rotation.set(0, Math.PI, 0);
    sail.scale.set(1, 1, 0.55);
    const stripe = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.27, 3), new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5 }));
    stripe.rotation.set(0, Math.PI, 0);
    stripe.scale.set(1, 1, 0.55);
    for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6), new THREE.MeshStandardMaterial({ color: '#555' }));
      strut.position.set(s * 0.5, -0.8, 0);
      wing.add(strut);
    }
    wing.add(sail, stripe);
    wing.position.set(0, 3.2, 0.2);
    wing.visible = false;
    this.model.root.add(wing);
    this.wing = wing;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;      // Vorwärtsgeschwindigkeit
    this.vy = 0;
    this.grounded = true;
    this.input = { throttle: 0, brake: 0, steer: 0, drift: false, item: false, back: false };
    this.prevDrift = false;
    this.prevItem = false;
    this.drift = { on: false, dir: 0, charge: 0, level: 0, pending: false };
    this.boostTime = 0;
    this.boostKind = 0;
    this.stun = 0;
    this.spin = 0;
    this.honey = 0;
    this.drowsy = 0;
    this.small = 0;
    this.shield = 0;
    this.cloud = 0;
    this.trick = 0;
    this.airTime = 0;
    this.item = null;
    this.itemCount = 0;
    this.rolling = 0;
    this.rubber = 1;
    this.loc = {};
    this.trackIdx = -1;
    this.lap = 0;
    this.halfway = false;
    this.progress = 0;
    this.rank = 1;
    this.finished = false;
    this.finishTime = 0;
    this.lapTimes = [];
    this.lapStart = 0;
    this.wrongWay = 0;
    this.wheelAngle = 0;
    this.steerVis = 0;
    this.t = Math.random() * 10;
    this.blink = 2 + Math.random() * 3;
    this.cheer = false;
    this.squash = 0;
    this.shake = 0;
    this.visYaw = 0;
  }

  place(idx, lat, track) {
    track.pointAt(idx, lat, this.pos);
    this.heading = track.headingAt(idx);
    this.visYaw = this.heading;
    this.trackIdx = Math.floor(idx);
    track.locate(this.pos, this.trackIdx, this.loc);
    this.pos.y = this.loc.y;
    this.updateModel(0);
  }

  get forward() { return _w.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  boost(time, kind = 1) {
    this.boostTime = Math.max(this.boostTime, time);
    this.boostKind = kind;
    this.speed = Math.max(this.speed, this.st.maxSpeed * 0.9);
    if (this.human !== null) this.race.audio.boost();
    if (kind >= 2 && Math.random() < 0.5) this.race.audio.voice(this, 'wii');
    if (kind >= 2) this.race.haptic?.(this, 50 + kind * 25, 0.25 + kind * 0.1);
  }

  hit(strength = 1) {
    if (this.finished || this.lolly > 0) return false;
    if (this.shield > 0) {
      this.shield = 0;
      this.race.audio.pop(this);
      this.race.burst(this.pos, '#CFF6FF', 14);
      return false;
    }
    this.race.items.onHit(this);
    this.stun = 1.15 * strength * this.st.stunMul;
    this.spin = 0;
    this.speed *= 0.25;
    this.drift.on = false;
    this.drift.pending = false;
    this.boostTime = 0;
    this.shake = 0.4;
    this.race.impact?.(this, 0.75 * strength);
    this.race.audio.hit(this);
    this.race.burst(this.pos, '#FFE36A', 18, true);
    return true;
  }

  update(dt) {
    const tr = this.race.track;
    const st = this.st;
    const inp = this.input;
    this.t += dt;
    const active = this.race.state === 'race' || this.race.state === 'done';
    const racing = active && !this.finished;
    let throttle = active ? inp.throttle * (this.finished ? 0.7 : 1) : 0;
    let brake = active ? inp.brake : 0;
    let steer = active ? inp.steer : 0;
    if (this.stun > 0) { throttle = 0; brake = 0; steer = 0; }

    for (const k of ['boostTime', 'honey', 'drowsy', 'small', 'shield', 'trick', 'lolly', 'draftBoostCool']) if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    if (this.stun > 0) { this.stun -= dt; this.spin += dt * 11; } else this.spin *= 0.85;
    if (this.shake > 0) this.shake -= dt;
    if (this.cloud > 0) {
      this.cloud -= dt;
      if (this.cloud <= 0) {
        this.race.items.zap(this);
      }
    }

    if (this.rail) { this.updateRail(dt); return; }
    tr.locate(this.pos, this.cannon ? -1 : this.trackIdx, this.loc);
    const loc = this.loc;
    this.trackIdx = loc.i;
    // Looping-Einfahrt
    if (this.grounded && !this.cannon) for (const L of tr.loops) {
      const di = (loc.i - L.c + tr.N) % tr.N;
      if (di <= 2 && this.speed > 3) {
        this.rail = { L, s: 0, off: Math.max(-2.4, Math.min(2.4, loc.lat + LOOP_SHIFT / 2)) };
        this.speed = Math.max(this.speed, 24);
        this.drift.on = false;
        this.updateRail(dt);
        return;
      }
    }
    const uw = underwater(tr, this.pos);
    if (uw && !this.uw && this.race.fxOn) this.race.burst(this.pos, '#CFF6FF', 14);
    this.uw = !!uw;
    const onRoad = Math.abs(loc.lat) <= tr.hw[loc.i] + 0.6 || tr.hp[loc.i] > 0;
    const grip = (this.char.iceGrip ? 1 : tr.grip[loc.i]) * (this.envGrip ?? 1); // Wetter: Pfützen, Eisplatten

    // Höchstgeschwindigkeit
    let maxV = st.maxSpeed * this.rubber;
    if (!onRoad && this.boostTime <= 0 && this.grounded) maxV *= this.race.theme.volcano ? 0.42 : 0.5;
    if (this.honey > 0) maxV *= 0.45;
    if (this.drowsy > 0) maxV *= 0.55;
    if (this.small > 0) maxV *= 0.72;
    if (this.cloud > 0) maxV *= 1.06;
    if (this.uw) maxV *= 0.93;
    if (this.lolly > 0) maxV *= 1.2;
    if (this.envSlow) maxV *= 1 - this.envSlow; // Honigflut, Lava
    if (this.boostTime > 0) maxV *= 1.38;

    // Längsbewegung
    if (this.boostTime > 0) { if (this.speed < maxV) this.speed = Math.min(maxV, this.speed + 60 * dt); }
    else if (throttle > 0 && this.speed >= -0.5) this.speed += st.accel * throttle * (1 - Math.max(0, this.speed / maxV) * 0.75) * dt;
    if (brake > 0) {
      if (this.speed > 0.5) this.speed -= 38 * brake * dt;
      else this.speed = Math.max(-11, this.speed - 16 * brake * dt);
    }
    if (throttle === 0 && brake === 0) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 9 * dt);
    if (this.speed > maxV) this.speed = Math.max(maxV, this.speed - 32 * dt);

    // Drift
    const d = this.drift;
    const driftPress = inp.drift && !this.prevDrift && racing && this.stun <= 0;
    this.prevDrift = inp.drift;
    if (driftPress && this.grounded) {
      this.vy = 4.2;
      this.grounded = false;
      d.pending = true;
      this.race.audio.hop(this);
      if (this.airTrickReady) this.trick = 0;
    }
    if (driftPress && !this.grounded && this.rampAir && this.trick <= 0) {
      this.trick = 0.6;
      this.trickDone = true;
      this.race.audio.trick(this);
    }
    if (!inp.drift) d.pending = false;
    if (d.pending && this.grounded && inp.drift) {
      if (Math.abs(steer) > 0.25 && this.speed > 11) {
        d.on = true;
        d.dir = Math.sign(steer);
        d.charge = 0;
        d.level = 0;
      }
      d.pending = false;
    }
    if (d.on) {
      if (!inp.drift || this.speed < 8 || this.stun > 0 || !racing) {
        if (d.level > 0 && this.stun <= 0) this.boost(BOOST_TIME[d.level] * st.driftMul, d.level);
        d.on = false;
        d.level = 0;
      } else if (this.grounded) {
        d.charge += dt * (0.8 + 0.7 * Math.max(0, steer * d.dir));
        const lvl = d.charge > DRIFT_LEVELS[2] ? 3 : d.charge > DRIFT_LEVELS[1] ? 2 : d.charge > DRIFT_LEVELS[0] ? 1 : 0;
        if (lvl > d.level) { d.level = lvl; this.race.audio.driftLevel(this, lvl); }
      }
    }

    // Lenkung
    const speedF = Math.min(1, Math.abs(this.speed) / 7);
    let turn;
    if (d.on) turn = d.dir * st.steer * (0.62 + 0.5 * steer * d.dir) * speedF;
    else turn = steer * st.steer * speedF * (this.speed < 0 ? -1 : 1) * (1 - Math.min(0.35, Math.abs(this.speed) / 140));
    if (!this.grounded) turn *= this.glide ? 1.0 : 0.6;
    if (this.cannon) turn = 0;
    this.heading -= turn * dt;
    this.steerVis += ((d.on ? d.dir * 0.6 + steer * 0.4 : steer) - this.steerVis) * Math.min(1, dt * 10);

    // Geschwindigkeit mit Rutschen
    const f = this.forward;
    let g = d.on ? 2.6 : 8.5;
    g *= grip < 1 ? (d.on ? 0.6 : 0.3) : 1;
    if (!this.grounded) g = this.glide ? 2.2 : 0.6;
    if (this.cannon) g = 0;
    const k = 1 - Math.exp(-g * dt);
    this.vel.x += (f.x * this.speed - this.vel.x) * k;
    this.vel.z += (f.z * this.speed - this.vel.z) * k;
    if (this.grounded && !this.cannon) {
      const sl = tr.crossSlope(loc.i, loc.lat);
      if (sl) {
        const R = tr.R[loc.i];
        // Hangabtrieb quer zur Fahrbahn erst mit Tempo (sonst rutschen stehende Karts beim Start weg);
        // in der Halfpipe voll, dort soll man hochfahren und zurueckrollen
        const roll = tr.hp[loc.i] > 0 ? (active ? 1 : 0) : active ? Math.min(1, Math.abs(this.speed) / 12) : 0;
        const a = -sl * 24 * dt * roll;
        this.vel.x += R.x * a; this.vel.z += R.z * a;
        // Über die Halfpipe-Kante: Luftsprung
        if (tr.hp[loc.i] > 0 && Math.abs(loc.lat) > tr.fence[loc.i] - 1.8) {
          const s = Math.sign(loc.lat);
          const vn = (this.vel.x * R.x + this.vel.z * R.z) * s;
          if (vn > 6) {
            this.vy = vn * 0.9;
            this.grounded = false;
            this.rampAir = true;
            this.trickDone = false;
            this.vel.x -= R.x * s * vn * 1.6; this.vel.z -= R.z * s * vn * 1.6;
          }
        }
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // Wetter: Böen und Strömung versetzen seitlich
    if (this.envWind && this.grounded) { const Rw = tr.R[loc.i]; this.pos.x += Rw.x * this.envWind * dt; this.pos.z += Rw.z * this.envWind * dt; }
    // Höhe / Sprung
    tr.locate(this.pos, this.cannon ? -1 : this.trackIdx, loc);
    this.trackIdx = loc.i;
    const gravity = this.glide ? 7 : this.uw || this.race.theme.underwater ? 13 : 26;
    if (this.grounded) {
      if (loc.gap) {
        this.grounded = false;
        this.vy = Math.min(this.vy, 0);
      } else if (this.tryShortcut(loc)) {
        // Kanonen-Abkürzung gestartet
      } else if (tr.launch[loc.i] && Math.abs(loc.lat) < tr.hw[loc.i] && this.speed > 10 && this.launchedAt !== loc.i) {
        this.launchedAt = loc.i;
        const kind = tr.launch[loc.i];
        this.vy = kind === 2 ? 9 + this.speed * 0.16 : kind === 3 ? 8.5 : 5.5 + this.speed * 0.14;
        if (kind >= 2) this.speed = Math.max(this.speed, this.st.maxSpeed * 0.95);
        if (kind === 3) this.glide = true;
        this.grounded = false;
        this.rampAir = true;
        this.trickDone = false;
        this.pos.y = loc.y;
      } else {
        this.pos.y = loc.y;
        this.vy = 0;
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.vy -= gravity * dt;
      if (this.glide) this.vy = Math.max(this.vy, -2.8);
      this.pos.y += this.vy * dt;
      if (this.pos.y <= loc.y && this.vy <= 0) {
        this.pos.y = loc.y;
        this.grounded = true;
        this.glide = false;
        if (this.cannon) {
          this.cannon = null;
          const T = tr.T[loc.i];
          this.heading = Math.atan2(T.x, T.z);
          this.vel.set(T.x * this.speed, 0, T.z * this.speed);
        }
        this.squash = Math.min(0.25, this.airTime * 0.3);
        if (this.rampAir && this.trickDone && this.stun <= 0) this.boost(0.9, 2);
        if (this.airTime > 0.45) this.race.audio.land(this);
        if (this.airTime > 0.3) this.race.impact?.(this, Math.min(1, 0.15 + this.airTime * 0.35));
        this.rampAir = false;
        this.trickDone = false;
        this.airTime = 0;
      }
    }
    if (this.launchedAt !== undefined && Math.abs(loc.i - this.launchedAt) > 4) this.launchedAt = undefined;
    // In eine Lücke gefallen?
    if ((loc.gap && this.pos.y < loc.roadY - 5) || this.pos.y < tr.groundY - 4) { this.race.respawn(this); return; }

    // Bande
    // Insel einer Weggabelung
    const isl = tr.island[loc.i];
    if (isl > 0.3 && Math.abs(loc.lat) < isl + 0.9 && this.pos.y < loc.y + 1.6 && !this.cannon) {
      const R = tr.R[loc.i], s = Math.sign(loc.lat) || 1;
      const push = isl + 0.9 - Math.abs(loc.lat);
      this.pos.x += R.x * s * push; this.pos.z += R.z * s * push;
      const vn = -(this.vel.x * R.x + this.vel.z * R.z) * s;
      if (vn > 0) { this.vel.x += R.x * s * vn * 1.6; this.vel.z += R.z * s * vn * 1.6; if (vn > 7) { this.speed *= 0.85; this.race.audio.bump(this); this.race.impact?.(this, Math.min(0.8, vn / 22)); } }
    }
    const lim = tr.fence[loc.i] - 0.9;
    if (Math.abs(loc.lat) > lim && !this.cannon) {
      const R = tr.R[loc.i];
      const s = Math.sign(loc.lat);
      const over = Math.abs(loc.lat) - lim;
      this.pos.x -= R.x * s * over;
      this.pos.z -= R.z * s * over;
      const vn = this.vel.x * R.x * s + this.vel.z * R.z * s;
      if (vn > 0) {
        this.vel.x -= R.x * s * vn * 1.6;
        this.vel.z -= R.z * s * vn * 1.6;
        if (vn > 7) {
          this.speed *= 0.82;
          this.race.audio.bump(this);
          this.race.impact?.(this, Math.min(0.8, vn / 20));
          this.race.burst(this.pos, '#FFFFFF', 6);
          // Kart von der Bande wegdrehen
          const T = tr.T[loc.i];
          const want = Math.atan2(T.x, T.z);
          let dh = want - this.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          if (Math.abs(dh) < Math.PI / 2) this.heading += dh * 0.35;
        }
      }
    }

    // Windschatten: dicht hinter einem anderen Kart gibt es nach kurzer Zeit einen Turbo
    if (racing && this.grounded && this.speed > 18 && this.boostTime <= 0) {
      let drafting = false;
      for (const o of this.race.karts) {
        if (o === this) continue;
        const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 6 || d2 > 225 || Math.abs(o.pos.y - this.pos.y) > 2) continue;
        const along = dx * f.x + dz * f.z;
        const side = Math.abs(-f.z * dx + f.x * dz);
        if (along > 0 && side < 1.8) { drafting = true; break; }
      }
      this.draft = drafting ? (this.draft || 0) + dt : Math.max(0, (this.draft || 0) - dt * 2);
      if (this.draft > 1.3) {
        this.draft = 0;
        this.boost(1.0, 1);
        if (this.human !== null) this.race.hud.message(this.human, '💨 Windschatten!', 1.2);
      }
      if (this.draft > 0.3 && this.race.fxOn && Math.random() < 0.6) {
        const s = Math.random() < 0.5 ? -1 : 1;
        _v.set(this.pos.x - f.z * s * 1.3 + f.x * 1.5, this.pos.y + 0.8 + Math.random(), this.pos.z + f.x * s * 1.3 + f.z * 1.5);
        this.race.fx.soft.emit(_v, _u.set(-f.x * 25, 0, -f.z * 25), '#FFFFFF', 0.18, 0.25);
      }
    } else this.draft = 0;

    // Falsche Richtung
    if (racing && this.speed > 5) {
      const T = tr.T[loc.i];
      const dot = f.x * T.x + f.z * T.z;
      this.wrongWay = dot < -0.3 ? this.wrongWay + dt : 0;
    } else this.wrongWay = 0;

    // Effekte
    this.emitFx(dt, onRoad);
    this.updateModel(dt);
  }

  // Kanonen-Schanze: fliegt im Bogen zu einem späteren Streckenteil
  tryShortcut(loc) {
    const tr = this.race.track;
    if (!tr.shortcuts || this.speed < 12) return false;
    for (const sc of tr.shortcuts) {
      const di = Math.abs(loc.i - sc.i);
      if (Math.min(di, tr.N - di) > 3 || Math.abs(loc.lat - sc.lat) > 3.2) continue;
      const q = tr.P[sc.j];
      const dx = q.x - this.pos.x, dz = q.z - this.pos.z, d = Math.hypot(dx, dz);
      const v = Math.max(this.speed, 32);
      const t = d / v;
      const g = this.uw ? 13 : 26;
      this.vy = (q.y - this.pos.y) / t + 0.5 * g * t;
      this.vel.set((dx / d) * v, 0, (dz / d) * v);
      this.speed = v;
      this.heading = Math.atan2(dx, dz);
      this.cannon = { j: sc.j };
      this.grounded = false;
      this.rampAir = true;
      this.trickDone = false;
      this.drift.on = false;
      this.race.audio.boost();
      if (this.human !== null) this.race.hud.message(this.human, '🚀 Abkürzung!', 1.2);
      return true;
    }
    return false;
  }

  // Fahrt durch den Looping
  updateRail(dt) {
    const r = this.rail, L = r.L, tr = this.race.track;
    this.speed = Math.max(this.speed, 24);
    r.s += (this.speed * dt) / L.len;
    if (r.s >= 1) {
      loopFrame(L, 1, r.off, this.pos, null, null);
      this.rail = null;
      const i = (L.c + LOOP_LEN) % tr.N;
      const T = tr.T[i];
      this.heading = Math.atan2(T.x, T.z);
      this.visYaw = this.heading;
      this.vel.set(T.x * this.speed, 0, T.z * this.speed);
      this.grounded = true;
      this.trackIdx = i;
      tr.locate(this.pos, i, this.loc);
      this.pos.y = this.loc.y;
      this.model.root.quaternion.identity();
      this.updateModel(dt);
      return;
    }
    loopFrame(L, r.s, r.off, this.pos, _f, _up);
    this.railFwd = _f; this.railUp = _up;
    const idx = L.c + r.s * LOOP_LEN;
    this.trackIdx = Math.floor(idx) % tr.N;
    this.loc.i = this.trackIdx; this.loc.idx = idx % tr.N; this.loc.lat = 0;
    this.vel.copy(_f).multiplyScalar(this.speed);
    this.emitFx(dt, true);
    this.updateModel(dt);
    // Kart an der Bahn ausrichten: x = links, y = oben, z = vorwärts
    _x.crossVectors(_up, _f).normalize();
    _m4.makeBasis(_x, _up, _f);
    this.model.root.quaternion.setFromRotationMatrix(_m4);
    if (this.boostTime > 0) this.boostTime = Math.max(0, this.boostTime - dt);
  }

  emitFx(dt, onRoad) {
    const fx = this.race.fx;
    const m = this.model;
    const d = this.drift;
    if (!this.race.fxOn) return;
    const rand = () => (Math.random() - 0.5);
    if (d.on && this.grounded) {
      const col = DRIFT_COLORS[d.level];
      for (const w of [m.wheels[2], m.wheels[3]]) {
        if (!w) continue;
        w.getWorldPosition(_v);
        _v.y = this.pos.y + 0.15;
        if (this.race.skids) this.race.skids.add(_w.set(_v.x, this.pos.y + 0.05, _v.z), this.visYaw);
        for (let i = 0; i < (d.level ? 3 : 1); i++) {
          fx.glow.emit(_v, _w.set(rand() * 6 - this.vel.x * 0.1, 2 + Math.random() * 3, rand() * 6 - this.vel.z * 0.1), col, d.level ? 0.35 : 0.2, 0.25, { grav: 14 });
        }
      }
    }
    if (this.boostTime > 0 || (this.speed > 2 && Math.random() < 0.3)) {
      for (const e of m.exhausts) {
        e.getWorldPosition(_v);
        const big = this.boostTime > 0;
        const col = big ? (this.boostKind >= 3 ? '#C77DFF' : this.boostKind === 2 ? '#FF9A2B' : '#5FD0FF') : '#BBBBBB';
        const f = this.forward;
        if (big) {
          fx.glow.emit(_v, _w.set(-f.x * 8 + rand() * 2, 1 + rand(), -f.z * 8 + rand() * 2), col, 0.7, 0.22, { grow: 0.3 });
          fx.glow.emit(_v, _w.set(-f.x * 5, 0.5, -f.z * 5), '#FFF2B0', 0.4, 0.15, { grow: 0.2 });
        } else fx.soft.emit(_v, _w.set(-f.x * 2 + rand(), 1.2, -f.z * 2 + rand()), col, 0.25, 0.5, { grow: 2.5 });
      }
    }
    if (!onRoad && this.grounded && this.speed > 6 && Math.random() < 0.6) {
      _v.copy(this.pos);
      _v.y += 0.2;
      fx.soft.emit(_v, _w.set(rand() * 3, 1.5 + Math.random() * 2, rand() * 3), this.race.theme.offroad, 0.6, 0.6, { grav: 3, grow: 2 });
    }
    if (this.stun > 0 && Math.random() < 0.3) {
      _v.copy(this.pos);
      _v.y += 2.4;
      fx.glow.emit(_v, _w.set(rand() * 2, 1, rand() * 2), '#FFE36A', 0.35, 0.6);
    }
  }

  updateModel(dt) {
    const m = this.model;
    const r = m.root;
    r.position.copy(this.pos);
    if (this.shake > 0) r.position.y += Math.sin(this.t * 60) * 0.05;
    // Optische Ausrichtung
    let yaw = this.heading;
    if (this.drift.on) yaw -= this.drift.dir * 0.42;
    let dy = yaw - this.visYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.visYaw += dy * Math.min(1, dt * 12);
    r.rotation.y = this.visYaw + this.spin + (this.trick > 0 ? (1 - this.trick / 0.6) * Math.PI * 2 : 0);
    const slope = this.race.track.slope[this.loc.i ?? 0] || 0;
    const T = this.race.track.T[this.loc.i ?? 0];
    const along = T ? Math.sin(this.visYaw) * T.x + Math.cos(this.visYaw) * T.z : 1;
    const pitch = this.grounded ? -Math.atan(slope * along) : Math.max(-0.4, Math.min(0.4, -this.vy * 0.03));
    r.rotation.x += (pitch - r.rotation.x) * Math.min(1, dt * 10);
    const tr = this.race.track;
    const roll = this.grounded && this.loc.i !== undefined ? Math.atan(tr.crossSlope(this.loc.i, this.loc.lat || 0)) : 0;
    this.rollVis = (this.rollVis || 0) + (roll - (this.rollVis || 0)) * Math.min(1, dt * 10);
    r.rotation.z = this.steerVis * 0.06 * Math.min(1, this.speed / 20) - this.rollVis;
    if (this.wing) { this.wing.visible = !!this.glide; this.wing.rotation.z = -this.steerVis * 0.3; }
    const s = this.small > 0 ? 0.6 : 1;
    this.squash = Math.max(0, this.squash - dt);
    r.scale.set(s * (1 + this.squash * 0.6), s * (1 - this.squash), s * (1 + this.squash * 0.6));

    // Räder
    this.wheelAngle += (this.speed * dt) / 0.32;
    for (const w of m.wheels) w.rotation.x = this.wheelAngle;
    if (m.steerFL) m.steerFL.rotation.y = -this.steerVis * 0.45;
    if (m.steerFR) m.steerFR.rotation.y = -this.steerVis * 0.45;
    if (m.steeringWheel) m.steeringWheel.rotation.y = this.steerVis * 1.2;
    if (m.propeller) m.propeller.rotation.z += dt * (6 + this.speed * 1.2);

    // Fahrer
    if (m.driver) {
      m.driver.rotation.z = this.steerVis * 0.14;
      m.driver.position.y = 0.55 + Math.abs(Math.sin(this.t * 9)) * 0.015 * Math.min(1, this.speed / 10);
    }
    if (m.head) {
      m.head.rotation.y = -this.steerVis * 0.3 + (this.stun > 0 ? Math.sin(this.t * 14) * 0.4 : 0);
      m.head.rotation.z = this.drowsy > 0 ? 0.35 : 0;
    }
    if (m.tail) m.tail.rotation.y = Math.sin(this.t * 7) * 0.35;
    this.blink -= dt;
    const blinking = this.blink < 0.12;
    if (this.blink < 0) this.blink = 2 + Math.random() * 4;
    const closed = blinking || this.stun > 0 || this.drowsy > 0 || this.cheer;
    const dizzy = this.stun > 0;
    if (m.eyesOpen) m.eyesOpen.visible = !closed && !dizzy;
    if (m.eyesClosed) m.eyesClosed.visible = closed && !dizzy;
    if (m.eyesDizzy) m.eyesDizzy.visible = dizzy;
    if (m.mouthOpen) m.mouthOpen.visible = dizzy || this.boostTime > 0;
    if (m.mouthHappy) m.mouthHappy.visible = !(dizzy || this.boostTime > 0);
    const armUp = this.cheer ? -2.4 + Math.sin(this.t * 10) * 0.3 : 0;
    if (m.armL) m.armL.rotation.x += (armUp - m.armL.rotation.x) * Math.min(1, dt * 8);
    if (m.armR) m.armR.rotation.x += ((this.cheer ? -2.4 - Math.sin(this.t * 10) * 0.3 : 0) - m.armR.rotation.x) * Math.min(1, dt * 8);
  }

  setFurVisible(n) {
    for (const s of this.model.shells) s.count = n;
  }

  dispose() {
    this.race.scene.remove(this.model.root);
  }
}
