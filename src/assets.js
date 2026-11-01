// Laden der Blender-Modelle (glTF) + Fell-Shader (Shell-Fur) + instanzierte Deko
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CHARACTERS } from './data.js';

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);

export const Assets = { karts: {}, props: {} };

export async function loadAll(onProgress) {
  let done = 0;
  const total = CHARACTERS.length + 1;
  const tick = () => onProgress && onProgress(++done / total);
  await Promise.all([
    ...CHARACTERS.map((c) => loader.loadAsync(`assets/models/${c.id}.glb`).then((g) => {
      Assets.karts[c.id] = prepareKart(g.scene);
      tick();
    })),
    loader.loadAsync('assets/models/props.glb').then((g) => { prepareProps(g.scene); tick(); }),
  ]);
}

// ------------------------------------------------------------------ Fell
export const FUR = { layers: 7, length: 0.035, density: 70 };
const furMats = new Map();

function furMaterial(base) {
  if (furMats.has(base)) return furMats.get(base);
  const m = base.clone();
  m.name = base.name + '_shell';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.furLen = { value: FUR.length };
    sh.uniforms.furLayers = { value: FUR.layers };
    sh.uniforms.furDensity = { value: FUR.density };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float furLen; uniform float furLayers;
        varying float vLayer; varying vec3 vFurPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLayer = (float(gl_InstanceID) + 1.0) / furLayers;
        vFurPos = position;
        transformed += normal * furLen * vLayer;
        transformed.y -= furLen * 0.5 * vLayer * vLayer;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float furDensity; varying float vLayer; varying vec3 vFurPos;
        float furHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`)
      .replace('void main() {', `void main() {
        vec3 fp = vFurPos * furDensity;
        vec3 cell = floor(fp);
        vec3 f = fract(fp) - 0.5;
        float h = 0.35 + 0.65 * furHash(cell);
        float d = length(f);
        if (h < vLayer || d > 0.62 * (1.0 - vLayer * 0.75)) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.72, 1.12, vLayer);`);
  };
  m.customProgramCacheKey = () => 'fur-shell';
  furMats.set(base, m);
  return m;
}

function prepareKart(scene) {
  const root = scene.children[0];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const mat = o.material;
    if (mat.name.includes('DFF5FF')) { // Blasen
      mat.transparent = true;
      mat.opacity = 0.45;
      o.castShadow = false;
    }
    if (mat.name.includes('_fur')) o.userData.fur = true;
    if (mat.name.includes('_glow')) mat.toneMapped = false;
  });
  return root;
}

// Erzeugt eine eigenständige Kopie eines Fahrer-Modells
export function createKartModel(id, { fur = true, ghost = false } = {}) {
  const root = Assets.karts[id].clone(true);
  const nodes = {};
  root.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const shells = [];
  if (fur && !ghost) {
    const list = [];
    root.traverse((o) => { if (o.isMesh && o.userData.fur) list.push(o); });
    for (const o of list) {
      const im = new THREE.InstancedMesh(o.geometry, furMaterial(o.material), FUR.layers);
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.name = 'fur';
      o.add(im);
      shells.push(im);
    }
  }
  if (ghost) {
    const cache = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      if (!cache.has(o.material)) {
        const m = o.material.clone();
        m.transparent = true;
        m.opacity = 0.35;
        m.depthWrite = false;
        cache.set(o.material, m);
      }
      o.material = cache.get(o.material);
    });
  }
  const get = (n) => nodes[n] || null;
  return {
    root, shells,
    steerFL: get('Steer_FL'), steerFR: get('Steer_FR'),
    wheels: ['Wheel_FL', 'Wheel_FR', 'Wheel_BL', 'Wheel_BR'].map(get).filter(Boolean),
    steeringWheel: get('SteeringWheel'), driver: get('Driver'), head: get('Head'),
    eyesOpen: get('Eyes_Open'), eyesClosed: get('Eyes_Closed'),
    armL: get('Arm_L'), armR: get('Arm_R'), tail: get('Tail'), propeller: get('Propeller'),
    exhausts: [get('Exhaust_L'), get('Exhaust_R')].filter(Boolean),
  };
}

// ------------------------------------------------------------------ Deko
function prepareProps(scene) {
  scene.updateMatrixWorld(true);
  for (const r of scene.children) {
    if (!r.name.startsWith('Prop_')) continue;
    const inv = new THREE.Matrix4().copy(r.matrixWorld).invert();
    const parts = [];
    r.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (o.material.name.includes('_glow')) o.material.toneMapped = false;
      parts.push({ geometry: g, material: o.material });
    });
    Assets.props[r.name.slice(5)] = parts;
  }
}

// Viele Kopien einer Deko als InstancedMesh (eine Zeichenoperation pro Teil)
export function instanceProps(name, matrices, { shadows = true } = {}) {
  const parts = Assets.props[name];
  const group = new THREE.Group();
  if (!parts || !matrices.length) return group;
  for (const p of parts) {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

export function propClone(name) {
  const g = new THREE.Group();
  for (const p of Assets.props[name] || []) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = true;
    m.userData.shared = true;
    g.add(m);
  }
  return g;
}
