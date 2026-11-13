# The eight drivers, built from the shared anatomy toolkit.
import math
import numpy as np

from sdf import v3, ellipsoid, round_cone, capsule, sphere, rot_euler, rot_to, chain, torus, rbox, cyl, Prim
import anatomy as A
from anatomy import Spec, base_body, bone, eye_parts, mouth_part, ellipsoid_part, on_head

BLUSH = '#F49AA0'
DARK = '#1C1412'


def head_only(s):
    return [p for p in s.fur if p.bone == 'head']


def face(s, eye_dir, eye_size, mouth_dir, mouth_w, nose=None, eye_tilt=0.0, mouth_kind='smile', mouth_col='#4A2A22',
         blush=None, blush_r=0.05, eye_prims=None, white=None, smile=0.35):
    prims = eye_prims or head_only(s)
    for side in (1, -1):
        d = v3(eye_dir) * v3((side, 1, 1))
        parts, p, n = eye_parts(s, prims, d, eye_size, side, tilt=eye_tilt, white=white)
        s.gloss += parts
        s.face['eye_' + ('l' if side > 0 else 'r')] = p
    m, p, n = mouth_part(s, prims, mouth_dir, mouth_w, col=mouth_col, kind=mouth_kind, smile=smile)
    s.gloss.append(m)
    if blush:
        for side in (1, -1):
            d = v3(blush) * v3((side, 1, 1))
            bp, bn = A.surf_point(prims, s.head_c, d, 0)
            s.paints.append((ellipsoid(bp, (blush_r, blush_r * 0.7, blush_r), rot=A.face_frame(bn)), BLUSH, 0.02, 0.75))


def ears(s, base, tip, r_base, r_tip, col, inner=None, flat=0.55, parent='head', k=0.03):
    for side, sfx in ((1, 'l'), (-1, 'r')):
        b = v3(base) * v3((side, 1, 1))
        t = v3(tip) * v3((side, 1, 1))
        d = t - b
        R = rot_to(d, up=(0, -1, 0))
        mid = (b + t) / 2
        L = np.linalg.norm(d)
        s.fur.append(ellipsoid(mid, (r_base, r_base * flat, L / 2 + r_tip), rot=R, k=k, col=col, bone='ear_' + sfx))
        if inner:
            s.paints.append((ellipsoid(mid + R[:, 1] * -r_base * flat * 0.6 + d * 0.06, (r_base * 0.6, r_base * flat * 0.7, L / 2 * 0.8), rot=R), inner, 0.012, 1.0))
        bone(s, 'ear_' + sfx, b, t, parent)
        s.ear_bones.append('ear_' + sfx)


def tail(s, pts, radii, col, n_bones=3, k=0.04, cols=None):
    pts = [v3(p) for p in pts]
    segs = len(pts) - 1
    per = max(1, segs // n_bones)
    names = []
    for i in range(segs):
        bi = min(i // per, n_bones - 1)
        nm = 'tail_%d' % (bi + 1)
        c = cols[i] if cols else col
        s.fur.append(round_cone(pts[i], pts[i + 1], radii[i], radii[i + 1], k=k if i == 0 else 0.02, col=c, bone=nm))
        if nm not in names:
            names.append(nm)
    # bones along the chain
    for bi, nm in enumerate(names):
        a = pts[bi * per]
        b = pts[min((bi + 1) * per, segs)]
        bone(s, nm, a, b, 'hips' if bi == 0 else names[bi - 1])
    s.tail_bones = names


# ---------------------------------------------------------------- Otti the otter
def otter():
    s = Spec('otter')
    fur, cream, paw, dark = '#7A5034', '#EED9B8', '#5E3C26', '#3A2418'
    s.sheen = (1.0, 0.9, 0.75)
    base_body(s, fur, belly=cream, arm=paw, foot=paw, head_c=(0, -0.03, 0.72), head_r=(0.35, 0.29, 0.265))
    hc = s.head_c
    # broad muzzle: two whisker pads and a chin
    for side in (1, -1):
        s.fur.append(ellipsoid(hc + (side * 0.072, -0.25, -0.085), (0.095, 0.075, 0.07), k=0.04, col=cream, bone='head'))
    s.fur.append(ellipsoid(hc + (0, -0.2, -0.14), (0.09, 0.07, 0.05), k=0.04, col=cream, bone='head'))
    # cheek / throat mask and brows
    s.paints.append((ellipsoid(hc + (0, -0.2, -0.13), (0.26, 0.2, 0.12)), cream, 0.03, 1.0))
    for side in (1, -1):
        s.paints.append((ellipsoid(hc + (side * 0.11, -0.24, 0.1), (0.04, 0.05, 0.022)), cream, 0.008, 1.0))
    ears(s, hc + (0.29, 0.03, 0.08), hc + (0.335, 0.04, 0.125), 0.058, 0.03, fur, inner=dark, flat=0.6)
    # nose
    s.gloss.append(ellipsoid_part(hc + (0, -0.328, -0.035), (0.062, 0.036, 0.042), col='#2A1A14'))
    face(s, (0.40, -1, 0.0), 0.056, (0, -1, -0.36), 0.06, mouth_kind='cat', blush=(0.6, -1, -0.2), blush_r=0.045, smile=0.3)
    # whiskers (fine white strokes)
    for side in (1, -1):
        for k in range(3):
            o = hc + v3((side * 0.12, -0.3, -0.07 + k * 0.025))
            e = o + v3((side * 0.17, 0.05, 0.03 * (1 - k)))
            V, F = A.tube_np([o, (o + e) / 2 + v3((0, 0, 0.01)), e], [0.0045, 0.0035, 0.002], 6)
            s.gloss.append(A.Part(V, F, '#FFF8EE', 'head', mat='gloss'))
    # thick tapering tail swinging out to the right and up behind the seat
    tail(s, [(0, 0.17, 0.1), (-0.06, 0.32, 0.1), (-0.14, 0.44, 0.17), (-0.2, 0.5, 0.28), (-0.21, 0.5, 0.38)],
         [0.1, 0.09, 0.075, 0.055, 0.03], fur, n_bones=3)
    # starfish on the head
    star_c = hc + v3((0.1, 0.02, 0.27))
    R = rot_euler(0.25, -0.35, 0.3)
    arms = []
    for k in range(5):
        a = k / 5 * 2 * math.pi
        d = R @ v3((math.cos(a), math.sin(a), 0))
        arms.append(round_cone(star_c, star_c + d * 0.11, 0.04, 0.014, k=0.02, col='#FF8758', bone='head'))
    s.cloth.append(arms)
    s.cloth_paints.append([(sphere(star_c + R @ v3((0, 0, 0.03)), 0.02), '#FFC09A', 0.01, 1.0)])
    return s


import characters2 as _c2  # noqa: E402  (the other seven drivers)
import importlib as _il
_il.reload(_c2)
ANIMALS = {'sloth': _c2.sloth, 'sheep': _c2.sheep, 'redpanda': _c2.redpanda, 'hedgehog': _c2.hedgehog,
           'penguin': _c2.penguin, 'capybara': _c2.capybara, 'otter': otter, 'axolotl': _c2.axolotl}
