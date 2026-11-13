// Prints a summary of GLB files: nodes, meshes, morph targets, animations, sizes.
// Usage: node tools/blender/actors/inspect_glb.mjs public/assets/models/char.otter.glb [...]
import { readFileSync, statSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  const acc = json.accessors ?? [];
  let tris = 0;
  const meshes = (json.meshes ?? []).map((m) => {
    let t = 0;
    for (const p of m.primitives) t += (p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count) / 3;
    tris += t;
    const targets = m.extras?.targetNames ?? [];
    const mats = m.primitives.map((p) => json.materials?.[p.material]?.name);
    return `${m.name} tris=${t} mats=${mats.join(',')}${targets.length ? ' morphs=' + targets.join(',') : ''}${m.primitives[0].extensions?.KHR_draco_mesh_compression ? ' draco' : ''}`;
  });
  let animBytes = 0;
  const anims = (json.animations ?? []).map((a) => {
    let n = 0;
    for (const s of a.samplers) { n = Math.max(n, acc[s.input].count); const o = acc[s.output]; animBytes += (json.bufferViews[o.bufferView]?.byteLength ?? 0); }
    return `${a.name}(${a.channels.length}ch,${n}k)`;
  });
  console.log(`\n${file}  ${(statSync(file).size / 1024).toFixed(0)} KB  tris=${tris}`);
  console.log('  nodes:', (json.nodes ?? []).map((n) => n.name).join(' '));
  console.log('  meshes:\n   ', meshes.join('\n    '));
  if (anims.length) console.log('  anims:', anims.join(' '), ' ~', (animBytes / 1024).toFixed(0), 'KB');
  console.log('  ext:', (json.extensionsUsed ?? []).join(','));
}
