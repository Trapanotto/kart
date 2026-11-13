// Shared material helpers for every team. Owner: render.
//
// All helpers return ordinary three.js node materials (WebGPU + WebGL2 fallback), so they work with shadows,
// fog, environment lighting and the post pipeline without extra wiring. Animated helpers read the shared
// uniforms in ./shared (render time, sun, wind), which the renderer updates every frame.
//
// API (all options optional unless noted):
//
//   toonPBR({ color, map, normalMap, roughness, metalness, rim, rimColor, sss, sssColor, saturation })
//     -> MeshStandardNodeMaterial. Characters, karts, props. Soft fresnel rim light, a subtle
//        subsurface / backlight glow (fur, ears, leaves) and a gentle albedo saturation lift.
//
//   windSway({ strength, frequency, height, flutter })  -> position node
//     Vertex wind for foliage. Assign to `material.positionNode`. Works on Mesh and InstancedMesh
//     (per-instance phase from the instanced position). `height` = metres over which the sway goes from 0
//     at the model origin to full at the top. Uses the global wind (windDirection / windStrength).
//   applyWind(material, opts) -> material   (sets positionNode = windSway(opts))
//
//   stylizedWater({ shallow, deep, foam, depthRange, foamWidth, waveScale, speed, opacity, sceneDepth })
//     -> MeshStandardNodeMaterial (transparent). Depth tint and shoreline foam from the scene depth buffer
//        (sceneDepth: true, default), animated analytic normals. With sceneDepth: false (cheap / mobile) the
//        tint uses a fresnel term and foam uses vertex colour R (paint 1 at shorelines) if present.
//        Put it on a flat mesh, Y up. `material.userData.flow` is a vec2 uniform for the current direction.
//        Recommended: sceneDepth: ctx.quality.tier !== 'mobile' (the depth read costs a depth copy per frame).
//
//   roadMaterial({ color, map, normalMap, ormMap, detailNormal, detailScale, wetness, repeat })
//     -> MeshStandardNodeMaterial with `material.userData.wetness` (uniform 0..1): darker albedo,
//        lower roughness and a flatter normal when wet. `detailNormal` is tiled `detailScale` times
//        faster than the base for close-up grain.
//
//   emissivePulse(material, { color, intensity, speed, phase })  -> material
//     Adds a pulsing emissive glow (boost pads, item boxes). Values above 1 feed the bloom.
//     `material.userData.pulse` is the intensity uniform, so it can be animated or switched off.
//
//   uvScroll(speed: [u, v]) -> uv node scrolled by render time (conveyor belts, honey flow, boost pad arrows).
//
// Shared uniforms re-exported from ./shared: renderTime, sunDirection, sunColor, skyColor, windDirection,
// windStrength.

import { Color, MeshStandardNodeMaterial, Vector2, type Texture } from 'three/webgpu';
import {
  cameraFar, cameraNear, cameraPosition, clamp, cos, dot, float, fract, max, mix, mx_noise_float, normalize,
  normalView, normalWorld, positionGeometry, positionLocal, positionView, positionWorld, perspectiveDepthToViewZ,
  pow, saturate, sin, smoothstep, texture, transformNormalToView, uniform, uv, vec2, vec3, vertexColor,
  viewportDepthTexture, luminance, normalMap as normalMapNode,
} from 'three/tsl';
import { renderTime, skyColor, sunColor, sunDirection, windDirection, windStrength, smoothstepInv, type N } from './shared';

export { renderTime, sunDirection, sunColor, skyColor, windDirection, windStrength } from './shared';

type ColorLike = string | number | Color;

const toColor = (c: ColorLike | undefined, fallback: string) => new Color(c ?? fallback);

// ---------------------------------------------------------------------------------------------
// Toon-leaning PBR
// ---------------------------------------------------------------------------------------------

export interface ToonOptions {
  color?: ColorLike;
  map?: Texture | null;
  normalMap?: Texture | null;
  roughness?: number;
  metalness?: number;
  /** Rim light strength, default 0.35. */
  rim?: number;
  /** Rim colour, default: sky colour tinted white. */
  rimColor?: ColorLike;
  /** Subsurface / backlight strength, default 0.25. 0 = off. */
  sss?: number;
  /** Subsurface colour, default warm. */
  sssColor?: ColorLike;
  /** Albedo saturation multiplier, default 1.12. */
  saturation?: number;
}

export function toonPBR(o: ToonOptions = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: o.roughness ?? 0.65, metalness: o.metalness ?? 0 });
  const base: N = uniform(toColor(o.color, '#ffffff'));
  let albedo: N = o.map ? texture(o.map).rgb.mul(base) : base;
  const sat = o.saturation ?? 1.12;
  if (sat !== 1) albedo = mix(vec3(luminance(albedo)), albedo, sat).max(0);
  m.colorNode = albedo;
  if (o.map) m.map = o.map; // keeps uv transform / colour space handling for the texture
  if (o.normalMap) { m.normalMap = o.normalMap; }

  const V: N = normalize(cameraPosition.sub(positionWorld));
  const Nw: N = normalWorld;
  const ndv: N = saturate(dot(Nw, V));
  // Rim: fresnel, stronger on the lit side so it reads as a soft wrap of sky light.
  const rimAmt = o.rim ?? 0.35;
  const rimCol: N = o.rimColor ? uniform(toColor(o.rimColor, '#ffffff')) : mix(skyColor, vec3(1), 0.5);
  const lit: N = saturate(dot(Nw, sunDirection).mul(0.5).add(0.5));
  // Fade the rim on downward-facing surfaces so contact areas stay grounded.
  const upMask: N = smoothstep(-0.5, 0.5, Nw.y).mul(0.85).add(0.15);
  const rim: N = pow(float(1).sub(ndv), 3).mul(rimAmt).mul(lit.mul(0.7).add(0.3)).mul(upMask);
  // Subsurface: light coming through thin parts when the sun is behind the surface.
  const sssAmt = o.sss ?? 0.25;
  const sssCol: N = uniform(toColor(o.sssColor, '#ff9a6a'));
  const back: N = pow(saturate(dot(V, sunDirection.negate())), 3);
  const wrap: N = saturate(dot(Nw, sunDirection).add(0.4).div(1.4)).sub(saturate(dot(Nw, sunDirection))).max(0);
  const sss: N = back.mul(0.6).add(wrap).mul(sssAmt).mul(sssCol).mul(sunColor).mul(0.35);
  m.emissiveNode = rimCol.mul(rim).mul(albedo.mul(0.5).add(0.5)).add(sss.mul(albedo));
  return m;
}

// ---------------------------------------------------------------------------------------------
// Wind sway
// ---------------------------------------------------------------------------------------------

export interface WindOptions {
  /** Max displacement at full height and wind strength 1 (m), default 0.25. */
  strength?: number;
  /** Main sway frequency (Hz), default 0.6. */
  frequency?: number;
  /** Height over which sway ramps from 0 to full (m), default 3. */
  height?: number;
  /** Extra fast leaf flutter (m), default 0.03. */
  flutter?: number;
}

export function windSway(o: WindOptions = {}): N {
  const strength = float(o.strength ?? 0.25);
  const freq = float((o.frequency ?? 0.6) * Math.PI * 2);
  const h = float(o.height ?? 3);
  const flutter = float(o.flutter ?? 0.03);
  // positionLocal is already instance-transformed here (positionNode runs after instancing);
  // positionGeometry is the untransformed model, so height is measured from the model origin.
  const p: N = positionLocal;
  const k: N = saturate(positionGeometry.y.div(h));
  const bend: N = k.mul(k);
  const phase: N = dot(p.xz, vec2(0.13, 0.17));
  const t: N = renderTime.mul(freq);
  const gust: N = sin(t.add(phase)).mul(0.6).add(sin(t.mul(0.37).add(phase.mul(0.5))).mul(0.4)).add(0.35);
  const sway: N = windDirection.mul(gust.mul(strength).mul(windStrength).mul(bend));
  const fl: N = sin(renderTime.mul(9).add(p.x.mul(1.7)).add(p.z.mul(2.3))).mul(flutter).mul(windStrength).mul(k);
  return p.add(sway).add(vec3(fl, fl.mul(0.5), fl.mul(-0.7)));
}

export function applyWind<T extends { positionNode: N }>(material: T, o: WindOptions = {}): T {
  material.positionNode = windSway(o);
  return material;
}

// ---------------------------------------------------------------------------------------------
// Stylised water
// ---------------------------------------------------------------------------------------------

export interface WaterOptions {
  shallow?: ColorLike;
  deep?: ColorLike;
  foam?: ColorLike;
  /** Depth (m) at which the water reaches the deep colour, default 2.5. */
  depthRange?: number;
  /** Shoreline foam width (m), default 0.6. */
  foamWidth?: number;
  /** Wave pattern scale (1/m), default 0.35. */
  waveScale?: number;
  /** Animation speed, default 1. */
  speed?: number;
  /** Opacity over deep water, default 0.92 (shallow water fades to 0.6). */
  opacity?: number;
  /** Use the scene depth buffer for depth tint and foam, default true. */
  sceneDepth?: boolean;
}

export function stylizedWater(o: WaterOptions = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0, transparent: true });
  m.depthWrite = false;
  const shallow: N = uniform(toColor(o.shallow, '#4fd6d0'));
  const deep: N = uniform(toColor(o.deep, '#1a5d8f'));
  const foamCol: N = uniform(toColor(o.foam, '#ffffff'));
  const flow: N = uniform(new Vector2(0.15, 0.05));
  m.userData.flow = flow;
  const speed = o.speed ?? 1;
  const ws = float(o.waveScale ?? 0.35);
  const t: N = renderTime.mul(speed);
  const p: N = positionWorld.xz.mul(ws).add(flow.mul(t));

  // Analytic normal from a sum of directional sines plus a little noise.
  const wave = (dir: [number, number], f: number, a: number, s: number) => {
    const d: N = vec2(dir[0], dir[1]).normalize();
    const ph: N = dot(p, d).mul(f).add(t.mul(s));
    return d.mul(cos(ph).mul(a * f));
  };
  const g: N = wave([1, 0.3], 2.1, 0.06, 1.3).add(wave([-0.4, 1], 3.3, 0.04, 1.7)).add(wave([0.7, -0.8], 5.7, 0.02, 2.3));
  const nz: N = mx_noise_float(vec3(p.mul(4), t.mul(0.4))).mul(0.025);
  const nWorld: N = normalize(vec3(g.x.negate().add(nz), 1, g.y.negate().sub(nz)));
  m.normalNode = transformNormalToView(nWorld);

  let depthT: N, foam: N;
  if (o.sceneDepth !== false) {
    const sceneZ: N = perspectiveDepthToViewZ(viewportDepthTexture().x, cameraNear, cameraFar);
    const thick: N = max(positionView.z.sub(sceneZ), 0);
    depthT = saturate(thick.div(o.depthRange ?? 2.5));
    const fw = float(o.foamWidth ?? 0.6);
    const edge: N = float(1).sub(smoothstep(0, fw, thick));
    const n: N = mx_noise_float(vec3(positionWorld.xz.mul(1.6), t.mul(0.5))).mul(0.5).add(0.5);
    const bands: N = fract(thick.div(fw).sub(t.mul(0.35)));
    foam = saturate(edge.mul(smoothstep(0.35, 0.55, n.add(edge.mul(0.5)))).add(edge.mul(smoothstep(0.7, 1, bands)).mul(0.6)));
  } else {
    const ndv: N = saturate(dot(normalView, positionView.normalize().negate()));
    depthT = ndv.mul(0.8).add(0.2);
    foam = vertexColor().r.mul(smoothstep(0.4, 0.7, mx_noise_float(vec3(positionWorld.xz.mul(1.6), t.mul(0.5))).add(0.5)));
  }
  const water: N = mix(shallow, deep, depthT);
  m.colorNode = mix(water, foamCol, foam);
  m.roughnessNode = mix(float(0.06), float(0.6), foam);
  m.opacityNode = clamp(mix(float(0.6), float(o.opacity ?? 0.92), depthT).add(foam), 0, 1);
  m.emissiveNode = shallow.mul(sunColor).mul(0.04).add(foamCol.mul(foam).mul(0.08));
  return m;
}

// ---------------------------------------------------------------------------------------------
// Road
// ---------------------------------------------------------------------------------------------

export interface RoadOptions {
  color?: ColorLike;
  map?: Texture | null;
  normalMap?: Texture | null;
  /** ORM texture (occlusion R, roughness G, metalness B). */
  ormMap?: Texture | null;
  detailNormal?: Texture | null;
  detailScale?: number;
  /** 0..1 initial wetness. */
  wetness?: number;
  /** UV repeat for all maps, default [1, 1]. */
  repeat?: [number, number];
}

export function roadMaterial(o: RoadOptions = {}): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const wet: N = uniform(o.wetness ?? 0);
  m.userData.wetness = wet;
  const rep = o.repeat ?? [1, 1];
  const uvR: N = uv().mul(vec2(rep[0], rep[1]));
  const base: N = uniform(toColor(o.color, '#ffffff'));
  let albedo: N = o.map ? texture(o.map, uvR).rgb.mul(base) : base;
  let rough: N = float(0.85);
  let ao: N = float(1);
  if (o.ormMap) {
    const orm: N = texture(o.ormMap, uvR);
    ao = orm.r; rough = orm.g;
    m.metalnessNode = orm.b;
  }
  // Wet: darker, smoother, puddles where the detail noise is low.
  const puddle: N = smoothstepInv(0.25, 0.55, mx_noise_float(vec3(positionWorld.xz.mul(0.25), 0)).mul(0.5).add(0.5)).mul(wet);
  const wetAmt: N = saturate(wet.mul(0.7).add(puddle));
  albedo = albedo.mul(mix(float(1), float(0.55), wetAmt));
  m.colorNode = albedo;
  m.roughnessNode = mix(rough, float(0.08), wetAmt);
  m.aoNode = ao;
  if (o.normalMap) {
    let nTex: N = texture(o.normalMap, uvR);
    if (o.detailNormal) {
      const d: N = texture(o.detailNormal, uvR.mul(o.detailScale ?? 6));
      // Whiteout-style blend in tangent space (rgb in 0..1).
      const a: N = nTex.xyz.mul(2).sub(1), b: N = d.xyz.mul(2).sub(1);
      nTex = normalize(vec3(a.xy.add(b.xy), a.z.mul(b.z))).mul(0.5).add(0.5);
    }
    m.normalNode = normalMapNode(nTex, mix(vec2(1), vec2(0.25), wetAmt));
  } else if (o.detailNormal) {
    m.normalNode = normalMapNode(texture(o.detailNormal, uvR.mul(o.detailScale ?? 6)), mix(vec2(1), vec2(0.25), wetAmt));
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Emissive pulse / uv scroll
// ---------------------------------------------------------------------------------------------

export interface PulseOptions {
  color?: ColorLike;
  /** Peak emissive intensity, default 2.5 (bloom picks it up above ~1). */
  intensity?: number;
  /** Pulses per second, default 1.5. */
  speed?: number;
  /** Phase offset 0..1 (e.g. per instance index / position). */
  phase?: number;
}

export function emissivePulse<T extends { emissiveNode: N; userData: Record<string, unknown> }>(material: T, o: PulseOptions = {}): T {
  const col: N = uniform(toColor(o.color, '#ffb030'));
  const inten: N = uniform(o.intensity ?? 2.5);
  const s = (o.speed ?? 1.5) * Math.PI * 2;
  const ph = (o.phase ?? 0) * Math.PI * 2;
  const wave: N = sin(renderTime.mul(s).add(ph)).mul(0.5).add(0.5);
  const pulse: N = pow(wave, 2).mul(0.75).add(0.25);
  const prev: N = material.emissiveNode;
  const glow: N = col.mul(inten).mul(pulse);
  material.emissiveNode = prev ? prev.add(glow) : glow;
  material.userData.pulse = inten;
  return material;
}

export function uvScroll(speed: [number, number]): N {
  return uv().add(vec2(speed[0], speed[1]).mul(renderTime));
}
