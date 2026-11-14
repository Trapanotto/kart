# Halves a Radiance .hdr (box filter) and writes it RLE-coded: python shrink_hdr.py in.hdr out.hdr
# The HDRs only light the scene (the sky itself is procedural), so small files are enough.
import sys
import numpy as np

def read(path):
    d = open(path, 'rb').read()
    pos = d.index(b'\n\n') + 2
    end = d.index(b'\n', pos)
    t = d[pos:end].split()
    assert t[0] == b'-Y' and t[2] == b'+X', t
    h, w = int(t[1]), int(t[3])
    pos = end + 1
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        assert d[pos] == 2 and d[pos + 1] == 2, 'only RLE files'
        pos += 4
        for c in range(4):
            x = 0
            while x < w:
                n = d[pos]; pos += 1
                if n > 128:
                    n -= 128; out[y, x:x + n, c] = d[pos]; pos += 1
                else:
                    out[y, x:x + n, c] = np.frombuffer(d, np.uint8, n, pos); pos += n
                x += n
    return out

def to_float(rgbe):
    e = rgbe[..., 3].astype(np.int32)
    f = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return rgbe[..., :3].astype(np.float64) * f[..., None]

def to_rgbe(img):
    m = img.max(axis=2)
    e = np.where(m > 1e-32, np.floor(np.log2(np.maximum(m, 1e-32))) + 1, 0)
    s = np.where(m > 1e-32, np.ldexp(1.0, (8 - e).astype(np.int32)), 0.0)
    out = np.zeros(img.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(img * s[..., None], 0, 255).astype(np.uint8)
    out[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    return out

def write(path, rgbe):
    h, w = rgbe.shape[:2]
    b = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
    for y in range(h):
        b += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            row = rgbe[y, :, c].tobytes()
            x = 0
            while x < w:
                run = 1
                while x + run < w and run < 127 and row[x + run] == row[x]: run += 1
                if run >= 3:
                    b += bytes([128 + run, row[x]]); x += run
                else:
                    n = 1
                    while x + n < w and n < 128 and not (x + n + 2 < w and row[x + n] == row[x + n + 1] == row[x + n + 2]): n += 1
                    b += bytes([n]) + row[x:x + n]; x += n
    open(path, 'wb').write(b)

img = to_float(read(sys.argv[1]))
h, w = img.shape[:2]
small = img.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
write(sys.argv[2], to_rgbe(small))
back = to_float(read(sys.argv[2]))
print(sys.argv[2], back.shape, 'mean', img.mean().round(4), '->', back.mean().round(4), 'max', img.max().round(1), '->', back.max().round(1))
