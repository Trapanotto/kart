// Honigfabrik set pieces on the render side: belts, presses, honey flood, pipe tunnel, the packing
// house under the roof road, the hall roof and lintels. Owner: honey track. Reads sim / track state only.
import * as THREE from 'three/webgpu';
import type { RenderContext } from '../../../../core/types';
import type { BuiltTrack } from '../../../builder';
import { resolveProgress, wrapS } from '../../../path';
import { beltLayout, pressLayout, pressPhase } from '../../../scripts/honig';
import { G0, HALL } from '../../../tracks/honigfabrik';
import { Geo } from '../../meshes';
import type { ThemeExtras } from '../../themes';
import type { TexLib } from '../../materials';
import {
  barrierMaterial, beltMaterial, deckMaterial, facadeMaterial, glowMaterial, honeyMaterial, paintMaterial, roofMaterial, tunnelMaterial,
} from './materials';

/** Packing-house walls stand this far beyond the road edge; the strip between is a green roof. */
export const ROOF_EDGE = 6.5;

function greenRoofMaterial(): THREE.MeshStandardNodeMaterial {
  const m = paintMaterial('#6f9a3e', 0.95);
  m.side = THREE.DoubleSide;
  return m;
}

const F = () => ({ pos: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), halfWidth: 0 });

function add(root: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, name: string, cast = false, receive = true): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.name = name;
  o.castShadow = cast;
  o.receiveShadow = receive;
  root.add(o);
  return o;
}

/** Ribbon on a path between s0..s1 and lat0..lat1, lifted along the road normal. uv = (0..1 across, s). */
function ribbon(t: BuiltTrack, path: number, s0: number, s1: number, l0: number, l1: number, lift: number, cols = 4, skirt = 0): THREE.BufferGeometry {
  const g = new Geo();
  const p = t.paths[path];
  const f = F();
  const n = Math.max(2, Math.ceil(Math.abs(s1 - s0)));
  let prev: number[] | null = null;
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    const row: number[] = [];
    const lats: number[] = [];
    for (let c = 0; c <= cols; c++) lats.push(l0 + ((l1 - l0) * c) / cols);
    if (skirt > 0) { lats.unshift(l0 - skirt * 0.6); lats.push(l1 + skirt * 0.6); }
    lats.forEach((l, c) => {
      t.frameOn(p, s, l, f);
      const edge = skirt > 0 && (c === 0 || c === lats.length - 1);
      const v = f.pos.clone().addScaledVector(f.up, edge ? lift - skirt : lift);
      if (path > 0) v.y -= 0.02;
      row.push(g.vert(v, { uv: [(l - l0) / Math.max(1e-3, l1 - l0), s - s0] }));
    });
    if (prev) for (let c = 0; c < row.length - 1; c++) g.quad(prev[c], prev[c + 1], row[c], row[c + 1]);
    prev = row;
  }
  const geo = g.build();
  // faces up
  const nrm = geo.getAttribute('normal');
  let up = 0;
  for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
  if (up < 0) {
    const ix = geo.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) { const a = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, a); }
    geo.computeVertexNormals();
  }
  return geo;
}

interface Flood { tag: string; mesh: THREE.Mesh; level: number }

export function buildSetPieces(t: BuiltTrack, ctx: RenderContext, root: THREE.Group, T: TexLib): ThemeExtras {
  const mobile = ctx.quality.tier === 'mobile';
  const main = t.paths[0];
  const at = (p: string) => wrapS(main, resolveProgress(main, p));
  const f = F();

  // --- restyle the shared track pieces ----------------------------------------------------
  const set = (name: string, m: THREE.Material | null) => root.traverse((o) => {
    if (o.name !== name) return;
    if (m) (o as THREE.Mesh).material = m; else o.visible = false;
  });
  set('patches', null); // our honey replaces the sand-coloured decals
  set('deck.stone', deckMaterial());
  set('deck.wood', paintMaterial('#e3a826', 0.45));
  set('barriers.stone', barrierMaterial());
  set('barriers.wood', paintMaterial('#f2c230', 0.45));

  // --- conveyor belts -------------------------------------------------------------------------
  const belts = beltLayout(t);
  for (const b of belts) {
    const geo = ribbon(t, 0, b.s0, b.s1, b.latMin + 0.15, b.latMax - 0.15, 0.03, 2);
    add(root, geo, beltMaterial(b.speed), 'honey.belt');
  }
  {
    // divider strip and the end drums
    add(root, ribbon(t, 0, belts[0].s0, belts[0].s1, -0.35, 0.35, 0.035, 1), paintMaterial('#2a2826', 0.6), 'honey.beltDivider');
    const drum = new THREE.CylinderGeometry(0.32, 0.32, 1, 12);
    drum.rotateZ(Math.PI / 2);
    const im = new THREE.InstancedMesh(drum, paintMaterial('#f2c230', 0.4), belts.length * 2);
    let k = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const b of belts) for (const s of [b.s0, b.s1]) {
      t.frameOn(main, s, (b.latMin + b.latMax) / 2, f);
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right.clone().negate(), f.up, f.forward));
      m4.compose(f.pos.clone().addScaledVector(f.up, -0.22), q, new THREE.Vector3(b.latMax - b.latMin, 1, 1));
      im.setMatrixAt(k++, m4);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'honey.beltDrums';
    root.add(im);
  }

  // --- stamping presses ------------------------------------------------------------------------
  const presses: { head: THREE.Object3D | null; lamp: THREE.Object3D | null; k: number }[] = [];
  const pkey = mobile && ctx.assets.has('prop.honey_press.lod1') ? 'prop.honey_press.lod1' : 'prop.honey_press';
  pressLayout(t).forEach((p, k) => {
    t.frameOn(main, p.s, p.lat, f);
    const o = ctx.assets.model(pkey);
    o.position.copy(f.pos);
    // model +X (column) = the road's left; right-hand presses turn around
    o.rotation.y = Math.atan2(f.forward.x, f.forward.z) + (p.side > 0 ? Math.PI : 0);
    o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    root.add(o);
    presses.push({ head: o.getObjectByName('head') ?? null, lamp: o.getObjectByName('lamp') ?? null, k });
  });

  // --- honey flood -------------------------------------------------------------------------------
  const floods: Flood[] = [];
  const honey = honeyMaterial();
  for (const pt of t.patches) {
    const geo = ribbon(t, pt.path, pt.s0 - 0.6, pt.s1 + 0.6, pt.latMin, pt.latMax, 0.07, 6, 0.3);
    const mesh = add(root, geo, honey, pt.tag ? `honey.flood.${pt.tag}` : 'honey.puddle');
    if (pt.tag) {
      const on = t.state.tags.get(pt.tag) ?? true;
      floods.push({ tag: pt.tag, mesh, level: on ? 1 : 0 });
      mesh.position.y = on ? 0 : -0.45;
      mesh.visible = on;
    }
  }

  // --- pipe tunnel --------------------------------------------------------------------------------
  {
    const s0 = at('tunnel') - 10, s1 = at('tunnelEnd') + 8;
    const g = new Geo();
    const n = Math.ceil(s1 - s0), segs = mobile ? 12 : 20;
    let prev: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      t.frameOn(main, s, 0, f);
      const R = f.halfWidth + 1.7;
      const row: number[] = [];
      for (let c = 0; c <= segs; c++) {
        const a = -0.12 + ((Math.PI + 0.24) * c) / segs;
        const v = f.pos.clone().addScaledVector(f.right, Math.cos(a) * R).addScaledVector(f.up, Math.sin(a) * R * 0.92 - 0.6);
        row.push(g.vert(v, { uv: [c / segs, s - s0] }));
      }
      if (prev) for (let c = 0; c < segs; c++) g.quad(prev[c], prev[c + 1], row[c], row[c + 1]);
      prev = row;
    }
    add(root, g.build(), tunnelMaterial(), 'honey.tunnel', true);
    // portal rings
    const ringM = paintMaterial('#f2c230', 0.4);
    for (const s of [s0, s1]) {
      const rg = new Geo();
      t.frameOn(main, s, 0, f);
      const R = f.halfWidth + 1.7;
      const o: number[] = [], i: number[] = [];
      for (let c = 0; c <= segs; c++) {
        const a = -0.12 + ((Math.PI + 0.24) * c) / segs;
        for (const [rr, arr] of [[R + 1.0, o], [R - 0.05, i]] as [number, number[]][]) {
          arr.push(rg.vert(f.pos.clone().addScaledVector(f.right, Math.cos(a) * rr).addScaledVector(f.up, Math.sin(a) * rr * 0.92 - 0.6)));
        }
      }
      for (let c = 0; c < segs; c++) { rg.quad(o[c], o[c + 1], i[c], i[c + 1]); rg.quad(i[c], i[c + 1], o[c], o[c + 1]); }
      add(root, rg.build(), ringM, 'honey.tunnelPortal', true);
    }
  }

  // --- packing house under the roof road -------------------------------------------------------
  {
    const s0 = at('tunnelEnd') + 6, s1 = at('chute') + 2;
    const wall = new Geo(), cornice = new Geo();
    const n = Math.ceil((s1 - s0) / 2);
    for (const side of [-1, 1]) {
      let pw: number[] | null = null, pc: number[] | null = null;
      for (let k = 0; k <= n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        t.frameOn(main, s, 0, f);
        const lat = side * (f.halfWidth + ROOF_EDGE);
        t.frameOn(main, s, lat, f);
        const top = f.pos.y - 1.3;
        const ground = t.terrain.heightAt(f.pos.x, f.pos.z) - 0.5;
        const w = [wall.vert([f.pos.x, ground, f.pos.z]), wall.vert([f.pos.x, top, f.pos.z])];
        const cc = [cornice.vert([f.pos.x, top - 0.02, f.pos.z]), cornice.vert([f.pos.x, f.pos.y + 0.05, f.pos.z])];
        if (pw) {
          if (side > 0) wall.quad(pw[0], w[0], pw[1], w[1]); else wall.quad(w[0], pw[0], w[1], pw[1]);
        }
        if (pc) {
          if (side > 0) cornice.quad(pc[0], cc[0], pc[1], cc[1]); else cornice.quad(cc[0], pc[0], cc[1], pc[1]);
        }
        pw = w; pc = cc;
      }
    }
    // end walls
    for (const s of [s0, s1]) {
      t.frameOn(main, s, 0, f);
      const hw = f.halfWidth + ROOF_EDGE;
      const a = f.pos.clone().addScaledVector(f.right, -hw), b = f.pos.clone().addScaledVector(f.right, hw);
      const ga = t.terrain.heightAt(a.x, a.z) - 0.5, gb = t.terrain.heightAt(b.x, b.z) - 0.5;
      const ids = [wall.vert([a.x, ga, a.z]), wall.vert([b.x, gb, b.z]), wall.vert([a.x, a.y - 1.3, a.z]), wall.vert([b.x, b.y - 1.3, b.z])];
      wall.quad(ids[0], ids[1], ids[2], ids[3]);
      wall.quad(ids[1], ids[0], ids[3], ids[2]);
    }
    const wm = facadeMaterial(G0);
    wm.side = THREE.DoubleSide;
    add(root, wall.build(), wm, 'honey.packingHouse', true);
    add(root, cornice.build(), paintMaterial('#f1e2bd', 0.7), 'honey.packingCornice', false);
    // green roof beside the road (bees, hives and flower boxes stand on it)
    for (const side of [-1, 1]) {
      const gr = new Geo();
      let prev: number[] | null = null;
      for (let k = 0; k <= n; k++) {
        const s = s0 + ((s1 - s0) * k) / n;
        t.frameOn(main, s, 0, f);
        const a = side * (f.halfWidth + 0.5), b = side * (f.halfWidth + ROOF_EDGE);
        const y = f.pos.y - 0.12;
        const pa = f.pos.clone().addScaledVector(f.right, a), pb = f.pos.clone().addScaledVector(f.right, b);
        const row = [gr.vert([pa.x, y, pa.z]), gr.vert([pb.x, y, pb.z])];
        if (prev) { if (side > 0) gr.quad(prev[0], prev[1], row[0], row[1]); else gr.quad(prev[1], prev[0], row[1], row[0]); }
        prev = row;
      }
      const geo = gr.build();
      const m = greenRoofMaterial();
      add(root, geo, m, 'honey.greenRoof', false);
    }
  }

  // --- hall roof, eave fascia and door lintels ----------------------------------------------------
  {
    const roof = new Geo();
    const eave = G0 + HALL.wallH + 2.8, ridge = G0 + HALL.wallH + 4.0;
    for (const b of HALL.bays) {
      const nm = (b.n0 + b.n1) / 2;
      for (const [na, nb] of [[b.n0 - 0.8, nm], [nm, b.n1 + 0.8]]) {
        const ya = na < nm ? eave : ridge, yb = nb > nm ? eave : ridge;
        const ids = [roof.vert([-(b.e0 - 0.8), ya, na]), roof.vert([-(b.e1 + 0.8), ya, na]), roof.vert([-(b.e0 - 0.8), yb, nb]), roof.vert([-(b.e1 + 0.8), yb, nb])];
        roof.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
    const rm = add(root, roof.build(), roofMaterial(), 'honey.hallRoof', false, true);
    rm.castShadow = false;
    // lintels over the doors and the clerestory fascia along the walls
    const box = new THREE.BoxGeometry(1, 1, 1);
    const lint: THREE.Matrix4[] = [];
    const bx = (e: number, n: number, y: number, we: number, wn: number, h: number) => lint.push(new THREE.Matrix4().compose(new THREE.Vector3(-e, y, n), new THREE.Quaternion(), new THREE.Vector3(we, h, wn)));
    const dS = HALL.doors.southWest, dN = HALL.doors.northWest;
    bx(HALL.bays[0].e0, (dS[0] + dS[1]) / 2, G0 + 9.2, 0.7, dS[1] - dS[0] + 3, 5.6);
    bx(HALL.bays[1].e0, (dN[0] + dN[1]) / 2, G0 + 9.2, 0.7, dN[1] - dN[0] + 3, 5.6);
    const im = new THREE.InstancedMesh(box, facadeMaterial(G0 - 4), lint.length);
    lint.forEach((m, k) => im.setMatrixAt(k, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    im.name = 'honey.lintels';
    root.add(im);
    // glowing sign strips over the doors
    const sign = new THREE.BoxGeometry(0.3, 1.0, 1);
    const sm = new THREE.InstancedMesh(sign, glowMaterial('#ffbf3a', 1.6), 2);
    sm.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(-(HALL.bays[0].e0 - 0.45), G0 + 8.6, (dS[0] + dS[1]) / 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, dS[1] - dS[0] - 2)));
    sm.setMatrixAt(1, new THREE.Matrix4().compose(new THREE.Vector3(-(HALL.bays[1].e0 - 0.45), G0 + 8.6, (dN[0] + dN[1]) / 2), new THREE.Quaternion(), new THREE.Vector3(1, 1, dN[1] - dN[0] - 2)));
    sm.computeBoundingSphere();
    sm.name = 'honey.doorSigns';
    root.add(sm);
  }
  void T;

  // --- animation ----------------------------------------------------------------------------------
  let version = -1;
  return {
    update(dt: number, c: RenderContext) {
      const time = c.sim?.time ?? c.time;
      for (const p of presses) {
        const ph = pressPhase(time, p.k);
        if (p.head) p.head.position.y = 0.05 + 4.35 * ph.h;
        if (p.lamp) {
          const on = ph.warn > 0 && Math.floor(time * 8) % 2 === 0;
          p.lamp.scale.setScalar(on ? 1.25 : 0.85);
          p.lamp.visible = ph.warn > 0 || ph.h < 1;
        }
      }
      if (t.state.version !== version) version = t.state.version;
      for (const fl of floods) {
        const want = t.state.tags.get(fl.tag) ? 1 : 0;
        if (fl.level !== want) {
          fl.level += Math.sign(want - fl.level) * Math.min(Math.abs(want - fl.level), dt * 0.45);
          const e = fl.level * fl.level * (3 - 2 * fl.level);
          fl.mesh.position.y = -0.45 * (1 - e);
        }
        fl.mesh.visible = fl.level > 0.01;
      }
    },
  };
}
