// Spiegelungen: die fertige Strecke wird einmal aus sechs Richtungen gerendert und vorgefiltert (PMREM).
// Lack, Wasser, Eis und Honig spiegeln damit die echte Umgebung statt eines Standardraums.
import * as THREE from 'three';

export function captureEnvironment(renderer, scene, pos, size = 256) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(0.5, 3000, rt);
  cam.position.copy(pos);
  scene.add(cam);
  const env = scene.environment;
  scene.environment = null; // keine Spiegelung in der Aufnahme selbst
  cam.update(renderer, scene);
  scene.remove(cam);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromCubemap(rt.texture).texture;
  pmrem.dispose();
  rt.dispose();
  scene.environment = tex;
  return tex;
}
