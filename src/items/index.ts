// Item system entry for the app (render side included). Owner: gameplay.
// Importing this module registers the item entity views; headless code (tests) should import
// './system' directly to stay free of 'three/webgpu'.
import { createItemSystem as createSystem, type ItemSystem, type ItemSystemOptions } from './system';
import { registerItemViews } from './views';

export { ITEM, ITEM_IDS, HOLDABLE, RARE, itemWeights, positionFactor, drawItem } from './params';
export type { ItemId } from './params';
export { itemSystemOf } from './system';
export type { ItemSystem, ItemStats, ItemSystemOptions } from './system';
export { registerItemViews, ITEM_ASSETS } from './views';

export function createItemSystem(opts?: ItemSystemOptions): ItemSystem {
  registerItemViews();
  return createSystem(opts);
}
