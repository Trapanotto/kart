"""Race furniture: start gate, grandstand, balloon arch, wooden bridge, boost pad, ramp."""
import math, random
from mathutils import Vector, noise
from kit import Part, PAL, lin, mix, grad_z, M

ROAD = 18.0


def _checker_strip(p, x0, x1, z, h, y, rows=2, cell=None, colors=('black', 'white'), depth=0.04):
    """Chequered band as a grid of quads in the XZ plane at y (facing -Y)."""
    cell = cell or h / rows
    n = int(round((x1 - x0) / cell))
    for r in range(rows):
        for i in range(n):
            xa, xb = x0 + (x1 - x0) * i / n, x0 + (x1 - x0) * (i + 1) / n
            za, zb = z + h * r / rows, z + h * (r + 1) / rows
            p.quad([(xa, y, za), (xb, y, za), (xb, y, zb), (xa, y, zb)], colors[(i + r) % 2])


def start_gate(lod=0, seed=31):
    """Arch over an 18 m road. Clear height 6.2 m. Child node 'banner' (own material, UV 0..1)."""
    rng = random.Random(seed)
    p = Part('start_gate', hard=True, seed=seed)
    px = ROAD / 2 + 1.0
    for sx in (-1, 1):
        x = sx * px
        p.box((1.6, 1.6, 0.6), (x, 0, 0), color='stone', base=True, bevel=0.06)
        p.box((1.1, 1.1, 7.6), (x, 0, 0.6), color='wood', base=True, bevel=0.06, jitter=0.03)
        for z in (1.6, 3.2, 4.8):   # red/white bands
            p.box((1.16, 1.16, 0.5), (x, 0, z), color='red', base=True, bevel=0.03)
        p.box((1.4, 1.4, 0.3), (x, 0, 8.2), color='white', base=True, bevel=0.05)
        p.cyl(0.85, 1.0, (x, 0, 8.5), segs=4, r2=0.05, rot=(0, 0, 45), color='red')
        p.cyl(0.05, 2.0, (x, 0, 9.3), color='metal_dk', segs=5)
        # pennant flag
        p.prism([(0, 0), (1.2, 0.35), (0, 0.7)], 0.03, (x + 0.05, 0, 10.5), rot=(0, 0, 0), color='yellow' if sx < 0 else 'blue')
    # cross beam with chequered bands
    zb = 6.2
    p.box((2 * px + 1.4, 0.9, 0.5), (0, 0, zb), color='wood_dk', base=True, bevel=0.05)
    p.box((2 * px + 1.4, 0.9, 0.4), (0, 0, zb + 2.6), color='wood_dk', base=True, bevel=0.05)
    for sy in (-1, 1):
        _checker_strip(p, -px + 0.6, px - 0.6, zb + 0.05, 0.4, sy * 0.46, rows=2, cell=0.4)
    # banner frame
    p.box((2 * px - 1.0, 0.25, 2.25), (0, 0, zb + 0.45), color='white', base=True)
    b = Part('banner', parent='start_gate', hard=True, seed=seed, uv_fit=True)
    for sy in (-1, 1):   # both faces of the banner, UV 0..1 across each face
        y = sy * 0.135
        q = [(-px + 0.7, y, zb + 0.55), (px - 0.7, y, zb + 0.55), (px - 0.7, y, zb + 2.6), (-px + 0.7, y, zb + 2.6)]
        b.quad(q if sy < 0 else list(reversed(q)), 'white', mat='banner')
    # bunting under the beam
    if lod == 0:
        cols = ['red', 'yellow', 'blue', 'white', 'teal', 'orange']
        n = 22
        for i in range(n):
            t = (i + 0.5) / n
            x = -px + 1.0 + t * (2 * px - 2.0)
            sag = 0.6 * math.sin(math.pi * t)
            z = zb - 0.1 - sag
            p.prism([(-0.28, 0), (0.28, 0), (0, -0.55)], 0.02, (x, -0.5, z), color=cols[i % len(cols)])
        p.sweep([(-px + 0.6 + (2 * px - 1.2) * k / 12, -0.5, zb - 0.08 - 0.6 * math.sin(math.pi * k / 12)) for k in range(13)], 0.025, 'white', segs=4)
    return [p, b]


def _spectator(p, c, rng, facing=-1):
    """Seated animal fan, about 1.1 m tall, ~90 triangles."""
    body = rng.choice(['red', 'blue', 'yellow', 'teal', 'purple', 'orange', 'white', 'pink_lt'])
    fur = rng.choice(['#8a6240', '#d9c3a0', '#f4efe6', '#6f6a66', '#e08a3c', '#a87a55'])
    c = Vector(c)
    p.lathe([(0.0, 0.0), (0.25, 0.04), (0.24, 0.32), (0.0, 0.52)], c, color=body, segs=6)
    h = c + Vector((0, 0, 0.7))
    p.sphere(0.22, h, lambda co, n, fur=fur: mix(fur, 'white', 0.45) if n.y < -0.6 and co.z < h.z + 0.02 else lin(fur), segs=6, rings=4)
    ear = rng.random()
    for sx in (-1, 1):
        if ear < 0.5:
            p.cyl(0.08, 0.06, h + Vector((sx * 0.15, 0, 0.15)), rot=(90, 0, 0), color=fur, segs=5)
        else:
            p.cyl(0.07, 0.2, h + Vector((sx * 0.12, 0, 0.12)), rot=(0, sx * -20, 0), color=fur, segs=3, r2=0.0)
    if rng.random() < 0.35:
        sx = rng.choice((-1, 1))
        p.sweep([c + Vector((sx * 0.2, 0, 0.35)), c + Vector((sx * 0.36, 0, 0.75)), c + Vector((sx * 0.38, 0, 1.0))], 0.06, body, segs=3)


def grandstand(lod=0, seed=33):
    """Wooden bleachers, 16 m wide, 6 rows facing the front (+Z glTF), roof, seated spectators."""
    rng = random.Random(seed)
    p = Part('grandstand', hard=True, seed=seed)
    W = 16.0
    rows = 6
    rd, rh = 0.85, 0.5
    for r in range(rows):
        y = r * rd
        z = 0.5 + r * rh
        p.box((W, rd, 0.12), (0, y, z - 0.12), color='wood_lt' if r % 2 else 'wood', base=True, jitter=0.04)   # step
        p.box((W, 0.1, rh), (0, y - rd / 2 + 0.05, z - rh - 0.12 + 0.12), color='wood_dk', base=True)        # riser
        p.box((W - 0.4, 0.35, 0.08), (0, y + 0.05, z + 0.35), color='blue' if r % 2 else 'red', base=True, bevel=0.02)  # bench seat
        for x in range(-7, 8, 2):
            p.box((0.08, 0.3, 0.35), (x, y + 0.05, z), color='metal_dk', base=True)
    # back wall, side walls, support frame
    yb = rows * rd - rd / 2
    p.box((W + 0.4, 0.2, 0.5 + rows * rh + 0.9), (0, yb + 0.1, 0), color='wood_dk', base=True)
    for sx in (-1, 1):
        p.prism([(-rd / 2, 0), (yb + 0.2, 0), (yb + 0.2, 0.5 + rows * rh + 0.9), (-rd / 2, 0.9)], 0.2, (sx * (W / 2 + 0.1), 0, 0), rot=(0, 0, 90), color='wood')
    p.box((W + 0.4, 0.2, 0.5), (0, -rd / 2 - 0.1, 0), color='white', base=True)
    # roof on posts
    zr = 0.5 + rows * rh + 3.0
    for x in (-W / 2, -W / 6, W / 6, W / 2):
        p.box((0.22, 0.22, zr - 0.4), (x, yb, 0.4), color='white', base=True)
        p.box((0.16, 0.16, 3.2), (x, -rd / 2 + 0.3, 0.0), color='white', base=True) if False else None
    p.box((W + 1.4, rows * rd + 2.2, 0.18), (0, yb - (rows * rd) / 2 - 0.4, zr), rot=(-7, 0, 0), color='white', base=True, bevel=0.03)
    # scalloped red and white valance
    n = 16
    for i in range(n):
        x = -W / 2 - 0.5 + (W + 1.0) * (i + 0.5) / n
        p.box((W / n + 0.04, 0.08, 0.6), (x, -rd / 2 - 1.55, zr - 0.62 + 0.23), color='red' if i % 2 else 'white', base=True)
        p.cyl((W / n) / 2, 0.08, (x, -rd / 2 - 1.51, zr - 0.38), rot=(90, 0, 0), color='red' if i % 2 else 'white', segs=8)
    # flags on the roof
    for x in (-W / 2, 0, W / 2):
        p.cyl(0.04, 1.6, (x, yb - 0.5, zr + 0.6), color='metal_dk', segs=5)
        p.prism([(0, 0), (1.0, 0.3), (0, 0.6)], 0.03, (x + 0.04, yb - 0.5, zr + 1.55), color='yellow')
    # spectators
    if lod == 0:
        for r in range(rows):
            y = r * rd
            z = 0.5 + r * rh + 0.43
            x = -W / 2 + 0.7 + rng.uniform(0, 0.6)
            while x < W / 2 - 0.6:
                if rng.random() < 0.62:
                    _spectator(p, (x, y + 0.05, z), rng)
                x += rng.uniform(0.8, 1.2)
    return [p]


def balloon_arch(lod=0, seed=35):
    """Arch of balloons spanning an 18 m road (about 18 m clear between the balloon clusters, 7.5 m clear at the top)."""
    rng = random.Random(seed)
    p = Part('balloon_arch', hard=False, seed=seed)
    half = ROAD / 2 + 1.0
    H = 7.9
    cols = ['red', 'yellow', 'blue', 'white']
    n = 30
    pts = []
    for i in range(n + 1):
        t = i / n
        a = math.pi * t
        pts.append(Vector((-half * math.cos(a), 0, H * math.sin(a) ** 0.85)))
    for i, c in enumerate(pts):
        col = cols[(i // 1) % 4]
        tang = (pts[min(n, i + 1)] - pts[max(0, i - 1)]).normalized()
        nrm = Vector((tang.z, 0, -tang.x))
        for k in range(4):   # cluster of four around the spine
            ang = k * math.pi / 2 + (i % 2) * math.pi / 4
            off = nrm * math.cos(ang) * 0.42 + Vector((0, math.sin(ang) * 0.42, 0))
            p.sphere(0.5, c + off, col, scale=(1, 1, 1.1), segs=6, rings=4, mat='gloss')
    for sx in (-1, 1):   # weighted bases
        p.cyl(0.7, 0.45, (sx * half, 0, 0), color='white', segs=10, mat='gloss')
        p.cyl(0.55, 0.15, (sx * half, 0, 0.45), color='red', segs=10, mat='gloss')
    return [p]


def bridge_wood(lod=0, seed=37):
    """Wooden road bridge. Origin = centre of the deck TOP surface (place it at road height).
    Deck 18 m wide (X) by 24 m long (Z). Child nodes: deck, railing_l (+X), railing_r (-X), supports."""
    rng = random.Random(seed)
    root = Part('bridge_wood', empty=True)
    W, L = 18.0, 24.0
    deck = Part('deck', parent='bridge_wood', hard=True, seed=seed)
    n = 40
    for i in range(n):
        y = -L / 2 + (i + 0.5) * L / n
        deck.box((W + 0.6, L / n - 0.04, 0.16), (rng.uniform(-0.08, 0.08), y, -0.16), color=rng.choice(['wood', 'wood_lt', 'wood_grey', 'wood']),
                 base=True, jitter=0.05)
    for x in (-8.5, -4.25, 0, 4.25, 8.5):
        deck.box((0.4, L, 0.45), (x, 0, -0.62), color='wood_dk', base=True)
    for sx in (-1, 1):   # kerb beams
        deck.box((0.35, L, 0.3), (sx * (W / 2 + 0.1), 0, 0.0), color='wood_dk', base=True, bevel=0.03)
    parts = [root, deck]
    for name, sx in (('railing_l', 1), ('railing_r', -1)):
        r = Part(name, parent='bridge_wood', hard=True, seed=seed + sx)
        x = sx * (W / 2 + 0.25)
        npost = 13
        for i in range(npost):
            y = -L / 2 + i * L / (npost - 1)
            r.box((0.2, 0.2, 1.25), (x, y, 0.3), color='wood_dk', base=True, bevel=0.025)
            r.cyl(0.13, 0.1, (x, y, 1.55), segs=4, r2=0.02, rot=(0, 0, 45), color='wood_dk')
        r.box((0.14, L + 0.2, 0.18), (x, 0, 1.4), color='wood', base=True, bevel=0.03)
        r.box((0.1, L, 0.14), (x, 0, 0.75), color='wood_lt', base=True, bevel=0.02)
        if lod == 0:
            for i in range(npost - 1):
                y0 = -L / 2 + i * L / (npost - 1)
                y1 = y0 + L / (npost - 1)
                Lx = math.hypot(y1 - y0, 0.6)
                for a in (1, -1):
                    r.box((0.07, Lx - 0.2, 0.1), (x, (y0 + y1) / 2, 1.05), rot=(a * math.degrees(math.atan2(0.6, y1 - y0)), 0, 0), color='wood_lt')
        parts.append(r)
    s = Part('supports', parent='bridge_wood', hard=True, seed=seed + 5)
    for y in (-8.0, 0.0, 8.0):
        for x in (-8.0, -2.7, 2.7, 8.0):
            s.cyl(0.32, 4.4, (x, y, -5.2), color=grad_z('wood_dk', 'wood', -5.2, -0.8, 0.2, 1.0), segs=8)
        s.box((W - 0.6, 0.45, 0.45), (0, y, -1.3), color='wood_dk', base=True)
        if lod == 0:
            for x0, x1 in ((-8.0, -2.7), (-2.7, 2.7), (2.7, 8.0)):
                d = x1 - x0
                ang = math.degrees(math.atan2(2.4, d))
                Lb = math.hypot(d, 2.4)
                for a in (1, -1):
                    s.box((Lb, 0.18, 0.2), ((x0 + x1) / 2, y + 0.3, -2.6), rot=(0, a * ang, 0), color='wood')
        # stone footing (sinks below ground; trim at the terrain)
        for x in (-8.0, -2.7, 2.7, 8.0):
            s.cyl(0.6, 0.7, (x, y, -5.6), color='stone', segs=8)
    parts.append(s)
    return parts


def boost_pad(lod=0, seed=39):
    """Flat boost pad, 4 m wide (X) by 6 m long (Z, driving direction = +Z), 0.06 m thick.
    Material M_boost_pad_emit carries the glowing chevrons."""
    p = Part('boost_pad', hard=True, seed=seed)
    W, L = 4.0, 6.0
    p.box((W, L, 0.05), (0, 0, 0), color='#2e3a5c', base=True, bevel=0.025)
    for sx in (-1, 1):
        p.box((0.22, L, 0.07), (sx * (W / 2 - 0.11), 0, 0), color='yellow', base=True, bevel=0.02)
    for sy in (-1, 1):
        p.box((W, 0.22, 0.07), (0, sy * (L / 2 - 0.11), 0), color='yellow', base=True, bevel=0.02)
    # 3 chevrons pointing forward (-Y Blender = +Z glTF)
    for k in range(3):
        y = 1.6 - k * 1.6
        t, d = 0.45, 1.1
        chev = [(-1.45, y + d), (-1.45 + t * 1.2, y + d), (0, y + 0.0 + t * 0.2), (1.45 - t * 1.2, y + d), (1.45, y + d),
                (0, y - t * 0.9)]
        # prism builds in XZ; rotating -90 deg about X maps the 2D (x, c) to Blender (x, y = c)
        p.prism(chev, 0.03, (0, 0, 0.065), rot=(-90, 0, 0), color='white', mat='emit:#ffb21e')
    return [p]


def ramp(lod=0, seed=41):
    """Launch ramp 10 m wide, 6 m long, lip 1.6 m high. Karts drive along +Z (glTF), lip at z = +3.
    Surface curves up: about 8 deg at the foot, 21 deg at the lip (15 deg average)."""
    rng = random.Random(seed)
    p = Part('ramp', hard=True, seed=seed)
    W, L, H = 10.0, 6.0, 1.6

    def h(t):   # t = 0 at the foot (y = +L/2), 1 at the lip (y = -L/2)
        return H * (0.55 * t + 0.45 * t * t)
    n = 12
    prof = [(L / 2 - L * i / n, h(i / n)) for i in range(n + 1)]    # (y, z)
    # planks across the surface
    for i in range(n):
        (y0, z0), (y1, z1) = prof[i], prof[i + 1]
        c = ((y0 + y1) / 2, (z0 + z1) / 2)
        ln = math.hypot(y1 - y0, z1 - z0)
        ang = math.degrees(math.atan2(z1 - z0, y0 - y1))
        p.box((W, ln - 0.03, 0.1), (0, c[0], c[1] - 0.05), rot=(-ang, 0, 0), color=rng.choice(['wood', 'wood_lt', 'wood']), jitter=0.05)
    # side skirts following the curve
    for sx in (-1, 1):
        poly = [(y, z - 0.1) for y, z in prof] + [(-L / 2, 0.0), (L / 2, 0.0)]
        p.prism([(y, z) for y, z in poly], 0.16, (sx * (W / 2 + 0.08), 0, 0), rot=(0, 0, 90), color='wood_dk')
    # back wall under the lip
    p.box((W + 0.32, 0.16, H - 0.1), (0, -L / 2 + 0.08, 0), color='wood_dk', base=True)
    # hazard stripe at the lip
    k = 14
    for i in range(k):
        x = -W / 2 + (i + 0.5) * W / k
        p.box((W / k, 0.3, 0.04), (x, -L / 2 + 0.17, H - 0.07), rot=(-math.degrees(math.atan(H * (0.55 + 0.9) / L)), 0, 0),
              color='yellow' if i % 2 else 'black')
    # side marker posts with flags (red/white bands)
    for sx in (-1, 1):
        for y in (-L / 2, L / 2):
            x = sx * (W / 2 + 0.5)
            hh = 2.6 if y < 0 else 1.6
            for j in range(4):
                p.box((0.18, 0.18, hh / 4), (x, y, j * hh / 4), color='red' if j % 2 == 0 else 'white', base=True)
            if y < 0:
                p.prism([(0, 0), (0.0, 0.6), (-sx * 0.9, 0.3)], 0.03, (x, y, hh - 0.6), color='orange')
        # chevron boards along the side pointing forward
        for j in range(2):
            y = 1.2 - j * 2.4
            p.box((0.06, 1.0, 0.45), (sx * (W / 2 + 0.2), y, h((L / 2 - y) / L) + 0.0), color='white', base=True)
    return [p]


BUILDERS = {'start_gate': start_gate, 'grandstand': grandstand, 'balloon_arch': balloon_arch,
            'bridge_wood': bridge_wood, 'boost_pad': boost_pad, 'ramp': ramp}
LODS = {'grandstand'}
AO = {'start_gate': dict(distance=1.0), 'grandstand': dict(distance=1.0, samples=32), 'balloon_arch': dict(distance=0.6, strength=0.45),
      'bridge_wood': dict(distance=1.0, samples=32), 'boost_pad': dict(distance=0.2, strength=0.3), 'ramp': dict(distance=0.8)}
