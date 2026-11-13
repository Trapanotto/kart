// Skid marks: ring buffer of ribbon quads laid on the ground behind sliding wheels. Owner: render.
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicNodeMaterial, type Scene } from 'three/webgpu';
import { attribute, float, saturate, smoothstep, vec3, vec4 } from 'three/tsl';
import { renderTime, type N } from '../shared';

const LIFETIME = 14;

export class SkidMarks {
  readonly mesh: Mesh;
  private pos: Float32Array;
  private info: Float32Array; // per vertex: birth time, strength
  private posAttr: BufferAttribute;
  private infoAttr: BufferAttribute;
  private head = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  readonly capacity: number;
  now = 0;

  constructor(capacity = 3000) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 6 * 3);
    this.info = new Float32Array(capacity * 6 * 2).fill(-1e6);
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.infoAttr = new BufferAttribute(this.info, 2).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('skid', this.infoAttr);
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
    const info: N = attribute('skid', 'vec2');
    const age: N = renderTime.sub(info.x);
    const fade: N = saturate(float(1).sub(smoothstep(LIFETIME * 0.5, LIFETIME, age)));
    m.colorNode = vec4(vec3(0.05, 0.045, 0.04), 1);
    m.opacityNode = info.y.mul(fade).mul(0.42);
    this.mesh = new Mesh(g, m);
    this.mesh.name = 'vfx.skids';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  addTo(scene: Scene) { scene.add(this.mesh); }

  /**
   * Adds one quad from (a0,a1) at the previous position to (b0,b1) now. Each point is the left / right edge of
   * the mark on the ground. `s0`, `s1` = strength at each end (0..1).
   */
  add(
    a0x: number, a0y: number, a0z: number, a1x: number, a1y: number, a1z: number,
    b0x: number, b0y: number, b0z: number, b1x: number, b1y: number, b1z: number, s0: number, s1: number,
  ) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    const p = this.pos, f = this.info, o = i * 18, q = i * 12;
    // tri 1: a0 a1 b0, tri 2: b0 a1 b1
    p[o] = a0x; p[o + 1] = a0y; p[o + 2] = a0z;
    p[o + 3] = a1x; p[o + 4] = a1y; p[o + 5] = a1z;
    p[o + 6] = b0x; p[o + 7] = b0y; p[o + 8] = b0z;
    p[o + 9] = b0x; p[o + 10] = b0y; p[o + 11] = b0z;
    p[o + 12] = a1x; p[o + 13] = a1y; p[o + 14] = a1z;
    p[o + 15] = b1x; p[o + 16] = b1y; p[o + 17] = b1z;
    const t = this.now;
    f[q] = t; f[q + 1] = s0; f[q + 2] = t; f[q + 3] = s0; f[q + 4] = t; f[q + 5] = s1;
    f[q + 6] = t; f[q + 7] = s1; f[q + 8] = t; f[q + 9] = s0; f[q + 10] = t; f[q + 11] = s1;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  flush() {
    if (this.dirtyMax < 0) return;
    const a = this.dirtyMin, n = this.dirtyMax - this.dirtyMin + 1;
    this.posAttr.clearUpdateRanges(); this.posAttr.addUpdateRange(a * 18, n * 18); this.posAttr.needsUpdate = true;
    this.infoAttr.clearUpdateRanges(); this.infoAttr.addUpdateRange(a * 12, n * 12); this.infoAttr.needsUpdate = true;
    this.dirtyMin = Infinity; this.dirtyMax = -1;
  }

  clear() {
    this.info.fill(-1e6);
    this.dirtyMin = 0; this.dirtyMax = this.capacity - 1;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicNodeMaterial).dispose();
  }
}
