# Builds one or all drivers: mesh -> colours -> rig -> clips -> GLB (+ preview renders).
# Usage: blender -b -P tools/blender/actors/build_char.py -- <id|all> [--preview] [--export] [--sheet]
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import math

import bpy
import numpy as np
from mathutils import Vector

import common as C
import sdf
import anatomy as A
import characters as CH

for m in (sdf, A, CH):
    importlib.reload(m)


def vnormals(obj):
    me = obj.data
    a = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertex_normals.foreach_get('vector', a)
    return a.reshape(-1, 3).astype(np.float64)


def build_fur(spec):
    t0 = time.time()
    V, Q = sdf.mesh_sdf(spec.fur, spec.h)
    obj = C.mesh_from_np(spec.id + '_fur', V, Q)
    C.decimate(obj, spec.tris)
    C.shade_smooth(obj)
    P = C.verts_np(obj)
    col, bones = sdf.blend_attributes(spec.fur, P)
    for (prim, c, soft, amt) in spec.paints:
        col = sdf.paint(col, P, prim, c, soft, amt)
    if spec.noise:
        n = sdf.value_noise3(P, 18.0, 1) * 0.6 + sdf.value_noise3(P, 45.0, 2) * 0.4
        col = col * (1 + spec.noise * n)[:, None]
    N = vnormals(obj)
    ao = sdf.sdf_ao(spec.fur, P, N, dist=0.07)
    col = col * (0.5 + 0.5 * ao)[:, None]
    C.set_colors(obj, np.clip(col, 0, 1))
    obj['bones'] = list(bones.keys())
    obj['_w'] = 0
    spec._fur_weights = bones
    print('fur', len(V), '->', C.tri_count(obj), 'tris in %.1fs' % (time.time() - t0))
    return obj


def build_parts(spec, parts, name, mat):
    """Join numpy Parts into one mesh with shape keys and per-vertex bone."""
    if not parts:
        return None
    Vs, Fs, cols, keys, bones = [], [], [], {}, []
    off = 0
    names = sorted({k for p in parts for k in p.keys})
    for p in parts:
        Vs.append(p.V)
        Fs.append(p.F + off)
        cols.append(np.tile(sdf.srgb_to_lin(sdf.hexcol(p.col)), (len(p.V), 1)))
        for k in names:
            keys.setdefault(k, []).append(p.keys.get(k, p.V))
        bones += [p.bone] * len(p.V)
        off += len(p.V)
    V = np.concatenate(Vs)
    F = np.concatenate(Fs)
    obj = C.mesh_from_np(name, V, F)
    C.shade_smooth(obj)
    C.set_colors(obj, np.concatenate(cols))
    if names:
        obj.shape_key_add(name='Basis')
        for k in names:
            sk = obj.shape_key_add(name=k, from_mix=False)
            sk.value = 0.0
            sk.data.foreach_set('co', np.concatenate(keys[k]).astype(np.float32).ravel())
    spec._part_bones = getattr(spec, '_part_bones', {})
    spec._part_bones[name] = bones
    C.set_material(obj, mat)
    return obj


def build_cloth(spec):
    objs = []
    for i, prims in enumerate(spec.cloth):
        V, Q = sdf.mesh_sdf(prims, 0.005)
        o = C.mesh_from_np('%s_acc%d' % (spec.id, i), V, Q)
        C.decimate(o, 900)
        C.shade_smooth(o)
        P = C.verts_np(o)
        col, bones = sdf.blend_attributes(prims, P)
        if i < len(spec.cloth_paints):
            for (prim, c, soft, amt) in spec.cloth_paints[i]:
                col = sdf.paint(col, P, prim, c, soft, amt)
        C.set_colors(o, col)
        b = max(bones, key=lambda k: bones[k].sum()) if bones else 'head'
        o['bone'] = b
        objs.append(o)
    if not objs:
        return None
    bone_per_obj = [o['bone'] for o in objs]
    counts = [len(o.data.vertices) for o in objs]
    o = C.join(objs, spec.id + '_acc')
    spec._part_bones = getattr(spec, '_part_bones', {})
    spec._part_bones[o.name] = sum([[b] * n for b, n in zip(bone_per_obj, counts)], [])
    return o


def build(cid):
    spec = CH.ANIMALS[cid]()
    fur_mat = C.material('skin', rough=0.4, coat=0.3) if spec.skin else C.material('fur', rough=0.75, sheen=0.6, sheen_tint=spec.sheen)
    gloss_mat = C.material('gloss', rough=0.22)
    cloth_mat = C.material('cloth', rough=0.5)
    fur = build_fur(spec)
    C.set_material(fur, fur_mat)
    gloss = build_parts(spec, [p for p in spec.gloss if p.mat == 'gloss'], cid + '_face', gloss_mat)
    acc = build_cloth(spec)
    if acc:
        C.set_material(acc, cloth_mat)
    return spec, [o for o in (fur, gloss, acc) if o]


def preview(cid, objs, tag=''):
    pass
    sc = C.setup_render(1600, 32, res_y=560)
    C.studio_lights(1.0)
    # reference steering wheel
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, segments=32, radius=A.WHEEL_R)
    ring = C.bm_to_obj('wheelref', bm)
    # copies of the character at 4 angles
    angles = [0, -35, 90, 180]
    group = objs
    for i, ang in enumerate(angles):
        root = bpy.data.objects.new('turn%d' % i, None)
        C.link(root)
        root.location = ((i - 1.5) * 1.05, 0, 0)
        root.rotation_euler = (0, 0, math.radians(ang))
        for o in group:
            d = o.copy()
            C.link(d)
            d.parent = root
    for o in group:
        o.hide_render = True
    ring.hide_render = True
    C.camera((0, -6.2, 1.25), (0, 0, 0.5), lens=58)
    C.render(os.path.join(C.PREVIEW, '%s%s.png' % (cid, tag)))


if __name__ == '__main__':
    a = C.args()
    ids = list(CH.ANIMALS) if not a or a[0] == 'all' else a[0].split(',')
    if '--lineup' in a:
        import build_char as _self
        _self.lineup(ids)
        ids = []
    for cid in ids:
        C.reset()
        spec, objs = build(cid)
        if '--rig' in a or '--export' in a:
            import rig
            importlib.reload(rig)
            arm = rig.rig_character(spec, objs)
            if '--export' in a:
                rig.animate(spec, arm, objs)
                C.export_glb(os.path.join(C.MODELS, 'char.%s.glb' % cid), [arm] + objs)
        if '--preview' in a:
            preview(cid, objs)


def lineup(ids, tag='lineup'):
    """All drivers side by side: front three-quarter row and back row."""
    C.reset()
    groups = []
    for cid in ids:
        spec, objs = build(cid)
        groups.append(objs)
    C.setup_render(2000, 32, res_y=900)
    C.studio_lights(2.0)
    n = len(groups)
    for i, objs in enumerate(groups):
        for row, (ang, z) in enumerate(((-25, 1.2), (165, -0.15))):
            root = bpy.data.objects.new('g%d_%d' % (i, row), None)
            C.link(root)
            root.location = ((i - (n - 1) / 2) * 0.95, 0, z)
            root.rotation_euler = (0, 0, math.radians(ang))
            for o in objs:
                d = o.copy(); C.link(d); d.parent = root
        for o in objs:
            o.hide_render = True
    C.camera((0, -11.5, 1.6), (0, 0, 1.0), lens=50)
    C.render(os.path.join(C.PREVIEW, tag + '.png'))
