# Shared character anatomy: body, arms on the wheel, legs, head, face parts.
# Pure numpy (no bpy) so it can be reasoned about and reused by every animal.
#
# Space: Blender character space, origin = seat point (driver root), Z up,
# front = -Y, +X = character's left.
import math
import numpy as np

import sdf
from sdf import v3, ellipsoid, round_cone, capsule, sphere, rot_euler, rot_to

# Steering wheel relative to the seat (must match common.SEAT / WHEEL_C).
WHEEL_REL = v3((0.0, -0.31, 0.36))
WHEEL_TILT = math.radians(-28)
WHEEL_R = 0.14
WHEEL_STEER_POSE = 0.75         # wheel rotation (rad) baked into the steer clips at full lock (= common.STEER_MAX)


def wheel_frame(steer=0.0):
    """Rotation of the steering wheel: local Z = column axis towards driver."""
    R_tilt = rot_euler(WHEEL_TILT + math.pi / 2, 0, 0)  # local Z points to the driver (+Y) and up
    R_spin = rot_euler(0, 0, steer)
    return R_tilt @ R_spin


def grip(side, steer=0.0):
    """Hand target on the rim. side=+1 left hand, -1 right hand."""
    a = math.radians(10) if side > 0 else math.radians(170)
    p = v3((math.cos(a) * WHEEL_R, math.sin(a) * WHEEL_R - 0.03, 0.02))
    return WHEEL_REL + wheel_frame(steer) @ p


def two_bone_ik(S, T, la, lb, pole):
    S, T, pole = v3(S), v3(T), v3(pole)
    d = np.linalg.norm(T - S)
    d = min(max(d, abs(la - lb) + 1e-3), la + lb - 1e-3)
    u = (T - S) / np.linalg.norm(T - S)
    x = (la * la - lb * lb + d * d) / (2 * d)
    h = math.sqrt(max(la * la - x * x, 0))
    p = pole - np.dot(pole, u) * u
    p /= np.linalg.norm(p)
    E = S + u * x + p * h
    W = S + u * d
    return E, W


class Spec:
    """Everything that describes one character, filled by the animal builders."""

    def __init__(self, cid):
        self.id = cid
        self.fur = []          # SDF prims of the furry skin (one mesh)
        self.paints = []       # (prim, colour, soft, amount) applied to the fur colour
        self.gloss = []        # glossy parts (eyes, nose): list of Part
        self.cloth = []        # accessories: SDF prim lists meshed separately
        self.cloth_paints = []
        self.joints = {}       # bone name -> (head, tail, parent)
        self.face = {}         # face frame for expressions
        self.fur_color = '#888888'
        self.sheen = (1, 1, 1)
        self.h = 0.0065        # SDF grid step for the fur mesh
        self.tris = 9000       # fur mesh triangle budget
        self.noise = 0.04      # fur colour noise amplitude
        self.ear_bones = []
        self.tail_bones = []
        self.arm_len = (0.2, 0.18)
        self.extra = {}
        self.skin = False      # smooth skin (axolotl) instead of fur


def bone(spec, name, head, tail, parent):
    spec.joints[name] = (v3(head), v3(tail), parent)


# ---------------------------------------------------------------- base body
def base_body(s, fur, belly=None, arm=None, hand=None, foot=None, head_c=(0, -0.03, 0.72), head_r=(0.33, 0.29, 0.29),
              body_scale=1.0, shoulder=(0.165, 0.0, 0.42), arm_r=0.058, hand_r=0.062, chest_belly=True, neck_k=0.07,
              head_bone='head', legs=True):
    """Pear-shaped seated body, stubby legs, arms reaching to the wheel, round head."""
    s.fur_color = fur
    arm = arm or fur
    hand = hand or arm
    foot = foot or arm
    bs = body_scale
    F = s.fur
    F.append(ellipsoid((0, 0.03, 0.14), (0.205 * bs, 0.19 * bs, 0.155), col=fur, bone='hips'))
    F.append(ellipsoid((0, 0.0, 0.27), (0.195 * bs, 0.175 * bs, 0.18), k=0.06, col=fur, bone='spine'))
    F.append(ellipsoid((0, 0.015, 0.40), (0.165 * bs, 0.145 * bs, 0.12), k=0.06, col=fur, bone='chest'))
    F.append(ellipsoid((0, 0.0, 0.50), (0.11, 0.1, 0.08), k=0.06, col=fur, bone='neck'))
    if belly:
        s.paints.append((ellipsoid((0, -0.13, 0.24), (0.14 * bs, 0.08, 0.2)), belly, 0.02, 1.0))
    # legs, sitting with knees forward
    if legs:
        for side, nm in ((1, 'thigh_l'), (-1, 'thigh_r')):
            a = (side * 0.1, -0.04, 0.12)
            b = (side * 0.12, -0.28, 0.14)
            F.append(round_cone(a, b, 0.08, 0.07, k=0.04, col=fur, bone=nm))
            F.append(ellipsoid((side * 0.125, -0.33, 0.12), (0.07, 0.085, 0.065), k=0.03, col=foot, bone=nm))
            bone(s, nm, a, (side * 0.12, -0.33, 0.13), 'hips')
    # head
    hc = v3(head_c)
    s.head_c, s.head_r = hc, v3(head_r)
    F.append(ellipsoid(hc, head_r, k=neck_k, col=fur, bone=head_bone))
    # arms to the wheel
    la, lb = s.arm_len
    for side, sfx in ((1, 'l'), (-1, 'r')):
        S = v3((side * shoulder[0], shoulder[1], shoulder[2]))
        T = grip(side)
        E, W = two_bone_ik(S, T, la, lb, v3((side * 1.0, 0.6, -0.9)))
        d = (W - E) / np.linalg.norm(W - E)
        F.append(round_cone(S, E, arm_r, arm_r * 0.92, k=0.05, col=arm, bone='upperarm_' + sfx))
        F.append(round_cone(E, W, arm_r * 0.92, arm_r * 0.85, k=0.02, col=arm, bone='forearm_' + sfx))
        hc_ = W + d * 0.025
        F.append(ellipsoid(hc_, (hand_r, hand_r * 0.95, hand_r * 0.85), rot=rot_to(d), k=0.025, col=hand, bone='hand_' + sfx))
        bone(s, 'upperarm_' + sfx, S, E, 'chest')
        bone(s, 'forearm_' + sfx, E, W, 'upperarm_' + sfx)
        bone(s, 'hand_' + sfx, W, W + d * 0.07, 'forearm_' + sfx)
        s.extra['shoulder_' + sfx] = S
    bone(s, 'root', (0, 0, 0), (0, 0, 0.08), None)
    bone(s, 'hips', (0, 0.03, 0.08), (0, 0.02, 0.22), 'root')
    bone(s, 'spine', (0, 0.02, 0.22), (0, 0.01, 0.34), 'hips')
    bone(s, 'chest', (0, 0.01, 0.34), (0, 0.0, 0.47), 'spine')
    bone(s, 'neck', (0, 0.0, 0.47), (0, -0.01, 0.53), 'chest')
    bone(s, 'head', (0, -0.01, 0.53), (0, -0.01, hc[2] + 0.3), 'neck')


# ---------------------------------------------------------------- surface helpers
def head_prims(s):
    return [p for p in s.fur if p.bone in ('head', None) or (p.bone or '').startswith('ear')]


def surf_point(prims, origin, direction, off=0.0):
    """Ray from inside `origin` along `direction` to the zero level set."""
    o = v3(origin)
    d = v3(direction) / np.linalg.norm(direction)
    lo, hi = 0.0, 1.0
    if sdf.eval_field(prims, o[None])[0] > 0:
        lo = 0.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if sdf.eval_field(prims, (o + d * mid)[None])[0] < 0:
            lo = mid
        else:
            hi = mid
    p = o + d * lo
    e = 1e-3
    g = np.array([sdf.eval_field(prims, (p + np.array(a) * e)[None])[0] - sdf.eval_field(prims, (p - np.array(a) * e)[None])[0]
                  for a in ((1, 0, 0), (0, 1, 0), (0, 0, 1))])
    n = g / np.linalg.norm(g)
    return p + n * off, n


def on_head(s, dirv, off=0.0, prims=None):
    return surf_point(prims or [p for p in s.fur if p.bone == 'head'], s.head_c, dirv, off)


def face_frame(n, up=(0, 0, 1)):
    """Columns: u (character's right->left = +X-ish), v (up), w (normal)."""
    w = v3(n) / np.linalg.norm(n)
    u = np.cross(v3(up), w)
    u /= np.linalg.norm(u)
    v = np.cross(w, u)
    return np.stack([-u, v, w], 1) if u[0] < 0 else np.stack([u, v, w], 1)


# ---------------------------------------------------------------- numpy part meshes (gloss / face)
class Part:
    """A small mesh made in numpy with optional shape keys (same topology)."""

    def __init__(self, V, Fc, col, bone='head', keys=None, mat='gloss'):
        self.V = v3(V)
        self.F = np.asarray(Fc, dtype=np.int64)
        self.col = col
        self.bone = bone
        self.keys = keys or {}
        self.mat = mat


def uv_sphere_np(seg=20, rings=12):
    V = []
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            V.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
    F = []
    for i in range(rings):
        for j in range(seg):
            a = i * seg + j
            b = i * seg + (j + 1) % seg
            c = (i + 1) * seg + (j + 1) % seg
            d = (i + 1) * seg + j
            if i == 0:
                F.append((d, c, a))
            elif i == rings - 1:
                F.append((d, b, a))
            else:
                F.append((d, c, b, a))
    # weld poles
    V = np.array(V)
    return V, F


def tri_faces(F):
    out = []
    for f in F:
        if len(f) == 3:
            out.append(f)
        else:
            out.append((f[0], f[1], f[2]))
            out.append((f[0], f[2], f[3]))
    return np.array(out, dtype=np.int64)


def ellipsoid_part(c, r, R=None, col='#111111', bone='head', seg=20, rings=12, mat='gloss'):
    V, F = uv_sphere_np(seg, rings)
    L = V * v3(r)
    if R is not None:
        L = L @ np.asarray(R).T
    return Part(L + v3(c), tri_faces(F), col, bone, mat=mat)


def tube_np(pts, radius, seg=8):
    pts = v3(pts)
    n = len(pts)
    rad = np.broadcast_to(np.asarray(radius, dtype=float), (n,))
    V = []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        a = np.cross(t, (0, 0, 1))
        if np.linalg.norm(a) < 1e-3:
            a = np.cross(t, (1, 0, 0))
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        for j in range(seg):
            ang = 2 * math.pi * j / seg
            V.append(pts[i] + rad[i] * (math.cos(ang) * a + math.sin(ang) * b))
    F = []
    for i in range(n - 1):
        for j in range(seg):
            a = i * seg + j
            b = i * seg + (j + 1) % seg
            F.append((a, b, b + seg))
            F.append((a, b + seg, a + seg))
    # caps
    V.append(pts[0]); c0 = len(V) - 1
    V.append(pts[-1]); c1 = len(V) - 1
    for j in range(seg):
        F.append((c0, (j + 1) % seg, j))
        F.append((c1, (n - 1) * seg + j, (n - 1) * seg + (j + 1) % seg))
    return np.array(V), np.array(F, dtype=np.int64)


def project_curve(s, prims, center, frame, uv, off, depth=0.08):
    """Project 2D face-plane points (u, v) onto the surface along the frame normal."""
    out = []
    for u, v in uv:
        p0 = center + frame[:, 0] * u + frame[:, 1] * v + frame[:, 2] * depth
        # march inward from outside
        lo, hi = 0.0, depth * 2.5
        for _ in range(36):
            mid = (lo + hi) / 2
            if sdf.eval_field(prims, (p0 - frame[:, 2] * mid)[None])[0] > 0:
                lo = mid
            else:
                hi = mid
        out.append(p0 - frame[:, 2] * (lo - off))
    return np.array(out)


def stroke_part(s, prims, center, frame, curves, radius, col, bone='head', off=0.004, seg=7):
    """A tube drawn on the face; `curves` = {'base': uv list, key: uv list} with equal lengths."""
    base = None
    keys = {}
    F = None
    for name, uv in curves.items():
        r = radius[name] if isinstance(radius, dict) else radius
        pts = project_curve(s, prims, center, frame, uv, off)
        rr = np.full(len(pts), r)
        rr[0] *= 0.7; rr[-1] *= 0.7
        V, Fc = tube_np(pts, rr, seg)
        if name == 'base':
            base, F = V, Fc
        else:
            keys[name] = V
    return Part(base, F, col, bone, keys)


def eye_parts(s, prims, dirv, size, side, col='#15100E', hi='#FFFFFF', tilt=0.0, iris=None, white=None):
    """Glossy cartoon eye with two highlights and morph shapes blink / happy / hurt."""
    p, n = surf_point(prims, s.head_c, dirv, 0)
    Fm = face_frame(n)
    R = Fm @ rot_euler(0, 0, side * tilt)
    su, sv, sw = size * 0.82, size, size * 0.42
    c = p - n * sw * 0.45
    Vs, Fs = uv_sphere_np(18, 11)
    L = Vs * v3((su, sv, sw))

    def to_world(Lc):
        return Lc @ R.T + c

    parts = []
    base = to_world(L)

    def stroke(Lc, kind):
        a = np.clip(Vs[:, 0], -1, 1)                    # along the stroke
        b = Vs[:, 1]
        cc = Vs[:, 2]
        th = size * 0.16
        out = np.zeros_like(Lc)
        if kind == 'blink':     # sleepy, bowing down
            out[:, 0] = a * su * 1.05
            out[:, 1] = sv * 0.05 - sv * 0.3 * (1 - a * a) + b * th * 0.5
        elif kind == 'happy':   # ^ ^
            out[:, 0] = a * su * 1.05
            out[:, 1] = -sv * 0.1 + sv * 0.45 * (1 - np.abs(a)) ** 1.2 + b * th * 0.5
        else:                    # hurt: > <
            out[:, 1] = a * sv * 0.62
            out[:, 0] = -side * (su * 0.55 * (1 - np.abs(a)) - su * 0.2) + b * th * 0.5
        out[:, 2] = sw * 0.62 + cc * th * 0.35
        return out

    keys = {k: to_world(stroke(L, k)) for k in ('blink', 'happy', 'hurt')}
    parts.append(Part(base, tri_faces(Fs), col, 'head', keys))
    # white eye ring for some characters
    if white:
        Lw = Vs * v3((su * 1.18, sv * 1.15, sw * 0.9))
        wb = to_world(Lw - np.array([0, 0, sw * 0.12]))
        wk = {k: to_world(stroke(Lw, k) * np.array([1, 1, 0.98]) - np.array([0, 0, sw * 0.2])) for k in ('blink', 'happy', 'hurt')}
        parts.append(Part(wb, tri_faces(Fs), white, 'head', wk))
    if iris:
        Li = Vs * v3((su * 0.62, sv * 0.62, sw * 0.4)) + np.array([0, -sv * 0.12, sw * 0.62])
        parts.append(Part(to_world(Li), tri_faces(Fs), iris, 'head', {k: to_world(np.tile(np.array([0, 0, sw * 0.2]), (len(Li), 1))) for k in keys}))
    # highlights
    for (hx, hy, hr) in ((0.32, 0.38, 0.33), (-0.3, -0.35, 0.16)):
        Lh = Vs * v3((su * hr, sv * hr * 0.9, sw * 0.3)) + np.array([su * hx, sv * hy, sw * 0.82])
        hk = {k: to_world(np.tile(np.array([su * hx, sv * hy * 0.2, sw * 0.4]), (len(Lh), 1))) for k in keys}
        parts.append(Part(to_world(Lh), tri_faces(Fs), hi, 'head', hk, mat='gloss'))
    return parts, p, n


def mouth_part(s, prims, dirv, width, col='#4A2A22', radius=0.0075, smile=0.35, kind='smile'):
    p, n = surf_point(prims, s.head_c, dirv, 0)
    Fm = face_frame(n)
    N = 13
    t = np.linspace(-1, 1, N)
    w = width

    def curve(fn):
        return [(w * ti, fn(ti)) for ti in t]

    if kind == 'cat':   # "w" mouth
        base = curve(lambda x: -w * smile * (1 - (2 * abs(x) - 1) ** 2) if True else 0)
    else:
        base = curve(lambda x: -w * smile * (1 - x * x))
    happy = curve(lambda x: -w * 0.75 * (1 - x * x) ** 0.8 + w * 0.05)
    hurt = [(w * 0.8 * ti, w * 0.12 * math.sin(ti * math.pi * 2.0) - w * 0.05) for ti in t]
    blink = base
    part = stroke_part(s, prims, p, Fm, {'base': base, 'happy': happy, 'hurt': hurt, 'blink': blink},
                       {'base': radius, 'happy': radius * 1.25, 'hurt': radius, 'blink': radius}, col)
    return part, p, n
