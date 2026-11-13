# Signed-distance-field modelling toolkit (numpy only, no bpy).
#
# Shapes are described as a list of primitives that are smoothly unioned (or
# subtracted). The field is sampled on a regular grid and meshed with surface
# nets. Every primitive also carries a colour and a bone name, so the same
# smooth blending that shapes the surface gives soft vertex colours and soft
# skinning weights.
import math
import numpy as np


# ---------------------------------------------------------------- math helpers
def v3(x):
    return np.asarray(x, dtype=np.float64)


def rot_euler(rx=0.0, ry=0.0, rz=0.0):
    """Rotation matrix (columns = local axes in world), XYZ euler like Blender."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def rot_to(direction, up=(0, 0, 1)):
    """Matrix whose local Z points along `direction`."""
    z = v3(direction) / np.linalg.norm(direction)
    u = v3(up)
    if abs(np.dot(z, u)) > 0.98:
        u = v3((0, 1, 0)) if abs(z[1]) < 0.9 else v3((1, 0, 0))
    x = np.cross(u, z); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def hexcol(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_lin(c):
    if isinstance(c, str):
        c = hexcol(c)
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------- primitives
class Prim:
    """One SDF primitive. `fn(P)` returns signed distance for points P (N,3)."""

    def __init__(self, fn, bmin, bmax, k=0.0, col=None, bone=None, op='add', tag=None, soft=None):
        self.fn = fn
        self.bmin = v3(bmin)
        self.bmax = v3(bmax)
        self.k = k            # smooth-blend radius against what is already there
        self.col = col        # sRGB tuple or None (= inherits from neighbours)
        self.bone = bone      # bone name for skinning
        self.op = op          # 'add' | 'sub'
        self.tag = tag
        self.soft = soft      # colour softness override


def _local(P, c, R):
    return (P - c) @ R if R is not None else (P - c)


def ellipsoid(c, r, rot=None, **kw):
    c, r = v3(c), v3(r)
    R = rot

    def fn(P):
        p = _local(P, c, R)
        k0 = np.linalg.norm(p / r, axis=1)
        k1 = np.linalg.norm(p / (r * r), axis=1)
        return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), -r.min())

    e = r.max()
    return Prim(fn, c - e, c + e, **kw)


def sphere(c, r, **kw):
    c = v3(c)

    def fn(P):
        return np.linalg.norm(P - c, axis=1) - r

    return Prim(fn, c - r, c + r, **kw)


def round_cone(a, b, r1, r2, **kw):
    """Capsule with radius r1 at a and r2 at b."""
    a, b = v3(a), v3(b)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2

    def fn(P):
        pa = P - a
        y = pa @ ba
        z = y - l2
        x = pa * l2 - y[:, None] * ba
        x2 = np.einsum('ij,ij->i', x, x)
        y2 = y * y * l2
        z2 = z * z * l2
        k = math.copysign(1.0, rr) * rr * rr * x2 if rr != 0 else np.zeros_like(x2)
        c1 = np.sign(z) * a2 * z2 > k
        c2 = np.sign(y) * a2 * y2 < k
        d1 = np.sqrt(x2 + z2) * il2 - r2
        d2 = np.sqrt(x2 + y2) * il2 - r1
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
        return np.where(c1, d1, np.where(c2, d2, d3))

    m = max(r1, r2)
    return Prim(fn, np.minimum(a, b) - m, np.maximum(a, b) + m, **kw)


def capsule(a, b, r, **kw):
    return round_cone(a, b, r, r * 0.999, **kw)


def rbox(c, half, r=0.02, rot=None, **kw):
    c, half = v3(c), v3(half)
    R = rot

    def fn(P):
        p = _local(P, c, R)
        q = np.abs(p) - (half - r)
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - r

    e = np.linalg.norm(half)
    return Prim(fn, c - e, c + e, **kw)


def torus(c, R_major, r_minor, rot=None, **kw):
    c = v3(c)

    def fn(P):
        p = _local(P, c, rot)
        q = np.sqrt(p[:, 0] ** 2 + p[:, 1] ** 2) - R_major
        return np.sqrt(q * q + p[:, 2] ** 2) - r_minor

    e = R_major + r_minor
    return Prim(fn, c - e, c + e, **kw)


def cyl(c, r, h, rot=None, rr=0.01, **kw):
    """Rounded cylinder, axis local Z, half height h."""
    c = v3(c)

    def fn(P):
        p = _local(P, c, rot)
        d = np.stack([np.sqrt(p[:, 0] ** 2 + p[:, 1] ** 2) - r + rr, np.abs(p[:, 2]) - h + rr], 1)
        return np.minimum(np.maximum(d[:, 0], d[:, 1]), 0) + np.linalg.norm(np.maximum(d, 0), axis=1) - rr

    e = math.hypot(r, h)
    return Prim(fn, c - e, c + e, **kw)


def chain(points, radii, **kw):
    """List of round cones following a polyline (tails, gills, ears)."""
    out = []
    for i in range(len(points) - 1):
        out.append(round_cone(points[i], points[i + 1], radii[i], radii[i + 1], **kw))
    return out


def deform(prim, fn_warp):
    """Wrap a primitive with a domain warp P -> P'."""
    inner = prim.fn
    prim.fn = lambda P: inner(fn_warp(P))
    return prim


# ---------------------------------------------------------------- field ops
def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def eval_field(prims, P):
    d = np.full(len(P), 1e3)
    for p in prims:
        di = p.fn(P)
        d = smin(d, di, p.k) if p.op == 'add' else smax(d, -di, p.k)
    return d


def sample_grid(prims, h, pad=0.04):
    bmin = np.min([p.bmin for p in prims if p.op == 'add'], 0) - pad
    bmax = np.max([p.bmax for p in prims if p.op == 'add'], 0) + pad
    n = np.ceil((bmax - bmin) / h).astype(int) + 1
    F = np.full(tuple(n), 1e3, dtype=np.float64)
    for p in prims:
        lo = np.clip(np.floor((p.bmin - p.k - bmin) / h).astype(int) - 1, 0, n - 1)
        hi = np.clip(np.ceil((p.bmax + p.k - bmin) / h).astype(int) + 2, 0, n)
        if np.any(hi <= lo):
            continue
        xs = bmin[0] + h * np.arange(lo[0], hi[0])
        ys = bmin[1] + h * np.arange(lo[1], hi[1])
        zs = bmin[2] + h * np.arange(lo[2], hi[2])
        X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        di = p.fn(P).reshape(X.shape)
        sub = F[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]]
        if p.op == 'add':
            F[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = smin(sub, di, p.k)
        else:
            F[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]] = smax(sub, -di, p.k)
    return F, bmin


def surface_nets(F, origin, h):
    """Quad mesh of the zero level set. Returns verts (N,3), quads (M,4)."""
    nx, ny, nz = F.shape
    inside = F < 0
    corners = np.array([(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)])
    cs = np.stack([inside[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i, j, k in corners], -1)
    cnt = cs.sum(-1)
    active = (cnt > 0) & (cnt < 8)
    ai = np.nonzero(active)
    nv = len(ai[0])
    idx = np.full(active.shape, -1, dtype=np.int64)
    idx[ai] = np.arange(nv)
    vals = np.stack([F[ai[0] + i, ai[1] + j, ai[2] + k] for i, j, k in corners], 1)
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    acc = np.zeros((nv, 3))
    n = np.zeros(nv)
    for a, b in edges:
        fa, fb = vals[:, a], vals[:, b]
        m = (fa < 0) != (fb < 0)
        t = fa[m] / (fa[m] - fb[m])
        acc[m] += corners[a] + t[:, None] * (corners[b] - corners[a])
        n[m] += 1
    verts = (np.stack(ai, 1) + acc / n[:, None]) * h + origin

    quads = []
    # edges along x
    e = inside[:-1, 1:-1, 1:-1] != inside[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(e); j = j + 1; k = k + 1
    q = np.stack([idx[i, j - 1, k - 1], idx[i, j, k - 1], idx[i, j, k], idx[i, j - 1, k]], 1)
    q[inside[i + 1, j, k]] = q[inside[i + 1, j, k]][:, ::-1]
    quads.append(q)
    # edges along y
    e = inside[1:-1, :-1, 1:-1] != inside[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(e); i = i + 1; k = k + 1
    q = np.stack([idx[i - 1, j, k - 1], idx[i - 1, j, k], idx[i, j, k], idx[i, j, k - 1]], 1)
    q[inside[i, j + 1, k]] = q[inside[i, j + 1, k]][:, ::-1]
    quads.append(q)
    # edges along z
    e = inside[1:-1, 1:-1, :-1] != inside[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(e); i = i + 1; j = j + 1
    q = np.stack([idx[i - 1, j - 1, k], idx[i, j - 1, k], idx[i, j, k], idx[i - 1, j, k]], 1)
    q[inside[i, j, k + 1]] = q[inside[i, j, k + 1]][:, ::-1]
    quads.append(q)
    quads = np.concatenate(quads, 0)
    quads = quads[(quads >= 0).all(1)]
    return verts, quads


def orient_quads(verts, quads, prims):
    """Make every quad face outward using the field gradient."""
    c = verts[quads].mean(1)
    nrm = np.cross(verts[quads[:, 2]] - verts[quads[:, 0]], verts[quads[:, 3]] - verts[quads[:, 1]])
    eps = 1e-3
    g = np.stack([eval_field(prims, c + np.array(d) * eps) - eval_field(prims, c - np.array(d) * eps)
                  for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], 1)
    flip = np.einsum('ij,ij->i', nrm, g) < 0
    quads[flip] = quads[flip][:, ::-1]
    return quads


def mesh_sdf(prims, h=0.008):
    F, origin = sample_grid(prims, h)
    verts, quads = surface_nets(F, origin, h)
    quads = orient_quads(verts, quads, prims)
    return verts, quads


# ---------------------------------------------------------------- attributes
def blend_attributes(prims, P, soft=0.012, bone_soft=0.03):
    """Per-vertex colour (linear) and bone weights from primitive proximity."""
    adds = [p for p in prims if p.op == 'add']
    D = np.stack([p.fn(P) for p in adds], 1)            # (N, K)
    D = np.maximum(D, 0.0)
    cols = []
    wts = []
    for i, p in enumerate(adds):
        if p.col is None:
            continue
        s = p.soft if p.soft is not None else soft
        w = np.exp(-D[:, i] / s)
        cols.append((w, srgb_to_lin(p.col)))
    W = np.stack([w for w, _ in cols], 1) + 1e-30
    C = np.stack([c for _, c in cols], 0)
    col = (W @ C) / W.sum(1, keepdims=True)

    bones = {}
    for i, p in enumerate(adds):
        if p.bone is None:
            continue
        w = np.exp(-D[:, i] / bone_soft)
        bones[p.bone] = np.maximum(bones.get(p.bone, 0), w)
    return col, bones


def paint(col, P, prim_or_fn, color, soft=0.01, amount=1.0):
    """Overlay a colour inside a paint volume (an SDF primitive) with a soft edge."""
    fn = prim_or_fn.fn if isinstance(prim_or_fn, Prim) else prim_or_fn
    d = fn(P)
    t = smoothstep(soft, -soft, d) * amount
    c = srgb_to_lin(color)
    return col * (1 - t[:, None]) + c[None, :] * t[:, None]


def sdf_ao(prims, P, N, steps=5, dist=0.06, strength=1.0):
    """Classic SDF ambient occlusion: how much the field closes in along the normal."""
    occ = np.zeros(len(P))
    w = 1.0
    for i in range(1, steps + 1):
        h = dist * i / steps
        d = eval_field(prims, P + N * h)
        occ += w * np.maximum(h - d, 0)
        w *= 0.6
    return np.clip(1.0 - strength * occ / dist * 1.6, 0.0, 1.0)


def value_noise3(P, scale, seed=0):
    """Cheap smooth 3D value noise in [-1, 1]."""
    rng = np.random.default_rng(seed)
    perm = rng.random(4096) * 2 - 1
    q = P * scale
    i0 = np.floor(q).astype(np.int64)
    f = q - i0
    f = f * f * (3 - 2 * f)

    def h(ix, iy, iz):
        return perm[(ix * 73856093 ^ iy * 19349663 ^ iz * 83492791) & 4095]

    res = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                res = res + w * h(i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz)
    return res
