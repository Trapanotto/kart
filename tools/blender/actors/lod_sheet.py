# Full vs LOD 1 comparison: imports the exported GLBs (kart + driver seated on `seat`, posed with a clip)
# and renders one tile per character, full on the left, lod1 on the right; tiles go to docs/actors-lod-sheet.webp.
# Usage: blender -b -P tools/blender/actors/lod_sheet.py -- [ids|all] [--clip idle] [--frame 10] [--out path]
#        [--view front|back|side] [--tile WxH]
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import math

import bpy
from mathutils import Matrix

import common as C

IDS = ['sloth', 'sheep', 'redpanda', 'hedgehog', 'penguin', 'capybara', 'otter', 'axolotl']


def opt(a, name, default):
    return a[a.index(name) + 1] if name in a else default


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def label(text, loc, size=0.16):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    ob = bpy.data.objects.new('lbl', cu)
    C.link(ob)
    ob.location = loc
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.data.materials.append(C.material('label', color=(0.08, 0.09, 0.12), rough=0.9))
    return ob


def place(cid, lod, x, clip, frame, yaw):
    sfx = C.lod_suffix(lod)
    kobjs = import_glb(os.path.join(C.MODELS, 'kart.%s%s.glb' % (cid, sfx)))
    acts0 = set(bpy.data.actions)
    cobjs = import_glb(os.path.join(C.MODELS, 'char.%s%s.glb' % (cid, sfx)))
    new_acts = [x for x in bpy.data.actions if x not in acts0]
    kroot = [o for o in kobjs if o.parent is None][0]
    seat = [o for o in kobjs if o.name.startswith('seat')][0]
    for o in cobjs:
        if o.parent is None:
            o.parent = seat
            o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_basis = Matrix.Identity(4)
    arm = [o for o in cobjs if o.type == 'ARMATURE'][0]
    # the importer names actions after the clip (plus a suffix for repeated imports)
    act = next((x for x in new_acts if x.name == clip or x.name.split('.')[0] == clip or x.name.startswith(clip + '_')), None)
    print('ACTIONS', [x.name for x in new_acts][:4], '->', act and act.name)
    if act:
        arm.animation_data_create()
        arm.animation_data.action = act
        try:
            if act.slots:
                arm.animation_data.action_slot = act.slots[0]
        except AttributeError:
            pass
    kroot.matrix_basis = Matrix.Translation((x, 0, 0)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z') @ kroot.matrix_basis
    tris = sum(len(p.vertices) - 2 for o in kobjs + cobjs if o.type == 'MESH' for p in o.data.polygons)
    return tris


def tile(cid, out, clip, frame, view, res):
    C.reset()
    yaw = {'front': -32, 'back': 148, 'side': -90}[view]
    t_full = place(cid, 0, -1.05, clip, frame, yaw)
    t_lod = place(cid, 1, 1.05, clip, frame, yaw)
    bpy.context.scene.frame_set(frame)
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            m = o.matrix_world @ o.pose.bones['head'].matrix
            print('POSE', o.name, o.animation_data.action and o.animation_data.action.name,
                  [(t.name, t.mute) for t in o.animation_data.nla_tracks if not t.mute],
                  tuple(round(math.degrees(v)) for v in m.to_euler()))
    sc = C.setup_render(res[0], 32, res_y=res[1])
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.8
    C.studio_lights(1.5)
    ground = C.uv_sphere('ground', (0, 0, -50), (60, 60, 50), seg=48, rings=24)
    C.set_material(ground, C.material('ground', rough=0.9, color=(0.62, 0.66, 0.6)))
    label('%s  full %d' % (cid, t_full), (-1.05, -1.3, 0.02), 0.13)
    label('lod1 %d' % t_lod, (1.05, -1.3, 0.02), 0.13)
    C.camera((0, -16.5, 6.6), (0, 0, 0.45), lens=135)   # far + long lens: both karts seen from ~ the same angle
    C.render(out)
    print('TILE', cid, t_full, t_lod)


if __name__ == '__main__':
    a = C.args()
    ids = IDS if not a or a[0].startswith('--') or a[0] == 'all' else a[0].split(',')
    clip = opt(a, '--clip', 'idle')
    frame = int(opt(a, '--frame', '10'))
    view = opt(a, '--view', 'front')
    res = tuple(int(v) for v in opt(a, '--tile', '760x400').split('x'))
    out = opt(a, '--out', os.path.join(C.ROOT, 'docs', 'actors-lod-sheet.webp'))
    tiles = []
    for cid in ids:
        p = os.path.join(C.PREVIEW, 'lod_%s_%s_%s.png' % (cid, clip, view))
        tile(cid, p, clip, frame, view, res)
        tiles.append(p)
    cmd = [bpy.app.binary_path, '-b', '--factory-startup', '-P', os.path.join(C.HERE, 'contact_sheet.py'), '--',
           out, '2', *tiles, '--bg', '0.80,0.86,0.93']
    subprocess.run(cmd, check=True)
