"""Gletscher-Gipfel (track 4) props: snowy pines, snow-capped rocks, ice crystals, icicles, seracs,
tunnel wall pieces, summit station with cable car, huts, slalom flags, snow fence, snowman, fishing hut,
avalanche snow pile, crevasse snow bridge.

Authored like the rest of the kit (Blender: Z up, model front = -Y -> glTF +Z). Every name starts with
'glacier_'. Ice parts use the material key 'ice' (M_<prop>_ice); the game swaps it for a TSL ice
material (fresnel, inner glow), so the exported values are only the fallback look.
"""
import math, random
from mathutils import Vector, noise
import kit
from kit import Part, lin, mix, grad_z

# extra material presets for this kit (runtime only, kit.py stays untouched)
kit.MAT_PRESETS.setdefault('ice', dict(rough=0.12, emit=1.0, strength=0.35))
kit.MAT_PRESETS.setdefault('snow', dict(rough=0.92))
kit.MAT_PRESETS.setdefault('lamp', dict(rough=0.5, emit=1.0, strength=2.2))

SNOW = '#f4f8fc'
SNOW_SH = '#c9d8ea'      # snow in shadow / undersides: soft blue
ICE = '#9fdcf5'
ICE_DK = '#4fa8d8'
ICE_DEEP = '#2f7fc0'
PINE_DK = '#1f4a35'
PINE = '#2f6447'
PINE_LT = '#4d8159'
ROCK_DK = '#4d4f57'
ROCK = '#7a7c86'
WOOD_DK = '#5e3d29'
WOOD = '#8a5b3a'
WOOD_LT = '#b07c50'
RED = '#d8423a'
BLUE = '#2f6fd0'
WARM = '#ffc067'


def snow_on_top(base, k=0.45, amp=0.25, scale=1.3, under=None):
    """Colour function: snow where the surface faces up (with noisy edge), `base` elsewhere."""
    def f(co, n):
        t = n.z - k + noise.noise(co * scale) * amp
        if t > 0.08:
            return mix(SNOW, SNOW_SH, max(0.0, 0.25 - t) * 1.5)
        b = base(co, n) if callable(base) else lin(base)
        return b if under is None else mix(b, under, max(0.0, -n.z) * 0.5)
    return f


def recolor(p, fn):
    """Recompute face normals, then colour every loop with fn(co, normal)."""
    p.bm.normal_update()
    for f in p.bm.faces:
        for l in f.loops:
            c = fn(l.vert.co, f.normal)
            l[p.col] = (c[0], c[1], c[2], 1.0)


# ---------------------------------------------------------------------------
# nature
# ---------------------------------------------------------------------------

def pine(lod=0, seed=101):
    """Snow-laden spruce, about 9 m. Tiers of drooping skirts with snow on their upper faces."""
    p = Part('glacier_pine', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    segs = 9 if lod == 0 else 5
    p.cyl(0.26, 2.0, (0, 0, -0.15), color=WOOD_DK, segs=6 if lod == 0 else 4, r2=0.18, caps=False)
    tiers = 5 if lod == 0 else 3
    z = 1.2
    H = 8.6
    for i in range(tiers):
        t = i / max(1, tiers - 1)
        r = 3.0 * (1 - t * 0.78)
        h = (H - 1.2) / tiers * 1.55
        droop = 0.55 * (1 - t * 0.5)
        green = grad_z(PINE_DK, PINE_LT, z - droop, z + h, 0.35, 1.6)

        def col(co, n, z=z, h=h, r=r, droop=droop, green=green):
            # snow lies on the upper face of each tier (inside the rim), with a ragged edge
            rad = math.hypot(co.x, co.y)
            s = (r * 0.8 - rad) / r + noise.noise(co * 1.9 + Vector((seed, 0, 0))) * 0.22
            if s > 0.0 and co.z > z - droop * 0.4:
                return mix(SNOW, SNOW_SH, max(0.0, 0.25 - s) * 2.0)
            return green(co, n)
        prof = [(r, z - droop), (r * 0.82, z - droop * 0.2), (r * 0.45, z + h * 0.45), (0.0, z + h)]
        if lod == 0:
            prof = [(r * 0.25, z - droop * 0.6)] + prof   # underside so it is not hollow from below
        faces = p.lathe(prof, color=col, segs=segs, cap0=False, cap1=False, phase=rng.uniform(0, 1))
        if lod == 0:
            # wavy rim: alternate rim vertices up/down so the skirt reads as branches
            rim = sorted({v for f in faces for v in f.verts if abs(math.hypot(v.co.x, v.co.y) - r) < 1e-3}, key=lambda v: math.atan2(v.co.y, v.co.x))
            for k, v in enumerate(rim):
                v.co.z += 0.22 if k % 2 else -0.18
                v.co.x *= 1.0 + (0.08 if k % 2 == 0 else -0.04)
                v.co.y *= 1.0 + (0.08 if k % 2 == 0 else -0.04)
        z += h * 0.58
    # snow cap on the tip
    p.sphere(0.28 if lod == 0 else 0.3, (0, 0, z + 0.55), SNOW, segs=6, rings=4, mat='foliage')
    p.fields.append((list(p.bm.faces), Vector((0, 0, 3.0)), 0.35))
    return [p]


def rock(lod=0, seed=111, size=(1.8, 1.5, 1.2), name='glacier_rock'):
    p = Part(name, hard=False, seed=seed)
    faces = p.sphere(1.0, (0, 0, 0), ROCK, scale=size, ico=3)
    vs = set(v for f in faces for v in f.verts)
    off = Vector((seed * 1.3, seed * 0.7, seed * 2.1))
    for v in vs:
        d = noise.noise(v.co * 0.9 + off) * 0.24 + noise.noise(v.co * 2.6 + off) * 0.07
        v.co += v.co.normalized() * d
        if v.co.z < -size[2] * 0.2:
            v.co.z = -size[2] * 0.2 + (v.co.z + size[2] * 0.2) * 0.25
    zmin = min(v.co.z for v in vs)
    for v in vs:
        v.co.z -= zmin + 0.15
    import bpy
    me = bpy.data.meshes.new('tmp_rock')
    p.bm.to_mesh(me)
    me = kit.decimate(me, 300 if lod == 0 else 80)
    p.bm.clear()
    p.col = p.bm.loops.layers.float_color.get('Col') or p.bm.loops.layers.float_color.new('Col')
    p.pid = p.bm.faces.layers.int.get('pid') or p.bm.faces.layers.int.new('pid')
    p.mats = []
    h = size[2] * 1.3

    def rc(co, n):
        c = mix(ROCK_DK, ROCK, co.z / h + noise.noise(co * 2.1 + off) * 0.35)
        c = mix(c, '#8a7f74', max(0.0, noise.noise(co * 0.8 + off * 2)) * 0.6)
        return c
    p.mesh(me, color=rc, mat='base', smooth=True)
    bpy.data.meshes.remove(me)
    recolor(p, snow_on_top(rc, k=0.45, amp=0.3, scale=1.4))
    p.hard = True
    return [p]


def crystal(lod=0, seed=121):
    """Cluster of ice crystals, about 2.4 m high."""
    p = Part('glacier_crystal', hard=True, seed=seed)
    rng = random.Random(seed)
    n = 7 if lod == 0 else 4
    for k in range(n):
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        tilt = 0 if k == 0 else rng.uniform(18, 42)
        L = 2.4 if k == 0 else rng.uniform(0.9, 1.8)
        r = 0.32 if k == 0 else rng.uniform(0.14, 0.26)
        base = (math.cos(a) * 0.25 * (k > 0), math.sin(a) * 0.25 * (k > 0), -0.2)
        col = grad_z(ICE_DEEP, ICE, -0.2, 2.2, 0.15, 2.0)
        p.cyl(r, L * 0.78, base, rot=(tilt * math.cos(a), tilt * math.sin(a), 0), segs=6, color=col, mat='ice:#7fcff2', smooth=False, caps=False)
        # pointed tip
        tipm = kit.M(base, (tilt * math.cos(a), tilt * math.sin(a), 0))
        p.cyl(r, L * 0.22, (0, 0, L * 0.78), segs=6, r2=0.0, color=ICE, mat='ice:#7fcff2', smooth=False, matrix=tipm, caps=False)
    # snow drift at the foot
    p.sphere(0.9, (0, 0, -0.35), SNOW, scale=(1.2, 1.0, 0.45), segs=8, rings=4, mat='base')
    return [p]


def icicles(lod=0, seed=131):
    """Cluster hanging from a ceiling: origin at the TOP (attach point), icicles hang down to -1.8 m."""
    p = Part('glacier_icicles', hard=True, seed=seed)
    rng = random.Random(seed)
    for k in range(9 if lod == 0 else 5):
        x, y = rng.uniform(-1.4, 1.4), rng.uniform(-0.6, 0.6)
        L = rng.uniform(0.6, 1.8)
        r = rng.uniform(0.07, 0.16)
        p.cyl(r, L, (x, y, 0.15), rot=(180, 0, 0), r2=0.0, segs=5, color=grad_z(ICE, ICE_DK, -L, 0, 0.1), mat='ice:#7fcff2', caps=False)
    p.box((3.2, 1.4, 0.3), (0, 0, 0.0), color=ICE_DK, mat='ice:#7fcff2', bevel=0.08)
    return [p]


def icicle(lod=0, seed=133):
    """The falling icicle (lap-2 hazard): origin at its top, hangs down 2.3 m."""
    p = Part('glacier_icicle', hard=True, seed=seed)
    p.cyl(0.34, 2.3, (0, 0, 0.0), rot=(180, 0, 0), r2=0.0, segs=7, color=grad_z(ICE_DK, ICE, -2.3, 0, 0.1, 2.0), mat='ice:#7fcff2', caps=True)
    for k in range(3):
        a = k * 2.1
        p.cyl(0.14, 1.1, (math.cos(a) * 0.3, math.sin(a) * 0.3, -0.1), rot=(180 + 8 * math.cos(a), 8 * math.sin(a), 0), r2=0.0, segs=5, color=ICE, mat='ice:#7fcff2', caps=False)
    return [p]


def serac(lod=0, seed=141):
    """Leaning glacier ice tower, about 5 x 9 x 4 m, snow on its top."""
    p = Part('glacier_serac', hard=True, seed=seed)
    faces = p.box((5.0, 4.0, 9.0), (0, 0, -0.5), base=True, color=ICE, mat='ice:#7fcff2', bevel=0.4, seg=1)
    import bmesh
    bmesh.ops.subdivide_edges(p.bm, edges=list({e for f in faces for e in f.edges}), cuts=3, use_grid_fill=True)
    vs = {v for f in p.bm.faces for v in f.verts}
    off = Vector((seed, seed * 0.3, 0))
    for v in vs:
        t = max(0.0, v.co.z) / 9.0
        v.co.x *= 1.0 - 0.38 * t
        v.co.y *= 1.0 - 0.3 * t
        v.co.x += v.co.z * 0.12 + noise.noise(v.co * 0.45 + off) * 1.25
        v.co.y += noise.noise(v.co * 0.45 + off * 2) * 1.0
        v.co.z += noise.noise(v.co * 0.6 + off * 3) * 1.4 * (v.co.z > 5)
    p.bm.normal_update()
    col = snow_on_top(grad_z(ICE_DEEP, ICE, -0.5, 9.0, 0.2, 0.5), k=0.6, amp=0.2, scale=0.5)
    for f in p.bm.faces:
        for l in f.loops:
            c = col(l.vert.co, f.normal)
            l[p.col] = (c[0], c[1], c[2], 1.0)
    return [p]


# ---------------------------------------------------------------------------
# tunnel pieces and lap-event props
# ---------------------------------------------------------------------------

def seal(lod=0, seed=151):
    """Tunnel wall slab closing the lap-2 crack: 10.4 m along Z (driving direction), 1.2 m thick, 5.5 m high.
    Origin on the road surface at the slab centre; the slab reaches 1.5 m below for uneven ground."""
    p = Part('glacier_seal', hard=True, seed=seed)
    faces = p.box((1.2, 10.6, 7.0), (0, 0, -1.5), base=True, color=ICE, mat='ice:#7fcff2', bevel=0.12)
    import bmesh
    bmesh.ops.subdivide_edges(p.bm, edges=list({e for f in faces for e in f.edges}), cuts=3, use_grid_fill=True)
    off = Vector((seed, 0, 0))
    for v in {v for f in p.bm.faces for v in f.verts}:
        if v.co.z > 0.5:
            v.co.x += noise.noise(v.co * 0.6 + off) * 0.25
        if v.co.z > 5.0:
            v.co.z += noise.noise(v.co * 0.8 + off) * 0.6
    p.bm.normal_update()
    # cracks: dark lines baked into the colour
    for f in p.bm.faces:
        for l in f.loops:
            co = l.vert.co
            crack = abs(noise.noise(co * 0.7 + off)) < 0.06
            c = mix(ICE_DEEP, ICE, 0.35 + co.z / 9 + noise.noise(co * 1.3) * 0.2)
            if crack:
                c = lin('#e8fbff')
            l[p.col] = (c[0], c[1], c[2], 1.0)
    return [p]


def iceblock(lod=0, seed=153):
    """Chunky ice block, 1.6 x 5 x 9.5 m (long along Z), origin on the ground, base 1.4 m deep."""
    p = Part('glacier_iceblock', hard=True, seed=seed)
    faces = p.box((1.8, 9.6, 6.4), (0, 0, -1.4), base=True, color=ICE_DK, mat='ice:#7fcff2', bevel=0.3)
    off = Vector((seed, 0, 0))
    for v in {v for f in faces for v in f.verts}:
        v.co += Vector((noise.noise(v.co * 0.4 + off) * 0.3, 0, noise.noise(v.co * 0.5) * 0.4 * (v.co.z > 3)))
    p.bm.normal_update()
    col = snow_on_top(grad_z(ICE_DEEP, ICE, -1.4, 5.0), k=0.6)
    for f in p.bm.faces:
        for l in f.loops:
            c = col(l.vert.co, f.normal)
            l[p.col] = (c[0], c[1], c[2], 1.0)
    return [p]


def snowpile(lod=0, seed=161):
    """Avalanche deposit across the road: about 28 m wide (X), 13 m deep (Z), 5 m high, with chunks."""
    p = Part('glacier_snowpile', hard=False, seed=seed)
    rng = random.Random(seed)
    balls = [((0, 0, 0.4), 6.5, (2.4, 1.0, 0.55))]
    for k in range(16):
        balls.append(((rng.uniform(-12, 12), rng.uniform(-4.5, 4.5), rng.uniform(0.2, 2.2)), rng.uniform(2.2, 3.6)))
    col = lambda co, n: mix(SNOW_SH, SNOW, 0.35 + n.z * 0.6 + noise.noise(co * 0.4) * 0.2)
    p.blob(balls, col, res=0.7, tris=1600 if lod == 0 else 500, noise_amp=0.35, noise_scale=0.6, mat='base', squash=(0.0, 0.2))
    vs = {v for f in p.bm.faces for v in f.verts}
    zmin = min(v.co.z for v in vs)
    for v in vs:
        v.co.z -= 0.4 + zmin * 0.0
    # tumbling snow chunks and a couple of uprooted pine tops
    for k in range(14):
        c = (rng.uniform(-13, 13), rng.uniform(-6.5, 6.5), rng.uniform(0.6, 3.5))
        p.sphere(rng.uniform(0.4, 0.9), c, SNOW, scale=(1.2, 1.0, 0.8), ico=1, mat='base', smooth=False)
    for k in range(3):
        a = rng.uniform(0, math.pi)
        c = Vector((rng.uniform(-9, 9), rng.uniform(-3, 3), 2.4))
        p.cyl(0.18, 2.6, c, rot=(70 * math.cos(a), 70 * math.sin(a), 0), color=WOOD_DK, segs=5)
        p.cyl(1.0, 2.0, c + Vector((math.sin(a) * 1.6, -math.cos(a) * 1.6, 0.5)), rot=(70 * math.cos(a), 70 * math.sin(a), 0), r2=0.0, segs=6, color=PINE)
    return [p]


def snowbridge(lod=0, seed=171):
    """Snow bridge over the crevasse (deck model): origin = centre of the deck top, 23 m along the
    road (Blender -Y = driving direction), 23 m wide. Child 'deck' is a thin slab (hidden in game)."""
    p = Part('glacier_snowbridge', hard=False, seed=seed)
    rng = random.Random(seed)
    W, L = 11.5, 11.5
    # arched body under the road: sagging underside with blue ice core
    rows = []
    n = 12
    import bmesh
    for i in range(n + 1):
        y = -L + 2 * L * i / n
        sag = 3.8 * (1 - (y / L) ** 2) + 0.8
        ring = []
        for x, z in [(-W - 0.6, 0.35), (-W, -0.6), (-W * 0.6, -sag * 0.9), (0, -sag), (W * 0.6, -sag * 0.9), (W, -0.6), (W + 0.6, 0.35)]:
            ring.append(p.bm.verts.new((x + noise.noise(Vector((x, y, 0)) * 0.3) * 0.3, y, z)))
        rows.append(ring)
    for a, b in zip(rows[:-1], rows[1:]):
        for k in range(len(a) - 1):
            p.bm.faces.new([a[k], a[k + 1], b[k + 1], b[k]])
    p._fix_normals()
    p._end(lambda co, nn: mix(ICE_DK, SNOW_SH, max(0.0, nn.z) + 0.2) if co.z < -0.8 else lin(SNOW), 'base', True)
    # snow lips along both edges
    for sx in (-1, 1):
        pts = [(sx * (W + 0.3), -L + 2 * L * k / 8, 0.2) for k in range(9)]
        p.sweep(pts, 0.55, SNOW, segs=6, cap0=True, cap1=True)
        # marker poles every few metres (the invisible rail colliders)
        for k in range(5):
            y = -L + 1.5 + k * (2 * L - 3) / 4
            p.cyl(0.07, 1.6, (sx * (W + 0.3), y, 0.3), color=RED if k % 2 == 0 else '#f4f4f4', segs=5)
    # icicles under the arch
    for k in range(24 if lod == 0 else 10):
        x, y = rng.uniform(-W * 0.8, W * 0.8), rng.uniform(-L * 0.7, L * 0.7)
        sag = 3.8 * (1 - (y / L) ** 2) + 0.8
        z = -sag * (1 - (abs(x) / W) ** 2 * 0.1) + 0.3
        Lc = rng.uniform(0.7, 2.0)
        p.cyl(rng.uniform(0.1, 0.22), Lc, (x, y, z), rot=(180, 0, 0), r2=0.0, segs=5, color=ICE, mat='ice:#7fcff2', caps=False)
    d = Part('deck', parent='glacier_snowbridge', hard=True, seed=seed)
    d.box((2 * W, 2 * L, 0.2), (0, 0, -0.2), base=True, color=SNOW)
    return [p, d]


# ---------------------------------------------------------------------------
# buildings and furniture
# ---------------------------------------------------------------------------

def _snow_roof(p, w, l, z, rise, over=0.6, thick=0.35):
    """Gable roof along Y with a thick snow layer and a drip edge."""
    half = w / 2 + over
    ang = math.degrees(math.atan2(rise, half))
    slope = math.hypot(half, rise)
    for sx in (-1, 1):
        cx = sx * half / 2
        p.box((slope, l + 2 * over, 0.2), (cx, 0, z + rise / 2), rot=(0, sx * ang, 0), color=WOOD_DK)
        p.box((slope + 0.1, l + 2 * over + 0.1, thick), (cx - sx * 0.02, 0, z + rise / 2 + 0.25), rot=(0, sx * ang, 0), color=SNOW, bevel=0.12, seg=2)


def hut(lod=0, seed=181):
    """Wooden alpine hut, 7 x 6 m, snowy roof, warm lit windows (emissive), chimney. Front = door."""
    p = Part('glacier_hut', hard=True, seed=seed)
    W, D, H = 7.0, 6.0, 3.2
    p.box((W + 0.4, D + 0.4, 0.8), (0, 0, -0.3), base=True, color='#7d7a75', bevel=0.05)
    p.box((W, D, H), (0, 0, 0.5), base=True, color=grad_z(WOOD_DK, WOOD_LT, 0.5, 4.0, 0.3, 3.0), bevel=0.04)
    if lod == 0:
        for k in range(9):   # log ends at the corners
            z = 0.7 + k * 0.33
            for sx in (-1, 1):
                for sy in (-1, 1):
                    p.cyl(0.16, 0.5, (sx * (W / 2 + 0.05), sy * (D / 2 + 0.05), z), rot=(0, 90, 0), segs=6, color=WOOD_LT)
    # gable triangles
    for sy in (-1, 1):
        p.prism([(-W / 2, 0), (W / 2, 0), (0, 2.2)], 0.3, (0, sy * (D / 2 - 0.15), 0.5 + H), color=WOOD)
    _snow_roof(p, W, D, 0.5 + H, 2.2)
    # warm windows (emissive) with frames and shutters
    for x in (-2.0, 2.0):
        p.box((1.1, 0.12, 1.0), (x, -D / 2 - 0.02, 2.2), color=WARM, mat='lamp:#ffb04a')
        p.box((1.35, 0.16, 0.12), (x, -D / 2 - 0.05, 2.75), color=WOOD_DK)
        p.box((1.35, 0.2, 0.14), (x, -D / 2 - 0.06, 1.65), color=WOOD_DK)
        p.box((1.35, 0.25, 0.25), (x, -D / 2 - 0.15, 1.62), color=SNOW, bevel=0.08)   # snow on the sill
        for s in (-1, 1):
            p.box((0.5, 0.08, 1.1), (x + s * 0.85, -D / 2 - 0.06, 2.2), color=RED)
    for y in (-1.2, 1.2):
        p.box((0.12, 0.9, 0.9), (W / 2 + 0.02, y, 2.2), color=WARM, mat='lamp:#ffb04a')
    # door + porch
    p.box((1.2, 0.15, 2.1), (0, -D / 2 - 0.05, 0.5), base=True, color='#4a2e1f')
    p.box((2.6, 1.4, 0.15), (0, -D / 2 - 0.7, 0.45), base=True, color=WOOD)
    # chimney
    p.box((0.7, 0.7, 2.4), (1.6, 0.8, 0.5 + H + 0.8), base=True, color='#8d8780', bevel=0.04)
    p.box((0.85, 0.85, 0.25), (1.6, 0.8, 0.5 + H + 3.2), base=True, color=SNOW, bevel=0.1)
    if lod == 0:
        # firewood stack and a pair of skis
        for k in range(10):
            p.cyl(0.13, 1.4, (-W / 2 - 0.4, -1.5 + (k % 5) * 0.27, 0.6 + (k // 5) * 0.25), rot=(90, 0, 0), segs=6, color=WOOD_LT)
        for s in (-0.15, 0.15):
            p.box((0.08, 0.05, 1.8), (W / 2 + 0.15, -2.4 + s, 0.4), base=True, rot=(0, 12, 0), color=RED)
    return [p]


def fishhut(lod=0, seed=191):
    """Ice-fishing shack, 2.6 x 2.4 m, with a hole, a stool and a rod. Origin on the ice."""
    p = Part('glacier_fishhut', hard=True, seed=seed)
    p.box((2.4, 2.2, 2.2), (0, 0, 0), base=True, color=grad_z('#9c3a2c', '#c4513c', 0, 2.2), bevel=0.04)
    for z in (0.5, 1.0, 1.5, 2.0):
        p.box((2.46, 2.26, 0.05), (0, 0, z), base=True, color='#8a3026')
    p.box((0.8, 0.1, 1.7), (-0.4, -1.12, 0), base=True, color='#5a2a20')
    p.box((0.5, 0.08, 0.4), (0.6, -1.11, 1.3), color=WARM, mat='lamp:#ffb04a')
    _snow_roof(p, 2.4, 2.2, 2.2, 0.7, over=0.3, thick=0.25)
    p.cyl(0.45, 0.03, (1.8, -0.6, 0), color='#1d3a55', segs=10)          # fishing hole
    p.cyl(0.5, 0.06, (1.8, -0.6, 0), color=SNOW_SH, segs=10, r2=0.45, caps=False)
    p.cyl(0.22, 0.45, (1.3, -1.4, 0), color=WOOD, segs=8)                 # stool
    p.cyl(0.02, 1.8, (1.4, -1.0, 0.3), rot=(0, 38, 20), color='#333333', segs=4)  # rod
    return [p]


def snowman(lod=0, seed=201):
    p = Part('glacier_snowman', hard=False, seed=seed)
    p.sphere(0.75, (0, 0, 0.6), SNOW, segs=12, rings=8)
    p.sphere(0.55, (0, 0, 1.6), SNOW, segs=12, rings=8)
    p.sphere(0.4, (0, 0, 2.35), SNOW, segs=10, rings=7)
    p.cyl(0.07, 0.45, (0, -0.35, 2.35), rot=(90, 0, 0), r2=0.0, segs=6, color='#f08a24')   # carrot
    for sx in (-1, 1):
        p.sphere(0.05, (sx * 0.14, -0.34, 2.5), '#222222', segs=5, rings=3)
        p.cyl(0.035, 1.0, (sx * 0.5, 0, 1.75), rot=(0, sx * 60, 0), color=WOOD_DK, segs=4)   # stick arms
    for z in (1.45, 1.75):
        p.sphere(0.06, (0, -0.53, z), '#222222', segs=5, rings=3)
    p.cyl(0.42, 0.14, (0, 0, 1.98), color=RED, segs=12)                       # scarf
    p.box((0.18, 0.06, 0.5), (0.25, -0.38, 1.6), color=RED, rot=(0, 0, 15))
    p.cyl(0.32, 0.05, (0, 0, 2.66), color='#2b2a2e', segs=12)                # hat brim
    p.cyl(0.22, 0.4, (0, 0, 2.7), color='#2b2a2e', segs=12)
    return [p]


def flag(color, name):
    def build(lod=0, seed=211):
        """Slalom gate pole, 2.1 m, with a triangular flag towards +X."""
        p = Part(name, hard=True, seed=seed)
        p.cyl(0.04, 2.1, (0, 0, -0.2), color='#f4f4f4', segs=6)
        for z in (0.3, 0.9):
            p.cyl(0.042, 0.25, (0, 0, z), color=color, segs=6)
        p.prism([(0, 0), (0.95, 0.3), (0, 0.6)], 0.02, (0.03, 0, 1.25), color=color)
        p.sphere(0.25, (0, 0, -0.05), SNOW, scale=(1, 1, 0.4), segs=6, rings=3)
        return [p]
    return build


def snowfence(lod=0, seed=221):
    """Wooden snow fence section, 4 m along X (tiles every 4 m), 1.3 m. Child 'end_post' at x = +2.
    Kept cheap (about 150 triangles): it is tiled along kilometres of boundary."""
    p = Part('glacier_snowfence', hard=True, seed=seed)
    rng = random.Random(seed)
    p.box((0.14, 0.14, 1.6), (-2, 0, -0.3), base=True, color=WOOD_DK)
    for k in range(8):
        x = -1.75 + k * 0.5
        h = 1.15 + rng.uniform(-0.06, 0.06)
        p.box((0.2, 0.03, h), (x, -0.08, 0.0), base=True, color=mix('#b0482e', '#c86a3a', rng.random()))
    for z in (0.3, 0.95):
        p.box((4.0, 0.03, 0.06), (0, -0.05, z), color='#59595e')
    p.sphere(0.6, (0, 0.25, -0.25), SNOW, scale=(3.4, 0.9, 0.55), segs=6, rings=3)   # drift behind it
    e = Part('end_post', parent='glacier_snowfence', origin=(2, 0, 0), hard=True, seed=seed)
    e.box((0.14, 0.14, 1.6), (2, 0, -0.3), base=True, color=WOOD_DK)
    return [p, e]


# ---------------------------------------------------------------------------
# summit station and cable car
# ---------------------------------------------------------------------------

def station(lod=0, seed=231):
    """Summit station of the cable car: stone base, timber upper floor with a big window front,
    open cable hall towards +Y (back, the cable leaves along +Y at 7.2 m height), snowy roof, flags.
    Footprint 14 x 11 m, about 12 m high. Front (-Y) faces the road."""
    p = Part('glacier_station', hard=True, seed=seed)
    W, D = 14.0, 11.0
    stone = grad_z('#6f6f78', '#9a9aa2', 0, 4, 0.25, 1.4)
    p.box((W, D, 4.0), (0, 0, -0.6), base=True, color=stone, bevel=0.08)
    p.box((W - 0.6, D - 0.6, 3.8), (0, 0, 3.4), base=True, color=grad_z('#7a4a2c', '#a8693f', 3.4, 7.2, 0.3, 2.0), bevel=0.05)
    # window band (cool glass) on the front and sides
    p.box((W - 2.0, 0.15, 2.0), (0, -D / 2 + 0.25, 4.3), base=True, color='#8cc6e8', mat='glass')
    for k in range(7):
        p.box((0.18, 0.25, 2.2), (-W / 2 + 1.0 + k * (W - 2) / 6, -D / 2 + 0.2, 4.2), base=True, color='#4b3020')
    # roof
    _snow_roof(p, W - 0.6, D - 0.6, 7.2, 2.6, over=0.8, thick=0.45)
    # cable hall at the back: open portal with the bullwheel
    p.box((5.0, 3.0, 0.4), (0, D / 2 + 1.4, 6.6), base=True, color='#6c6f78')
    for sx in (-1, 1):
        p.box((0.4, 3.0, 7.0), (sx * 2.3, D / 2 + 1.4, -0.4), base=True, color='#6c6f78')
    p.cyl(1.8, 0.3, (0, D / 2 + 1.4, 7.0), color='#d8423a', segs=20 if lod == 0 else 10)
    p.cyl(0.3, 0.8, (0, D / 2 + 1.4, 6.9), color='#3b3b40', segs=8)
    # sign board
    p.box((6.0, 0.25, 1.2), (0, -D / 2 - 0.1, 7.6), base=True, color='#f4f4f4', bevel=0.05)
    p.box((5.6, 0.3, 0.8), (0, -D / 2 - 0.12, 7.8), base=True, color=RED)
    # door, steps
    p.box((2.0, 0.2, 2.6), (3.5, -D / 2 - 0.05, -0.2), base=True, color='#4a2e1f')
    p.box((3.0, 1.2, 0.5), (3.5, -D / 2 - 0.6, -0.6), base=True, color='#8d8d95')
    # flag poles with pennants
    cols = [RED, '#f4f4f4', BLUE, '#f6c945']
    for k, x in enumerate((-6.5, -4.8, 4.8, 6.5) if lod == 0 else (-6.5, 6.5)):
        p.cyl(0.07, 7.0, (x, -D / 2 - 2.2, -0.6), color='#d5d8de', segs=6)
        p.box((1.6, 0.04, 1.0), (x + 0.82, -D / 2 - 2.2, 5.3), color=cols[k % 4])
    # lamps (warm) by the door
    p.box((0.3, 0.3, 0.4), (2.2, -D / 2 - 0.2, 2.2), color=WARM, mat='lamp:#ffb04a')
    p.box((0.3, 0.3, 0.4), (4.8, -D / 2 - 0.2, 2.2), color=WARM, mat='lamp:#ffb04a')
    return [p]


def pylon(lod=0, seed=241):
    """Cable car pylon, 18 m, lattice-look steel tower with a cross arm (cables at x = +-2.4, z = 17.6)."""
    p = Part('glacier_pylon', hard=True, seed=seed)
    H = 17.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.sweep([(sx * 1.6, sy * 1.6, -0.5), (sx * 0.5, sy * 0.5, H)], 0.12, '#c9ccd3', segs=5)
    if lod == 0:
        for k in range(7):
            z0, z1 = k * H / 7, (k + 1) * H / 7
            r0, r1 = 1.6 - 1.1 * z0 / H, 1.6 - 1.1 * z1 / H
            for a in range(4):
                c, s = [(1, 0), (0, 1), (-1, 0), (0, -1)][a]
                q0 = Vector((r0 * (c - s), r0 * (s + c), z0))
                q1 = Vector((r1 * (c + s), r1 * (s - c), z1))
                p.sweep([q0, q1], 0.05, '#aeb2ba', segs=4)
    p.box((5.6, 0.6, 0.5), (0, 0, H), base=True, color=RED)
    for sx in (-1, 1):
        p.cyl(0.35, 0.25, (sx * 2.4, 0, H + 0.4), rot=(90, 0, 0), color='#3b3b40', segs=10)
    p.box((2.4, 2.4, 0.6), (0, 0, -0.6), base=True, color='#8d8d95')
    return [p]


def gondola(lod=0, seed=251):
    """Cable car cabin. Origin = the grip on the cable; the cabin hangs 3.2 m below. Front = +Y travel."""
    p = Part('glacier_gondola', hard=True, seed=seed)
    p.box((0.5, 0.8, 0.4), (0, 0, -0.2), color='#3b3b40')
    p.cyl(0.07, 1.9, (0, 0, -2.2), color='#3b3b40', segs=6)
    p.box((1.8, 0.12, 0.12), (0, 0, -2.25), color='#3b3b40')
    body = p.box((1.9, 2.3, 1.9), (0, 0, -4.4), base=True, color=RED, bevel=0.25, seg=2)
    p.box((1.95, 2.0, 0.75), (0, 0, -3.3), base=True, color='#a8d6f0', mat='glass', bevel=0.05)
    p.box((2.0, 2.4, 0.12), (0, 0, -3.38), base=True, color='#f4f4f4')
    p.box((1.6, 2.0, 0.15), (0, 0, -2.55), base=True, color=SNOW, bevel=0.06)
    return [p]


BUILDERS = {
    'glacier_pine': pine,
    'glacier_rock': rock,
    'glacier_rock_b': lambda lod=0: rock(lod, 117, (1.0, 0.8, 0.6), 'glacier_rock_b'),
    'glacier_crystal': crystal,
    'glacier_icicles': icicles,
    'glacier_icicle': icicle,
    'glacier_serac': serac,
    'glacier_seal': seal,
    'glacier_iceblock': iceblock,
    'glacier_snowpile': snowpile,
    'glacier_snowbridge': snowbridge,
    'glacier_hut': hut,
    'glacier_fishhut': fishhut,
    'glacier_snowman': snowman,
    'glacier_flag_r': flag(RED, 'glacier_flag_r'),
    'glacier_flag_b': flag(BLUE, 'glacier_flag_b'),
    'glacier_snowfence': snowfence,
    'glacier_station': station,
    'glacier_pylon': pylon,
    'glacier_gondola': gondola,
}
LODS = {'glacier_pine', 'glacier_station', 'glacier_hut', 'glacier_pylon', 'glacier_rock', 'glacier_rock_b'}
AO = {
    'glacier_pine': dict(distance=1.6, strength=0.5), 'glacier_rock': dict(distance=0.8), 'glacier_rock_b': dict(distance=0.5),
    'glacier_crystal': dict(distance=0.5, strength=0.4), 'glacier_icicles': dict(distance=0.4, strength=0.3, ground=False),
    'glacier_icicle': dict(distance=0.3, strength=0.2, ground=False), 'glacier_serac': dict(distance=2.0, strength=0.45),
    'glacier_seal': dict(distance=1.0, strength=0.35), 'glacier_iceblock': dict(distance=1.0, strength=0.35),
    'glacier_snowpile': dict(distance=2.5, strength=0.5), 'glacier_snowbridge': dict(distance=2.0, strength=0.5, ground=False),
    'glacier_hut': dict(distance=1.2), 'glacier_fishhut': dict(distance=0.8), 'glacier_snowman': dict(distance=0.5),
    'glacier_flag_r': dict(distance=0.3), 'glacier_flag_b': dict(distance=0.3), 'glacier_snowfence': dict(distance=0.5),
    'glacier_station': dict(distance=2.0), 'glacier_pylon': dict(distance=1.0), 'glacier_gondola': dict(distance=0.6, ground=False),
}
