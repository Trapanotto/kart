"""
Trapanotto Kart - Modell-Generator fuer Blender (getestet mit Blender 5.2)

Erzeugt alle Fahrer (Tier + Kart) und Streckendeko als glTF (.glb).

Aufruf:
  blender -b -P tools/blender/build_models.py -- <ausgabeordner> [render] [tier ...]

  ausgabeordner : Zielordner, z. B. assets
  render        : zusaetzlich Portraits und Vorschaubilder rendern
  tier          : nur bestimmte Tiere bauen (z. B. sloth sheep)

Aufbau jedes Modells (Namen werden im Spiel animiert):
  Kart_<id>
    Steer_FL/FR > Wheel_FL/FR   Vorderraeder (lenken + drehen)
    Wheel_BL/BR                 Hinterraeder
    SteeringWheel               Lenkrad
    Exhaust_L/R                 Auspuff (Boost-Flammen)
    Driver                      Fahrer (wippen, neigen)
      Head > Eyes_Open / Eyes_Closed (Gesichtsausdruck)
      Arm_L / Arm_R             Arme (jubeln)
      Tail                      Schwanz (wackeln)
"""
import bpy, math, random, sys, os
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else '.')
DO_RENDER = 'render' in argv
ONLY = [a for a in argv[1:] if a != 'render']

# ---------------------------------------------------------------- Grundlagen
_mats = {}


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexcol(h):
    h = h.lstrip('#')
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def M(h, rough=0.6, metal=0.0, sheen=0.0, emit=0.0):
    key = (h, rough, metal, sheen, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new('M_%s_r%d%s%s' % (h.strip('#'), int(rough * 100),
                                                   '_fur' if sheen else '', '_glow' if emit else ''))
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')

    def s(n, v):
        if b is not None and n in b.inputs:
            try:
                b.inputs[n].default_value = v
            except Exception:
                pass
    s('Base Color', hexcol(h))
    s('Roughness', rough)
    s('Metallic', metal)
    if sheen:
        s('Sheen Weight', sheen)
        s('Sheen Roughness', 0.45)
    if emit:
        s('Emission Color', hexcol(h))
        s('Emission Strength', emit)
    m.diffuse_color = hexcol(h)
    _mats[key] = m
    return m


def FUR(h, sheen=0.45):
    return M(h, 0.85, sheen=sheen)


EYE = '#1A1420'


def _post(o, name, mat, parent, smooth=True):
    o.name = name
    if mat is not None and o.type in ('MESH', 'CURVE'):
        o.data.materials.clear()
        o.data.materials.append(mat)
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = smooth
    if parent is not None:
        o.parent = parent
    return o


def empty(name, loc=(0, 0, 0), parent=None, rot=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    o.empty_display_size = 0.1
    if parent is not None:
        o.parent = parent
    return o


LOWPOLY = [False]


def ell(name, loc, scale, mat, parent=None, rot=(0, 0, 0), seg=32, rings=16, smooth=True):
    if LOWPOLY[0]:
        seg, rings = min(seg, 12), min(rings, 7)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1,
                                         location=tuple(loc), rotation=tuple(rot))
    o = bpy.context.active_object
    o.scale = scale
    return _post(o, name, mat, parent, smooth)


def ico(name, loc, scale, mat, parent=None, sub=2, jitter=0.15, seed=1, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=tuple(loc), rotation=tuple(rot))
    o = bpy.context.active_object
    rnd = random.Random(seed)
    for v in o.data.vertices:
        v.co *= 1 + rnd.uniform(-jitter, jitter)
    o.scale = scale
    return _post(o, name, mat, parent, False)


def cone_dir(name, base, d, r1, r2, depth, mat, parent, verts=16, smooth=True, scale=(1, 1, 1)):
    d = Vector(d).normalized()
    base = Vector(base)
    rot = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth,
                                    location=tuple(base + d * depth / 2), rotation=tuple(rot))
    o = bpy.context.active_object
    o.scale = scale
    return _post(o, name, mat, parent, smooth)


def cyl(name, center, d, r, depth, mat, parent, verts=24, bevel=0.0, smooth=True, scale=(1, 1, 1)):
    d = Vector(d).normalized()
    rot = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth,
                                        location=tuple(center), rotation=tuple(rot))
    o = bpy.context.active_object
    o.scale = scale
    if bevel:
        m = o.modifiers.new('Bevel', 'BEVEL')
        m.width = bevel
        m.segments = 3
        m.limit_method = 'ANGLE'
        try:
            m.harden_normals = True
        except Exception:
            pass
    return _post(o, name, mat, parent, smooth)


def torus(name, loc, rot, R, r, mat, parent, seg=40, mseg=12):
    if LOWPOLY[0]:
        seg, mseg = min(seg, 12), min(mseg, 5)
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg,
                                     minor_segments=mseg, location=tuple(loc), rotation=tuple(rot))
    return _post(bpy.context.active_object, name, mat, parent, True)


def rbox(name, loc, dims, mat, parent, bevel=0.08, rot=(0, 0, 0), segs=4):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(loc), rotation=tuple(rot))
    o = bpy.context.active_object
    o.data.transform(Matrix.Diagonal((dims[0], dims[1], dims[2], 1)))
    m = o.modifiers.new('Bevel', 'BEVEL')
    m.width = min(bevel, min(dims) / 2 * 0.95)
    m.segments = segs
    m.limit_method = 'NONE'
    try:
        m.harden_normals = True
    except Exception:
        pass
    return _post(o, name, mat, parent, True)


def limb(name, p1, p2, r, mat, parent, flat=1.0, seg=20):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    rot = d.to_track_quat('Y', 'Z').to_euler()
    return ell(name, (p1 + p2) / 2, (r * flat, d.length / 2 + r * 0.35, r), mat, parent, rot, seg, 12)


def tube(name, pts, radius, mat, parent, taper=False):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (p[0], p[1], p[2], 1.0)
        if taper:
            sp.points[i].radius = 1.0 - 0.8 * i / (len(pts) - 1)
    sp.use_endpoint_u = True
    sp.order_u = 3
    sp.resolution_u = 6
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    cu.materials.append(mat)
    if parent is not None:
        o.parent = parent
    return o


def fib(n):
    g = math.pi * (3 - math.sqrt(5))
    out = []
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(max(0.0, 1 - z * z))
        out.append(Vector((math.cos(g * i) * r, math.sin(g * i) * r, z)))
    return out


def surf(d, sc, center=(0, 0, 0), off=0.0):
    """Punkt + Normale auf einem Ellipsoid (Halbachsen sc) in Richtung d."""
    d = Vector(d).normalized()
    a, b, c = sc
    t = 1.0 / math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2)
    p = d * t
    n = Vector((p.x / a / a, p.y / b / b, p.z / c / c)).normalized()
    return Vector(center) + p + n * off, n


def face_rot(n, roll=0.0):
    q = n.to_track_quat('-Y', 'Z')
    if roll:
        q = Quaternion(n, roll) @ q
    return q.to_euler()


# ---------------------------------------------------------------- Gesicht
def eye(name, p, n, size, parent, sclera=False, roll=0.0):
    rot = face_rot(n, roll)
    q = rot.to_quaternion()
    up, rt = q @ Vector((0, 0, 1)), q @ Vector((1, 0, 0))
    if sclera:
        ell(name + 'W', p, (0.095 * size, 0.04 * size, 0.115 * size), M('#FFFFFF', 0.25), parent, rot)
        p = p + n * 0.02 * size - up * 0.01 * size
        ell(name, p, (0.065 * size, 0.035 * size, 0.08 * size), M(EYE, 0.06), parent, rot)
    else:
        ell(name, p, (0.08 * size, 0.045 * size, 0.1 * size), M(EYE, 0.06), parent, rot)
    ell(name + 'H1', p + n * 0.035 * size + up * 0.04 * size - rt * 0.022 * size,
        (0.028 * size,) * 3, M('#FFFFFF', 0.1, emit=0.3), parent, seg=12, rings=8)
    ell(name + 'H2', p + n * 0.03 * size - up * 0.035 * size + rt * 0.03 * size,
        (0.014 * size,) * 3, M('#FFFFFF', 0.1, emit=0.3), parent, seg=10, rings=6)


def arc(name, sc, d0, w, h, parent, mat, center=(0, 0, 0), up=True, off=0.012, r=0.014, n=9):
    """Gebogene Linie auf der Oberflaeche: up=True -> Bogen (geschlossene Augen), False -> Laecheln."""
    pts = []
    for i in range(n):
        u = -1 + 2 * i / (n - 1)
        dz = h * (1 - u * u) if up else h * u * u
        p, _ = surf(Vector(d0) + Vector((u * w, 0, dz)), sc, center, off)
        pts.append(p)
    return tube(name, pts, r, mat, parent)


def cat_mouth(sc, d0, w, h, parent, mat, center=(0, 0, 0), off=0.012, r=0.013):
    """'w'-foermiger Tiermund aus zwei kleinen Boegen."""
    for s in (-1, 1):
        pts = []
        for i in range(7):
            u = i / 6
            x = d0[0] + s * u * w
            dz = -h * math.sin(u * math.pi)
            p, _ = surf((x, d0[1], d0[2] + dz), sc, center, off)
            pts.append(p)
        tube('Mouth', pts, r, mat, parent)


def blush(sc, dirs, parent, center=(0, 0, 0), size=1.0, col='#FF8FA3'):
    for d in dirs:
        p, n = surf(d, sc, center, -0.005)
        ell('Blush', p, (0.075 * size, 0.02, 0.05 * size), M(col, 0.7), parent, face_rot(n), 20, 10)


def std_eyes(H, EO, EC, sc, spread, z, size=1.0, sclera=False, center=(0, 0, 0), closed_col=EYE, off=0.0):
    for s in (1, -1):
        p, n = surf((s * spread, -1, z), sc, center, off)
        eye('Eye', p, n, size, EO, sclera)
        arc('Closed', sc, (s * spread, -1, z - 0.04), 0.13 * size, 0.08 * size, EC, M(closed_col, 0.4),
            center, True, off + 0.015, 0.016 * size)


def fluff(parent, sc, col, center=(0, 0, 0), n=160, filt=None, length=0.07, r=0.032, seed=1, droop=0.35, sheen=0.5):
    """Fellbueschel entlang der Oberflaeche -> flauschiger Umriss."""
    rnd = random.Random(seed)
    m = FUR(col, sheen)
    for d in fib(int(n * 1.5)):
        if filt is not None and not filt(d):
            continue
        p, nrm = surf(d, sc, center, 0.0)
        # Straehne liegt an: Richtung = entlang der Oberflaeche nach unten/hinten, leicht abstehend
        down = Vector((rnd.uniform(-0.2, 0.2), 0.25 + rnd.uniform(-0.1, 0.2), -1.0))
        tang = (down - nrm * down.dot(nrm))
        if tang.length < 1e-3:
            tang = Vector((0, 1, 0))
        dirv = (tang.normalized() + nrm * (0.75 - droop * 0.6)).normalized()
        L = length * rnd.uniform(0.8, 1.2)
        w = max(r * 1.3, L * 0.6)
        q = dirv.to_track_quat('Z', 'Y')
        # flache Seite zur Oberflaeche drehen
        side = q @ Vector((0, 1, 0))
        q = Quaternion(dirv, math.atan2(side.cross(nrm).dot(dirv), side.dot(nrm))) @ q
        ell('Fluff', p + dirv * L * 0.45 - nrm * w * 0.15, (w, w * 0.4, L), m, parent, q.to_euler(), 8, 5)


def not_face(d):
    return not (d.y < -0.45 and abs(d.x) < 0.72 and d.z > -0.75)


def body_ok(d):
    return d.z > -0.45


# ---------------------------------------------------------------- Kart
THEMES = {
    'sloth':    dict(main='#B5814A', accent='#6CC24A', trim='#F3E3C3', hub='#6CC24A'),
    'sheep':    dict(main='#7EC8F2', accent='#FFFFFF', trim='#FFD966', hub='#FFFFFF'),
    'redpanda': dict(main='#8CC63F', accent='#F2E2B8', trim='#C8552B', hub='#F2E2B8'),
    'hedgehog': dict(main='#7A4526', accent='#9BC53D', trim='#E3B072', hub='#E3B072'),
    'penguin':  dict(main='#9FD9F6', accent='#2C3350', trim='#FFFFFF', hub='#FFFFFF'),
    'capybara': dict(main='#F4F1EA', accent='#E9B949', trim='#7FCDE8', hub='#E9B949'),
    'otter':    dict(main='#46BFB8', accent='#F7B6C2', trim='#FFF1D6', hub='#F7B6C2'),
    'axolotl':  dict(main='#3FB0D9', accent='#FFD447', trim='#F7A8C6', hub='#FFD447'),
}


def build_kart(K, t):
    paint = M(t['main'], 0.3)
    acc = M(t['accent'], 0.4)
    trim = M(t['trim'], 0.4)
    dark = M('#2B2B33', 0.75)
    chrome = M('#D8DDE4', 0.2, 1.0)
    rbox('Chassis', (0, 0.05, 0.42), (1.12, 1.8, 0.34), paint, K, 0.15)
    rbox('Nose', (0, -0.85, 0.38), (0.86, 0.45, 0.26), paint, K, 0.12)
    rbox('Bumper', (0, -1.12, 0.27), (1.3, 0.18, 0.16), acc, K, 0.08)
    rbox('Floor', (0, 0.05, 0.22), (1.02, 2.0, 0.1), dark, K, 0.04)
    for s in (1, -1):
        rbox('Sidepod', (s * 0.62, 0.0, 0.38), (0.24, 0.62, 0.24), acc, K, 0.11)
        rbox('Stripe', (s * 0.565, -0.25, 0.5), (0.03, 0.9, 0.08), trim, K, 0.015)
    rbox('Seat', (0, 0.52, 0.74), (0.8, 0.18, 0.64), acc, K, 0.09, rot=(math.radians(-12), 0, 0))
    rbox('Spoiler', (0, 1.0, 1.0), (1.18, 0.26, 0.07), acc, K, 0.035)
    for s in (1, -1):
        rbox('Strut', (s * 0.38, 0.98, 0.78), (0.06, 0.1, 0.4), trim, K, 0.02)
        cyl('Pipe', (s * 0.3, 1.02, 0.42), (0, 1, 0), 0.075, 0.32, chrome, K, 20)
        cyl('PipeIn', (s * 0.3, 1.18, 0.42), (0, 1, 0), 0.05, 0.02, dark, K, 16)
        empty('Exhaust_' + ('L' if s > 0 else 'R'), (s * 0.3, 1.22, 0.42), K)
    # Emblem mit Pfote vorne
    cyl('Emblem', (0, -1.08, 0.46), (0, 1, 0), 0.14, 0.04, trim, K, 32)
    pawc = M(t['main'], 0.4)
    ell('Paw', (0, -1.11, 0.43), (0.05, 0.02, 0.04), pawc, K, seg=16, rings=8)
    for x, z in ((-0.05, 0.5), (-0.017, 0.52), (0.017, 0.52), (0.05, 0.5)):
        ell('Toe', (x, -1.105, z), (0.018, 0.015, 0.022), pawc, K, seg=12, rings=6)
    # Lenksaeule + Lenkrad
    limb('Column', (0, -0.62, 0.55), (0, -0.44, 0.86), 0.035, dark, K)
    axis = Vector((0, 1, 0.75)).normalized()
    SW = empty('SteeringWheel', (0, -0.43, 0.88), K, axis.to_track_quat('Z', 'Y').to_euler())
    torus('Rim', (0, 0, 0), (0, 0, 0), 0.19, 0.035, dark, SW, 32, 10)
    rbox('Spoke', (0, 0, 0), (0.36, 0.04, 0.025), dark, SW, 0.01)
    ell('Hub', (0, 0, 0.01), (0.06, 0.06, 0.03), acc, SW, seg=16, rings=8)
    # Raeder
    for nm, x, y, r, w, steer in (('FL', 0.72, -0.68, 0.28, 0.26, True), ('FR', -0.72, -0.68, 0.28, 0.26, True),
                                  ('BL', 0.74, 0.7, 0.34, 0.34, False), ('BR', -0.74, 0.7, 0.34, 0.34, False)):
        if steer:
            S = empty('Steer_' + nm, (x, y, r), K)
            W = empty('Wheel_' + nm, (0, 0, 0), S)
        else:
            W = empty('Wheel_' + nm, (x, y, r), K)
        sx = 1 if x > 0 else -1
        cyl('Tire', (0, 0, 0), (1, 0, 0), r, w, dark, W, 28, bevel=0.06)
        cyl('Rimw', (sx * 0.01, 0, 0), (1, 0, 0), r * 0.58, w + 0.02, M(t['hub'], 0.35), W, 20, bevel=0.02)
        ell('Cap', (sx * (w / 2 + 0.01), 0, 0), (0.03, r * 0.25, r * 0.25), chrome, W, seg=16, rings=8)
        for k in range(5):  # Profil
            a = k / 5 * math.tau
            rbox('Tread', (0, math.cos(a) * r * 0.97, math.sin(a) * r * 0.97), (w * 0.9, 0.06, 0.05), dark, W, 0.02,
                 rot=(a, 0, 0))


# ---------------------------------------------------------------- Fahrer-Basis
def base_driver(K, body_col, body_sc=(0.4, 0.36, 0.42), belly=None, arm_col=None, hand_col=None, arm_r=0.075,
                arm_flat=1.0, hands=True):
    D = empty('Driver', (0, 0.25, 0.55), K)
    ell('Body', (0, 0, 0.32), body_sc, FUR(body_col), D)
    if belly:
        ell('Belly', (0, -body_sc[1] * 0.5, 0.28), (body_sc[0] * 0.7, body_sc[1] * 0.55, body_sc[2] * 0.75),
            FUR(belly), D)
    H = empty('Head', (0, -0.05, 0.98), D)
    arms = []
    for s, nm in ((1, 'L'), (-1, 'R')):
        sh = Vector((s * 0.3, -0.1, 0.5))
        grip = Vector((s * 0.18, -0.65, 0.37))
        A = empty('Arm_' + nm, sh, D)
        v = grip - sh
        limb('ArmM', (0, 0, 0), v, arm_r, FUR(arm_col or body_col), A, flat=arm_flat)
        if hands:
            ell('Hand', v, (0.085, 0.085, 0.08), FUR(hand_col or arm_col or body_col), A)
        arms.append((A, v, s))
    EO = empty('Eyes_Open', (0, 0, 0), H)
    EC = empty('Eyes_Closed', (0, 0, 0), H)
    return D, H, EO, EC, arms


def tail_chain(T, pts_r, mats):
    for i, (p, r) in enumerate(pts_r):
        ell('TailSeg', p, (r, r, r * 1.05), mats[i % len(mats)], T, seg=20, rings=12)


# ---------------------------------------------------------------- Tiere
def sloth(K):
    fur = '#8C6B4F'
    D, H, EO, EC, arms = base_driver(K, fur, belly='#B8946F')
    hs = (0.44, 0.4, 0.4)
    ell('HeadM', (0, 0, 0), hs, FUR(fur), H)
    mc, ms = Vector((0, -0.16, -0.03)), (0.36, 0.26, 0.29)
    ell('Mask', mc, ms, FUR('#EBDABE', 0.3), H)
    for s in (1, -1):
        p, n = surf((s * 0.47, -1, 0.1), ms, mc, -0.01)
        ell('Patch', p, (0.085, 0.03, 0.16), M('#3E2B20', 0.7), H, face_rot(n, -s * 0.4))
        pe, ne = surf((s * 0.46, -1, 0.17), ms, mc, 0.018)
        eye('Eye', pe, ne, 0.78, EO)
        arc('Closed', ms, (s * 0.43, -1, 0.13), 0.12, 0.07, EC, M('#EBDABE', 0.4), mc, True, 0.035, 0.014)
    p, n = surf((0, -1, -0.12), ms, mc)
    ell('Nose', p, (0.075, 0.04, 0.05), M('#2B1D16', 0.25), H, face_rot(n))
    arc('Mouth', ms, (0, -1, -0.45), 0.16, 0.1, H, M('#5A3428', 0.5), mc, False, 0.008, 0.015)
    blush(ms, [(0.7, -1, -0.15), (-0.7, -1, -0.15)], H, mc, 0.9)
    for i, (x, rz) in enumerate(((-0.05, 0.4), (0.02, -0.2), (0.08, -0.6))):
        ell('Tuft', (x, 0.02, 0.4), (0.04, 0.05, 0.1), FUR('#6E523C'), H, rot=(0.3, rz, 0))
    ell('Leaf', (0.16, 0.06, 0.4), (0.15, 0.07, 0.025), M('#6CC24A', 0.45), H, rot=(0.2, -0.35, 0.7))
    limb('LeafVein', (0.07, 0.0, 0.42), (0.25, 0.13, 0.38), 0.008, M('#4E9A35', 0.5), H)
    for A, v, s in arms:
        for k in (-1, 0, 1):
            cone_dir('Claw', v + Vector((k * 0.035, -0.04, 0.03)), (k * 0.25, -0.6, -0.8), 0.022, 0.003, 0.13,
                     M('#EFE3C8', 0.45), A, 10)
    fluff(H, hs, fur, n=260, filt=not_face, length=0.1, r=0.035, droop=0.6, seed=1)
    fluff(D, (0.4, 0.36, 0.42), fur, (0, 0, 0.32), 200, body_ok, 0.1, 0.038, 2, 0.7)
    T = empty('Tail', (0, 0.32, 0.12), D)
    ell('TailStub', (0, 0.03, 0), (0.09, 0.08, 0.08), FUR(fur), T)


def sheep(K):
    face = '#4B4452'
    wool = M('#FFF9F0', 0.95, sheen=0.7)
    D, H, EO, EC, arms = base_driver(K, '#FFF9F0', arm_col=face, arm_r=0.065)
    rnd = random.Random(3)
    for d in fib(64):
        if d.z < -0.75:
            continue
        p, n = surf(d, (0.4, 0.36, 0.42), (0, 0, 0.32))
        r = rnd.uniform(0.12, 0.16)
        ell('Wool', p, (r, r, r * 0.95), wool, D, seg=18, rings=10)
    hs = (0.32, 0.33, 0.4)
    ell('HeadM', (0, 0, 0), hs, FUR(face, 0.3), H)
    for d in fib(90):
        if d.z > 0.42 or (d.y > 0.15 and d.z > -0.5) or (abs(d.x) > 0.8 and d.z > 0.1 and d.y > -0.3):
            p, n = surf(d, hs)
            r = rnd.uniform(0.09, 0.125)
            ell('Wool', p, (r, r, r), wool, H, seg=18, rings=10)
    for s in (1, -1):
        ell('Ear', (s * 0.36, 0.02, 0.1), (0.17, 0.06, 0.075), FUR(face, 0.3), H, rot=(0, s * 0.4, 0))
        ell('EarIn', (s * 0.38, -0.035, 0.095), (0.12, 0.02, 0.045), M('#F2A7B5', 0.6), H, rot=(0, s * 0.4, 0))
    std_eyes(H, EO, EC, hs, 0.36, 0.12, 0.95, sclera=True, closed_col='#F5EDE6')
    p, n = surf((0, -1, -0.27), hs)
    ell('Nose', p, (0.065, 0.03, 0.04), M('#F09AB0', 0.4), H, face_rot(n))
    cat_mouth(hs, (0, -1, -0.37), 0.1, 0.05, H, M('#F0D2DA', 0.5))
    blush(hs, [(0.6, -1, -0.12), (-0.6, -1, -0.12)], H, size=0.8)
    for A, v, s in arms:  # Wollbuendchen
        ell('Cuff', v * 0.75, (0.1, 0.1, 0.1), wool, A, seg=18, rings=10)
    T = empty('Tail', (0, 0.36, 0.18), D)
    ell('TailWool', (0, 0.04, 0), (0.1, 0.1, 0.1), wool, T)


def redpanda(K):
    fur, white, dark = '#C8552B', '#FFF6EC', '#3B2219'
    D, H, EO, EC, arms = base_driver(K, fur, belly='#5A2E1F', arm_col=dark)
    hs = (0.46, 0.39, 0.38)
    ell('HeadM', (0, 0, 0), hs, FUR(fur), H)
    mc, ms = Vector((0, -0.3, -0.12)), (0.2, 0.14, 0.13)
    ell('Muzzle', mc, ms, FUR(white, 0.3), H)
    ell('Nose', (0, -0.43, -0.07), (0.065, 0.04, 0.042), M('#1E1412', 0.2), H)
    cat_mouth(ms, (0, -1, -0.15), 0.25, 0.25, H, M('#5A2E1F', 0.5), mc)
    for s in (1, -1):
        p, n = surf((s * 0.62, -0.8, -0.18), hs, off=-0.01)
        ell('Cheek', p, (0.15, 0.06, 0.13), FUR(white, 0.3), H, face_rot(n))
        p, n = surf((s * 0.3, -1, 0.45), hs)
        ell('Brow', p, (0.065, 0.03, 0.045), FUR(white, 0.3), H, face_rot(n))
        p, n = surf((s * 0.3, -1, -0.12), hs)
        ell('Tear', p, (0.045, 0.03, 0.1), M('#8E3A1C', 0.7), H, face_rot(n, s * 0.3))
        base, en = surf((s * 0.55, 0.05, 0.78), hs, off=-0.05)
        ed = Vector((s * 0.5, 0.05, 1)).normalized()
        ell('Ear', base + ed * 0.13, (0.14, 0.06, 0.17), FUR(white, 0.4), H, ed.to_track_quat('Z', 'Y').to_euler())
        ell('EarIn', base + ed * 0.13 + Vector((0, -0.035, 0)), (0.1, 0.04, 0.13), M(dark, 0.7), H, ed.to_track_quat('Z', 'Y').to_euler())
    std_eyes(H, EO, EC, hs, 0.33, 0.13, 0.95)
    blush(hs, [(0.5, -1, -0.02), (-0.5, -1, -0.02)], H, size=0.7)
    fluff(H, hs, white, n=220, filt=lambda d: abs(d.x) > 0.7 and d.z < 0.15 and d.y < 0.3, length=0.1, r=0.04, droop=0.5, seed=3)
    fluff(H, hs, fur, n=220, filt=lambda d: not_face(d) and not (abs(d.x) > 0.7 and d.z < 0.15), length=0.07, droop=0.4, seed=4)
    fluff(D, (0.4, 0.36, 0.42), fur, (0, 0, 0.32), 160, lambda d: body_ok(d) and d.y > -0.5, 0.08, 0.036, 5, 0.6)
    T = empty('Tail', (0, 0.36, 0.08), D)
    pts = []
    for i in range(11):
        t = i / 10
        pts.append(((0.16 * math.sin(t * 2.6), 0.05 + 0.32 * t, 0.85 * t ** 1.3), 0.15 * (1 - 0.3 * t) + 0.02))
    tail_chain(T, pts, [FUR(fur), FUR(fur), FUR('#7E3218'), FUR('#7E3218')])


def hedgehog(K):
    face = '#E7C79F'
    spike = M('#6B4A35', 0.7)
    spike2 = M('#8A6446', 0.7)
    D, H, EO, EC, arms = base_driver(K, face, arm_col='#B9906A')
    rnd = random.Random(5)
    for i, d in enumerate(fib(110)):
        if d.y > -0.35 and d.z > -0.55:
            p, n = surf(d, (0.4, 0.36, 0.42), (0, 0, 0.32), -0.02)
            dirv = (n + Vector((0, 0.7, 0.25))).normalized()
            cone_dir('Spike', p, dirv, 0.06, 0.004, rnd.uniform(0.2, 0.26), spike if i % 3 else spike2, D, 8, False)
    hs = (0.4, 0.38, 0.37)
    ell('HeadM', (0, 0, 0), hs, FUR(face, 0.3), H)
    for i, d in enumerate(fib(150)):
        if (d.y > -0.25 and d.z > -0.35) or (d.z > 0.55 and d.y > -0.75):
            p, n = surf(d, hs, off=-0.02)
            dirv = (n + Vector((0, 0.9, 0.3))).normalized()
            cone_dir('Spike', p, dirv, 0.055, 0.004, rnd.uniform(0.18, 0.25), spike if i % 3 else spike2, H, 8, False)
    sc, scs = Vector((0, -0.36, -0.09)), (0.16, 0.17, 0.13)
    ell('Snout', sc, scs, FUR(face, 0.3), H, rot=(0.15, 0, 0))
    ell('Nose', (0, -0.53, -0.05), (0.065, 0.055, 0.055), M('#1A1414', 0.15), H)
    ell('NoseH', (0.02, -0.575, -0.025), (0.016, 0.01, 0.012), M('#FFFFFF', 0.1, emit=0.3), H, seg=10, rings=6)
    cat_mouth(scs, (0, -1, -0.35), 0.25, 0.25, H, M('#7A4A3A', 0.5), sc)
    for s in (1, -1):
        p, n = surf((s * 0.75, -0.25, 0.55), hs, off=-0.02)
        ell('Ear', p, (0.085, 0.045, 0.085), FUR(face, 0.3), H, face_rot(n))
        ell('EarIn', p + n * 0.02, (0.055, 0.02, 0.055), M('#F2A7B5', 0.6), H, face_rot(n))
    std_eyes(H, EO, EC, hs, 0.38, 0.14, 0.9)
    blush(hs, [(0.62, -1, -0.12), (-0.62, -1, -0.12)], H, size=0.8)
    fluff(H, hs, face, n=200, filt=lambda d: d.y < 0.1 and d.z < 0.3 and abs(d.x) > 0.55, length=0.08, r=0.035, droop=0.5, seed=6)
    fluff(D, (0.4, 0.36, 0.42), face, (0, 0, 0.32), 140, lambda d: d.y < -0.4 and d.z > -0.3, 0.07, 0.035, 7, 0.6)
    T = empty('Tail', (0, 0.35, 0.1), D)
    ell('TailStub', (0, 0, 0), (0.06, 0.06, 0.06), FUR(face, 0.3), T)


def penguin(K):
    dark, white = '#2C3350', '#FFFFFF'
    D, H, EO, EC, arms = base_driver(K, dark, belly=white, arm_r=0.08, arm_flat=0.45, hands=False)
    hs = (0.42, 0.4, 0.4)
    ell('HeadM', (0, 0, 0), hs, M(dark, 0.45, sheen=0.2), H)
    fsc = (0.2, 0.2, 0.25)
    for s in (1, -1):
        fc = Vector((s * 0.13, -0.24, 0.0))
        ell('Face', fc, fsc, M(white, 0.45, sheen=0.2), H)
        p, n = surf((s * 0.25, -1, 0.15), fsc, fc)
        eye('Eye', p, n, 0.9, EO)
        arc('Closed', fsc, (s * 0.25, -1, 0.1), 0.35, 0.18, EC, M(EYE, 0.4), fc, True, 0.015, 0.016)
    cone_dir('Beak', (0, -0.41, -0.07), (0, -1, -0.15), 0.085, 0.01, 0.17, M('#F7A531', 0.35), H, 24,
             scale=(1, 1, 0.7))
    blush(hs, [(0.6, -1, -0.2), (-0.6, -1, -0.2)], H, size=0.85)
    for i, (x, rz) in enumerate(((-0.04, 0.35), (0.0, 0), (0.04, -0.35))):
        ell('Tuft', (x, 0.0, 0.42), (0.03, 0.035, 0.09), M(dark, 0.5), H, rot=(0.2, rz, 0))
    fluff(H, hs, dark, n=160, filt=lambda d: d.z > 0.55, length=0.08, r=0.035, droop=0.0, seed=8, sheen=0.3)
    # Schal
    torus('Scarf', (0, -0.02, 0.72), (0.12, 0, 0), 0.27, 0.075, M('#E8434F', 0.8, sheen=0.4), D, 40, 12)
    for k in range(6):
        a = k / 6 * math.tau
        torus('ScarfStripe', (0, -0.02, 0.72), (0.12, 0, a), 0.27, 0.078, M('#FFFFFF', 0.8), D, 40, 12) if False else None
    rbox('ScarfEnd', (0.16, -0.3, 0.55), (0.12, 0.05, 0.28), M('#E8434F', 0.8, sheen=0.4), D, 0.03,
         rot=(0.2, 0, -0.25))
    rbox('ScarfFringe', (0.19, -0.33, 0.4), (0.12, 0.05, 0.04), M('#FFFFFF', 0.8), D, 0.02, rot=(0.2, 0, -0.25))
    for s in (1, -1):
        ell('Foot', (s * 0.15, -0.32, -0.02), (0.1, 0.14, 0.04), M('#F7A531', 0.4), D)
    T = empty('Tail', (0, 0.33, 0.05), D)
    cone_dir('TailTip', (0, 0, 0), (0, 1, -0.3), 0.1, 0.02, 0.14, M(dark, 0.5), T, 16, scale=(1, 1, 0.5))


def capybara(K):
    fur = '#A0724B'
    D, H, EO, EC, arms = base_driver(K, fur, body_sc=(0.45, 0.4, 0.44), belly='#B78A62')
    hs = (0.37, 0.44, 0.35)
    ell('HeadM', (0, -0.04, 0), hs, FUR(fur), H)
    mc, ms = Vector((0, -0.36, -0.07)), (0.29, 0.19, 0.23)
    ell('Muzzle', mc, ms, FUR('#8A5E3D'), H)
    ell('NosePad', (0, -0.53, 0.02), (0.13, 0.04, 0.07), M('#3A2A20', 0.35), H)
    for s in (1, -1):
        ell('Nostril', (s * 0.05, -0.565, 0.035), (0.025, 0.012, 0.018), M('#140D0A', 0.4), H, seg=12, rings=6)
    arc('Mouth', ms, (0, -1, -0.15), 0.18, 0.1, H, M('#3A2A20', 0.5), mc, False, 0.008, 0.012)
    for s in (1, -1):
        p, n = surf((s * 0.62, -0.72, 0.42), hs, (0, -0.04, 0))
        eye('Eye', p, n, 0.7, EO)
        arc('Closed', hs, (s * 0.62, -0.72, 0.36), 0.14, 0.05, EC, M(EYE, 0.4), (0, -0.04, 0), False, 0.012, 0.013)
        p, n = surf((s * 0.55, 0.3, 0.75), hs, (0, -0.04, 0), -0.01)
        ell('Ear', p, (0.075, 0.04, 0.065), FUR('#7D5638'), H, face_rot(-n))
    blush(hs, [(0.8, -0.8, 0.05), (-0.8, -0.8, 0.05)], H, (0, -0.04, 0), 0.8)
    fluff(H, hs, fur, (0, -0.04, 0), 220, lambda d: d.y > -0.35, 0.06, 0.03, 10, 0.4)
    fluff(D, (0.45, 0.4, 0.44), fur, (0, 0, 0.32), 180, body_ok, 0.07, 0.035, 11, 0.6)
    # Yuzu auf dem Kopf
    ell('Yuzu', (0, 0.02, 0.44), (0.13, 0.13, 0.115), M('#FFA62B', 0.45), H)
    cyl('Stem', (0, 0.02, 0.57), (0, 0, 1), 0.012, 0.05, M('#5B7A2E', 0.6), H, 8)
    ell('YLeaf', (0.06, 0.02, 0.58), (0.07, 0.025, 0.012), M('#5DBB46', 0.45), H, rot=(0, -0.4, 0.3))
    T = empty('Tail', (0, 0.38, 0.1), D)
    ell('Rump', (0, 0.02, 0), (0.08, 0.06, 0.06), FUR(fur), T)


def otter(K):
    fur, cream = '#7A5034', '#EAD5B5'
    D, H, EO, EC, arms = base_driver(K, fur, belly=cream)
    hs = (0.42, 0.38, 0.37)
    ell('HeadM', (0, 0, 0), hs, FUR(fur), H)
    mc, ms = Vector((0, -0.26, -0.11)), (0.25, 0.17, 0.15)
    ell('Muzzle', mc, ms, FUR(cream, 0.3), H)
    ell('Chin', (0, -0.22, -0.22), (0.16, 0.12, 0.08), FUR(cream, 0.3), H)
    ell('Nose', (0, -0.41, -0.05), (0.085, 0.045, 0.05), M('#2A1C14', 0.2), H)
    cat_mouth(ms, (0, -1, -0.05), 0.22, 0.25, H, M('#5A3A28', 0.5), mc)
    for s in (1, -1):
        for k in range(3):
            o = Vector((s * 0.19, -0.37, -0.09 + k * 0.03))
            limb('Whisker', o, o + Vector((s * 0.26, 0.06, 0.05 * (1 - k))), 0.006, M('#FFF7EA', 0.4), H, seg=8)
        p, n = surf((s * 0.82, 0.0, 0.45), hs, off=-0.02)
        ell('Ear', p, (0.075, 0.045, 0.07), FUR(fur), H, face_rot(n))
        ell('EarIn', p + n * 0.015, (0.045, 0.02, 0.04), M('#5A3A28', 0.7), H, face_rot(n))
        p, n = surf((s * 0.3, -1, 0.38), hs)
        ell('Brow', p, (0.06, 0.025, 0.035), FUR(cream, 0.3), H, face_rot(n))
    std_eyes(H, EO, EC, hs, 0.36, 0.13, 0.92)
    blush(hs, [(0.62, -1, -0.12), (-0.62, -1, -0.12)], H, size=0.8)
    fluff(H, hs, fur, n=230, filt=not_face, length=0.065, r=0.032, droop=0.45, seed=12)
    fluff(H, ms, cream, mc, 120, lambda d: abs(d.x) > 0.6 and d.y < 0.2, 0.07, 0.03, 13, 0.5)
    fluff(D, (0.4, 0.36, 0.42), fur, (0, 0, 0.32), 180, lambda d: body_ok(d) and d.y > -0.5, 0.07, 0.035, 14, 0.6)
    T = empty('Tail', (0, 0.36, 0.05), D)
    pts = []
    for i in range(9):
        t = i / 8
        pts.append(((0.05 * math.sin(t * 3), 0.05 + 0.5 * t, 0.12 * math.sin(t * 2.2)), 0.11 * (1 - 0.65 * t) + 0.02))
    tail_chain(T, pts, [FUR(fur)])
    # Muschel in der Hand? -> kleiner Seestern auf dem Kopf
    for k in range(5):
        a = k / 5 * math.tau
        limb('Star', (0.12, 0.05, 0.37), (0.12 + 0.08 * math.cos(a), 0.05 + 0.08 * math.sin(a), 0.38), 0.028,
             M('#FF8A5B', 0.5), H, flat=1.0, seg=12)


def axolotl(K):
    pink, belly, gill = '#F7A8C6', '#FCD6E3', '#E54F8B'
    D, H, EO, EC, arms = base_driver(K, pink, belly=belly)
    hs = (0.5, 0.38, 0.35)
    ell('HeadM', (0, 0, 0), hs, M(pink, 0.35, sheen=0.2), H)
    for s in (1, -1):
        p, n = surf((s * 0.62, -1, 0.15), hs)
        eye('Eye', p, n, 0.62, EO)
        arc('Closed', hs, (s * 0.62, -1, 0.1), 0.1, 0.06, EC, M(EYE, 0.4), up=True, off=0.015, r=0.013)
        for k, (dy, dz) in enumerate(((-0.05, 0.45), (0.1, 0.1), (0.2, -0.25))):
            base, n = surf((s, dy, dz), hs, off=-0.03)
            tip = base + Vector((s * 0.28, 0.12 + k * 0.03, 0.18 - k * 0.12))
            limb('Gill', base, tip, 0.035, M(gill, 0.5), H, seg=14)
            for j in range(4):
                t = 0.3 + j * 0.2
                q = base.lerp(tip, t)
                ell('Fringe', q + Vector((0, 0.02, 0.04)), (0.03, 0.025, 0.05), M('#FF7BAC', 0.5), H,
                    rot=(0.4, s * 0.4, 0), seg=12, rings=8)
                ell('Fringe', q + Vector((0, 0.02, -0.04)), (0.03, 0.025, 0.045), M('#FF7BAC', 0.5), H,
                    rot=(-0.4, s * 0.4, 0), seg=12, rings=8)
    arc('Mouth', hs, (0, -1, -0.16), 0.32, 0.13, H, M('#B9466F', 0.4), up=False, off=0.008, r=0.014)
    blush(hs, [(0.58, -1, -0.1), (-0.58, -1, -0.1)], H, size=0.85, col='#FF7BA0')
    rnd = random.Random(7)
    for d in fib(30):
        if d.z > 0.45:
            p, n = surf(d, hs, off=-0.004)
            r = rnd.uniform(0.02, 0.035)
            ell('Spot', p, (r, r, r * 0.4), M('#E58BAE', 0.5), H, face_rot(n) if False else n.to_track_quat('Z', 'Y').to_euler(), 12, 6)
    T = empty('Tail', (0, 0.35, 0.1), D)
    ell('TailM', (0, 0.18, 0.02), (0.09, 0.26, 0.11), M(pink, 0.35, sheen=0.2), T, rot=(0.2, 0, 0))
    ell('Fin', (0, 0.25, 0.12), (0.025, 0.28, 0.13), M('#FCC4D8', 0.4), T, rot=(0.25, 0, 0))


ANIMALS = {'sloth': sloth, 'sheep': sheep, 'redpanda': redpanda, 'hedgehog': hedgehog,
           'penguin': penguin, 'capybara': capybara, 'otter': otter, 'axolotl': axolotl}


def kart_extras(K, aid, t):
    if aid == 'sloth':
        vine = M('#4E9A35', 0.6)
        leaf = M('#6CC24A', 0.45)
        for s in (1, -1):
            pts = [(s * 0.58, -0.6 + i * 0.15, 0.6 + 0.04 * math.sin(i * 1.7)) for i in range(10)]
            tube('Vine', pts, 0.025, vine, K)
            for i in range(4):
                ell('Leaf', (s * 0.62, -0.5 + i * 0.35, 0.64), (0.12, 0.05, 0.02), leaf, K, rot=(0.3, s * 0.5, i))
        for x in (-0.4, 0, 0.4):
            ell('SLeaf', (x, 1.02, 1.06), (0.16, 0.08, 0.02), leaf, K, rot=(0, 0, x))
    elif aid == 'sheep':
        cloud = M('#FFFFFF', 0.9, sheen=0.5)
        rnd = random.Random(11)
        for s in (1, -1):
            for i in range(5):
                r = rnd.uniform(0.1, 0.15)
                ell('Cloud', (s * 0.68, -0.22 + i * 0.11, 0.52 + rnd.uniform(0, 0.05)), (r, r, r * 0.85), cloud, K,
                    seg=16, rings=10)
        for i in range(6):
            r = rnd.uniform(0.09, 0.13)
            ell('Cloud', (-0.45 + i * 0.18, 1.0, 1.06), (r, r, r * 0.8), cloud, K, seg=16, rings=10)
    elif aid == 'redpanda':
        bam = M('#7FB238', 0.45)
        node = M('#5E8A25', 0.5)
        for s in (1, -1):
            cyl('Bamboo', (s * 0.78, -0.05, 0.62), (0, 1, 0), 0.05, 1.5, bam, K, 16)
            for k in range(5):
                torus('Node', (s * 0.78, -0.65 + k * 0.3, 0.62), (math.pi / 2, 0, 0), 0.052, 0.012, node, K, 16, 6)
            ell('BLeaf', (s * 0.86, 0.45, 0.72), (0.04, 0.18, 0.015), M('#9BD84E', 0.45), K, rot=(0.5, s * 0.6, 0))
    elif aid == 'hedgehog':
        husk = M(t['accent'], 0.6)
        for s in (1, -1):
            for i in range(7):
                cone_dir('Husk', (s * 0.72, -0.27 + i * 0.09, 0.47), (s, 0.1, 0.6), 0.03, 0.002, 0.13, husk, K, 8, False)
        for i in range(9):
            cone_dir('Husk', (-0.5 + i * 0.125, 1.0, 1.03), (0, 0.2, 1), 0.03, 0.002, 0.14, husk, K, 8, False)
        ell('NutShine', (0, -0.55, 0.57), (0.25, 0.3, 0.04), M('#A0613A', 0.25), K)
    elif aid == 'penguin':
        snow = M('#FFFFFF', 0.7, sheen=0.4)
        ell('Snow', (0, -0.82, 0.52), (0.36, 0.22, 0.06), snow, K)
        ell('SnowS', (0, 1.0, 1.05), (0.55, 0.13, 0.035), snow, K)
        P = empty('Propeller', (0, 1.36, 0.75), K)
        cyl('PropMount', (0, -0.12, 0), (0, 1, 0), 0.04, 0.24, M('#D8DDE4', 0.2, 1.0), P, 16)
        ell('PropHub', (0, 0.02, 0), (0.06, 0.07, 0.06), M('#E8434F', 0.4), P)
        for a in (0, math.pi / 2):
            ell('Blade', (0, 0.02, 0), (0.05, 0.015, 0.3), M('#2C3350', 0.4), P, rot=(0, a, 0))
        limb('PropArm', (0, 1.0, 0.95), (0, 1.25, 0.75), 0.03, M('#D8DDE4', 0.2, 1.0), K)
    elif aid == 'capybara':
        gold = M(t['accent'], 0.25, 1.0)
        torus('TubRim', (0, 0.05, 0.6), (0, 0, 0), 0.62, 0.045, M('#FFFFFF', 0.3), K, 48, 10)
        K_rim = bpy.context.active_object
        K_rim.scale = (0.95, 1.55, 1)
        bub = M('#DFF5FF', 0.05)
        rnd = random.Random(2)
        for i in range(10):
            r = rnd.uniform(0.04, 0.09)
            ell('Bubble', (rnd.uniform(-0.45, 0.45), rnd.uniform(0.55, 1.05), 1.05 + rnd.uniform(0, 0.12)), (r, r, r),
                bub, K, seg=16, rings=8)
        # Quietscheente
        ell('Duck', (0, -0.8, 0.6), (0.11, 0.13, 0.09), M('#FFD93B', 0.35), K)
        ell('DuckH', (0, -0.88, 0.72), (0.075, 0.075, 0.075), M('#FFD93B', 0.35), K)
        ell('DuckB', (0, -0.96, 0.71), (0.04, 0.035, 0.015), M('#FF8A2B', 0.35), K)
        for s in (1, -1):
            ell('DuckE', (s * 0.035, -0.935, 0.75), (0.013, 0.01, 0.015), M(EYE, 0.1), K, seg=10, rings=6)
        for x, y in ((0.5, -0.7), (-0.5, -0.7), (0.5, 0.75), (-0.5, 0.75)):
            ell('Foot', (x, y, 0.22), (0.08, 0.08, 0.06), gold, K)
    elif aid == 'otter':
        shell = M(t['accent'], 0.4)
        for k in range(7):
            a = -1.2 + k * 0.4
            ell('ShellRib', (0.36 * math.sin(a), 1.08, 0.9 + 0.3 * math.cos(a)), (0.09, 0.05, 0.24), shell, K,
                rot=(0, a, 0))
        ell('ShellBase', (0, 1.08, 0.82), (0.12, 0.07, 0.08), shell, K)
        for k in range(5):
            a = k / 5 * math.tau
            limb('Star', (0, -0.82, 0.55), (0.11 * math.cos(a), -0.82 + 0.11 * math.sin(a), 0.55), 0.035,
                 M('#FF8A5B', 0.5), K, seg=12)
    elif aid == 'axolotl':
        weed = M('#46B35A', 0.5)
        for s in (1, -1):
            for j in range(2):
                pts = [(s * (0.66 + 0.03 * math.sin(i * 1.5)), -0.15 + j * 0.25, 0.48 + i * 0.11) for i in range(7)]
                tube('Weed', pts, 0.03, weed, K, taper=True)
        bub = M('#DFF5FF', 0.05)
        for i, (x, z) in enumerate(((0.3, 1.15), (0.42, 1.3), (0.33, 1.45), (-0.38, 1.2))):
            r = 0.05 + 0.02 * (i % 2)
            ell('Bubble', (x, 1.02, z), (r, r, r), bub, K, seg=16, rings=8)
        for k in range(5):
            a = k / 5 * math.tau
            limb('Star', (0, -0.82, 0.55), (0.11 * math.cos(a), -0.82 + 0.11 * math.sin(a), 0.55), 0.035,
                 M('#FFD447', 0.5), K, seg=12)


# ---------------------------------------------------------------- Deko / Props
def build_props():
    LOWPOLY[0] = True
    R = {}

    def root(name, x):
        r = empty('Prop_' + name, (x, 0, 0))
        R[name] = r
        return r

    x = 0
    # Laubbaum
    r = root('Tree', x)
    cyl('Trunk', (0, 0, 1.2), (0, 0, 1), 0.28, 2.4, M('#7A5134', 0.8), r, 12)
    for (px, py, pz, s) in ((0, 0, 3.0, 1.5), (0.8, 0.3, 2.6, 1.0), (-0.8, -0.2, 2.7, 1.1), (0.1, -0.6, 3.6, 1.0)):
        ell('Crown', (px, py, pz), (s, s, s * 0.9), M('#5DBB46', 0.7), r, seg=20, rings=12)
    x += 6
    # Tanne mit Schnee
    r = root('Pine', x)
    cyl('Trunk', (0, 0, 0.5), (0, 0, 1), 0.22, 1.0, M('#6A4630', 0.8), r, 10)
    for k, (z, rr) in enumerate(((1.0, 1.5), (2.0, 1.15), (2.9, 0.8))):
        cone_dir('Needles', (0, 0, z), (0, 0, 1), rr, 0.05, 1.5, M('#2F7D4A', 0.7), r, 14)
        cone_dir('SnowCap', (0, 0, z + 0.75), (0, 0, 1), rr * 0.55, 0.03, 0.75, M('#FFFFFF', 0.6), r, 14)
    x += 6
    # Bambus
    r = root('Bamboo', x)
    for k, (px, py, h) in enumerate(((0, 0, 6), (0.5, 0.3, 5), (-0.4, 0.4, 5.5))):
        cyl('Stalk', (px, py, h / 2), (0, 0, 1), 0.13, h, M('#7FB238', 0.5), r, 12)
        for j in range(1, int(h / 1.2) + 1):
            torus('Node', (px, py, j * 1.2), (0, 0, 0), 0.135, 0.03, M('#5E8A25', 0.5), r, 12, 6)
        for j in range(3):
            ell('Leaf', (px + 0.4, py, h - j * 0.9), (0.45, 0.08, 0.03), M('#9BD84E', 0.5), r, rot=(0, -0.4, j * 2.1))
    x += 6
    # Pilz (rot) und Leuchtpilz
    for nm, cap, dots, glow in (('Mushroom', '#E8434F', '#FFFFFF', 0.0), ('GlowShroom', '#7C5CFF', '#B6F3FF', 2.5)):
        r = root(nm, x)
        cyl('Stem', (0, 0, 0.6), (0, 0, 1), 0.3, 1.2, M('#F6EBDD', 0.6), r, 16)
        ell('Cap', (0, 0, 1.3), (1.0, 1.0, 0.6), M(cap, 0.4, emit=glow * 0.4), r, seg=24, rings=12)
        for d in fib(18):
            if d.z > 0.3:
                p, n = surf(d, (1.0, 1.0, 0.6), (0, 0, 1.3), -0.02)
                ell('Dot', p, (0.13, 0.13, 0.04), M(dots, 0.5, emit=glow), r, n.to_track_quat('Z', 'Y').to_euler(),
                    12, 6)
        x += 5
    # Blume
    r = root('Flower', x)
    cyl('Stem', (0, 0, 0.4), (0, 0, 1), 0.04, 0.8, M('#4E9A35', 0.6), r, 8)
    for k in range(6):
        a = k / 6 * math.tau
        ell('Petal', (0.17 * math.cos(a), 0.17 * math.sin(a), 0.85), (0.14, 0.08, 0.03), M('#FF9BC0', 0.5), r,
            rot=(0, 0, a), seg=12, rings=8)
    ell('Center', (0, 0, 0.87), (0.09, 0.09, 0.05), M('#FFD447', 0.5), r, seg=12, rings=8)
    x += 3
    # Fels
    r = root('Rock', x)
    ico('Stone', (0, 0, 0.4), (1.0, 0.8, 0.65), M('#9AA0A8', 0.85), r, 2, 0.18, 3)
    ico('Stone', (0.8, 0.3, 0.25), (0.45, 0.4, 0.35), M('#8A9098', 0.85), r, 1, 0.15, 4)
    x += 4
    # Koralle
    r = root('Coral', x)
    cm = M('#FF7A8A', 0.6)
    for k in range(5):
        a = k / 5 * math.tau
        p1 = Vector((0, 0, 0))
        p2 = Vector((0.5 * math.cos(a), 0.5 * math.sin(a), 1.2 + 0.3 * (k % 2)))
        limb('Branch', p1, p2, 0.12, cm, r, seg=12)
        ell('Tip', p2, (0.16, 0.16, 0.16), cm, r, seg=12, rings=8)
    x += 4
    # Seetang
    r = root('Seaweed', x)
    for j, ox in enumerate((-0.3, 0.1, 0.4)):
        pts = [(ox + 0.15 * math.sin(i * 1.3 + j), 0, i * 0.5) for i in range(8)]
        tube('Weed', pts, 0.09, M('#3FA45A', 0.5), r, taper=True)
    x += 3
    # Wolke
    r = root('Cloud', x)
    for (px, py, pz, s) in ((0, 0, 0, 1.2), (1.1, 0, -0.2, 0.9), (-1.1, 0.1, -0.2, 0.95), (0.4, 0.4, 0.5, 0.8),
                            (-0.5, -0.3, 0.4, 0.75)):
        ell('Puff', (px, py, pz + 1.5), (s, s, s * 0.85), M('#FFFFFF', 0.9, sheen=0.4), r, seg=20, rings=12)
    x += 6
    # Honigtopf
    r = root('HoneyJar', x)
    ell('Jar', (0, 0, 0.75), (0.7, 0.7, 0.8), M('#F2A93B', 0.15), r)
    cyl('Lid', (0, 0, 1.55), (0, 0, 1), 0.5, 0.2, M('#B5643A', 0.6), r, 24, bevel=0.04)
    torus('Rim', (0, 0, 1.38), (0, 0, 0), 0.5, 0.06, M('#F6E2B3', 0.7), r, 24, 8)
    ell('Drip', (0.3, -0.48, 1.25), (0.12, 0.08, 0.25), M('#FFC44D', 0.1), r)
    x += 4
    # Honigwaben-Block
    r = root('Honeycomb', x)
    for k, (px, py, h) in enumerate(((0, 0, 1.2), (0.95, 0, 0.8), (0.48, 0.82, 1.6), (-0.48, 0.82, 0.6))):
        cyl('Hex', (px, py, h / 2), (0, 0, 1), 0.55, h, M('#FFC233', 0.35), r, 6, bevel=0.05, smooth=False)
        cyl('HexTop', (px, py, h + 0.01), (0, 0, 1), 0.4, 0.04, M('#E8901E', 0.2), r, 6, smooth=False)
    x += 4
    # Eiskristall
    r = root('Crystal', x)
    for k, (dx, dy, h) in enumerate(((0, 0, 2.2), (0.4, 0.2, 1.4), (-0.35, 0.25, 1.2), (0.1, -0.4, 1.0))):
        d = Vector((dx, dy, 1)).normalized()
        cone_dir('Shard', (dx * 0.3, dy * 0.3, 0), d, 0.3, 0.0, h, M('#A6E6FF', 0.1, emit=0.15), r, 6, False)
    x += 4
    # Lavafels
    r = root('LavaRock', x)
    ico('Rock', (0, 0, 0.6), (1.1, 0.9, 0.8), M('#3A3238', 0.9), r, 2, 0.2, 9)
    for k in range(5):
        a = k / 5 * math.tau
        ell('Glow', (0.9 * math.cos(a), 0.75 * math.sin(a), 0.35 + 0.2 * (k % 2)), (0.15, 0.15, 0.07),
            M('#FF6A1A', 0.5, emit=4.0), r, seg=10, rings=6)
    x += 4
    # Palme
    r = root('Palm', x)
    for i in range(6):
        ell('TrunkSeg', (0.08 * i, 0, 0.5 + i * 0.75), (0.28 - i * 0.02, 0.28 - i * 0.02, 0.45), M('#A07A4C', 0.8), r,
            seg=12, rings=8)
    for k in range(6):
        a = k / 6 * math.tau
        ell('Frond', (0.5 + 1.0 * math.cos(a), 1.0 * math.sin(a), 4.6), (1.3, 0.3, 0.06), M('#4CB050', 0.6), r,
            rot=(0, 0.35, a), seg=16, rings=8)
    ell('Coconut', (0.6, 0.2, 4.3), (0.2, 0.2, 0.2), M('#6A4A2E', 0.7), r)
    x += 6
    # Schlossturm
    r = root('Tower', x)
    cyl('Wall', (0, 0, 2.0), (0, 0, 1), 1.0, 4.0, M('#F8EDF6', 0.6), r, 24)
    cone_dir('Roof', (0, 0, 4.0), (0, 0, 1), 1.25, 0.0, 2.0, M('#B59CFF', 0.45), r, 24)
    for k in range(8):
        a = k / 8 * math.tau
        rbox('Window', (math.cos(a) * 0.98, math.sin(a) * 0.98, 2.8), (0.25, 0.25, 0.5), M('#FFD447', 0.3, emit=1.0),
             r, 0.1, rot=(0, 0, a + math.pi / 2)) if k % 2 == 0 else None
    cyl('Flagpole', (0, 0, 6.4), (0, 0, 1), 0.03, 0.9, M('#D8DDE4', 0.2, 1.0), r, 8)
    rbox('Flag', (0.25, 0, 6.6), (0.45, 0.03, 0.3), M('#FF8FA3', 0.6), r, 0.02)
    x += 5
    # Item-Box (Geschenk mit Pfote)
    r = root('ItemBox', x)
    rbox('Box', (0, 0, 0), (1.0, 1.0, 1.0), M('#FFFFFF', 0.25, emit=0.2), r, 0.18)
    return R


# ---------------------------------------------------------------- Abschluss
def finalize():
    bpy.ops.object.select_all(action='DESELECT')
    objs = [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE')]
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target='MESH')
    groups = {}
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and len(o.children) == 0:
            groups.setdefault(o.parent.name if o.parent else '__root', []).append(o)
    for k, lst in groups.items():
        if len(lst) > 1:
            bpy.ops.object.select_all(action='DESELECT')
            for o in lst:
                o.select_set(True)
            bpy.context.view_layer.objects.active = lst[0]
            bpy.ops.object.join()
        lst[0].name = k + '_mesh'
        lst[0].data.name = k + '_mesh'


def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True,
                              export_lights=False, export_cameras=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)


def stats():
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return tris


def setup_render(res, transparent=True):
    sc = bpy.context.scene
    for nm in ('Sun', 'Fill'):
        if nm in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[nm])
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            pass
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = transparent
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    w = bpy.data.worlds.new('W')
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.75, 0.82, 0.95, 1)
        bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'AREA'))
    fill.data.energy = 250
    fill.data.size = 4
    fill.location = (-3, -3, 2.5)
    fill.rotation_euler = (Vector((0, 0, 1)) - fill.location).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(fill)


def shot(path, loc, target, lens):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('Cam')
    if cam is None:
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    todo = ONLY or list(ANIMALS.keys()) + ['props']
    for aid in todo:
        clear()
        if aid == 'props':
            build_props()
            finalize()
            print('[props] tris:', stats())
            export(os.path.join(OUT, 'models', 'props.glb'))
            if DO_RENDER:
                setup_render(1024, False)
                bpy.context.scene.render.resolution_x = 2048
                shot(os.path.join(OUT, '..', 'docs', 'props.png'), (38, -40, 18), (38, 0, 2), 50)
            continue
        K = empty('Kart_' + aid)
        build_kart(K, THEMES[aid])
        kart_extras(K, aid, THEMES[aid])
        ANIMALS[aid](K)
        finalize()
        print('[%s] tris: %d' % (aid, stats()))
        export(os.path.join(OUT, 'models', aid + '.glb'))
        if DO_RENDER:
            setup_render(256)
            bpy.context.scene.render.image_settings.file_format = 'WEBP'
            bpy.context.scene.render.image_settings.quality = 88
            shot(os.path.join(OUT, 'portraits', aid + '.webp'), (0.8, -2.6, 1.9), (0, 0.15, 1.45), 75)
            bpy.context.scene.render.image_settings.file_format = 'PNG'
            setup_render(900, False)
            shot(os.path.join(OUT, '..', 'docs', 'preview_' + aid + '.png'), (3.4, -4.4, 2.6), (0, 0.1, 0.85), 50)


main()
