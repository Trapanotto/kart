// Cheap barrier look for the glacier: ribbons (2 triangles per barrier point) with a slatted snow
// fence or a wooden rail drawn in the shader (alpha test), instead of thousands of boxes.
// Owner: track 4.
import * as THREE from 'three/webgpu';
import { abs, color, float, fract, mix, smoothstep, step, uv } from 'three/tsl';
import type { Barrier } from '../../../builder';
import { Geo } from '../../meshes';

/** Vertical ribbon along each barrier polyline. uv = (metres along, 0..1 up). */
export function ribbonGeometry(runs: Barrier[], height: (b: Barrier) => number): THREE.BufferGeometry | null {
  const g = new Geo();
  for (const b of runs) {
    let along = 0;
    let prev: [number, number] | null = null;
    const h = height(b);
    for (let k = 0; k < b.pts.length; k++) {
      const p = b.pts[k];
      if (k > 0) along += p.distanceTo(b.pts[k - 1]);
      const lo = g.vert([p.x, p.y - 0.35, p.z], { uv: [along, -0.25] });
      const hi = g.vert([p.x, p.y + h, p.z], { uv: [along, 1] });
      if (prev) g.quad(prev[0], lo, prev[1], hi);
      prev = [lo, hi];
    }
  }
  if (!g.count) return null;
  return g.build();
}

/** Red slatted snow fence: slats every 0.5 m, two wires, snow drift at the foot. */
export function snowFenceMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const u = uv().x, v = uv().y;
  const slat = step(0.42, fract(u.mul(2)));
  const post = step(0.94, fract(u.div(4)));
  const wire = smoothstep(0.03, 0.0, abs(v.sub(0.3))).add(smoothstep(0.03, 0.0, abs(v.sub(0.8))));
  const drift = smoothstep(0.12, -0.05, v.sub(fract(u.mul(0.37)).mul(0.08)));
  const solid = slat.max(post).max(wire).max(drift);
  let col = mix(color('#b4452c'), color('#c96a3a'), fract(u.mul(0.73)));
  col = mix(col, color('#4a3020'), post);
  col = mix(col, color('#55565c'), wire.mul(float(1).sub(slat)));
  col = mix(col, color('#e8eef5'), drift);
  m.colorNode = col;
  m.opacityNode = solid;
  m.alphaTest = 0.5;
  m.roughnessNode = float(0.85);
  return m;
}

/** Wooden guard rail ribbon (mobile): a plank band on posts every 2 m. */
export function railMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
  const u = uv().x, v = uv().y;
  const plank = step(0.45, v).mul(step(v, 0.92));
  const post = step(0.9, fract(u.div(2)));
  m.colorNode = mix(color('#8a5b3a'), color('#5e3d29'), post);
  m.opacityNode = plank.max(post);
  m.alphaTest = 0.5;
  m.roughnessNode = float(0.85);
  return m;
}
