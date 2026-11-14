# GLB post-pass for low-detail drivers (pure Python + numpy, no bpy).
#
# The Blender exporter writes translation / rotation / scale channels for every bone in every clip,
# most of them two identical keys at the rest pose; for a 3 k triangle driver that bookkeeping
# (JSON + data) is larger than the meshes. slim_animations():
#   - drops translation / scale channels that hold the node's rest value for the whole clip (the
#     loader then keeps the node value, which is exactly what the dropped channel said, also while
#     clips are blended). Static rotation channels are kept: Blender's importer re-orients bones and
#     would not restore the node rotation for a missing channel, and they are only two keys each;
#   - stores rotations as normalized int16 quaternions (KHR_mesh_quantization),
#   - packs all animation data into one bufferView.
# Clip names, durations and every animated value stay as exported.
import json
import struct

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
REST = {'translation': (0, 0, 0), 'rotation': (0, 0, 0, 1), 'scale': (1, 1, 1)}


def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack_from('<I', b, 12)[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from('<I', b, off)[0]
    return j, b[off + 8:off + 8 + bl]


def write_glb(path, j, binc):
    js = json.dumps(j, separators=(',', ':')).encode('utf-8')
    js += b' ' * (-len(js) % 4)
    binc = bytes(binc) + b'\0' * (-len(binc) % 4)
    total = 12 + 8 + len(js) + 8 + len(binc)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(binc), 0x004E4942) + binc)


def accessor_array(j, binc, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    assert not bv.get('byteStride'), 'interleaved animation data not expected'
    n = NCOMP[a['type']]
    arr = np.frombuffer(binc, dtype=COMP[a['componentType']], count=a['count'] * n,
                        offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)
    return arr.astype(np.float64)


def is_rest(path, vals, rest, eps=1e-5):
    rest = np.asarray(rest, dtype=np.float64)
    if path == 'rotation':
        return bool(np.all(np.abs(np.abs(vals @ rest) - 1.0) < eps))
    return bool(np.all(np.abs(vals - rest) < eps))


def slim_animations(path):
    j, binc = read_glb(path)
    anim_acc = {s[k] for a in j.get('animations', []) for s in a['samplers'] for k in ('input', 'output')}
    anim_bv = {j['accessors'][i]['bufferView'] for i in anim_acc}

    # copy all non-animation bufferViews unchanged
    out = bytearray()
    bvs, bv_map = [], {}
    for i, bv in enumerate(j['bufferViews']):
        if i in anim_bv:
            continue
        out += b'\0' * (-len(out) % 4)
        o = bv.get('byteOffset', 0)
        nb = dict(bv, byteOffset=len(out))
        out += binc[o:o + bv['byteLength']]
        bv_map[i] = len(bvs)
        bvs.append(nb)
    # non-animation accessors keep their order (meshes / skins refer to them)
    accs, acc_map = [], {}
    for i, a in enumerate(j['accessors']):
        if i in anim_acc:
            continue
        a = json.loads(json.dumps(a))
        if 'bufferView' in a:
            a['bufferView'] = bv_map[a['bufferView']]
        if 'sparse' in a:
            a['sparse']['indices']['bufferView'] = bv_map[a['sparse']['indices']['bufferView']]
            a['sparse']['values']['bufferView'] = bv_map[a['sparse']['values']['bufferView']]
        acc_map[i] = len(accs)
        accs.append(a)
    for m in j.get('meshes', []):
        for p in m['primitives']:
            p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = acc_map[p['indices']]
            for t in p.get('targets', []):
                for k in t:
                    t[k] = acc_map[t[k]]
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = acc_map[s['inverseBindMatrices']]

    # animation data: one shared bufferView
    out += b'\0' * (-len(out) % 4)
    anim_start = len(out)
    anim_bv_index = len(bvs)
    inputs = {}
    kept = dropped = 0

    def add_acc(arr, comp, typ, normalized=False, minmax=None):
        nonlocal out
        out += b'\0' * (-len(out) % 4)
        a = {'bufferView': anim_bv_index, 'byteOffset': len(out) - anim_start, 'componentType': comp,
             'count': int(arr.shape[0]), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'], a['max'] = minmax
        out += arr.astype(COMP[comp]).tobytes()
        accs.append(a)
        return len(accs) - 1

    for an in j.get('animations', []):
        chans, samps = [], []
        for ci, ch in enumerate(an['channels']):
            s = an['samplers'][ch['sampler']]
            pth = ch['target']['path']
            node = j['nodes'][ch['target']['node']]
            vals = accessor_array(j, binc, s['output'])
            last_chance = not chans and ci == len(an['channels']) - 1   # a clip needs one channel
            if pth in ('translation', 'scale') and is_rest(pth, vals, node.get(pth, REST[pth])) and not last_chance:
                dropped += 1
                continue
            kept += 1
            if s['input'] not in inputs:
                src = j['accessors'][s['input']]
                inputs[s['input']] = add_acc(accessor_array(j, binc, s['input']), 5126, 'SCALAR',
                                             minmax=(src['min'], src['max']))
            if pth == 'rotation':
                q = vals / np.linalg.norm(vals, axis=1, keepdims=True)
                oi = add_acc(np.round(q * 32767.0), 5122, 'VEC4', normalized=True)
            else:
                src = j['accessors'][s['output']]
                oi = add_acc(vals, 5126, src['type'])
            samps.append({'input': inputs[s['input']], 'interpolation': s.get('interpolation', 'LINEAR'), 'output': oi})
            chans.append({'sampler': len(samps) - 1, 'target': ch['target']})
        an['channels'], an['samplers'] = chans, samps
    bvs.append({'buffer': 0, 'byteOffset': anim_start, 'byteLength': len(out) - anim_start})
    j['bufferViews'], j['accessors'] = bvs, accs
    j['buffers'][0]['byteLength'] = len(out) + (-len(out) % 4)
    for key in ('extensionsUsed', 'extensionsRequired'):
        j[key] = sorted(set(j.get(key, [])) | {'KHR_mesh_quantization'})
    write_glb(path, j, out)
    print('SLIM', path, 'channels kept', kept, 'dropped', dropped)


if __name__ == '__main__':
    import sys
    for p in sys.argv[1:]:
        slim_animations(p)
