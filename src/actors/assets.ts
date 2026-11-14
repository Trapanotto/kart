// Asset library: GLB loading with Draco, caching, skinned-mesh-safe cloning and placeholders. Owner: actors.
import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS } from '../core/data';
import { detectTier, QUALITY } from '../core/quality';
import type { AssetLibrary, QualityTier, RaceConfig } from '../core/types';

export const ITEM_MODELS = ['itembox', 'acorn', 'honey', 'giftbox', 'yarn', 'bee', 'bubble', 'carrot', 'goldcarrot', 'lolly', 'cloud'] as const;

interface Entry {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  skinned: boolean;
}

export interface ActorAssetLibrary extends AssetLibrary {
  /** Longest texture edge kept when loading (defaults to the detected quality tier). */
  maxTextureSize: number;
  /** Names that failed to load (placeholders are shown for them). */
  readonly missing: ReadonlySet<string>;
}

function baseUrl(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : b + '/';
}

function defaultMaxTexture(): number {
  try {
    const s = JSON.parse(localStorage.getItem('tk2.settings') ?? '{}') as { quality?: QualityTier | 'auto' };
    const tier = !s.quality || s.quality === 'auto' ? detectTier() : s.quality;
    return QUALITY[tier]?.maxTextureSize ?? 2048;
  } catch {
    return 2048;
  }
}

/** Unobtrusive placeholder in roughly the right size for the asset family. */
function placeholder(name: string): THREE.Object3D {
  const mat = new THREE.MeshStandardMaterial({ color: '#b9a7c9', roughness: 0.8, transparent: true, opacity: 0.55 });
  let geo: THREE.BufferGeometry;
  let y = 0.5;
  if (name.startsWith('kart.')) { geo = new THREE.BoxGeometry(1.2, 0.35, 1.9); y = 0.3; }
  else if (name.startsWith('char.')) { geo = new THREE.CapsuleGeometry(0.25, 0.4, 4, 10); y = 0.45; }
  else if (name.startsWith('item.')) { geo = new THREE.IcosahedronGeometry(0.35, 1); y = 0; }
  else geo = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  const g = new THREE.Group();
  g.name = 'placeholder:' + name;
  g.userData.placeholder = true;
  g.add(m);
  return g;
}

async function downscaleTextures(root: THREE.Object3D, max: number): Promise<void> {
  const seen = new Set<THREE.Texture>();
  const jobs: Promise<void>[] = [];
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      for (const v of Object.values(m)) {
        if (!(v instanceof THREE.Texture) || seen.has(v)) continue;
        seen.add(v);
        const img = v.image as { width?: number; height?: number } | undefined;
        if (!img?.width || !img.height || Math.max(img.width, img.height) <= max || typeof createImageBitmap !== 'function') continue;
        const k = max / Math.max(img.width, img.height);
        jobs.push(createImageBitmap(v.image as ImageBitmapSource, {
          resizeWidth: Math.max(1, Math.round(img.width * k)), resizeHeight: Math.max(1, Math.round(img.height * k)), resizeQuality: 'high',
        }).then((bmp) => { v.image = bmp; v.needsUpdate = true; }).catch(() => {}));
      }
    }
  });
  await Promise.all(jobs);
}

export function createAssets(): ActorAssetLibrary {
  const cache = new Map<string, Entry>();
  const pending = new Map<string, Promise<void>>();
  const missing = new Set<string>();
  const draco = new DRACOLoader();
  draco.setDecoderPath(baseUrl() + 'draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  const lib: ActorAssetLibrary = {
    maxTextureSize: defaultMaxTexture(),
    missing,

    load(names, onProgress) {
      const unique = [...new Set(names)];
      let done = 0;
      const total = unique.length;
      onProgress?.(0, total);
      return Promise.all(unique.map((name) => loadOne(name).finally(() => onProgress?.(++done, total)))).then(() => {});
    },

    model(name) {
      const e = cache.get(name);
      if (!e) {
        if (!pending.has(name) && !missing.has(name)) void loadOne(name);
        return placeholder(name);
      }
      const c = e.skinned ? cloneSkinned(e.scene) : e.scene.clone(true);
      c.userData.asset = name;
      return c;
    },

    clips: (name) => cache.get(name)?.clips ?? [],
    has: (name) => cache.has(name),
  };

  function loadOne(name: string): Promise<void> {
    if (cache.has(name) || missing.has(name)) return Promise.resolve();
    const p0 = pending.get(name);
    if (p0) return p0;
    const url = `${baseUrl()}assets/models/${name}.glb`;
    const p = loader.loadAsync(url)
      .then(async (gltf: GLTF) => {
        let skinned = false;
        gltf.scene.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        });
        await downscaleTextures(gltf.scene, lib.maxTextureSize);
        cache.set(name, { scene: gltf.scene, clips: gltf.animations, skinned });
      })
      .catch((err: unknown) => {
        missing.add(name);
        console.warn(`[actors] asset "${name}" not available (${url}); using a placeholder.`, err instanceof Error ? err.message : '');
      })
      .finally(() => pending.delete(name));
    pending.set(name, p);
    return p;
  }

  return lib;
}

/** Everything a race needs: all drivers and karts on the grid plus the item models. */
/** Phones draw the opponents with the low-detail models (a tenth of the triangles). */
export function actorLod(isHuman: boolean, tier: QualityTier): string {
  return !isHuman && tier === 'mobile' ? '.lod1' : '';
}

export function raceAssets(config: RaceConfig, tier: QualityTier = 'high'): string[] {
  const ids = config.grid ?? CHARACTERS.map((c) => c.id);
  const names: string[] = [];
  for (const id of new Set([...ids, config.player])) {
    const lod = actorLod(id === config.player, tier);
    names.push(`char.${id}${lod}`, `kart.${id}${lod}`);
  }
  for (const i of ITEM_MODELS) names.push(`item.${i}`);
  return names;
}
