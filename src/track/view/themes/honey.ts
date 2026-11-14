// Theme 'honey' (Honigfabrik). Owner: honey track.
// Golden-hour meadow and paved factory grounds, sealed concrete inside the hall, steel decks, glossy
// honey; set pieces (belts, presses, flood, tunnel, packing house, hall roof) in ./honey/setpieces.ts.
import * as THREE from 'three/webgpu';
import { registerEntityView } from '../../../core/entityViews';
import type { RenderContext, SimEntity, View } from '../../../core/types';
import { HALL } from '../../tracks/honigfabrik';
import { LOD_PROPS, sourceFor } from '../props';
import { registerTheme } from '../themes';
import { honeyBannerMaterial, honeyRoadMaterial, honeyTerrainMaterial, type Rect } from './honey/materials';
import { buildSetPieces } from './honey/setpieces';

// big honey props have a .lod1 model (used far away and on phones)
for (const n of ['honey_jar_giant', 'honey_tank', 'honey_hive_tower', 'honey_wall', 'honey_vat', 'honey_crate', 'honey_barrel', 'honey_bee', 'honey_truss']) LOD_PROPS.add(n);

const hallRects: Rect[] = HALL.bays.map((b) => ({ e0: b.e0, e1: b.e1, n0: b.n0, n1: b.n1 }));

/** Rolling honey barrels in the chute; presses are drawn by the theme (entity = AI marker only). */
function honeyEntityView(e: SimEntity, ctx: RenderContext): View | null {
  if (e.kind === 'hazard.honeyPress') return { update() {}, dispose() {} };
  if (e.kind !== 'hazard.honeyBarrel') return null;
  const root = new THREE.Group();
  const spin = new THREE.Group();
  const model = sourceFor('honey_barrel', ctx);
  model.position.y = -0.6; // the entity sits on the barrel's axis
  spin.rotation.z = Math.PI / 2; // lying on its side, rolling about local X
  spin.add(model);
  root.add(spin);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.position.copy(e.pos);
  root.quaternion.copy(e.quat);
  ctx.scene.add(root);
  return {
    update() { root.position.copy(e.pos); root.quaternion.copy(e.quat); },
    dispose() { ctx.scene.remove(root); },
  };
}
registerEntityView('hazard.honey', honeyEntityView);

registerTheme('honey', {
  roadMaterial: (T) => honeyRoadMaterial(T, { hall: hallRects, elevatedY: 2 + 3.5 }),
  terrainMaterial: (T) => honeyTerrainMaterial(T, { hall: hallRects }),
  backdropTrees: true,
  assets: ['prop.honey_press', 'prop.honey_press.lod1', 'prop.honey_barrel'],
  async extend(track, ctx, root, T) {
    try { await ctx.assets.load(['prop.honey_press', 'prop.honey_press.lod1', 'prop.honey_barrel']); } catch { /* placeholders */ }
    // the kit start gate's banner is blank (white): give it the honeycomb banner
    const banner = honeyBannerMaterial();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.Material | undefined)?.name === 'M_start_gate_banner') m.material = banner;
    });
    return buildSetPieces(track, ctx, root, T);
  },
});
