// Grey-box renderer, views and camera. Owner: lead.
// Real versions: src/render/, src/actors/, src/camera/, src/track/view/.
import * as THREE from 'three/webgpu';
import { KART } from '../core/data';
import type {
  AssetLibrary, CameraRig, EnvironmentDef, GameRenderer, Kart, QualitySettings, RaceSim, RenderContext, SimEntity,
  TrackRuntime, View,
} from '../core/types';

export function createStubAssets(): AssetLibrary {
  return {
    async load() {},
    model() {
      return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ff00ff' }));
    },
    clips: () => [],
    has: () => false,
  };
}

export function createStubRenderer(canvas: HTMLCanvasElement, quality: QualitySettings, assets: AssetLibrary): GameRenderer {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 2000);
  const hemi = new THREE.HemisphereLight('#ffffff', '#6b8f5a', 1);
  const sun = new THREE.DirectionalLight('#ffffff', 3);
  scene.add(hemi, sun);
  let time = 0, frames = 0, fps = 0, acc = 0;
  const ctx: RenderContext & { sim: RaceSim | null; time: number; quality: QualitySettings } = {
    scene, camera, quality, vfx: { spawn() {} }, assets, sim: null, time: 0,
  };
  return {
    ctx,
    async init() { await renderer.init(); },
    async setEnvironment(env: EnvironmentDef) {
      scene.background = new THREE.Color(env.skyHorizon);
      scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
      sun.position.set(...env.sunDir).multiplyScalar(100);
      sun.color.set(env.sunColor); sun.intensity = env.sunIntensity; hemi.intensity = env.ambientIntensity;
    },
    setQuality(q) { ctx.quality = q; renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio)); },
    setFeel() {},
    bindSim(sim) { ctx.sim = sim; },
    resize(w, h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    render(dt) {
      time += dt; ctx.time = time; frames++; acc += dt;
      if (acc >= 0.5) { fps = frames / acc; frames = 0; acc = 0; }
      renderer.render(scene, camera);
    },
    stats: () => ({ fps, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, backend: (renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2' }),
    dispose() { renderer.dispose(); },
  };
}

/** Draws the collision meshes of a track, coloured by surface. */
export async function createStubTrackView(track: TrackRuntime, ctx: RenderContext): Promise<View> {
  const group = new THREE.Group();
  const colors: Record<string, string> = { road: '#8a8f99', offroad: '#6fb35c', wall: '#d9a441', ice: '#bfe9ff', boost: '#ff9a2b', sticky: '#e0a020', sand: '#e6d29a', water: '#3fa0d0' };
  for (const c of track.colliders) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(c.indices, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colors[c.surface] ?? '#888', side: THREE.DoubleSide, roughness: 0.9 }));
    m.userData.collider = c;
    group.add(m);
  }
  for (const b of track.itemBoxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#ffd447', transparent: true, opacity: 0.7 }));
    m.position.copy(b.pos);
    group.add(m);
  }
  ctx.scene.add(group);
  return {
    update() { for (const m of group.children) if (m.userData.collider) m.visible = m.userData.collider.enabled; },
    dispose() { ctx.scene.remove(group); },
  };
}

export function createStubKartView(kart: Kart, ctx: RenderContext): View {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(KART.width, 0.5, KART.length), new THREE.MeshStandardMaterial({ color: kart.char.color }));
  body.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: kart.char.color }));
  head.position.set(0, 1.1, -0.2);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.4), new THREE.MeshStandardMaterial({ color: '#222' }));
  nose.position.set(0, 0.5, KART.length / 2);
  g.add(body, head, nose);
  ctx.scene.add(g);
  return {
    update() { g.position.copy(kart.renderPos); g.quaternion.copy(kart.renderQuat); },
    dispose() { ctx.scene.remove(g); },
  };
}

export function createStubEntityView(entity: SimEntity, ctx: RenderContext): View {
  const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.3, entity.radius), 12, 8), new THREE.MeshStandardMaterial({ color: '#ff5fa2' }));
  ctx.scene.add(m);
  return {
    update() { m.position.copy(entity.pos); m.quaternion.copy(entity.quat); },
    dispose() { ctx.scene.remove(m); },
  };
}

export function createStubCamera(_ctx: RenderContext): CameraRig {
  let target: Kart | null = null;
  const back = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3();
  let first = true;
  return {
    setTarget(k) { target = k; first = true; },
    shake() {},
    setMode() {},
    update(dt, ctx) {
      if (!target) return;
      back.set(0, 0, 1).applyQuaternion(target.renderQuat);
      want.copy(target.renderPos).addScaledVector(back, -7).add(new THREE.Vector3(0, 3.2, 0));
      if (first) { ctx.camera.position.copy(want); first = false; } else ctx.camera.position.lerp(want, 1 - Math.exp(-6 * dt));
      look.copy(target.renderPos).addScaledVector(back, 4).add(new THREE.Vector3(0, 1, 0));
      ctx.camera.lookAt(look);
    },
    dispose() {},
  };
}
