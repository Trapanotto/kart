// Sky, image-based lighting, sun + shadows, height fog. Owner: render.
import {
  BackSide, Color, CubeCamera, CubeRenderTarget, DirectionalLight, EquirectangularReflectionMapping, HalfFloatType,
  Matrix4, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene, SphereGeometry, Vector3, type DataTexture, type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, dot, exp, float, fog, max, mix, reference, renderGroup, texture, mx_fractal_noise_float, normalize, normalWorldGeometry, positionLocal, positionView,
  positionWorld, cameraPosition, pow, saturate, smoothstep, uniform, vec2, vec3,
} from 'three/tsl';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import type { EnvironmentDef, QualitySettings } from '../core/types';
import { assetExists, assetUrl } from '../core/assetUrl';
import { groundColor, renderTime, skyColor, sunColor, sunDirection, type N } from './shared';

const GROUND_TINT = new Color('#5d7a45');

/** Uniforms shared by sky, fog and the light-shaft post stage. */
export const env = {
  skyTop: uniform(new Color('#5aa9e6')) as N,
  skyHorizon: uniform(new Color('#dff1ff')) as N,
  fogColor: uniform(new Color('#cfe8ff')) as N,
  fogDensity: uniform(0.002) as N,
  /** Height (m) below which fog is at full density; it thins out above. */
  fogHeight: uniform(6) as N,
  fogFalloff: uniform(0.045) as N,
  /** 0..1: sun in-scatter tint in the fog (cheap volumetric look). */
  inscatter: uniform(0) as N,
  cloudCover: uniform(0.5) as N,
};

/** Procedural sky colour for a world direction. `withSun` adds the sun disc (off for the env map). */
export function skyNode(dir: N, withSun: boolean, animated: boolean): N {
  const d: N = normalize(dir);
  const y: N = d.y;
  const up: N = saturate(y);
  const grad: N = mix(env.skyHorizon, env.skyTop, pow(up, 0.55));
  const below: N = mix(env.skyHorizon, env.skyHorizon.mul(vec3(GROUND_TINT.r, GROUND_TINT.g, GROUND_TINT.b)).mul(1.6), saturate(y.negate().mul(4)));
  let col: N = y.greaterThan(0).select(grad, below);
  const sd: N = saturate(dot(d, sunDirection));
  // Halo around the sun, warm.
  col = col.add(sunColor.mul(pow(sd, 12).mul(0.25).add(pow(sd, 128).mul(0.6))));
  // Clouds on a virtual plane.
  const t: N = animated ? renderTime : float(0);
  const p: N = d.xz.div(max(y, 0.04).add(0.12)).mul(1.1).add(vec2(t.mul(0.004), t.mul(0.0015)));
  const n: N = mx_fractal_noise_float(vec3(p.mul(1.4), t.mul(0.003)), 4, 2.0, 0.5).mul(0.5).add(0.5);
  const cov: N = smoothstep(float(1).sub(env.cloudCover).sub(0.05), float(1).sub(env.cloudCover).add(0.35), n);
  const fadeH: N = smoothstep(0.0, 0.18, y);
  const dayK: N = saturate(dot(env.skyHorizon, vec3(0.2126, 0.7152, 0.0722)).mul(1.4));
  const cloudBright: N = mix(env.skyHorizon.mul(1.15), vec3(1.05), dayK).add(sunColor.mul(0.12));
  const cloudLit: N = mix(env.skyHorizon.mul(0.9).add(vec3(0.08).mul(dayK)), cloudBright, saturate(n.mul(1.4).sub(0.2)));
  const cloudCol: N = cloudLit.add(sunColor.mul(pow(sd, 6).mul(0.35)));
  col = mix(col, cloudCol, cov.mul(fadeH).mul(0.92));
  if (withSun) {
    const disc: N = smoothstep(0.99955, 0.99975, sd);
    col = col.add(sunColor.mul(disc).mul(18));
  }
  return col;
}

/** Exponential height fog with optional sun in-scatter. */
export function fogNode(): N {
  const toFrag: N = positionWorld.sub(cameraPosition);
  const dist: N = positionView.z.negate();
  const dir: N = normalize(toFrag);
  // Integrated density along the ray through an exponential height profile.
  const h0: N = cameraPosition.y.sub(env.fogHeight);
  const h1: N = positionWorld.y.sub(env.fogHeight);
  const avgH: N = max(h0.add(h1).mul(0.5), 0);
  const heightTerm: N = exp(avgH.mul(env.fogFalloff).negate());
  const optical: N = env.fogDensity.mul(dist).mul(heightTerm);
  const factor: N = float(1).sub(exp(optical.mul(optical).negate().mul(0.6).sub(optical.mul(0.4))));
  const sd: N = saturate(dot(dir, sunDirection));
  const scatter: N = pow(sd, 8).mul(env.inscatter);
  const col: N = env.fogColor.add(sunColor.mul(scatter).mul(0.35));
  return fog(col, saturate(factor));
}

/**
 * Shadow filter: 4x4 grid of hardware-bilinear compare taps (an 8x8-texel tent-like kernel scaled by
 * shadow.radius). Smooth penumbrae without the per-pixel grain of the stock rotated-Vogel PCF.
 */
const smoothPCF: N = Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: N) => {
  const mapSize: N = reference('mapSize', 'vec2', shadow).setGroup(renderGroup);
  const radius: N = reference('radius', 'float', shadow).setGroup(renderGroup);
  const texel: N = vec2(1).div(mapSize).mul(radius.mul(0.5).max(0.5));
  const tap = (x: number, y: number) => {
    let d: N = texture(depthTexture, shadowCoord.xy.add(vec2(x, y).mul(texel)));
    if (depthTexture.isArrayTexture) d = d.depth(depthLayer);
    return d.compare(shadowCoord.z);
  };
  const o = [-1.5, -0.5, 0.5, 1.5];
  const w = [0.5, 1, 1, 0.5];
  let sum: N = float(0);
  let wsum = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const ww = w[i] * w[j]; sum = sum.add(tap(o[i], o[j]).mul(ww)); wsum += ww; }
  return sum.div(wsum);
});

// ---------------------------------------------------------------------------------------------

export interface Lighting {
  sun: DirectionalLight;
  setEnvironment(def: EnvironmentDef): Promise<void>;
  setQuality(q: QualitySettings): void;
  /** Per frame: follow-frustum on mobile, cascade refresh after camera changes. */
  update(camera: PerspectiveCamera): void;
  onResize(): void;
  dispose(): void;
}

/** The HDR only lights the scene (the visible sky is procedural), so small files are enough. */
function hdrFile(name: string, tier: QualitySettings['tier']): string {
  return `${name}_${tier === 'mobile' ? '512' : '1k'}`;
}

/** Starts fetching a track's HDR early, in parallel with the rest of the loading. */
export function preloadEnvironment(d: EnvironmentDef, q: QualitySettings): void {
  if (d.hdr) void loadHdr(hdrFile(d.hdr, q.tier));
}

const hdrCache = new Map<string, Promise<DataTexture | null>>();

async function loadHdr(name: string): Promise<DataTexture | null> {
  if (!hdrCache.has(name)) {
    hdrCache.set(name, (async () => {
      try {
        if (!assetExists(`assets/env/${name}.hdr`)) return null;
        const url = assetUrl(`assets/env/${name}.hdr`);
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        // The dev server answers missing files with index.html; a real Radiance file starts with "#?".
        const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
        if (head[0] !== 0x23 || head[1] !== 0x3f) return null;
        const loader = new HDRLoader().setDataType(HalfFloatType);
        const blobUrl = URL.createObjectURL(new Blob([buf]));
        try {
          const tex = await loader.loadAsync(blobUrl);
          tex.mapping = EquirectangularReflectionMapping;
          return tex;
        } finally { URL.revokeObjectURL(blobUrl); }
      } catch (e) {
        console.warn('[render] HDR load failed, using procedural sky', e);
        return null;
      }
    })());
  }
  return hdrCache.get(name)!;
}

export function createLighting(renderer: () => WebGPURenderer, scene: Scene, camera: PerspectiveCamera, initial: QualitySettings): Lighting {
  let quality = initial;
  let sun = new DirectionalLight('#ffffff', 3);
  const sunDir = new Vector3(0.4, 0.8, 0.3).normalize();
  let csm: CSMShadowNode | null = null;
  let def: EnvironmentDef | null = null;
  let hdrTex: Texture | null = null;

  // Env capture of the procedural sky (no sun disc, static clouds).
  const envScene = new Scene();
  const envMat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false });
  envMat.colorNode = skyNode(positionLocal, false, false);
  envMat.fog = false;
  envScene.add(new Mesh(new SphereGeometry(10, 48, 24), envMat));
  const cubeRT = new CubeRenderTarget(128, { type: HalfFloatType });
  const cubeCam = new CubeCamera(0.1, 100, cubeRT);
  envScene.add(cubeCam);

  scene.backgroundNode = skyNode(normalWorldGeometry, true, true);
  scene.fogNode = fogNode();

  function configureShadow(light: DirectionalLight) {
    // Noise-free soft filter; CSM clones the shadow per cascade, so make clones keep it.
    const sh = light.shadow as N;
    sh.filterNode = smoothPCF;
    const origClone = sh.clone.bind(sh);
    sh.clone = () => { const c = origClone(); c.filterNode = smoothPCF; return c; };
    const q = quality;
    light.castShadow = q.shadows;
    const s = light.shadow;
    s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    // Low sun = grazing angles on flat ground: push the receiver further along its normal.
    const graze = 1 + 2.5 * (1 - Math.min(1, Math.max(0, sunDir.y) / 0.6));
    s.bias = -0.0004 * graze;
    s.normalBias = (q.tier === 'mobile' ? 0.04 : 0.03) * graze;
    s.radius = q.tier === 'high' ? 2.5 : 2;
    const cam = s.camera;
    cam.near = 1; cam.far = 400;
    if (q.tier === 'mobile' || q.shadowCascades <= 1) {
      const half = 28;
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    }
    cam.updateProjectionMatrix();
  }

  function buildSun() {
    if (csm) { csm.dispose(); csm = null; }
    if (sun.parent) { scene.remove(sun.target); scene.remove(sun); sun.dispose(); }
    sun = new DirectionalLight(sun.color.clone(), sun.intensity);
    sun.name = 'sun';
    configureShadow(sun);
    if (quality.shadows && quality.tier !== 'mobile' && quality.shadowCascades > 1) {
      csm = new CSMShadowNode(sun, { cascades: quality.shadowCascades, maxFar: quality.tier === 'high' ? 220 : 150, mode: 'practical', lightMargin: 120 });
      csm.fade = true;
      sun.shadow.shadowNode = csm as N;
    }
    sun.position.copy(sunDir).multiplyScalar(100);
    sun.target.position.set(0, 0, 0);
    scene.add(sun, sun.target);
  }
  buildSun();

  const focus = new Vector3(), fwd = new Vector3(), tmp = new Vector3();
  const lightRot = new Matrix4(), lightRotInv = new Matrix4();
  const ORIGIN = new Vector3(), UP = new Vector3(0, 1, 0);

  return {
    get sun() { return sun; },
    async setEnvironment(d) {
      def = d;
      sunDir.set(...d.sunDir).normalize();
      sunDirection.value.copy(sunDir);
      const sc = new Color(d.sunColor);
      sun.color.copy(sc);
      sun.intensity = d.sunIntensity;
      sunColor.value.copy(sc).multiplyScalar(Math.min(2, d.sunIntensity / 3));
      env.skyTop.value.set(d.skyTop);
      env.skyHorizon.value.set(d.skyHorizon);
      env.fogColor.value.set(d.fogColor);
      env.fogDensity.value = d.fogDensity * 1.6;
      skyColor.value.set(d.skyTop).lerp(new Color(d.skyHorizon), 0.5);
      groundColor.value.copy(new Color(d.skyHorizon)).multiply(GROUND_TINT);
      sun.position.copy(sunDir).multiplyScalar(100);
      buildSun(); // re-derive biases for the new sun elevation (CSM clones the shadow per cascade)

      // Phones get the 1k sky when it exists (a quarter of the download and upload).
      hdrTex = d.hdr ? await loadHdr(hdrFile(d.hdr, quality.tier)) : null;
      if (hdrTex) {
        // The HDRI lights the scene; the visible sky stays procedural so photographed
        // trees and horizons do not clash with the stylised world.
        scene.environment = hdrTex;
        scene.background = null;
        scene.backgroundNode = skyNode(normalWorldGeometry, true, true);
      } else {
        scene.background = null;
        scene.backgroundNode = skyNode(normalWorldGeometry, true, true);
        cubeCam.update(renderer() as N, envScene);
        scene.environment = cubeRT.texture;
      }
      scene.environmentIntensity = d.ambientIntensity;
    },
    setQuality(q) {
      const rebuild = q.tier !== quality.tier || q.shadowCascades !== quality.shadowCascades || q.shadows !== quality.shadows || q.shadowMapSize !== quality.shadowMapSize;
      quality = q;
      env.inscatter.value = q.volumetricFog ? 1 : 0.35;
      if (rebuild) {
        const c = sun.color.clone(), i = sun.intensity;
        buildSun();
        sun.color.copy(c); sun.intensity = i;
      }
    },
    update(cam) {
      if (!quality.shadows) return;
      if (csm) {
        // CSMShadowNode positions its cascade lights itself; keep the main light pointing along the sun.
        sun.position.copy(sunDir).multiplyScalar(100);
        sun.target.position.set(0, 0, 0);
        return;
      }
      // Single tight frustum: centre it ahead of the camera, snapped to shadow texels to avoid shimmer.
      cam.getWorldDirection(fwd);
      fwd.y = 0; if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1); fwd.normalize();
      focus.copy(cam.position).addScaledVector(fwd, 16);
      focus.y = Math.min(focus.y, cam.position.y - 2);
      const s = sun.shadow, sc = s.camera;
      const texel = (sc.right - sc.left) / s.mapSize.width;
      // Snap in light space (rotation only: light looks along -sunDir).
      lightRot.lookAt(sunDir, ORIGIN, UP);
      lightRotInv.copy(lightRot).invert();
      tmp.copy(focus).applyMatrix4(lightRotInv);
      tmp.x = Math.round(tmp.x / texel) * texel;
      tmp.y = Math.round(tmp.y / texel) * texel;
      tmp.applyMatrix4(lightRot);
      sun.target.position.copy(tmp);
      sun.position.copy(tmp).addScaledVector(sunDir, 150);
    },
    onResize() { if (csm && (csm as N).camera) csm.updateFrustums(); },
    dispose() {
      csm?.dispose();
      scene.remove(sun, sun.target);
      cubeRT.dispose();
      envMat.dispose();
      void def;
    },
  };
}
