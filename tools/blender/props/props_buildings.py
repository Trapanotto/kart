"""Buildings: barn, windmill, farmhouse, silo."""
import math, random
from mathutils import Vector, noise
from kit import Part, PAL, lin, mix, grad_z, M


# ---------------------------------------------------------------------------
# shared building helpers
# ---------------------------------------------------------------------------

def battens_x(p, x0, x1, y, z0, z1, step, color, depth=0.07, width=0.12, side=-1, jitter=0.05):
    """Vertical battens on a wall running along X at plane y (side = -1 front-facing)."""
    n = int(round((x1 - x0) / step))
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        p.box((width, depth, z1 - z0), (x, y + side * depth / 2, z0), color=color, base=True, jitter=jitter)


def battens_y(p, y0, y1, x, z0, z1, step, color, depth=0.07, width=0.12, side=1, jitter=0.05):
    n = int(round((y1 - y0) / step))
    for i in range(n + 1):
        y = y0 + (y1 - y0) * i / n
        p.box((depth, width, z1 - z0), (x + side * depth / 2, y, z0), color=color, base=True, jitter=jitter)


def window(p, loc, w, h, axis='y', side=-1, frame='trim', glass='window', cross=True, shutters=None, depth=0.12, simple=False):
    """Window on a wall. axis='y': wall plane is XZ (normal along Y); 'x': wall plane is YZ."""
    x, y, z = loc
    t = 0.12

    def B(sx, sz, dx, dz, dd, col, thick):
        if axis == 'y':
            p.box((sx, thick, sz), (x + dx, y + side * dd, z + dz), color=col)
        else:
            p.box((thick, sx, sz), (x + side * dd, y + dx, z + dz), color=col)
    if simple:   # LOD: frame slab + glass, 24 triangles
        B(w + 2 * t, h + 2 * t, 0, 0, 0.0, frame, 0.05)
        B(w, h, 0, 0, 0.02, glass, 0.05)
        return
    B(w, h, 0, 0, 0.0, glass, 0.05)                  # glass pane (slightly proud of the wall)
    B(w + 2 * t, t, 0, h / 2 + t / 2, depth / 2, frame, depth)
    B(w + 2 * t, t * 1.4, 0, -h / 2 - t * 0.7, depth / 2 + 0.03, frame, depth + 0.06)   # sill
    B(t, h, -w / 2 - t / 2, 0, depth / 2, frame, depth)
    B(t, h, w / 2 + t / 2, 0, depth / 2, frame, depth)
    if cross:
        B(0.07, h, 0, 0, 0.04, frame, 0.06)
        B(w, 0.07, 0, 0, 0.04, frame, 0.06)
    if shutters:
        for s in (-1, 1):
            B(w * 0.5, h + 0.1, s * (w / 2 + t + w * 0.25 + 0.02), 0, 0.05, shutters, 0.06)


def shingle_roof(p, a, b, length, rows, color, thick=0.09, overlap=0.18, jitter=0.06, y0=0.0, flip=False, mat='base'):
    """Rows of overlapping slabs on a roof plane between 2D points a -> b (x, z), extruded along Y.
    a is the lower (eave) edge, b the upper edge. Rows are stepped so the roof reads as shingles."""
    a, b = Vector((a[0], 0, a[1])), Vector((b[0], 0, b[1]))
    d = b - a
    L = d.length
    u = d / L
    nrm = Vector((-u.z, 0, u.x)) if u.x > 0 else Vector((u.z, 0, -u.x))   # outward (up)
    if nrm.z < 0:
        nrm = -nrm
    ang = math.degrees(math.atan2(u.z, u.x))
    step = L / rows
    for i in range(rows):
        s0 = i * step
        c = a + u * (s0 + step / 2 + overlap / 2) + nrm * (thick / 2 + 0.02 * (rows - i))
        w = step + overlap
        # slab tilted a bit more than the roof so the lower edge kicks out
        tilt = 4.0
        rot_y = -ang + (tilt if u.x > 0 else -tilt)
        p.box((w, length, thick), (c.x, y0, c.z), rot=(0, rot_y, 0), color=color, jitter=jitter, mat=mat)


# ---------------------------------------------------------------------------
# Barn
# ---------------------------------------------------------------------------

BARN_W = 12.0     # interior width
BARN_L = 30.0     # interior length
BARN_EAVE = 6.0
OPEN_W = 11.0
OPEN_H = 5.4


def barn(lod=0, seed=3):
    rng = random.Random(seed)
    root = Part('barn', hard=True, seed=seed)
    hw = BARN_W / 2
    wt = 0.3
    ox = hw + wt              # outer x
    hl = BARN_L / 2
    oy = hl + wt
    red = 'barn_red'
    redd = 'barn_red_dk'
    # stone plinth
    for sx in (-1, 1):
        root.box((wt + 0.12, 2 * oy + 0.12, 0.55), (sx * (hw + wt / 2), 0, 0), color='stone', base=True, bevel=0.04 if lod == 0 else 0)
    # long side walls
    for sx in (-1, 1):
        root.box((wt, 2 * oy, BARN_EAVE - 0.55), (sx * (hw + wt / 2), 0, 0.55), color=red, base=True, jitter=0.02)
        if lod == 0:
            battens_y(root, -oy + 0.5, oy - 0.5, sx * ox, 0.55, BARN_EAVE, 1.0, redd if True else red, side=sx, jitter=0.06)
            for wy in (-9.0, -3.0, 3.0, 9.0):
                window(root, (sx * (ox + 0.04), wy, 3.6), 1.3, 1.3, axis='x', side=sx, cross=True)
        # eave trim
        root.box((0.2, 2 * oy + 1.2, 0.3), (sx * (ox + 0.1), 0, BARN_EAVE - 0.3), color='trim', base=True)
        # corner boards
        for sy in (-1, 1):
            root.box((0.34, 0.34, BARN_EAVE - 0.55), (sx * (ox - 0.1), sy * (oy - 0.1), 0.55), color='trim', base=True)
    # gambrel profile (x, z), outer, used for gable walls and fascia
    prof = [(ox + 0.35, BARN_EAVE - 0.15), (4.6, 9.2), (0, 11.1), (-4.6, 9.2), (-ox - 0.35, BARN_EAVE - 0.15)]
    for sy, has_doors in ((-1, True), (1, False)):
        y = sy * (oy - wt / 2)
        # side pillars beside the opening
        for sx in (-1, 1):
            pw = ox - OPEN_W / 2
            root.box((pw, wt, BARN_EAVE - 0.55), (sx * (OPEN_W / 2 + pw / 2), y, 0.55), color=red, base=True)
            root.box((pw + 0.12, wt + 0.12, 0.55), (sx * (OPEN_W / 2 + pw / 2), y, 0), color='stone', base=True)
        # lintel band above the opening
        root.box((2 * ox, wt, BARN_EAVE - OPEN_H), (0, y, OPEN_H), color=red, base=True)
        root.box((OPEN_W + 0.5, wt + 0.16, 0.28), (0, y, OPEN_H), color='trim', base=True)
        for sx in (-1, 1):   # white opening jambs
            root.box((0.24, wt + 0.16, OPEN_H), (sx * (OPEN_W / 2 + 0.12), y, 0), color='trim', base=True)
        # gable triangle (gambrel) above the eave
        gpoly = [(ox, BARN_EAVE), (4.45, 9.1), (0, 10.95), (-4.45, 9.1), (-ox, BARN_EAVE)]
        root.prism(gpoly, wt, (0, y, 0), color=red)
        if lod == 0:
            # battens on the gable
            for i in range(-6, 7):
                x = i * 0.95
                top = 10.95 - abs(x) * (1.85 / 4.45) if abs(x) < 4.45 else 9.1 - (abs(x) - 4.45) * (3.1 / (ox - 4.45))
                root.box((0.12, 0.07, top - BARN_EAVE - 0.05), (x, y + sy * (wt / 2 + 0.035), BARN_EAVE), color=redd, base=True, jitter=0.06)
            # hay loft door with white X
            ly = y + sy * (wt / 2 + 0.05)
            root.box((2.4, 0.1, 2.4), (0, ly, 7.1), color=redd, base=True)
            for (sx_, sz_, dx, dz) in ((2.7, 0.18, 0, 0), (2.7, 0.18, 0, 2.4), (0.18, 2.6, -1.25, 1.2), (0.18, 2.6, 1.25, 1.2)):
                root.box((sx_, 0.14, sz_), (dx, ly + sy * 0.03, 7.1 + dz - (sz_ / 2 if sz_ > 1 else 0)), color='trim', base=sz_ > 1)
            for r in (45, -45):
                root.box((3.1, 0.12, 0.16), (0, ly + sy * 0.05, 8.3), rot=(0, r, 0), color='trim')
            # hoist beam
            root.box((0.3, 1.4, 0.3), (0, y + sy * 0.7, 9.85), color='wood_dk', bevel=0.03)
        # fascia boards following the roof edge
        yb = sy * (oy + 0.62)
        for (x0, z0), (x1, z1) in zip(prof[:-1], prof[1:]):
            c = Vector(((x0 + x1) / 2, yb, (z0 + z1) / 2 + 0.05))
            L = math.hypot(x1 - x0, z1 - z0)
            ang = math.degrees(math.atan2(z1 - z0, x1 - x0))
            root.box((L + 0.3, 0.16, 0.36), tuple(c), rot=(0, -ang, 0), color='trim')
    # roof: four planes of stepped shingle rows
    RL = 2 * oy + 1.25
    planes = [((ox + 0.35, BARN_EAVE - 0.15), (4.45, 9.25)), ((4.45, 9.25), (0, 11.1)),
              ((-ox - 0.35, BARN_EAVE - 0.15), (-4.45, 9.25)), ((-4.45, 9.25), (0, 11.1))]
    rows = (4, 5) if lod == 0 else (1, 1)
    for k, (a, b) in enumerate(planes):
        shingle_roof(root, a, b, RL, rows[k % 2], 'roof_slate', thick=0.12, jitter=0.1 if lod == 0 else 0, overlap=0.2 if lod == 0 else 0.0)
    root.box((0.5, RL + 0.1, 0.3), (0, 0, 11.1), color='roof_slate_dk', bevel=0.06 if lod == 0 else 0)
    # cupola with weathervane
    cz = 11.0
    root.box((1.6, 1.6, 1.4), (0, 0, cz), color=red, base=True, bevel=0.03)
    root.box((1.75, 1.75, 0.15), (0, 0, cz + 1.4), color='trim', base=True)
    if lod == 0:
        for s in (-1, 1):
            root.box((1.0, 0.06, 0.9), (0, s * 0.81, cz + 0.3), color='trim', base=True)
            root.box((0.06, 1.0, 0.9), (s * 0.81, 0, cz + 0.3), color='trim', base=True)
    root.cyl(1.35, 1.1, (0, 0, cz + 1.55), color='roof_slate', segs=4, r2=0.02, rot=(0, 0, 45))
    root.cyl(0.04, 1.2, (0, 0, cz + 2.5), color='black', segs=5)
    if lod == 0:
        root.prism([(-0.6, 0), (0.35, 0), (0.35, 0.12), (0.6, -0.1), (0.35, -0.32), (0.35, -0.2), (-0.6, -0.2)], 0.05, (0, 0, cz + 3.55), color='black')
        root.box((0.04, 0.9, 0.04), (0, 0, cz + 3.2), color='black')
        root.box((0.9, 0.04, 0.04), (0, 0, cz + 3.2), color='black')
    # ---- interior: posts, tie beams, knee braces, hay
    wood = 'wood_dk'
    for i in range(7):
        y = -hl + 0.3 + i * (BARN_L - 0.6) / 6
        for sx in (-1, 1):
            root.box((0.32, 0.32, BARN_EAVE - 0.1), (sx * (hw - 0.16), y, 0), color=wood, base=True, bevel=0.03 if lod == 0 else 0, jitter=0.05)
        root.box((BARN_W, 0.3, 0.36), (0, y, 5.45), color=wood, bevel=0.03 if lod == 0 else 0, jitter=0.05)
        if lod == 0:
            for sx in (-1, 1):
                root.box((1.7, 0.2, 0.22), (sx * (hw - 0.75), y, 4.65), rot=(0, sx * 45, 0), color=wood)
            # king post and rafters to the ridge
            root.box((0.22, 0.22, 5.4), (0, y, 5.6), color=wood, base=True)
            for sx in (-1, 1):
                root.box((5.2, 0.2, 0.24), (sx * 2.9, y, 8.1), rot=(0, sx * 29, 0), color=wood)
    if lod == 0:
        # longitudinal purlins
        for sx in (-1, 1):
            root.box((0.24, BARN_L, 0.3), (sx * (hw - 0.3), 0, 5.75), color=wood)
            root.box((0.24, BARN_L, 0.3), (sx * 4.3, 0, 8.85), color=wood)
        # hay bales stacked along the walls, clear of the centre lane |x| < 4.2
        hay = lambda: 'hay' if rng.random() < 0.6 else ('hay_dk' if rng.random() < 0.5 else 'hay_lt')
        for sx in (-1, 1):
            for j in range(7):
                y = -12.0 + j * 4.0 + rng.uniform(-0.3, 0.3)
                h = rng.choice([1, 2, 2, 3])
                for k in range(h):
                    for m in range(2 if k < 2 else 1):
                        root.box((0.55, 1.15, 0.5), (sx * (hw - 0.6 - m * 0.6), y + rng.uniform(-0.1, 0.1), k * 0.5),
                                 rot=(0, 0, rng.uniform(-4, 4)), color=hay(), base=True, bevel=0.06, seg=1, jitter=0.05)
        # loose hay piles in the far corners and the loft
        for (x, y) in ((-4.9, 13.2), (4.9, 12.8), (-4.8, -13.3)):
            root.blob([((x, y, 0.1), 1.6), ((x + 0.5 * (1 if x < 0 else -1), y - 0.4, 0.0), 1.2), ((x, y + 0.3, 0.6), 1.0)],
                      grad_z('hay_dk', 'hay_lt', -0.3, 1.4, 0.3, 2.0), res=0.22, tris=120, noise_amp=0.12, noise_scale=3,
                      mat='base', squash=(0.05, 0.0))
    # ---- doors (child nodes, pivot at the outer hinge edge, front side y = -oy)
    parts = [root]
    dw = OPEN_W / 2
    for name, sx in (('door_l', 1), ('door_r', -1)):
        hinge = Vector((sx * OPEN_W / 2, -oy - 0.12, 0.05))
        d = Part(name, origin=hinge, parent='barn', hard=True, seed=seed + sx)
        cx = sx * (OPEN_W / 2 - dw / 2)
        yy = hinge.y
        d.box((dw - 0.04, 0.14, OPEN_H - 0.1), (cx, yy, 0.05), color=red, base=True, jitter=0.02)
        if lod == 0:
            for i in range(6):   # vertical boards relief
                d.box((0.1, 0.05, OPEN_H - 0.5), (cx - dw / 2 + 0.45 + i * (dw - 0.9) / 5, yy - 0.09, 0.3), color=redd, base=True, jitter=0.06)
        # white frame and X brace
        fz = OPEN_H - 0.1
        for (sx_, sz_, dx, z) in ((dw - 0.04, 0.28, 0, 0.05), (dw - 0.04, 0.28, 0, fz - 0.23), (0.28, fz, -dw / 2 + 0.16, 0.05), (0.28, fz, dw / 2 - 0.16, 0.05)):
            d.box((sx_, 0.1, sz_), (cx + dx, yy - 0.14, z), color='trim', base=True)
        diag = math.degrees(math.atan2(fz - 0.5, dw - 0.5))
        L = math.hypot(fz - 0.5, dw - 0.5)
        for r in (diag, -diag):
            d.box((L, 0.08, 0.26), (cx, yy - 0.14, 0.05 + fz / 2), rot=(0, r, 0), color='trim')
        # handle and hinge straps
        d.box((0.08, 0.12, 0.8), (sx * 0.35, yy - 0.2, 2.2), color='black', base=True)
        for z in (1.0, 4.2):
            d.box((1.2, 0.04, 0.16), (sx * (OPEN_W / 2 - 0.6), yy - 0.2, z), color='black')
        parts.append(d)
    return parts


# ---------------------------------------------------------------------------
# Windmill
# ---------------------------------------------------------------------------

HUB = Vector((0, -3.05, 11.3))


def _oct_r(z, z0=1.2, z1=10.4, r0=3.0, r1=1.95):
    t = (z - z0) / (z1 - z0)
    return r0 + (r1 - r0) * t


def windmill(lod=0, seed=17):
    rng = random.Random(seed)
    p = Part('windmill', hard=True, seed=seed)
    ph = math.pi / 8        # a flat face points to the front (-Y)
    ap = math.cos(math.pi / 8)
    p.lathe([(0.0, 0.0), (3.35, 0.0), (3.35, 1.0), (3.15, 1.25), (0.0, 1.25)], color=grad_z('stone_dk', 'stone', 0, 1.2, 0.3, 2),
            segs=8, phase=ph)
    if lod == 0:   # stone courses on the plinth
        for k in range(8):
            a = (k + 0.5) * 2 * math.pi / 8 + ph
            for zz in (0.35, 0.7):
                p.box((1.2, 0.08, 0.06), (math.cos(a) * 3.36 * ap, math.sin(a) * 3.36 * ap, zz), rot=(0, 0, math.degrees(a) + 90), color='stone_dk')
    z0, z1 = 1.2, 10.4
    zs = [z0 + 0.06 + (z1 - 0.1 - z0 - 0.06) * i / 6 for i in range(7)]   # extra rings so baked vertex AO has samples
    p.lathe([(_oct_r(z), z) for z in zs] + [(0.0, z1 - 0.1)], color=grad_z('wall_cream', 'white', z0, z1, 0.08, 1.5), segs=8, phase=ph, cap0=False)
    # timber corner posts along the 8 edges
    for k in range(8 if lod == 0 else 0):
        a = k * 2 * math.pi / 8 + ph
        b0 = Vector((math.cos(a) * _oct_r(z0), math.sin(a) * _oct_r(z0), z0))
        b1 = Vector((math.cos(a) * _oct_r(z1), math.sin(a) * _oct_r(z1), z1))
        p.sweep([b0, b1], 0.13, 'timber', segs=4)
    # horizontal timber bands
    for zb in ((4.6, 8.0) if lod == 0 else (4.6,)):
        r = _oct_r(zb) + 0.06
        p.lathe([(r, zb - 0.12), (r + 0.04, zb - 0.1), (r + 0.04, zb + 0.1), (r, zb + 0.12)], color='timber', segs=8, phase=ph, cap0=False, cap1=False)
    # gallery (stage) with railing
    gz = 4.5
    p.lathe([(_oct_r(gz), gz - 0.25), (4.3, gz - 0.25), (4.3, gz), (_oct_r(gz), gz)], color='wood', segs=8, phase=ph, cap0=False, cap1=False)
    for k in range(8 if lod == 0 else 0):
        a = k * 2 * math.pi / 8 + ph
        d = Vector((math.cos(a), math.sin(a), 0))
        c = d * (_oct_r(gz) + 1.0) + Vector((0, 0, gz - 0.2))
        p.sweep([Vector((0, 0, gz - 1.6)) + d * (_oct_r(gz - 1.6) + 0.05), c], 0.08, 'wood_dk', segs=4)
    if lod == 0:
        for k in range(16):
            a = k * 2 * math.pi / 16 + ph
            r = 4.15
            p.box((0.08, 0.08, 1.0), (math.cos(a) * r, math.sin(a) * r, gz), color='wood_dk', base=True)
        p.lathe([(4.1, gz + 0.92), (4.2, gz + 0.92), (4.2, gz + 1.02), (4.1, gz + 1.02)], color='wood', segs=16, cap0=False, cap1=False, phase=ph)
        p.lathe([(4.12, gz + 0.45), (4.18, gz + 0.45), (4.18, gz + 0.52), (4.12, gz + 0.52)], color='wood', segs=16, cap0=False, cap1=False, phase=ph)
    # door (front) and windows
    tilt = math.degrees(math.atan((_oct_r(z0) - _oct_r(z1)) / (z1 - z0)))
    yd = -(_oct_r(2.2)) * ap - 0.05
    p.box((1.3, 0.18, 1.9), (0, yd, 1.25), rot=(-tilt, 0, 0), color='timber', base=True)
    p.cyl(0.65, 0.18, (0, yd + 0.09, 3.12), rot=(90 - tilt, 0, 0), color='timber', segs=10)
    p.box((1.6, 0.5, 0.16), (0, yd - 0.15, 1.1), color='stone_lt', base=True)
    for z, ang in ((6.3, -90), (8.6, -90), (6.8, 0), (6.8, 180)):
        r = _oct_r(z) * ap + 0.02
        aa = math.radians(ang)
        if ang == -90:
            window(p, (0, -r, z), 0.6, 0.8, axis='y', side=-1, simple=lod > 0)
        else:
            window(p, (math.cos(aa) * r, 0, z), 0.6, 0.8, axis='x', side=1 if ang == 0 else -1, simple=lod > 0)
    # cap: elongated dome
    cz = 10.3
    p.lathe([(2.25, 0.0), (2.4, 0.15), (2.35, 0.3), (2.2, 0.8), (1.85, 1.5), (1.3, 2.1), (0.6, 2.5), (0.0, 2.6)], (0, 0.2, cz),
            color=grad_z('roof_tile_dk', 'roof_tile', cz, cz + 2.6, 0.15, 2), segs=16 if lod == 0 else 10, scale=(1.0, 1.25, 1.0))
    p.lathe([(2.3, -0.1), (2.45, -0.1), (2.45, 0.12), (2.3, 0.12)], (0, 0.2, cz), color='trim', segs=16 if lod == 0 else 10,
            cap0=False, cap1=False, scale=(1.0, 1.25, 1.0))
    # windshaft housing and tail pole
    p.cyl(0.42, 1.4, (HUB.x, HUB.y + 1.4, HUB.z), rot=(90, 0, 0), color='timber', segs=10)
    p.sweep([(0, 2.6, cz + 0.6), (0, 4.6, 6.0), (0, 5.3, 4.4)], 0.13, 'wood_dk', segs=5)
    p.sweep([(0.9, 2.3, cz + 0.4), (0, 4.6, 6.0)], 0.07, 'wood_dk', segs=4)
    p.sweep([(-0.9, 2.3, cz + 0.4), (0, 4.6, 6.0)], 0.07, 'wood_dk', segs=4)
    # ---- blades: child node, pivot on the hub, sails in the XZ plane, spinning about the forward axis
    b = Part('blades', origin=tuple(HUB), parent='windmill', hard=True, seed=seed + 1)
    b.cyl(0.5, 0.6, (HUB.x, HUB.y + 0.3, HUB.z), rot=(90, 0, 0), color='timber', segs=10, bevel=0.05)
    b.cyl(0.32, 0.35, (HUB.x, HUB.y - 0.3, HUB.z), rot=(90, 0, 0), color='red', segs=10, r2=0.12)
    for k in range(4):
        a = k * 90 + 15
        m = M(tuple(HUB), (0, -a, 0))      # rotate in the XZ plane about the Y axis
        b.box((7.9, 0.22, 0.3), (3.6, 0.0, 0), color='wood_dk', matrix=m)
        # lattice frame on the trailing side
        w, r0, r1 = 1.55, 1.6, 7.4
        b.box((r1 - r0, 0.1, 0.1), ((r0 + r1) / 2, -0.05, -w), color='wood', matrix=m)
        nbar = 9 if lod == 0 else 1
        for i in range(nbar + 1):
            x = r0 + (r1 - r0) * i / nbar
            b.box((0.09, 0.09, w + 0.1), (x, -0.08, -w / 2), color='wood', matrix=m)
        # sail cloth (partly furled near the hub)
        b.box((r1 - r0 - 1.0, 0.04, w - 0.16), ((r0 + r1) / 2 + 0.5, 0.06, -w / 2), color='white', matrix=m, jitter=0.03)
        if lod == 0:
            b.cyl(0.12, w - 0.1, (r0 + 0.35, 0.05, -w + 0.05), color='wall_cream', matrix=m, segs=6)
    return [p, b]


# ---------------------------------------------------------------------------
# Farmhouse (gable faces the front, half-timbered upper floor)
# ---------------------------------------------------------------------------

def farmhouse(lod=0, seed=19):
    rng = random.Random(seed)
    p = Part('farmhouse', hard=True, seed=seed)
    W, D = 9.0, 10.0
    hw, hd = W / 2, D / 2
    z1, z2 = 3.0, 5.7          # first floor, eaves
    ridge = 9.3
    p.box((W + 0.2, D + 0.2, 0.55), (0, 0, 0), color='stone', base=True, bevel=0.04)
    p.box((W, D, z1 - 0.55), (0, 0, 0.55), color='wall_cream', base=True)
    p.box((W + 0.12, D + 0.12, z2 - z1), (0, 0, z1), color='wall_cream', base=True)
    for sy in (-1, 1):
        p.prism([(hw + 0.06, z2), (0, ridge - 0.15), (-hw - 0.06, z2)], 0.3, (0, sy * (hd - 0.09), 0), color='wall_cream')
    tim = 'timber'
    if lod == 0:
        for sy in (-1, 1):
            y = sy * (hd + 0.1)
            p.box((W + 0.2, 0.12, 0.2), (0, y, z1), color=tim, base=True)
            p.box((W + 0.2, 0.12, 0.18), (0, y, z2 - 0.18), color=tim, base=True)
            for x in (-hw, -1.5, 1.5, hw):
                p.box((0.18, 0.12, z2 - z1), (x, y, z1), color=tim, base=True)
            for x0, s in ((-hw, 1), (hw, -1)):
                L = math.hypot(1.6, z2 - z1 - 0.3)
                ang = math.degrees(math.atan2(z2 - z1 - 0.3, 1.6))
                p.box((L, 0.1, 0.16), (x0 + s * 0.85, y, (z1 + z2) / 2), rot=(0, -s * ang, 0), color=tim)
            for x in (-1.9, 1.9):
                top = ridge - 0.2 - abs(x) * (ridge - z2) / hw
                p.box((0.16, 0.12, top - z2), (x, y, z2), color=tim, base=True)
            p.box((W * 0.6, 0.12, 0.16), (0, y, z2 + 1.3), color=tim, base=True)
        for sx in (-1, 1):
            x = sx * (hw + 0.1)
            p.box((0.12, D + 0.2, 0.2), (x, 0, z1), color=tim, base=True)
            for yy in (-hd, -1.25, 1.25, hd):
                p.box((0.12, 0.18, z2 - z1), (x, yy, z1), color=tim, base=True)
            for y0, s in ((-hd, 1), (hd, -1)):
                L = math.hypot(1.6, z2 - z1 - 0.3)
                ang = math.degrees(math.atan2(z2 - z1 - 0.3, 1.6))
                p.box((0.1, L, 0.16), (x, y0 + s * 0.85, (z1 + z2) / 2), rot=(s * ang, 0, 0), color=tim)
    RL = D + 1.4
    rows = 6 if lod == 0 else 1
    for sx in (-1, 1):
        shingle_roof(p, (sx * (hw + 0.75), z2 - 0.35), (0, ridge), RL, rows, 'roof_tile', thick=0.14,
                     jitter=0.08 if lod == 0 else 0, overlap=0.22 if lod == 0 else 0)
    p.box((0.4, RL + 0.1, 0.3), (0, 0, ridge + 0.05), color='roof_tile_dk', bevel=0.05 if lod == 0 else 0)
    a0 = (hw + 0.75, z2 - 0.35)
    L = math.hypot(a0[0], ridge - a0[1])
    ang = math.degrees(math.atan2(ridge - a0[1], a0[0]))
    for sy in (-1, 1):
        for sx in (-1, 1):
            p.box((L + 0.2, 0.14, 0.3), (sx * a0[0] / 2, sy * (RL / 2), (a0[1] + ridge) / 2 + 0.12), rot=(0, sx * ang, 0), color='wood_dk')
    p.box((0.8, 0.8, 3.0), (2.0, 1.8, ridge - 1.6), color='stone_lt', base=True, bevel=0.03)
    p.box((1.0, 1.0, 0.2), (2.0, 1.8, ridge + 1.4), color='stone_dk', base=True, bevel=0.03)
    fy = -hd
    p.box((1.3, 0.16, 2.3), (0, fy - 0.03, 0.55), color='timber', base=True, bevel=0.03)
    p.box((1.1, 0.06, 0.9), (0, fy - 0.12, 1.25), color='wood', base=True)
    p.sphere(0.06, (0.4, fy - 0.15, 1.6), 'yellow', segs=6, rings=4)
    p.box((2.2, 1.1, 0.12), (0, fy - 0.5, 2.95), rot=(12, 0, 0), color='roof_tile', base=True, bevel=0.02)
    p.box((1.6, 0.4, 0.15), (0, fy - 0.35, 0.0), color='stone_lt', base=True)
    sh = 'blue'
    for x in (-2.6, 2.6):
        window(p, (x, fy - 0.02, 1.8), 1.0, 1.1, 'y', -1, shutters=sh if lod == 0 else None, simple=lod > 0)
        window(p, (x, fy - 0.12, 4.35), 1.0, 1.0, 'y', -1, shutters=sh if lod == 0 else None, simple=lod > 0)
        window(p, (x, hd + 0.02, 1.8), 1.0, 1.1, 'y', 1, simple=lod > 0)
        window(p, (x, hd + 0.12, 4.35), 1.0, 1.0, 'y', 1, simple=lod > 0)
    window(p, (0, fy - 0.1, 6.8), 0.8, 0.8, 'y', -1, cross=True, simple=lod > 0)
    for sx in (-1, 1):
        for y in ((-2.5, 2.5)):
            window(p, (sx * (hw + 0.02), y, 1.8), 1.0, 1.1, 'x', sx, shutters=sh if lod == 0 else None, simple=lod > 0)
            window(p, (sx * (hw + 0.12), y, 4.35), 1.0, 1.0, 'x', sx, simple=lod > 0)
    if lod == 0:
        for x in (-2.6, 2.6):
            p.box((1.3, 0.3, 0.25), (x, fy - 0.35, 3.55), color='wood_dk', base=True, bevel=0.02)
            for k in range(6):
                p.sphere(0.1, (x - 0.5 + k * 0.2, fy - 0.35 + rng.uniform(-0.05, 0.05), 3.85 + rng.uniform(0, 0.08)),
                         rng.choice(['red', 'pink_lt', 'red', 'apple_lt']), segs=6, rings=4)
        for k in range(3):
            for j in range(5 - k):
                p.cyl(0.13, 1.6, (hw + 0.3, -3.4 + j * 0.27 + k * 0.135, 0.13 + k * 0.23), rot=(90, 0, 90),
                      color=rng.choice(['wood', 'wood_lt', 'bark']), segs=6)
        p.box((1.6, 0.45, 0.08), (-1.9, fy - 0.45, 0.45), color='wood', base=True, bevel=0.02)
        for x in (-2.55, -1.25):
            p.box((0.08, 0.4, 0.45), (x, fy - 0.45, 0), color='wood_dk', base=True)
    return [p]


# ---------------------------------------------------------------------------
# Silo
# ---------------------------------------------------------------------------

def silo(lod=0, seed=23):
    p = Part('silo', hard=True, seed=seed)
    R, H = 2.2, 11.0
    segs = 20 if lod == 0 else 10
    p.lathe([(0, 0), (R + 0.35, 0), (R + 0.35, 0.5), (0, 0.5)], color='stone', segs=segs)
    prof = [(R, 0.5)]
    nb = 11 if lod == 0 else 0
    for i in range(nb):
        z = 0.5 + (H - 0.5) * (i + 0.5) / nb
        prof += [(R, z - 0.06), (R + 0.05, z - 0.03), (R + 0.05, z + 0.03), (R, z + 0.06)]
    prof += [(R, H)]

    def band(co, n):
        if co.z > H - 1.2:
            return lin('barn_red')
        return mix('metal', 'metal_lt', 0.4 + noise.noise(co * 0.6) * 0.5)
    p.lathe(prof, color=band, segs=segs, cap0=False, cap1=False)
    p.lathe([(R + 0.1, H - 0.05), (R + 0.15, H), (R * 0.9, H + 0.8), (R * 0.6, H + 1.45), (R * 0.25, H + 1.8), (0.25, H + 1.9),
             (0.25, H + 2.15), (0.0, H + 2.2)], color=grad_z('metal_dk', 'metal_lt', H, H + 2.2, 0.0), segs=segs)
    for sx in (-1, 1):
        p.box((0.06, 0.06, H + 0.6), (sx * 0.25, -R - 0.3, 0.3), color='metal_dk', base=True)
    if lod == 0:
        for i in range(22):
            p.box((0.5, 0.04, 0.04), (0, -R - 0.3, 0.8 + i * 0.47), color='metal_dk')
        for z in (3.0, 5.0, 7.0, 9.0, 11.0):
            p.lathe([(0.5, z), (0.55, z), (0.55, z + 0.06), (0.5, z + 0.06)], (0, -R - 0.3, 0), color='metal_dk', segs=8, cap0=False, cap1=False)
        p.cyl(0.35, 0.25, (0, 0, H + 2.15), color='barn_red', segs=8, r2=0.05)
    p.sweep([(1.2, -R + 0.15, H - 1.0), (2.3, -R - 0.6, H - 2.5), (2.9, -R - 1.0, 2.5)], 0.25, 'metal_dk', segs=6)
    return [p]


BUILDERS = {'barn': barn, 'windmill': windmill, 'farmhouse': farmhouse, 'silo': silo}
LODS = {'barn', 'windmill', 'farmhouse', 'silo'}
AO = {'barn': dict(distance=2.5, strength=0.6, samples=32), 'windmill': dict(distance=2.0, samples=32),
      'farmhouse': dict(distance=1.5, samples=32), 'silo': dict(distance=1.5, samples=32)}
