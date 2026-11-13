"""Contact sheet of preview renders (system Python + Pillow).
python tools/blender/props/sheet.py <out.webp|png> <cols> name [name ...]
Labels each tile with name, triangle count and size from out/stats.json."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
out, cols, names = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
stats = json.load(open(os.path.join(HERE, 'out', 'stats.json')))
T = 360
rows = (len(names) + cols - 1) // cols
sheet = Image.new('RGB', (cols * T, rows * (T + 34)), (238, 234, 222))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('arial.ttf', 15)
    fontb = ImageFont.truetype('arialbd.ttf', 17)
except Exception:
    font = fontb = ImageFont.load_default()
for i, n in enumerate(names):
    x, y = (i % cols) * T, (i // cols) * (T + 34)
    src = os.path.join(HERE, 'previews', n + '.png')
    if not os.path.exists(src):
        src = src[:-4] + '.webp'
    if os.path.exists(src):
        sheet.paste(Image.open(src).convert('RGB').resize((T, T), Image.LANCZOS), (x, y))
    s = stats.get(n, {})
    d.text((x + 8, y + T + 2), n, fill=(40, 40, 40), font=fontb)
    if s:
        d.text((x + 8, y + T + 18), '%d tris  %.0f KB  %s m' % (s['tris'], s['bytes'] / 1024, ' x '.join('%g' % v for v in s['size_m'])),
               fill=(80, 80, 80), font=font)
kw = dict(quality=88, method=6) if out.endswith('.webp') else {}
sheet.save(out, **kw)
print('wrote', out, sheet.size)
