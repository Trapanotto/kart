# Blender helpers shared by all actor scripts: scene, meshes, materials, render, export.
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MODELS = os.environ.get('ACTORS_MODELS', os.path.join(ROOT, 'public', 'assets', 'models'))
PORTRAITS = os.path.join(ROOT, 'public', 'assets', 'portraits')
PREVIEW = os.environ.get('ACTORS_PREVIEW', os.path.join(ROOT, 'tools', 'blender', 'actors', '_preview'))

# Shared layout between karts and drivers (Blender space: Z up, front = -Y, +X = left).
SEAT = Vector((0.0, 0.22, 0.30))          # where the driver's root sits, kart space
WHEEL_C = SEAT + Vector((0.0, -0.31, 0.36))  # steering wheel centre, kart space (= SEAT + anatomy.WHEEL_REL)
WHEEL_TILT = math.radians(-28)            # rotation about X: top of the wheel leans towards the driver
WHEEL_R = 0.14                            # grip radius
STEER_MAX = 0.75                          # steering wheel rotation at full lock (rad)


def args():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def lod_arg(a):
    """`--lod N` (0 = full detail, 1 = phone opponents). Sets ACTORS_LOD so module reloads keep it."""
    n = int(a[a.index('--lod') + 1]) if '--lod' in a else int(os.environ.get('ACTORS_LOD', '0'))
    os.environ['ACTORS_LOD'] = str(n)
    return n


def lod_suffix(lod):
    return '.lod%d' % lod if lod else ''


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.objects, bpy.data.armatures, bpy.data.actions):
        for x in list(c):
            c.remove(x)


def link(obj, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


# ---------------------------------------------------------------- meshes
def mesh_from_np(name, verts, faces):
    me = bpy.data.meshes.new(name)
    verts = np.asarray(verts, dtype=np.float32)
    faces = np.asarray(faces, dtype=np.int32)
    nf, fs = faces.shape
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.ravel())
    me.loops.add(nf * fs)
    me.loops.foreach_set('vertex_index', faces.ravel())
    me.polygons.add(nf)
    me.polygons.foreach_set('loop_start', np.arange(0, nf * fs, fs, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    return obj


def verts_np(obj):
    me = obj.data
    a = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get('co', a)
    return a.reshape(-1, 3).astype(np.float64)


def set_verts(obj, V):
    obj.data.vertices.foreach_set('co', np.asarray(V, dtype=np.float32).ravel())
    obj.data.update()


def apply_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def colour_edges(obj, col, thresh=0.04):
    """Per-vertex weight 0..1: how strongly the colour changes across incident edges."""
    me = obj.data
    e = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', e)
    e = e.reshape(-1, 2)
    d = np.abs(col[e[:, 0]] - col[e[:, 1]]).sum(1)
    w = np.zeros(len(me.vertices))
    np.maximum.at(w, e[:, 0], d)
    np.maximum.at(w, e[:, 1], d)
    return np.clip(w / thresh, 0, 1)


def decimate(obj, target_tris, protect=None, factor=8.0):
    """Collapse decimation. `protect` = per-vertex weights 0..1 that raise the collapse cost
    (used to keep colour borders such as ribbons, stripes and face markings crisp)."""
    t = tri_count(obj)
    if t <= target_tris:
        return obj
    m = obj.modifiers.new('dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = target_tris / t
    m.use_collapse_triangulate = True
    if protect is not None:
        # The group limits where collapsing may happen: weight 1 = free, 0 = keep. Borders get low weights.
        g = obj.vertex_groups.new(name='protect')
        free = 1.0 - 0.9 * np.asarray(protect)
        for lvl in np.unique(np.round(free, 2)):
            idx = np.nonzero(np.round(free, 2) == lvl)[0].tolist()
            g.add(idx, float(lvl), 'REPLACE')
        m.vertex_group = 'protect'
        m.vertex_group_factor = factor
    apply_modifiers(obj)
    if protect is not None:
        obj.vertex_groups.clear()
    return obj


def smooth_mesh(obj, iters=2, factor=0.5):
    m = obj.modifiers.new('sm', 'SMOOTH')
    m.iterations = iters
    m.factor = factor
    apply_modifiers(obj)


def shade_smooth(obj):
    obj.data.polygons.foreach_set('use_smooth', np.ones(len(obj.data.polygons), dtype=bool))
    obj.data.update()


def set_colors(obj, cols_lin, name='Color'):
    """Per-vertex linear RGB(A) colours -> point colour attribute."""
    me = obj.data
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    a = me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    c = np.ones((len(me.vertices), 4), dtype=np.float32)
    c[:, :3] = cols_lin
    a.data.foreach_set('color', c.ravel())
    me.color_attributes.active_color = a
    me.color_attributes.render_color_index = me.color_attributes.find(name)


def bm_to_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    link(obj)
    return obj


def uv_sphere(name, c, r, rot=None, seg=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    obj = bm_to_obj(name, bm)
    V = verts_np(obj) * np.asarray(r)
    if rot is not None:
        V = V @ np.asarray(rot).T
    set_verts(obj, V + np.asarray(c))
    return obj


def join(objs, name=None):
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        if name:
            objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    if name:
        objs[0].name = name
        objs[0].data.name = name
    return objs[0]


def fill_color(obj, col_srgb):
    from sdf import srgb_to_lin
    n = len(obj.data.vertices)
    set_colors(obj, np.tile(srgb_to_lin(col_srgb), (n, 1)))


# ---------------------------------------------------------------- materials
def material(name, rough=0.6, metal=0.0, sheen=0.0, sheen_tint=(1, 1, 1), coat=0.0, emit=0.0, alpha=1.0, color=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Roughness'].default_value = 0.35
        b.inputs['Sheen Tint'].default_value = (*sheen_tint, 1)
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if color is None:
        ca = nt.nodes.new('ShaderNodeVertexColor')
        ca.layer_name = 'Color'
        nt.links.new(ca.outputs['Color'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*color, 1)
    if emit:
        b.inputs['Emission Strength'].default_value = emit
        if color is None:
            nt.links.new(ca.outputs['Color'], b.inputs['Emission Color'])
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# ---------------------------------------------------------------- render
def setup_render(res=768, samples=32, transparent=False, res_y=None):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = res
    sc.render.resolution_y = res_y or res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    try:
        sc.eevee.taa_render_samples = samples
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    w = bpy.data.worlds.new('W')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.62, 0.75, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = w
    return sc


def add_light(kind, loc, rot, energy, color=(1, 1, 1), size=1.0, name=None):
    ld = bpy.data.lights.new(name or kind, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.size = size
    if kind == 'SUN':
        ld.angle = math.radians(size)
    ob = bpy.data.objects.new(name or kind, ld)
    ob.location = loc
    ob.rotation_euler = rot
    link(ob)
    return ob


def studio_lights(scale=1.0):
    add_light('SUN', (0, 0, 5), (math.radians(50), 0, math.radians(-35)), 3.2, (1.0, 0.96, 0.9), 3)
    add_light('AREA', (3 * scale, -3 * scale, 2 * scale), (math.radians(60), 0, math.radians(45)), 250 * scale * scale, (1, 1, 1), 3 * scale)
    add_light('AREA', (-2 * scale, 3 * scale, 2.5 * scale), (math.radians(-60), 0, math.radians(200)), 300 * scale * scale, (0.85, 0.9, 1.0), 2 * scale)


def camera(loc, target, lens=50, name='Cam', ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    link(ob)
    bpy.context.scene.camera = ob
    return ob


def render(path, fmt='PNG', quality=90):
    sc = bpy.context.scene
    sc.render.image_settings.file_format = fmt
    sc.render.image_settings.color_mode = 'RGBA' if sc.render.film_transparent else 'RGB'
    if fmt == 'WEBP':
        sc.render.image_settings.quality = quality
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


# ---------------------------------------------------------------- export
def export_glb(path, objs, anim=True, draco=True, images=False, frame_step=1, pos_q=13):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=False,
              export_yup=True, export_normals=True,
              export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT', export_texcoords=images,
              export_image_format='WEBP' if images else 'NONE', export_image_quality=88,
              export_animations=anim, export_skins=True, export_morph=True,
              export_morph_normal=False, export_def_bones=True, export_leaf_bone=False,
              export_extras=False, export_cameras=False, export_lights=False)
    if anim:
        kw.update(export_animation_mode='ACTIONS', export_frame_step=frame_step, export_force_sampling=True,
                  export_optimize_animation_size=True, export_anim_slide_to_zero=True,
                  export_nla_strips=False)
    if draco:
        kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                  export_draco_position_quantization=pos_q, export_draco_normal_quantization=8,
                  export_draco_color_quantization=8, export_draco_generic_quantization=10)
    bpy.ops.export_scene.gltf(**kw)
    print('EXPORTED', path, os.path.getsize(path) // 1024, 'KB')


# ---------------------------------------------------------------- analytic texture bake
def uv_unwrap(obj, margin=0.01, angle=66):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def _lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def bake_texture(obj, colour_fn, size=512, name=None, pad=4):
    """Rasterise every triangle in UV space, evaluate colour_fn(P, N) at the texel's 3D position
    (P, N = (K,3) arrays, returns linear RGB) and store it as an sRGB image used by the object."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tv = np.zeros(nt * 3, dtype=np.int64)
    tl = np.zeros(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', tv)
    me.loop_triangles.foreach_get('loops', tl)
    tv = tv.reshape(-1, 3)
    tl = tl.reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2).astype(np.float64)
    V = verts_np(obj)
    Nv = np.zeros(len(me.vertices) * 3, dtype=np.float32)
    me.vertex_normals.foreach_get('vector', Nv)
    Nv = Nv.reshape(-1, 3).astype(np.float64)
    S = size
    pos = np.zeros((S, S, 3))
    nrm = np.zeros((S, S, 3))
    filled = np.zeros((S, S), dtype=bool)
    for t in range(nt):
        A = uv[tl[t]] * S - 0.5
        x0, y0 = np.floor(A.min(0)).astype(int) - 1
        x1, y1 = np.ceil(A.max(0)).astype(int) + 1
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, S - 1), min(y1, S - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        px = np.stack([xs.ravel(), ys.ravel()], 1).astype(np.float64)
        a, b, c = A
        v0, v1 = b - a, c - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-12:
            continue
        d = px - a
        l1 = (d[:, 0] * v1[1] - v1[0] * d[:, 1]) / den
        l2 = (v0[0] * d[:, 1] - d[:, 0] * v0[1]) / den
        l0 = 1 - l1 - l2
        eps = 1.0 / max(np.linalg.norm(v0), np.linalg.norm(v1), 1.0)
        inside = (l0 >= -eps) & (l1 >= -eps) & (l2 >= -eps)
        if not inside.any():
            continue
        L = np.clip(np.stack([l0, l1, l2], 1)[inside], 0, 1)
        L /= L.sum(1, keepdims=True)
        tri = tv[t]
        P = L @ V[tri]
        Nn = L @ Nv[tri]
        ix = px[inside].astype(int)
        pos[ix[:, 1], ix[:, 0]] = P
        nrm[ix[:, 1], ix[:, 0]] = Nn
        filled[ix[:, 1], ix[:, 0]] = True
    idx = np.nonzero(filled)
    Nf = nrm[idx]
    Nf /= np.maximum(np.linalg.norm(Nf, axis=1, keepdims=True), 1e-9)
    col = np.zeros((S, S, 3))
    col[idx] = colour_fn(pos[idx], Nf)
    # dilate into the gutters so mip-maps do not bleed the background in
    for _ in range(pad):
        acc = np.zeros_like(col)
        cnt = np.zeros((S, S))
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(col, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~filled) & (cnt > 0)
        col[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    img = bpy.data.images.new(name or obj.name + '_tex', S, S, alpha=False)
    rgba = np.ones((S, S, 4), dtype=np.float32)
    rgba[..., :3] = _lin_to_srgb(col)
    img.pixels = rgba.ravel()
    img.pack()
    return img


def material_tex(name, img, rough=0.5, metal=0.0, coat=0.0, alpha=1.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Roughness'].default_value = 0.35
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m
