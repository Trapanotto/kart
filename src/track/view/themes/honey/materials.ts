// Honigfabrik materials (TSL node materials, WebGPU + WebGL2). Owner: honey track.
import * as THREE from 'three/webgpu';
import {
  abs, attribute, clamp, color, dot, float, floor, fract, max, min, mix, mx_noise_float, normalWorld, positionWorld, sin, smoothstep, step,
  texture, time, uniform, uv, vec2, vec3,
} from 'three/tsl';
import type { TexLib, TexSet } from '../../materials';

type Node = any; // TSL nodes are loosely typed in @types/three

const noise01 = (p: Node): Node => mx_noise_float(p).mul(0.5).add(0.5);

/** Map rectangle (e0..e1, n0..n1) in world space: x = -e, z = n. 1 inside, soft 0.6 m edge. */
export type Rect = { e0: number; e1: number; n0: number; n1: number };
function rectMask(r: Rect, soft = 0.6): Node {
  const x = positionWorld.x.negate(), z = positionWorld.z;
  const a = smoothstep(r.e0 - soft, r.e0 + soft, x).mul(float(1).sub(smoothstep(r.e1 - soft, r.e1 + soft, x)));
  const b = smoothstep(r.n0 - soft, r.n0 + soft, z).mul(float(1).sub(smoothstep(r.n1 - soft, r.n1 + soft, z)));
  return a.mul(b);
}
export function anyRect(rs: Rect[], soft = 0.6): Node {
  let m: Node = float(0);
  for (const r of rs) m = max(m, rectMask(r, soft));
  return m;
}

function tex(set: TexSet | undefined, uvn: Node, a: string, b: string): Node {
  if (set?.color) return texture(set.color, uvn).rgb;
  const n = noise01(uvn.mul(2.8)).mul(0.6).add(noise01(uvn.mul(9)).mul(0.4));
  return mix(color(a), color(b), n);
}

/** Square tiles with darker grout: returns [tile id hash 0..1, grout mask 0..1]. */
function tiles(p: Node, size: number, grout: number): [Node, Node] {
  const q: Node = p.div(size);
  const f: Node = fract(q);
  const g = max(
    float(1).sub(smoothstep(0, grout, f.x)).add(smoothstep(1 - grout, 1, f.x)),
    float(1).sub(smoothstep(0, grout, f.y)).add(smoothstep(1 - grout, 1, f.y)),
  ).clamp(0, 1);
  const id = fract(sin(dot(floor(q) as Node, vec2(12.9898, 78.233) as Node)).mul(43758.5453));
  return [id, g];
}

/** Honey stains: soft amber blobs, glossy. Returns weight 0..1. */
function stains(xz: Node, scale: number, amount: number): Node {
  const n = noise01(xz.mul(scale)).mul(0.7).add(noise01(xz.mul(scale * 3.1).add(vec2(5.2, 1.3))).mul(0.3));
  return smoothstep(1 - amount, 1 - amount + 0.08, n);
}

export interface RoadOpts { hall: Rect[]; elevatedY: number }

/**
 * Road: honey-stained warm asphalt in the yard, sealed concrete tiles inside the hall, steel diamond
 * plate on the elevated spiral / tunnel / roof, steel grating on the gantry ('planks' look), cobbles on
 * the crate cut ('gravel' look). Yellow edge lines, yellow / black kerbs, chequered start line.
 * Attributes: uv = (lateral m, along m), hw, kerb, look (dirt, planks, gravel), main.
 */
export function honeyRoadMaterial(T: TexLib, o: RoadOpts): THREE.MeshStandardNodeMaterial {
  const lat = uv().x, s = uv().y;
  const hw = attribute('hw', 'float');
  const kerb = attribute('kerb', 'vec2');
  const look = attribute('look', 'vec3');
  const main = attribute('main', 'float');
  const xz = positionWorld.xz;
  // outdoor asphalt, warmed
  const asph = tex(T.asphalt, xz.mul(0.2), '#5d5751', '#6c655c').mul(vec3(1.08, 1.0, 0.9));
  let col: Node = asph.mul(mix(float(0.9), float(1.08), noise01(xz.mul(0.05))));
  // indoor sealed concrete tiles
  const inHall = anyRect(o.hall, 0.8);
  const [tid, tg] = tiles(xz, 2.0, 0.035);
  const concrete = mix(color('#bdb3a3'), color('#cfc5b2'), tid.mul(0.6).add(noise01(xz.mul(0.7)).mul(0.4))).mul(float(1).sub(tg.mul(0.28)));
  col = mix(col, concrete, inHall);
  // elevated: steel diamond plate
  const up = smoothstep(o.elevatedY - 0.5, o.elevatedY + 0.5, positionWorld.y);
  const dp = positionWorld.xz.mul(4.5);
  const diamond = abs(fract(dp.x.add(dp.y)).sub(0.5)).add(abs(fract(dp.x.sub(dp.y)).sub(0.5)));
  const plate = mix(color('#969ca2'), color('#a6acb2'), smoothstep(0.38, 0.45, diamond)).mul(mix(float(0.9), float(1.05), noise01(xz.mul(0.3))));
  col = mix(col, plate, up);
  // gantry grating
  const gr = fract(vec2(lat.mul(3.0), s.mul(3.0)));
  const grate = mix(color('#3d3a36'), color('#c2c6ca'), max(step(0.78, gr.x), step(0.78, gr.y)));
  col = mix(col, grate, look.y);
  // crate cut: cobbles
  const [cid, cg] = tiles(xz.add(vec2(0, fract(floor(xz.x.div(0.9)).mul(0.5)).mul(0.9))), 0.9, 0.12);
  const cobble = mix(color('#a28d6c'), color('#8a7558'), cid).mul(float(1).sub(cg.mul(0.45)));
  col = mix(col, cobble, look.z);
  col = mix(col, color('#8b6c48'), look.x);
  // honey stains (more indoors and in the courtyard)
  const st = stains(xz, 0.16, 0.16).mul(float(1).sub(look.y));
  col = mix(col, color('#d48a16').mul(mix(float(0.8), float(1.05), noise01(xz.mul(2)))), st.mul(0.75));
  const paved = clamp(float(1).sub(look.x).sub(look.y).sub(look.z), 0, 1);
  const dist = hw.sub(abs(lat));
  // wheel wear
  col = col.mul(mix(float(1), float(0.94), smoothstep(1.5, 3, dist).mul(paved).mul(float(1).sub(up))));
  // yellow edge lines (white-ish on the roof)
  const line = smoothstep(0.24, 0.29, dist).mul(float(1).sub(smoothstep(0.5, 0.55, dist))).mul(paved);
  col = mix(col, mix(color('#f2c230'), color('#f5f1e6'), up), line.mul(0.95));
  // yellow / black kerbs
  const side = mix(kerb.x, kerb.y, step(0, lat));
  const kerbMask = float(1).sub(smoothstep(1.0, 1.05, dist)).mul(side);
  const stripe = step(0.5, fract(s.div(2.4)));
  col = mix(col, mix(color('#262422'), color('#f2c230'), stripe), kerbMask);
  // chequered start line
  const inStart = step(s, 1.8).mul(main);
  const chk = abs(step(0.5, fract(lat.div(1.8))).sub(step(0.5, fract(s.div(1.8)))));
  col = mix(col, mix(color('#1c1c1c'), color('#f6f6f2'), chk), inStart);
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = col;
  m.roughnessNode = mix(mix(float(0.88), float(0.55), inHall), float(0.22), st.mul(0.8)).sub(up.mul(0.25)).clamp(0.15, 1);
  m.metalnessNode = up.mul(0.35).add(look.y.mul(0.4));
  return m;
}

export interface TerrainOpts { hall: Rect[] }

/**
 * Terrain: golden-hour meadow with clover specks; 'gravel' patches = paved yard slabs outdoors and
 * sealed factory floor inside the hall; dirt on slopes.
 * Attribute `blend` = (dirt, field, mud, gravel).
 */
export function honeyTerrainMaterial(T: TexLib, o: TerrainOpts): THREE.MeshStandardNodeMaterial {
  const w = attribute('blend', 'vec4');
  const xz = positionWorld.xz;
  const g = tex(T.grass, xz.mul(0.2), '#7eae45', '#5f9638');
  const tint = noise01(xz.mul(0.011));
  let col: Node = g.mul(mix(vec3(1.02, 1.0, 0.78), vec3(1.12, 1.04, 0.72), tint));
  col = mix(col, vec3(col.dot(vec3(0.3, 0.59, 0.11))).mul(vec3(1.12, 1.0, 0.7)), 0.18);
  // tiny wildflower specks
  const speck = smoothstep(0.86, 0.9, noise01(xz.mul(1.7)));
  col = mix(col, mix(color('#f6d34a'), color('#f4f0e6'), noise01(xz.mul(0.4))), speck.mul(0.55));
  const dirt = tex(T.dirt, xz.mul(0.25), '#9a7650', '#7d5d3d');
  const slope = float(1).sub(normalWorld.y);
  col = mix(col, dirt, max(w.x, smoothstep(0.32, 0.55, slope).mul(0.85)).clamp(0, 1));
  // paved yard slabs / hall floor
  const inHall = anyRect(o.hall, 0.6);
  const [sid, sg] = tiles(xz, 3.0, 0.03);
  const slab = mix(color('#b2a690'), color('#c4b89f'), sid.mul(0.5).add(noise01(xz.mul(0.5)).mul(0.5))).mul(float(1).sub(sg.mul(0.3)));
  const [fid, fg] = tiles(xz, 2.0, 0.035);
  const floorC = mix(color('#c9bfae'), color('#d7cdb9'), fid.mul(0.5)).mul(float(1).sub(fg.mul(0.25)));
  const paving = mix(slab, floorC, inHall);
  const st = stains(xz, 0.12, 0.12);
  const pavedCol = mix(paving, color('#d08a1a'), st.mul(0.6));
  col = mix(col, pavedCol, w.w);
  // flower fields: alternating sunflower-yellow and lavender rows with leafy gaps
  const rowU = fract(positionWorld.x.mul(0.25).add(positionWorld.z.mul(0.04)));
  const band = step(0.5, fract(positionWorld.x.div(12)));
  const bloom = mix(color('#9b7ad8'), color('#ffc928'), band).mul(mix(float(0.8), float(1.1), noise01(xz.mul(1.6))));
  const rowMask = smoothstep(0.15, 0.3, rowU).mul(float(1).sub(smoothstep(0.7, 0.85, rowU)));
  const field = mix(color('#4f7f31'), bloom, rowMask.mul(0.85));
  col = mix(col, field, w.y);
  col = mix(col, color('#5d4630'), w.z);
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = col;
  m.roughnessNode = mix(float(0.97), mix(float(0.85), float(0.3), st), w.w);
  m.metalnessNode = float(0);
  return m;
}

/** Glossy honey surface: slow flowing bands, warm subsurface-like glow, bright fresnel rim. */
export function honeyMaterial(opts: { flow?: [number, number]; glow?: number } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const [fx, fz] = opts.flow ?? [0.15, 0.08];
  const p = positionWorld.xz.add(vec2(time.mul(fx), time.mul(fz)));
  const n = noise01(p.mul(0.35)).mul(0.6).add(noise01(p.mul(1.3).add(vec2(3.1, 7.7))).mul(0.4));
  const swirl = sin(n.mul(9).add(time.mul(0.6))).mul(0.5).add(0.5);
  m.colorNode = mix(color('#c56d08'), color('#ffb52a'), n.mul(0.7).add(swirl.mul(0.3)));
  m.emissiveNode = mix(color('#7a3500'), color('#ff9a1a'), swirl.mul(n)).mul(opts.glow ?? 0.35);
  m.roughnessNode = float(0.12);
  m.metalnessNode = float(0.0);
  return m;
}

/** Conveyor belt rubber with chevrons running along uv.y at `speed` m/s (negative = backwards). */
export function beltMaterial(speed: number): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const u = uv().x, v = uv().y.sub(time.mul(speed));
  const dir = speed >= 0 ? 1 : -1;
  const chev = fract(v.mul(0.33 * dir).sub(abs(u.sub(0.5)).mul(0.7)));
  const arrow = smoothstep(0.42, 0.47, chev).mul(float(1).sub(smoothstep(0.62, 0.67, chev)));
  const slat = smoothstep(0.85, 0.95, fract(v.mul(1.25)));
  const edge = float(1).sub(smoothstep(0.04, 0.07, u)).add(smoothstep(0.93, 0.96, u)).clamp(0, 1);
  let col: Node = mix(color('#3b3734'), color('#2b2826'), slat);
  col = mix(col, speed >= 0 ? color('#f2c230') : color('#e2553f'), arrow.mul(0.9));
  col = mix(col, color('#f2c230'), edge);
  m.colorNode = col;
  m.emissiveNode = (speed >= 0 ? color('#ffb21e') : color('#ff4a2a')).mul(arrow.mul(0.45));
  m.roughnessNode = mix(float(0.75), float(0.5), arrow);
  m.metalnessNode = float(0);
  return m;
}

/** Painted steel (yellow) for rails, deck sides and the gantry. */
export function paintMaterial(hex = '#f2c230', rough = 0.5): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const n = noise01(positionWorld.mul(0.8));
  m.colorNode = color(hex).mul(mix(float(0.86), float(1.04), n));
  m.roughnessNode = float(rough);
  m.metalnessNode = float(0.25);
  return m;
}

/** Concrete crash barrier with yellow / black chevrons on its upper half (world-space). */
export function barrierMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const band = smoothstep(0.35, 0.4, fract(p.y.add(10).div(1.0)));
  const diag = step(0.5, fract(p.x.add(p.z).add(p.y).mul(0.7)));
  const conc = mix(color('#b9b1a3'), color('#cdc6b8'), noise01(p.mul(1.3)));
  m.colorNode = mix(conc, mix(color('#2a2826'), color('#f2c230'), diag), band.mul(0.92));
  m.roughnessNode = float(0.8);
  m.metalnessNode = float(0);
  return m;
}

/** Steel deck body (spiral, tunnel floor, chute) with rivet lines. */
export function deckMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const rivet = smoothstep(0.8, 0.9, noise01(p.mul(0.4))).mul(0.2);
  m.colorNode = mix(color('#d79b22'), color('#e8b23a'), noise01(p.mul(0.25))).sub(rivet);
  m.roughnessNode = float(0.55);
  m.metalnessNode = float(0.3);
  m.side = THREE.DoubleSide;
  return m;
}

/** Brick / cream factory facade with window rows (world-space, for procedural building walls). */
export function facadeMaterial(baseY: number): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld;
  const along = p.x.add(p.z);
  const y = p.y.sub(baseY);
  const brick = mix(color('#b8664a'), color('#a2563d'), noise01(vec2(along.mul(2.2), y.mul(5))));
  const course = smoothstep(0.85, 0.95, fract(y.mul(3.3)));
  let col: Node = brick.mul(float(1).sub(course.mul(0.15)));
  // window rows: 2.6 m wide every 5 m, between 1.6 m and 5.6 m
  const wx = fract(along.div(5.0));
  const win = step(0.2, wx).mul(step(wx, 0.72)).mul(step(1.6, y)).mul(step(y, 5.6));
  const pane = fract(along.mul(1.0)).mul(1);
  const frame = max(smoothstep(0.92, 0.97, pane), smoothstep(0.9, 0.95, fract(y.mul(0.5))));
  const glass = mix(color('#6d93a8'), color('#ffd98a'), smoothstep(2.5, 5.6, y).mul(0.5));
  col = mix(col, mix(glass, color('#3b3a38'), frame), win);
  // cream cornice under the roof edge handled by the caller (separate strip)
  m.colorNode = col;
  m.emissiveNode = color('#ffb84d').mul(win.mul(float(1).sub(frame)).mul(0.25));
  m.roughnessNode = mix(float(0.85), float(0.25), win);
  m.metalnessNode = float(0);
  return m;
}

/** Hall roof: corrugated sheets with skylight strips; double-sided, does not cast shadows. */
export function roofMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const p = positionWorld;
  const corr = sin(p.x.mul(6)).mul(0.5).add(0.5);
  const sky = step(0.8, fract(p.x.negate().div(13.0).add(0.2)));
  const top = step(0, normalWorld.y);
  const sheet = mix(color('#7f8a86'), color('#97a29c'), corr.mul(0.5)).mul(mix(float(0.8), float(1), top));
  m.colorNode = mix(sheet, color('#fff1c8'), sky.mul(0.9));
  m.emissiveNode = color('#ffe2a0').mul(sky.mul(float(1).sub(top)).mul(0.9));
  m.roughnessNode = mix(float(0.6), float(0.2), sky);
  m.metalnessNode = float(0.2);
  return m;
}

/** Pipe tunnel: riveted copper plates, warm lamp strips along the crown. uv = (around 0..1, along m). */
export function tunnelMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const a = uv().x, s = uv().y;
  const plate = max(smoothstep(0.93, 0.98, fract(s.div(3.0))), smoothstep(0.9, 0.96, fract(a.mul(8))));
  const base = mix(color('#b8692f'), color('#cf8040'), noise01(vec2(a.mul(9), s.mul(0.4))));
  const lamp = smoothstep(0.47, 0.49, a).mul(float(1).sub(smoothstep(0.51, 0.53, a))).mul(step(0.5, fract(s.div(4))));
  const ring = smoothstep(0.96, 0.99, fract(s.div(6)));
  let col: Node = mix(base, color('#7c3f1a'), plate.mul(0.6));
  col = mix(col, color('#f2c230'), ring);
  col = mix(col, color('#fff0c0'), lamp);
  m.colorNode = col;
  m.emissiveNode = color('#ffc76a').mul(lamp.mul(2.2));
  m.roughnessNode = float(0.45);
  m.metalnessNode = float(0.55);
  return m;
}

/** Emissive warm light (lamp strips, signs). */
export function glowMaterial(hex = '#ffcf7a', k = 2): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = color(hex);
  m.emissiveNode = color(hex).mul(k);
  m.roughnessNode = float(0.4);
  return m;
}

/** Uniform 0..1 for pulsing things from JS. */
export function pulseUniform() { return uniform(0); }
export { min };

/**
 * Start gate banner (replaces the kit's blank 'M_start_gate_banner'): honeycomb on amber, bee stripes at
 * both ends, a glowing golden hex in the middle, dark brown hems with honey drips. Purely procedural
 * (no texture, no extra geometry) and mirror-symmetric, so it reads the same from both faces (the kit
 * banner's planar UVs are mirrored on the back face). UV 0..1 across the 18.6 x 2.05 m quad.
 */
export function honeyBannerMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  m.name = 'M_honey_gate_banner';
  const W = 18.6, H = 2.05;
  const u: Node = uv().x, v: Node = uv().y;
  const px: Node = abs(u.sub(0.5)).mul(W); // metres from the centre, mirrored
  const py: Node = v.mul(H);
  // honeycomb: hex grid (flat rows), cell 0.42 m across
  const cs = 0.24;
  const p: Node = vec2(px, py).div(cs);
  const s: Node = vec2(1, 1.7320508);
  const a: Node = p.sub(s.mul(floor(p.div(s)).add(0.5)));
  const pb: Node = p.sub(s.mul(0.5));
  const b: Node = pb.sub(s.mul(floor(pb.div(s)).add(0.5)));
  const g: Node = dot(a, a).lessThan(dot(b, b)).select(a, b);
  const ag: Node = abs(g);
  const hex: Node = max(dot(ag, vec2(0.5, 0.8660254)), ag.x);
  const comb: Node = smoothstep(0.4, 0.47, hex);
  const cellShade: Node = float(1).sub(hex.mul(0.5)); // cells glow a little towards their centre
  let col: Node = mix(color('#f0a01a').mul(cellShade.mul(0.35).add(0.75)), color('#9a5208'), comb);
  // golden hex emblem in the middle with a dark outline
  const e: Node = vec2(px, py.sub(H / 2)).div(0.82);
  const ae: Node = abs(e);
  const eh: Node = max(dot(ae, vec2(0.5, 0.8660254)), ae.x);
  const emblem: Node = float(1).sub(smoothstep(0.9, 0.93, eh));
  const outline: Node = smoothstep(0.84, 0.87, eh).mul(emblem);
  col = mix(col, mix(color('#ffd24a'), color('#3a2108'), outline), emblem);
  // bee stripes towards both ends (diagonal, mirrored)
  const ends: Node = smoothstep(W / 2 - 2.0, W / 2 - 1.95, px);
  const stripe: Node = step(0.5, fract(px.add(py).mul(1.25)));
  col = mix(col, mix(color('#2a1a0a'), color('#ffd23a'), stripe), ends);
  // hems: dark brown top and bottom, honey drips hanging off the top hem
  const drip: Node = sin(px.mul(3.1)).abs().pow(10).mul(0.22).add(sin(px.mul(1.3).add(0.7)).abs().pow(16).mul(0.14));
  const dripLen: Node = drip.mul(H * 0.45);
  const top: Node = smoothstep(float(H - 0.16).sub(dripLen), float(H - 0.15).sub(dripLen), py);
  const bottom: Node = float(1).sub(smoothstep(0.12, 0.13, py));
  const hem: Node = max(top, bottom);
  col = mix(col, color('#4a2a0c'), hem);
  m.colorNode = col;
  m.roughnessNode = mix(float(0.55), float(0.3), emblem.add(top.mul(0.6)).clamp(0, 1));
  m.emissiveNode = color('#ffb020').mul(emblem.mul(float(1).sub(outline)).mul(0.35));
  return m;
}
