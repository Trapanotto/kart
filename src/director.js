// Kameraregie für den Startbildschirm: wechselnde Einstellungen über ein laufendes Rennen
// (Verfolger, Stossstange, seitlich, von vorn, Streckenrand, Luftaufnahme, Umkreisen, Drohne).
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();

// Gewichtung der Einstellungen
const SHOTS = [['chase', 3], ['bumper', 2], ['side', 2], ['front', 2], ['trackside', 3], ['aerial', 2], ['orbit', 1.5], ['drone', 2]];

export class Director {
  constructor(race) {
    this.race = race;
    this.cam = race.cams[0];
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.last = null;
    this.next();
  }

  // Kart mit der meisten Action: viele andere Karts in der Nähe, gern weit vorn
  pickKart() {
    const ks = this.race.karts;
    let best = ks[0], score = -Infinity;
    for (const k of ks) {
      let s = Math.random() * 2 - k.rank * 0.3;
      for (const o of ks) if (o !== k && o.pos.distanceToSquared(k.pos) < 600) s += 1;
      if (score < s) { score = s; best = k; }
    }
    return best;
  }

  next() {
    const total = SHOTS.reduce((s, x) => s + (x[0] === this.last ? 0 : x[1]), 0);
    let x = Math.random() * total, shot = SHOTS[0][0];
    for (const [n, w] of SHOTS) { if (n === this.last) continue; if ((x -= w) <= 0) { shot = n; break; } }
    this.shot = this.last = shot;
    this.t = 0;
    this.dur = 4.5 + Math.random() * 3;
    this.k = this.pickKart();
    this.side = Math.random() < 0.5 ? -1 : 1;
    this.angle = Math.random() * Math.PI * 2;
    this.cut = true;
    const tr = this.race.track, k = this.k;
    if (shot === 'trackside') {
      // fester Standpunkt ein Stück voraus am Rand, die Karts rauschen vorbei
      const i = Math.round(k.trackIdx + 22 + Math.random() * 10) % tr.N;
      this.fixIdx = i;
      this.fixPos = tr.pointAt(i, this.side * (tr.fence[i] + 2.5)).add(new THREE.Vector3(0, 1.8 + Math.random() * 1.5, 0));
      this.dur = 6.5;
    }
    if (shot === 'drone') this.droneIdx = k.trackIdx + 14;
  }

  update(dt) {
    const race = this.race, tr = race.track, c = this.cam, k = this.k;
    this.t += dt;
    if (this.t > this.dur || !k) this.next();
    _f.set(Math.sin(k.heading), 0, Math.cos(k.heading));
    _r.set(_f.z, 0, -_f.x);
    let follow = 10, fov = 60;
    const P = k.pos;
    switch (this.shot) {
      case 'chase':
        _p.copy(P).addScaledVector(_f, -8).addScaledVector(UP, 3.2);
        _l.copy(P).addScaledVector(_f, 5).addScaledVector(UP, 1);
        fov = 62; follow = 8;
        break;
      case 'bumper':
        _p.copy(P).addScaledVector(_f, -3.4).addScaledVector(UP, 1.1);
        _l.copy(P).addScaledVector(_f, 14).addScaledVector(UP, 0.8);
        fov = 78; follow = 18;
        break;
      case 'side':
        _p.copy(P).addScaledVector(_r, this.side * 5.5).addScaledVector(_f, 1.5).addScaledVector(UP, 1.3);
        _l.copy(P).addScaledVector(_f, 1).addScaledVector(UP, 0.8);
        fov = 52; follow = 10;
        break;
      case 'front':
        _p.copy(P).addScaledVector(_f, 7.5).addScaledVector(UP, 1.7).addScaledVector(_r, this.side * 1.2);
        _l.copy(P).addScaledVector(UP, 0.9);
        fov = 50; follow = 10;
        break;
      case 'trackside': {
        _p.copy(this.fixPos);
        _l.copy(P).addScaledVector(UP, 0.8);
        const d = _p.distanceTo(_l);
        fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(7 / Math.max(1, d))), 22, 62);
        follow = 100;
        // vorbeigefahren und weit weg: weiter zur nächsten Einstellung
        const ahead = ((k.trackIdx - this.fixIdx + tr.N * 1.5) % tr.N) - tr.N / 2;
        if (ahead > 12 && this.t > 2.5) this.t = this.dur;
        break;
      }
      case 'aerial':
        _p.copy(P).addScaledVector(_f, -20).addScaledVector(UP, 19).addScaledVector(_r, this.side * 6);
        _l.copy(P).addScaledVector(_f, 12);
        fov = 55; follow = 1.6;
        break;
      case 'orbit':
        this.angle += dt * 0.45 * this.side;
        _p.copy(P).add(_l.set(Math.cos(this.angle) * 9, 3.2, Math.sin(this.angle) * 9));
        _l.copy(P).addScaledVector(UP, 1);
        fov = 50; follow = 12;
        break;
      case 'drone': {
        // fliegt dem Feld voraus und schaut zurück
        const target = k.trackIdx + 14;
        let d = target - this.droneIdx;
        if (d < -tr.N / 2) d += tr.N;
        if (d > tr.N / 2) d -= tr.N;
        this.droneIdx += d * Math.min(1, dt * 1.5);
        tr.pointAt(this.droneIdx, 0, _p).addScaledVector(UP, 11);
        _l.copy(P).addScaledVector(UP, 0.5);
        fov = 58; follow = 6;
        break;
      }
    }
    if (this.cut) { this.pos.copy(_p); this.look.copy(_l); this.cut = false; }
    else {
      const a = 1 - Math.exp(-dt * follow);
      this.pos.lerp(_p, a);
      this.look.lerp(_l, 1 - Math.exp(-dt * Math.max(follow, 8)));
    }
    // nicht unter die Fahrbahn tauchen
    const loc = tr.locate(this.pos, k.trackIdx);
    if (loc && Number.isFinite(loc.y) && Math.abs(loc.lat) < tr.fence[loc.i] + 4) this.pos.y = Math.max(this.pos.y, loc.y + 0.7);
    c.cam.position.copy(this.pos);
    if (c.shake > 0.01) {
      const a = c.shake * c.shake * 0.3, t = race.clock;
      c.cam.position.x += Math.sin(t * 61) * a; c.cam.position.y += Math.sin(t * 47 + 1) * a;
      c.shake *= Math.exp(-dt * 5);
    }
    c.cam.lookAt(this.look);
    c.fov += (fov - c.fov) * Math.min(1, dt * 3);
    if (this.t < dt * 1.5) c.fov = fov;
    c.k = k; // Tempo-Unschärfe folgt dem gezeigten Kart
  }
}
