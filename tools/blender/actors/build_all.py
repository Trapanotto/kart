# Rebuilds every actors asset: drivers, karts, items, portraits and the contact sheet.
# Usage: "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b -P tools/blender/actors/build_all.py
import os
import subprocess
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BLENDER = bpy.app.binary_path
IDS = ['sloth', 'sheep', 'redpanda', 'hedgehog', 'penguin', 'capybara', 'otter', 'axolotl']


def run(script, *args):
    cmd = [BLENDER, '-b', '--factory-startup', '-P', os.path.join(HERE, script), '--', *args]
    print('>>', ' '.join(cmd[3:]))
    subprocess.run(cmd, check=True, cwd=ROOT)


run('build_char.py', 'all', '--export')
run('build_kart.py', 'all', '--export')
run('build_items.py', 'all', '--export')
run('render_portraits.py', 'all')
portraits = [os.path.join(ROOT, 'public', 'assets', 'portraits', i + '.webp') for i in IDS]
run('contact_sheet.py', os.path.join(ROOT, 'docs', 'actors-sheet.webp'), '4', *portraits, '--bg', '0.80,0.86,0.93')
print('done')
sys.exit(0)
