// Track materials (TSL node materials, WebGPU + WebGL2). Owner: track.
// Texture sets come from public/assets/textures/<set>/{color,normal,orm}.webp (envart). Every
// material has a procedural fallback, so missing files never break the track.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, color, float, fract, max, mix, mx_noise_float, normalWorld, positionWorld, sin, smoothstep, step,
  texture, time, uv, vec2, vec3,
} from 'three/tsl';

type Node = any; // TSL nodes are loosely typed in @types/three

export interface TexSet { color?: THREE.Texture; normal?: THREE.Texture; orm?: THREE.Texture }
export type TexLib = Record<string, TexSet>;

export const TEXTURE_SETS = ['grass', 'dirt', 'asphalt', 'wood', 'hay', 'rock', 'bark', 'planks'] as const;

const base = (): string => {
  try { return (import.meta as any).env?.BASE_URL ?? '/'; } catch { return '/'; }
};

async function probe(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const type = r.headers.get('content-type') ?? '';
    return r.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/** Loads the texture sets that exist; missing maps stay undefined. */
export async function loadTextures(names: readonly string[], maxSize: number): Promise<TexLib> {
  const loader = new THREE.TextureLoader();
  const lib: TexLib = {};
  await Promise.all(names.map(async (name) => {
    const set: TexSet = {};
    lib[name] = set;
    await Promise.all((['color', 'normal', 'orm'] as const).map(async (map) => {
      const url = `${base()}assets/textures/${name}/${map}.webp`;
      if (!(await probe(url))) return;
      try {
        const t = await loader.loadAsync(url);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxSize >= 2048 ? 8 : 4;
        t.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        set[map] = t;
      } catch { /* fall back to flat colour */ }
    }));
  }));
  return lib;
}

/** Cheap value noise in TSL (MaterialX perlin), 0..1. */
const noise01 = (p: Node): Node => mx_noise_float(p).mul(0.5).add(0.5);

interface Surf { col: Node; rough: Node; ao: Node }

/** Samples a texture set at `uvn`, or a two-tone noisy fallback. */
function sampleSet(set: TexSet | undefined, uvn: Node, a: string, b: string, rough: number, noiseScale = 0.7): Surf {
  if (set?.color) {
    const col = texture(set.color, uvn).rgb;
    const orm = set.orm ? texture(set.orm, uvn) : null;
    return { col, rough: orm ? orm.g : float(rough), ao: orm ? orm.r : float(1) };
  }
  const n = noise01(uvn.mul(noiseScale * 4)).mul(0.6).add(noise01(uvn.mul(noiseScale * 13)).mul(0.4));
  return { col: mix(color(a), color(b), n), rough: float(rough), ao: float(1) };
}

/** World-space triplanar sample (no stretching on scaled instances). */
function triplanar(set: TexSet | undefined, scale: number, a: string, b: string, rough: number): Surf {
  const p = positionWorld.mul(scale);
  const n = abs(normalWorld);
  const w = n.div(n.x.add(n.y).add(n.z));
  const sx = sampleSet(set, p.zy, a, b, rough), sy = sampleSet(set, p.xz, a, b, rough), sz = sampleSet(set, p.xy, a, b, rough);
  const col = sx.col.mul(w.x).add(sy.col.mul(w.y)).add(sz.col.mul(w.z));
  const r = (sx.rough as Node).mul(w.x).add((sy.rough as Node).mul(w.y)).add((sz.rough as Node).mul(w.z));
  return { col, rough: r, ao: float(1) };
}

function std(s: Surf): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = s.col;
  m.roughnessNode = s.rough;
  m.metalnessNode = float(0);
  m.aoNode = s.ao;
  return m;
}

export interface RoadMarks {
  /** Grid slots: [s, lat] of each kart (main path). */
  slots: [number, number][];
}

/**
 * Road: asphalt / dirt track / planks / gravel by vertex weights, edge lines, kerbs on corners and the
 * chequered start line, all procedural in the shader (no decals, no z-fighting).
 * Attributes: uv = (lateral m, along m), hw, kerb (left, right), look (dirt, planks, gravel), main.
 */
export function roadMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const lat = uv().x, s = uv().y;
  const hw = attribute('hw', 'float');
  const kerb = attribute('kerb', 'vec2');
  const look = attribute('look', 'vec3');
  const main = attribute('main', 'float');
  const wuv = positionWorld.xz.mul(0.22);
  const asphalt = sampleSet(T.asphalt, wuv, '#5a5753', '#6b6762', 0.88, 0.5);
  const grime = noise01(positionWorld.xz.mul(0.05));
  const asCol = asphalt.col.mul(mix(float(0.9), float(1.08), grime));
  const dirt = sampleSet(T.dirt, positionWorld.xz.mul(0.25), '#9a7650', '#7d5d3d', 0.95);
  const planksRaw = sampleSet(T.planks, vec2(s.mul(0.45), lat.mul(0.18)), '#9c7148', '#7a5534', 0.8, 1.6);
  const planks = { col: mix(planksRaw.col, vec3(planksRaw.col.dot(vec3(0.3, 0.59, 0.11))), 0.45).mul(0.85) };
  const gravel = { col: mix(color('#8c8270'), color('#6f6656'), noise01(positionWorld.xz.mul(1.3))) };
  let col: Node = asCol;
  col = mix(col, dirt.col, look.x);
  col = mix(col, planks.col, look.y);
  col = mix(col, gravel.col, look.z);
  const paved = clamp(float(1).sub(look.x).sub(look.y).sub(look.z), 0, 1);
  const dist = hw.sub(abs(lat));
  // wheel-worn darker band on the racing area
  col = col.mul(mix(float(1), float(0.93), smoothstep(1.5, 3, dist).mul(paved)));
  const line = smoothstep(0.26, 0.31, dist).mul(float(1).sub(smoothstep(0.5, 0.55, dist))).mul(paved);
  col = mix(col, color('#f4f1e8'), line.mul(0.92));
  const side = mix(kerb.x, kerb.y, step(0, lat));
  const kerbMask = float(1).sub(smoothstep(1.0, 1.05, dist)).mul(side);
  const stripe = step(0.5, fract(s.div(2.6)));
  col = mix(col, mix(color('#d63c2c'), color('#f6f2ea'), stripe), kerbMask);
  // chequered start line (main path, s in [0, 1.8])
  const inStart = step(s, 1.8).mul(main);
  const chk = abs(step(0.5, fract(lat.div(1.8))).sub(step(0.5, fract(s.div(1.8)))));
  col = mix(col, mix(color('#1c1c1c'), color('#f6f6f2'), chk), inStart);
  return std({ col, rough: mix(asphalt.rough as Node, float(0.65), kerbMask.add(line).clamp(0, 1)), ao: float(1) });
}

/**
 * Terrain + shoulders: grass with large-scale tint variation, dirt by slope and near the road,
 * crop field rows, mud, gravel. Attribute `blend` = (dirt, field, mud, gravel).
 */
export function terrainMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const w = attribute('blend', 'vec4');
  const xz = positionWorld.xz;
  const grass = sampleSet(T.grass, xz.mul(0.2), '#6aa84a', '#4f8f3a', 0.95, 0.6);
  const tint = noise01(xz.mul(0.012));
  const tint2 = noise01(xz.mul(0.045).add(vec2(13.1, 7.7)));
  const g0: Node = grass.col.mul(mix(vec3(0.92, 1.0, 0.85), vec3(1.08, 1.05, 0.9), tint)).mul(mix(float(0.9), float(1.06), tint2));
  // a touch less saturated, warmer (late-morning meadow)
  let col: Node = mix(g0, vec3(g0.dot(vec3(0.3, 0.59, 0.11))).mul(vec3(1.05, 1.0, 0.85)), 0.22);
  const dirt = sampleSet(T.dirt, xz.mul(0.25), '#94704a', '#76573a', 1, 0.8);
  const slope = float(1).sub(normalWorld.y);
  const dirtW = max(w.x, smoothstep(0.32, 0.55, slope).mul(0.85)).mul(smoothstep(0.15, 0.75, noise01(xz.mul(0.35)).add(w.x.mul(0.6))));
  col = mix(col, dirt.col, clamp(dirtW, 0, 1));
  // crop field: alternating soil and young crop rows
  const row = smoothstep(0.3, 0.45, abs(fract(positionWorld.x.mul(0.5)).sub(0.5)));
  const field = mix(dirt.col.mul(0.85), color('#7fae3c').mul(mix(float(0.85), float(1.1), noise01(xz.mul(0.4)))), row);
  col = mix(col, field, w.y);
  col = mix(col, color('#5d4630').mul(mix(float(0.8), float(1.0), noise01(xz.mul(0.8)))), w.z);
  col = mix(col, mix(color('#b3a58b'), color('#8f8470'), noise01(xz.mul(1.1))), w.w);
  const m = std({ col, rough: float(0.97), ao: grass.ao });
  return m;
}

export function waterMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const p = positionWorld.xz;
  const ripple = sin(p.x.mul(1.7).add(time.mul(1.6))).mul(sin(p.y.mul(1.3).sub(time.mul(1.1)))).mul(0.5).add(0.5);
  const n = noise01(p.mul(0.15).add(vec2(time.mul(0.05), time.mul(0.03))));
  m.colorNode = mix(color('#2e7d8c'), color('#5fb2b8'), n.mul(0.6).add(ripple.mul(0.25)));
  m.emissiveNode = color('#ffffff').mul(smoothstep(0.93, 1.0, ripple.mul(0.6).add(n.mul(0.5))).mul(0.25));
  m.roughnessNode = float(0.08);
  m.metalnessNode = float(0.05);
  m.opacityNode = float(0.8);
  return m;
}

export function woodMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  return std(triplanar(T.wood ?? T.planks, 0.6, '#8a6440', '#6d4c2f', 0.85));
}
export function planksMaterial(T: TexLib, tint = '#ffffff'): THREE.MeshStandardNodeMaterial {
  const s = triplanar(T.planks ?? T.wood, 0.35, '#9a6a44', '#7a5132', 0.85);
  return std({ ...s, col: s.col.mul(color(tint)) });
}
export function stoneMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  return std(triplanar(T.rock, 0.3, '#a59d90', '#7f786c', 0.9));
}
export function hedgeMaterial(): THREE.MeshStandardNodeMaterial {
  const p = positionWorld;
  const n = noise01(p.mul(1.4)).mul(0.6).add(noise01(p.mul(4.1)).mul(0.4));
  return std({ col: mix(color('#2f6b2a'), color('#4f9a3a'), n), rough: float(1), ao: mix(float(0.7), float(1), n) });
}
export function hayMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  return std(triplanar(T.hay, 0.8, '#e2c25e', '#c9a243', 1));
}
export function roofMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const s = triplanar(T.planks ?? T.wood, 0.5, '#4d5664', '#3c4350', 0.8);
  return std({ ...s, col: T.planks?.color || T.wood?.color ? s.col.mul(color('#7d8aa0')) : s.col });
}

/** Boost pads: glowing chevrons that run forward. uv = (across 0..1, along m). */
export function padMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const u = uv().x, v = uv().y;
  const chev = fract(v.mul(0.55).sub(abs(u.sub(0.5)).mul(0.9)).sub(time.mul(1.8)));
  const arrow = smoothstep(0.45, 0.5, chev).mul(float(1).sub(smoothstep(0.75, 0.8, chev)));
  const border = float(1).sub(smoothstep(0.06, 0.1, u)).add(smoothstep(0.9, 0.94, u)).clamp(0, 1);
  const glow = max(arrow, border);
  const base = mix(color('#1f2c5c'), color('#f2c21b'), border);
  m.colorNode = mix(base, color('#ffd9a0'), arrow);
  m.emissiveNode = mix(color('#000000'), color('#ff9a2a'), arrow).mul(0.7).add(color('#f2c21b').mul(border.mul(0.12)));
  m.roughnessNode = float(0.4);
  m.metalnessNode = float(0);
  return m;
}

/** Ramps: planks with a yellow / black lip. uv.y = 0..1 along the ramp. */
export function rampMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const s = triplanar(T.planks ?? T.wood, 0.45, '#b07a48', '#8a5a33', 0.8);
  const v = uv().y, u = uv().x;
  const lip = smoothstep(0.86, 0.88, v);
  const hazard = step(0.5, fract(u.mul(0.6).add(v.mul(3))));
  const col = mix(s.col, mix(color('#1d1d1d'), color('#f2c21b'), hazard), lip);
  return std({ col, rough: s.rough, ao: float(1) });
}

export function flatMaterial(c: string, rough = 0.8, emissive?: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
  if (emissive) m.emissive = new THREE.Color(emissive);
  return m;
}

/** Banner: red / white chequers with a cream border (start gate fallback). uv 0..1. */
export function bannerMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const u = uv().x, v = uv().y;
  const chk = abs(step(0.5, fract(u.mul(14))).sub(step(0.5, fract(v.mul(2)))));
  m.colorNode = mix(color('#1f1f1f'), color('#fafafa'), chk);
  m.roughnessNode = float(0.7);
  return m;
}
