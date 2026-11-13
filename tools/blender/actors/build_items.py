# Item models: itembox acorn honey giftbox yarn bee bubble carrot goldcarrot lolly cloud.
# Usage: blender -b -P tools/blender/actors/build_items.py -- <id|all> [--preview] [--export]
# Blender space: Z up, front = -Y; origin at the centre of the item.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import math

import bpy
import numpy as np

import common as C
import sdf
from sdf import v3, ellipsoid, round_cone, capsule, sphere, rbox, cyl, torus, rot_euler, rot_to, Prim

importlib.reload(sdf)

IDS = ['itembox', 'acorn', 'honey', 'giftbox', 'yarn', 'bee', 'bubble', 'carrot', 'goldcarrot', 'lolly', 'cloud']


def paw(c, n, s, col, out):
    """Paw print painted on a surface with normal n at c (size s)."""
    from anatomy import face_frame
    F = face_frame(n)
    u, v = F[:, 0], F[:, 1]
    out.append((ellipsoid(c - v * s * 0.25, (s * 0.42, s * 0.36, s * 0.3), rot=F), col, 0.006, 1.0))
    for k, (x, y) in enumerate(((-0.46, 0.28), (-0.17, 0.52), (0.17, 0.52), (0.46, 0.28))):
        out.append((ellipsoid(c + u * x * s + v * y * s, (s * 0.15, s * 0.18, s * 0.3), rot=F), col, 0.005, 1.0))


def item_itembox():
    h = 0.42
    P = [rbox((0, 0, 0), (h, h, h), 0.12, col='#FFD447')]
    paints = []
    # ribbon cross on all sides
    for ax in range(3):
        half = [h + 0.02] * 3
        half[ax] = 0.075
        paints.append((rbox((0, 0, 0), tuple(half), 0.0), '#FF5FA2', 0.004, 1.0))
    # bow on top
    for s in (1, -1):
        P.append(ellipsoid((s * 0.13, 0, h + 0.07), (0.15, 0.07, 0.08), rot=rot_euler(0, s * 0.5, 0), k=0.03, col='#FF5FA2'))
    P.append(sphere((0, 0, h + 0.05), 0.07, k=0.02, col='#FF7DB5'))
    # paw prints on the four side faces (between the ribbon)
    for n in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
        n = v3(n)
        t = np.cross(n, (0, 0, 1))
        for off in (1, -1):
            paw(n * h + t * off * 0.24 + v3((0, 0, 0.2 if off > 0 else -0.2)), n, 0.17, '#FFFFFF', paints)
    return P, paints, 'item_gloss', 1900


def item_acorn():
    P = [ellipsoid((0, 0, -0.06), (0.2, 0.2, 0.25), col='#B9773A'),
         round_cone((0, 0, -0.22), (0, 0, -0.3), 0.08, 0.02, k=0.05, col='#A0632E'),
         ellipsoid((0, 0, 0.11), (0.25, 0.25, 0.14), k=0.02, col='#7A5230'),
         capsule((0, 0, 0.22), (0.03, 0, 0.3), 0.028, k=0.02, col='#6B4526')]
    paints = [(ellipsoid((-0.07, -0.12, 0.0), (0.06, 0.06, 0.1)), '#E7B27A', 0.03, 0.7)]
    # cap scales: small bumps
    for i in range(36):
        a = i * 2.39996
        z = 0.08 + 0.16 * ((i * 0.61803) % 1.0)
        rr = math.sqrt(max(0.0, 1 - ((z - 0.11) / 0.14) ** 2)) * 0.25
        paints.append((sphere((math.cos(a) * rr, math.sin(a) * rr, z), 0.03), '#5E3E22', 0.012, 0.8))
    return P, paints, 'item', 1900


def item_honey():
    P = [cyl((0, 0, -0.04), 0.2, 0.2, rr=0.07, col='#F5A623'),
         cyl((0, 0, 0.19), 0.15, 0.04, rr=0.02, k=0.02, col='#F5A623'),
         ellipsoid((0, 0, 0.27), (0.22, 0.22, 0.06), k=0.01, col='#E8434F'),
         sphere((0, 0, 0.31), 0.04, k=0.02, col='#E8434F'),
         # honey drip over the rim
         capsule((0.16, -0.05, 0.18), (0.19, -0.06, 0.04), 0.03, k=0.03, col='#FFB830'),
         sphere((0.19, -0.06, 0.03), 0.04, k=0.02, col='#FFB830')]
    paints = [(rbox((0, -0.2, -0.04), (0.13, 0.05, 0.08), 0.03), '#FFF4D6', 0.006, 1.0),
              (ellipsoid((0, -0.25, -0.04), (0.05, 0.05, 0.035)), '#F5A623', 0.006, 1.0),
              (ellipsoid((-0.1, -0.12, 0.0), (0.05, 0.1, 0.12)), '#FFE9A8', 0.03, 0.8)]
    for k in range(8):   # gingham checks on the lid cloth
        a = k / 8 * 2 * math.pi
        paints.append((sphere((math.cos(a) * 0.19, math.sin(a) * 0.19, 0.27), 0.04), '#FFFFFF', 0.006, 1.0))
    return P, paints, 'item_gloss', 1900


def item_giftbox():
    h = 0.36
    P = [rbox((0, 0, 0), (h, h, h * 0.9), 0.07, col='#E8434F'),
         rbox((0, 0, h * 0.9), (h + 0.03, h + 0.03, 0.06), 0.04, k=0.01, col='#D23440')]
    paints = []
    for ax in (0, 1):
        half = [h + 0.05, h + 0.05, h + 0.1]
        half[ax] = 0.06
        paints.append((rbox((0, 0, 0), tuple(half), 0.0), '#FFD447', 0.004, 1.0))
    for s in (1, -1):
        P.append(ellipsoid((s * 0.12, 0, h + 0.08), (0.14, 0.06, 0.08), rot=rot_euler(0, s * 0.6, 0), k=0.03, col='#FFD447'))
    P.append(sphere((0, 0, h + 0.07), 0.06, k=0.02, col='#FFC52E'))
    # polka dots
    for n in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
        n = v3(n)
        t = np.cross(n, (0, 0, 1))
        for (x, z) in ((0.2, 0.18), (-0.2, -0.16), (0.2, -0.2), (-0.22, 0.2)):
            paints.append((sphere(n * h + t * x + v3((0, 0, z)), 0.05), '#FFFFFF', 0.006, 1.0))
    return P, paints, 'item_gloss', 1900


def item_yarn():
    P = [sphere((0, 0, 0), 0.26, col='#A57EE8')]
    rng = np.random.default_rng(2)
    for k in range(9):
        R = rot_euler(rng.uniform(0, math.pi), rng.uniform(0, math.pi), 0)
        P.append(torus((0, 0, 0), 0.262, 0.026, rot=R, k=0.006, col='#D9C2FF' if k % 2 else '#8A5CD6'))
    P += sdf.chain([(0.18, -0.15, -0.1), (0.28, -0.25, -0.2), (0.38, -0.22, -0.28), (0.46, -0.3, -0.3)], [0.022, 0.02, 0.018, 0.016], k=0.01, col='#B48CF2')
    return P, [], 'item', 1900


def item_bee():
    P = [ellipsoid((0, 0.02, 0), (0.15, 0.19, 0.15), col='#FFD23F'),
         sphere((0, -0.17, 0.03), 0.12, k=0.04, col='#FFD23F'),
         round_cone((0, 0.19, 0), (0, 0.3, -0.02), 0.04, 0.005, k=0.02, col='#2A2430')]
    paints = [(rbox((0, 0.06, 0), (0.3, 0.035, 0.3), 0.0), '#2A2430', 0.008, 1.0),
              (rbox((0, 0.16, 0), (0.3, 0.03, 0.3), 0.0), '#2A2430', 0.008, 1.0)]
    for s in (1, -1):
        P.append(ellipsoid((s * 0.05, -0.27, 0.07), (0.028, 0.02, 0.035), k=0.005, col='#1A1414'))
        paints.append((sphere((s * 0.055, -0.287, 0.085), 0.008), '#FFFFFF', 0.003, 1.0))
        P.append(capsule((s * 0.04, -0.22, 0.13), (s * 0.08, -0.26, 0.24), 0.008, k=0.01, col='#2A2430'))
        P.append(sphere((s * 0.08, -0.26, 0.25), 0.025, k=0.005, col='#2A2430'))
        P.append(ellipsoid((s * 0.16, 0.04, 0.2), (0.15, 0.08, 0.02), rot=rot_euler(0, s * -0.5, 0), k=0.0, col='#DDF4FF'))
    paints.append((sphere((0, -0.29, -0.0), 0.02), '#E8434F', 0.004, 0.8))
    return P, paints, 'item_gloss', 1900


def item_bubble():
    P = [sphere((0, 0, 0), 0.5, col='#CFEFFF')]
    paints = [(ellipsoid((-0.2, -0.3, 0.25), (0.15, 0.1, 0.12)), '#FFFFFF', 0.03, 1.0),
              (ellipsoid((0.25, -0.3, -0.2), (0.06, 0.05, 0.05)), '#FFFFFF', 0.02, 0.8),
              (ellipsoid((0.3, 0.2, 0.3), (0.3, 0.3, 0.3)), '#F7B6E8', 0.15, 0.6),
              (ellipsoid((-0.3, 0.3, -0.3), (0.3, 0.3, 0.3)), '#B6F7D8', 0.15, 0.6)]
    return P, paints, 'item_bubble', 1200


def carrot(gold=False):
    body = '#FFC530' if gold else '#FF8A2B'
    groove = '#E0A21A' if gold else '#E06A1A'
    leaf = '#FFE58A' if gold else '#5DBB46'
    P = [round_cone((0, 0, 0.18), (0, 0, -0.32), 0.12, 0.025, col=body)]
    for k, a in enumerate((-0.4, 0.0, 0.4)):
        base = v3((0, 0, 0.26))
        tip = base + v3((math.sin(a) * 0.12, math.cos(a) * 0.03, 0.2 - abs(a) * 0.1))
        P.append(ellipsoid((base + tip) / 2, (0.03, 0.02, 0.12), rot=rot_to(tip - base), k=0.03, col=leaf))
    paints = []
    for k in range(5):
        z = 0.1 - k * 0.09
        paints.append((torus((0, 0, z), 0.12 - k * 0.018, 0.012, rot=rot_euler(0.15 * (-1) ** k, 0, 0)), groove, 0.006, 1.0))
    if gold:
        paints.append((ellipsoid((-0.05, -0.1, 0.05), (0.04, 0.06, 0.15)), '#FFF6C8', 0.03, 1.0))
    return P, paints, 'item_gold' if gold else 'item', 1500


def item_lolly():
    P = [cyl((0, 0, 0.12), 0.24, 0.06, rot=rot_to((0, 1, 0)), rr=0.05, col='#FF5FA2'),
         capsule((0, 0, -0.1), (0, 0, -0.45), 0.025, k=0.02, col='#FFFFFF')]
    paints = []
    for i in range(60):    # white spiral
        t = i / 60
        a = t * 4.5 * math.pi
        r = 0.02 + t * 0.21
        paints.append((ellipsoid((math.cos(a) * r, 0, 0.12 + math.sin(a) * r), (0.026, 0.2, 0.026)), '#FFFFFF', 0.005, 1.0))
    return P, paints, 'item_gloss', 1700


def item_cloud():
    P = []
    for (x, y, z, r) in ((0, 0, 0.05, 0.26), (-0.25, 0, -0.02, 0.2), (0.26, 0, -0.03, 0.19), (-0.12, 0.05, 0.2, 0.18),
                         (0.14, 0.04, 0.18, 0.19), (0, 0.12, 0.0, 0.22), (-0.38, 0.02, -0.08, 0.13), (0.4, 0.0, -0.1, 0.12)):
        P.append(sphere((x, y, z), r, k=0.07, col='#7D8AA8'))
    # lightning bolt hanging below
    bolt = [(0.02, -0.05, -0.18), (-0.06, -0.06, -0.33), (0.04, -0.06, -0.33), (-0.04, -0.06, -0.5)]
    P += sdf.chain(bolt, [0.035, 0.03, 0.03, 0.012], k=0.0, col='#FFD447')
    paints = [(ellipsoid((0, -0.25, 0.2), (0.35, 0.15, 0.15)), '#A9B6D2', 0.06, 0.8)]
    for s in (1, -1):   # grumpy face
        paints.append((ellipsoid((s * 0.09, -0.25, 0.08), (0.03, 0.05, 0.04)), '#1A1A24', 0.004, 1.0))
        paints.append((capsule((s * 0.04, -0.25, 0.15), (s * 0.13, -0.24, 0.13), 0.012), '#1A1A24', 0.003, 1.0))
    paints.append((capsule((-0.05, -0.26, -0.0), (0.05, -0.26, -0.0), 0.01), '#1A1A24', 0.003, 1.0))
    return P, paints, 'item', 1900


BUILDERS = {'itembox': item_itembox, 'acorn': item_acorn, 'honey': item_honey, 'giftbox': item_giftbox,
            'yarn': item_yarn, 'bee': item_bee, 'bubble': item_bubble, 'carrot': lambda: carrot(False),
            'goldcarrot': lambda: carrot(True), 'lolly': item_lolly, 'cloud': item_cloud}


def materials():
    return {'item': C.material('item', rough=0.5),
            'item_gloss': C.material('item_gloss', rough=0.25, coat=0.5),
            'item_gold': C.material('item_gold', rough=0.25, metal=0.85),
            'item_bubble': C.material('item_bubble', rough=0.05, alpha=0.35, coat=1.0)}


MAT = {'item': dict(rough=0.5), 'item_gloss': dict(rough=0.25, coat=0.5), 'item_gold': dict(rough=0.25, metal=0.85),
       'item_bubble': dict(rough=0.05, alpha=0.35, coat=1.0)}


def build(iid, tex=256):
    P, paints, mat, tris = BUILDERS[iid]()
    V, Q = sdf.mesh_sdf(P, 0.0045)
    o = C.mesh_from_np(iid, V, Q)
    C.decimate(o, tris)
    C.shade_smooth(o)
    C.uv_unwrap(o, margin=0.012)

    def colour(X, N):
        col, _ = sdf.blend_attributes(P, X, soft=0.006)
        for (prim, c, soft, amt) in paints:
            col = sdf.paint(col, X, prim, c, soft, amt)
        ao = sdf.sdf_ao(P, X, N, dist=0.05)
        return col * (0.65 + 0.35 * ao)[:, None]

    img = C.bake_texture(o, colour, tex, 'item_' + iid)
    C.set_material(o, C.material_tex('item_' + iid, img, **MAT[mat]))
    print(iid, C.tri_count(o), 'tris')
    return o


if __name__ == '__main__':
    a = C.args()
    ids = IDS if not a or a[0] == 'all' else a[0].split(',')
    C.reset()
    objs = []
    for i, iid in enumerate(ids):
        o = build(iid)
        if '--export' in a:
            C.export_glb(os.path.join(C.MODELS, 'item.%s.glb' % iid), [o], anim=False, images=True)
        objs.append(o)
    if '--preview' in a:
        C.setup_render(1600, 32, res_y=700)
        C.studio_lights(1.5)
        n = len(objs)
        for i, o in enumerate(objs):
            o.location = ((i % 6 - 2.5) * 1.25, 0, 0.7 - (i // 6) * 1.3)
            o.rotation_euler = (0, 0, math.radians(-25))
        C.camera((0, -13, 2.0), (0, 0, 0.05), lens=50)
        C.render(os.path.join(C.PREVIEW, 'items.png'))
