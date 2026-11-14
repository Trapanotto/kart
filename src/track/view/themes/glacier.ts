// Theme 'glacier' (Gletscher-Gipfel). Owner: the team building track 4.
// Snow terrain and glacier roads, a backdrop of peaks over a sea of clouds, the ice tunnel, glowing
// ice props, snow fences, and the lap-event set pieces (icicles, avalanche) plus the cable car.
import * as THREE from 'three/webgpu';
import type { RenderContext } from '../../../core/types';
import type { BuiltTrack } from '../../builder';
import { LOD_PROPS, tileAlong } from '../props';
import { registerTheme } from '../themes';
import type { TexLib } from '../materials';
import { cloudSea, fallRing, peaks } from './glacier/backdrop';
import { avalancheView, cableCar, registerGlacierViews } from './glacier/events';
import {
  caveIceMaterial, cloudSeaMaterial, crackedIceMaterial, crevasseWarn, glacierRoadMaterial, peakMaterial, propIceMaterial, snowTerrainMaterial,
  wallIceMaterial,
} from './glacier/materials';
import { findWeather } from '../../../render/vfx/weather';
import { buildTunnel, tunnelIcicles } from './glacier/tunnel';
import { railMaterial, ribbonGeometry, snowFenceMaterial } from './glacier/fences';
import { Geo } from '../meshes';

for (const n of ['glacier_pine', 'glacier_station', 'glacier_hut', 'glacier_pylon', 'glacier_rock', 'glacier_rock_b']) LOD_PROPS.add(n);

const EXTRA = ['prop.glacier_icicle', 'prop.glacier_icicles', 'prop.glacier_snowfence', 'prop.glacier_gondola'];

/** Cracked-ice patches (surface 'water' on the lake detour) as their own overlay mesh. */
function crackPatches(t: BuiltTrack): THREE.BufferGeometry | null {
  const g = new Geo();
  const F = t.frameOn(t.paths[0], 0);
  for (const pt of t.patches) {
    if (pt.surface !== 'water') continue;
    const p = t.paths[pt.path];
    const n = Math.max(2, Math.ceil(pt.s1 - pt.s0));
    let prev: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const s = pt.s0 + ((pt.s1 - pt.s0) * k) / n;
      const row: number[] = [];
      for (let u = 0; u <= 4; u++) {
        t.frameOn(p, s, pt.latMin + ((pt.latMax - pt.latMin) * u) / 4, F);
        const v = F.pos.clone().addScaledVector(F.up, 0.03);
        if (p.index > 0) v.y -= 0.02;
        row.push(g.vert(v, { uv: [u / 4, k / n] }));
      }
      if (prev) for (let e = 0; e < 4; e++) g.quad(prev[e], prev[e + 1], row[e], row[e + 1]);
      prev = row;
    }
  }
  if (!g.count) return null;
  const geo = g.build();
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

async function extend(t: BuiltTrack, ctx: RenderContext, root: THREE.Group, T: TexLib) {
  const mobile = ctx.quality.tier === 'mobile';
  try { await ctx.assets.load(EXTRA); } catch { /* placeholders */ }
  const propIce = propIceMaterial();
  const snow = snowTerrainMaterial(T, mobile);
  snow.side = THREE.DoubleSide;

  // --- backdrop: terrain falls into the clouds, peaks on the horizon ---------------------------
  const old = root.getObjectByName('backdrop');
  if (old) old.visible = false;
  const ring = new THREE.Mesh(fallRing(t), snow);
  ring.name = 'glacier.fall';
  ring.receiveShadow = true;
  root.add(ring);
  const env = t.def.environment;
  const sun = new THREE.Vector3(...env.sunDir);
  const clouds = new THREE.Mesh(cloudSea(t), cloudSeaMaterial(sun));
  clouds.name = 'glacier.clouds';
  root.add(clouds);
  const mtn = new THREE.Mesh(peaks(t, mobile ? 14 : 22, mobile ? 10 : 16), peakMaterial(T));
  mtn.name = 'glacier.peaks';
  root.add(mtn);

  // --- ice on the kit props, ice wall slabs, snow fences --------------------------------------
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.material as THREE.Material)?.name ?? '';
    if (name.startsWith('M_glacier_') && name.endsWith('_ice')) m.material = propIce;
  });
  const stone = root.getObjectByName('barriers.stone') as THREE.Mesh | undefined;
  if (stone) stone.material = wallIceMaterial();
  // barriers: boundary fences become slatted ribbons (cheap, far from the road); the near 'fence'
  // runs get the snow fence model on desktop; on mobile every wooden barrier is a ribbon
  const ribbon = (list: typeof t.barriers, mat: THREE.Material, name: string, h: (b: (typeof t.barriers)[number]) => number) => {
    const geo = ribbonGeometry(list, h);
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = !mobile;
    root.add(m);
  };
  root.traverse((o) => { if (o.name === 'tile.fence_wood') o.visible = false; });
  const fenceMat = snowFenceMaterial();
  ribbon(t.barriers.filter((b) => b.kind === 'boundary'), fenceMat, 'glacier.boundary', () => 1.2);
  const nearFences = t.barriers.filter((b) => b.kind === 'fence');
  if (mobile) {
    const wood = root.getObjectByName('barriers.wood');
    if (wood) wood.visible = false;
    ribbon(nearFences, fenceMat, 'glacier.fences', (b) => b.height + 0.1);
    ribbon(t.barriers.filter((b) => b.kind === 'rail' || (b.kind === 'deckRail' && b.style === 'wood')), railMaterial(), 'glacier.rails', (b) => b.height);
  } else if (!tileAlong('glacier_snowfence', nearFences.map((b) => b.pts), ctx, root)) {
    ribbon(nearFences, fenceMat, 'glacier.fences', (b) => b.height + 0.1);
  }
  const patches = root.getObjectByName('patches');
  if (patches) patches.visible = false;
  const crackGeo = crackPatches(t);
  if (crackGeo) { const cm = new THREE.Mesh(crackGeo, crackedIceMaterial()); cm.name = 'glacier.cracks'; cm.renderOrder = 1; root.add(cm); }

  // --- the glacier tunnel ----------------------------------------------------------------------
  const a = t.paths[0].anchors;
  const caveIn = a.get('caveIn') ?? 0, caveOut = a.get('caveOut') ?? 0;
  const cave = caveIceMaterial(1);
  buildTunnel(t, ctx, root, {
    s0: caveIn - 1, s1: caveOut + 1,
    gaps: [[caveIn + 6.5, caveIn + 37.5], [caveOut - 48.5, caveOut - 17.5]],
    gapTop: 5.6, inner: cave, outer: snow,
  });
  tunnelIcicles(t, ctx, root, caveIn, caveOut, propIce);

  // --- crevasse jump: painted warning chevrons on the run-up to the ramp ----------------------
  const ramp = a.get('ramp');
  if (ramp !== undefined) crevasseWarn.value.set(ramp - 6 - 38, ramp - 6 - 3);

  // --- no snowfall inside the glacier tunnel (main path caveIn..caveOut; the lap-2 crack is open to
  // the sky and keeps its snow) ------------------------------------------------------------------
  const camLoc = { path: 0, progress: 0, lat: 0, halfWidth: 8, height: 0, onRoad: true, hint: -1 };
  const camPos = new THREE.Vector3();
  let snowK = 1;
  const inCave = (): boolean => {
    ctx.camera.getWorldPosition(camPos);
    t.locate(camPos, camLoc, camLoc);
    if (camLoc.path !== 0 || Math.abs(camLoc.lat) > camLoc.halfWidth + 1.5 || camLoc.height > 7.5 || camLoc.height < -3) return false;
    return camLoc.progress > caveIn + 2 && camLoc.progress < caveOut - 2;
  };

  // --- lap events and life -------------------------------------------------------------------
  registerGlacierViews(propIce);
  const aval = avalancheView(t, ctx, root, snow);
  const cable = cableCar(t, ctx, root);
  void THREE;
  return {
    update(dt: number) {
      aval.update(dt);
      cable?.update(dt);
      // fade the camera-following snow out inside the tunnel and back in outside (0.4 s)
      const w = findWeather(ctx.scene);
      if (w) {
        snowK += ((inCave() ? 0 : 1) - snowK) * Math.min(1, dt / 0.12);
        w.suppress(snowK);
      }
    },
    dispose() {
      const w = findWeather(ctx.scene);
      if (w) w.suppress(1);
      crevasseWarn.value.set(-1, -1);
    },
  };
}

registerTheme('glacier', {
  assets: EXTRA,
  backdropTrees: false,
  terrainMaterial: (T: TexLib, ctx: RenderContext) => snowTerrainMaterial(T, ctx.quality.tier === 'mobile'),
  roadMaterial: (T: TexLib) => glacierRoadMaterial(T),
  extend,
});
