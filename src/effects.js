// Partikel: Drift-Funken, Boost-Flammen, Staub, Sterne, Umgebung (Schnee, Blasen, Glut ...)
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 3000, additive = true) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 }, uGain: { value: additive ? 2.6 : 1 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vC; varying float vA; uniform float uScale;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; varying float vA; uniform float uGain;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.15, r) * vA; gl_FragColor = vec4(vC * uGain, a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.tmpC = new THREE.Color();
  }

  emit(p, v, color, size, life, { grav = 0, grow = 1, drag = 0 } = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    const c = typeof color === 'string' || typeof color === 'number' ? this.tmpC.set(color) : color;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = size; this.s1[i] = size * grow;
    this.grav[i] = grav; this.drag[i] = drag;
    this.size[i] = size; this.alpha[i] = 1;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const j = --this.n;
        if (i !== j) this.copy(j, i);
        continue;
      }
      const k = 1 - this.drag[i] * dt;
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) this.geo.attributes[a].needsUpdate = true;
  }

  copy(from, to) {
    for (const arr of [this.pos, this.col, this.vel]) for (let c = 0; c < 3; c++) arr[to * 3 + c] = arr[from * 3 + c];
    for (const arr of [this.size, this.alpha, this.life, this.maxLife, this.s0, this.s1, this.grav, this.drag]) arr[to] = arr[from];
  }

  clear() { this.n = 0; }
}

// Umgebungs-Partikel rund um die Kamera
export class Ambient {
  constructor(fx, type) {
    this.fx = fx;
    this.type = type;
    this.acc = 0;
    this.v = new THREE.Vector3();
    this.p = new THREE.Vector3();
  }
  update(dt, center) {
    if (!this.type) return;
    const rate = { snow: 140, bubbles: 50, embers: 70, fireflies: 30, petals: 25, leaves: 25, pollen: 40, sparkles: 40 }[this.type] || 0;
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc -= 1;
      const p = this.p.set(center.x + (Math.random() - 0.5) * 120, center.y + Math.random() * 30, center.z + (Math.random() - 0.5) * 120);
      const v = this.v;
      switch (this.type) {
        case 'snow': v.set(Math.random() - 0.5, -3, Math.random() - 0.5); this.fx.soft.emit(p.setY(center.y + 25), v, '#ffffff', 0.35, 8); break;
        case 'bubbles': v.set(0, 2.5 + Math.random() * 2, 0); this.fx.soft.emit(p.setY(center.y - 2), v, '#CFF6FF', 0.4 + Math.random() * 0.4, 7); break;
        case 'embers': v.set((Math.random() - 0.5) * 2, 2 + Math.random() * 3, (Math.random() - 0.5) * 2); this.fx.glow.emit(p.setY(center.y), v, '#FF7A2A', 0.3, 5); break;
        case 'fireflies': v.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5), (Math.random() - 0.5) * 1.5); this.fx.glow.emit(p.setY(center.y + Math.random() * 6), v, '#C8FF6A', 0.35, 4); break;
        case 'petals': v.set(1 + Math.random(), -1.2, Math.random() - 0.5); this.fx.soft.emit(p.setY(center.y + 18), v, '#FFB3CF', 0.35, 9); break;
        case 'leaves': v.set(1 + Math.random(), -1.5, Math.random() - 0.5); this.fx.soft.emit(p.setY(center.y + 18), v, '#9BD84E', 0.4, 9); break;
        case 'pollen': v.set((Math.random() - 0.5), 0.3, (Math.random() - 0.5)); this.fx.glow.emit(p.setY(center.y + Math.random() * 8), v, '#FFE27A', 0.25, 5); break;
        case 'sparkles': v.set(0, 0.5, 0); this.fx.glow.emit(p, v, '#FFFFFF', 0.3, 2.5); break;
      }
    }
  }
}

// Reifenspuren beim Driften (Ringspeicher)
export class Skids {
  constructor(scene, max = 2400) {
    const geo = new THREE.PlaneGeometry(0.34, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#2A2228', transparent: true, opacity: 0.32, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.max = max;
    this.i = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3(1, 1, 1);
    this.up = new THREE.Vector3(0, 1, 0);
  }
  add(pos, yaw) {
    this.q.setFromAxisAngle(this.up, yaw);
    this.m.compose(pos, this.q, this.s);
    this.mesh.setMatrixAt(this.i % this.max, this.m);
    this.i++;
    this.mesh.count = Math.min(this.i, this.max);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}