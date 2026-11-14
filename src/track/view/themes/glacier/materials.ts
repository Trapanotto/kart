// Gletscher-Gipfel materials (TSL node materials, WebGPU + WebGL2). Owner: track 4.
// Snow that keeps its detail (cool albedo below pure white, wind ripples, blue hollows, sparkle),
// wind-swept ice and rock on steep ground, glossy blue ice roads vs matt packed snow, glowing ice.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, color, dot, float, fract, max, mix, mx_noise_float, normalize, normalWorld, positionWorld,
  mx_worley_noise_vec2, pow, sin, smoothstep, step, texture, time, uniform, uv, vec2, vec3, vertexColor,
} from 'three/tsl';
import type { TexLib, TexSet } from '../../materials';

type Node = any; // TSL nodes are loosely typed in @types/three

const n01 = (p: Node): Node => mx_noise_float(p).mul(0.5).add(0.5);

/** Ice cracks: thin lines along Worley cell borders (F2 - F1 small), 0..1. */
function cracks(p: Node, width: number): Node {
  const f = mx_worley_noise_vec2(p);
  return smoothstep(width, 0.0, f.y.sub(f.x));
}

/** World-space triplanar sample of a texture set (colour, roughness), procedural fallback. */
function triColor(set: TexSet | undefined, scale: number, a: string, b: string): Node {
  const p = positionWorld.mul(scale);
  const n = abs(normalWorld);
  const w = n.div(n.x.add(n.y).add(n.z));
  if (set?.color) {
    const t = set.color;
    return texture(t, p.zy).rgb.mul(w.x).add(texture(t, p.xz).rgb.mul(w.y)).add(texture(t, p.xy).rgb.mul(w.z));
  }
  return mix(color(a), color(b), n01(p.mul(0.7)).mul(0.6).add(n01(p.mul(2.3)).mul(0.4)));
}

/** Frozen lake (world x/z centre, radius) shared with the terrain material. */
export const LAKE = { x: 178, z: -268, r: 50 };

/** View-dependent glitter: tiny bright points that twinkle as the camera moves. */
function sparkle(scale: number, amount: number): Node {
  const p = positionWorld.mul(scale);
  const g = n01(p.add(cameraPosition.mul(0.11)));
  const g2 = n01(p.mul(1.7).sub(cameraPosition.mul(0.07)));
  const toCam = normalize(cameraPosition.sub(positionWorld));
  const facing = clamp(dot(normalWorld, toCam), 0, 1);
  return smoothstep(0.86, 0.93, g.mul(g2).mul(1.9)).mul(amount).mul(facing);
}

/**
 * Snow terrain: cool white with large soft tint variation, wind ripples, blue hollows, packed snow
 * near the roads (blend.x), wind-swept glacier ice on steep slopes, rock on the steepest, a glossy
 * frozen lake with cracks and dusting.
 */
export function snowTerrainMaterial(T: TexLib, mobile: boolean): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const xz = positionWorld.xz;
  const w = attribute('blend', 'vec4');
  const big = n01(xz.mul(0.013));
  const mid = n01(xz.mul(0.07).add(vec2(5.2, 1.3)));
  const fine = n01(xz.mul(0.55));
  const ripple = sin(dot(xz, vec2(0.83, 0.55)).mul(1.35).add(mid.mul(7.0))).mul(0.5).add(0.5);
  let col: Node = mix(color('#bccada'), color('#e2e9f1'), big.mul(0.55).add(fine.mul(0.25)).add(ripple.mul(0.2)));
  // blue hollows and drifts (the snow never turns into a flat white sheet)
  col = mix(col, color('#93aac8'), smoothstep(0.5, 0.18, big.mul(0.7).add(mid.mul(0.3))).mul(0.45));
  col = col.mul(mix(float(0.94), float(1.02), ripple));
  // packed, slightly grey snow along the roads
  col = mix(col, color('#aebccc'), clamp(w.x, 0, 1).mul(0.75));
  const slope = float(1).sub(normalWorld.y);
  const iceW = smoothstep(0.16, 0.3, slope.add(mid.sub(0.5).mul(0.14)));
  const ice = mix(color('#7fb2d8'), color('#b6d6ec'), fine.mul(0.6).add(big.mul(0.4)));
  col = mix(col, ice, iceW.mul(0.85));
  const high = smoothstep(52, 66, positionWorld.y.add(mid.mul(10)));
  const rockW = max(smoothstep(0.4, 0.56, slope.add(mid.sub(0.5).mul(0.22))), smoothstep(0.12, 0.3, slope.add(fine.sub(0.5).mul(0.3))).mul(high).mul(0.9));
  const rock = triColor(T.rock, 0.28, '#6d6f78', '#4b4d55').mul(color('#b9bfca'));
  // snow sticks to ledges in the rock faces
  const ledge = smoothstep(0.55, 0.72, n01(positionWorld.mul(0.32)).add(normalWorld.y.mul(0.35)));
  col = mix(col, rock, rockW.mul(float(1).sub(ledge.mul(0.75))));
  // frozen lake: dark clear ice with white cracks and wind-blown snow dust
  const dl = xz.sub(vec2(LAKE.x, LAKE.z)).length();
  const lakeW = smoothstep(LAKE.r + 2, LAKE.r - 3, dl);
  const crack = cracks(xz.mul(0.07), 0.05).add(cracks(xz.mul(0.25).add(7.1), 0.04).mul(0.6));
  const dust = smoothstep(0.45, 0.8, n01(xz.mul(0.05).add(vec2(2, 9))).add(ripple.mul(0.15)));
  let lake: Node = mix(color('#2e6f9e'), color('#5d9cc8'), n01(xz.mul(0.03)).mul(0.7).add(fine.mul(0.3)));
  lake = mix(lake, color('#e3eef8'), clamp(crack, 0, 1).mul(0.8));
  lake = mix(lake, color('#dbe7f2'), dust.mul(0.7));
  col = mix(col, lake, lakeW);
  m.colorNode = col;
  const rough = mix(mix(float(0.82), float(0.42), iceW), float(0.9), rockW);
  m.roughnessNode = mix(rough, mix(float(0.08), float(0.7), dust), lakeW);
  m.metalnessNode = float(0);
  if (!mobile) m.emissiveNode = vec3(1, 1, 1).mul(sparkle(9, 0.9).mul(float(1).sub(rockW)).mul(float(1).sub(lakeW.mul(0.6))));
  return m;
}

/**
 * Road: packed snow (look 'asphalt': matt grey-white with ski-groomer grooves and darker wheel tracks),
 * clear blue ice (look 'gravel': glossy, cracks, sparkle), deep snow (look 'dirt': bright and lumpy).
 * Kerbs red / white, white edge line, chequered start line like the default road.
 */
export function glacierRoadMaterial(T: TexLib): THREE.MeshPhysicalNodeMaterial {
  void T;
  const m = new THREE.MeshPhysicalNodeMaterial();
  const lat = uv().x, s = uv().y;
  const hw = attribute('hw', 'float');
  const kerb = attribute('kerb', 'vec2');
  const look = attribute('look', 'vec3');
  const main = attribute('main', 'float');
  const xz = positionWorld.xz;
  const fine = n01(xz.mul(0.6));
  const mid = n01(xz.mul(0.09));
  // packed snow
  const groove = smoothstep(0.35, 0.5, abs(fract(lat.mul(1.6)).sub(0.5))).mul(0.06);
  const track = smoothstep(1.4, 0.4, abs(abs(lat).sub(hw.mul(0.42)))).mul(0.07);
  let packed: Node = mix(color('#9eacbd'), color('#bcc8d5'), fine.mul(0.5).add(mid.mul(0.5)));
  packed = packed.mul(float(1).sub(groove).sub(track));
  // clear ice
  const crack = cracks(xz.mul(0.22), 0.06).add(cracks(xz.mul(0.7).add(3.3), 0.05).mul(0.5));
  let ice: Node = mix(color('#2a6ea8'), color('#5fa6d6'), mid.mul(0.7).add(fine.mul(0.3)));
  ice = mix(ice, color('#cfeaff'), clamp(crack, 0, 1).mul(0.4));
  ice = mix(ice, color('#cfe3f2'), smoothstep(0.7, 0.95, n01(xz.mul(0.07).add(4))).mul(0.5)); // drifted snow streaks
  const deep = mix(color('#cbd6e2'), color('#e2e9f1'), fine);
  let col: Node = packed;
  col = mix(col, deep, look.x);
  col = mix(col, color('#8a6440'), look.y);
  col = mix(col, ice, look.z);
  const dist = hw.sub(abs(lat));
  const paved = clamp(float(1).sub(look.x).sub(look.y), 0, 1);
  const line = smoothstep(0.26, 0.31, dist).mul(float(1).sub(smoothstep(0.5, 0.55, dist))).mul(paved);
  col = mix(col, color('#2d5fa8'), line.mul(look.z).mul(0.85));               // blue edge line on ice
  col = mix(col, color('#f6f7f8'), line.mul(float(1).sub(look.z)).mul(0.6));
  const side = mix(kerb.x, kerb.y, step(0, lat));
  const kerbMask = float(1).sub(smoothstep(1.0, 1.05, dist)).mul(side);
  const stripe = step(0.5, fract(s.div(2.6)));
  col = mix(col, mix(color('#d63c2c'), color('#f6f2ea'), stripe), kerbMask);
  const inStart = step(s, 1.8).mul(main);
  const chk = abs(step(0.5, fract(lat.div(1.8))).sub(step(0.5, fract(s.div(1.8)))));
  col = mix(col, mix(color('#1c1c1c'), color('#f6f6f2'), chk), inStart);
  m.colorNode = col;
  m.roughnessNode = mix(mix(mix(float(0.78), float(0.95), look.x), float(0.1), look.z), float(0.6), kerbMask);
  m.metalnessNode = float(0);
  m.clearcoatNode = look.z.mul(0.9);
  m.clearcoatRoughnessNode = float(0.06);
  m.emissiveNode = vec3(0.85, 0.95, 1).mul(sparkle(11, 0.55).mul(float(1).sub(look.z.mul(0.5))).mul(float(1).sub(kerbMask)));
  return m;
}

/** Glowing glacier ice (tunnel walls): strata, deep blue cracks, fresnel rim, inner glow. */
export function caveIceMaterial(glow = 1): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const p = positionWorld;
  const strata = sin(p.y.mul(2.1).add(n01(p.xz.mul(0.08)).mul(6))).mul(0.5).add(0.5);
  const big = n01(p.mul(0.06));
  const fine = n01(p.mul(0.45));
  const crack = cracks(p.xz.mul(0.09).add(p.y.mul(0.05)), 0.07);
  let col: Node = mix(color('#1f5f9c'), color('#7cc3ec'), big.mul(0.6).add(strata.mul(0.25)).add(fine.mul(0.15)));
  col = mix(col, color('#d9f4ff'), crack.mul(0.6));
  m.colorNode = col;
  m.roughnessNode = mix(float(0.12), float(0.4), fine);
  m.metalnessNode = float(0);
  const toCam = normalize(cameraPosition.sub(p));
  const fres = pow(float(1).sub(clamp(abs(dot(normalWorld, toCam)), 0, 1)), 3);
  const pulse = sin(time.mul(0.6).add(p.x.mul(0.05)).add(p.z.mul(0.04))).mul(0.12).add(0.88);
  m.emissiveNode = mix(color('#1d6fd0'), color('#7fe0ff'), big.add(crack.mul(0.6)).clamp(0, 1)).mul(float(0.55 * glow).mul(pulse)).add(color('#bfefff').mul(fres.mul(0.35 * glow)));
  return m;
}

/** Ice for kit props (vertex-coloured): keeps the baked colours, adds inner glow and a fresnel rim. */
export function propIceMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const vc = vertexColor();
  m.colorNode = vc.rgb.mul(vec3(0.85, 0.95, 1.05));
  m.roughnessNode = float(0.12);
  m.metalnessNode = float(0);
  const toCam = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(clamp(abs(dot(normalWorld, toCam)), 0, 1)), 2.5);
  m.emissiveNode = vc.rgb.mul(color('#5fb8ff')).mul(0.55).add(color('#d8f6ff').mul(fres.mul(0.45)));
  return m;
}

/** Barrier slabs that use the stone style (tunnel walls and the crack): plain ice. */
export function wallIceMaterial(): THREE.MeshStandardNodeMaterial {
  return caveIceMaterial(0.7);
}

/** Cloud sea far below: soft, slowly drifting cumulus tops, brighter towards the sun side. */
export function cloudSeaMaterial(sun: THREE.Vector3): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const xz = positionWorld.xz;
  const t = time.mul(0.6);
  const a = n01(xz.mul(0.004).add(vec2(t.mul(0.004), t.mul(0.0015))));
  const b = n01(xz.mul(0.013).sub(vec2(t.mul(0.006), 0)));
  const c = n01(xz.mul(0.04).add(vec2(0, t.mul(0.01))));
  const puff = a.mul(0.55).add(b.mul(0.3)).add(c.mul(0.15));
  const sunU = uniform(new THREE.Vector3().copy(sun).setY(0).normalize());
  const toward = dot(normalize(vec3(xz.x.sub(cameraPosition.x), 0, xz.y.sub(cameraPosition.z))), sunU).mul(0.5).add(0.5);
  let col: Node = mix(color('#9fb3cc'), color('#f3f7fb'), smoothstep(0.3, 0.75, puff));
  col = col.mul(mix(float(0.92), float(1.08), toward));
  m.colorNode = col;
  return m;
}

/** Distant mountains: rock with snow on the gentle parts, hazed towards the sky by distance. */
export function peakMaterial(T: TexLib): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ flatShading: true });
  const haze = attribute('haze', 'float');
  const slope = float(1).sub(normalWorld.y);
  const p = positionWorld;
  const n = n01(p.mul(0.02));
  const snowW = smoothstep(0.55, 0.42, slope.add(n.sub(0.5).mul(0.3))).max(smoothstep(0.62, 0.9, p.y.div(420).add(n.mul(0.2))).mul(0.5));
  const rock = triColor(T.rock, 0.02, '#5d6170', '#3f424d').mul(color('#8e96a6'));
  let col: Node = mix(rock, mix(color('#dce6f1'), color('#f2f6fa'), n), snowW);
  col = mix(col, color('#c7d8ea'), clamp(haze, 0, 0.85));
  m.colorNode = col;
  m.roughnessNode = float(0.9);
  m.metalnessNode = float(0);
  m.fog = true;
  return m;
}

/** Cracked thin ice / open water patches on the lake detour. uv = (across 0..1, along 0..1). */
export function crackedIceMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const u = uv().x, v = uv().y;
  const edge = max(abs(u.sub(0.5)), abs(v.sub(0.5))).mul(2);
  const rag = n01(positionWorld.xz.mul(0.8)).mul(0.35);
  const hole = smoothstep(0.78, 0.6, edge.add(rag));
  const crack = smoothstep(0.06, 0.0, abs(mx_noise_float(positionWorld.xz.mul(0.7))));
  const water = mix(color('#0e2f4a'), color('#1d527a'), n01(positionWorld.xz.mul(0.3).add(time.mul(0.1))));
  m.colorNode = mix(mix(color('#c8e2f4'), color('#ffffff'), crack), water, hole);
  m.roughnessNode = mix(float(0.3), float(0.05), hole);
  m.opacityNode = clamp(hole.add(crack.mul(0.8)).add(smoothstep(1.0, 0.8, edge.add(rag)).mul(0.5)), 0, 1);
  m.metalnessNode = float(0);
  return m;
}

/** Ground warning marker under a falling icicle: dark-blue disc with a pulsing ring. */
export function markerMaterial(strength: Node): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const d = uv().sub(0.5).length().mul(2);
  const ring = smoothstep(0.78, 0.86, d).mul(smoothstep(1.0, 0.92, d));
  const disc = smoothstep(1.0, 0.0, d).mul(0.55);
  m.colorNode = mix(color('#0b2a55'), color('#ff5a3c'), ring);
  m.opacityNode = max(disc, ring).mul(strength);
  return m;
}
