// Bambus-Tempel materials (TSL node materials, WebGPU + WebGL2): forest floor, flagstone road,
// mossy stone, bamboo canes, waterfall. All of them darken and turn glossy with the `wet` uniform
// (0 dry .. 1 rain, lap 2 on). Owner: track 2.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, color, float, fract, mix, mx_noise_float, mx_worley_noise_vec2, normalWorld, positionWorld,
  smoothstep, step, texture, time, uniform, uv, vec2, vec3,
} from 'three/tsl';
import type { TexLib, TexSet } from '../../materials';

type Node = any; // TSL nodes are loosely typed in @types/three

/** 0 dry .. 1 soaked; animated by the theme when the rain sets in. */
export const wet: Node = uniform(0);
/** Main-path progress range of the bridge deck: the road surface is cut out there (planks are 3D). */
export const deckRange: Node = uniform(new THREE.Vector2(-1, -1));

const n01 = (p: Node): Node => mx_noise_float(p).mul(0.5).add(0.5);

function sample(set: TexSet | undefined, uvn: Node, a: string, b: string, scale = 0.7): Node {
  if (set?.color) return texture(set.color, uvn).rgb;
  const n = n01(uvn.mul(scale * 4)).mul(0.6).add(n01(uvn.mul(scale * 13)).mul(0.4));
  return mix(color(a), color(b), n);
}

function triplanar(set: TexSet | undefined, scale: number, a: string, b: string): Node {
  const p = positionWorld.mul(scale);
  const nn = abs(normalWorld);
  const w = nn.div(nn.x.add(nn.y).add(nn.z));
  return sample(set, p.zy, a, b).mul(w.x).add(sample(set, p.xz, a, b).mul(w.y)).add(sample(set, p.xy, a, b).mul(w.z));
}

function finish(col: Node, rough: Node, ao: Node = float(1)): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  // wet: darker albedo, glossy
  m.colorNode = col.mul(mix(float(1), float(0.68), wet));
  m.roughnessNode = mix(rough, rough.mul(0.42), wet);
  m.metalnessNode = float(0);
  m.aoNode = ao;
  return m;
}

/** Mossy stone (triplanar rock, moss on the upward faces): walls, barrier slabs. */
export function mossStone(T: TexLib): THREE.MeshStandardNodeMaterial {
  const rock = triplanar(T.rock, 0.32, '#9a968c', '#77736b').mul(vec3(0.95, 0.97, 0.92));
  const moss = mix(color('#3f6a2a'), color('#6f9a3a'), n01(positionWorld.mul(1.3)));
  const up = smoothstep(0.35, 0.85, normalWorld.y).mul(smoothstep(0.3, 0.6, n01(positionWorld.mul(0.7))));
  return finish(mix(rock, moss, up.mul(0.85)), float(0.9));
}

/**
 * Forest floor for terrain and shoulders: moss and dark earth with fallen bamboo leaves, rock on
 * steep slopes, raked gravel in the temple grounds. Attribute `blend` = (dirt, field, mud, gravel).
 */
export function forestFloor(T: TexLib): THREE.MeshStandardNodeMaterial {
  const w = attribute('blend', 'vec4');
  const xz = positionWorld.xz;
  const grass = sample(T.grass, xz.mul(0.16), '#4f8f3a', '#3a6f2c');
  const tint = n01(xz.mul(0.02));
  // forest floor: brown-olive leaf litter with patches of deep blue-green moss
  const earth = sample(T.dirt, xz.mul(0.22), '#5e4632', '#4a3626').mul(vec3(0.74, 0.66, 0.56));
  const litterCol = mix(earth.mul(vec3(0.95, 0.95, 0.8)), color('#6a6a3e'), n01(xz.mul(0.6)).mul(0.7).add(0.2));
  const moss = grass.mul(mix(vec3(0.42, 0.62, 0.4), vec3(0.55, 0.75, 0.42), tint));
  const mossW = smoothstep(0.38, 0.62, n01(xz.mul(0.045).add(vec2(7.3, 1.9))).add(n01(xz.mul(0.25)).mul(0.25)));
  let col: Node = mix(litterCol, moss, mossW);
  // fallen bamboo leaves: small pale-yellow / ochre flecks
  const fleck = n01(xz.mul(2.7)).mul(n01(xz.mul(5.3).add(vec2(3.1, 9.7))));
  const leafCol = mix(color('#c9b86a'), color('#a7783e'), n01(xz.mul(1.7)));
  col = mix(col, leafCol, smoothstep(0.4, 0.48, fleck).mul(0.9));
  // shoulders / road side: trodden earth
  col = mix(col, earth.mul(1.08), clamp(w.x, 0, 1).mul(0.85));
  // steep slopes: wet rock with a moss cap
  const slope = float(1).sub(normalWorld.y);
  const strata = n01(vec2(positionWorld.y.mul(0.55), xz.x.add(xz.y).mul(0.04)));
  const drip = smoothstep(0.55, 0.75, n01(vec2(xz.x.add(xz.y).mul(0.35), positionWorld.y.mul(0.04))));
  const rock = mix(triplanar(T.rock, 0.33, '#8a877e', '#5f5c56').mul(vec3(0.74, 0.78, 0.74)).mul(mix(float(0.62), float(1.12), strata)),
    color('#3f5a2c'), drip.mul(0.7));
  col = mix(col, rock, smoothstep(0.38, 0.62, slope.add(n01(xz.mul(0.3)).mul(0.15))));
  // raked gravel (temple grounds)
  const rake = smoothstep(0.35, 0.5, abs(fract(positionWorld.x.add(positionWorld.z).mul(0.9)).sub(0.5)));
  const gravel = mix(color('#b8b3a6'), color('#d3cec0'), n01(xz.mul(3.1))).mul(mix(float(0.9), float(1.0), rake));
  col = mix(col, gravel, clamp(w.w, 0, 1));
  col = mix(col, color('#4a3a2a'), clamp(w.z, 0, 1));
  return finish(col, float(0.96), mix(float(0.85), float(1), tint));
}

/**
 * Road: worn flagstones (worley cells) on the main road, packed earth on the dirt trail, raked
 * gravel in the courtyard. Red / cream kerbs in corners, the chequered start line, moss in the
 * joints and at the edges. The bridge deck is cut out (3D planks there).
 */
export function flagstoneRoad(T: TexLib): THREE.MeshStandardNodeMaterial {
  const lat = uv().x, s = uv().y;
  const hw = attribute('hw', 'float');
  const kerb = attribute('kerb', 'vec2');
  const look = attribute('look', 'vec3');
  const main = attribute('main', 'float');
  const p = positionWorld.xz.mul(1.25);
  const wv = mx_worley_noise_vec2(p);
  const cell = wv.y.sub(wv.x); // F2 - F1: small along the joints
  const id = n01(vec2(wv.x.mul(5.1), wv.y.mul(3.3)));
  const raw = sample(T.rock, positionWorld.xz.mul(0.3), '#8d8a82', '#6f6c66');
  const grey = vec3(raw.dot(vec3(0.3, 0.59, 0.11)));
  const base = mix(raw, grey, 0.65).mul(vec3(0.93, 0.95, 0.97));
  const tone = n01(positionWorld.xz.mul(0.9));
  const stone = base.mul(mix(float(0.78), float(1.12), tone)).mul(mix(float(0.9), float(1.05), id));
  const joint = float(1).sub(smoothstep(0.03, 0.09, cell));
  const mossJ = mix(color('#3c5a28'), color('#2c2a24'), n01(p.mul(2.0)));
  let col: Node = mix(stone, mossJ, joint.mul(0.85));
  const dirt = sample(T.dirt, positionWorld.xz.mul(0.25), '#7a5c40', '#5e4630').mul(0.85);
  const gravel = mix(color('#b4ae9f'), color('#8c8678'), n01(positionWorld.xz.mul(2.4)));
  const planks = sample(T.planks, vec2(s.mul(0.45), lat.mul(0.18)), '#8a6440', '#6d4c2f');
  col = mix(col, dirt, look.x);
  col = mix(col, planks, look.y);
  col = mix(col, gravel, look.z);
  const paved = clamp(float(1).sub(look.x).sub(look.y).sub(look.z), 0, 1);
  const dist = hw.sub(abs(lat));
  // mossy, darker edges
  col = mix(col, mix(color('#4d6a32'), color('#3a4a2a'), n01(p.mul(1.7))), float(1).sub(smoothstep(0.0, 0.9, dist)).mul(0.65));
  // wheel-worn centre band slightly lighter
  col = col.mul(mix(float(1), float(1.07), smoothstep(1.5, 3, dist).mul(paved)));
  const side = mix(kerb.x, kerb.y, step(0, lat));
  const kerbMask = float(1).sub(smoothstep(1.0, 1.05, dist)).mul(side);
  const stripe = step(0.5, fract(s.div(2.2)));
  col = mix(col, mix(color('#b8322a'), color('#efe6d2'), stripe), kerbMask);
  const inStart = step(s, 1.8).mul(main);
  const chk = abs(step(0.5, fract(lat.div(1.8))).sub(step(0.5, fract(s.div(1.8)))));
  col = mix(col, mix(color('#1c1c1c'), color('#f2efe6'), chk), inStart);
  // puddles in the joints and dips when wet
  const puddle = smoothstep(0.62, 0.72, n01(positionWorld.xz.mul(0.35))).mul(wet);
  const rough = mix(mix(float(0.86), float(0.7), joint), float(0.08), puddle);
  const m = finish(col.mul(mix(float(1), float(0.75), puddle)), rough);
  // cut the bridge deck out of the main road (alpha test -> discard)
  const onDeck = main.mul(step(deckRange.x, s)).mul(step(s, deckRange.y));
  m.opacityNode = float(1).sub(onDeck);
  m.alphaTest = 0.5;
  return m;
}

/** Bamboo cane material for fences and rails (instance colour carries the variation). */
export function caneMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const band = smoothstep(0.9, 0.97, fract(positionWorld.y.add(positionWorld.x.mul(0.3)).add(positionWorld.z.mul(0.3)).mul(1.6)));
  m.colorNode = mix(color('#a7b44f'), color('#e0d68d'), band.mul(0.6)).mul(mix(float(1), float(0.7), wet));
  m.roughnessNode = mix(float(0.55), float(0.25), wet);
  m.metalnessNode = float(0);
  return m;
}

export function plankMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const col = triplanar(T.planks ?? T.wood, 0.9, '#8a6440', '#6d4c2f').mul(vec3(1.0, 0.92, 0.82));
  return finish(col, float(0.82));
}

/** Waterfall sheet: streaks scrolling down, foam at the top and bottom, soft transparent edges. uv: x across, y up. */
export function waterfallMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u = uv().x, v = uv().y;
  const flow = v.mul(3.0).add(time.mul(1.6));
  const streak = n01(vec2(u.mul(14), flow)).mul(0.6).add(n01(vec2(u.mul(31), flow.mul(1.7))).mul(0.4));
  const foam = smoothstep(0.82, 1.0, v).add(float(1).sub(smoothstep(0.0, 0.12, v))).clamp(0, 1);
  const white = smoothstep(0.45, 0.8, streak).max(foam);
  m.colorNode = mix(color('#7fb7c4'), color('#f2f8f8'), white);
  m.emissiveNode = color('#c8e6ea').mul(white.mul(0.25));
  const edge = smoothstep(0.0, 0.14, u).mul(float(1).sub(smoothstep(0.86, 1.0, u)));
  m.opacityNode = edge.mul(mix(float(0.55), float(0.95), white));
  m.roughnessNode = float(0.15);
  m.metalnessNode = float(0);
  return m;
}

/** Foam / mist disc at the foot of the waterfall. uv 0..1. */
export function foamMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const d = uv().sub(vec2(0.5)).length().mul(2);
  const n = n01(vec2(uv().x.mul(9).add(time.mul(0.6)), uv().y.mul(9).sub(time.mul(0.4))));
  m.colorNode = color('#f4fafa');
  m.opacityNode = float(1).sub(smoothstep(0.3, 1.0, d)).mul(n.mul(0.6).add(0.3));
  m.roughnessNode = float(0.6);
  return m;
}
