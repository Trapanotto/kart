// The breakable plank bridge: instanced planks per cell (shake while warned, tumble into the gorge
// when broken), log stringers, cross beams, rope rails and hangers. Reads the cell states written by
// src/track/scripts/bambus.ts; never writes sim state. Owner: track 2.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RenderContext } from '../../../../core/types';
import type { BuiltTrack } from '../../../builder';
import { bambusBuild, type BambusBuild } from '../../../scripts/bambus';
import type { TexLib } from '../../materials';
import { plankMaterial } from './materials';

const PITCH = 0.36;
const F = () => ({ pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 });

interface PlankRef { cell: number; base: THREE.Matrix4; seed: number }

function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface BridgeView { update(dt: number, ctx: RenderContext): void; dispose(): void }

export function buildBridge(t: BuiltTrack, ctx: RenderContext, root: THREE.Group, T: TexLib): BridgeView | null {
  const b: BambusBuild | undefined = bambusBuild(t);
  if (!b) return null;
  const main = b.main;
  const f = F();
  const basis = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  // --- planks: one instance per plank piece per cell ------------------------------------------
  const planks: PlankRef[] = [];
  const nPer = Math.floor(b.segLen / PITCH);
  b.cells.forEach((c, ci) => {
    const sa = b.s0 + c.seg * b.segLen;
    for (let k = 0; k < nPer; k++) {
      const s = sa + (k + 0.5) * (b.segLen / nPer);
      t.frameOn(main, s, 0, f);
      const hw = f.halfWidth;
      const l0 = b.laneEdges[c.lane] * hw, l1 = b.laneEdges[c.lane + 1] * hw;
      const jitter = (hash(ci * 131 + k) - 0.5) * 0.05;
      t.frameOn(main, s + jitter, (l0 + l1) / 2, f);
      basis.makeBasis(f.right.clone().negate(), f.up, f.forward);
      q.setFromRotationMatrix(basis);
      const pos = f.pos.clone().addScaledVector(f.up, -0.045);
      const w = (l1 - l0) - 0.05 + (c.lane === 0 ? 0.3 : 0) + (c.lane === 2 ? 0.3 : 0);
      const shift = c.lane === 0 ? -0.15 : c.lane === 2 ? 0.15 : 0;
      pos.addScaledVector(f.right, shift);
      const m = new THREE.Matrix4().compose(pos, q.clone(), new THREE.Vector3(w, 0.1, b.segLen / nPer - 0.05));
      planks.push({ cell: ci, base: m, seed: hash(ci * 977 + k * 13) });
    }
  });
  const plankGeo = new THREE.BoxGeometry(1, 1, 1);
  const im = new THREE.InstancedMesh(plankGeo, plankMaterial(T), planks.length);
  const col = new THREE.Color();
  planks.forEach((p, i) => {
    im.setMatrixAt(i, p.base);
    im.setColorAt(i, col.setHSL(0.07 + p.seed * 0.04, 0.12 + p.seed * 0.14, 0.5 + (p.seed - 0.5) * 0.22));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'bamboo.bridge.planks';
  im.computeBoundingSphere();
  root.add(im);
  const byCell: number[][] = b.cells.map(() => []);
  planks.forEach((p, i) => byCell[p.cell].push(i));
  const baseColors = planks.map((_, i) => { const cc = new THREE.Color(); im.getColorAt(i, cc); return cc; });

  // --- frame: stringers, cross beams, ropes and hangers (one merged mesh, vertex colours) -------
  const parts: THREE.BufferGeometry[] = [];
  const colored = (g: THREE.BufferGeometry, c: string) => {
    const cc = new THREE.Color(c);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = cc.r; arr[i * 3 + 1] = cc.g; arr[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    return g.index ? g.toNonIndexed() : g;
  };
  const tube = (pts: THREE.Vector3[], r: number, c: string, seg = 5) => {
    parts.push(colored(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(4, pts.length * 3), r, seg, false), c));
  };
  const fr = (s: number, lat: number, dy: number) => { t.frameOn(main, s, lat, f); return f.pos.clone().addScaledVector(f.up, dy); };
  const s0 = b.s0 - 0.6, s1 = b.s1 + 0.6;
  // log stringers under the lane edges and the outer edges (they stay when planks fall)
  for (const e of [-1.02, b.laneEdges[1], b.laneEdges[2], 1.02]) {
    const pts: THREE.Vector3[] = [];
    for (let s = s0; s <= s1 + 0.01; s += 3) pts.push(fr(s, e * f.halfWidth || e * 6, -0.24));
    // recompute with the correct half width per sample
    for (let k = 0; k < pts.length; k++) { const s = Math.min(s1, s0 + k * 3); t.frameOn(main, s, 0, f); pts[k].copy(fr(s, e * f.halfWidth, -0.24)); }
    tube(pts, 0.17, '#5a4030', 6);
  }
  // cross beams every 4.5 m (lashed logs under the planks)
  for (let s = s0 + 0.5; s <= s1; s += 4.5) {
    t.frameOn(main, s, 0, f);
    const hw = f.halfWidth + 0.7;
    tube([fr(s, -hw, -0.42), fr(s, 0, -0.45), fr(s, hw, -0.42)], 0.14, '#4a3426', 5);
  }
  // rope rails: catenary from the anchor posts (top 3.0 m) to 1.15 m at mid span, and a lower rope
  const span = (b.s1 - b.s0) / 2 + 1.0, mid = (b.s0 + b.s1) / 2;
  for (const side of [-1, 1]) {
    for (const [hTop, hMid] of [[3.0, 1.15], [1.8, 0.55]] as const) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 24; k++) {
        const s = mid - span + (2 * span * k) / 24;
        const u = (s - mid) / span;
        t.frameOn(main, Math.max(b.s0 - 1, Math.min(b.s1 + 1, s)), 0, f);
        pts.push(fr(s, side * (f.halfWidth + 0.45), hMid + (hTop - hMid) * u * u));
      }
      tube(pts, hTop > 2 ? 0.065 : 0.05, '#c9b07a', 5);
    }
    // hangers from the hand rope down to the outer stringer
    for (let s = b.s0 + 1.5; s < b.s1 - 1; s += 3) {
      const u = (s - mid) / span;
      t.frameOn(main, s, 0, f);
      const lat = side * (f.halfWidth + 0.45);
      const top = 1.15 + (3.0 - 1.15) * u * u;
      parts.push(colored(cylinderBetween(fr(s, lat, top), fr(s, side * (f.halfWidth + 0.1), -0.2), 0.025, 4), '#b89e6a'));
    }
  }
  const frameGeo = mergeGeometries(parts, false)!;
  frameGeo.computeVertexNormals();
  const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.castShadow = ctx.quality.tier !== 'mobile';
  frame.receiveShadow = true;
  frame.name = 'bamboo.bridge.frame';
  root.add(frame);

  // --- warning tape: glowing ribbons around warned / broken cells (two per cell, knee height) ----
  const tapeBase: THREE.Matrix4[] = [];
  b.cells.forEach((c) => {
    for (const end of [0.12, 0.88]) {
      const s = b.s0 + (c.seg + end) * b.segLen;
      t.frameOn(main, s, 0, f);
      const hw = f.halfWidth;
      const l0 = b.laneEdges[c.lane] * hw, l1 = b.laneEdges[c.lane + 1] * hw;
      t.frameOn(main, s, (l0 + l1) / 2, f);
      basis.makeBasis(f.right.clone().negate(), f.up, f.forward);
      tapeBase.push(new THREE.Matrix4().compose(f.pos.clone().addScaledVector(f.up, 0.55), new THREE.Quaternion().setFromRotationMatrix(basis), new THREE.Vector3(l1 - l0 - 0.2, 0.14, 0.06)));
    }
  });
  const tapeMat = new THREE.MeshStandardMaterial({ color: '#ff6a2a', emissive: '#ff4a10', emissiveIntensity: 1.6, roughness: 0.5 });
  const tape = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tapeMat, tapeBase.length);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < tapeBase.length; i++) tape.setMatrixAt(i, hidden);
  tape.frustumCulled = false;
  tape.name = 'bamboo.bridge.tape';
  root.add(tape);
  const tapeOn: boolean[] = b.cells.map(() => false);

  // --- per-frame: shaking and falling planks ---------------------------------------------------
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), rq = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const warnCol = new THREE.Color('#ff9a4a');
  const lastState: number[] = b.cells.map(() => -1);
  let tLocal = 0;
  return {
    update(dt, c) {
      tLocal += dt;
      const now = c.sim?.time ?? tLocal;
      let dirty = false, colorDirty = false;
      b.cells.forEach((cell, ci) => {
        const st = cell.state;
        const elapsed = Math.max(0, now - cell.since);
        if (st === 0) {
          if (lastState[ci] !== 0) {
            for (const i of byCell[ci]) { im.setMatrixAt(i, planks[i].base); im.setColorAt(i, baseColors[i]); }
            dirty = colorDirty = true;
          }
        } else if (st === 1) {
          // creaking: planks rattle more and more, glowing warning tint
          const amp = 0.02 + 0.07 * Math.min(1, elapsed / 3);
          const pulse = 0.5 + 0.5 * Math.sin(now * 12);
          for (const i of byCell[ci]) {
            const p = planks[i];
            p.base.decompose(pos, rq, sc);
            e.set(Math.sin(now * 37 + p.seed * 20) * amp, 0, Math.sin(now * 29 + p.seed * 9) * amp * 1.5);
            rq.multiply(new THREE.Quaternion().setFromEuler(e));
            pos.y += Math.sin(now * 41 + p.seed * 30) * amp * 0.6 - elapsed * 0.03;
            im.setMatrixAt(i, m4.compose(pos, rq, sc));
            im.setColorAt(i, col.copy(baseColors[i]).lerp(warnCol, 0.25 + 0.35 * pulse));
          }
          dirty = colorDirty = true;
        } else if (elapsed < 3.5 || lastState[ci] !== 2) {
          // falling: drop with gravity, tumble, then vanish
          for (const i of byCell[ci]) {
            const p = planks[i];
            if (elapsed > 3.4) { im.setMatrixAt(i, zero); continue; }
            const d = Math.max(0, elapsed - p.seed * 0.35);
            p.base.decompose(pos, rq, sc);
            pos.y -= 0.5 * 18 * d * d;
            pos.x += (p.seed - 0.5) * d * 1.5;
            e.set(d * (2 + p.seed * 4), d * (p.seed - 0.5) * 3, d * (1 + p.seed * 3));
            rq.multiply(new THREE.Quaternion().setFromEuler(e));
            im.setMatrixAt(i, m4.compose(pos, rq, sc));
            im.setColorAt(i, baseColors[i]);
          }
          dirty = colorDirty = true;
        }
        lastState[ci] = st === 2 && elapsed < 3.5 ? 3 : st;
      });
      let tapeDirty = false;
      b.cells.forEach((cell, ci) => {
        const on = cell.state > 0;
        if (on !== tapeOn[ci]) {
          tapeOn[ci] = on;
          tapeDirty = true;
          for (const k of [0, 1]) tape.setMatrixAt(ci * 2 + k, on ? tapeBase[ci * 2 + k] : hidden);
        }
      });
      if (tapeDirty) tape.instanceMatrix.needsUpdate = true;
      tapeMat.emissiveIntensity = 1.2 + 0.8 * Math.sin(now * 6);
      if (dirty) im.instanceMatrix.needsUpdate = true;
      if (colorDirty && im.instanceColor) im.instanceColor.needsUpdate = true;
      void one;
    },
    dispose() {
      im.geometry.dispose();
      frameGeo.dispose();
    },
  };
}

/** Cylinder between two points (radius r), as a non-indexed geometry. */
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 5): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1, true);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}
