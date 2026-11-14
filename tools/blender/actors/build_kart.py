# Builds the themed karts: body, four wheels, steering wheel, seat and exhaust empties.
# Usage: blender -b -P tools/blender/actors/build_kart.py -- <id|all> [--preview] [--export] [--driver] [--lod 1]
# --lod 1 writes kart.<id>.lod1.glb: same nodes and transforms, about 2.3 k triangles, 256 px texture.
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import math

import bpy
import numpy as np
from mathutils import Matrix, Vector

import common as C

LOD = C.lod_arg(C.args())

import sdf
import anatomy as A
import karts as K

for m in (sdf, A, K):
    importlib.reload(m)

IDS = ['sloth', 'sheep', 'redpanda', 'hedgehog', 'penguin', 'capybara', 'otter', 'axolotl']
# (body tris, body texture px, steering tris) per LOD; LOD 1 wheels come from K.wheel_mesh(lod=1)
BUDGET = {0: (4600, 512, 600), 1: (1250, 256, 160)}


def sdf_object(name, prims, h, tris, paints=(), ao=0.0, smooth_iters=0, tex=0, mat=None):
    """SDF mesh with colours either as vertex colours or (tex > 0) baked analytically into a texture."""
    V, Q = sdf.mesh_sdf(prims, h)
    o = C.mesh_from_np(name, V, Q)
    if smooth_iters:
        C.smooth_mesh(o, smooth_iters, 0.5)
    C.decimate(o, tris)
    C.shade_smooth(o)

    def colour(P, N):
        col, _ = sdf.blend_attributes(prims, P, soft=0.006)
        for (prim, c, soft, amt) in paints:
            col = sdf.paint(col, P, prim, c, soft, amt)
        if ao:
            a = sdf.sdf_ao(prims, P, N, dist=0.08)
            col = col * (1 - ao + ao * a)[:, None]
        return np.clip(col, 0, 1)

    if tex:
        C.uv_unwrap(o, margin=0.006)
        img = C.bake_texture(o, colour, tex, name + '_tex')
        C.set_material(o, C.material_tex(name + '_paint', img, **(mat or {})))
    else:
        me = o.data
        N = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertex_normals.foreach_get('vector', N)
        C.set_colors(o, colour(C.verts_np(o), N.reshape(-1, 3).astype(np.float64)))
    return o


def mirror_x(obj):
    V = C.verts_np(obj)
    V[:, 0] *= -1
    C.set_verts(obj, V)
    obj.data.flip_normals()
    obj.data.update()


def empty(name, loc, parent, rot=None):
    e = bpy.data.objects.new(name, None)
    C.link(e)
    e.empty_display_size = 0.08
    e.parent = parent
    e.location = Vector(loc)
    if rot is not None:
        e.matrix_basis = Matrix.Translation(Vector(loc)) @ Matrix([list(r) for r in rot]).to_4x4()
    return e


def body_paints(t):
    from sdf import ellipsoid
    p = []
    for s in (1, -1):
        p.append((ellipsoid((s * 0.47, 0.0, 0.3), (0.08, 0.4, 0.03)), t.secondary, 0.008, 1.0))  # pod stripe
    return p + t.paints


def build(cid):
    t = K.theme(cid)
    paint = C.material('kart_paint', rough=0.32, coat=0.4)
    rubber = C.material('kart_tyre', rough=0.75)
    root = bpy.data.objects.new('kart', None)
    C.link(root)
    t0 = time.time()
    body_tris, tex, steer_tris = BUDGET[min(LOD, 1)]
    body = sdf_object('body', K.body_prims(t) + t.parts, 0.008, body_tris, body_paints(t), ao=0.45, tex=tex,
                      mat=dict(rough=0.32, coat=0.4))
    body.parent = root
    wheels = []
    for nm, y, R, W, x in (('wheel_fl', K.FRONT_Y, K.FRONT_R, K.FRONT_W, K.TRACK_F), ('wheel_fr', K.FRONT_Y, K.FRONT_R, K.FRONT_W, -K.TRACK_F),
                           ('wheel_rl', K.REAR_Y, K.REAR_R, K.REAR_W, K.TRACK_R), ('wheel_rr', K.REAR_Y, K.REAR_R, K.REAR_W, -K.TRACK_R)):
        Vw, Fw, Cw = K.wheel_mesh(t, R, W, lod=LOD)
        w = C.mesh_from_np(nm, Vw, Fw)
        C.set_colors(w, np.array([sdf.srgb_to_lin(c) for c in Cw]))
        C.shade_smooth(w)
        w.data.set_sharp_from_angle(angle=math.radians(50 if LOD else 40))
        if x < 0:
            mirror_x(w)
        C.set_material(w, rubber)
        w.parent = root
        w.location = (x, y, R)
        wheels.append(w)
    st = sdf_object('steering', K.steering_prims(t), 0.005, steer_tris)
    C.set_material(st, paint)
    st.parent = root
    st.matrix_basis = Matrix.Translation(Vector(K.WHEEL_C)) @ Matrix([list(r) for r in K.steering_frame()]).to_4x4()
    seat = empty('seat', K.SEAT, root)
    ex = [empty(n, p, root) for p, n in K.exhaust_tips()]
    tris = sum(C.tri_count(o) for o in [body, st] + wheels)
    print(cid, 'kart tris', tris, '%.1fs' % (time.time() - t0))
    return root, [body, st] + wheels + [seat] + ex


def add_driver(cid, seat):
    import build_char as BC
    importlib.reload(BC)
    import characters as CH
    importlib.reload(CH)
    if cid not in CH.ANIMALS:
        return []
    spec, objs = BC.build(cid)
    for o in objs:
        o.parent = seat
    return objs


def preview(cid, root, tag=''):
    C.setup_render(1400, 32, res_y=700)
    C.studio_lights(1.5)
    ground = C.uv_sphere('ground', (0, 0, -50), (60, 60, 50), seg=48, rings=24)
    C.set_material(ground, C.material('ground', rough=0.9, color=(0.55, 0.6, 0.5)))
    # two views: front three-quarter and rear three-quarter
    root2 = root.copy()
    C.link(root2)
    for ch in list(root.children):
        d = ch.copy(); C.link(d); d.parent = root2
        for g in list(ch.children):
            gg = g.copy(); C.link(gg); gg.parent = d
    root.location = (-1.25, 0, 0)
    root.rotation_euler = (0, 0, math.radians(-30))
    root2.location = (1.25, 0, 0)
    root2.rotation_euler = (0, 0, math.radians(150))
    C.camera((0, -6.5, 2.6), (0, 0, 0.55), lens=50)
    C.render(os.path.join(C.PREVIEW, 'kart_%s%s.png' % (cid, tag)))


if __name__ == '__main__':
    a = C.args()
    ids = IDS if not a or a[0] == 'all' else [a[0]]
    for cid in ids:
        C.reset()
        root, objs = build(cid)
        if '--export' in a:
            C.export_glb(os.path.join(C.MODELS, 'kart.%s%s.glb' % (cid, C.lod_suffix(LOD))), [root] + objs, anim=False,
                         images=True, **(dict(pos_q=12) if LOD else {}))
        if '--preview' in a:
            if '--driver' in a:
                add_driver(cid, objs[[o.name for o in objs].index('seat')])
            preview(cid, root, C.lod_suffix(LOD))
