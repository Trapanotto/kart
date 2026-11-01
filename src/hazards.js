// Hindernisse auf der Strecke (Modelle aus Blender)
import * as THREE from 'three';
import { landmarkClone } from './assets.js';

const MODEL = { log: 'Log', snowball: 'Snowball', crab: 'Crab', barrel: 'Barrel', vent: 'Vent', bumper: 'GlowShroom' };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Hazards {
  constructor(race) {
    this.race = race;
    this.list = [];
    const tr = race.track;
    for (const d of tr.def.hazards || []) {
      const mesh = landmarkClone(MODEL[d.type]);
      if (!mesh) continue;
      const i = Math.round(d.f * tr.N) % tr.N;
      const h = { ...d, i, mesh, phase: Math.random() * 10, pos: new THREE.Vector3(), idx: i, r: 1.4, cool: 0 };
      if (d.type === 'log') h.r = 1.1;
      if (d.type === 'snowball') { h.r = 1.9; h.idx = i + 70; }
      if (d.type === 'crab') { h.r = 1.6; mesh.scale.setScalar(1.2); }
      if (d.type === 'barrel') h.r = 1.2;
      if (d.type === 'vent') h.r = 2.6;
      if (d.type === 'bumper') { h.r = 1.5; mesh.scale.setScalar(1.3); }
      race.scene.add(mesh);
      this.list.push(h);
      this.place(h, 0);
    }
  }

  place(h, t) {
    const tr = this.race.track;
    const hw = tr.hw[h.i];
    let lat = (h.lat || 0) * hw;
    let idx = h.i;
    switch (h.type) {
      case 'log': lat = Math.sin(t * 0.9 + h.phase) * (hw - 1.5); break;
      case 'crab': lat = Math.sin(t * 0.7 + h.phase) * (hw - 1.8); break;
      case 'barrel': { // schnelles Hin- und Herrutschen mit Pausen
        const c = (t * 0.45 + h.phase) % 2;
        const s = c < 1 ? Math.min(1, c * 2.5) : Math.max(0, 1 - (c - 1) * 2.5);
        lat = (s * 2 - 1) * (hw - 1.4);
        break;
      }
      case 'snowball': idx = h.idx; lat = Math.sin(h.phase) * (hw - 2); break;
    }
    tr.pointAt(idx, lat, h.pos);
    const ii = ((Math.floor(idx) % tr.N) + tr.N) % tr.N;
    h.pos.y += tr.bump[ii];
    h.mesh.position.copy(h.pos);
    const head = tr.headingAt(idx);
    h.mesh.rotation.set(0, head, 0);
    if (h.type === 'log') h.mesh.rotation.y = head + Math.PI / 2;
    if (h.type === 'crab') h.mesh.rotation.y = head + Math.sin(t * 6) * 0.15;
  }

  update(dt) {
    const race = this.race, tr = race.track, t = race.clock;
    for (const h of this.list) {
      if (h.type === 'snowball') {
        h.idx -= dt * 7; // rollt der Fahrtrichtung entgegen
        if (h.idx < h.i - 10) { h.idx = h.i + 70; h.phase = Math.random() * 6; }
      }
      this.place(h, t);
      h.cool = Math.max(0, h.cool - dt);
      // Lava-Schlot: Warnung, dann Ausbruch
      let active = true;
      if (h.type === 'vent') {
        const c = (t + h.phase) % 4.5;
        const warn = c > 2.6 && c < 3.6, erupt = c >= 3.6;
        active = erupt;
        if (race.fxOn && (warn || erupt) && Math.random() < (erupt ? 1 : 0.3)) {
          for (let n = 0; n < (erupt ? 4 : 1); n++) {
            _v.copy(h.pos).add(_w.set((Math.random() - 0.5) * 2, 0.3, (Math.random() - 0.5) * 2));
            race.fx.glow.emit(_v, _w.set((Math.random() - 0.5) * 3, erupt ? 12 + Math.random() * 8 : 3, (Math.random() - 0.5) * 3),
              erupt ? (Math.random() < 0.5 ? '#FF6A1A' : '#FFD447') : '#FF6A1A', erupt ? 0.9 : 0.4, erupt ? 0.9 : 0.6, { grav: 10, grow: 1.5 });
          }
        }
      }
      if (!active) continue;
      for (const k of race.karts) {
        if (Math.abs(k.pos.y - h.pos.y) > 3) continue;
        let dx = k.pos.x - h.pos.x, dz = k.pos.z - h.pos.z;
        let rr = h.r + 1.0;
        if (h.type === 'log') {
          // Stamm liegt längs der Strecke: Abstand zur Linie messen
          const T = tr.T[h.i];
          const along = Math.max(-2.6, Math.min(2.6, dx * T.x + dz * T.z));
          dx -= T.x * along; dz -= T.z * along;
        }
        const d2 = dx * dx + dz * dz;
        if (d2 > rr * rr) continue;
        if (h.type === 'bumper') {
          // abprallen
          const d = Math.sqrt(d2) || 0.01;
          const nx = dx / d, nz = dz / d;
          k.pos.x += nx * (rr - d); k.pos.z += nz * (rr - d);
          const vn = k.vel.x * nx + k.vel.z * nz;
          if (vn < 0) { k.vel.x -= nx * vn * 2.2; k.vel.z -= nz * vn * 2.2; k.speed *= 0.7; }
          if (h.cool <= 0) { race.audio.boing(k); h.cool = 0.3; h.mesh.scale.setScalar(1.6); }
        } else if (k.stun <= 0) {
          k.hit(h.type === 'snowball' ? 1.2 : 1);
        }
      }
      if (h.type === 'bumper') h.mesh.scale.setScalar(Math.max(1.3, h.mesh.scale.x - dt * 2));
    }
  }

  dispose() { for (const h of this.list) this.race.scene.remove(h.mesh); }
}
