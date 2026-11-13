# Renders the character-select portraits (512 px, transparent, driver in kart, three-quarter view)
# and the review contact sheet docs/actors-sheet.webp.
# Usage: blender -b -P tools/blender/actors/render_portraits.py -- [id,id|all]
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import math
import subprocess

import bpy

import common as C
import build_kart as BK
import build_char as BC
import characters as CH

IDS = ['sloth', 'sheep', 'redpanda', 'hedgehog', 'penguin', 'capybara', 'otter', 'axolotl']


def portrait(cid, out):
    C.reset()
    root, kobjs = BK.build(cid)
    seat = [o for o in kobjs if o.name == 'seat'][0]
    spec, cobjs = BC.build(cid)
    for o in cobjs:
        o.parent = seat
    # a little turn of the wheels and head towards the camera
    for o in kobjs:
        if o.name in ('wheel_fl', 'wheel_fr'):
            o.rotation_euler = (0, 0, math.radians(-14))
    sc = C.setup_render(512, 48, transparent=True)
    sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.7
    C.add_light('SUN', (0, 0, 5), (math.radians(48), 0, math.radians(-40)), 3.0, (1.0, 0.95, 0.88), 3)
    C.add_light('AREA', (2.5, -3.0, 2.2), (math.radians(60), 0, math.radians(40)), 220, (1, 1, 1), 3)
    C.add_light('AREA', (-2.5, 2.0, 2.4), (math.radians(-55), 0, math.radians(215)), 320, (0.85, 0.9, 1.0), 2)
    C.camera((2.1, -2.75, 1.5), (0.1, -0.05, 0.6), lens=50)
    C.render(out, fmt='WEBP', quality=90)


if __name__ == '__main__':
    a = C.args()
    ids = IDS if not a or a[0] == 'all' else a[0].split(',')
    os.makedirs(C.PORTRAITS, exist_ok=True)
    for cid in ids:
        portrait(cid, os.path.join(C.PORTRAITS, cid + '.webp'))
