// Shared render uniforms. Owner: render.
// Written once per frame by the renderer; read by material helpers, VFX and post.
import { Color, Vector3 } from 'three/webgpu';
import { float, smoothstep, uniform } from 'three/tsl';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Loose node type: @types/three's TSL generics are too strict to be useful in shader code. */
export type N = any;

/** Render time in seconds (same value as `ctx.time`). */
export const renderTime: N = uniform(0);
/** World-space direction TO the sun, normalised. */
export const sunDirection: N = uniform(new Vector3(0.4, 0.8, 0.3).normalize());
/** Linear sun colour multiplied by intensity / PI-ish scale used in fake lighting (sprites, SSS). */
export const sunColor: N = uniform(new Color(1, 0.96, 0.88));
/** Linear sky (ambient) colour for fake lighting. */
export const skyColor: N = uniform(new Color(0.55, 0.75, 1));
/** Linear ground bounce colour for fake lighting. */
export const groundColor: N = uniform(new Color(0.35, 0.42, 0.25));
/** Wind: xz direction (normalised) and strength 0..1+. */
export const windDirection: N = uniform(new Vector3(1, 0, 0.3).normalize());
export const windStrength: N = uniform(0.6);

/** 1 at or below `a`, 0 at or above `b` (a < b). Use instead of smoothstep with reversed edges, which WGSL leaves undefined. */
export const smoothstepInv = (a: N, b: N, x: N): N => float(1).sub(smoothstep(a, b, x));
