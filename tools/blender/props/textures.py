"""Process downloaded CC0 PBR sets into stylised 1024 px tiling WebP textures.

python -I tools/blender/props/textures.py <raw_dir> [set ...]
raw_dir/<set>/ holds color.jpg, normal.jpg and either arm.jpg (Poly Haven: AO, rough, metal)
or ao.jpg + rough.jpg (ambientCG). Output: public/assets/textures/<set>/{color,normal,orm}.webp

Stylisation: seamless downscale (wrap padding), detail simplification (blend towards a blurred
copy), softer contrast, saturation boost and a per-channel gain that moves the mean colour onto
the kit palette, flatter normals, slightly raised roughness.
"""
import os, sys, io
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'public', 'assets', 'textures'))
SIZE = 1024
PAD = 48
BUDGET = 400 * 1024

# target mean colour (sRGB), detail keep (0..1), contrast keep, saturation, normal strength, roughness offset
SETS = {
    'grass':   dict(mean='#5f9a3a', detail=0.55, contrast=0.75, sat=1.15, nrm=0.6, rough=0.05, rmin=0.8),
    'dirt':    dict(mean='#8f6d4c', detail=0.5, contrast=0.7, sat=1.1, nrm=0.6, rough=0.05, rmin=0.8),
    'asphalt': dict(mean='#5d6068', detail=0.8, contrast=0.85, sat=1.0, nrm=0.7, rough=0.0, rmin=0.7),
    'wood':    dict(mean='#9c7653', detail=0.6, contrast=0.75, sat=1.15, nrm=0.6, rough=0.05),
    'rock':    dict(mean='#9d978c', detail=0.55, contrast=0.75, sat=1.05, nrm=0.6, rough=0.05),
    'bark':    dict(mean='#6e4e37', detail=0.6, contrast=0.8, sat=1.1, nrm=0.7, rough=0.05, rmin=0.75),
    'planks':  dict(mean='#a87a4f', detail=0.6, contrast=0.8, sat=1.15, nrm=0.6, rough=0.05),
    'hay':     dict(mean='#d4ad58', detail=0.6, contrast=0.8, sat=1.3, nrm=0.6, rough=0.08, rmin=0.75),
}


def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def seamless_resize(img, size=SIZE):
    """Resize a tiling image without seams: wrap-pad, resize, crop."""
    a = np.asarray(img)
    h, w = a.shape[:2]
    p = int(PAD * w / size)
    a = np.pad(a, ((p, p), (p, p)) + ((0, 0),) * (a.ndim - 2), mode='wrap')
    im = Image.fromarray(a)
    s = size / w
    big = im.resize((int(round(a.shape[1] * s)), int(round(a.shape[0] * s))), Image.LANCZOS)
    q = int(round(p * s))
    return big.crop((q, q, q + size, q + size))


def wrap_blur(arr, radius):
    """Gaussian blur with wrap-around edges (keeps the tile seamless)."""
    h, w = arr.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (radius ** 2) * (fx ** 2 + fy ** 2))   # periodic = seamless
    out = np.empty_like(arr, dtype=np.float32)
    for c in range(arr.shape[2]):
        out[..., c] = np.real(np.fft.ifft2(np.fft.fft2(arr[..., c]) * g))
    return out


def to_f(img):
    return np.asarray(img, dtype=np.float32) / 255.0


def to_img(a):
    return Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8))


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def stylise_color(img, cfg):
    a = to_f(seamless_resize(img.convert('RGB')))
    # simplify fine detail: keep only part of the high frequencies
    blur = np.clip(wrap_blur(a * 255, 2.2) / 255.0, 0, 1)
    a = blur + (a - blur) * cfg['detail']
    # soften large-scale contrast around the mean
    m = a.reshape(-1, 3).mean(0)
    a = m + (a - m) * cfg['contrast']
    # move the mean onto the palette colour (gain in linear space keeps relative variation)
    lin = srgb_to_lin(np.clip(a, 0, 1))
    gain = srgb_to_lin(hex2rgb(cfg['mean'])) / np.maximum(1e-4, lin.reshape(-1, 3).mean(0))
    a = lin_to_srgb(lin * gain)
    # saturation
    g = (a * np.array([0.299, 0.587, 0.114])).sum(-1, keepdims=True)
    a = g + (a - g) * cfg['sat']
    return to_img(np.clip(a, 0, 1))


def stylise_normal(img, cfg):
    a = to_f(seamless_resize(img.convert('RGB')))
    n = a * 2 - 1
    blur = wrap_blur((n * 0.5 + 0.5) * 255, 1.2) / 255.0 * 2 - 1
    n = blur + (n - blur) * 0.6           # soften pixel-level noise
    n[..., :2] *= cfg['nrm']
    n /= np.maximum(1e-5, np.linalg.norm(n, axis=-1, keepdims=True))
    return to_img(n * 0.5 + 0.5)


def build_orm(d, cfg):
    if os.path.exists(os.path.join(d, 'arm.jpg')):
        arm = to_f(seamless_resize(Image.open(os.path.join(d, 'arm.jpg')).convert('RGB')))
        ao, rough = arm[..., 0], arm[..., 1]
    else:
        ao = to_f(seamless_resize(Image.open(os.path.join(d, 'ao.jpg')).convert('L')))
        rough = to_f(seamless_resize(Image.open(os.path.join(d, 'rough.jpg')).convert('L')))
    sm = wrap_blur(np.stack([ao, rough], -1), 1.6)     # stylised: no pixel-level noise in AO/roughness
    ao, rough = sm[..., 0], sm[..., 1]
    ao = 1.0 - (1.0 - ao) * 0.7                       # gentler occlusion
    rough = np.clip(rough * 0.8 + 0.2 + cfg['rough'], 0, 1)   # compress towards matte
    rmin = cfg.get('rmin', 0.0)
    rough = rmin + (1.0 - rmin) * rough if rmin else rough
    metal = np.zeros_like(ao)
    return to_img(np.stack([ao, rough, metal], -1))


def save_set(name, imgs):
    od = os.path.join(OUT, name)
    os.makedirs(od, exist_ok=True)
    for q in (82, 76, 70, 64, 58, 52):
        blobs = {}
        for k, im in imgs.items():
            b = io.BytesIO()
            qq = q if k == 'color' else max(40, q - 6)
            im.save(b, 'WEBP', quality=qq, method=6)
            blobs[k] = b.getvalue()
        total = sum(len(v) for v in blobs.values())
        if total <= BUDGET:
            break
    for k, v in blobs.items():
        open(os.path.join(od, k + '.webp'), 'wb').write(v)
    print('%-8s q=%d  %s  total %.0f KB' % (name, q, '  '.join('%s %.0f KB' % (k, len(v) / 1024) for k, v in blobs.items()), total / 1024))


def preview(out):
    """2x2 tiled colour (seam check) plus normal and ORM thumbnails for every set."""
    from PIL import ImageDraw
    names = list(SETS)
    T = 256
    sheet = Image.new('RGB', (T * 4, T * len(names)), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        od = os.path.join(OUT, n)
        c = Image.open(os.path.join(od, 'color.webp')).convert('RGB').resize((T, T))
        tile = Image.new('RGB', (2 * T, 2 * T))
        for x in (0, T):
            for y in (0, T):
                tile.paste(c, (x, y))
        sheet.paste(tile.resize((T * 2, T)), (0, i * T)) if False else sheet.paste(tile.crop((T // 2, T // 2, T // 2 + 2 * T, T // 2 + T)), (0, i * T))
        sheet.paste(Image.open(os.path.join(od, 'normal.webp')).convert('RGB').resize((T, T)), (2 * T, i * T))
        sheet.paste(Image.open(os.path.join(od, 'orm.webp')).convert('RGB').resize((T, T)), (3 * T, i * T))
        d.text((6, i * T + 6), n, fill=(255, 255, 255))
    sheet.save(out)


def main():
    if sys.argv[1] == '--preview':
        preview(sys.argv[2])
        return
    raw = sys.argv[1]
    names = sys.argv[2:] or list(SETS)
    for n in names:
        d = os.path.join(raw, n)
        cfg = SETS[n]
        imgs = {
            'color': stylise_color(Image.open(os.path.join(d, 'color.jpg')), cfg),
            'normal': stylise_normal(Image.open(os.path.join(d, 'normal.jpg')), cfg),
            'orm': build_orm(d, cfg),
        }
        save_set(n, imgs)


if __name__ == '__main__':
    main()
