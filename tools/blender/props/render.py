"""Preview renders of exported props (re-imports the GLB, so it doubles as an export check).

blender -b -P tools/blender/props/render.py -- [name ...] [--size 640] [--sun]
Writes tools/blender/props/previews/<name>.png and prints node names / dimensions after import.
"""
import bpy, sys, os, math, json
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit

ENV_HDR = os.path.join(kit.ENV, 'meadow_day_1k.hdr')
PREV = os.path.join(HERE, 'previews')


def hdr_sun(path):
    """Brightest direction of an equirect HDR, as a game-space (Y up) unit vector using three.js'
    equirect convention (u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5, v = 1 at the top)."""
    import numpy as np
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
    y, x = np.unravel_index(np.argmax(lum), lum.shape)
    # centroid of the pixels above 50% of the peak around the peak
    r = 12
    ys, xs = slice(max(0, y - r), min(h, y + r + 1)), slice(max(0, x - r), min(w, x + r + 1))
    sub = lum[ys, xs]
    m = sub > sub.max() * 0.5
    yy, xx = np.nonzero(m)
    wts = sub[m]
    cy = (yy * wts).sum() / wts.sum() + ys.start
    cx = (xx * wts).sum() / wts.sum() + xs.start
    u = (cx + 0.5) / w
    v = (cy + 0.5) / h          # Blender pixel rows start at the bottom
    phi = (u - 0.5) * 2 * math.pi
    lat = (v - 0.5) * math.pi
    g = Vector((math.cos(phi) * math.cos(lat), math.sin(lat), math.sin(phi) * math.cos(lat)))
    col = px[int(y), int(x), :3]
    # average colour of the sun disc vs the sky around it
    disc = px[ys, xs, :3][m].mean(axis=0)
    return g.normalized(), disc, float(lum.max())


def game_to_blender(g):
    return Vector((g.x, -g.z, g.y))


def setup_world(sc, strength=1.0, path=ENV_HDR):
    w = bpy.data.worlds.new('env')
    sc.world = w
    if w.node_tree is None:
        w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new('ShaderNodeTexEnvironment')
    tex.image = bpy.data.images.load(path, check_existing=True)
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(tex.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    try:
        w.sun_threshold = 1000.0   # we add an explicit sun lamp instead of EEVEE's extraction
    except Exception:
        pass
    return w


def add_sun(sc, energy=3.2, angle_deg=2.5):
    g, disc, peak = hdr_sun(ENV_HDR)
    b = game_to_blender(g)
    ld = bpy.data.lights.new('sun', 'SUN')
    ld.energy = energy
    ld.angle = math.radians(angle_deg)
    c = disc / max(disc)
    ld.color = (float(c[0]), float(c[1]), float(c[2]))
    ob = bpy.data.objects.new('sun', ld)
    sc.collection.objects.link(ob)
    ob.rotation_euler = b.to_track_quat('Z', 'Y').to_euler()
    return ob, g, c


def setup_render(sc, w, h, samples=64):
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = samples
        sc.eevee.use_shadows = True
        sc.eevee.use_raytracing = True
        sc.eevee.ray_tracing_options.resolution_scale = '1'
        sc.eevee.fast_gi_method = 'GLOBAL_ILLUMINATION'
    except Exception as e:
        print('eevee opt', e)
    for vt in ('Khronos PBR Neutral', 'AgX', 'Standard'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            pass
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'


def ground(sc, radius=60, color='#9fbf7a'):
    me = bpy.data.meshes.new('ground')
    n = 48
    verts = [(0, 0, 0)] + [(math.cos(2 * math.pi * i / n) * radius, math.sin(2 * math.pi * i / n) * radius, 0) for i in range(n)]
    faces = [(0, i + 1, (i + 1) % n + 1) for i in range(n)]
    me.from_pydata(verts, [], faces)
    mat = bpy.data.materials.new('ground')
    if mat.node_tree is None:
        mat.use_nodes = True
    bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
    c = kit.lin(color)
    bsdf.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
    bsdf.inputs['Roughness'].default_value = 0.95
    me.materials.append(mat)
    ob = bpy.data.objects.new('ground', me)
    sc.collection.objects.link(ob)
    return ob


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def frame_camera(sc, objs, az=-35.0, el=18.0, lens=50, aspect=1.0, margin=1.12):
    lo = Vector((1e9,) * 3)
    hi = -lo
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            wv = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, wv))
            hi = Vector(map(max, hi, wv))
    ctr = (lo + hi) / 2
    rad = (hi - lo).length / 2
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    cam.data.lens = lens
    fov = 2 * math.atan(18 / lens) * min(1.0, aspect)
    dist = rad * margin / math.sin(fov / 2)
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = ctr + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = dist * 10
    sc.camera = cam
    return cam, lo, hi


def preview(name, size=640, az=-35, el=18):
    kit.new_scene()
    sc = bpy.context.scene
    setup_render(sc, size, size)
    setup_world(sc, 1.0)
    add_sun(sc)
    path = os.path.join(kit.MODELS, 'prop.%s.glb' % name)
    objs = import_glb(path)
    ground(sc)
    roots = [o for o in objs if o.parent is None]
    lo0, hi0 = kit.bounds(objs)
    if lo0.z < -0.5:      # e.g. the bridge: lift it so the parts below the origin are visible
        for o in roots:
            o.location.z -= lo0.z
        bpy.context.view_layer.update()
    cam, lo, hi = frame_camera(sc, objs, az, el)
    info = dict(name=name, nodes=sorted(o.name for o in objs),
                size_gltf=[round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)],
                min_z=round(lo0.z, 3),
                materials=sorted({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}),
                has_col=all(len(o.data.color_attributes) > 0 for o in objs if o.type == 'MESH'))
    print('IMPORT', json.dumps(info))
    os.makedirs(PREV, exist_ok=True)
    sc.render.filepath = os.path.join(PREV, name + '.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--sun' in argv:
        g, disc, peak = hdr_sun(ENV_HDR)
        print('SUN game dir', [round(x, 4) for x in g], 'disc rgb', [round(float(x), 3) for x in disc], 'peak', peak)
        g2, d2, p2 = hdr_sun(os.path.join(kit.ENV, 'meadow_day.hdr'))
        print('SUN 2k game dir', [round(x, 4) for x in g2], 'disc rgb', [round(float(x), 3) for x in d2], 'peak', p2)
        sys.exit(0)
    size = 640
    if '--size' in argv:
        size = int(argv[argv.index('--size') + 1])
    az = float(argv[argv.index('--az') + 1]) if '--az' in argv else -35
    el = float(argv[argv.index('--el') + 1]) if '--el' in argv else 18
    names = [a for i, a in enumerate(argv) if not a.startswith('--') and (i == 0 or argv[i - 1] not in ('--size', '--az', '--el'))]
    for n in names:
        preview(n, size, az, el)
