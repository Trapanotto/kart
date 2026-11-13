# The other seven drivers (Otti the otter lives in characters.py together with the shared helpers).
import math
import numpy as np

from sdf import v3, ellipsoid, round_cone, capsule, sphere, rot_euler, rot_to, torus, rbox
import anatomy as A
from anatomy import Spec, base_body, bone, ellipsoid_part
from characters import face, ears, tail, head_only


def fib(n):
    out = []
    g = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        out.append(v3((math.cos(g * i) * r, math.sin(g * i) * r, z)))
    return out


def surf(s, d, off=0.0):
    return A.surf_point(head_only(s), s.head_c, d, off)


def body_prims(s):
    return [p for p in s.fur if p.bone in ('hips', 'spine', 'chest', 'neck')]


def paint_on(s, d, r, col, soft=0.012, amt=1.0, spin=0.0, depth=None):
    """Paint an ellipse (half width, half height) on the head surface in direction d."""
    p, n = surf(s, d)
    R = A.face_frame(n) @ rot_euler(0, 0, spin)
    s.paints.append((ellipsoid(p, (r[0], r[1], depth or max(r) * 0.8), rot=R), col, soft, amt))
    return p, n


def cone_part(base, d, r0, r1, length, col, flat=1.0, bone='head'):
    d = v3(d) / np.linalg.norm(d)
    n = 6
    pts = [base + d * length * i / n for i in range(n + 1)]
    rr = [r0 + (r1 - r0) * (i / n) ** 0.9 for i in range(n + 1)]
    V, F = A.tube_np(pts, rr, 14)
    V = base + (V - base) * v3((1, 1, flat))
    return A.Part(V, F, col, bone)


# ---------------------------------------------------------------- Fauli the sloth
def sloth():
    s = Spec('sloth')
    fur, mask, patch, claw = '#8C6B4F', '#EBDCC0', '#4A3326', '#F2E6CC'
    s.sheen = (1.0, 0.92, 0.8)
    s.arm_len = (0.21, 0.19)
    base_body(s, fur, belly='#A88866', arm=fur, head_c=(0, -0.03, 0.72), head_r=(0.335, 0.3, 0.29), arm_r=0.055)
    hc = s.head_c
    s.fur.append(ellipsoid(hc + (0, -0.24, -0.07), (0.12, 0.08, 0.075), k=0.05, col=mask, bone='head'))
    for side in (1, -1):
        s.fur.append(ellipsoid(hc + (side * 0.25, -0.1, -0.1), (0.1, 0.1, 0.1), k=0.06, col=fur, bone='head'))
    for x in (-0.05, 0.02, 0.08):
        top = hc + v3((x, 0.02, 0.27))
        s.fur.append(round_cone(top, top + v3((x * 1.6, 0.03, 0.09)), 0.04, 0.012, k=0.03, col='#76583F', bone='head'))
    paint_on(s, (0, -1, -0.05), (0.24, 0.2), mask, 0.02)
    for side in (1, -1):
        paint_on(s, (side * 0.4, -1, -0.02), (0.05, 0.095), patch, 0.012, spin=side * 0.75)
    s.gloss.append(ellipsoid_part(hc + (0, -0.315, -0.045), (0.05, 0.03, 0.035), col='#2B1D16'))
    face(s, (0.38, -1, 0.05), 0.052, (0, -1, -0.38), 0.07, blush=(0.62, -1, -0.25), blush_r=0.04, smile=0.3)
    for sfx in ('l', 'r'):
        W = s.joints['hand_' + sfx][0]
        d = s.joints['hand_' + sfx][1] - W
        d = d / np.linalg.norm(d)
        side = np.cross(d, (0, 0, 1)); side /= np.linalg.norm(side)
        for k in (-1, 0, 1):
            a = W + d * 0.06 + side * k * 0.03 + v3((0, 0, 0.02))
            V, F = A.tube_np([a, a + d * 0.035 + v3((0, 0, -0.01)), a + d * 0.055 + v3((0, 0, -0.035))], [0.012, 0.009, 0.003], 6)
            s.gloss.append(A.Part(V, F, claw, 'hand_' + sfx))
    lc = hc + v3((0.1, 0.03, 0.27))
    R = rot_euler(0.35, -0.5, 0.6)
    s.cloth.append([ellipsoid(lc, (0.1, 0.19, 0.016), rot=R, col='#6CC24A', bone='head'),
                    capsule(lc + R @ v3((0, -0.18, 0)), lc + R @ v3((0, -0.25, 0.01)), 0.008, k=0.01, col='#4E9A35', bone='head')])
    s.cloth_paints.append([(capsule(lc + R @ v3((0, -0.17, 0.014)), lc + R @ v3((0, 0.17, 0.014)), 0.007), '#4E9A35', 0.003, 1.0)])
    return s


# ---------------------------------------------------------------- Wolke the sheep
def sheep():
    s = Spec('sheep')
    wool, face_c, inner = '#FFF8EE', '#4B4452', '#F2A7B5'
    s.sheen = (1.0, 1.0, 1.0)
    s.tris = 10500
    s.noise = 0.02
    base_body(s, wool, arm=face_c, foot=face_c, head_c=(0, -0.03, 0.71), head_r=(0.27, 0.27, 0.3), arm_r=0.05, hand_r=0.055)
    hc = s.head_c
    for p in s.fur:
        if p.bone == 'head':
            p.col = face_c
    rng = np.random.default_rng(3)
    bp = body_prims(s)
    for d in fib(56):
        if d[2] < -0.6:
            continue
        p, n = A.surf_point(bp, (0, 0.0, 0.28), d, 0)
        r = rng.uniform(0.075, 0.1)
        s.fur.append(sphere(p + n * 0.01, r, k=0.025, col=wool, bone='spine' if p[2] < 0.33 else 'chest'))
    for d in fib(70):
        crown = d[2] > 0.25 or (d[1] > 0.1 and d[2] > -0.45) or (abs(d[0]) > 0.75 and d[2] > -0.05 and d[1] > -0.2)
        if not crown:
            continue
        p, n = surf(s, d)
        r = rng.uniform(0.07, 0.095)
        s.fur.append(sphere(p + n * 0.01, r, k=0.025, col=wool, bone='head'))
    s.fur.append(ellipsoid(hc + (0, -0.2, -0.13), (0.14, 0.1, 0.1), k=0.06, col='#5A5262', bone='head'))
    ears(s, hc + (0.24, 0.0, 0.06), hc + (0.42, -0.02, -0.02), 0.075, 0.04, face_c, inner=inner, flat=0.45)
    s.gloss.append(ellipsoid_part(hc + (0, -0.29, -0.11), (0.045, 0.026, 0.03), col='#F59AB2'))
    face(s, (0.42, -1, 0.0), 0.05, (0, -1, -0.62), 0.045, white='#FFFFFF', blush=(0.62, -1, -0.32), blush_r=0.04,
         mouth_col='#2A2430', smile=0.4)
    for sfx in ('l', 'r'):
        E, W = s.joints['forearm_' + sfx][0], s.joints['forearm_' + sfx][1]
        s.fur.append(sphere(E + (W - E) * 0.55, 0.075, k=0.02, col=wool, bone='forearm_' + sfx))
    s.cloth.append([torus((0, 0.0, 0.47), 0.15, 0.022, col='#F7A6C1', bone='chest'),
                    sphere((0, -0.165, 0.43), 0.04, k=0.01, col='#F2C14E', bone='chest')])
    s.cloth_paints.append([(ellipsoid((0, -0.2, 0.42), (0.012, 0.01, 0.006)), '#5A4316', 0.003, 1.0)])
    tail(s, [(0, 0.18, 0.12), (0, 0.24, 0.16)], [0.09, 0.08], wool, n_bones=1)
    return s


# ---------------------------------------------------------------- Rubi the red panda
def redpanda():
    s = Spec('redpanda')
    fur, white, dark, tear = '#C8552B', '#FFF6EC', '#3B2219', '#8E3A1C'
    s.sheen = (1.0, 0.85, 0.7)
    base_body(s, fur, arm=dark, foot=dark, head_c=(0, -0.03, 0.72), head_r=(0.35, 0.29, 0.28))
    hc = s.head_c
    s.paints.append((ellipsoid((0, -0.13, 0.24), (0.15, 0.08, 0.2)), '#5A2E1F', 0.03, 1.0))
    for side in (1, -1):
        s.fur.append(ellipsoid(hc + (side * 0.24, -0.12, -0.12), (0.13, 0.11, 0.1), k=0.06, col=white, bone='head'))
    s.fur.append(ellipsoid(hc + (0, -0.24, -0.08), (0.12, 0.08, 0.075), k=0.05, col=white, bone='head'))
    ears(s, hc + (0.22, 0.02, 0.2), hc + (0.3, 0.02, 0.36), 0.095, 0.035, white, inner=dark, flat=0.42)
    for side in (1, -1):
        paint_on(s, (side * 0.3, -1, 0.42), (0.04, 0.03), white, 0.008)
        paint_on(s, (side * 0.38, -1, -0.28), (0.035, 0.08), tear, 0.012, spin=side * 0.25)
    s.gloss.append(ellipsoid_part(hc + (0, -0.31, -0.05), (0.05, 0.032, 0.035), col='#1E1412'))
    face(s, (0.38, -1, 0.08), 0.055, (0, -1, -0.4), 0.05, mouth_kind='cat', blush=(0.6, -1, -0.15), blush_r=0.04, smile=0.3)
    pts = [(0, 0.17, 0.1), (0.05, 0.3, 0.12), (0.12, 0.42, 0.2), (0.17, 0.5, 0.33), (0.18, 0.52, 0.48), (0.15, 0.48, 0.6)]
    rad = [0.1, 0.12, 0.125, 0.12, 0.1, 0.06]
    tail(s, pts, rad, fur, n_bones=3)
    for t, c in ((0.27, tear), (0.47, tear), (0.67, tear), (0.88, '#5A2E1F')):
        i = min(int(t * 5), 4)
        f = t * 5 - i
        q = v3(pts[i]) * (1 - f) + v3(pts[i + 1]) * f
        d = v3(pts[i + 1]) - v3(pts[i])
        s.paints.append((ellipsoid(q, (0.2, 0.2, 0.035), rot=rot_to(d)), c, 0.015, 1.0))
    return s


# ---------------------------------------------------------------- Stupsi the hedgehog
def hedgehog():
    s = Spec('hedgehog')
    face_c, spike, tip, belly = '#E3C29A', '#6B4A35', '#D8C2A0', '#F2DEC0'
    s.sheen = (1.0, 0.95, 0.85)
    s.tris = 11000
    base_body(s, face_c, belly=belly, arm='#B9906A', foot='#8A6446', head_c=(0, -0.02, 0.71), head_r=(0.31, 0.3, 0.28))
    hc = s.head_c
    s.fur.append(round_cone(hc + (0, -0.16, -0.06), hc + (0, -0.34, -0.06), 0.13, 0.05, k=0.05, col=face_c, bone='head'))
    rng = np.random.default_rng(5)
    hp = head_only(s)
    for d in fib(120):
        if not (d[1] > -0.15 and d[2] > -0.45) and not (d[2] > 0.55 and d[1] > -0.65):
            continue
        p, n = A.surf_point(hp, hc, d, -0.03)
        dirv = n + v3((0, 0.9, 0.35))
        dirv /= np.linalg.norm(dirv)
        L = rng.uniform(0.13, 0.17)
        s.fur.append(round_cone(p, p + dirv * L, 0.045, 0.01, k=0.012, col=spike, bone='head'))
        s.paints.append((sphere(p + dirv * L, 0.03), tip, 0.012, 1.0))
    bp = body_prims(s)
    for d in fib(70):
        if not (d[1] > -0.1 and d[2] > -0.5):
            continue
        p, n = A.surf_point(bp, (0, 0.0, 0.28), d, -0.03)
        dirv = n + v3((0, 0.8, 0.2))
        dirv /= np.linalg.norm(dirv)
        L = rng.uniform(0.13, 0.16)
        s.fur.append(round_cone(p, p + dirv * L, 0.05, 0.012, k=0.012, col=spike, bone='chest' if p[2] > 0.33 else 'spine'))
        s.paints.append((sphere(p + dirv * L, 0.03), tip, 0.012, 1.0))
    ears(s, hc + (0.22, -0.05, 0.19), hc + (0.25, -0.06, 0.24), 0.055, 0.03, face_c, inner='#F2A7B5', flat=0.55)
    s.gloss.append(ellipsoid_part(hc + (0, -0.385, -0.05), (0.048, 0.042, 0.042), col='#1A1414'))
    face(s, (0.4, -1, 0.1), 0.052, (0.0, -1, -0.5), 0.05, mouth_kind='cat', blush=(0.6, -1, -0.12), blush_r=0.042, smile=0.3,
         eye_prims=hp)
    ac = hc + v3((-0.13, 0.12, 0.33))
    s.cloth.append([ellipsoid(ac, (0.065, 0.065, 0.058), col='#E83E36', bone='head'),
                    capsule(ac + (0, 0, 0.05), ac + (0.01, 0, 0.085), 0.007, k=0.005, col='#5A3B23', bone='head'),
                    ellipsoid(ac + (0.035, 0, 0.08), (0.03, 0.012, 0.006), rot=rot_euler(0, -0.4, 0), k=0.004, col='#6BAA3E', bone='head')])
    return s


# ---------------------------------------------------------------- Pingo the penguin
def penguin():
    s = Spec('penguin')
    dark, white, orange = '#2C3350', '#FFFFFF', '#F7A531'
    s.sheen = (0.8, 0.85, 1.0)
    s.noise = 0.02
    base_body(s, dark, belly=white, arm=dark, foot=orange, head_c=(0, -0.03, 0.7), head_r=(0.31, 0.29, 0.29), arm_r=0.06, hand_r=0.06)
    hc = s.head_c
    for side in (1, -1):
        paint_on(s, (side * 0.32, -1, 0.05), (0.13, 0.17), white, 0.01)
    paint_on(s, (0, -1, -0.35), (0.16, 0.1), white, 0.012)
    for x in (-0.03, 0.0, 0.03):
        top = hc + v3((x, 0.03, 0.27))
        s.fur.append(round_cone(top, top + v3((x * 2.5, 0.05, 0.09)), 0.03, 0.01, k=0.025, col=dark, bone='head'))
    face(s, (0.32, -1, 0.12), 0.06, (0, -1, -0.35), 0.03, blush=(0.6, -1, -0.2), blush_r=0.045, smile=0.0)
    s.gloss.pop()   # the beak replaces the mouth
    s.gloss.append(cone_part(hc + v3((0, -0.25, -0.05)), (0, -1, -0.15), 0.075, 0.012, 0.15, orange, flat=0.7))
    scarf_c = '#E8434F'
    ring = torus((0, -0.005, 0.47), 0.165, 0.06, rot=rot_euler(0.12, 0, 0), col=scarf_c, bone='chest')
    end = [round_cone((0.09, -0.16, 0.46), (0.13, -0.21, 0.31), 0.055, 0.05, k=0.02, col=scarf_c, bone='chest'),
           rbox((0.135, -0.215, 0.28), (0.058, 0.026, 0.03), 0.015, rot=rot_euler(0.2, 0, -0.25), k=0.01, col=white, bone='chest')]
    s.cloth.append([ring] + end)
    s.cloth_paints.append([(rbox((0, -0.005, 0.475), (0.3, 0.022, 0.2), 0.0, rot=rot_euler(0.12, 0, k)), white, 0.004, 1.0)
                           for k in (0.5, 1.6, 2.6)] +
                          [(rbox((0.11, -0.18, 0.39), (0.06, 0.06, 0.012), 0.0, rot=rot_euler(0.2, 0, -0.25)), white, 0.004, 1.0)])
    tail(s, [(0, 0.17, 0.08), (0, 0.27, 0.04)], [0.08, 0.03], dark, n_bones=1)
    return s


# ---------------------------------------------------------------- Kapi the capybara
def capybara():
    s = Spec('capybara')
    fur, muzzle, dark = '#A0724B', '#8A5E3D', '#3A2A20'
    s.sheen = (1.0, 0.9, 0.78)
    base_body(s, fur, belly='#B78A62', arm='#8A5E3D', foot='#7A5236', head_c=(0, -0.03, 0.71), head_r=(0.27, 0.29, 0.25),
              body_scale=1.08)
    hc = s.head_c
    # long, tall, blunt snout with a flat top: the capybara silhouette
    s.fur.append(rbox(hc + (0, -0.22, -0.03), (0.18, 0.2, 0.165), 0.13, k=0.1, col=fur, bone='head'))
    s.paints.append((ellipsoid(hc + (0, -0.44, -0.06), (0.22, 0.12, 0.2)), muzzle, 0.03, 1.0))
    ears(s, hc + (0.19, 0.08, 0.19), hc + (0.22, 0.1, 0.24), 0.045, 0.03, '#7D5638', inner=dark, flat=0.6)
    s.gloss.append(ellipsoid_part(hc + (0, -0.418, 0.06), (0.085, 0.022, 0.04), col='#3A2A20'))
    for side in (1, -1):
        s.gloss.append(ellipsoid_part(hc + (side * 0.035, -0.432, 0.07), (0.016, 0.01, 0.012), col='#140D0A'))
    face(s, (0.62, -0.5, 0.5), 0.042, (0, -1, -0.3), 0.07, blush=(0.8, -0.8, 0.0), blush_r=0.04, smile=0.15, mouth_col='#3A2A20')
    yc = hc + v3((0, 0.02, 0.29))
    s.cloth.append([sphere(yc, 0.105, col='#FFA62B', bone='head'),
                    capsule(yc + (0, 0, 0.09), yc + (0.005, 0, 0.13), 0.01, k=0.006, col='#5B7A2E', bone='head'),
                    ellipsoid(yc + (0.05, 0.0, 0.125), (0.06, 0.022, 0.01), rot=rot_euler(0, -0.35, 0.3), k=0.006, col='#5DBB46', bone='head')])
    s.cloth_paints.append([(sphere(yc + (0, 0, 0.1), 0.015), '#C97A16', 0.006, 1.0)])
    tail(s, [(0, 0.18, 0.1), (0, 0.22, 0.12)], [0.07, 0.05], fur, n_bones=1)
    return s


# ---------------------------------------------------------------- Axi the axolotl
def axolotl():
    s = Spec('axolotl')
    pink, belly, gill, spot = '#F7A8C6', '#FCD6E3', '#E54F8B', '#E58BAE'
    s.skin = True
    s.noise = 0.015
    base_body(s, pink, belly=belly, head_c=(0, -0.03, 0.7), head_r=(0.37, 0.29, 0.25))
    hc = s.head_c
    hp = head_only(s)
    for side in (1, -1):
        sfx = 'l' if side > 0 else 'r'
        for k, (dy, dz) in enumerate(((0.0, 0.32), (0.05, 0.08), (0.08, -0.18))):
            base, n = A.surf_point(hp, hc, (side, dy, dz), -0.03)
            tip = base + v3((side * 0.2, 0.06 + k * 0.03, 0.14 - k * 0.1))
            nm = 'ear_' + sfx if k == 0 else 'head'
            s.fur.append(round_cone(base, tip, 0.035, 0.025, k=0.02, col=gill, bone=nm))
            for j in range(4):
                q = base + (tip - base) * (0.3 + j * 0.2)
                for up in (1, -1):
                    s.fur.append(ellipsoid(q + v3((0, 0.0, up * 0.035)), (0.022, 0.02, 0.045), rot=rot_euler(up * 0.5, side * 0.3, 0),
                                           k=0.01, col='#FF7BAC', bone=nm))
            if k == 0:
                bone(s, nm, base, tip, 'head')
                s.ear_bones.append(nm)
    rng = np.random.default_rng(7)
    for d in fib(26):
        if d[2] > 0.4 and d[1] > -0.7:
            p, n = A.surf_point(hp, hc, d, 0)
            r = rng.uniform(0.02, 0.032)
            s.paints.append((sphere(p, r), spot, 0.006, 1.0))
    face(s, (0.55, -1, 0.15), 0.045, (0, -1, -0.15), 0.15, blush=(0.55, -1, -0.12), blush_r=0.045, smile=0.18,
         mouth_col='#B9466F', eye_prims=hp)
    pts = [(0, 0.17, 0.1), (-0.05, 0.32, 0.12), (-0.1, 0.44, 0.2), (-0.12, 0.5, 0.32)]
    tail(s, pts, [0.09, 0.075, 0.055, 0.03], pink, n_bones=3)
    for i in range(3):
        a, b = v3(pts[i]), v3(pts[i + 1])
        s.fur.append(ellipsoid((a + b) / 2 + v3((0, 0.02, 0.06)), (0.015, np.linalg.norm(b - a) * 0.55, 0.07),
                               k=0.02, col='#FCC4D8', bone='tail_%d' % (i + 1)))
    return s
