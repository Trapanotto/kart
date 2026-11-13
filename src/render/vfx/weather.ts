// Camera-following weather volumes: petals, rain, snow, pollen, fireflies. Owner: render.
// Fully GPU-animated: each instance has a static random seed; position wraps inside a box around the camera.
import {
  AdditiveBlending, InstancedBufferAttribute, Mesh, NormalBlending, PlaneGeometry, SpriteNodeMaterial, type Scene,
} from 'three/webgpu';
import {
  abs, atan, cameraPosition, cameraViewMatrix, cos, float as float_, fract, instancedBufferAttribute, length, mix, mod, pow,
  saturate, sin, smoothstep, uniform, uv, vec2 as vec2_, vec3 as vec3_, vec4 as vec4_,
} from 'three/tsl';
import { renderTime, skyColor, sunColor, windDirection, windStrength, smoothstepInv, type N } from '../shared';
const vec2: N = vec2_, vec3: N = vec3_, vec4: N = vec4_, float: N = float_;

export type WeatherKind = 'petals' | 'rain' | 'snow' | 'pollen' | 'fireflies';

interface Preset {
  count: number;
  box: [number, number, number];
  /** Fall speed (m/s, positive down). */
  fall: number;
  wind: number;
  size: number;
  color: [number, number, number];
  additive: boolean;
  /** 0 soft disc, 1 streak, 2 petal, 3 glow. */
  shape: number;
  sway: number;
}

const PRESETS: Record<WeatherKind, Preset> = {
  petals: { count: 500, box: [50, 22, 50], fall: 0.9, wind: 1.6, size: 0.16, color: [1.0, 0.62, 0.75], additive: false, shape: 2, sway: 0.9 },
  rain: { count: 4500, box: [36, 20, 36], fall: 16, wind: 1.5, size: 0.035, color: [0.7, 0.78, 0.9], additive: false, shape: 1, sway: 0 },
  snow: { count: 2600, box: [40, 22, 40], fall: 1.4, wind: 0.9, size: 0.09, color: [1, 1, 1], additive: false, shape: 0, sway: 0.6 },
  pollen: { count: 700, box: [36, 14, 36], fall: -0.05, wind: 0.5, size: 0.05, color: [1.6, 1.4, 0.7], additive: true, shape: 3, sway: 0.8 },
  fireflies: { count: 220, box: [50, 8, 50], fall: 0, wind: 0.1, size: 0.22, color: [2.6, 3.2, 0.9], additive: true, shape: 3, sway: 1.6 },
};

export const WEATHER_KINDS = Object.keys(PRESETS) as WeatherKind[];

export class Weather {
  private mesh: Mesh | null = null;
  private kind: WeatherKind | null = null;
  private density = 1;
  readonly intensity: N = uniform(1);

  constructor(private scene: Scene) {}

  get current() { return this.kind; }

  set(kind: string | undefined | null, density: number) {
    const k = (kind && kind in PRESETS ? kind : null) as WeatherKind | null;
    if (k === this.kind && density === this.density) return;
    this.dispose();
    this.kind = k; this.density = density;
    if (!k) return;
    this.mesh = build(PRESETS[k], density, this.intensity);
    this.mesh.name = 'vfx.weather.' + k;
    this.scene.add(this.mesh);
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as SpriteNodeMaterial).dispose();
    this.mesh = null;
    this.kind = null;
  }
}

function build(p: Preset, density: number, intensity: N): Mesh {
  const count = Math.max(16, Math.round(p.count * density));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
  const seedAttr = new InstancedBufferAttribute(seeds, 4);
  const S: N = instancedBufferAttribute(seedAttr);

  const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
  mat.blending = p.additive ? AdditiveBlending : NormalBlending;
  const box: N = vec3(p.box[0], p.box[1], p.box[2]);
  const t: N = renderTime;
  const speedVar: N = S.w.mul(0.5).add(0.75);
  const drift: N = vec3(windDirection.x, 0, windDirection.z).mul(windStrength.mul(p.wind).mul(t));
  const fall: N = vec3(0, float(-p.fall).mul(speedVar).mul(t), 0);
  const swayAmt = p.sway;
  const ph: N = S.x.mul(40).add(S.z.mul(23));
  const sway: N = vec3(sin(t.mul(0.9).add(ph)), sin(t.mul(0.7).add(ph.mul(1.3))).mul(0.5), cos(t.mul(0.8).add(ph))).mul(swayAmt);
  const local: N = S.xyz.mul(box).add(drift).add(fall).add(sway).sub(cameraPosition);
  const wrapped: N = mod(local, box).sub(box.mul(0.5));
  const world: N = cameraPosition.add(wrapped);
  mat.positionNode = world;

  const dist: N = length(wrapped.xz);
  const edge: N = float(1).sub(smoothstep(float(p.box[0] * 0.32), float(p.box[0] * 0.5), dist));
  const vEdge: N = edge.mul(float(1).sub(smoothstep(float(p.box[1] * 0.35), float(p.box[1] * 0.5), abs(wrapped.y))));

  if (p.shape === 1) {
    // Rain: streaks along the fall velocity in screen space.
    const vel: N = vec3(windDirection.x.mul(windStrength).mul(p.wind), float(-p.fall).mul(speedVar), windDirection.z.mul(windStrength).mul(p.wind));
    const vv: N = (cameraViewMatrix as N).mul(vec4(vel, 0)).xy;
    mat.rotationNode = atan(vv.y, vv.x);
    mat.scaleNode = vec2(float(p.size * 22).mul(saturate(length(vv).div(p.fall)).add(0.2)), p.size);
  } else if (p.shape === 2) {
    mat.rotationNode = t.mul(S.y.sub(0.5).mul(4)).add(S.x.mul(6.28));
    const flip: N = abs(cos(t.mul(S.z.add(0.5).mul(2.5)).add(ph))).mul(0.7).add(0.3);
    mat.scaleNode = vec2(p.size * 1.4, float(p.size).mul(flip));
  } else {
    mat.scaleNode = vec2(float(p.size).mul(S.w.mul(0.6).add(0.7)));
  }

  const q: N = uv().mul(2).sub(1);
  const r: N = length(q);
  let alpha: N;
  if (p.shape === 1) alpha = pow(saturate(float(1).sub(length(q.mul(vec2(1, 2))))), 1.5).mul(0.45);
  else if (p.shape === 2) alpha = smoothstepInv(0.8, 1, length(q.mul(vec2(0.75, 1.5))));
  else if (p.shape === 3) alpha = pow(saturate(float(1).sub(r)), 2.5);
  else alpha = smoothstepInv(0.35, 1, r);

  const base: N = vec3(p.color[0], p.color[1], p.color[2]);
  if (p.additive) {
    // Fireflies / pollen blink.
    const blink: N = p.sway > 1 ? pow(sin(t.mul(S.y.mul(2).add(0.8)).add(ph)).mul(0.5).add(0.5), 3) : float(0.8);
    mat.colorNode = vec4(base.mul(alpha).mul(blink).mul(vEdge).mul(intensity), 1);
  } else {
    const lit: N = skyColor.mul(0.5).add(sunColor.mul(0.7));
    const col: N = p.shape === 1 ? base.mul(skyColor.mul(0.6).add(0.5)) : base.mul(lit);
    mat.colorNode = vec4(mix(col, base, 0.3), 1);
    mat.opacityNode = saturate(alpha.mul(vEdge).mul(intensity));
  }
  void fract;

  const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
  (mesh as N).count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  return mesh;
}
