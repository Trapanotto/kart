// Gebackenes Licht: Licht, Schatten und Umgebungsverdeckung der Strecke werden in Blender
// vorberechnet (tools/blender/bake_tracks.py) und hier als Lightmap auf die statischen
// Streckenteile gelegt. Bewegliche Teile (Rampen, einstürzende Brücken, Fans, Flügel) und
// die Karts behalten Echtzeit-Licht.
//
// Ablauf beim Erstellen (nur lokal, mit `node tools/serve.mjs --dev`):
//   1. Spiel baut die Strecke, exportTrack() schickt statische Teile + Schattenwerfer als glTF
//   2. Blender backt und schreibt assets/tracks/<id>/ (bake.glb, Lightmaps, bake.json)
//   3. Im Rennen lädt loadBaked() das Ergebnis, applyBaked() tauscht die statischen Meshes aus
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ------------------------------------------------------------------ statische Teile
// Reihenfolge ist deterministisch (gleiche Strecke -> gleiche Liste), daher reichen laufende Nummern.
export function staticMeshes(track) {
  const out = [];
  const kids = track.group.children.slice(0, track.staticCount ?? track.group.children.length);
  for (const top of kids) {
    top.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o === track.fanMesh || o === track.fanEyes) return;
      let p = o, spin = false;
      while (p && p !== track.group) { if (p.name && p.name.startsWith('Spin')) spin = true; p = p.parent; }
      if (spin) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.isMeshBasicMaterial || m.transparent)) return; // unbeleuchtet oder durchsichtig
      out.push(o);
    });
  }
  out.forEach((o, n) => (o.userData.bakeId = 'bk' + String(n).padStart(4, '0')));
  return out;
}

// Ausrichtung fürs Backen: beim Backen zählt die Vorderseite eines Dreiecks. Im Spiel sind viele
// Flächen beidseitig und uneinheitlich gedreht (fällt dort nicht auf). Beidseitige Flächen werden
// daher je Dreieck nach oben gedreht, sonst läge z. B. die Fahrbahn im Dunkeln.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function faceUp(g, doubleSided) {
  const n = g.attributes.normal, p = g.attributes.position;
  if (!n) return;
  if (!g.index) g.setIndex([...Array(p.count).keys()]);
  const idx = g.index.array;
  const flipV = new Uint8Array(p.count);
  let sy = 0;
  for (let i = 0; i < n.count; i++) sy += n.getY(i);
  const wholeDown = sy / n.count < -0.3;
  for (let t = 0; t < idx.length; t += 3) {
    _a.fromBufferAttribute(p, idx[t]); _b.fromBufferAttribute(p, idx[t + 1]); _c.fromBufferAttribute(p, idx[t + 2]);
    const ny = _b.sub(_a).cross(_c.sub(_a)).normalize().y;
    if (wholeDown || (doubleSided && ny < -0.05)) {
      const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp;
      flipV[idx[t]] = flipV[idx[t + 1]] = flipV[idx[t + 2]] = 1;
    }
  }
  for (let i = 0; i < n.count; i++) if (flipV[i] && (wholeDown || n.getY(i) < 0)) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
}

// ------------------------------------------------------------------ Export fürs Backen (Entwicklung)
export async function exportTrack(track) {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  track.group.updateMatrixWorld(true);
  const root = new THREE.Scene();
  const bake = new THREE.Group(); bake.name = 'bake';
  const cast = new THREE.Group(); cast.name = 'casters';
  root.add(bake, cast);
  const stat = staticMeshes(track);
  const set = new Set(stat);
  // statische Meshes in Weltkoordinaten, je Material eine Gruppe (Materialname = Index)
  for (const o of stat) {
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!o.userData.keepFaces) faceUp(g, mats.some((m) => m.side === THREE.DoubleSide));
    const m = new THREE.Mesh(g, mats.map((src, i) => {
      const c = new THREE.MeshStandardMaterial({ color: src.color, roughness: src.roughness ?? 1 });
      c.name = 'm' + i;
      return c;
    }));
    if (!Array.isArray(o.material)) m.material = m.material[0];
    m.name = o.userData.bakeId;
    bake.add(m);
  }
  // alles andere (Deko, Rampen, Fans ...) nur als Schattenwerfer
  track.group.traverse((o) => {
    if (!o.isMesh || set.has(o) || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.isMeshBasicMaterial || m.transparent)) return;
    const flat = new THREE.MeshStandardMaterial({ color: mats[0].color || 0x888888 });
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        const mi = new THREE.Matrix4();
        o.getMatrixAt(i, mi);
        const g = o.geometry.clone().applyMatrix4(mi.premultiply(o.matrixWorld));
        cast.add(new THREE.Mesh(g, flat));
      }
    } else cast.add(new THREE.Mesh(o.geometry.clone().applyMatrix4(o.matrixWorld), flat));
  });
  // Schattenwerfer je Material zusammenfassen, sonst wird die Datei riesig
  const merged = new THREE.Group(); merged.name = 'casters';
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const byMat = new Map();
  for (const m of cast.children) {
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const key = m.material.color.getHexString();
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(g);
  }
  for (const [key, list] of byMat) {
    const g = mergeGeometries(list, false);
    if (g) merged.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#' + key })));
  }
  root.remove(cast); root.add(merged);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, onlyVisible: false });
  return { glb, meta: { id: track.def.id, theme: track.def.theme, count: stat.length, groundY: track.groundY, lights: track.bakeLights || [] } };
}

// ------------------------------------------------------------------ Laden im Spiel
const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(draco);
const texLoader = new THREE.TextureLoader();
const cache = new Map();

export function loadBaked(id, quality = 1) {
  const key = id + (quality < 1 ? '_low' : '');
  if (!cache.has(key)) cache.set(key, loadBakedNow(id, quality).catch(() => null));
  return cache.get(key);
}

async function loadBakedNow(id, quality) {
  const base = `assets/tracks/${id}/`;
  const res = await fetch(base + 'bake.json');
  if (!res.ok) return null;
  const meta = await res.json();
  const low = quality < 1 ? '_low' : '';
  const [gltf, ...maps] = await Promise.all([
    loader.loadAsync(base + 'bake.glb'),
    ...meta.lightmaps.map((f) => texLoader.loadAsync(base + f.replace('.webp', low + '.webp'))),
  ]);
  maps.forEach((t) => { t.flipY = false; t.channel = 1; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  const nodes = new Map();
  gltf.scene.traverse((o) => { if (o.name && o.name.startsWith('bk') && !nodes.has(o.name)) nodes.set(o.name, o); });
  return { meta, nodes, maps };
}

// Material, dessen diffuses Licht nur aus der Lightmap kommt (Sonne und Himmel sind schon eingebrannt),
// das aber weiter die Umgebung spiegelt.
const BAKED_BEGIN = THREE.ShaderChunk.lights_fragment_begin
  .replace(/#if \( NUM_(POINT|SPOT|DIR|RECT_AREA)_LIGHTS > 0 \) && defined\( RE_Direct(_RectArea)? \)/g, '#if 0')
  .replace('#if ( NUM_HEMI_LIGHTS > 0 )', '#if 0')
  .replace('getAmbientLightIrradiance( ambientLightColor )', 'vec3( 0.0 )');
const BAKED_MAPS = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');

function bakedMaterial(src, lightMap, intensity) {
  const m = src.clone();
  m.lightMap = lightMap;
  m.lightMapIntensity = intensity;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', BAKED_BEGIN).replace('#include <lights_fragment_maps>', BAKED_MAPS);
  };
  m.customProgramCacheKey = () => 'kart-baked';
  return m;
}

// statische Meshes gegen die gebackenen tauschen (gleiche Materialien, zusätzlich Lightmap)
export function applyBaked(track, baked) {
  const stat = staticMeshes(track);
  if (stat.length !== baked.meta.count) { console.warn('Gebackene Strecke passt nicht mehr zur Strecke – bitte neu backen', stat.length, baked.meta.count); return false; }
  const lm = baked.maps[baked.meta.atlas ?? 0];
  const mats = new Map();
  const matFor = (src, map) => {
    const k = src.uuid + map.uuid;
    if (!mats.has(k)) mats.set(k, bakedMaterial(src, map, baked.meta.intensity));
    return mats.get(k);
  };
  const holder = new THREE.Group();
  holder.name = 'baked';
  for (const o of stat) {
    const node = baked.nodes.get(o.userData.bakeId);
    if (!node || baked.meta.objects?.[o.userData.bakeId] === undefined) continue; // nicht gebacken: bleibt wie es ist
    const srcMats = Array.isArray(o.material) ? o.material : [o.material];
    const map = baked.maps[baked.meta.objects?.[o.userData.bakeId] ?? 0] || lm;
    node.traverse((p) => {
      if (!p.isMesh) return;
      const idx = +((String(p.material.name || 'm0').match(/^m(\d+)/) || [0, 0])[1]);
      const mesh = new THREE.Mesh(p.geometry, matFor(srcMats[idx] || srcMats[0], map));
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      holder.add(mesh);
    });
    o.visible = false;
  }
  track.group.add(holder);
  track.baked = true;
  return true;
}
