"""Farm props: fence, hay, crate, tractor, sheep, scarecrow, well, sign."""
import math, random
from mathutils import Vector, noise
from kit import Part, PAL, lin, mix, grad_z, M


def _post(p, x, y, h, w=0.16, color='wood', tilt=(0, 0), rng=None):
    p.box((w, w, h - w * 0.5), (x, y, -0.05), rot=(tilt[0], tilt[1], 0), color=color, base=True, bevel=0.025, jitter=0.06)
    # pointed cap
    top = h - w * 0.5 - 0.05
    p.cyl(w * 0.72, w * 0.55, (x, y, top), rot=(0, 0, 45), segs=4, r2=0.02, color=color)


def fence_wood(lod=0, seed=2):
    """4 m section along X. One post at x = -2; the child node end_post (x = +2) closes a run."""
    rng = random.Random(seed)
    p = Part('fence_wood', hard=True, seed=seed)
    _post(p, -2.0, 0, 1.25, color='wood', tilt=(rng.uniform(-2, 2), rng.uniform(-2, 2)))
    for z, sag in ((0.45, 0.0), (0.95, 0.0)):
        c = rng.choice(['wood', 'wood_lt', 'wood_grey'])
        p.box((4.06, 0.07, 0.15), (0, -0.115, z), rot=(rng.uniform(-1, 1), rng.uniform(-0.8, 0.8), rng.uniform(-0.6, 0.6)),
              color=c, bevel=0.02, jitter=0.05)
    # a few nails
    for z in (0.45, 0.95):
        for x in (-2.0, 2.0):
            p.box((0.03, 0.02, 0.03), (x + (0.06 if x < 0 else -0.06), -0.155, z), color='metal_dk')
    e = Part('end_post', origin=(2.0, 0, 0), parent='fence_wood', hard=True, seed=seed + 1)
    _post(e, 2.0, 0, 1.25, color='wood', tilt=(1, -1))
    return [p, e]


def _straw(p, faces, n, size, colors, center, push=0.0, tilt=0.6):
    return p.leaves(faces, n, size, colors, mat='base', center=center, field=0.0, push=push, tilt=tilt, vary=0.12, width=0.35, up_bias=0.2)


def hay_bale(lod=0, seed=4):
    """Round bale, axis along X. Child node 'roll' has its pivot on the axle (0, 0.75, 0 in glTF)."""
    rng = random.Random(seed)
    root = Part('hay_bale', empty=True)
    b = Part('roll', origin=(0, 0, 0.75), parent='hay_bale', hard=False, seed=seed)
    R, W = 0.75, 1.2
    prof = [(0.0, -W / 2 + 0.01), (0.25, -W / 2), (0.55, -W / 2 + 0.01), (0.68, -W / 2 + 0.04), (0.74, -W / 2 + 0.12),
            (0.76, -0.25), (0.765, 0.0), (0.76, 0.25), (0.74, W / 2 - 0.12), (0.68, W / 2 - 0.04), (0.55, W / 2 - 0.01),
            (0.25, W / 2), (0.0, W / 2 - 0.01)]

    def col(co, n):
        # co is in the rotated (world) frame: axis = X
        r = math.hypot(co.y, co.z - 0.75)
        if abs(co.x) > W / 2 - 0.06:          # end caps: concentric spiral rings
            a = math.atan2(co.z - 0.75, co.y)
            v = math.sin((r * 26 + a * 0.6))
            return mix('hay_dk', 'hay_lt', 0.5 + 0.35 * v + noise.noise(co * 6) * 0.2)
        v = noise.noise(Vector((co.x * 9, co.y * 1.5, co.z * 1.5)))
        return mix('hay', 'hay_lt', 0.45 + v * 0.6)
    faces = b.lathe(prof, (0, 0, 0.75), rot=(0, 90, 0), color=col, segs=22, cap0=False, cap1=False)
    # twine bands
    for x in (-0.3, 0.0, 0.3):
        b.lathe([(0.755, -0.03), (0.778, -0.02), (0.778, 0.02), (0.755, 0.03)], (x, 0, 0.75), rot=(0, 90, 0),
                color='#e9dcc0', segs=22, cap0=False, cap1=False)
    if lod == 0:
        side = [f for f in faces if abs(f.normal.x) < 0.5]
        _straw(b, side, 70, 0.22, ['hay', 'hay_lt', 'hay_dk'], center=None, push=0.0, tilt=0.5)
    return [root, b]


def hay_stack(lod=0, seed=8):
    """Traditional domed haystack, about 3 m across and 3.2 m tall, with a pitchfork."""
    rng = random.Random(seed)
    p = Part('hay_stack', hard=False, seed=seed)
    prof = [(1.45, -0.05), (1.6, 0.35), (1.65, 0.8), (1.58, 1.3), (1.4, 1.85), (1.1, 2.35), (0.72, 2.75), (0.35, 3.0), (0.12, 3.12), (0.0, 3.15)]
    col = grad_z('hay_dk', 'hay_lt', 0.0, 3.2, 0.35, 1.8)
    faces = p.lathe(prof, (0, 0, 0), color=col, segs=18, cap0=False, cap1=False)
    p.displace(faces, 0.13, 1.6, seed=3.0)
    p.displace(faces, 0.05, 4.5, seed=7.0)
    p.fields.append((faces, Vector((0, 0, 1.0)), 0.35))
    _straw(p, faces, 170, 0.42, ['hay', 'hay_lt', 'hay_dk', 'hay_lt'], center=(0, 0, 1.2), push=-0.02, tilt=0.5)
    # a topknot of straw and a tie rope
    p.cyl(0.05, 0.5, (0, 0, 3.0), color='hay_dk', segs=5, r2=0.0)
    p.lathe([(1.5, 1.0), (1.62, 1.03), (1.62, 1.12), (1.5, 1.15)], (0, 0, 0), color='#c9a868', segs=18, cap0=False, cap1=False)
    # pitchfork stuck in the side
    m = M((1.05, -0.8, 1.2), (0, 25, 30))
    p.cyl(0.035, 1.8, matrix=m, color='wood_lt', segs=6)
    for dx in (-0.09, 0, 0.09):
        p.cyl(0.015, 0.35, (dx, 0, -0.35), matrix=m, color='metal', segs=4)
    p.box((0.22, 0.03, 0.03), (0, 0, 0.0), matrix=m, color='metal')
    p.hard = False
    return [p]


def crate(lod=0, seed=9):
    """1 m wooden crate with framed edges and a diagonal brace on each side."""
    rng = random.Random(seed)
    p = Part('crate', hard=True, seed=seed)
    s = 1.0
    p.box((s - 0.04, s - 0.04, s - 0.04), (0, 0, 0), color='wood', base=True, jitter=0.03)
    t, d = 0.12, 0.05
    h = s / 2
    # 12 frame edges
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((t, t, s), (sx * (h - t / 2 + 0.01), sy * (h - t / 2 + 0.01), 0), color='wood_dk', base=True, bevel=0.015, jitter=0.06)
            p.box((s, t, t), (0, sy * (h - t / 2 + 0.01), (sx + 1) / 2 * (s - t) + t / 2), color='wood_dk', bevel=0.015, jitter=0.06)
            p.box((t, s, t), (sx * (h - t / 2 + 0.01), 0, (sy + 1) / 2 * (s - t) + t / 2), color='wood_dk', bevel=0.015, jitter=0.06)
    L = math.sqrt(2) * (s - 2 * t)
    for ax in range(4):
        a = ax * 90
        m = M((0, 0, h), (0, 0, a))
        p.box((L, d, t * 0.9), (0, -h - 0.0, 0), rot=(0, 45 if ax % 2 else -45, 0), color='wood_lt', matrix=m, jitter=0.06)
    p.box((L, t * 0.9, d), (0, 0, s + 0.0), rot=(0, 0, 45), color='wood_lt', jitter=0.06)
    # plank seams (thin dark lines) on the front
    for ax in range(4):
        m = M((0, 0, 0), (0, 0, ax * 90))
        for z in (0.37, 0.63):
            p.box((s - 2 * t, 0.01, 0.025), (0, -h + 0.005, z), color='wood_dk', matrix=m)
    return [p]


def _wheel(p, c, r, w, segs=16, hub='yellow', rim_r=0.6, axis=(0, 90, 0)):
    """Tyre with a rounded profile and a coloured hub; axis along X."""
    prof = [(r * rim_r, -w / 2), (r * 0.86, -w / 2 - 0.01), (r * 0.97, -w / 2 + 0.06 * r), (r, -w * 0.25), (r, w * 0.25),
            (r * 0.97, w / 2 - 0.06 * r), (r * 0.86, w / 2 + 0.01), (r * rim_r, w / 2)]
    p.lathe(prof, c, rot=axis, color='tire', segs=segs, cap0=False, cap1=False)
    p.lathe([(0.0, -w / 2 - 0.0), (r * 0.18, -w / 2 + 0.02), (r * 0.35, -w / 2 + 0.08), (r * rim_r, -w / 2 + 0.02)],
            c, rot=axis, color=hub, segs=10, cap0=False, cap1=False)
    p.lathe([(r * rim_r, w / 2 - 0.02), (r * 0.35, w / 2 - 0.08), (r * 0.18, w / 2 - 0.02), (0.0, w / 2 - 0.0)],
            c, rot=axis, color=hub, segs=10, cap0=False, cap1=False)
    # tread lugs on big tyres
    if r > 0.6:
        for i in range(12):
            a = i * 2 * math.pi / 12
            for s in ((-1,) if i % 2 else (1,)):
                pos = Vector(c) + Vector((s * w * 0.22, math.cos(a) * r, math.sin(a) * r))
                p.box((w * 0.42, 0.12, 0.07), tuple(pos), rot=(math.degrees(a) - 90, 0, s * 25), color='tire')


def tractor(lod=0, seed=10):
    """Small cute farm tractor, about 3.3 m long, front = -Y (glTF +Z)."""
    p = Part('tractor', hard=True, seed=seed)
    g, gd = 'tractor', 'tractor_dk'
    # chassis and hood
    p.box((0.9, 2.2, 0.45), (0, -0.55, 0.55), color='metal_dk', base=True, bevel=0.05)
    p.box((1.0, 1.7, 0.85), (0, -0.95, 0.85), color=g, base=True, bevel=0.16, seg=2)
    p.box((1.05, 0.12, 0.7), (0, -1.82, 0.92), color='metal_dk', base=True, bevel=0.04)   # grille
    for z in (1.05, 1.2, 1.35, 1.5):
        p.box((0.85, 0.05, 0.04), (0, -1.89, z), color='metal_lt')
    for sx in (-1, 1):
        p.sphere(0.11, (sx * 0.36, -1.87, 1.66), 'yellow', scale=(1, 0.5, 1), segs=8, rings=5)   # headlights
    p.box((1.02, 1.75, 0.08), (0, -0.95, 1.7), color='yellow', base=True, bevel=0.03)   # stripe
    # cab body / seat area
    p.box((1.5, 1.2, 0.5), (0, 0.55, 0.85), color=g, base=True, bevel=0.1, seg=2)
    p.box((0.6, 0.55, 0.12), (0, 0.65, 1.35), color='black', base=True, bevel=0.04)
    p.box((0.6, 0.12, 0.55), (0, 0.95, 1.35), color='black', base=True, bevel=0.04)
    p.cyl(0.04, 0.6, (0, 0.15, 1.3), rot=(-35, 0, 0), color='black', segs=6)
    p.lathe([(0.2, -0.03), (0.22, 0.0), (0.2, 0.03)], (0, -0.02, 1.8), rot=(-35, 0, 0), color='black', segs=10, cap0=False, cap1=False)
    # fenders over rear wheels
    for sx in (-1, 1):
        p.sweep([(sx * 0.98, 0.55 + math.cos(a) * 0.92, 0.95 + math.sin(a) * 0.92) for a in [math.radians(t) for t in range(-10, 191, 25)]],
                0.1, g, segs=4, profile=[(-1, -2.5), (1, -2.5), (1, 2.5), (-1, 2.5)], up=(1, 0, 0))
    # roll cage and roof
    for sx in (-1, 1):
        for sy in (0.15, 1.05):
            p.box((0.08, 0.08, 1.45), (sx * 0.68, sy, 1.3), color='metal_dk', base=True)
    p.box((1.65, 1.25, 0.12), (0, 0.6, 2.75), color='yellow', base=True, bevel=0.05)
    # exhaust stack
    p.cyl(0.07, 1.25, (0.32, -1.35, 1.6), color='metal_dk', segs=8)
    p.cyl(0.09, 0.08, (0.32, -1.35, 2.85), color='black', segs=8)
    # wheels
    for sx in (-1, 1):
        _wheel(p, (sx * 0.98, 0.55, 0.85), 0.85, 0.5, segs=16 if lod == 0 else 12)
        _wheel(p, (sx * 0.72, -1.35, 0.45), 0.45, 0.28, segs=12 if lod == 0 else 10)
    return [p]


def sheep(lod=0, seed=12):
    """Fluffy sheep about 1.2 m long. Nodes: sheep (wool body), head (pivot at the neck), legs (pivot at the hips)."""
    rng = random.Random(seed)
    body = Part('sheep', hard=False, seed=seed)
    BZ = 0.62
    balls = [((0, 0, BZ), 0.55, (0.9, 1.05, 0.82))]
    for k in range(18):
        a = rng.uniform(0, 2 * math.pi)
        e = rng.uniform(-0.3, 1.0)
        d = Vector((math.cos(a) * math.cos(e) * 0.36, math.sin(a) * math.cos(e) * 0.4, math.sin(e) * 0.24 + BZ))
        balls.append((d, rng.uniform(0.2, 0.27)))
    wool = grad_z('wool_sh', 'wool', BZ - 0.35, BZ + 0.3, 0.12, 4)
    faces = body.blob(balls, wool, res=0.065, tris=480, noise_amp=0.035, noise_scale=7, mat='base', field=0.4, threshold=0.6)
    body.leaves(faces, 30, 0.12, wool, mat='base', center=(0, 0, BZ), field=0.6, push=-0.01, tilt=0.4, vary=0.04, width=0.8)
    body.sphere(0.06, (0, 0.5, BZ + 0.06), 'wool', segs=6, rings=4)   # tail
    # head
    hp = Vector((0, -0.4, BZ + 0.14))
    head = Part('head', origin=hp, parent='sheep', hard=False, seed=seed + 1)
    hc = hp + Vector((0, -0.17, 0.05))
    head.sphere(0.17, hc, 'sheep_face', scale=(0.9, 1.15, 1.0), segs=10, rings=7)
    head.sphere(0.12, hc + Vector((0, -0.14, -0.06)), 'sheep_face', scale=(0.95, 1.0, 0.85), segs=8, rings=6)  # muzzle
    head.blob([(hc + Vector((0, 0.04, 0.15)), 0.16), (hc + Vector((0.07, 0.07, 0.12)), 0.12), (hc + Vector((-0.07, 0.07, 0.12)), 0.12)],
              'wool', res=0.04, tris=140, noise_amp=0.015, noise_scale=12, mat='base')
    for sx in (-1, 1):
        head.sphere(0.1, hc + Vector((sx * 0.2, 0.04, 0.04)), 'sheep_face', scale=(1.0, 0.45, 0.35), rot=(0, sx * -25, 0), segs=6, rings=4)
        head.sphere(0.06, hc + Vector((sx * 0.21, 0.035, 0.04)), 'pink', scale=(0.8, 0.3, 0.25), rot=(0, sx * -25, 0), segs=6, rings=4)
        e = hc + Vector((sx * 0.085, -0.13, 0.06))
        head.sphere(0.05, e, 'white', segs=8, rings=5)
        head.sphere(0.03, e + Vector((0, -0.035, 0.005)), 'black', segs=6, rings=4)
        head.sphere(0.01, e + Vector((sx * 0.008, -0.06, 0.02)), 'white', segs=4, rings=3)
    head.sphere(0.025, hc + Vector((0, -0.27, -0.03)), 'pink', scale=(1.4, 0.6, 0.8), segs=6, rings=4)
    # legs
    lp = Vector((0, 0, 0.42))
    legs = Part('legs', origin=lp, parent='sheep', hard=False, seed=seed + 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * 0.18, sy * 0.24
            legs.cyl(0.07, 0.4, (x, y, 0.05), color='sheep_face', segs=7, r2=0.06)
            legs.cyl(0.08, 0.08, (x, y, 0.0), color='black', segs=7, r2=0.07)
    return [body, head, legs]


def scarecrow(lod=0, seed=14):
    rng = random.Random(seed)
    p = Part('scarecrow', hard=False, seed=seed)
    p.box((0.12, 0.12, 2.3), (0, 0.05, -0.1), color='wood', base=True, bevel=0.02)
    p.box((1.9, 0.1, 0.1), (0, 0.05, 1.62), color='wood', bevel=0.02)
    # shirt: plaid colours via a colour function
    def plaid(co, n):
        a = math.sin(co.x * 18) > 0.3
        b = math.sin(co.z * 18) > 0.3
        return lin('red') if (a ^ b) else (mix('red', 'black', 0.45) if a and b else mix('red', 'white', 0.25))
    p.lathe([(0.0, 0.85), (0.28, 0.86), (0.32, 1.05), (0.3, 1.5), (0.22, 1.72), (0.0, 1.75)], (0, 0, 0), color=plaid, segs=10, scale=(1, 0.75, 1))
    for sx in (-1, 1):
        p.sweep([(sx * 0.18, 0, 1.62), (sx * 0.55, 0, 1.6), (sx * 0.85, 0, 1.58)], [0.13, 0.12, 0.11], plaid, segs=7, cap1=False)
        # straw tufts at the cuffs
        for k in range(5):
            a = k * 1.25
            p.cyl(0.03, 0.22, (sx * 0.86, math.cos(a) * 0.06, 1.58 + math.sin(a) * 0.06), rot=(0, sx * 90 + rng.uniform(-25, 25), 0),
                  color='hay_lt', segs=3, r2=0.0)
    # trousers (patched)
    for sx in (-1, 1):
        p.cyl(0.13, 0.75, (sx * 0.12, 0, 0.18), color='blue', segs=8, r2=0.14)
        for k in range(4):
            p.cyl(0.025, 0.2, (sx * 0.12 + math.cos(k) * 0.08, math.sin(k) * 0.08, 0.2), rot=(180 + rng.uniform(-30, 30), 0, 0), color='hay_lt', segs=3, r2=0.0)
    p.box((0.16, 0.02, 0.14), (0.13, -0.135, 0.5), rot=(0, 0, 0), color='yellow')
    # sack head with stitched smile
    hc = Vector((0, 0, 2.02))
    p.sphere(0.26, hc, 'hay_lt', scale=(1, 0.95, 1.05), segs=12, rings=8)
    p.cyl(0.12, 0.12, (0, 0, 1.75), color='hay_dk', segs=8, r2=0.08)
    for sx in (-1, 1):
        p.sphere(0.045, hc + Vector((sx * 0.09, -0.235, 0.05)), 'black', segs=6, rings=4)
    for k in range(5):
        t = (k - 2) / 2
        p.box((0.05, 0.02, 0.02), (t * 0.1, -0.245, 1.95 - 0.03 * (1 - t * t)), rot=(0, 25 if k % 2 else -25, 0), color='black')
    p.cyl(0.03, 0.12, hc + Vector((0, -0.24, -0.02)), rot=(90, 0, 0), color='orange', segs=5, r2=0.0)
    # straw hat
    p.lathe([(0.0, 0.0), (0.45, 0.0), (0.47, 0.03), (0.22, 0.04), (0.2, 0.2), (0.0, 0.22)], hc + Vector((0, 0, 0.16)), rot=(-6, 4, 0),
            color=grad_z('hay_dk', 'hay_lt', 2.1, 2.45, 0.2, 9), segs=14)
    p.lathe([(0.205, 0.05), (0.212, 0.05), (0.212, 0.1), (0.205, 0.1)], hc + Vector((0, 0, 0.16)), rot=(-6, 4, 0), color='red', segs=14, cap0=False, cap1=False)
    # crow on the arm
    c = Vector((0.6, 0.0, 1.78))
    p.sphere(0.09, c, 'black', scale=(0.8, 1.3, 0.9), segs=8, rings=5)
    p.sphere(0.06, c + Vector((0, -0.11, 0.07)), 'black', segs=6, rings=4)
    p.cyl(0.02, 0.06, c + Vector((0, -0.15, 0.07)), rot=(90, 0, 0), color='orange', segs=4, r2=0.0)
    p.hard = False
    return [p]


def well(lod=0, seed=15):
    rng = random.Random(seed)
    p = Part('well', hard=True, seed=seed)
    R = 0.95
    n = 11
    for course in range(2):
        for i in range(n):
            a = (i + 0.5 * (course % 2)) * 2 * math.pi / n
            c = rng.choice(['stone', 'stone_lt', 'stone_dk', 'stone'])
            p.box((0.56, 0.34, 0.4), (math.cos(a) * R, math.sin(a) * R, course * 0.41), rot=(0, 0, math.degrees(a) + 90),
                  color=c, base=True, bevel=0.05, jitter=0.05)
    p.lathe([(R - 0.25, 0.86), (R + 0.2, 0.86), (R + 0.22, 0.92), (R - 0.25, 0.92)], (0, 0, 0), color='stone_lt', segs=16, cap0=False, cap1=False)
    p.cyl(R - 0.18, 0.05, (0, 0, 0.55), color='#2f5a7a', segs=14)   # water
    # posts and roof
    for sx in (-1, 1):
        p.box((0.16, 0.16, 2.3), (sx * (R + 0.05), 0, 0.0), color='wood_dk', base=True, bevel=0.02)
    # gable roof, ridge along X, slopes towards +-Y
    a = 35
    for sy in (-1, 1):
        cy, cz = sy * 0.62 * math.cos(math.radians(a)), 2.98 - 0.62 * math.sin(math.radians(a))
        p.box((2.5, 1.32, 0.07), (0, cy, cz), rot=(-sy * a, 0, 0), color='wood_dk')
        for r in range(3):   # stepped shingle rows
            d = 0.25 + r * 0.38
            yy, zz = sy * d * math.cos(math.radians(a)), 3.02 - d * math.sin(math.radians(a))
            p.box((2.56, 0.5, 0.06), (0, yy, zz), rot=(-sy * (a + 5), 0, 0), color='roof_tile' if r % 2 == 0 else 'roof_tile_dk', jitter=0.06)
    p.box((2.6, 0.18, 0.14), (0, 0, 3.02), color='roof_tile_dk', bevel=0.03)
    for sx in (-1, 1):   # gable boards
        p.prism([(-0.9, 2.32), (0.9, 2.32), (0, 2.95)], 0.06, (sx * (R + 0.05), 0, 0), rot=(0, 0, 90), color='wood')
    # crank axle, rope, bucket
    p.cyl(0.07, 2.3, (-1.15, 0, 1.75), rot=(0, 90, 0), color='wood', segs=8)
    p.box((0.06, 0.06, 0.35), (1.22, 0, 1.6), color='metal_dk')
    p.cyl(0.03, 0.2, (1.22, 0, 1.45), rot=(0, 90, 0), color='black', segs=6)
    p.cyl(0.13, 0.4, (-0.2, 0, 1.75), rot=(0, 90, 0), color='hay_dk', segs=10)    # rope coil
    p.cyl(0.015, 0.75, (0, 0, 1.0), color='hay_dk', segs=4)
    p.lathe([(0.0, 0.0), (0.16, 0.0), (0.2, 0.3), (0.21, 0.32), (0.19, 0.32), (0.15, 0.03), (0, 0.03)], (0, 0, 0.72), color='wood', segs=10)
    p.lathe([(0.17, 0.08), (0.185, 0.08), (0.2, 0.12), (0.18, 0.12)], (0, 0, 0.72), color='metal_dk', segs=10, cap0=False, cap1=False)
    return [p]


def sign_arrow(lod=0, seed=16):
    """Chevron turn sign pointing RIGHT (+X in glTF, the driver's right when approaching from the front).
    Mirror it with scale.x = -1 for a left turn."""
    p = Part('sign_arrow', hard=True, seed=seed)
    for sx in (-1, 1):
        p.box((0.12, 0.12, 1.75), (sx * 0.85, 0.08, -0.1), color='wood', base=True, bevel=0.02)
    p.box((2.4, 0.1, 0.95), (0, -0.0, 0.85), color='white', base=True, bevel=0.035)
    p.box((2.26, 0.04, 0.81), (0, -0.05, 0.92), color='#ee6f12', base=True)
    for k in range(3):
        x = -0.6 + k * 0.62
        chev = [(x - 0.22, 1.67), (x - 0.02, 1.67), (x + 0.28, 1.325), (x - 0.02, 0.98), (x - 0.22, 0.98), (x + 0.08, 1.325)]
        p.prism(chev, 0.04, (0, -0.08, 0), color='white')
    return [p]


BUILDERS = {
    'fence_wood': fence_wood, 'hay_bale': hay_bale, 'hay_stack': hay_stack, 'crate': crate,
    'tractor': tractor, 'sheep': sheep, 'scarecrow': scarecrow, 'well': well, 'sign_arrow': sign_arrow,
}
LODS = set()
AO = {
    'fence_wood': dict(distance=0.4), 'hay_bale': dict(distance=0.6, strength=0.5), 'hay_stack': dict(distance=1.0, strength=0.5),
    'crate': dict(distance=0.3), 'tractor': dict(distance=0.6), 'sheep': dict(distance=0.3, strength=0.45),
    'scarecrow': dict(distance=0.4), 'well': dict(distance=0.6), 'sign_arrow': dict(distance=0.3),
}
