# Tiles images into one sheet. Usage:
# blender -b -P tools/blender/actors/contact_sheet.py -- <out.(png|webp)> <cols> <img1> <img2> ... [--bg r,g,b] [--labels]
import os
import sys

import bpy
import numpy as np


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    return px


def main():
    a = sys.argv[sys.argv.index('--') + 1:]
    bg = (0.86, 0.88, 0.92)
    if '--bg' in a:
        i = a.index('--bg')
        bg = tuple(float(x) for x in a[i + 1].split(','))
        del a[i:i + 2]
    out, cols, files = a[0], int(a[1]), a[2:]
    tiles = [load(f) for f in files]
    th = max(t.shape[0] for t in tiles)
    tw = max(t.shape[1] for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.ones((rows * th, cols * tw, 4), dtype=np.float32)
    sheet[..., :3] = bg
    for k, t in enumerate(tiles):
        r, c = k // cols, k % cols
        y0 = (rows - 1 - r) * th          # Blender images are bottom-up
        x0 = c * tw
        h, w = t.shape[:2]
        alpha = t[..., 3:4]
        region = sheet[y0:y0 + h, x0:x0 + w, :3]
        sheet[y0:y0 + h, x0:x0 + w, :3] = t[..., :3] * alpha + region * (1 - alpha)
    img = bpy.data.images.new('sheet', cols * tw, rows * th, alpha=True)
    img.pixels = sheet.ravel()
    img.filepath_raw = out
    img.file_format = 'WEBP' if out.lower().endswith('.webp') else 'PNG'
    img.save()   # raw pixels, no view transform
    print('SHEET', out, os.path.getsize(out) // 1024, 'KB')


main()
