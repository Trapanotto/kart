// Fur shading for the drivers (TSL). Owner: actors.
// - furMaterial(true): velvet sheen + fibre noise + soft rim fuzz, all driven by the vertex colours,
//   so one material serves every character.
// - furMaterial(false): plain vertex-coloured standard material for the mobile tier.
// - addFurShells(): optional shell fur (a few inflated, alpha-tested copies) for close-ups.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec3, vertexColor, positionLocal, normalLocal, normalView, positionViewDirection, mx_noise_float, dot, clamp,
  uniform, mix,
} from 'three/tsl';

const cache = new Map<string, THREE.Material>();

export function furMaterial(fancy: boolean): THREE.Material {
  const key = fancy ? 'fur' : 'fur-lite';
  const hit = cache.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  if (fancy) {
    const mat = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.82, metalness: 0 });
    const base = vertexColor(0).rgb;
    const p = positionLocal;
    // fine fibres stretched along the surface plus a broader clumping pattern
    const fibre = mx_noise_float(p.mul(vec3(140, 60, 140)));
    const clump = mx_noise_float(p.mul(26));
    const shade = float(1).add(fibre.mul(0.07)).add(clump.mul(0.06));
    mat.colorNode = base.mul(shade);
    mat.sheenNode = base.mul(0.55).add(vec3(0.22, 0.2, 0.18));
    mat.sheenRoughnessNode = float(0.42);
    const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
    const rim = float(1).sub(facing).pow(2.6);
    mat.emissiveNode = base.mul(rim).mul(0.22);
    mat.name = 'fur';
    m = mat;
  } else {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, name: 'fur-lite' });
  }
  cache.set(key, m);
  return m;
}

/** Glossy parts (eyes, noses) keep a crisp highlight. */
export function glossMaterial(): THREE.Material {
  const hit = cache.get('gloss');
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.18, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.1, name: 'gloss' });
  cache.set('gloss', m);
  return m;
}

const SHELLS = 5;
const shellCache: THREE.Material[] = [];

function shellMaterial(i: number): THREE.Material {
  if (shellCache[i]) return shellCache[i];
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, transparent: false });
  const h = (i + 1) / SHELLS;
  const len = uniform(0.012);
  mat.positionNode = Fn(() => positionLocal.add(normalLocal.mul(len.mul(h))))();
  const base = vertexColor(0).rgb;
  const strand = mx_noise_float(positionLocal.mul(420)).mul(0.5).add(0.5);
  const clump = mx_noise_float(positionLocal.mul(60)).mul(0.5).add(0.5);
  const density = mix(strand, clump, 0.35);
  // tips get thinner towards the outer shells; faces (dark gloss parts) have no shells anyway
  mat.alphaTestNode = float(h * 0.75 + 0.15);
  mat.opacityNode = density;
  mat.colorNode = base.mul(float(0.82 + 0.25 * h));
  mat.name = 'fur-shell';
  shellCache[i] = mat;
  return mat;
}

/** Adds alpha-tested shell copies to the fur meshes of a driver. Returns them for removal. */
export function addFurShells(root: THREE.Object3D): THREE.Object3D[] {
  const added: THREE.Object3D[] = [];
  const furs: THREE.SkinnedMesh[] = [];
  root.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh && s.userData.fur) furs.push(s); });
  for (const f of furs) {
    for (let i = 0; i < SHELLS; i++) {
      const s = new THREE.SkinnedMesh(f.geometry, shellMaterial(i));
      s.bind(f.skeleton, f.bindMatrix);
      s.castShadow = false;
      s.receiveShadow = true;
      s.frustumCulled = false;
      s.name = f.name + '_shell' + i;
      f.parent!.add(s);
      s.position.copy(f.position); s.quaternion.copy(f.quaternion); s.scale.copy(f.scale);
      added.push(s);
    }
  }
  return added;
}
