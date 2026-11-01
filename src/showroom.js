// 3D-Hintergrund der Menüs: Karussell, Fahrerauswahl, Siegerpodest
import * as THREE from 'three';
import { CHARACTERS } from './data.js';
import { createKartModel, FUR } from './assets.js';

export class Showroom {
  constructor(app) {
    this.app = app;
    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color('#BFE3FF');
    s.fog = new THREE.Fog('#BFE3FF', 30, 80);
    s.environment = app.envMap;
    s.environmentIntensity = 0.9;
    s.add(new THREE.HemisphereLight('#FFFFFF', '#9ED36A', 1.4));
    const sun = new THREE.DirectionalLight('#FFF4E0', 2.4);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -12; sc.right = sc.top = 12;
    s.add(sun);
    // Boden: Wiese mit Bühne
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), new THREE.MeshStandardMaterial({ color: '#8ED081', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    this.stage = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.4, 0.4, 48), new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5 }));
    this.stage.position.y = 0.2;
    this.stage.receiveShadow = true;
    s.add(this.stage);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.12, 8, 64), new THREE.MeshStandardMaterial({ color: '#FFD447' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    s.add(ring);
    // Konfetti-Ballons im Hintergrund
    const cols = ['#FF8FA3', '#FFD447', '#7EC8F2', '#9ED36A', '#B59CFF'];
    for (let i = 0; i < 26; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: cols[i % 5], roughness: 0.3 }));
      const a = (i / 26) * Math.PI * 2;
      b.position.set(Math.cos(a) * (18 + (i % 3) * 4), 3 + (i % 4) * 1.5, Math.sin(a) * (18 + (i % 3) * 4) - 6);
      b.scale.y = 1.2;
      b.userData.phase = i;
      s.add(b);
      (this.balloons ||= []).push(b);
    }
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.models = {};
    this.group = new THREE.Group();
    s.add(this.group);
    this.pedestals = new THREE.Group();
    s.add(this.pedestals);
    this.t = 0;
    this.mode = 'title';
    this.setMode('title');
  }

  model(id, key = id) {
    if (!this.models[key]) {
      const m = createKartModel(id, { fur: this.app.settings.fur });
      for (const sh of m.shells) sh.count = FUR.layers;
      this.models[key] = m;
    }
    return this.models[key];
  }

  clear() {
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    this.pedestals.visible = false;
    this.active = [];
  }

  setMode(mode, data) {
    this.clear();
    this.mode = mode;
    this.stage.visible = mode !== 'podium';
    if (mode === 'title') {
      CHARACTERS.forEach((c, i) => {
        const m = this.model(c.id);
        const a = (i / CHARACTERS.length) * Math.PI * 2;
        m.root.position.set(Math.sin(a) * 3.1, 0.4, Math.cos(a) * 3.1);
        m.root.rotation.set(0, a + Math.PI / 2, 0);
        m.root.scale.setScalar(1);
        this.group.add(m.root);
        this.active.push(m);
      });
    } else if (mode === 'select') {
      this.show(data || CHARACTERS[0].id);
    } else if (mode === 'podium') {
      this.buildPodium(data);
    }
    this.resetCamera();
  }

  show(id) {
    if (this.mode !== 'select') return;
    if (this.current === id && this.group.children.length) return;
    this.clear();
    this.current = id;
    const m = this.model(id);
    m.root.position.set(0, 0.4, 0);
    m.root.rotation.set(0, -0.6, 0);
    m.root.scale.setScalar(0.01);
    this.group.add(m.root);
    this.active = [m];
    this.pop = 0;
  }

  buildPodium(ids) {
    this.pedestals.visible = true;
    while (this.pedestals.children.length) this.pedestals.remove(this.pedestals.children[0]);
    const spots = [[0, 2.4, '#FFD447', '1'], [-3.4, 1.6, '#D8DDE4', '2'], [3.4, 1.0, '#E3A36A', '3']];
    ids.slice(0, 3).forEach((id, i) => {
      const [x, h, col] = spots[i];
      const p = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }));
      p.position.set(x, h / 2, 0);
      p.castShadow = p.receiveShadow = true;
      this.pedestals.add(p);
      const m = this.model(id, id + '_podium');
      m.root.position.set(x, h, 0);
      m.root.rotation.set(0, 0, 0);
      m.root.scale.setScalar(1);
      m.cheer = true;
      this.group.add(m.root);
      this.active.push(m);
    });
  }

  resetCamera() {
    if (this.mode === 'title') { this.camera.position.set(0, 3.2, 11.5); this.look = new THREE.Vector3(0, 1.0, 0); }
    if (this.mode === 'select') { this.camera.position.set(2.2, 2.4, 6.4); this.look = new THREE.Vector3(-1.1, 1.0, 0); }
    if (this.mode === 'podium') { this.camera.position.set(0, 5, 13); this.look = new THREE.Vector3(0, 2.6, 0); }
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    for (const b of this.balloons) b.position.y += Math.sin(t + b.userData.phase) * 0.003;
    if (this.mode === 'title') {
      this.group.rotation.y = t * 0.18;
    }
    if (this.mode === 'select' && this.active[0]) {
      const r = this.active[0].root;
      this.pop = Math.min(1, this.pop + dt * 4);
      const e = 1 + Math.sin(this.pop * Math.PI) * 0.12;
      r.scale.setScalar(this.pop * e);
      r.rotation.y = -0.6 + Math.sin(t * 0.5) * 0.5;
    }
    for (const m of this.active) {
      if (m.tail) m.tail.rotation.y = Math.sin(t * 6) * 0.35;
      if (m.propeller) m.propeller.rotation.z += dt * 8;
      const blink = (t * 0.7 + m.root.position.x) % 3 < 0.08;
      const closed = blink || m.cheer;
      if (m.eyesOpen) m.eyesOpen.visible = !closed;
      if (m.eyesClosed) m.eyesClosed.visible = closed;
      if (m.head) m.head.rotation.y = Math.sin(t * 0.8 + m.root.position.x) * 0.2;
      if (m.cheer) {
        if (m.armL) m.armL.rotation.x = -2.4 + Math.sin(t * 9) * 0.3;
        if (m.armR) m.armR.rotation.x = -2.4 - Math.sin(t * 9) * 0.3;
        if (m.driver) m.driver.position.y = 0.55 + Math.abs(Math.sin(t * 5)) * 0.15;
      } else {
        if (m.armL) m.armL.rotation.x = 0;
        if (m.armR) m.armR.rotation.x = 0;
      }
    }
    if (this.mode === 'podium') {
      this.camera.position.x = Math.sin(t * 0.3) * 4;
    }
    this.camera.lookAt(this.look);
  }

  render(renderer) {
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setViewport(0, 0, size.x, size.y);
    this.camera.aspect = size.x / size.y;
    if (this.mode === 'select') {
      // Breit: Kart rechts neben dem Menü. Schmal: Kart unten.
      const wide = this.camera.aspect > 1.15;
      this.camera.position.set(wide ? 2.6 : 0.8, wide ? 2.4 : 3.6, wide ? 6.8 : 8.5);
      this.look.set(wide ? -1.6 : 0, wide ? 1.0 : 2.6, 0);
      this.camera.lookAt(this.look);
    }
    // Auf schmalen Bildschirmen weiter weg
    this.camera.zoom = Math.min(1, this.camera.aspect / 1.1);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
