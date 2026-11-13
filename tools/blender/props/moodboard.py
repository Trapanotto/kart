"""Kleeblatt-Tal beauty scene: the prop kit on a grassy hill with a road, lit by the meadow HDRI.
Imports the exported GLBs (so it is also an integration test of the files) and the WebP textures.

blender -b -P tools/blender/props/moodboard.py -- <out.png> [--w 1600 --h 900 --samples 64] [--cam 2]
"""
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Matrix, noise
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit, render

TEX = os.path.join(kit.ROOT, 'public', 'assets', 'textures')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else os.path.join(HERE, 'out', 'moodboard.png')


def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default


W, H, SAMPLES, CAM = arg('--w', 1600), arg('--h', 900), arg('--samples', 64), arg('--cam', 1)

# road centreline (Blender XY), driving direction +Y
ROAD = [Vector(p) for p in [(0, -90), (0, -40), (1, -10), (6, 20), (18, 48), (30, 75), (34, 105), (28, 140), (15, 175)]]


def smooth_path(pts, n=12):
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(0, i - 1)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(len(pts) - 1, i + 2)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-1])
    return out


PATH = smooth_path(ROAD)


def road_dist(x, y):
    p = Vector((x, y))
    best = 1e9
    for a, b in zip(PATH[:-1], PATH[1:]):
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
        d = (a + ab * t - p).length
        best = min(best, d)
    return best


def height(x, y):
    d = road_dist(x, y)
    hill = noise.noise(Vector((x * 0.012, y * 0.012, 0.3))) * 9 + noise.noise(Vector((x * 0.04, y * 0.04, 1.7))) * 1.5
    hill += max(0.0, -x - 30) * 0.12 + max(0.0, y - 60) * 0.05     # rising hill on the left / back
    k = min(1.0, max(0.0, (d - 9) / 40))
    k = k * k * (3 - 2 * k)
    return hill * k


def tex_material(name, set_name, scale=1.0, tint=None):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None:
        mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    d = os.path.join(TEX, set_name)
    uv = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

    def img(fn, cs):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(d, fn))
        t.image.colorspace_settings.name = cs
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        return t
    c = img('color.webp', 'sRGB')
    if tint:
        mixn = nt.nodes.new('ShaderNodeMix')
        mixn.data_type = 'RGBA'
        mixn.blend_type = 'MULTIPLY'
        mixn.inputs['Factor'].default_value = 1.0
        nt.links.new(c.outputs['Color'], mixn.inputs['A'])
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Tint'
        nt.links.new(attr.outputs['Color'], mixn.inputs['B'])
        nt.links.new(mixn.outputs['Result'], bsdf.inputs['Base Color'])
    else:
        nt.links.new(c.outputs['Color'], bsdf.inputs['Base Color'])
    n = img('normal.webp', 'Non-Color')
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    o = img('orm.webp', 'Non-Color')
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(o.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    return mat


def build_ground(sc):
    size, n = 420.0, 150
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    tint = bm.loops.layers.color.new('Tint')
    verts = []
    for j in range(n + 1):
        row = []
        for i in range(n + 1):
            x = -size / 2 + size * i / n + 10
            y = -size / 2 + size * j / n + 60
            row.append(bm.verts.new((x, y, height(x, y))))
        verts.append(row)
    for j in range(n):
        for i in range(n):
            f = bm.faces.new([verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]])
            f.smooth = True
            for l in f.loops:
                co = l.vert.co
                l[uv].uv = (co.x / 6.0, co.y / 6.0)
                v = noise.noise(Vector((co.x * 0.02, co.y * 0.02, 5.0)))
                d = road_dist(co.x, co.y)
                c = kit.mix('#d8d8d8', '#d8dca0', max(0.0, v) * 1.2)      # meadow variation (multiplies the texture)
                c = kit.mix(c, '#a9c4a0', max(0.0, -v) * 1.0)
                l[tint] = (c[0], c[1], c[2], 1.0)
    me = bpy.data.meshes.new('ground')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('ground', me)
    sc.collection.objects.link(ob)
    me.materials.append(tex_material('grass', 'grass', 1.0, tint=True))
    return ob


def build_road(sc):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    halfw, shoulder = 7.0, 1.6
    rows = []
    s = 0.0
    for i, p in enumerate(PATH):
        a = PATH[max(0, i - 1)]
        b = PATH[min(len(PATH) - 1, i + 1)]
        t = (b - a).normalized()
        nrm = Vector((-t.y, t.x))
        if i:
            s += (PATH[i] - PATH[i - 1]).length
        row = []
        for off in (-halfw - shoulder, -halfw, halfw, halfw + shoulder):
            q = p + nrm * off
            row.append((bm.verts.new((q.x, q.y, height(q.x, q.y) + 0.06)), off, s))
        rows.append(row)
    mats = []
    for r0, r1 in zip(rows[:-1], rows[1:]):
        for k in range(3):
            f = bm.faces.new([r0[k][0], r0[k + 1][0], r1[k + 1][0], r1[k][0]])
            f.material_index = 0 if k == 1 else 1
            f.smooth = True
            for l, (v, off, s_) in zip(f.loops, [r0[k], r0[k + 1], r1[k + 1], r1[k]]):
                l[uv].uv = ((off + halfw) / 8.0, s_ / 8.0)
    # dashed centre line
    s = 0.0
    for i in range(len(PATH) - 1):
        a, b = PATH[i], PATH[i + 1]
        seg = (b - a).length
        if int(s / 6.0) % 2 == 0:
            t = (b - a).normalized()
            nrm = Vector((-t.y, t.x)) * 0.12
            z0, z1 = height(a.x, a.y) + 0.08, height(b.x, b.y) + 0.08
            vs = [bm.verts.new((a.x - nrm.x, a.y - nrm.y, z0)), bm.verts.new((a.x + nrm.x, a.y + nrm.y, z0)),
                  bm.verts.new((b.x + nrm.x, b.y + nrm.y, z1)), bm.verts.new((b.x - nrm.x, b.y - nrm.y, z1))]
            f = bm.faces.new(vs)
            f.material_index = 2
        s += seg
    me = bpy.data.meshes.new('road')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('road', me)
    sc.collection.objects.link(ob)
    me.materials.append(tex_material('asphalt', 'asphalt', 1.0))
    me.materials.append(tex_material('dirt', 'dirt', 1.0))
    line = bpy.data.materials.new('line')
    if line.node_tree is None:
        line.use_nodes = True
    next(n for n in line.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.9, 0.88, 0.8, 1)
    me.materials.append(line)
    return ob


LIB = {}


def place(name, x, y, rot=0.0, scale=1.0, z=None, mirror=False):
    """Instance a prop GLB at ground height. rot: degrees about Z (0 = model front faces -Y)."""
    if name not in LIB:
        objs = render.import_glb(os.path.join(kit.MODELS, 'prop.%s.glb' % name))
        root = next(o for o in objs if o.parent is None)
        coll = bpy.data.collections.new('lib_' + name)
        for o in objs:
            for c in o.users_collection:
                c.objects.unlink(o)
            coll.objects.link(o)
        LIB[name] = coll
    coll = LIB[name]
    inst = bpy.data.objects.new(name, None)
    inst.instance_type = 'COLLECTION'
    inst.instance_collection = coll
    bpy.context.scene.collection.objects.link(inst)
    inst.location = (x, y, height(x, y) if z is None else z)
    inst.rotation_euler = (0, 0, math.radians(rot))
    inst.scale = (-scale if mirror else scale, scale, scale)
    return inst


def road_frame(s_target):
    s = 0.0
    for a, b in zip(PATH[:-1], PATH[1:]):
        seg = (b - a).length
        if s + seg >= s_target:
            t = (s_target - s) / seg
            p = a.lerp(b, t)
            d = (b - a).normalized()
            return p, d, Vector((-d.y, d.x))
        s += seg
    return PATH[-1], (PATH[-1] - PATH[-2]).normalized(), Vector((0, 1))


def heading(d):
    """Rotation (deg about Z) that turns the model front (-Y) to face direction d."""
    return math.degrees(math.atan2(-d.x, d.y)) + 180.0


def scene_layout():
    rng = random.Random(4)
    # fence runs along the left of the road
    for k in range(26):
        p, d, n = road_frame(20 + k * 4.0)
        q = p + n * 10.5
        place('fence_wood', q.x, q.y, heading(d) - 90 + 180)
    # right side: hedge
    for k in range(10):
        p, d, n = road_frame(60 + k * 4.0)
        q = p - n * 11.0
        place('hedge', q.x, q.y, heading(d) - 90)
    # race furniture
    p, d, n = road_frame(68)
    place('balloon_arch', p.x, p.y, heading(d))
    p, d, n = road_frame(48)
    place('boost_pad', p.x + n.x * 3, p.y + n.y * 3, heading(-d) + 0, z=height(p.x, p.y) + 0.07)
    p, d, n = road_frame(118)
    q = p + n * 9.0
    place('sign_arrow', q.x, q.y, heading(-d))
    p, d, n = road_frame(84)
    q = p - n * 21
    place('grandstand', q.x, q.y, heading(n))
    p, d, n = road_frame(150)
    place('start_gate', p.x, p.y, heading(d))
    # farm
    place('barn', -36, 66, 105)
    place('silo', -16, 86)
    place('windmill', -62, 40, 120)
    place('farmhouse', 48, 26, -110)
    place('well', 36, 12, 30)
    place('tractor', 30, 40, -60)
    place('scarecrow', -26, 30, 40)
    place('hay_stack', -22, 44)
    place('hay_stack', -30, 48, 40, 0.85)
    for (x, y, r) in ((14, 2, 10), (16.5, 4.5, 70), (13, 7, 35)):
        place('hay_bale', x, y, r)
    for (x, y) in ((-20, 84), (-21.2, 84.3)):
        place('crate', x, y, rng.uniform(0, 90))
    place('crate', -20.6, 84.2, 20, z=height(-20.6, 84.2) + 1.0)
    # sheep crossing the road ahead and grazing
    p, d, n = road_frame(102)
    for k in range(5):
        q = p + n * (-3 + k * 1.8) + d * rng.uniform(-1.5, 1.5)
        place('sheep', q.x, q.y, heading(n) + rng.uniform(-25, 25))
    for k in range(6):
        place('sheep', 52 + rng.uniform(-8, 8), 70 + rng.uniform(-8, 8), rng.uniform(0, 360))
    # trees
    for (x, y) in ((-24, -6), (-38, 22), (40, -12), (-46, 92), (60, 50), (-14, 116)):
        place('tree_oak', x, y, rng.uniform(0, 360), rng.uniform(0.9, 1.15))
    for i in range(4):
        for j in range(3):
            place('tree_apple', 54 + i * 8 + rng.uniform(-1, 1), 92 + j * 8 + rng.uniform(-1, 1), rng.uniform(0, 360), rng.uniform(0.9, 1.1))
    for (x, y) in ((-30, 0), (-33, 4), (-27, 8), (22, 120), (26, 126), (-70, 70)):
        place('tree_birch', x, y, rng.uniform(0, 360), rng.uniform(0.9, 1.1))
    # bushes, rocks
    for (x, y) in ((-16, 8), (17, 30), (-18, 62), (40, 64), (-15, 102), (12, 140)):
        place('bush', x, y, rng.uniform(0, 360), rng.uniform(0.8, 1.2))
    for (x, y, nm) in ((-13, -8, 'rock_a'), (15, -4, 'rock_b'), (-25, 110, 'rock_a'), (24, 92, 'rock_b'), (-12, 20, 'rock_b')):
        place(nm, x, y, rng.uniform(0, 360), rng.uniform(0.8, 1.2))
    # grass and flowers scattered off-road (instanced)
    for k in range(900):
        x, y = rng.uniform(-50, 70), rng.uniform(-60, 140)
        dd = road_dist(x, y)
        if dd < 9.5 or dd > 70:
            continue
        nm = 'flower_patch' if rng.random() < 0.3 else 'grass_tuft'
        place(nm, x, y, rng.uniform(0, 360), rng.uniform(1.0, 1.6))


def main():
    kit.new_scene()
    sc = bpy.context.scene
    render.setup_render(sc, W, H, SAMPLES)
    render.setup_world(sc, 1.0, os.path.join(kit.ENV, 'meadow_day.hdr'))
    render.add_sun(sc, energy=4.0)
    try:
        sc.eevee.shadow_resolution_scale = 1.0
    except Exception:
        pass
    build_ground(sc)
    build_road(sc)
    scene_layout()
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    if CAM == 1:     # chase-cam-like view down the road
        p, d, n = road_frame(18)
        eye = Vector((p.x - n.x * 1.5, p.y - n.y * 1.5, height(p.x, p.y) + 4.2))
        tgt = Vector((road_frame(95)[0].x, road_frame(95)[0].y, 4.0))
        cam.data.lens = 28
    else:            # high overview of the farm
        eye = Vector((60, -40, 45))
        tgt = Vector((5, 60, 0))
        cam.data.lens = 30
    cam.location = eye
    cam.rotation_euler = (tgt - eye).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 1000
    sc.camera = cam
    sc.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print('WROTE', OUT)


main()
