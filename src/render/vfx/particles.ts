// GPU-animated, instanced particle pool. Owner: render.
//
// Every particle is fully described at spawn (position, velocity, life, colour, size curve, gravity, drag,
// spin, stretch, shape). The vertex shader evaluates its motion analytically from the spawn time, so the CPU
// only writes a ring-buffer slot when something spawns: no per-frame per-particle work, no allocations.
// One pool = one draw call. Two pools are used: soft alpha-blended (lit puffs, confetti, leaves) and additive
// glow (sparks, flames, stars, streaks).
import {
  AdditiveBlending, InstancedBufferAttribute, Mesh, NormalBlending, PlaneGeometry, SpriteNodeMaterial,
  DynamicDrawUsage, type Scene,
} from 'three/webgpu';
import {
  abs, atan, cameraViewMatrix, cos, dot, exp, float, instancedBufferAttribute, length, max, min, mix, normalize, pow,
  saturate, select, sin, smoothstep, sqrt, uv, varying, vec2, vec3, vec4, mx_noise_float, cameraNear, cameraFar,
  perspectiveDepthToViewZ, viewportDepthTexture,
} from 'three/tsl';
import { renderTime, skyColor, sunColor, sunDirection, smoothstepInv, type N } from '../shared';

/** Fragment shapes. */
export const enum Shape {
  Puff = 0,
  Spark = 1,
  Glow = 2,
  Star = 3,
  Confetti = 4,
  Leaf = 5,
  Drop = 6,
  Ring = 7,
  Blade = 8,
  Flake = 9,
}

export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  r: number; g: number; b: number;
  shape: Shape;
  size0: number; size1: number;
  /** m/s², positive pulls down, negative rises. */
  gravity: number;
  /** 1/s exponential velocity damping. */
  drag: number;
  rot: number; spin: number;
  /** Elongation along the screen-space velocity (sparks, rain, streaks). */
  stretch: number;
  opacity: number;
  /** Spawn delay (s). */
  delay: number;
}

export function blankSpec(): ParticleSpec {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, r: 1, g: 1, b: 1, shape: Shape.Puff, size0: 0.5, size1: 1, gravity: 0, drag: 0, rot: 0, spin: 0, stretch: 0, opacity: 1, delay: 0 };
}

export class ParticlePool {
  readonly mesh: Mesh;
  readonly capacity: number;
  private head = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  private attrs: InstancedBufferAttribute[];
  private a: Float32Array[];
  /** Current time used for spawn timestamps (set by the owner each frame). */
  now = 0;
  /** Spawns scaled by this (quality density). */
  density = 1;

  constructor(capacity: number, additive: boolean, name: string, softParticles = true) {
    this.capacity = capacity;
    this.a = [0, 1, 2, 3, 4].map(() => new Float32Array(capacity * 4));
    // Mark all as long dead.
    for (let i = 0; i < capacity; i++) { this.a[0][i * 4 + 3] = -1e6; this.a[1][i * 4 + 3] = 1; }
    this.attrs = this.a.map((arr) => { const at = new InstancedBufferAttribute(arr, 4); at.setUsage(DynamicDrawUsage); return at; });
    const [A, B, C, D, E] = this.attrs.map((at) => instancedBufferAttribute(at) as N);

    const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
    mat.blending = additive ? AdditiveBlending : NormalBlending;

    const t: N = renderTime.sub(A.w);
    const life: N = B.w;
    const age: N = t.div(life);
    const alive: N = age.greaterThanEqual(0).and(age.lessThan(1));
    const drag: N = max(D.w, 0.0001);
    const decay: N = float(1).sub(exp(drag.negate().mul(t))).div(drag);
    const g: N = D.z;
    const pos: N = A.xyz.add(B.xyz.mul(decay)).add(vec3(0, g.mul(-0.5).mul(t).mul(t), 0));
    const vel: N = B.xyz.mul(exp(drag.negate().mul(t))).add(vec3(0, g.negate().mul(t), 0));
    const size: N = mix(D.x, D.y, saturate(age));
    const vView: N = cameraViewMatrix.mul(vec4(vel, 0)).xy;
    const vLen: N = length(vView);
    const stretch: N = E.z;
    const elong: N = float(1).add(stretch.mul(vLen).mul(0.05));
    const rotVel: N = atan(vView.y, vView.x);
    const rot: N = select(stretch.greaterThan(0), rotVel, E.x.add(E.y.mul(t)));
    const shape: N = C.w;
    // Confetti / leaves flip: scale one axis with a sine so they tumble.
    const flip: N = select(shape.equal(Shape.Confetti).or(shape.equal(Shape.Leaf)), abs(cos(E.x.mul(3).add(t.mul(E.y).mul(1.7)))).mul(0.8).add(0.2), float(1));
    mat.positionNode = pos;
    mat.scaleNode = select(alive, vec2(size.mul(elong), size.mul(flip)), vec2(0));
    mat.rotationNode = rot;

    const vAge: N = varying(saturate(age));
    const vCol: N = varying(C.xyz);
    const vShape: N = varying(shape);
    const vOpacity: N = varying(E.w);
    const vSeed: N = varying(A.w.mul(17.31).fract());
    // Soft particles: billboards face the camera, so the centre's view depth is the depth of every fragment.
    const vDepth: N = varying(cameraViewMatrix.mul(vec4(pos, 1)).z.negate());
    const vSize: N = varying(size);
    let soft: N = float(1);
    if (softParticles) {
      const sceneDist: N = perspectiveDepthToViewZ(viewportDepthTexture().x, cameraNear, cameraFar).negate();
      soft = saturate(sceneDist.sub(vDepth).div(max(vSize.mul(0.35), 0.05)));
    }

    const p: N = uv().mul(2).sub(1);
    const r: N = length(p);
    // Fade in fast, out smoothly.
    const fade: N = smoothstep(0, 0.08, vAge).mul(float(1).sub(smoothstep(0.55, 1, vAge)));

    // --- shape alphas
    const puffN: N = mx_noise_float(vec3(p.mul(2.2), vSeed.mul(10).add(vAge))).mul(0.25);
    const puff: N = smoothstepInv(0.35, 1, r.add(puffN));
    const spark: N = pow(saturate(float(1).sub(length(p.mul(vec2(1, 2.2))))), 1.5);
    const glow: N = pow(saturate(float(1).sub(r)), 2.2);
    const ang: N = atan(p.y, p.x);
    const starR: N = cos(ang.mul(5)).mul(0.22).add(0.62);
    const star: N = smoothstepInv(starR.sub(0.04), starR.add(0.06), r);
    const confetti: N = smoothstepInv(0.85, 1, max(abs(p.x), abs(p.y).mul(1.6)));
    const leaf: N = smoothstepInv(0.8, 1, length(p.mul(vec2(0.75, 1.9))));
    const drop: N = pow(saturate(float(1).sub(length(p.mul(vec2(1, 2.4))))), 1.2);
    const ring: N = smoothstepInv(0.0, 0.22, abs(r.sub(0.75)));
    const blade: N = smoothstepInv(0.0, 0.25, abs(p.y.add(p.x.mul(p.x).mul(0.15)))).mul(smoothstepInv(0.6, 1, abs(p.x)));
    const flake: N = smoothstepInv(0.4, 1, r);

    const s: N = vShape;
    let alpha: N = puff;
    alpha = select(s.equal(Shape.Spark), spark, alpha);
    alpha = select(s.equal(Shape.Glow), glow, alpha);
    alpha = select(s.equal(Shape.Star), star, alpha);
    alpha = select(s.equal(Shape.Confetti), confetti, alpha);
    alpha = select(s.equal(Shape.Leaf), leaf, alpha);
    alpha = select(s.equal(Shape.Drop), drop, alpha);
    alpha = select(s.equal(Shape.Ring), ring, alpha);
    alpha = select(s.equal(Shape.Blade), blade, alpha);
    alpha = select(s.equal(Shape.Flake), flake, alpha);

    let col: N;
    if (additive) {
      // Hot core, colour cools toward red/dim over life for sparks and flames.
      const core: N = smoothstep(0.5, 1, alpha).mul(0.6);
      const cool: N = mix(vec3(1), vec3(1, 0.45, 0.3), vAge.mul(select(s.equal(Shape.Spark).or(s.equal(Shape.Glow)), float(0.6), float(0))));
      col = vCol.mul(cool).add(vec3(core));
      mat.colorNode = vec4(col.mul(alpha).mul(fade).mul(vOpacity).mul(soft), 1);
      // Additive: alpha unused, colour premultiplied by alpha above.
      mat.opacityNode = float(1);
    } else {
      // Fake-lit sprite: sphere normal for puffs, flat-ish for cards.
      const nz: N = sqrt(saturate(float(1).sub(r.mul(r))));
      const nSphere: N = normalize(vec3(p.x, p.y.negate(), nz.add(0.2)));
      const sunV: N = normalize(cameraViewMatrix.mul(vec4(sunDirection, 0)).xyz);
      const lamb: N = saturate(dot(nSphere, sunV).mul(0.6).add(0.4));
      const isPuff: N = s.equal(Shape.Puff).or(s.equal(Shape.Flake));
      const light: N = select(isPuff, skyColor.mul(0.55).add(sunColor.mul(lamb).mul(0.75)), skyColor.mul(0.35).add(sunColor.mul(0.8)));
      col = vCol.mul(light);
      // Drops / rain / flakes are self-coloured, slightly emissive.
      col = select(s.equal(Shape.Drop), vCol.mul(0.9).add(sunColor.mul(0.15)), col);
      mat.colorNode = vec4(col, 1);
      mat.opacityNode = saturate(alpha.mul(fade).mul(vOpacity).mul(soft));
      mat.alphaTest = 0.003;
    }
    void min; void sin;

    this.mesh = new Mesh(new PlaneGeometry(1, 1), mat);
    this.mesh.name = name;
    (this.mesh as N).count = capacity;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
  }

  addTo(scene: Scene) { scene.add(this.mesh); }

  emit(s: ParticleSpec): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const o = i * 4;
    const [A, B, C, D, E] = this.a;
    A[o] = s.x; A[o + 1] = s.y; A[o + 2] = s.z; A[o + 3] = this.now + s.delay;
    B[o] = s.vx; B[o + 1] = s.vy; B[o + 2] = s.vz; B[o + 3] = Math.max(0.01, s.life);
    C[o] = s.r; C[o + 1] = s.g; C[o + 2] = s.b; C[o + 3] = s.shape;
    D[o] = s.size0; D[o + 1] = s.size1; D[o + 2] = s.gravity; D[o + 3] = s.drag;
    E[o] = s.rot; E[o + 1] = s.spin; E[o + 2] = s.stretch; E[o + 3] = s.opacity;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Uploads the slots written since the last flush. Call once per frame. */
  flush(): void {
    if (this.dirtyMax < 0) return;
    const start = this.dirtyMin * 4, count = (this.dirtyMax - this.dirtyMin + 1) * 4;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      at.addUpdateRange(start, count);
      at.needsUpdate = true;
    }
    this.dirtyMin = Infinity; this.dirtyMax = -1;
  }

  /** Kills every live particle (race change). */
  clear(): void {
    const A = this.a[0];
    for (let i = 0; i < this.capacity; i++) A[i * 4 + 3] = -1e6;
    this.dirtyMin = 0; this.dirtyMax = this.capacity - 1;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as SpriteNodeMaterial).dispose();
  }
}
