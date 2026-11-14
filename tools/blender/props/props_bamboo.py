"""Bambus-Tempel props (track 2): bamboo, temple, torii, pagoda, lanterns, rope-bridge anchors,
mossy rocks, maple, fern, gong, hazard lantern and log bundle.

Blender coordinates: Z up, model front = -Y (exported as +Z). Origin on the ground at the centre.
Build: blender -b -P tools/blender/props/build.py -- bamboo_clump bamboo_torii ...
"""
import math, random
from mathutils import Vector, noise
from kit import Part, lin, mix, grad_z, M

# palette (sRGB hex) for this kit
C = {
    'cane_dk': '#5f7d2a', 'cane': '#86a63a', 'cane_lt': '#b5c95a', 'cane_old': '#b9a95a', 'node': '#d9d38c',
    'bleaf_dk': '#3d6b2a', 'bleaf': '#5f9a3a', 'bleaf_lt': '#94c457',
    'lacquer': '#c8382a', 'lacquer_dk': '#9a2a20', 'black': '#2a2624', 'gold': '#e2b04a',
    'plaster': '#efe6d2', 'plaster_dk': '#d8ccb4', 'tile': '#4b5257', 'tile_dk': '#383d42',
    'stone': '#9a968c', 'stone_dk': '#77736b', 'stone_lt': '#bdb8ac', 'moss': '#5f8a35', 'moss_dk': '#3f6a2a',
    'wood': '#8a5f3c', 'wood_dk': '#5e3f28', 'wood_lt': '#b08458', 'rope': '#c9b07a', 'paper': '#f4e6c8',
    'maple': '#d8452a', 'maple_lt': '#f08a3a', 'maple_dk': '#a8321f', 'bark': '#5a4134', 'fern': '#4f8a33', 'fern_lt': '#8fbf4f',
}


def c(k):
    return C.get(k, k)


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------

def _cane(p, base, h, r, lean=(0.0, 0.0), segs=5, node_step=0.9, nodes=True, seed=0.0, col=None):
    """One bamboo cane from `base` (Vector) up `h` metres, slightly bent, with node bulges."""
    pts, radii = [], []
    n = max(2, int(h / node_step))
    lx, ly = lean
    for i in range(n + 1):
        t = i / n
        z = h * t
        bend = t * t
        q = Vector((base.x + lx * h * bend + noise.noise(Vector((seed, t * 2, 0))) * 0.08 * t,
                    base.y + ly * h * bend + noise.noise(Vector((t * 2, seed, 1))) * 0.08 * t, base.z + z))
        rr = r * (1.0 - 0.45 * t)
        if nodes and 0 < i < n:
            pts.append(q)
            radii.append(rr * 1.18)
            pts.append(q + Vector((0, 0, 0.07)))
            radii.append(rr)
        else:
            pts.append(q)
            radii.append(rr)
    top = pts[-1].z

    def colf(co, nn, z0=base.z, z1=top):
        tt = (co.z - z0) / max(0.1, z1 - z0)
        k = mix(c('cane_dk'), c('cane'), min(1.0, tt * 1.4))
        k = mix(k, c('cane_lt'), max(0.0, tt - 0.55) * 1.6)
        return mix(k, c('cane_old'), max(0.0, noise.noise(co * 0.7 + Vector((seed, 0, 0)))) * 0.5)
    p.sweep(pts, radii, col or colf, segs=segs, cap0=False, cap1=True, mat='foliage')
    return pts


def _spray(p, center, n, size, rng, droop=0.55, colors=('bleaf_dk', 'bleaf', 'bleaf_lt'), width=0.22):
    """A spray of long narrow bamboo leaves (folded 2-tri cards) hanging from `center`."""
    p._begin()
    for k in range(n):
        a = rng.uniform(0, 2 * math.pi)
        d = Vector((math.cos(a), math.sin(a), 0))
        dirv = (d + Vector((0, 0, -droop + rng.uniform(-0.25, 0.35)))).normalized()
        L = size * rng.uniform(0.75, 1.2)
        W = L * width
        base = Vector(center) + d * rng.uniform(0.0, size * 0.6) + Vector((0, 0, rng.uniform(-0.2, 0.2)))
        tip = base + dirv * L
        side = dirv.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = Vector((1, 0, 0))
        side.normalize()
        mid = base + dirv * L * 0.45
        up = side.cross(dirv).normalized()
        s1 = mid + side * W * 0.5 - up * W * 0.15
        s2 = mid - side * W * 0.5 - up * W * 0.15
        v = [p.bm.verts.new(x) for x in (tip, s1, base, s2)]
        p.bm.faces.new([v[0], v[1], v[2]])
        p.bm.faces.new([v[0], v[2], v[3]])
    cols = [lin(c(x)) for x in colors]
    faces = p._new_faces()
    p.npid += 1
    if 'foliage' not in p.mats:
        p.mats.append('foliage')
    mi = p.mats.index('foliage')
    for i in range(0, len(faces), 2):
        cc = cols[rng.randrange(len(cols))]
        kv = 1.0 + rng.uniform(-0.15, 0.15)
        for f in faces[i:i + 2]:
            f.material_index = mi
            f.smooth = True
            f[p.pid] = p.npid
            for l in f.loops:
                l[p.col] = (cc[0] * kv, cc[1] * kv, cc[2] * kv, 1.0)
    p.fields.append((faces, Vector(center) + Vector((0, 0, 0.6)), 0.7))
    p.soft_ao.extend(faces)
    return faces


def _roof(p, w, d, z, rise, overhang=0.9, col='tile', curve=0.35, thick=0.22, segs=6):
    """Hip roof with upturned corners: four sloped skirts built from a curved profile, plus a ridge."""
    hw, hd = w / 2 + overhang, d / 2 + overhang
    # profile from eave (t=0) to ridge (t=1): concave curve
    for sx, sy, axis in ((1, 0, 'x'), (-1, 0, 'x'), (0, 1, 'y'), (0, -1, 'y')):
        pts = []
        for i in range(segs + 1):
            t = i / segs
            h = rise * (t ** 1.6)
            inset = t
            pts.append((inset, h))
        # build a strip of quads between the eave edge and the ridge line
        rows = []
        for t, h in pts:
            if axis == 'x':
                x = sx * hw * (1 - t * 0.92)
                ya = hd * (1 - t * 0.55)
                lift = curve * (1 - t) ** 2
                rows.append([Vector((x, -ya, z + h + lift)), Vector((x, ya, z + h + lift))])
            else:
                y = sy * hd * (1 - t * 0.92)
                xa = hw * (1 - t * 0.55)
                lift = curve * (1 - t) ** 2
                rows.append([Vector((-xa, y, z + h + lift)), Vector((xa, y, z + h + lift))])
        p._begin()
        vs = [[p.bm.verts.new(a), p.bm.verts.new(b)] for a, b in rows]
        for i in range(len(vs) - 1):
            a, b = vs[i], vs[i + 1]
            try:
                p.bm.faces.new([a[0], a[1], b[1], b[0]])
            except ValueError:
                pass
        p._fix_normals()
        faces = p._new_faces()
        for f in faces:
            if f.normal.z < 0:
                f.normal_flip()
        p._end(grad_z(c('tile_dk'), c(col), z, z + rise, 0.1, 2.0), 'base', True)
    # thickness: eave fascia
    p.box((2 * hw, 2 * hd, thick), (0, 0, z - thick + curve * 0.6), color=c('wood_dk'), base=True)
    p.box((w * 0.5, 0.35, 0.35), (0, 0, z + rise - 0.05), color=c('tile_dk'), base=True)


# ---------------------------------------------------------------------------
# vegetation
# ---------------------------------------------------------------------------

def bamboo_clump(lod=0, seed=41):
    p = Part('bamboo_clump', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    n = 6 if lod == 0 else 4
    for k in range(n):
        a = k * 2.4 + rng.uniform(-0.3, 0.3)
        rr = rng.uniform(0.1, 0.55)
        base = Vector((math.cos(a) * rr, math.sin(a) * rr, -0.15))
        h = rng.uniform(7.0, 11.5)
        lean = (math.cos(a) * rng.uniform(0.03, 0.09), math.sin(a) * rng.uniform(0.03, 0.09))
        pts = _cane(p, base, h, rng.uniform(0.08, 0.12), lean, segs=4 if lod == 0 else 3, node_step=1.35 if lod == 0 else 3.5,
                    nodes=lod == 0, seed=k * 3.1)
        # leaf sprays along the upper half
        sprays = 3 if lod == 0 else 1
        for s in range(sprays):
            q = pts[min(len(pts) - 1, int(len(pts) * (0.45 + 0.55 * s / max(1, sprays))))]
            _spray(p, q, 9 if lod == 0 else 8, 1.05, rng, droop=0.4)
    return [p]


def bamboo_arch(lod=0, seed=47):
    """Clump whose canes arch forward (-Y in Blender = +Z exported) over the road, leaves at the tips:
    placed on both sides of the road facing it, they close into a green tunnel. Reach about 5 m."""
    p = Part('bamboo_arch', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    n = 8 if lod == 0 else 5
    for k in range(n):
        base = Vector((rng.uniform(-1.6, 1.6), rng.uniform(0.0, 1.2), -0.15))
        h = rng.uniform(8.0, 12.5)
        reach = rng.uniform(0.25, 0.5)
        pts = _cane(p, base, h, rng.uniform(0.07, 0.11), (rng.uniform(-0.08, 0.08), -reach), segs=4 if lod == 0 else 3,
                    node_step=1.5 if lod == 0 else 4.0, nodes=lod == 0, seed=k * 2.3)
        for s in range(3 if lod == 0 else 2):
            q = pts[min(len(pts) - 1, int(len(pts) * (0.5 + 0.5 * (s + 1) / 3)))]
            _spray(p, q, 8, 1.05, rng, droop=0.7)
    return [p]


def bamboo_stalks(lod=0, seed=53):
    p = Part('bamboo_stalks', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    for k in range(3 if lod == 0 else 2):
        a = k * 2.1 + rng.uniform(-0.4, 0.4)
        base = Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, -0.15))
        h = rng.uniform(5.0, 8.5)
        pts = _cane(p, base, h, rng.uniform(0.05, 0.075), (math.cos(a) * 0.05, math.sin(a) * 0.05), segs=4, node_step=1.6,
                    nodes=lod == 0, seed=k * 5.7)
        _spray(p, pts[-2], 8, 0.9, rng)
        _spray(p, pts[len(pts) // 2 + 1], 6, 0.8, rng)
    return [p]


def bamboo_fern(lod=0, seed=61):
    p = Part('bamboo_fern', hard=False, seed=seed)
    rng = random.Random(seed)
    p._begin()
    for k in range(7):
        a = k * 2 * math.pi / 7 + rng.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        L = rng.uniform(0.55, 0.8)
        side = Vector((-d.y, d.x, 0))
        base = Vector((0, 0, 0.02))
        mid = base + d * L * 0.5 + Vector((0, 0, 0.35))
        tip = base + d * L + Vector((0, 0, 0.12))
        v = [p.bm.verts.new(x) for x in (base, mid + side * 0.13, tip, mid - side * 0.13)]
        p.bm.faces.new([v[0], v[1], v[2]])
        p.bm.faces.new([v[0], v[2], v[3]])
    p._end(lambda co, n: mix(c('fern'), c('fern_lt'), min(1.0, co.z * 2.5)), 'foliage', True)
    p.fields.append((list(p.bm.faces), Vector((0, 0, -2.0)), 0.6))
    return [p]


def _rock(name, seed, size, moss=1.0):
    import bpy, kit
    p = Part(name, hard=False, seed=seed)
    faces = p.sphere(1.0, (0, 0, 0), c('stone'), scale=size, ico=3, mat='base')
    vs = set(v for f in faces for v in f.verts)
    off = Vector((seed * 1.3, seed * 0.7, seed * 2.1))
    for v in vs:
        d = noise.noise(v.co * 0.9 + off) * 0.24 + noise.noise(v.co * 2.3 + off) * 0.07
        v.co += v.co.normalized() * d
        if v.co.z < -size[2] * 0.25:
            v.co.z = -size[2] * 0.25 + (v.co.z + size[2] * 0.25) * 0.25
    zmin = min(v.co.z for v in vs)
    for v in vs:
        v.co.z -= zmin + 0.15
    me = bpy.data.meshes.new('tmp_' + name)
    p.bm.to_mesh(me)
    me = kit.decimate(me, 140)
    p.bm.clear()
    p.col = p.bm.loops.layers.float_color.get('Col') or p.bm.loops.layers.float_color.new('Col')
    p.pid = p.bm.faces.layers.int.get('pid') or p.bm.faces.layers.int.new('pid')
    p.mats = []
    h = size[2] * 1.2

    def rc(co, n):
        m = (max(0.0, co.normalized().z - 0.2) * 2.2 + noise.noise(co * 1.9 + off) * 0.35) * moss
        k = mix(c('stone_dk'), c('stone_lt'), co.z / h + noise.noise(co * 2.1 + off) * 0.3)
        return mix(k, mix(c('moss_dk'), c('moss'), noise.noise(co * 3.0) * 0.5 + 0.5), min(0.9, max(0.0, m)))
    p.mesh(me, color=rc, mat='base', smooth=True)
    bpy.data.meshes.remove(me)
    p.hard = True
    return [p]


def bamboo_rock_a(lod=0):
    return _rock('bamboo_rock_a', 71, (1.6, 1.3, 1.1))


def bamboo_rock_b(lod=0):
    return _rock('bamboo_rock_b', 83, (0.8, 0.65, 0.55), moss=1.2)


def bamboo_maple(lod=0, seed=91):
    p = Part('bamboo_maple', hard=False, seed=seed)
    p.force_mat = 'foliage'
    rng = random.Random(seed)
    bark = grad_z(c('bark'), '#7a5a44', 0, 3.0, 0.2, 1.4)
    trunk = [Vector((0, 0, -0.1)), Vector((0.1, 0.05, 1.0)), Vector((0.35, -0.1, 2.0)), Vector((0.2, 0.0, 2.8))]
    p.sweep(trunk, [0.24, 0.18, 0.14, 0.1], bark, segs=7 if lod == 0 else 5, cap0=False)
    for k in range(4 if lod == 0 else 2):
        a = k * 1.6 + 0.3
        p.sweep([trunk[2], trunk[2] + Vector((math.cos(a) * 1.3, math.sin(a) * 1.3, 0.9))], [0.09, 0.04], bark, segs=5)
    balls = []
    for k in range(9):
        a = k * 2.39996
        rr = 1.4 if k else 0.0
        balls.append(((math.cos(a) * rr, math.sin(a) * rr * 0.9, 3.4 + rng.uniform(-0.4, 0.6) - 0.15 * rr), rng.uniform(1.1, 1.4)))
    col = lambda co, n: mix(mix(c('maple_dk'), c('maple'), (co.z - 2.2) / 2.6), c('maple_lt'), max(0.0, noise.noise(co * 0.9)) * 0.9)
    can = p.blob(balls, col, res=0.28, tris=520 if lod == 0 else 180, noise_amp=0.15, noise_scale=1.3, field=0.55,
                 squash=(2.6, 0.45), threshold=0.55)
    p.leaves(can, 180 if lod == 0 else 50, 0.38, [c('maple'), c('maple_lt'), c('maple_dk'), '#f2b24a'], center=(0, 0, 3.4),
             field=0.85, tilt=0.4, vary=0.15, width=0.9)
    return [p]


# ---------------------------------------------------------------------------
# temple architecture
# ---------------------------------------------------------------------------

TORII_HALF = 11.2   # pillar centre x


def bamboo_torii(lod=0, seed=101):
    """Red torii spanning a 15 m road plus its walls: pillars at x = +-11.2, clear height 7.3 m."""
    p = Part('bamboo_torii', hard=True, seed=seed)
    X = TORII_HALF
    for sx in (-1, 1):
        x = sx * X
        p.cyl(0.85, 0.5, (x, 0, -0.2), segs=8, r2=0.75, color=c('stone_dk'))
        p.cyl(0.62, 0.35, (x, 0, 0.25), segs=12, color=c('black'))
        p.cyl(0.5, 8.4, (x, 0, 0.55), segs=14, r2=0.44, color=c('lacquer'))
    # nuki (lower tie beam) and kasagi (curved top beam, black cap)
    p.box((2 * X + 2.4, 0.55, 0.65), (0, 0, 6.6), color=c('lacquer'), base=True, bevel=0.04)
    for sx in (-1, 1):   # wedges
        p.box((0.3, 0.7, 0.5), (sx * (X + 0.75), 0, 6.65), color=c('lacquer_dk'), base=True)
    n = 12
    pts = []
    W = X + 2.6
    for i in range(n + 1):
        t = i / n * 2 - 1
        pts.append(Vector((t * W, 0, 8.4 + 0.55 * t ** 4)))
    prof = [(-1, -0.7), (1, -0.7), (1, 0.45), (-1, 0.45)]
    p.sweep(pts, 0.55, c('lacquer'), segs=4, profile=[(-0.8, -0.6), (0.8, -0.6), (0.8, 0.6), (-0.8, 0.6)], up=(0, 0, 1))
    pts2 = [q + Vector((0, 0, 0.6)) for q in pts]
    p.sweep(pts2, 0.6, c('black'), segs=4, profile=[(-0.8, -0.35), (0.8, -0.35), (0.8, 0.45), (-0.8, 0.45)], up=(0, 0, 1))
    # gakuzuka plaque
    p.box((0.5, 0.45, 1.1), (0, 0, 7.25), color=c('lacquer'), base=True)
    p.box((1.2, 0.6, 1.6), (0, -0.05, 6.95), color=c('black'), base=True, bevel=0.05)
    p.box((0.95, 0.65, 1.3), (0, -0.06, 7.1), color=c('gold'), base=True)
    if lod == 0:
        # shimenawa rope with paper streamers under the nuki
        rope = [Vector((t / 8 * 2 * (X - 0.6) - (X - 0.6), -0.35, 6.45 - 0.5 * math.sin(math.pi * t / 8))) for t in range(9)]
        p.sweep(rope, 0.12, c('rope'), segs=6)
        for i in (2, 4, 6):
            q = rope[i]
            p.prism([(-0.15, 0), (0.15, 0), (0.15, -0.35), (-0.05, -0.45), (0.1, -0.7), (-0.15, -0.7)], 0.03, (q.x, -0.42, q.z - 0.05), color=c('paper'))
    return [p]


def _lantern_stone(p, x, y, s=1.0, emit=True):
    z = 0
    p.box((0.9 * s, 0.9 * s, 0.25 * s), (x, y, z), color=c('stone_dk'), base=True, bevel=0.04)
    p.cyl(0.18 * s, 1.0 * s, (x, y, 0.25 * s), segs=8, color=c('stone'))
    p.box((0.75 * s, 0.75 * s, 0.18 * s), (x, y, 1.25 * s), color=c('stone'), base=True, bevel=0.03)
    p.box((0.5 * s, 0.5 * s, 0.5 * s), (x, y, 1.43 * s), color=c('stone_lt'), base=True)
    if emit:
        for sx, sy in ((0, -1), (0, 1), (1, 0), (-1, 0)):
            p.box((0.26 * s if sx == 0 else 0.04, 0.04 if sx == 0 else 0.26 * s, 0.26 * s),
                  (x + sx * 0.25 * s, y + sy * 0.25 * s, 1.55 * s), color='#ffcf7a', base=True, mat='emit:#ffb04a')
    p.cyl(0.62 * s, 0.32 * s, (x, y, 1.93 * s), segs=6, r2=0.08 * s, color=c('stone'))
    p.sphere(0.1 * s, (x, y, 2.3 * s), color=c('stone_lt'), segs=6, rings=4)


def bamboo_lantern_stone(lod=0, seed=111):
    p = Part('bamboo_lantern_stone', hard=True, seed=seed)
    _lantern_stone(p, 0, 0, 1.0)
    # moss on the cap
    p.cyl(0.5, 0.06, (0, 0, 1.94), segs=6, r2=0.3, color=c('moss'))
    return [p]


def bamboo_lantern_paper(lod=0, seed=121):
    """Wooden post with a hanging red paper lantern (emissive). Height 3.0 m."""
    p = Part('bamboo_lantern_paper', hard=True, seed=seed)
    p.box((0.18, 0.18, 3.0), (0, 0, -0.2), color=c('wood_dk'), base=True)
    p.box((0.12, 1.0, 0.12), (0, -0.4, 2.65), color=c('wood_dk'), base=True)
    p.cyl(0.015, 0.25, (0, -0.8, 2.4), segs=4, color=c('black'))
    prof = [(0.05, 1.45), (0.22, 1.5), (0.3, 1.62), (0.34, 1.8), (0.3, 1.98), (0.22, 2.1), (0.05, 2.15)]
    p.lathe([(r, z + 0.3) for r, z in prof], (0, -0.8, 0), color=c('lacquer'), segs=10, mat='emit:#ff6a3a')
    p.cyl(0.14, 0.05, (0, -0.8, 1.72), segs=8, color=c('black'))
    p.cyl(0.14, 0.05, (0, -0.8, 2.42), segs=8, color=c('black'))
    return [p]


def bamboo_lantern_hang(lod=0, seed=131):
    """Big paper lantern for the lap-3 hazard. Origin = top hook; hangs down 1.6 m along -Z."""
    p = Part('bamboo_lantern_hang', hard=True, seed=seed)
    p.cyl(0.03, 0.3, (0, 0, -0.3), segs=5, color=c('black'))
    p.cyl(0.3, 0.12, (0, 0, -0.42), segs=10, color=c('black'))
    prof = [(0.3, -0.3), (0.55, -0.38), (0.72, -0.6), (0.78, -0.85), (0.72, -1.1), (0.55, -1.32), (0.3, -1.4)]
    p.lathe([(r, z) for r, z in reversed(prof)], (0, 0, 0), color=c('lacquer'), segs=14, mat='emit:#ff6a3a')
    if lod == 0:
        for z in (-0.5, -0.85, -1.2):
            rr = 0.78 - abs(z + 0.85) * 0.5
            p.lathe([(rr + 0.01, z - 0.015), (rr + 0.02, z), (rr + 0.01, z + 0.015)], color=c('black'), segs=14, cap0=False, cap1=False)
    p.cyl(0.3, 0.1, (0, 0, -1.5), segs=10, color=c('black'))
    p.cyl(0.05, 0.4, (0, 0, -1.9), segs=5, color=c('gold'))
    return [p]


def _wall_run(p, x0, y0, x1, y1, h=3.0, t=0.45, cap=True):
    L = math.hypot(x1 - x0, y1 - y0)
    a = math.degrees(math.atan2(y1 - y0, x1 - x0))
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    p.box((L, t + 0.15, 0.5), (mx, my, -0.3), rot=(0, 0, a), color=c('stone_dk'), base=True)
    p.box((L, t, h - 0.2), (mx, my, 0.2), rot=(0, 0, a), color=c('plaster'), base=True, jitter=0.02)
    if cap:
        p.box((L + 0.3, t + 0.7, 0.18), (mx, my, h), rot=(0, 0, a), color=c('tile_dk'), base=True)
        p.prism([(-(t / 2 + 0.45), 0), (t / 2 + 0.45, 0), (0, 0.45)], L + 0.3, (mx, my, h + 0.18), rot=(0, 0, a + 90), color=c('tile'))


def _gatehouse(p, y, open_w, open_h, depth, outer_w, lod, big=True):
    """Gate building centred at y spanning outer_w; opening open_w x open_h."""
    hw = outer_w / 2
    pw = (outer_w - open_w) / 2
    for sx in (-1, 1):
        x = sx * (open_w / 2 + pw / 2)
        p.box((pw, depth, open_h + 0.9), (x, y, 0.0), color=c('plaster'), base=True)
        p.box((pw + 0.2, depth + 0.2, 0.5), (x, y, -0.3), color=c('stone_dk'), base=True)
        # red posts at the opening and the corners
        for px in (sx * (open_w / 2 + 0.25), sx * (hw - 0.25)):
            for py in (y - depth / 2 + 0.2, y + depth / 2 - 0.2):
                p.cyl(0.24, open_h + 1.0, (px, py, 0.0), segs=8, color=c('lacquer'))
    # lintel beams
    p.box((outer_w, depth, 0.6), (0, y, open_h), color=c('lacquer'), base=True)
    p.box((outer_w + 0.3, depth + 0.3, 0.35), (0, y, open_h + 0.6), color=c('wood_dk'), base=True)
    # upper storey (big gate)
    z = open_h + 0.95
    if big:
        p.box((outer_w - 1.2, depth - 0.8, 2.0), (0, y, z), color=c('plaster'), base=True)
        if lod == 0:
            for i in range(-3, 4):
                p.box((0.2, depth - 0.7, 2.0), (i * (outer_w - 1.6) / 6, y, z), color=c('lacquer'), base=True)
        _roof_at(p, outer_w - 1.2, depth - 0.8, y, z + 2.0, 2.2, lod)
        _roof_at(p, outer_w, depth, y, z - 0.1, 0.9, lod, overhang=0.9, ridge=False)
    else:
        _roof_at(p, outer_w, depth, y, z, 1.8, lod)


def _roof_at(p, w, d, y, z, rise, lod, overhang=1.0, ridge=True):
    import bmesh
    # simple hip roof: a scaled pyramid frustum with curved eaves, offset in y
    sub = Part('tmp')
    _roof(sub, w, d, 0, rise, overhang=overhang, curve=0.4 if lod == 0 else 0.25, segs=5 if lod == 0 else 2)
    me_faces = list(sub.bm.faces)
    # copy into p with an offset
    p._begin()
    vmap = {}
    for v in sub.bm.verts:
        vmap[v] = p.bm.verts.new(v.co + Vector((0, y, z)))
    cols = {}
    for f in sub.bm.faces:
        nf = p.bm.faces.new([vmap[v] for v in f.verts])
        cols[nf] = [tuple(l[sub.col]) for l in f.loops]
    p.npid += 1
    if 'base' not in p.mats:
        p.mats.append('base')
    mi = p.mats.index('base')
    for nf, cl in cols.items():
        nf.material_index = mi
        nf.smooth = False
        nf[p.pid] = p.npid
        for l, cc in zip(nf.loops, cl):
            l[p.col] = cc
    sub.bm.free()


def bamboo_temple(lod=0, seed=141):
    """Drive-through temple courtyard (lap 3). 30 m long (Y), clear lane 9.2 m wide (|x| < 4.6) and
    5.6 m high through both gates; side walls with inner faces at x = +-5.8.
    Front (-Y, the entry) gate has doors `door_l` (+X) / `door_r` (-X), hinges at x = +-4.6, y = -15.1;
    open outward with door_l.rotation.y = +angle. Lantern beam over the lane at y = -3 (hook at z = 7.4).
    Child `gong` (pivot on its top bar at x = -5.2, y = +7, z = 3.3) swings about its local Y (= world Y)."""
    p = Part('bamboo_temple', hard=True, seed=seed)
    OW, OH = 9.2, 5.6
    L = 30.0
    # side walls of the courtyard
    for sx in (-1, 1):
        _wall_run(p, sx * 6.05, -12.6, sx * 6.05, 12.6, h=3.4, t=0.5)
    # front gate (two storeys) and rear gate
    _gatehouse(p, -13.6, OW, OH, 3.0, 13.6, lod, big=True)
    _gatehouse(p, 13.8, OW, OH, 2.4, 13.0, lod, big=False)
    # lantern beam: two red posts and a black beam with a hook
    for sx in (-1, 1):
        p.cyl(0.22, 7.9, (sx * 5.4, -3.0, 0), segs=8, color=c('lacquer'))
        p.box((0.6, 0.6, 0.4), (sx * 5.4, -3.0, -0.2), color=c('stone_dk'), base=True)
    p.box((11.6, 0.45, 0.45), (0, -3.0, 7.6), color=c('black'), base=True)
    p.cyl(0.04, 0.3, (0, -3.0, 7.35), segs=5, color=c('gold'))
    # gong frame (left of the lane in driving direction = -X... driving goes +Y, left = +X? see doc)
    gx, gy = -5.2, 7.0
    for dy in (-1.0, 1.0):
        p.cyl(0.12, 3.5, (gx, gy + dy, 0), segs=6, color=c('wood_dk'))
    p.box((0.25, 2.4, 0.25), (gx, gy, 3.45), color=c('wood_dk'), base=True)
    # stone lanterns along the walls and a pagoda-roofed shrine at the far end, outside the lane
    for y in (-8.5, 1.5, 10.0):
        for sx in (-1, 1):
            if (sx, y) == (-1, 10.0) or (sx < 0 and abs(y - gy) < 2):
                continue
            _lantern_stone(p, sx * 5.25, y, 0.85, emit=lod == 0)
    # gravel kerbs
    for sx in (-1, 1):
        p.box((0.3, 24, 0.12), (sx * 4.75, 0, -0.05), color=c('stone_lt'), base=True)
    parts = [p]
    # gong (child)
    g = Part('gong', origin=(gx, gy, 3.3), parent='bamboo_temple', hard=True, seed=seed + 7)
    g.cyl(0.02, 0.4, (gx, gy, 2.9), segs=4, color=c('rope'))
    g.cyl(0.85, 0.12, (gx - 0.06, gy, 2.0), rot=(0, 90, 0), segs=20, color=c('gold'), r2=0.8)
    g.cyl(0.35, 0.16, (gx - 0.1, gy, 2.0), rot=(0, 90, 0), segs=14, color='#c89536')
    parts.append(g)
    # doors (front only)
    dw = OW / 2
    for name, sx in (('door_l', 1), ('door_r', -1)):
        hinge = Vector((sx * OW / 2, -15.1, 0.0))
        d = Part(name, origin=hinge, parent='bamboo_temple', hard=True, seed=seed + sx)
        cx = sx * (OW / 2 - dw / 2)
        d.box((dw - 0.06, 0.18, OH - 0.05), (cx, hinge.y, 0.0), color=c('lacquer'), base=True)
        d.box((dw - 0.4, 0.22, 0.2), (cx, hinge.y, OH - 0.6), color=c('black'), base=True)
        d.box((dw - 0.4, 0.22, 0.2), (cx, hinge.y, 0.5), color=c('black'), base=True)
        if lod == 0:
            for i in range(3):          # gold studs
                for j in range(4):
                    d.sphere(0.07, (cx - dw / 2 + 0.7 + i * (dw - 1.4) / 2, hinge.y - 0.12, 1.2 + j * 1.0), color=c('gold'), segs=6, rings=4)
        d.cyl(0.18, 0.06, (sx * 0.3, hinge.y - 0.12, 2.6), rot=(90, 0, 0), segs=10, color=c('gold'))
        parts.append(d)
    return parts


def bamboo_pagoda(lod=0, seed=151):
    """Five-storey pagoda, 7.2 m base, about 19 m tall with the finial."""
    p = Part('bamboo_pagoda', hard=True, seed=seed)
    p.box((8.6, 8.6, 0.9), (0, 0, -0.3), color=c('stone'), base=True, bevel=0.05)
    z = 0.6
    w = 6.2
    for k in range(5):
        h = 2.0 if k == 0 else 1.5
        p.box((w, w, h), (0, 0, z), color=c('plaster') if k % 2 == 0 else c('lacquer'), base=True)
        if lod == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    p.box((0.3, 0.3, h), (sx * (w / 2 - 0.15), sy * (w / 2 - 0.15), z), color=c('lacquer_dk'), base=True)
        z += h
        _roof_at(p, w, w, 0, z, 0.7, lod, overhang=1.2, ridge=False)
        z += 0.55
        w *= 0.84
    p.cyl(0.18, 4.0, (0, 0, z), segs=8, color=c('gold'))
    for i in range(5 if lod == 0 else 2):
        p.cyl(0.42 - i * 0.04, 0.12, (0, 0, z + 0.6 + i * 0.55), segs=10, color=c('gold'))
    return [p]


def bamboo_bridge(lod=0, seed=161):
    """Rope-bridge anchors for a 54 m deck. Origin = centre of the deck top. Posts at x = +-6.8,
    y = +-27.6, from 7 m below the deck to 3.4 m above; a small roofed lintel on each end."""
    p = Part('bamboo_bridge', hard=True, seed=seed)
    for sy in (-1, 1):
        y = sy * 27.6
        for sx in (-1, 1):
            x = sx * 6.8
            p.box((0.55, 0.55, 10.4), (x, y, -7.0), color=c('wood_dk'), base=True, bevel=0.03)
            p.box((0.8, 0.8, 0.3), (x, y, 3.4), color=c('black'), base=True)
            # rope anchors
            for z in (1.1, 0.25):
                p.cyl(0.12, 0.6, (x, y - sy * 0.3, z), rot=(90, 0, 0), segs=6, color=c('rope'))
            p.box((0.3, 1.6, 0.3), (x, y + sy * 0.9, -0.5), rot=(-sy * 35, 0, 0), color=c('wood_dk'))
        p.box((15.0, 0.6, 0.5), (0, y, 3.1), color=c('lacquer'), base=True, bevel=0.03)
        p.box((15.8, 1.6, 0.25), (0, y, 3.6), color=c('tile_dk'), base=True)
        if lod == 0:
            rope = [Vector((t / 8 * 12.8 - 6.4, y - sy * 0.35, 2.9 - 0.35 * math.sin(math.pi * t / 8))) for t in range(9)]
            p.sweep(rope, 0.08, c('rope'), segs=5)
            for i in (2, 4, 6):
                q = rope[i]
                p.prism([(-0.12, 0), (0.12, 0), (0.12, -0.3), (-0.04, -0.38), (0.08, -0.6), (-0.12, -0.6)], 0.03, (q.x, q.y, q.z - 0.05), color=c('paper'))
    return [p]


def bamboo_log(lod=0, seed=171):
    """Bundle of five bamboo canes, 3.6 m long along Y (exported: along Z), radius 0.42, axle at z = 0.42.
    Origin at the bundle centre (on the axle) so the hazard view can spin it."""
    p = Part('bamboo_log', hard=False, seed=seed)
    rng = random.Random(seed)
    offs = [(0, 0), (0.2, 0.14), (-0.2, 0.14), (0.2, -0.14), (-0.2, -0.14)]
    for k, (ox, oz) in enumerate(offs):
        r = 0.16 if k == 0 else 0.14
        L = 3.6 + rng.uniform(-0.2, 0.2)
        pts = [Vector((ox, -L / 2 + i * L / 6, oz)) for i in range(7)]
        p.sweep(pts, r, lambda co, n: mix(c('cane'), c('cane_old'), noise.noise(co * 1.5) * 0.5 + 0.5), segs=7)
        for i in (1, 3, 5):
            p.lathe([(r * 1.12, -0.04), (r * 1.12, 0.04)], (ox, pts[i].y, oz), rot=(90, 0, 0), color=c('node'), segs=7, cap0=False, cap1=False)
    for y in (-1.0, 1.0):
        p.lathe([(0.44, -0.07), (0.44, 0.07)], (0, y, 0), rot=(90, 0, 0), color=c('rope'), segs=10, cap0=False, cap1=False)
    return [p]


BUILDERS = {
    'bamboo_clump': bamboo_clump, 'bamboo_arch': bamboo_arch, 'bamboo_stalks': bamboo_stalks, 'bamboo_fern': bamboo_fern,
    'bamboo_rock_a': bamboo_rock_a, 'bamboo_rock_b': bamboo_rock_b, 'bamboo_maple': bamboo_maple,
    'bamboo_torii': bamboo_torii, 'bamboo_lantern_stone': bamboo_lantern_stone, 'bamboo_lantern_paper': bamboo_lantern_paper,
    'bamboo_lantern_hang': bamboo_lantern_hang, 'bamboo_temple': bamboo_temple, 'bamboo_pagoda': bamboo_pagoda,
    'bamboo_bridge': bamboo_bridge, 'bamboo_log': bamboo_log,
}
LODS = {'bamboo_clump', 'bamboo_arch', 'bamboo_stalks', 'bamboo_maple', 'bamboo_temple', 'bamboo_pagoda'}
AO = {
    'bamboo_clump': dict(distance=0.8, strength=0.45, samples=24), 'bamboo_arch': dict(distance=0.8, strength=0.45, samples=24), 'bamboo_stalks': dict(distance=0.6, strength=0.4, samples=24),
    'bamboo_fern': dict(distance=0.2, strength=0.35, samples=16), 'bamboo_maple': dict(distance=1.5, strength=0.5, samples=24),
    'bamboo_temple': dict(distance=2.0, strength=0.6, samples=24), 'bamboo_pagoda': dict(distance=1.5, strength=0.6, samples=24),
    'bamboo_torii': dict(distance=1.0, strength=0.5, samples=24), 'bamboo_bridge': dict(distance=1.0, strength=0.5, samples=24),
}
