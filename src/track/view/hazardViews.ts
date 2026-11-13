// Views for track hazards ('hazard.sheep', 'hazard.hay'). Owner: track.
import * as THREE from 'three/webgpu';
import { registerEntityView } from '../../core/entityViews';
import type { RenderContext, SimEntity, View } from '../../core/types';
import { sourceFor } from './props';

function hazardView(e: SimEntity, ctx: RenderContext): View | null {
  const isSheep = e.kind === 'hazard.sheep';
  const isHay = e.kind === 'hazard.hay';
  if (!isSheep && !isHay) return null;
  const root = new THREE.Group();
  const model = sourceFor(isSheep ? 'sheep' : 'hay_bale', ctx);
  if (isHay) {
    // the entity sits at the bale centre; the prop origin is on the ground
    // entity = axle; the bale's axle sits 0.75 m above its origin
    model.position.y = -0.75;
  }
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(model);
  root.position.copy(e.pos);
  root.quaternion.copy(e.quat);
  ctx.scene.add(root);
  const target = new THREE.Vector3();
  const legs = model.getObjectByName('legs');
  const head = model.getObjectByName('head');
  let t = e.id * 1.7;
  return {
    update(dt) {
      t += dt;
      target.copy(e.pos);
      if (isSheep) {
        const d = e.data as { walking: number; startle: number } | undefined;
        const walk = d?.walking ?? 0;
        const startle = d?.startle ?? 0;
        target.y += Math.abs(Math.sin(t * 9)) * 0.08 * walk + Math.sin(Math.min(1, 1 - startle) * Math.PI) * 0.5 * (startle > 0 ? 1 : 0);
        root.position.lerp(target, Math.min(1, dt * 20));
        root.quaternion.slerp(e.quat, Math.min(1, dt * 8));
        model.rotation.z = Math.sin(t * 9) * 0.04 * walk;
        if (legs) legs.rotation.x = Math.sin(t * 25) * 0.3 * walk;
        if (head) head.rotation.x = walk > 0 ? Math.sin(t * 12.5) * 0.08 : 0.2 + Math.sin(t * 1.3) * 0.12;
      } else {
        root.position.copy(target);
        root.quaternion.copy(e.quat);
      }
    },
    dispose() { ctx.scene.remove(root); },
  };
}

let registered = false;
export function registerHazardViews(): void {
  if (registered) return;
  registered = true;
  registerEntityView('hazard.', hazardView);
}
