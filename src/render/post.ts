// TSL post pipeline. Owner: render.
//
// high:    scene (MSAA 4x) -> GTAO (half res, normals from depth) + bloom (mips) + light shafts (half res)
//          -> one composite pass (speed blur, CA, AO, bloom, shafts, grade, vignette, flash, dither)
// medium:  scene (MSAA 4x) -> bloom -> composite (speed blur, CA, grade, vignette, flash)
// mobile:  scene (MSAA 4x) -> composite with grade, vignette, flash and speed lines only (one full-screen pass)
import { Color, RenderPipeline, RTTNode, Vector2, Vector3, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import {
  abs, atan, clamp, dot, float, fract, hash, int, interleavedGradientNoise, length, luminance, max, mix, mrt, normalView,
  output, pass, perspectiveDepthToViewZ, screenSize, pow, renderOutput, saturate, screenCoordinate, sin, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { radialBlur } from 'three/examples/jsm/tsl/display/radialBlur.js';
import type { QualitySettings } from '../core/types';
import { renderTime, sunColor, sunDirection, smoothstepInv, type N } from './shared';

export interface PostStages {
  ao: boolean;
  bloom: boolean;
  /** Radial speed blur (motion blur look). */
  blur: boolean;
  /** Chromatic aberration + screen punch while boosting. */
  boostFx: boolean;
  shafts: boolean;
  grade: boolean;
  vignette: boolean;
  /** Screen-space speed lines while boosting. */
  speedLines: boolean;
  msaa: boolean;
}

export const STAGE_KEYS: (keyof PostStages)[] = ['ao', 'bloom', 'blur', 'boostFx', 'shafts', 'grade', 'vignette', 'speedLines', 'msaa'];

export function stagesFor(q: QualitySettings): PostStages {
  const mobile = q.tier === 'mobile';
  return {
    ao: q.ao,
    bloom: q.bloom,
    blur: q.motionBlur,
    boostFx: !mobile,
    shafts: q.volumetricFog,
    grade: true,
    vignette: true,
    speedLines: true,
    msaa: true,
  };
}

/** Uniforms driven by gameplay feel and the environment. */
export const post = {
  speed: uniform(0) as N,
  boost: uniform(0) as N,
  /** Edge-triggered screen punch 0..1 (decays). */
  kick: uniform(0) as N,
  /** Hit flash 0..1 (decays). */
  flash: uniform(0) as N,
  /** Desaturation 0..1 (hit). */
  desat: uniform(0) as N,
  underwater: uniform(0) as N,
  lift: uniform(new Vector3(0.0, 0.0, 0.01)) as N,
  gamma: uniform(new Vector3(1, 1, 1)) as N,
  gain: uniform(new Vector3(1.02, 1.0, 0.98)) as N,
  saturation: uniform(1.12) as N,
  contrast: uniform(1.06) as N,
  tint: uniform(new Color(1, 1, 1)) as N,
  vignette: uniform(0.32) as N,
  /** Sun position in screen uv and visibility 0..1 (for shafts). */
  sunUV: uniform(new Vector2(0.5, 0.5)) as N,
  sunVis: uniform(0) as N,
  aoStrength: uniform(0.85) as N,
  bloomStrength: uniform(0.3) as N,
};

export interface Post {
  pipeline: RenderPipeline;
  stages: PostStages;
  build(stages: PostStages): void;
  setResolutionScale(s: number): void;
  updateSun(camera: PerspectiveCamera): void;
  render(): void;
  dispose(): void;
}

const _v = new Vector3();

export function createPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, initial: PostStages): Post {
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  let scenePass: N = null;
  let scale = 1;
  let disposables: N[] = [];
  const camNear: N = uniform(camera.near).onRenderUpdate(() => camera.near);
  const camFar: N = uniform(camera.far).onRenderUpdate(() => camera.far);

  function build(st: PostStages) {
    for (const d of disposables) d.dispose?.();
    disposables = [];
    scenePass = pass(scene, camera, { samples: st.msaa ? 4 : 0 });
    scenePass.setResolutionScale(scale);
    disposables.push(scenePass);
    const colorTex: N = scenePass.getTextureNode('output');
    const depthTex: N = scenePass.getTextureNode('depth');

    let aoTex: N = null;
    if (st.ao) {
      const aoPass: N = ao(depthTex, null as N, camera) // normals reconstructed from depth: transparent VFX cannot disturb them;
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      aoPass.thickness.value = 1.2;
      aoPass.distanceFallOff.value = 1;
      aoPass.samples.value = 12;
      aoTex = aoPass.getTextureNode();
      disposables.push(aoPass);
    }
    let bloomNode: N = null;
    if (st.bloom) {
      bloomNode = bloom(colorTex, 1, 0.55, 0.85);
      bloomNode.strength = post.bloomStrength;
      bloomNode.setResolutionScale?.(0.5);
      disposables.push(bloomNode);
    }
    let shaftTex: N = null;
    if (st.shafts) {
      // Sky mask around the sun, radially blurred toward the sun position at half resolution.
      const linD: N = scenePass.getLinearDepthNode();
      const sky: N = smoothstep(0.995, 1.0, linD);
      const d: N = length(uv().sub(post.sunUV).mul(vec2(1.6, 1)));
      const halo: N = pow(saturate(float(1).sub(d.mul(1.4))), 3);
      const src: N = vec4(colorTex.rgb.mul(sky).mul(halo).mul(post.sunVis), 1);
      const srcRT: N = new RTTNode(src, null, null, { resolutionScale: 0.5 } as N);
      disposables.push(srcRT);
      shaftTex = radialBlur(srcRT, { center: post.sunUV, weight: float(0.9), decay: float(0.96), count: int(24), exposure: float(1.6) });
    }

    // ------------------------------------------------------------------ composite
    const baseUV: N = uv();
    const centered: N = baseUV.sub(0.5);
    const kickScale: N = float(1).sub(post.kick.mul(0.04));
    const suv: N = st.boostFx ? centered.mul(kickScale).add(0.5) : baseUV;
    const dir: N = suv.sub(0.5);
    const r: N = length(dir.mul(vec2(1.4, 1)));

    let col: N;
    if (st.blur) {
      // Radial speed blur, depth-aware: strongest at the screen edge and on near geometry.
      const amt: N = saturate(post.speed.sub(0.55).mul(1.6)).mul(0.5).add(post.boost.mul(0.6));
      const vz: N = perspectiveDepthToViewZ(depthTex.sample(suv).x, camNear, camFar);
      const near: N = float(1).sub(smoothstep(2.0, 30.0, vz.negate()));
      const k: N = amt.mul(smoothstep(0.18, 0.75, r)).mul(near.mul(0.6).add(0.4)).mul(0.09);
      const jitter: N = interleavedGradientNoise(screenCoordinate).mul(0.25);
      const TAPS = 8;
      let acc: N = colorTex.sample(suv).rgb;
      for (let i = 1; i < TAPS; i++) {
        const t: N = float(i).add(jitter).div(TAPS);
        acc = acc.add(colorTex.sample(suv.sub(dir.mul(k).mul(t))).rgb);
      }
      col = acc.div(TAPS);
    } else {
      col = colorTex.sample(suv).rgb;
    }
    if (st.boostFx) {
      const ca: N = post.boost.mul(0.0015).add(post.flash.mul(0.004)).mul(smoothstep(0.1, 0.7, r));
      const rr: N = colorTex.sample(suv.add(dir.mul(ca).mul(4))).r;
      const bb: N = colorTex.sample(suv.sub(dir.mul(ca).mul(4))).b;
      const w: N = saturate(ca.mul(400));
      col = mix(col, vec3(rr, col.g, bb), w);
    }
    if (aoTex) {
      // GTAO without temporal filtering is noisy: 4x4 box of bilinear taps over the half-res AO (~8x8 px).
      const px: N = vec2(2).div(screenSize);
      let aSum: N = float(0);
      for (const oy of [-1.5, -0.5, 0.5, 1.5]) for (const ox of [-1.5, -0.5, 0.5, 1.5]) aSum = aSum.add(aoTex.sample(suv.add(px.mul(vec2(ox, oy)))).r);
      const a: N = aSum.div(16);
      // Apply mostly to the ambient-ish part: darker scenes take more AO than sunlit highlights.
      const l: N = luminance(col);
      const w: N = post.aoStrength.mul(float(1).sub(smoothstep(0.6, 3.0, l).mul(0.5)));
      col = col.mul(mix(float(1), a, w));
    }
    if (bloomNode) col = col.add(bloomNode.rgb);
    if (shaftTex) col = col.add(shaftTex.rgb.mul(sunColor).mul(0.45));

    // Tone map + sRGB (filmic, from renderer.toneMapping / exposure).
    let c: N = renderOutput(vec4(col, 1)).rgb;

    // Display-space grade.
    if (st.grade) {
      c = c.mul(post.tint);
      c = c.mul(post.gain).add(post.lift.mul(float(1).sub(c)));
      c = pow(max(c, 0), vec3(1).div(post.gamma));
      c = c.sub(0.5).mul(post.contrast).add(0.5);
      const lum: N = luminance(c);
      c = mix(vec3(lum), c, post.saturation);
    }
    // Hit: brief desaturate + warm flash.
    const lum2: N = luminance(c);
    c = mix(c, vec3(lum2), post.desat);
    c = c.add(vec3(1, 0.92, 0.85).mul(post.flash).mul(0.35));
    // Underwater tint.
    c = mix(c, c.mul(vec3(0.55, 0.85, 1.0)).add(vec3(0, 0.03, 0.06)), post.underwater);

    if (st.speedLines) {
      // Anime speed lines at the screen edge while boosting.
      const ang: N = atan(dir.y, dir.x);
      const cell: N = ang.mul(70 / Math.PI).floor();
      const h: N = hash(cell);
      const flick: N = fract(h.mul(13.7).add(renderTime.mul(3.1)));
      const on: N = smoothstep(0.82, 0.95, h).mul(smoothstepInv(0.0, 0.55, abs(flick.sub(0.5))));
      const rad: N = smoothstep(0.42, 0.75, r);
      const amt: N = post.boost.mul(0.55).add(saturate(post.speed.sub(0.85).mul(3)).mul(0.25));
      c = mix(c, vec3(1), on.mul(rad).mul(amt).mul(0.5));
    }
    if (st.vignette) {
      const v: N = smoothstep(0.35, 0.95, r);
      const vAmt: N = post.vignette.add(post.boost.mul(0.12)).add(post.flash.mul(0.15));
      c = c.mul(float(1).sub(v.mul(v).mul(vAmt)));
    }
    // Dither against banding in 8-bit output.
    const n: N = interleavedGradientNoise(screenCoordinate).sub(0.5).div(255);
    c = clamp(c.add(n), 0, 1);
    pipeline.outputNode = vec4(c, 1);
    pipeline.needsUpdate = true;
    void dot; void sin; void sunDirection;
  }

  build(initial);

  const self: Post = {
    pipeline,
    stages: { ...initial },
    build(st) { self.stages = { ...st }; build(st); },
    setResolutionScale(s) {
      if (Math.abs(s - scale) < 1e-3) return;
      scale = s;
      scenePass?.setResolutionScale(s);
    },
    updateSun(cam) {
      _v.copy(sunDirection.value).multiplyScalar(1000).add(cam.position).project(cam);
      const inFront = _v.z < 1;
      post.sunUV.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
      post.sunVis.value = inFront ? Math.max(0, Math.min(1, (1.6 - edge) / 0.6)) : 0;
    },
    render() { pipeline.render(); },
    dispose() { for (const d of disposables) d.dispose?.(); pipeline.dispose(); },
  };
  return self;
}
