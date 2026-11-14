// Views for the Bambus-Tempel sim entities: the swinging courtyard lantern, rolling bamboo logs and
// the (invisible) hole markers on the bridge. Owner: track 2.
import * as THREE from 'three/webgpu';
import { registerEntityView } from '../../../../core/entityViews';
import type { RenderContext, SimEntity, View } from '../../../../core/types';
import { sourceFor } from '../../props';

const DOWN = new THREE.Vector3(0, -1, 0);

function lanternView(e: SimEntity, ctx: RenderContext): View {
  const root = new THREE.Group();
  const model = sourceFor('bamboo_lantern_hang', ctx);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(model);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5, 1, true), new THREE.MeshStandardMaterial({ color: '#c9b07a', roughness: 0.9 }));
  ctx.scene.add(root, rope);
  const light = ctx.quality.tier === 'high' ? new THREE.PointLight('#ff9a4a', 6, 10, 2) : null;
  if (light) { light.position.set(0, -0.9, 0); model.add(light); }
  const pivot = (e.data?.pivot as THREE.Vector3 | undefined) ?? e.pos.clone().add(new THREE.Vector3(0, 5, 0));
  const dir = new THREE.Vector3(), hook = new THREE.Vector3();
  const place = () => {
    dir.subVectors(e.pos, pivot).normalize();
    hook.copy(e.pos).addScaledVector(dir, -0.85);
    root.position.copy(hook);
    root.quaternion.setFromUnitVectors(DOWN, dir);
    const L = hook.distanceTo(pivot);
    rope.position.copy(pivot).add(hook).multiplyScalar(0.5);
    rope.scale.set(1, L, 1);
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  };
  place();
  return {
    update() { place(); },
    dispose() { ctx.scene.remove(root, rope); rope.geometry.dispose(); },
  };
}

function logView(e: SimEntity, ctx: RenderContext): View {
  const root = new THREE.Group();
  const model = sourceFor('bamboo_log', ctx);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.add(model);
  root.position.copy(e.pos);
  root.quaternion.copy(e.quat);
  ctx.scene.add(root);
  return {
    update() { root.position.copy(e.pos); root.quaternion.copy(e.quat); },
    dispose() { ctx.scene.remove(root); },
  };
}

let registered = false;
export function registerBambooEntityViews(): void {
  if (registered) return;
  registered = true;
  registerEntityView('hazard.bamboo', (e, ctx) => {
    if (e.kind === 'hazard.bambooLantern') return lanternView(e, ctx);
    if (e.kind === 'hazard.bambooLog') return logView(e, ctx);
    return null; // hazard.bambooHole: invisible marker
  });
}
