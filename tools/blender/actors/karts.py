# Kart platform (shared) and per-character themes, as SDF primitive lists.
# Blender kart space: ground at z=0, front = -Y, +X = left.
import math
import numpy as np

import sdf
from sdf import v3, ellipsoid, round_cone, capsule, sphere, rbox, cyl, torus, rot_euler, rot_to, Prim
import anatomy as A

SEAT = v3((0.0, 0.22, 0.30))
WHEEL_C = SEAT + A.WHEEL_REL
FRONT_Y, REAR_Y = -0.66, 0.6
FRONT_R, REAR_R = 0.22, 0.255
FRONT_W, REAR_W = 0.2, 0.25
TRACK_F, TRACK_R = 0.52, 0.52


def steering_frame():
    return A.wheel_frame(0.0)


class Theme:
    def __init__(self, primary, secondary, accent, rim, seat, bumper='#3B3F4A', tyre='#2A2C33', hub=None):
        self.primary, self.secondary, self.accent = primary, secondary, accent
        self.rim, self.seat, self.bumper, self.tyre = rim, seat, bumper, tyre
        self.hub = hub or accent
        self.parts = []          # extra body prims
        self.paints = []
        self.wheel_parts = []    # extra prims on the wheel (local, left wheel)
        self.steer_parts = []
        self.rim_spokes = 0
        self.rim2 = '#FFFFFF'


# ---------------------------------------------------------------- platform
def body_prims(t):
    P, S, Ac = t.primary, t.secondary, t.accent
    B = []
    B.append(rbox((0, -0.02, 0.2), (0.33, 0.8, 0.08), 0.07, col=t.bumper))                       # floor pan
    B.append(rbox((0, 0.08, 0.31), (0.35, 0.52, 0.15), 0.13, k=0.06, col=P))                     # tub
    B.append(ellipsoid((0, -0.58, 0.3), (0.3, 0.36, 0.15), k=0.12, col=P))                       # nose
    B.append(ellipsoid((0, -0.3, 0.45), (0.25, 0.25, 0.13), k=0.1, col=P))                       # cowl / dash
    for s in (1, -1):
        B.append(ellipsoid((s * 0.4, 0.02, 0.27), (0.13, 0.42, 0.105), k=0.07, col=P))          # side pods
        B.append(capsule((s * 0.47, -0.3, 0.27), (s * 0.47, 0.32, 0.27), 0.05, k=0.03, col=t.bumper))  # nerf bar
    B.append(rbox((0, 0.64, 0.37), (0.25, 0.15, 0.13), 0.08, k=0.06, col=S))                     # engine cover
    # cockpit cut-out
    B.append(ellipsoid((0, 0.1, 0.58), (0.26, 0.34, 0.26), k=0.05, op='sub'))
    # seat
    B.append(rbox(SEAT + (0, -0.02, -0.04), (0.19, 0.17, 0.05), 0.05, k=0.03, col=t.seat))
    B.append(rbox(SEAT + (0, 0.27, 0.2), (0.2, 0.05, 0.2), 0.05, rot=rot_euler(math.radians(-12), 0, 0), k=0.03, col=t.seat))
    # bumpers
    B.append(capsule((-0.3, -0.9, 0.19), (0.3, -0.9, 0.19), 0.06, k=0.03, col=t.bumper))
    B.append(capsule((-0.3, 0.84, 0.2), (0.3, 0.84, 0.2), 0.06, k=0.03, col=t.bumper))
    # axles
    B.append(capsule((-TRACK_F, FRONT_Y, FRONT_R), (TRACK_F, FRONT_Y, FRONT_R), 0.03, col='#555A66'))
    B.append(capsule((-TRACK_R, REAR_Y, REAR_R), (TRACK_R, REAR_Y, REAR_R), 0.035, col='#555A66'))
    # steering column from the dash to the wheel hub
    col_dir = steering_frame()[:, 2]
    B.append(capsule(WHEEL_C + col_dir * 0.03, WHEEL_C + col_dir * 0.26, 0.028, k=0.02, col='#4A4E59'))
    # exhausts
    for s in (1, -1):
        a, b = v3((s * 0.16, 0.7, 0.42)), v3((s * 0.2, 0.93, 0.55))
        B.append(round_cone(a, b, 0.05, 0.06, k=0.02, col='#C9CED6'))
        B.append(cyl(b, 0.04, 0.05, rot=rot_to(b - a), op='sub', k=0.0))
    # headlights / emblem
    for s in (1, -1):
        B.append(sphere((s * 0.17, -0.86, 0.35), 0.05, k=0.015, col='#FFF2B8'))
    B.append(ellipsoid((0, -0.9, 0.3), (0.075, 0.03, 0.06), k=0.02, col=Ac))
    return B


def exhaust_tips():
    return [(v3((0.2, 0.95, 0.56)), 'exhaust_l'), (v3((-0.2, 0.95, 0.56)), 'exhaust_r')]


def lathe(prof, n_ang, radius_fn=None, col_fn=None):
    """Surface of revolution about X. prof = [(x, r, colour)], returns V, F (quads), colours."""
    V, Cs = [], []
    for i in range(n_ang):
        th = 2 * math.pi * i / n_ang
        for j, (x, r, c) in enumerate(prof):
            rr = r + (radius_fn(i, j) if radius_fn else 0.0)
            V.append((x, rr * math.cos(th), rr * math.sin(th)))
            Cs.append(col_fn(i, j, c) if col_fn else c)
    m = len(prof)
    F = []
    for i in range(n_ang):
        a, b = i * m, ((i + 1) % n_ang) * m
        for j in range(m - 1):
            F.append((a + j, a + j + 1, b + j + 1, b + j))
    return np.array(V), np.array(F), Cs


def wheel_mesh(t, R, W):
    """Left wheel in local space (axle = X, outer side = +X): tyre with chunky tread, dished rim, hub, bolts."""
    hw = W / 2
    blocks = 12
    n_ang = blocks * 4
    tread = 0.018
    Rt = R - tread
    tc = t.tyre
    # tyre profile from inner sidewall over the tread to the outer sidewall
    prof = [(-hw * 0.7, R * 0.6, tc), (-hw * 0.98, R * 0.72, tc), (-hw, Rt * 0.9, tc), (-hw * 0.9, Rt * 0.99, tc),
            (-hw * 0.62, Rt, tc), (-hw * 0.12, Rt, tc), (0.0, Rt - 0.01, tc), (hw * 0.12, Rt, tc), (hw * 0.62, Rt, tc),
            (hw * 0.9, Rt * 0.99, tc), (hw, Rt * 0.9, tc), (hw * 0.98, R * 0.72, tc), (hw * 0.7, R * 0.6, tc)]
    tread_j = {3, 4, 5, 7, 8, 9}

    def rad(i, j):
        if j not in tread_j:
            return 0.0
        k = i % 4          # 0,1 = block, 2,3 = gap; edges duplicated for a crisp step
        on = k in (0, 1)
        if j in (3, 9):
            return tread * 0.5 if on else 0.0
        return tread if on else 0.0
    # angular samples: block start/end and gap start/end at nearly the same angle for crisp steps
    Vt, Ft, Ct = [], [], []
    m = len(prof)
    for i in range(n_ang):
        blk = i // 4
        k = i % 4
        frac = (0.0, 0.62, 0.64, 0.98)[k]
        th = 2 * math.pi * (blk + frac) / blocks
        for j, (x, r, c) in enumerate(prof):
            rr = r + rad(i, j)
            Vt.append((x, rr * math.cos(th), rr * math.sin(th)))
            Ct.append(c)
    for i in range(n_ang):
        a, b = i * m, ((i + 1) % n_ang) * m
        for j in range(m - 1):
            Ft.append((a + j, a + j + 1, b + j + 1, b + j))
    parts = [(np.array(Vt), np.array(Ft), Ct)]
    # rim: dish on the outer side, inner cap on the inner side
    rc, hc = t.rim, t.hub
    spokes = t.rim_spokes

    def rim_col(i, j, c):
        if spokes and j in (2, 3) and (i * spokes // 32) % 2 == 1:
            return t.rim2
        return c
    rim = [(hw * 0.7, R * 0.6, rc), (hw * 0.86, R * 0.58, rc), (hw * 0.9, R * 0.5, rc), (hw * 0.8, R * 0.32, rc),
           (hw * 0.86, R * 0.2, hc), (hw * 1.02, R * 0.16, hc), (hw * 1.08, 0.0001, hc)]
    parts.append(lathe(rim, 32, col_fn=rim_col))
    inner = [(-hw * 0.7, R * 0.6, '#3A3D45'), (-hw * 0.55, 0.0001, '#3A3D45')]
    parts.append(lathe(inner[::-1], 16))
    # bolts
    for k in range(5):
        a = k / 5 * 2 * math.pi + 0.3
        c = (hw * 0.86, math.cos(a) * R * 0.27, math.sin(a) * R * 0.27)
        bolt = [(c[0] - 0.005, 0.0001, '#E8EBF0'), (c[0] + 0.004, 0.011, '#E8EBF0'), (c[0] + 0.012, 0.0001, '#E8EBF0')]
        Vb, Fb, Cb = lathe(bolt, 6)
        Vb = Vb + np.array((0, c[1], c[2]))
        parts.append((Vb, Fb, Cb))
    V, F, Cl, off = [], [], [], 0
    for (Vp, Fp, Cp) in parts:
        V.append(Vp); F.append(Fp + off); Cl += Cp; off += len(Vp)
    return np.concatenate(V), np.concatenate(F), Cl


def wheel_prims(t, R, W):
    """Left wheel, local space: axle = X, outer side = +X."""
    hw = W / 2
    out = []
    core = cyl((0, 0, 0), R - 0.022, hw, rot=rot_to((1, 0, 0)), rr=0.05, col=t.tyre)
    out.append(core)
    # tread blocks in polar repetition (chevrons)
    N = 22
    for half in (1, -1):
        blk = rbox((half * hw * 0.45, 0, 0), (hw * 0.36, 0.02, 0.03), 0.012,
                   rot=rot_euler(0, half * math.radians(28), 0))
        inner = blk.fn
        off = math.pi / N if half < 0 else 0.0

        def fn(P, inner=inner, off=off):
            r = np.sqrt(P[:, 1] ** 2 + P[:, 2] ** 2)
            th = np.arctan2(P[:, 2], P[:, 1]) + off
            sec = 2 * math.pi / N
            th = np.mod(th + sec / 2, sec) - sec / 2
            Q = np.stack([P[:, 0], r * np.cos(th) - (R - 0.022), r * np.sin(th)], 1)
            # block frame: radial = y
            return inner(Q[:, [0, 1, 2]])
        out.append(Prim(fn, (-hw, -R - 0.02, -R - 0.02), (hw, R + 0.02, R + 0.02), k=0.012, col=t.tyre))
    # rim on the outer side
    out.append(cyl((hw * 0.55, 0, 0), R * 0.62, hw * 0.5, rot=rot_to((1, 0, 0)), rr=0.02, k=0.01, col=t.rim))
    out.append(cyl((hw * 0.95, 0, 0), R * 0.42, 0.012, rot=rot_to((1, 0, 0)), rr=0.008, op='sub', k=0.01))
    out.append(ellipsoid((hw * 0.92, 0, 0), (0.03, R * 0.24, R * 0.24), k=0.015, col=t.hub))
    for k in range(5):
        a = k / 5 * 2 * math.pi
        out.append(sphere((hw * 0.92, math.cos(a) * R * 0.33, math.sin(a) * R * 0.33), 0.016, k=0.008, col='#E8EBF0'))
    # inner side cap
    out.append(cyl((-hw * 0.6, 0, 0), R * 0.4, hw * 0.45, rot=rot_to((1, 0, 0)), rr=0.02, k=0.01, col='#3A3D45'))
    return out + t.wheel_parts


def steering_prims(t):
    """Steering wheel in its own frame: ring in local XY, column = local Z."""
    out = [torus((0, 0, 0), A.WHEEL_R, 0.024, col='#30333B')]
    for k, a in enumerate((90, 210, 330)):
        a = math.radians(a)
        out.append(capsule((0, 0, 0.0), (math.cos(a) * A.WHEEL_R, math.sin(a) * A.WHEEL_R, 0), 0.016, k=0.015, col='#5A5F6B'))
    out.append(cyl((0, 0, 0.0), 0.045, 0.025, rr=0.015, k=0.02, col=t.accent))
    # grip wraps
    for a in (10, 170):
        a = math.radians(a)
        c = (math.cos(a) * A.WHEEL_R, math.sin(a) * A.WHEEL_R, 0)
        out.append(sphere(c, 0.029, k=0.01, col=t.secondary))
    return out + t.steer_parts


# ---------------------------------------------------------------- themes
def leaf(c, d, length, width, col, up=(0, 0, 1), k=0.0, curl=0.0):
    """Flat leaf shape along direction d."""
    d = v3(d) / np.linalg.norm(d)
    R = rot_to(d, up)
    return ellipsoid(v3(c) + d * length / 2, (width, width * 0.18, length / 2), rot=R, k=k, col=col)


def theme(cid):
    if cid == 'sloth':
        t = Theme('#7DBF5A', '#5E9A44', '#F2C14E', '#F2C14E', '#E9DFC8', bumper='#8A5A3B')
        for s in (1, -1):   # leaves on the side pods
            t.parts.append(leaf((s * 0.48, -0.2, 0.33), (s * 0.4, 0.8, 0.25), 0.36, 0.09, '#4F9A3A', k=0.02))
            t.parts.append(leaf((s * 0.48, 0.1, 0.33), (s * 0.5, 0.6, 0.5), 0.3, 0.08, '#6CC24A', k=0.02))
        # big leaf spoiler
        t.parts.append(capsule((0, 0.72, 0.48), (0, 0.8, 0.72), 0.025, k=0.02, col='#8A5A3B'))
        t.parts.append(ellipsoid((0, 0.84, 0.76), (0.42, 0.13, 0.03), rot=rot_euler(math.radians(-15), 0, 0), k=0.02, col='#4F9A3A'))
        t.paints.append((capsule((0, 0.72, 0.775), (0, 0.96, 0.74), 0.012), '#9BD84E', 0.004, 1.0))
        # flower on the nose
        for k in range(5):
            a = k / 5 * 2 * math.pi
            t.parts.append(sphere((math.cos(a) * 0.05, -0.62 + math.sin(a) * 0.05, 0.47), 0.035, k=0.01, col='#FFFFFF'))
        t.parts.append(sphere((0, -0.62, 0.48), 0.03, k=0.01, col='#F2C14E'))
    elif cid == 'sheep':
        t = Theme('#8FD0F2', '#FFFFFF', '#F7A6C1', '#F7A6C1', '#FFFFFF', bumper='#6A7A94')
        rng = np.random.default_rng(4)
        for s in (1, -1):   # cloud puffs on the side pods
            for k in range(5):
                y = -0.3 + k * 0.15
                t.parts.append(sphere((s * (0.45 + rng.uniform(-0.02, 0.02)), y, 0.32 + rng.uniform(-0.02, 0.03)), 0.085 + rng.uniform(0, 0.03), k=0.04, col='#FFFFFF'))
        for k in range(4):  # cloud bumper
            t.parts.append(sphere((-0.3 + k * 0.2, -0.95, 0.24), 0.1, k=0.05, col='#FFFFFF'))
        # little golden bell on the nose
        t.parts.append(sphere((0, -0.74, 0.46), 0.05, k=0.01, col='#F2C14E'))
        t.parts.append(torus((0, -0.74, 0.5), 0.03, 0.01, col='#F7A6C1'))
    elif cid == 'redpanda':
        t = Theme('#E2572B', '#2E2A33', '#FFC23D', '#FFC23D', '#2E2A33', bumper='#2E2A33')
        for s in (1, -1):  # flame stripes
            for k, (y, l) in enumerate(((-0.55, 0.28), (-0.42, 0.22), (-0.3, 0.16))):
                t.paints.append((capsule((s * 0.3, y, 0.43 - k * 0.03), (s * 0.33, y + l, 0.36), 0.03), '#FFC23D', 0.01, 1.0))
        # big rear wing
        for s in (1, -1):
            t.parts.append(rbox((s * 0.2, 0.82, 0.62), (0.02, 0.05, 0.14), 0.015, col='#2E2A33'))
        t.parts.append(rbox((0, 0.86, 0.78), (0.45, 0.12, 0.025), 0.02, rot=rot_euler(math.radians(-10), 0, 0), k=0.02, col='#E2572B'))
        for s in (1, -1):
            t.parts.append(rbox((s * 0.45, 0.86, 0.78), (0.02, 0.14, 0.08), 0.015, k=0.01, col='#FFC23D'))
        # striped antenna
        for k in range(5):
            t.parts.append(sphere((0.28, 0.62 + k * 0.03, 0.56 + k * 0.09), 0.035, k=0.02, col='#E2572B' if k % 2 == 0 else '#5A2E1F'))
    elif cid == 'hedgehog':
        t = Theme('#8E5BB5', '#6BAA3E', '#FFE07A', '#FFE07A', '#F3E2C2', bumper='#7A5236')
        # soft spikes on the front bumper
        for k in range(7):
            x = -0.36 + k * 0.12
            t.parts.append(round_cone((x, -0.95, 0.24), (x, -1.05, 0.31), 0.04, 0.012, k=0.02, col='#7A5236'))
        # apple ornament with leaf
        t.parts.append(ellipsoid((0, -0.66, 0.5), (0.08, 0.08, 0.075), k=0.02, col='#E83E36'))
        t.parts.append(capsule((0, -0.66, 0.56), (0.01, -0.66, 0.62), 0.008, k=0.005, col='#5A3B23'))
        t.parts.append(leaf((0.01, -0.66, 0.6), (1, 0.2, 0.4), 0.08, 0.025, '#6BAA3E'))
        # mushroom caps on the rear corners
        for s in (1, -1):
            t.parts.append(ellipsoid((s * 0.3, 0.75, 0.54), (0.09, 0.09, 0.05), k=0.02, col='#E83E36'))
            t.parts.append(capsule((s * 0.3, 0.75, 0.42), (s * 0.3, 0.75, 0.52), 0.03, k=0.02, col='#F3E2C2'))
            for j in range(3):
                a = j * 2.1
                t.paints.append((sphere((s * 0.3 + math.cos(a) * 0.05, 0.75 + math.sin(a) * 0.05, 0.585), 0.018), '#FFFFFF', 0.004, 1.0))
    elif cid == 'penguin':
        t = Theme('#3A6FD8', '#FFFFFF', '#FF6B3D', '#BFE9FF', '#FFFFFF', bumper='#24345E')
        # snow caps on the side pods and nose
        t.paints.append((ellipsoid((0, -0.36, 0.47), (0.3, 0.22, 0.1)), '#FFFFFF', 0.02, 1.0))
        for s in (1, -1):
            t.paints.append((ellipsoid((s * 0.4, 0.0, 0.38), (0.15, 0.45, 0.05)), '#FFFFFF', 0.015, 1.0))
            for k in range(4):  # icicles
                t.parts.append(round_cone((s * 0.47, -0.25 + k * 0.15, 0.22), (s * 0.48, -0.25 + k * 0.15, 0.1), 0.025, 0.006, k=0.015, col='#BFE9FF'))
        # fish ornament on the nose
        t.parts.append(ellipsoid((0, -0.66, 0.52), (0.035, 0.09, 0.05), k=0.02, col='#FF6B3D'))
        t.parts.append(ellipsoid((0, -0.56, 0.52), (0.012, 0.035, 0.045), rot=rot_euler(0.0, 0, 0), k=0.01, col='#FF6B3D'))
        # ski fins at the back
        for s in (1, -1):
            t.parts.append(rbox((s * 0.18, 0.84, 0.6), (0.015, 0.1, 0.12), 0.012, rot=rot_euler(math.radians(15), 0, 0), k=0.02, col='#24345E'))
    elif cid == 'capybara':
        t = Theme('#FFA62B', '#7A5A3A', '#6CC24A', '#FFE3A3', '#F3E2C2', bumper='#5E4630')
        # orange slice hubcaps
        t.rim_spokes = 8
        t.rim2 = '#FFF4D6'
        # citrus on the nose with leaf
        t.parts.append(sphere((0, -0.64, 0.5), 0.085, k=0.02, col='#FF9A1F'))
        t.parts.append(leaf((0.0, -0.64, 0.58), (1, 0.4, 0.3), 0.1, 0.035, '#5DBB46'))
        # wooden tub rim around the cockpit (onsen)
        t.parts.append(torus((0, 0.12, 0.47), 0.3, 0.035, rot=None, k=0.03, col='#9C6B3F'))
        # leaf spoiler
        t.parts.append(ellipsoid((0, 0.84, 0.7), (0.38, 0.12, 0.025), rot=rot_euler(math.radians(-12), 0, 0), k=0.02, col='#5DBB46'))
        for s in (1, -1):
            t.parts.append(capsule((s * 0.14, 0.72, 0.46), (s * 0.14, 0.82, 0.68), 0.022, k=0.02, col='#7A5A3A'))
    elif cid == 'otter':
        t = Theme('#2BB3B1', '#F2E2C4', '#FF8758', '#FFFFFF', '#F2E2C4', bumper='#1F6F78')
        # wave stripe
        for s in (1, -1):
            for k in range(4):
                y = -0.45 + k * 0.2
                t.paints.append((sphere((s * 0.43, y, 0.24), 0.07), '#FFFFFF', 0.01, 1.0))
        # life ring on the back
        t.parts.append(torus((0, 0.8, 0.56), 0.13, 0.04, rot=rot_euler(math.radians(80), 0, 0), k=0.02, col='#FFFFFF'))
        for k in range(4):
            a = k / 4 * 2 * math.pi + 0.4
            t.paints.append((sphere((math.cos(a) * 0.13, 0.8 + 0.0, 0.56 + math.sin(a) * 0.13), 0.04), '#FF5A4A', 0.006, 1.0))
        # shell on the nose
        for k in range(5):
            a = math.radians(-60 + k * 30)
            t.parts.append(round_cone((0, -0.6, 0.47), (math.sin(a) * 0.09, -0.6 - 0.02, 0.47 + math.cos(a) * 0.08), 0.03, 0.022, k=0.03, col='#FFD3C2'))
    elif cid == 'axolotl':
        t = Theme('#F48BB6', '#B48CF2', '#FFE07A', '#B48CF2', '#FFFFFF', bumper='#7C5BB8')
        # feathery gill fins on the back
        for s in (1, -1):
            for k in range(3):
                base = v3((s * 0.22, 0.72, 0.45 + k * 0.05))
                tip = base + v3((s * 0.22, 0.12 - k * 0.02, 0.18 - k * 0.12))
                t.parts.append(round_cone(base, tip, 0.03, 0.02, k=0.02, col='#E54F8B'))
                for j in range(3):
                    q = base + (tip - base) * (0.35 + j * 0.25)
                    t.parts.append(sphere(q + v3((0, 0.0, 0.035)), 0.026, k=0.015, col='#FF7BAC'))
        # bubbles on the nose
        for (x, y, z, r) in ((0.0, -0.66, 0.5, 0.06), (0.08, -0.58, 0.52, 0.035), (-0.07, -0.72, 0.47, 0.03)):
            t.parts.append(sphere((x, y, z), r, k=0.015, col='#BFE9FF'))
        for s in (1, -1):
            t.paints.append((sphere((s * 0.43, -0.1, 0.33), 0.09), '#FFE07A', 0.01, 1.0))
    else:
        t = Theme('#888888', '#444444', '#FFFFFF', '#FFFFFF', '#DDDDDD')
    return t
