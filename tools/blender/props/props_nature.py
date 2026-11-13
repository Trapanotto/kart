"""Nature props: trees, bushes, hedge, flowers, grass, rocks."""
import math, random
from mathutils import Vector, noise
from kit import Part, PAL, lin, mix, grad_z, M


def _trunk(p, base, top, r0, r1, segs=8, wobble=0.12, flare=1.5, color=None, seed=0.0, n=6):
    pts, radii = [], []
    base, top = Vector(base), Vector(top)
    for i in range(n + 1):
        t = i / n
        c = base.lerp(top, t)
        c += Vector((noise.noise(Vector((t * 3, seed, 0))), noise.noise(Vector((seed, t * 3, 1))), 0)) * wobble * t
        pts.append(c)
        r = r0 + (r1 - r0) * t
        if t < 0.2:
            r *= 1 + (flare - 1) * (1 - t / 0.2) ** 2
        radii.append(r)
    col = color or grad_z('bark_dk', 'bark_lt', base.z, top.z + 1.0, 0.25, 1.3)
    p.sweep(pts, radii, col, segs=segs, cap0=False, cap1=False)
    return pts


def _branch(p, a, b, r0, r1, color, segs=6, bend=0.3, n=4):
    a, b = Vector(a), Vector(b)
    mid_up = Vector((0, 0, (b - a).length * bend))
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append(a.lerp(b, t) + mid_up * math.sin(math.pi * t) * 0.5)
    p.sweep(pts, [r0 + (r1 - r0) * i / n for i in range(n + 1)], color, segs=segs, cap0=False, cap1=True)


def tree_oak(lod=0, apples=False, seed=7):
    p = Part('tree_apple' if apples else 'tree_oak', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    s = 0.78 if apples else 1.0           # apple tree: smaller, rounder
    trunk_top = Vector((0.1, 0.05, 2.7 * s))
    bark = grad_z('bark_dk', 'bark_lt', 0, 4.5 * s, 0.3, 1.5)
    _trunk(p, (0, 0, -0.1), trunk_top, 0.46 * s, 0.32 * s, segs=8 if lod == 0 else 6, flare=1.45, color=bark, seed=seed)
    if lod == 0:
        for k in range(5):   # root flares hugging the ground
            a = k * 2 * math.pi / 5 + 0.4
            d = Vector((math.cos(a), math.sin(a), 0))
            p.sweep([d * 0.25 * s + Vector((0, 0, 0.5 * s)), d * 0.6 * s + Vector((0, 0, 0.08)), d * 0.95 * s + Vector((0, 0, -0.06))],
                    [0.17 * s, 0.11 * s, 0.03], bark, segs=5, cap0=False, cap1=True)
    # branches into the canopy
    nb = 5 if lod == 0 else 3
    for k in range(nb):
        a = k * 2 * math.pi / nb + rng.uniform(-0.3, 0.3)
        tip = Vector((math.cos(a) * 2.1 * s, math.sin(a) * 2.1 * s, (4.4 + rng.uniform(-0.3, 0.5)) * s))
        _branch(p, trunk_top - Vector((0, 0, 0.25)), tip, 0.2 * s, 0.05, bark, segs=6 if lod == 0 else 4)
    # canopy: clumpy "cauliflower" cluster of metaballs on an ellipsoid shell plus a core
    C = Vector((0, 0, 5.3 * s))
    balls = [(C, 2.7 * s), (C + Vector((0, 0, 1.0 * s)), 2.3 * s)]
    n = 14
    for k in range(n):
        # fibonacci sphere, upper 80 %
        zz = 1 - (k + 0.5) / n * 1.55
        rr = math.sqrt(max(0.0, 1 - zz * zz))
        a = k * 2.39996 + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(a) * rr * 2.35, math.sin(a) * rr * 2.2, zz * 1.7)) * s
        balls.append((C + d, rng.uniform(1.6, 1.9) * s))
    cz0, cz1 = 2.9 * s, 8.4 * s
    ccol = grad_z('leaf_dk', 'leaf_lt', cz0, cz1, 0.3, 0.7)
    canopy = p.blob(balls, ccol, res=0.3 * s, tris=(1050 if apples else 1200) if lod == 0 else 380, noise_amp=0.18 * s,
                    noise_scale=1.1, field=0.5, squash=(3.8 * s, 0.5), threshold=0.55)
    if lod == 0:
        p.leaves(canopy, 170 if apples else 300, 0.6 * s, ccol, center=C, field=0.9, push=-0.02, tilt=0.28,
                 vary=0.18, width=0.7)
    else:
        p.leaves(canopy, 60, 0.6 * s, ccol, center=C, field=0.85, tilt=0.45, vary=0.2, width=0.75)
    if apples:
        # apples sit on the canopy surface, mostly on the sunny side and the lower half
        cand = [f for f in canopy if f.normal.z > -0.5]
        n_ap = 18 if lod == 0 else 10
        for k in range(n_ap):
            f = cand[rng.randrange(len(cand))]
            c = f.calc_center_median() + f.normal * 0.06
            p.sphere(0.14, c, 'apple' if rng.random() < 0.75 else 'apple_lt', segs=6, rings=4, mat='foliage')
    return [p]


def tree_birch(lod=0, seed=11):
    p = Part('tree_birch', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)

    def bark(co, n):  # white bark with dark horizontal marks
        v = noise.noise(Vector((co.x * 2, co.y * 2, co.z * 4.5)))
        if v > 0.38 or co.z < 0.35:
            return mix('birch_mark', 'bark_dk', 0.3)
        return mix('birch_bark', 'stone_lt', max(0, -v))
    top = Vector((0.15, -0.1, 9.5))
    pts = _trunk(p, (0, 0, -0.1), top, 0.2, 0.06, segs=7 if lod == 0 else 5, wobble=0.35, flare=1.4, color=bark, seed=seed, n=8)
    # a second slimmer stem for a natural silhouette
    if lod == 0:
        _trunk(p, (0.05, 0.05, 1.2), (1.3, 0.6, 7.2), 0.09, 0.04, segs=5, wobble=0.3, flare=1.0, color=bark, seed=seed + 3, n=5)
    balls = []
    for k in range(9):
        z = 4.0 + k * 0.62
        rad = 1.25 - abs(k - 3.5) * 0.12
        a = k * 2.4
        balls.append(((math.cos(a) * 0.7 + 0.1, math.sin(a) * 0.6, z), rad * 1.4))
    balls.append(((0.15, -0.1, 9.6), 1.0))
    balls.append(((1.2, 0.6, 6.8), 1.2))
    ccol = grad_z('birch_dk', 'birch_lt', 3.5, 10.5, 0.35, 0.8)
    canopy = p.blob(balls, ccol, res=0.26, tris=900 if lod == 0 else 300, noise_amp=0.22, noise_scale=1.3,
                    field=0.5, squash=(4.6, 0.6))
    center = Vector((0.2, 0, 6.8))
    p.leaves(canopy, 320 if lod == 0 else 60, 0.36 if lod == 0 else 0.55, ['birch', 'birch_lt', 'birch_lt', 'leaf_hi', 'birch_dk'],
             center=center, field=0.5, tilt=1.1)
    return [p]


def bush(lod=0, seed=5):
    p = Part('bush', hard=False, seed=seed)
    rng = random.Random(seed)
    balls = [((0, 0, 0.55), 1.05)]
    for k in range(5):
        a = k * 2 * math.pi / 5 + rng.uniform(-0.3, 0.3)
        balls.append(((math.cos(a) * 0.65, math.sin(a) * 0.55, 0.45 + rng.uniform(0, 0.35)), rng.uniform(0.7, 0.85)))
    can = p.blob(balls, grad_z('hedge_dk', 'leaf_lt', 0.0, 1.5, 0.3, 1.4), res=0.2, tris=230, noise_amp=0.14,
                 noise_scale=2.0, field=0.5, squash=(0.25, 0.3))
    p.leaves(can, 75, 0.3, ['leaf', 'leaf_lt', 'leaf_hi'], center=(0, 0, 0.6), field=0.5)
    return [p]


def hedge(lod=0, seed=6):
    """4 m hedge section along X, tiles end to end."""
    p = Part('hedge', hard=False, seed=seed)
    rng = random.Random(seed)
    balls = [((x, 0, 0.8), 0.55, (0.9, 0.22, 0.5), 'CUBE') for x in (-1.6, -0.5, 0.5, 1.6)]
    for k in range(12):   # gentle lumps on the clipped surface
        balls.append(((rng.uniform(-2.0, 2.0), rng.uniform(-0.3, 0.3), rng.uniform(1.0, 1.35)), rng.uniform(0.35, 0.5)))
    hc = grad_z('hedge_dk', 'hedge', 0.0, 1.7, 0.45, 1.6)
    can = p.blob(balls, hc, res=0.17, tris=190, noise_amp=0.13,
                 noise_scale=2.5, field=0.25, squash=(0.15, 0.2))
    # trim the ends flat so sections butt together
    for v in set(v for f in can for v in f.verts):
        v.co.x = max(-2.0, min(2.0, v.co.x))
    p.leaves(can, 110, 0.3, hc, center=(0, 0, 0.8), field=0.3, tilt=0.35, vary=0.25, width=0.75, push=0.0)
    return [p]


def grass_tuft(lod=0, seed=3):
    p = Part('grass_tuft', hard=False, seed=seed)
    rng = random.Random(seed)
    for k in range(16):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0, 0.12)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        out = Vector((math.cos(a), math.sin(a), 0)) * rng.uniform(0.08, 0.25)
        h = rng.uniform(0.28, 0.5)
        w = 0.05
        side = Vector((-math.sin(a), math.cos(a), 0)) * w
        mid = base + out * 0.4 + Vector((0, 0, h * 0.55))
        tip = base + out + Vector((0, 0, h))
        v0, v1 = base - side, base + side
        v2, v3 = mid - side * 0.7, mid + side * 0.7
        c0, c1 = 'grass_dk', rng.choice(['grass_lt', 'grass', 'leaf_hi'])
        f = lambda co, n, c0=c0, c1=c1, h=h: mix(c0, c1, co.z / h)
        p.quad([v0, v1, v3, v2], f, mat='foliage', smooth=True)
        p._begin()
        vs = [p.bm.verts.new(x) for x in (v2, v3, tip)]
        p.bm.faces.new(vs)
        p._end(f, 'foliage', True)
    _up_normals(p, 0.7)
    return [p]


def flower_patch(lod=0, seed=4):
    p = Part('flower_patch', hard=False, seed=seed)
    rng = random.Random(seed)
    # a few leaves at the base
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.0, 0.25)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0)) * 0.05
        tip = base + d * 0.18 + Vector((0, 0, rng.uniform(0.12, 0.22)))
        p._begin()
        vs = [p.bm.verts.new(x) for x in (base - side, base + side, tip)]
        p.bm.faces.new(vs)
        p._end(lambda co, n: mix('grass_dk', 'grass_lt', co.z / 0.3), 'foliage', True)
    cols = ['white', 'yellow', '#f27aa6', 'white', '#a77be0', 'yellow', 'red']
    for k in range(7):
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        r = rng.uniform(0.08, 0.3)
        c = Vector((math.cos(a) * r, math.sin(a) * r, rng.uniform(0.2, 0.32)))
        # stem: a thin triangle
        p._begin()
        vs = [p.bm.verts.new(x) for x in (Vector((c.x - 0.015, c.y, 0)), Vector((c.x + 0.015, c.y, 0)), c)]
        p.bm.faces.new(vs)
        p._end('grass_dk', 'foliage', True)
        # flower head: 5 petals as a star fan around a centre vertex
        R = rng.uniform(0.07, 0.1)
        pc = cols[k % len(cols)]
        p._begin()
        ctr = p.bm.verts.new(c + Vector((0, 0, 0.01)))
        ring = []
        for i in range(10):
            ang = i * math.pi / 5 + a
            rr = R if i % 2 == 0 else R * 0.45
            ring.append(p.bm.verts.new(c + Vector((math.cos(ang) * rr, math.sin(ang) * rr, 0.012 if i % 2 else -0.01))))
        for i in range(10):
            p.bm.faces.new([ctr, ring[i], ring[(i + 1) % 10]])
        p._end(lambda co, n, c=c, pc=pc: mix('yellow' if pc != 'yellow' else 'orange', pc, (co - c).length / 0.03), 'foliage', True)
    _up_normals(p, 0.6)
    return [p]


def _up_normals(p, amount):
    """Grass-like normals: bend towards +Z so instanced fields light evenly."""
    faces = list(p.bm.faces)
    p.fields.append((faces, Vector((0, 0, -6.0)), amount))


def rock(lod=0, seed=21, size=(1.6, 1.3, 1.0), name='rock_a'):
    p = Part(name, hard=False, seed=seed)
    rng = random.Random(seed)
    faces = p.sphere(1.0, (0, 0, 0), 'stone', scale=size, ico=3, mat='base')
    vs = set(v for f in faces for v in f.verts)
    off = Vector((seed * 1.3, seed * 0.7, seed * 2.1))
    for v in vs:
        d = noise.noise(v.co * 0.9 + off) * 0.22 + noise.noise(v.co * 2.3 + off) * 0.07
        v.co += v.co.normalized() * d
        # chunky planes: quantise slightly toward facets
        if v.co.z < -size[2] * 0.25:
            v.co.z = -size[2] * 0.25 + (v.co.z + size[2] * 0.25) * 0.25
    # sit on ground
    zmin = min(v.co.z for v in vs)
    for v in vs:
        v.co.z -= zmin + 0.12
    p.bm.normal_update()
    import bmesh
    # decimate to budget through a temporary mesh
    import bpy, kit
    me = bpy.data.meshes.new('tmp_rock')
    p.bm.to_mesh(me)
    me = kit.decimate(me, 260)
    p.bm.clear()
    p.col = p.bm.loops.layers.float_color.get('Col') or p.bm.loops.layers.float_color.new('Col')
    p.pid = p.bm.faces.layers.int.get('pid') or p.bm.faces.layers.int.new('pid')
    p.mats = []
    h = size[2] * 1.2

    def rc(co, n):
        moss = max(0.0, n.z - 0.6) * 2.2 + noise.noise(co * 1.7) * 0.3
        c = mix('#55514c', '#8e887d', co.z / h + noise.noise(co * 2.1 + off) * 0.35)
        c = mix(c, '#7a6c5c', max(0.0, noise.noise(co * 0.8 + off * 2)) * 0.8)   # warm patches
        return mix(c, 'grass_dk', min(0.8, max(0.0, moss)))
    p.mesh(me, color=rc, mat='base', smooth=True)
    bpy.data.meshes.remove(me)
    p.hard = True    # weighted normals give a chunky, sculpted look
    return [p]


def rock_a(lod=0):
    return rock(lod, 21, (1.5, 1.2, 1.05), 'rock_a')


def rock_b(lod=0):
    return rock(lod, 37, (0.75, 0.6, 0.5), 'rock_b')


BUILDERS = {
    'tree_oak': tree_oak,
    'tree_apple': lambda lod=0: tree_oak(lod, apples=True, seed=13),
    'tree_birch': tree_birch,
    'bush': bush, 'hedge': hedge, 'grass_tuft': grass_tuft, 'flower_patch': flower_patch,
    'rock_a': rock_a, 'rock_b': rock_b,
}
LODS = {'tree_oak', 'tree_apple', 'tree_birch'}
AO = {
    'tree_oak': dict(distance=2.0, strength=0.55), 'tree_apple': dict(distance=2.0, strength=0.55),
    'tree_birch': dict(distance=1.5, strength=0.5), 'bush': dict(distance=0.8, strength=0.5),
    'hedge': dict(distance=0.8, strength=0.5), 'grass_tuft': dict(distance=0.2, strength=0.4),
    'flower_patch': dict(distance=0.2, strength=0.4), 'rock_a': dict(distance=0.8), 'rock_b': dict(distance=0.5),
}
