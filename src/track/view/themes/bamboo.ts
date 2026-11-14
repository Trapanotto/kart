// Theme 'bamboo' (Bambus-Tempel). Owner: track 2.
// Forest-floor terrain, flagstone road, bamboo fences, mossy walls, the breakable plank bridge,
// waterfall, light shafts, distant bamboo, rain from lap 2 (wet materials, darker sky, heavier
// fog), the temple gong and the hazard views. Everything here only reads sim state.
import * as THREE from 'three/webgpu';
import type { RenderContext } from '../../../core/types';
import { env as renderEnv } from '../../../render/environment';
import { Weather } from '../../../render/vfx/weather';
import type { BambusState } from '../../scripts/bambus';
import { bambusBuild } from '../../scripts/bambus';
import { LOD_PROPS } from '../props';
import { registerTheme } from '../themes';
import { buildBridge } from './bamboo/bridge';
import { registerBambooEntityViews } from './bamboo/hazards';
import { deckRange, flagstoneRoad, forestFloor, wet } from './bamboo/materials';
import { buildDistantBamboo, buildWaterfall, restyleBarriers } from './bamboo/scenery';

for (const n of ['bamboo_clump', 'bamboo_arch', 'bamboo_stalks', 'bamboo_maple', 'bamboo_temple', 'bamboo_pagoda']) LOD_PROPS.add(n);

registerTheme('bamboo', {
  terrainMaterial: (T) => forestFloor(T),
  roadMaterial: (T) => flagstoneRoad(T),
  backdropTrees: false,
  async extend(track, ctx, root, T) {
    registerBambooEntityViews();
    try { await ctx.assets.load(['prop.bamboo_lantern_hang', 'prop.bamboo_log', 'prop.bamboo_clump.lod1']); } catch { /* placeholders */ }
    const b = bambusBuild(track);
    if (b) deckRange.value.set(b.s0 - 0.3, b.s1 + 0.3);
    wet.value = 0;
    restyleBarriers(track, ctx, root, T);
    const bridge = buildBridge(track, ctx, root, T);
    const fall = buildWaterfall(track, ctx, root);
    buildDistantBamboo(track, ctx, root);

    const gong = root.getObjectByName('gong');
    let rain: Weather | null = null;
    let base: { fog: number; top: THREE.Color; hor: THREE.Color; cloud: number; fogC: THREE.Color } | null = null;
    let w = 0;
    const tmpC = new THREE.Color();
    const applyWet = (k: number) => {
      wet.value = k;
      if (!base) return;
      renderEnv.fogDensity.value = base.fog * (1 + 0.9 * k);
      renderEnv.cloudCover.value = base.cloud + (0.95 - base.cloud) * k;
      renderEnv.skyTop.value.copy(base.top).lerp(tmpC.set('#7d8a8e'), k);
      renderEnv.skyHorizon.value.copy(base.hor).lerp(tmpC.set('#b9c2bd'), k);
      renderEnv.fogColor.value.copy(base.fogC).lerp(tmpC.set('#a9b5b0'), k);
    };
    const restore = () => {
      if (!base) return;
      applyWet(0);
      base = null;
    };

    return {
      update(dt: number, c: RenderContext) {
        bridge?.update(dt, c);
        fall?.update(dt);
        const st = (track.script as unknown as { state?: BambusState } | null)?.state;
        const raining = !!st?.rain;
        // rain on / off (a new race resets it)
        if (raining && !rain) {
          rain = new Weather(ctx.scene);
          rain.set('rain', Math.max(0.35, ctx.quality.density));
          base = {
            fog: renderEnv.fogDensity.value, top: renderEnv.skyTop.value.clone(), hor: renderEnv.skyHorizon.value.clone(),
            cloud: renderEnv.cloudCover.value, fogC: renderEnv.fogColor.value.clone(),
          };
        } else if (!raining && rain) {
          rain.dispose();
          rain = null;
          w = 0;
          restore();
        }
        if (rain) {
          w = Math.min(1, w + dt / 8);
          rain.intensity.value = Math.min(1, w * 1.5);
          applyWet(w);
        }
        // gong: swing after a ring
        if (gong && st) {
          const since = st.gong >= 0 && c.sim ? c.sim.time - st.gong : 99;
          gong.rotation.z = since < 6 ? 0.32 * Math.exp(-since * 0.7) * Math.sin(since * 7) : 0;
        }
      },
      dispose() {
        bridge?.dispose();
        rain?.dispose();
        restore();
        wet.value = 0;
      },
    };
  },
});
