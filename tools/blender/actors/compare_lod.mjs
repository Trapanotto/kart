// Checks that every <kind>.<id>.lod1.glb is a drop-in replacement for <kind>.<id>.glb:
// node names + parents + transforms, bones (names, rest = node TRS, inverse bind matrices), clips
// (names, durations), morph targets, material names, wheel radius / lowest point. Prints a table.
// Usage: node tools/blender/actors/compare_lod.mjs [dir]   (exit code 1 on any mismatch)
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'public/assets/models';
const IDS = ['sloth', 'sheep', 'redpanda', 'hedgehog', 'penguin', 'capybara', 'otter', 'axolotl'];
const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function load(file) {
  const buf = readFileSync(file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jl).toString('utf8'));
  const bl = buf.readUInt32LE(20 + jl);
  const bin = buf.subarray(28 + jl, 28 + jl + bl);
  return { json, bin, size: statSync(file).size };
}
function accessor(g, i) {
  const a = g.json.accessors[i], bv = g.json.bufferViews[a.bufferView];
  const T = COMP[a.componentType], n = a.count * NC[a.type];
  const off = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const raw = new T(g.bin.buffer.slice(g.bin.byteOffset + off, g.bin.byteOffset + off + n * T.BYTES_PER_ELEMENT));
  return raw;
}
function summary(g) {
  const j = g.json, acc = j.accessors;
  const parent = {};
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = n.name)));
  const nodes = j.nodes.map((n, i) => ({ name: n.name, parent: parent[i] ?? '-', t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1], mesh: n.mesh }));
  let tris = 0;
  const meshes = {};
  for (const n of nodes) {
    if (n.mesh === undefined) continue;
    const m = j.meshes[n.mesh];
    let t = 0;
    for (const p of m.primitives) t += (p.indices !== undefined ? acc[p.indices].count : acc[p.attributes.POSITION].count) / 3;
    tris += t;
    const p0 = m.primitives[0];
    meshes[n.name] = { tris: t, mats: m.primitives.map((p) => j.materials?.[p.material]?.name).join(','), morphs: (m.extras?.targetNames ?? []).join(','),
      min: acc[p0.attributes.POSITION].min, max: acc[p0.attributes.POSITION].max, skinned: p0.attributes.JOINTS_0 !== undefined, draco: !!p0.extensions?.KHR_draco_mesh_compression };
  }
  const skin = j.skins?.[0];
  const bones = skin ? skin.joints.map((i) => j.nodes[i].name) : [];
  const ibm = skin ? Array.from(accessor(g, skin.inverseBindMatrices)) : [];
  const clips = (j.animations ?? []).map((a) => {
    let d = 0;
    for (const s of a.samplers) d = Math.max(d, acc[s.input].max[0]);
    return { name: a.name, dur: d };
  });
  return { nodes, tris, meshes, bones, ibm, clips };
}
const close = (a, b, e = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < e);

let bad = 0;
const rows = [];
for (const kind of ['char', 'kart']) {
  for (const id of IDS) {
    const fFull = join(DIR, `${kind}.${id}.glb`), fLod = join(DIR, `${kind}.${id}.lod1.glb`);
    if (!existsSync(fLod)) { console.log('MISSING', fLod); bad++; continue; }
    const gF = load(fFull), gL = load(fLod);
    const F = summary(gF), L = summary(gL);
    const errs = [];
    // nodes: same names, parents and transforms
    const byName = (s) => Object.fromEntries(s.nodes.map((n) => [n.name.replace(/\.\d+$/, ''), n]));
    const nf = byName(F), nl = byName(L);
    const names = Object.keys(nf).sort().join(' ');
    if (names !== Object.keys(nl).sort().join(' ')) errs.push(`nodes differ: ${names} | ${Object.keys(nl).sort().join(' ')}`);
    for (const k of Object.keys(nf)) {
      const a = nf[k], b = nl[k];
      if (!b) continue;
      if (a.parent.replace(/\.\d+$/, '') !== b.parent.replace(/\.\d+$/, '')) errs.push(`${k} parent ${a.parent} vs ${b.parent}`);
      if (!close(a.t, b.t) || !close(a.r, b.r) || !close(a.s, b.s)) errs.push(`${k} transform differs`);
    }
    // meshes: materials, morphs, skinning
    for (const k of Object.keys(F.meshes)) {
      const kk = Object.keys(L.meshes).find((x) => x.replace(/\.\d+$/, '') === k.replace(/\.\d+$/, ''));
      const a = F.meshes[k], b = L.meshes[kk];
      if (!b) { errs.push(`mesh ${k} missing`); continue; }
      if (a.mats !== b.mats) errs.push(`${k} material ${a.mats} vs ${b.mats}`);
      if (a.morphs !== b.morphs) errs.push(`${k} morphs ${a.morphs} vs ${b.morphs}`);
      if (a.skinned !== b.skinned || !b.draco) errs.push(`${k} skinned/draco`);
    }
    // bones and bind pose
    if (F.bones.join(' ') !== L.bones.join(' ')) errs.push('bones differ');
    if (!close(F.ibm, L.ibm, 1e-4)) errs.push('inverse bind matrices differ');
    // clips
    const cf = F.clips.map((c) => `${c.name}:${c.dur.toFixed(3)}`).sort().join(' ');
    const cl = L.clips.map((c) => `${c.name}:${c.dur.toFixed(3)}`).sort().join(' ');
    if (cf !== cl) errs.push(`clips ${cf} | ${cl}`);
    // wheels: radius (half height of the bounds) and lowest point in kart space
    let wheel = '';
    if (kind === 'kart') {
      const w = [];
      for (const k of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
        const a = F.meshes[k], b = L.meshes[k];
        const rA = (a.max[1] - a.min[1]) / 2, rB = (b.max[1] - b.min[1]) / 2;
        const lowA = nf[k].t[1] + a.min[1], lowB = nl[k].t[1] + b.min[1];
        if (Math.abs(rA - rB) > 1e-3 || Math.abs(lowA - lowB) > 1e-3) errs.push(`${k} radius ${rA.toFixed(4)}/${rB.toFixed(4)} low ${lowA.toFixed(4)}/${lowB.toFixed(4)}`);
        w.push(`${rB.toFixed(3)}@${lowB.toFixed(4)}`);
      }
      wheel = w.join(' ');
    }
    const mt = (s, re) => Object.entries(s.meshes).filter(([k]) => re.test(k)).reduce((t, [, m]) => t + m.tris, 0);
    rows.push({
      file: `${kind}.${id}`, trisFull: F.tris, trisLod: L.tris,
      parts: kind === 'char' ? `fur ${mt(L, /_fur/)} face ${mt(L, /_face/)} acc ${mt(L, /_acc/)}` : `body ${mt(L, /^body/)} steer ${mt(L, /^steering/)} wheels ${mt(L, /^wheel/)}`,
      kbFull: Math.round(gF.size / 1024), kbLod: Math.round(gL.size / 1024),
      nodes: L.nodes.length, bones: L.bones.length, clips: L.clips.length,
      morphs: Object.values(L.meshes).map((m) => m.morphs).filter(Boolean).join(',') || '-', wheel, ok: errs.length ? 'FAIL' : 'ok',
    });
    if (errs.length) { bad++; console.log(`\n${kind}.${id}:\n  ` + errs.join('\n  ')); }
  }
}
console.log('\n| file | tris full | tris lod1 | lod1 parts | KB full | KB lod1 | nodes | bones | clips | morphs | wheels r@lowest | check |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.file} | ${r.trisFull} | ${r.trisLod} | ${r.parts} | ${r.kbFull} | ${r.kbLod} | ${r.nodes} | ${r.bones} | ${r.clips} | ${r.morphs} | ${r.wheel || '-'} | ${r.ok} |`);
const c = summary(load(join(DIR, 'char.otter.lod1.glb')));
console.log('\nclips (all drivers):', c.clips.map((x) => `${x.name} ${x.dur.toFixed(2)}s`).join(', '));
console.log(bad ? `\n${bad} file(s) FAILED` : '\nall lod1 files match their full models');
process.exit(bad ? 1 : 0);
