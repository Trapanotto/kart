// Authored one-shot effects on top of the particle pools. Owner: render.
import { Color, type Scene, type Vector3 } from 'three/webgpu';
import type { VfxApi } from '../../core/types';
import { blankSpec, ParticlePool, Shape, type ParticleSpec } from './particles';

const rnd = Math.random;
const range = (a: number, b: number) => a + (b - a) * rnd();

/** Tier colours for drift sparks: charging (no tier yet), blue, orange, purple. Linear HDR. */
export const DRIFT_COLORS: [number, number, number][] = [
  [2.2, 2.2, 2.4],
  [0.35, 1.0, 3.6],
  [3.6, 1.3, 0.25],
  [2.4, 0.45, 3.8],
];

export const EFFECT_NAMES = [
  'burst', 'dust', 'splash', 'sparks', 'confetti', 'smoke', 'leaves', 'stars', 'break.hay', 'break.crate', 'pickup',
  'shield.pop', 'honey.splat', 'zap',
] as const;

const CONFETTI = ['#ff5f8f', '#ffd447', '#4fd6a0', '#58b4ff', '#c78bff', '#ff9a3c'].map((c) => new Color(c)); // hex strings are converted to linear by ColorManagement

export class Effects implements VfxApi {
  soft: ParticlePool;
  glow: ParticlePool;
  private scene: Scene | null = null;
  private softParticles = true;
  private s: ParticleSpec = blankSpec();
  private colorCache = new Map<string, Color>();
  private dirTmp = { x: 0, y: 1, z: 0 };

  constructor(density: number, softParticles = true) {
    this.softParticles = softParticles;
    this.soft = new ParticlePool(4096, false, 'vfx.soft', softParticles);
    this.glow = new ParticlePool(4096, true, 'vfx.glow', softParticles);
    this.setDensity(density);
  }

  addTo(scene: Scene) { this.scene = scene; this.soft.addTo(scene); this.glow.addTo(scene); }

  /** Soft particles read the scene depth (one depth copy per frame); off on the mobile tier. */
  setSoftParticles(on: boolean) {
    if (on === this.softParticles) return;
    const d = this.density;
    this.soft.dispose(); this.glow.dispose();
    this.softParticles = on;
    this.soft = new ParticlePool(4096, false, 'vfx.soft', on);
    this.glow = new ParticlePool(4096, true, 'vfx.glow', on);
    this.setDensity(d);
    if (this.scene) this.addTo(this.scene);
  }

  setDensity(d: number) { this.soft.density = d; this.glow.density = d; }
  get density() { return this.soft.density; }

  setTime(t: number) { this.soft.now = t; this.glow.now = t; }

  flush() { this.soft.flush(); this.glow.flush(); }

  clear() { this.soft.clear(); this.glow.clear(); }

  dispose() { this.soft.dispose(); this.glow.dispose(); }

  color(c: string | undefined, fallback: string): Color {
    const key = c ?? fallback;
    let col = this.colorCache.get(key);
    if (!col) { col = new Color(key); this.colorCache.set(key, col); }
    return col;
  }

  /** Number of particles to emit for a nominal count, scaled by density (at least 1 if n > 0). */
  n(count: number): number {
    const v = count * this.soft.density;
    const i = Math.floor(v);
    return i + (rnd() < v - i ? 1 : 0);
  }

  /** Resets the scratch spec at a position and returns it. */
  spec(x: number, y: number, z: number): ParticleSpec {
    const s = this.s;
    s.x = x; s.y = y; s.z = z; s.vx = 0; s.vy = 0; s.vz = 0; s.life = 1; s.r = 1; s.g = 1; s.b = 1;
    s.shape = Shape.Puff; s.size0 = 0.5; s.size1 = 1; s.gravity = 0; s.drag = 0; s.rot = rnd() * 6.28; s.spin = 0;
    s.stretch = 0; s.opacity = 1; s.delay = 0;
    return s;
  }

  /** Random unit-ish vector in the upper hemisphere biased by `dir` (spread 0..1). */
  private velocity(s: ParticleSpec, speed: number, spread: number, d: { x: number; y: number; z: number }) {
    let x = d.x + (rnd() * 2 - 1) * spread, y = d.y + (rnd() * 2 - 1) * spread, z = d.z + (rnd() * 2 - 1) * spread;
    const l = Math.hypot(x, y, z) || 1;
    const v = speed * range(0.6, 1.2);
    x /= l; y /= l; z /= l;
    s.vx = x * v; s.vy = y * v; s.vz = z * v;
  }

  spawn(name: string, pos: Vector3, opts?: { dir?: Vector3; color?: string; scale?: number }): void {
    const sc = opts?.scale ?? 1;
    const d = this.dirTmp;
    if (opts?.dir) { d.x = opts.dir.x; d.y = opts.dir.y; d.z = opts.dir.z; } else { d.x = 0; d.y = 1; d.z = 0; }
    const { x, y, z } = pos;
    switch (name) {
      case 'dust': return this.dust(x, y, z, sc, opts?.color);
      case 'splash': return this.splash(x, y, z, sc);
      case 'sparks': return this.sparks(x, y, z, sc, d, opts?.color);
      case 'confetti': return this.confetti(x, y, z, sc);
      case 'smoke': return this.smoke(x, y, z, sc, opts?.color);
      case 'leaves': return this.leaves(x, y, z, sc);
      case 'stars': return this.stars(x, y, z, sc);
      case 'break.hay': return this.debris(x, y, z, sc, '#e8c766', '#c9a23f', Shape.Blade, true);
      case 'break.crate': return this.debris(x, y, z, sc, '#b07a45', '#7d5330', Shape.Confetti, false);
      case 'pickup': return this.pickup(x, y, z, sc, opts?.color);
      case 'shield.pop': return this.shieldPop(x, y, z, sc, opts?.color);
      case 'honey.splat': return this.honey(x, y, z, sc);
      case 'zap': return this.zap(x, y, z, sc, opts?.color);
      case 'respawn': return this.respawnSparkle(x, y, z, sc);
      case 'burst':
      default: return this.burst(x, y, z, sc, opts?.color);
    }
  }

  // ------------------------------------------------------------------ named effects

  burst(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#fff3c4');
    const n = this.n(18 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y, z);
      this.velocity(s, 7 * sc, 1, this.dirTmp);
      s.life = range(0.35, 0.6); s.r = c.r * 3; s.g = c.g * 3; s.b = c.b * 3;
      s.shape = Shape.Spark; s.size0 = 0.18 * sc; s.size1 = 0.05 * sc; s.drag = 3; s.gravity = 4; s.stretch = 1.2;
      this.glow.emit(s);
    }
    const s = this.spec(x, y, z);
    s.life = 0.25; s.r = c.r * 2; s.g = c.g * 2; s.b = c.b * 2; s.shape = Shape.Glow; s.size0 = 1.2 * sc; s.size1 = 2.6 * sc;
    this.glow.emit(s);
    this.puffRing(x, y, z, sc * 0.8, 8, '#ffffff', 0.6);
  }

  dust(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#d9c29a');
    const n = this.n(10 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x + range(-0.4, 0.4) * sc, y + 0.1, z + range(-0.4, 0.4) * sc);
      this.velocity(s, 2.2 * sc, 1, this.dirTmp);
      s.vy = Math.abs(s.vy) * 0.6;
      s.life = range(0.8, 1.5); s.r = c.r; s.g = c.g; s.b = c.b;
      s.size0 = 0.5 * sc; s.size1 = range(1.4, 2.0) * sc; s.drag = 2.2; s.gravity = -0.3; s.spin = range(-1, 1); s.opacity = 0.75;
      this.soft.emit(s);
    }
  }

  splash(x: number, y: number, z: number, sc: number) {
    const n = this.n(26 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y, z);
      const a = rnd() * 6.283;
      const h = range(3, 7) * sc;
      const out = range(1.5, 4) * sc;
      s.vx = Math.cos(a) * out; s.vz = Math.sin(a) * out; s.vy = h;
      s.life = range(0.5, 0.9); s.r = 0.75; s.g = 0.9; s.b = 1.0;
      s.shape = Shape.Drop; s.size0 = 0.16 * sc; s.size1 = 0.1 * sc; s.gravity = 14; s.stretch = 1.5; s.opacity = 0.85;
      this.soft.emit(s);
    }
    this.puffRing(x, y, z, sc, 10, '#e8f6ff', 0.55);
    const s = this.spec(x, y + 0.05, z);
    s.life = 0.45; s.r = 1; s.g = 1; s.b = 1; s.shape = Shape.Ring; s.size0 = 0.6 * sc; s.size1 = 3 * sc; s.opacity = 0.7;
    this.soft.emit(s);
  }

  sparks(x: number, y: number, z: number, sc: number, d: { x: number; y: number; z: number }, color?: string) {
    const c = this.color(color, '#ffc35a');
    const n = this.n(22 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y, z);
      this.velocity(s, 9 * sc, 0.9, d);
      s.life = range(0.25, 0.55); s.r = c.r * 4; s.g = c.g * 4; s.b = c.b * 4;
      s.shape = Shape.Spark; s.size0 = 0.12 * sc; s.size1 = 0.04 * sc; s.gravity = 12; s.drag = 1.5; s.stretch = 2.2;
      this.glow.emit(s);
    }
    const s = this.spec(x, y, z);
    s.life = 0.12; s.r = c.r * 4; s.g = c.g * 4; s.b = c.b * 4; s.shape = Shape.Glow; s.size0 = 0.9 * sc; s.size1 = 1.4 * sc;
    this.glow.emit(s);
  }

  confetti(x: number, y: number, z: number, sc: number) {
    const n = this.n(60 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y, z);
      this.velocity(s, 8 * sc, 0.7, this.dirTmp);
      const c = CONFETTI[i % CONFETTI.length];
      s.life = range(1.6, 2.6); s.r = c.r; s.g = c.g; s.b = c.b;
      s.shape = Shape.Confetti; s.size0 = 0.22 * sc; s.size1 = 0.2 * sc; s.gravity = 5; s.drag = 1.6; s.spin = range(-8, 8);
      this.soft.emit(s);
    }
  }

  smoke(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#b4b8c0');
    const n = this.n(12 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x + range(-0.3, 0.3), y + range(0, 0.4), z + range(-0.3, 0.3));
      this.velocity(s, 1.2 * sc, 0.6, this.dirTmp);
      s.life = range(1.4, 2.4); s.r = c.r; s.g = c.g; s.b = c.b;
      s.size0 = 0.6 * sc; s.size1 = range(2.0, 3.0) * sc; s.gravity = -1.2; s.drag = 1.2; s.spin = range(-0.6, 0.6); s.opacity = 0.7;
      s.delay = rnd() * 0.15;
      this.soft.emit(s);
    }
  }

  leaves(x: number, y: number, z: number, sc: number) {
    const n = this.n(24 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x + range(-0.5, 0.5), y + range(0, 1), z + range(-0.5, 0.5));
      this.velocity(s, 4 * sc, 0.9, this.dirTmp);
      const g = range(0.25, 0.55);
      s.life = range(1.8, 3); s.r = g * 0.6; s.g = g; s.b = g * 0.25;
      s.shape = Shape.Leaf; s.size0 = 0.28 * sc; s.size1 = 0.26 * sc; s.gravity = 2.2; s.drag = 2.4; s.spin = range(-4, 4);
      this.soft.emit(s);
    }
  }

  stars(x: number, y: number, z: number, sc: number) {
    // Cartoon "dizzy" stars: a ring of stars bursting up and orbiting outward.
    const n = Math.max(5, this.n(7 * sc));
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y + 1.2 * sc, z);
      const a = (i / n) * 6.283 + rnd() * 0.4;
      s.vx = Math.cos(a) * 3 * sc; s.vz = Math.sin(a) * 3 * sc; s.vy = range(2.5, 4) * sc;
      s.life = range(0.8, 1.1); s.r = 3.2; s.g = 2.6; s.b = 0.6;
      s.shape = Shape.Star; s.size0 = 0.5 * sc; s.size1 = 0.25 * sc; s.gravity = 6; s.drag = 2.5; s.spin = range(-6, 6);
      this.glow.emit(s);
    }
  }

  private debris(x: number, y: number, z: number, sc: number, ca: string, cb: string, shape: Shape, dusty: boolean) {
    const a = this.color(ca, ca), b = this.color(cb, cb);
    const n = this.n(36 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x + range(-0.4, 0.4), y + range(0.2, 1), z + range(-0.4, 0.4));
      this.velocity(s, 7 * sc, 1, this.dirTmp);
      s.vy = Math.abs(s.vy) + 2;
      const c = i & 1 ? a : b;
      s.life = range(0.9, 1.6); s.r = c.r; s.g = c.g; s.b = c.b;
      s.shape = shape; s.size0 = (shape === Shape.Blade ? 0.45 : 0.3) * sc; s.size1 = s.size0 * 0.8;
      s.gravity = 12; s.drag = 1; s.spin = range(-10, 10);
      this.soft.emit(s);
    }
    if (dusty) this.dust(x, y, z, sc * 1.3, '#e9d79a');
    else this.smoke(x, y, z, sc * 0.6, '#b9a58c');
  }

  pickup(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#ffd447');
    const n = this.n(24 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y, z);
      const a = (i / n) * 6.283;
      s.vx = Math.cos(a) * 6 * sc; s.vz = Math.sin(a) * 6 * sc; s.vy = range(0, 3);
      s.life = range(0.35, 0.55); s.r = c.r * 3; s.g = c.g * 3; s.b = c.b * 3;
      s.shape = i % 3 === 0 ? Shape.Star : Shape.Glow; s.size0 = 0.35 * sc; s.size1 = 0.05; s.drag = 4; s.spin = 4;
      this.glow.emit(s);
    }
    const s = this.spec(x, y, z);
    s.life = 0.3; s.r = c.r * 2; s.g = c.g * 2; s.b = c.b * 2; s.shape = Shape.Ring; s.size0 = 0.8 * sc; s.size1 = 4 * sc;
    this.glow.emit(s);
  }

  shieldPop(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#9fe6ff');
    for (let k = 0; k < 2; k++) {
      const s = this.spec(x, y + 0.8, z);
      s.life = 0.3 + k * 0.1; s.r = c.r * 1.4; s.g = c.g * 1.4; s.b = c.b * 1.4; s.shape = Shape.Ring;
      s.size0 = 1.6 * sc; s.size1 = (3.2 + k * 1.2) * sc; s.delay = k * 0.06;
      this.glow.emit(s);
    }
    const n = this.n(30 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y + 0.8, z);
      this.velocity(s, 6 * sc, 1.3, this.dirTmp);
      s.life = range(0.5, 0.9); s.r = 0.85; s.g = 0.95; s.b = 1;
      s.shape = Shape.Drop; s.size0 = 0.14 * sc; s.size1 = 0.08 * sc; s.gravity = 6; s.drag = 1.5; s.stretch = 1; s.opacity = 0.8;
      this.soft.emit(s);
    }
  }

  honey(x: number, y: number, z: number, sc: number) {
    const n = this.n(20 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x, y + 0.2, z);
      this.velocity(s, 4.5 * sc, 1, this.dirTmp);
      s.vy = Math.abs(s.vy) + 2;
      s.life = range(0.6, 1); s.r = 1.0; s.g = 0.55; s.b = 0.06;
      s.shape = Shape.Drop; s.size0 = 0.3 * sc; s.size1 = 0.18 * sc; s.gravity = 14; s.drag = 0.8; s.stretch = 0.8;
      this.soft.emit(s);
    }
    const s = this.spec(x, y + 0.7 * sc, z);
    s.life = 0.45; s.r = 1; s.g = 0.6; s.b = 0.1; s.shape = Shape.Puff; s.size0 = 0.8 * sc; s.size1 = 1.8 * sc; s.opacity = 0.85;
    this.soft.emit(s);
  }

  zap(x: number, y: number, z: number, sc: number, color?: string) {
    const c = this.color(color, '#9ad8ff');
    const n = this.n(28 * sc);
    for (let i = 0; i < n; i++) {
      const s = this.spec(x + range(-0.6, 0.6), y + range(0.2, 1.6), z + range(-0.6, 0.6));
      this.velocity(s, 10 * sc, 1.5, this.dirTmp);
      s.life = range(0.12, 0.3); s.r = c.r * 5; s.g = c.g * 5; s.b = c.b * 5;
      s.shape = Shape.Spark; s.size0 = 0.12 * sc; s.size1 = 0.1 * sc; s.drag = 6; s.stretch = 3;
      this.glow.emit(s);
    }
    for (let k = 0; k < 3; k++) {
      const s = this.spec(x, y + 0.8, z);
      s.life = 0.15; s.r = c.r * 4; s.g = c.g * 4; s.b = c.b * 4; s.shape = Shape.Glow; s.size0 = 2.5 * sc; s.size1 = 1 * sc; s.delay = k * 0.09;
      this.glow.emit(s);
    }
  }

  respawnSparkle(x: number, y: number, z: number, sc: number) {
    const n = this.n(40 * sc);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, r = range(0.4, 1.4);
      const s = this.spec(x + Math.cos(a) * r, y + range(0, 0.5), z + Math.sin(a) * r);
      s.vy = range(1.5, 4); s.vx = -Math.sin(a) * 1.5; s.vz = Math.cos(a) * 1.5;
      s.life = range(0.7, 1.2); s.r = 2.4; s.g = 2.2; s.b = 3.2;
      s.shape = i % 4 === 0 ? Shape.Star : Shape.Glow; s.size0 = 0.25 * sc; s.size1 = 0.02; s.drag = 1; s.spin = 3; s.delay = rnd() * 0.3;
      this.glow.emit(s);
    }
  }

  /** Flat ring of puffs on the ground (landings, impacts). */
  puffRing(x: number, y: number, z: number, sc: number, count: number, color: string, opacity: number) {
    const c = this.color(color, color);
    const n = this.n(count);
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * 6.283 + rnd() * 0.3;
      const s = this.spec(x, y + 0.15, z);
      const v = range(3, 5) * sc;
      s.vx = Math.cos(a) * v; s.vz = Math.sin(a) * v; s.vy = range(0.2, 0.8);
      s.life = range(0.6, 1.0); s.r = c.r; s.g = c.g; s.b = c.b;
      s.size0 = 0.45 * sc; s.size1 = 1.3 * sc; s.drag = 4; s.gravity = -0.4; s.opacity = opacity;
      this.soft.emit(s);
    }
  }
}
