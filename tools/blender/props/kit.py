"""Shared prop toolkit for Trapanotto Kart 2 scenery (Blender 5.2, headless).

Everything is authored in Blender coordinates (Z up, model front = -Y). The glTF exporter
converts to Y up with front = +Z, which is what the game expects.

A prop is a list of `Part`s. Each Part becomes one mesh node (root or child). Primitives are
added straight into the Part's BMesh, each with a colour (or a colour function), a material key
and a smooth flag. `realize()` turns Parts into objects with materials, normals and UVs;
`bake_ao()` multiplies baked ambient occlusion into the vertex colours; `export_glb()` writes
a Draco-compressed GLB.
"""
import bpy, bmesh, math, os, random, json
from mathutils import Vector, Matrix, Euler, noise, Color

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..', '..'))
MODELS = os.path.join(ROOT, 'public', 'assets', 'models')
ENV = os.path.join(ROOT, 'public', 'assets', 'env')

# ---------------------------------------------------------------------------
# Palette (sRGB hex). One palette for the whole Kleeblatt-Tal kit.
# ---------------------------------------------------------------------------
PAL = {
    # foliage
    'leaf_dk': '#2f6b2c', 'leaf': '#4b9a37', 'leaf_lt': '#7cc04a', 'leaf_hi': '#b5d95c',
    'birch_dk': '#4f8f2f', 'birch': '#79b843', 'birch_lt': '#a9d65a',
    'grass_dk': '#3f7f2e', 'grass': '#62a83f', 'grass_lt': '#9acb52',
    'hedge_dk': '#2c5f2a', 'hedge': '#3f8132',
    # wood and bark
    'bark_dk': '#4a3326', 'bark': '#6e4c35', 'bark_lt': '#8c6646',
    'birch_bark': '#efe9dc', 'birch_mark': '#3b3530',
    'wood_dk': '#7a5236', 'wood': '#a8774d', 'wood_lt': '#c99a66', 'wood_grey': '#a59580',
    # buildings
    'barn_red': '#b23a2e', 'barn_red_dk': '#8e2c24', 'trim': '#f4eee0', 'roof_slate': '#56606e',
    'roof_slate_dk': '#454d59', 'roof_tile': '#c0603e', 'roof_tile_dk': '#9c4a31',
    'wall_cream': '#f2e3c4', 'timber': '#6b4630', 'stone': '#a39d93', 'stone_lt': '#c6c0b4',
    'stone_dk': '#7f7a72', 'window': '#4d6f8f', 'window_lt': '#8fb7d6',
    'metal': '#a7aeb6', 'metal_dk': '#6f767f', 'metal_lt': '#d3d8dd',
    # farm
    'hay': '#e6bd5c', 'hay_dk': '#c6943f', 'hay_lt': '#f3d987',
    'wool': '#f7f3ea', 'wool_sh': '#ddd5c6', 'sheep_face': '#3b302b', 'pink': '#f2a7a0',
    'apple': '#d8382f', 'apple_lt': '#f0614a',
    # accents
    'red': '#e2453b', 'orange': '#f28c28', 'yellow': '#f6c945', 'blue': '#4a90d9',
    'sky': '#7fc3ea', 'white': '#f7f5ef', 'black': '#2b2a2e', 'purple': '#9b6fd0',
    'pink_lt': '#f6a6c1', 'teal': '#3cc4b0', 'tractor': '#3e9a49', 'tractor_dk': '#2c7337',
    'tire': '#2f2d2c', 'dirt': '#8a6a4a',
}


def hex2lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def lin(c):
    """Colour spec (palette key, hex or linear tuple) -> linear RGB tuple."""
    if isinstance(c, str):
        return hex2lin(PAL.get(c, c))
    return tuple(c[:3])


def mix(a, b, t):
    a, b = lin(a), lin(b)
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale_col(c, k):
    c = lin(c)
    return tuple(max(0.0, x * k) for x in c)


def grad_z(c0, c1, z0, z1, noise_amp=0.0, noise_scale=1.0):
    """Colour function: vertical gradient in object space with optional value noise."""
    def f(co, n):
        t = (co.z - z0) / max(1e-6, z1 - z0)
        if noise_amp:
            t += noise.noise(co * noise_scale) * noise_amp
        return mix(c0, c1, t)
    return f


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------

def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Matrix from location, rotation in DEGREES (XYZ euler) and scale."""
    r = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
    s = Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
    return Matrix.Translation(Vector(loc)) @ r @ s


MAT_PRESETS = {
    'base': dict(rough=0.78),
    'soft': dict(rough=0.9),
    'gloss': dict(rough=0.35),
    'metal': dict(rough=0.42, metal=0.65),
    'foliage': dict(rough=0.85, double=True),
    'emit': dict(rough=0.5, emit=1.0, strength=3.0),
    'banner': dict(rough=0.8),
    'glass': dict(rough=0.15),
}


class Part:
    """One mesh node. Geometry is accumulated in a BMesh in the PARENT/world frame;
    `origin` is the pivot (node location) and is subtracted on realize()."""

    def __init__(self, name, origin=(0, 0, 0), parent=None, hard=True, seed=1, empty=False, uv_fit=False):
        self.name = name
        self.origin = Vector(origin)
        self.parent = parent
        self.hard = hard          # weighted normals + sharp edges
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new('Col')
        self.pid = self.bm.faces.layers.int.new('pid')   # primitive id, 0 = not yet finished
        self.npid = 0
        self.mats = []            # material keys, index = material slot
        self.fields = []          # (faces, center, amount) normal fields for foliage
        self.rng = random.Random(seed)
        self.flat = []            # faces that must stay flat-shaded
        self.soft_ao = []         # faces that get only a little baked AO (leaf cards)
        self.empty = empty        # export as an empty node (pivot only)
        self.force_mat = None     # set to put every primitive on one material (one draw call)
        self.uv_fit = uv_fit      # planar UV 0..1 over the part bounds (for banners)

    # -- internal -----------------------------------------------------------
    def _begin(self):
        pass

    def _new_faces(self):
        return [f for f in self.bm.faces if f[self.pid] == 0]

    def _end(self, color, mat='base', smooth=True, jitter=0.0, hue_jitter=0.0):
        new = self._new_faces()
        self.npid += 1
        mat = self.force_mat or mat
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        base_jit = 1.0 + self.rng.uniform(-jitter, jitter) if jitter else 1.0
        hj = self.rng.uniform(-hue_jitter, hue_jitter) if hue_jitter else 0.0
        for f in new:
            f.material_index = mi
            f.smooth = smooth
            f[self.pid] = self.npid
            for l in f.loops:
                c = color(l.vert.co, f.normal) if callable(color) else lin(color)
                c = [x * base_jit for x in c]
                if hj:
                    cc = Color(c)
                    cc.h = (cc.h + hj) % 1.0
                    c = list(cc)
                l[self.col] = (c[0], c[1], c[2], 1.0)
        return new

    # -- primitives ---------------------------------------------------------
    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), color='wood', bevel=0.0, seg=1,
            mat='base', smooth=True, jitter=0.0, hue_jitter=0.0, base=False, matrix=None):
        """Box of size (x, y, z) centred at loc (base=True: loc is bottom centre)."""
        self._begin()
        sx, sy, sz = size
        l = Vector(loc) + (Vector((0, 0, sz / 2)) if base else Vector())
        m = (matrix or Matrix()) @ M(l, rot, (sx, sy, sz))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        if bevel > 0:
            new_e = [e for e in self.bm.edges if any(f[self.pid] == 0 for f in e.link_faces)]
            bmesh.ops.bevel(self.bm, geom=new_e, offset=bevel, offset_type='OFFSET', segments=seg,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        return self._end(color, mat, smooth, jitter, hue_jitter)

    def cyl(self, r, h, loc=(0, 0, 0), rot=(0, 0, 0), color='wood', segs=12, r2=None, caps=True,
            bevel=0.0, mat='base', smooth=True, jitter=0.0, matrix=None):
        """Cylinder/cone along local +Z, base at loc."""
        self._begin()
        m = (matrix or Matrix()) @ M(loc, rot) @ Matrix.Translation((0, 0, h / 2))
        bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                              radius2=r if r2 is None else r2, depth=h, matrix=m)
        if bevel > 0 and caps:
            new_e = [e for e in self.bm.edges if any(f[self.pid] == 0 for f in e.link_faces)
                     and e.calc_face_angle(0) > 0.6]
            bmesh.ops.bevel(self.bm, geom=new_e, offset=bevel, offset_type='OFFSET', segments=1,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        return self._end(color, mat, smooth, jitter)

    def sphere(self, r, loc=(0, 0, 0), color='white', scale=(1, 1, 1), rot=(0, 0, 0), segs=10, rings=7,
               ico=None, mat='base', smooth=True, jitter=0.0, matrix=None):
        self._begin()
        m = (matrix or Matrix()) @ M(loc, rot, scale)
        if ico is not None:
            bmesh.ops.create_icosphere(self.bm, subdivisions=ico, radius=r, matrix=m)
        else:
            bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=r, matrix=m)
        return self._end(color, mat, smooth, jitter)

    def _rings(self, rings, cap0=True, cap1=True):
        """Connect a list of vertex rings (lists of BMVerts, same length or length 1 = pole)."""
        bm = self.bm
        for a, b in zip(rings[:-1], rings[1:]):
            n = max(len(a), len(b))
            for i in range(n):
                j = (i + 1) % n
                if len(a) == 1:
                    vs = [a[0], b[j], b[i]]
                elif len(b) == 1:
                    vs = [a[i], a[j], b[0]]
                else:
                    vs = [a[i], a[j], b[j], b[i]]
                try:
                    bm.faces.new(vs)
                except ValueError:
                    pass
        if cap0 and len(rings[0]) > 2:
            try:
                bm.faces.new(list(reversed(rings[0])))
            except ValueError:
                pass
        if cap1 and len(rings[-1]) > 2:
            try:
                bm.faces.new(rings[-1])
            except ValueError:
                pass

    def lathe(self, profile, loc=(0, 0, 0), rot=(0, 0, 0), color='wood', segs=16, mat='base',
              smooth=True, jitter=0.0, cap0=True, cap1=True, matrix=None, scale=(1, 1, 1), phase=0.0):
        """Revolve profile [(r, z), ...] (bottom to top) about local Z."""
        self._begin()
        m = (matrix or Matrix()) @ M(loc, rot, scale)
        rings = []
        for r, z in profile:
            if r <= 1e-5:
                rings.append([self.bm.verts.new(m @ Vector((0, 0, z)))])
            else:
                rings.append([self.bm.verts.new(m @ Vector((r * math.cos(phase + 2 * math.pi * i / segs),
                                                             r * math.sin(phase + 2 * math.pi * i / segs), z)))
                              for i in range(segs)])
        self._rings(rings, cap0, cap1)   # orientation: outside is to the right of the profile (bottom->top = outward)
        return self._end(color, mat, smooth, jitter)

    def sweep(self, pts, radii, color='bark', segs=8, mat='base', smooth=True, cap0=True, cap1=True,
              jitter=0.0, profile=None, up=None):
        """Tube along a polyline. radii: float or per-point list. profile: optional 2D
        closed polygon [(x, y)] (unit size, scaled by radius) instead of a circle."""
        self._begin()
        pts = [Vector(p) for p in pts]
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * len(pts)
        n = len(pts)
        tans = []
        for i in range(n):
            a = pts[max(0, i - 1)]
            b = pts[min(n - 1, i + 1)]
            tans.append((b - a).normalized())
        ref = Vector(up) if up else (Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0)))
        N = (ref - tans[0] * ref.dot(tans[0])).normalized()
        prof = profile or [(math.cos(2 * math.pi * i / segs), math.sin(2 * math.pi * i / segs)) for i in range(segs)]
        rings = []
        for i in range(n):
            T = tans[i]
            N = (N - T * N.dot(T))
            if N.length < 1e-6:
                N = T.orthogonal()
            N.normalize()
            B = T.cross(N)
            r = radii[i]
            if r <= 1e-5:
                rings.append([self.bm.verts.new(pts[i])])
            else:
                rings.append([self.bm.verts.new(pts[i] + (N * x + B * y) * r) for x, y in prof])
        self._rings(rings, cap0, cap1)   # orientation: outside is to the right of the profile (bottom->top = outward)
        return self._end(color, mat, smooth, jitter)

    def prism(self, poly, depth, loc=(0, 0, 0), rot=(0, 0, 0), color='wood', mat='base', smooth=True,
              bevel=0.0, jitter=0.0, matrix=None):
        """Extrude a 2D polygon [(x, z)] (in the XZ plane) by depth along Y, centred on Y."""
        self._begin()
        m = (matrix or Matrix()) @ M(loc, rot)
        front = [self.bm.verts.new(m @ Vector((x, -depth / 2, z))) for x, z in poly]
        back = [self.bm.verts.new(m @ Vector((x, depth / 2, z))) for x, z in poly]
        self.bm.faces.new(front)
        self.bm.faces.new(list(reversed(back)))
        k = len(poly)
        for i in range(k):
            j = (i + 1) % k
            self.bm.faces.new([front[j], front[i], back[i], back[j]])
        self._fix_normals()
        if bevel > 0:
            new_e = [e for e in self.bm.edges if any(f[self.pid] == 0 for f in e.link_faces)]
            bmesh.ops.bevel(self.bm, geom=new_e, offset=bevel, offset_type='OFFSET', segments=1,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        return self._end(color, mat, smooth, jitter)

    def quad(self, pts, color='white', mat='base', smooth=False):
        self._begin()
        self.bm.faces.new([self.bm.verts.new(Vector(p)) for p in pts])
        return self._end(color, mat, smooth)

    def mesh(self, me, matrix=Matrix(), color='white', mat='base', smooth=True, jitter=0.0):
        """Append a Blender mesh datablock."""
        self._begin()
        vs = [self.bm.verts.new(matrix @ v.co) for v in me.vertices]
        for p in me.polygons:
            try:
                self.bm.faces.new([vs[i] for i in p.vertices])
            except ValueError:
                pass
        return self._end(color, mat, smooth, jitter)

    def _fix_normals(self):
        new = self._new_faces()
        if new:
            bmesh.ops.recalc_face_normals(self.bm, faces=new)

    # -- organic ------------------------------------------------------------
    def blob(self, balls, color, res=0.3, tris=None, noise_amp=0.0, noise_scale=1.0, mat='foliage',
             field=None, threshold=0.6, matrix=Matrix(), squash=None):
        """Metaball cluster -> soft lumpy mesh. balls: [(pos, radius)] or [(pos, radius, (sx,sy,sz))].
        tris: decimate to roughly this triangle count. field: amount (0..1) of spherical normals
        around the blob centroid (soft foliage lighting)."""
        me = metaball_mesh(balls, res, threshold)
        if noise_amp:
            me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
            for v in me.vertices:
                d = noise.noise(v.co * noise_scale + Vector((3.1, 7.7, 1.3)))
                v.co += v.normal * d * noise_amp
        if squash:
            for v in me.vertices:
                if v.co.z < squash[0]:
                    v.co.z = squash[0] + (v.co.z - squash[0]) * squash[1]
        if tris:
            me = decimate(me, tris)
        faces = self.mesh(me, matrix, color, mat, True)
        if field:
            c = Vector()
            for f in faces:
                c += f.calc_center_median()
            c /= max(1, len(faces))
            self.fields.append((faces, c, field))
        bpy.data.meshes.remove(me)
        return faces

    def leaves(self, src_faces, count, size, colors, mat='foliage', up_bias=0.6, push=0.04,
               tilt=0.9, center=None, field=0.0, min_z=-1e9, vary=0.0, width=0.55):
        """Scatter folded leaf cards (2 tris each) over the given faces."""
        rng = self.rng
        weights = []
        for f in src_faces:
            w = f.calc_area() * (1.0 - up_bias + up_bias * max(0.0, f.normal.z + 0.3))
            if f.calc_center_median().z < min_z:
                w = 0
            weights.append(w)
        tot = sum(weights)
        if tot <= 0:
            return []
        self._begin()
        cum = []
        acc = 0
        for w in weights:
            acc += w
            cum.append(acc)
        import bisect
        for i in range(count):
            f = src_faces[min(len(src_faces) - 1, bisect.bisect_left(cum, rng.uniform(0, tot)))]
            # random point in face
            vs = [v.co for v in f.verts]
            a, b = rng.random(), rng.random()
            if a + b > 1:
                a, b = 1 - a, 1 - b
            p = vs[0] + (vs[1] - vs[0]) * a + (vs[-1] - vs[0]) * b
            n = f.normal.copy()
            if center is not None:
                n = (n + (p - Vector(center)).normalized()).normalized()
            cn = (n + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.5, 1))) * tilt).normalized()
            t = cn.orthogonal().normalized()
            t.rotate(Matrix.Rotation(rng.uniform(0, 2 * math.pi), 3, cn))
            bvec = cn.cross(t)
            L = size * rng.uniform(0.75, 1.25)
            W = L * width
            c = p + n * push
            tip = c + t * L * 0.6
            base = c - t * L * 0.4
            s1 = c + bvec * W * 0.5 - cn * W * 0.22
            s2 = c - bvec * W * 0.5 - cn * W * 0.22
            v = [self.bm.verts.new(x) for x in (tip, s1, base, s2)]
            self.bm.faces.new([v[0], v[1], v[2]])
            self.bm.faces.new([v[0], v[2], v[3]])
        new = self._new_faces()
        self.npid += 1
        # colour: pick per card
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        for k in range(0, len(new), 2):
            cc = lin(colors[rng.randrange(len(colors))]) if not callable(colors) else None
            kv = 1.0 + rng.uniform(-vary, vary)
            for f in new[k:k + 2]:
                f.material_index = mi
                f.smooth = True
                f[self.pid] = self.npid
                for l in f.loops:
                    c = colors(l.vert.co, f.normal) if callable(colors) else cc
                    l[self.col] = (c[0] * kv, c[1] * kv, c[2] * kv, 1.0)
        if field and center is not None:
            self.fields.append((new, Vector(center), field))
        self.soft_ao.extend(new)
        return new

    def displace(self, faces, amp, scale=1.0, seed=0.0):
        vs = set(v for f in faces for v in f.verts)
        off = Vector((seed, seed * 1.7, seed * 0.3))
        for v in vs:
            d = noise.noise(v.co * scale + off)
            v.co += v.normal * d * amp

    def tri_count(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)


# ---------------------------------------------------------------------------
# Mesh utilities
# ---------------------------------------------------------------------------

def metaball_mesh(balls, res=0.3, threshold=0.6):
    sc = bpy.context.scene
    mb = bpy.data.metaballs.new('tmp_mb')
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = threshold
    ob = bpy.data.objects.new('tmp_mb', mb)
    sc.collection.objects.link(ob)
    for b in balls:
        e = mb.elements.new()
        e.co = Vector(b[0])
        e.radius = b[1]
        if len(b) > 2 and b[2]:
            e.type = b[3] if len(b) > 3 else 'ELLIPSOID'
            e.size_x, e.size_y, e.size_z = b[2]
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.metaballs.remove(mb)
    # weld
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    return me


def decimate(me, target_tris):
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris <= target_tris:
        return me
    sc = bpy.context.scene
    ob = bpy.data.objects.new('tmp_dec', me)
    sc.collection.objects.link(ob)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return me2


def get_material(key, prop_name, emit_color=None):
    name = 'M_%s' % prop_name if key == 'base' else 'M_%s_%s' % (prop_name, key.split(':')[0])
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    p = MAT_PRESETS.get(key.split(':')[0], MAT_PRESETS['base'])
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = p.get('rough', 0.8)
    bsdf.inputs['Metallic'].default_value = p.get('metal', 0.0)
    if p.get('emit'):
        ec = lin(key.split(':')[1]) if ':' in key else lin(emit_color or 'yellow')
        bsdf.inputs['Emission Color'].default_value = (ec[0], ec[1], ec[2], 1.0)
        bsdf.inputs['Emission Strength'].default_value = p.get('strength', 2.0)
    mat.use_backface_culling = not p.get('double', False)
    return mat


def realize(parts, prop_name):
    """Create objects for parts. First part is the root. Returns the list of objects."""
    sc = bpy.context.scene
    objs = {}
    for part in parts:
        if part.empty:
            ob = bpy.data.objects.new(part.name, None)
            ob.empty_display_size = 0.3
            sc.collection.objects.link(ob)
            objs[part.name] = ob
            continue
        me = bpy.data.meshes.new(part.name)
        bm = part.bm
        bm.faces.layers.int.remove(part.pid)
        # move into node-local frame
        if part.origin.length > 0:
            bmesh.ops.translate(bm, vec=-part.origin, verts=bm.verts)
            for i, (faces, c, a) in enumerate(part.fields):
                part.fields[i] = (faces, c - part.origin, a)
        # box-projected UVs, 1 UV unit = 2 m
        uv = bm.loops.layers.uv.new('UVMap')
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                co = l.vert.co + part.origin
                if ax == 2:
                    l[uv].uv = (co.x / 2.0, co.y / 2.0)
                elif ax == 0:
                    l[uv].uv = (co.y / 2.0, co.z / 2.0)
                else:
                    l[uv].uv = (co.x / 2.0, co.z / 2.0)
        if part.uv_fit and bm.verts:
            xs = [v.co.x for v in bm.verts]
            zs = [v.co.z for v in bm.verts]
            x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
            for f in bm.faces:
                for l in f.loops:
                    l[uv].uv = ((l.vert.co.x - x0) / max(1e-6, x1 - x0), (l.vert.co.z - z0) / max(1e-6, z1 - z0))
        bm.normal_update()
        # custom normal fields for foliage
        loop_normals = None
        if part.fields:
            fieldmap = {}
            for faces, c, a in part.fields:
                for f in faces:
                    if f.is_valid:
                        fieldmap[f] = (c, a)
            loop_normals = []
            for f in bm.faces:
                fa = fieldmap.get(f)
                for l in f.loops:
                    if not f.smooth:
                        nn = f.normal.copy()
                    else:
                        nn = l.vert.normal.copy()
                    if fa:
                        d = (l.vert.co - fa[0])
                        if d.length > 1e-5:
                            nn = nn.lerp(d.normalized(), fa[1]).normalized()
                    loop_normals.append(nn)
        bm.faces.index_update()
        soft = sorted({f.index for f in part.soft_ao if f.is_valid})
        bm.to_mesh(me)
        if loop_normals is not None:
            me.normals_split_custom_set(loop_normals)
        ob = bpy.data.objects.new(part.name, me)
        sc.collection.objects.link(ob)
        for key in part.mats:
            me.materials.append(get_material(key, prop_name))
        ca = me.color_attributes.get('Col')
        if ca:
            me.color_attributes.active_color = ca
            me.color_attributes.render_color_index = me.color_attributes.find('Col')
        if part.hard and loop_normals is None:
            me.set_sharp_from_angle(angle=math.radians(50))
            mod = ob.modifiers.new('wn', 'WEIGHTED_NORMAL')
            mod.keep_sharp = True
            mod.mode = 'FACE_AREA'
            mod.weight = 50
        objs[part.name] = ob
        ob['soft_ao'] = soft
    for part in parts:
        ob = objs[part.name]
        if part.parent:
            ob.parent = objs[part.parent]
            ob.location = part.origin - next(p.origin for p in parts if p.name == part.parent)
        else:
            ob.location = part.origin
    return [objs[p.name] for p in parts]


def bake_ao(objs, strength=0.65, distance=1.5, samples=48, ground=True, soft=0.25):
    """Bake ambient occlusion into a temp colour attribute and multiply it into 'Col'."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.device = 'CPU'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('w')
    sc.world.light_settings.distance = distance
    gp = None
    if ground:
        gme = bpy.data.meshes.new('ao_ground')
        s = 200
        gme.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        gp = bpy.data.objects.new('ao_ground', gme)
        sc.collection.objects.link(gp)
    meshes = [o for o in objs if o.type == 'MESH' and len(o.data.polygons)]
    if not meshes:
        return
    for o in meshes:
        ao = o.data.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
        o.data.color_attributes.active_color = ao
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    for o in meshes:
        me = o.data
        ao = me.color_attributes['AO']
        col = me.color_attributes['Col']
        aod = [0.0] * (len(ao.data) * 4)
        ao.data.foreach_get('color', aod)
        cd = [0.0] * (len(col.data) * 4)
        col.data.foreach_get('color', cd)
        weak = set()
        for fi in o.get('soft_ao', []):
            pol = me.polygons[fi]
            weak.update(range(pol.loop_start, pol.loop_start + pol.loop_total))
        for i in range(len(col.data)):
            a = max(0.3, aod[i * 4])     # vertices buried in other geometry must not turn a whole face black
            st = soft if i in weak else strength
            k = 1.0 - st + st * a
            for j in range(3):
                cd[i * 4 + j] *= k
        col.data.foreach_set('color', cd)
        me.color_attributes.remove(me.color_attributes['AO'])
        if 'soft_ao' in o:
            del o['soft_ao']
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
    if gp:
        bpy.data.objects.remove(gp)
    bpy.ops.object.select_all(action='DESELECT')


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        n += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    return n


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = -lo
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_texcoords=True, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_materials='EXPORT', export_extras=False,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_draco_color_quantization=8,
        export_animations=False, export_cameras=False, export_lights=False)
    return os.path.getsize(path)
