// Kart: Arcade-Fahrphysik, Drift, Boost, Treffer, Animation des Fahrers
import * as THREE from 'three';
import { ROAD_HALF } from './data.js';
import { FENCE } from './track.js';
import { createKartModel } from './assets.js';

const DRIFT_LEVELS = [0.9, 1.8, 2.8];
const DRIFT_COLORS = ['#FFFFFF', '#4FC3FF', '#FF9A2B', '#C77DFF'];
const BOOST_TIME = [0, 0.6, 1.05, 1.6];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();

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
  }

  hit(strength = 1) {
    if (this.finished) return false;
    if (this.shield > 0) {
      this.shield = 0;
      this.race.audio.pop(this);
      this.race.burst(this.pos, '#CFF6FF', 14);
      return false;
    }
    this.stun = 1.15 * strength * this.st.stunMul;
    this.spin = 0;
    this.speed *= 0.25;
    this.drift.on = false;
    this.drift.pending = false;
    this.boostTime = 0;
    this.shake = 0.4;
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

    for (const k of ['boostTime', 'honey', 'drowsy', 'small', 'shield', 'trick']) if (this[k] > 0) this[k] = Math.max(0, this[k] - dt);
    if (this.stun > 0) { this.stun -= dt; this.spin += dt * 11; } else this.spin *= 0.85;
    if (this.shake > 0) this.shake -= dt;
    if (this.cloud > 0) {
      this.cloud -= dt;
      if (this.cloud <= 0) {
        this.race.items.zap(this);
      }
    }

    tr.locate(this.pos, this.trackIdx, this.loc);
    const loc = this.loc;
    this.trackIdx = loc.i;
    const onRoad = Math.abs(loc.lat) <= ROAD_HALF + 0.6;
    const grip = this.char.iceGrip ? 1 : tr.grip[loc.i];

    // Höchstgeschwindigkeit
    let maxV = st.maxSpeed * this.rubber;
    if (!onRoad && this.boostTime <= 0 && this.grounded) maxV *= this.race.theme.volcano ? 0.42 : 0.5;
    if (this.honey > 0) maxV *= 0.45;
    if (this.drowsy > 0) maxV *= 0.55;
    if (this.small > 0) maxV *= 0.72;
    if (this.cloud > 0) maxV *= 1.06;
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
    if (!this.grounded) turn *= 0.6;
    this.heading -= turn * dt;
    this.steerVis += ((d.on ? d.dir * 0.6 + steer * 0.4 : steer) - this.steerVis) * Math.min(1, dt * 10);

    // Geschwindigkeit mit Rutschen
    const f = this.forward;
    let g = d.on ? 2.6 : 8.5;
    g *= grip < 1 ? (d.on ? 0.6 : 0.3) : 1;
    if (!this.grounded) g = 0.6;
    const k = 1 - Math.exp(-g * dt);
    this.vel.x += (f.x * this.speed - this.vel.x) * k;
    this.vel.z += (f.z * this.speed - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Höhe / Sprung
    tr.locate(this.pos, this.trackIdx, loc);
    this.trackIdx = loc.i;
    const gravity = this.race.theme.underwater ? 15 : 26;
    if (this.grounded) {
      if (tr.launch[loc.i] && Math.abs(loc.lat) < ROAD_HALF && this.speed > 10 && this.launchedAt !== loc.i) {
        this.launchedAt = loc.i;
        this.vy = 5.5 + this.speed * 0.14;
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
      this.pos.y += this.vy * dt;
      if (this.pos.y <= loc.y && this.vy <= 0) {
        this.pos.y = loc.y;
        this.grounded = true;
        this.squash = Math.min(0.25, this.airTime * 0.3);
        if (this.rampAir && this.trickDone && this.stun <= 0) this.boost(0.9, 2);
        if (this.airTime > 0.45) this.race.audio.land(this);
        this.rampAir = false;
        this.trickDone = false;
        this.airTime = 0;
      }
    }
    if (this.launchedAt !== undefined && Math.abs(loc.i - this.launchedAt) > 4) this.launchedAt = undefined;

    // Bande
    const lim = FENCE - 0.9;
    if (Math.abs(loc.lat) > lim) {
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
    r.rotation.z = this.steerVis * 0.06 * Math.min(1, this.speed / 20);
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
    if (m.eyesOpen) m.eyesOpen.visible = !closed;
    if (m.eyesClosed) m.eyesClosed.visible = closed;
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
