"""Honigfabrik (track 3) scenery: honey jars, barrels, crates, tank, presses, pipe cannon, hives,
sunflowers, lavender, bee workers, lamps and the factory hall kit. Same conventions as the
Kleeblatt-Tal kit (see docs/ASSETS-honey.md): Blender Z up, model front = -Y (glTF +Z)."""
import math, random
from mathutils import Vector, noise
from kit import Part, lin, mix, grad_z, M

# honey palette (sRGB hex)
H = {
    'honey': '#f0a51c', 'honey_dk': '#c97a0e', 'honey_lt': '#ffd25e', 'amber': '#e08a12',
    'wax': '#f7d77a', 'comb': '#e9b23a', 'comb_dk': '#b9801c',
    'steel': '#9aa3ad', 'steel_dk': '#5f6770', 'steel_lt': '#c9d0d6',
    'paint_y': '#f2c230', 'paint_y_dk': '#d49b16', 'black': '#2a2826', 'red': '#d9483b',
    'cream': '#f6ecd2', 'brick': '#b8664a', 'brick_dk': '#8f4b36', 'copper': '#c7743d', 'copper_dk': '#985329',
    'wood': '#b07a49', 'wood_dk': '#7d5333', 'wood_lt': '#cf9c63',
    'leaf': '#5a9a3a', 'leaf_dk': '#3f7a2c', 'petal': '#ffc928', 'petal_dk': '#f09a16', 'seed': '#5b3a1e',
    'lav': '#9b7ad8', 'lav_dk': '#7356b8', 'white': '#fbf8f0', 'glass': '#bfe3ef', 'lamp': '#ffd27a',
    'hive': '#f3e2b0', 'hive_roof': '#d0503c', 'fur': '#ffcf3a',
}


def c(k):
    return H.get(k, k)


def stripes(c0, c1, period, axis=2, offset=0.0):
    def f(co, n):
        v = (co[axis] + offset) / period
        return lin(c(c0)) if int(math.floor(v)) % 2 == 0 else lin(c(c1))
    return f


def hazard(period=0.5):
    """Diagonal yellow / black hazard stripes (in XZ)."""
    def f(co, n):
        v = (co.x + co.z + co.y) / period
        return lin(c('paint_y')) if int(math.floor(v)) % 2 == 0 else lin(c('black'))
    return f


# ---------------------------------------------------------------------------
# Jars, barrels, crates
# ---------------------------------------------------------------------------

def _jar(p, R, Hh, segs, loc=(0, 0, 0), label=True):
    x, y, z = loc
    # glass jar full of honey: lighter towards the top, a thin glass rim above the honey
    body = [(0, 0), (R * 0.82, 0), (R * 0.97, R * 0.06), (R, R * 0.25), (R, Hh * 0.78), (R * 0.93, Hh * 0.86), (R * 0.72, Hh * 0.9), (0, Hh * 0.9)]
    p.lathe(body, (x, y, z), color=grad_z(c('honey_dk'), c('honey_lt'), z, z + Hh * 0.9, 0.04, 2.0), segs=segs, mat='gloss')
    p.lathe([(R * 0.7, Hh * 0.88), (R * 0.74, Hh * 0.9), (R * 0.74, Hh * 0.98), (R * 0.7, Hh * 0.98)], (x, y, z), color=c('glass'), segs=segs, cap0=False, cap1=False, mat='gloss')
    # lid with a red / white cloth top
    p.lathe([(R * 0.78, Hh * 0.96), (R * 0.8, Hh * 1.0), (R * 0.8, Hh * 1.06), (R * 0.75, Hh * 1.08), (0, Hh * 1.08)], (x, y, z), color=c('red'), segs=segs)
    if label:
        p.lathe([(R * 1.005, Hh * 0.36), (R * 1.012, Hh * 0.38), (R * 1.012, Hh * 0.62), (R * 1.005, Hh * 0.64)], (x, y, z),
                color=stripes('cream', 'cream', 1), segs=segs, cap0=False, cap1=False)
        # little bee on the label (front, -Y)
        bz = z + Hh * 0.5
        p.sphere(R * 0.09, (x, y - R * 1.02, bz), color=stripes('paint_y', 'black', R * 0.05, axis=0), scale=(1.4, 0.5, 1), segs=8, rings=5)
        for sx in (-1, 1):
            p.sphere(R * 0.06, (x + sx * R * 0.07, y - R * 1.025, bz + R * 0.08), color=c('white'), scale=(1, 0.4, 0.7), segs=6, rings=4)


def honey_jar_giant(lod=0, seed=301):
    """Giant display honey jar, 4.6 m wide, 6.6 m tall (yard decoration)."""
    p = Part('honey_jar_giant', hard=False, seed=seed)
    p.force_mat = 'gloss'
    _jar(p, 2.3, 6.1, 20 if lod == 0 else 10, label=lod == 0)
    if lod == 0:
        # honey dripping down from the lid
        for k in range(5):
            a = k * 1.25 + 0.4
            x, y = math.cos(a) * 1.86, math.sin(a) * 1.86
            p.sweep([(x, y, 6.4), (x * 1.05, y * 1.05, 6.0), (x * 1.12, y * 1.12, 5.1 - k * 0.25)], [0.16, 0.12, 0.08], c('honey'), segs=6, mat='gloss')
    return [p]


def honey_jar(lod=0, seed=302):
    """Small honey jar, 0.5 m tall (stacked on crates)."""
    p = Part('honey_jar', hard=False, seed=seed)
    p.force_mat = 'gloss'
    _jar(p, 0.22, 0.46, 10, label=False)
    return [p]


def honey_barrel(lod=0, seed=303):
    """Wooden honey barrel standing up, diameter 1.1 m, height 1.2 m; origin at the bottom centre."""
    p = Part('honey_barrel', hard=True, seed=seed)
    p.force_mat = 'base'
    R, Hh = 0.5, 1.2
    if lod:
        p.lathe([(0, 0), (R * 0.86, 0), (R, Hh * 0.5), (R * 0.86, Hh), (0, Hh)], color=c('wood'), segs=8)
        p.lathe([(R * 0.85, Hh - 0.01), (0, Hh + 0.03)], color=c('honey'), segs=8, cap0=False)
        return [p]
    prof = [(R * 0.86, 0)]
    for k in range(1, 8):
        t = k / 8
        prof.append((R * (0.86 + 0.14 * math.sin(math.pi * t)), Hh * t))
    prof.append((R * 0.86, Hh))
    p.lathe([(0, 0.02)] + prof + [(0, Hh - 0.02)], color=lambda co, n: mix(c('wood_dk'), c('wood'), 0.5 + 0.5 * math.sin(math.atan2(co.y, co.x) * 9) ** 8), segs=18)
    for z in (0.14, 0.42, 0.78, 1.06):
        t = z / Hh
        r = R * (0.86 + 0.14 * math.sin(math.pi * t)) + 0.012
        p.lathe([(r, z - 0.04), (r + 0.01, z - 0.03), (r + 0.01, z + 0.03), (r, z + 0.04)], color=c('steel_dk'), segs=18, cap0=False, cap1=False, mat='base')
    # honey on the lid, dripping over the rim
    p.lathe([(0, Hh - 0.01), (R * 0.84, Hh - 0.01), (R * 0.86, Hh + 0.03), (0, Hh + 0.04)], color=c('honey'), segs=14, mat='gloss')
    for k in range(3):
        a = k * 2.1 + 0.3
        x, y = math.cos(a) * R * 0.88, math.sin(a) * R * 0.88
        p.sweep([(x, y, Hh + 0.02), (x * 1.04, y * 1.04, Hh - 0.12), (x * 1.06, y * 1.06, Hh - 0.25 - k * 0.06)], [0.05, 0.04, 0.025], c('honey'), segs=5, mat='gloss')
    return [p]


def _bee_logo(p, cx, cy, cz, s, normal_axis='y', sign=-1):
    """Small hexagon with a bee on a crate side (flat decal-like shapes)."""
    hexagon = [(math.cos(a) * s, math.sin(a) * s) for a in [k * math.pi / 3 + math.pi / 6 for k in range(6)]]
    if normal_axis == 'y':
        p.prism(hexagon, 0.02, (cx, cy + sign * 0.005, cz), rot=(0, 0, 0), color=c('paint_y'))
        p.sphere(s * 0.38, (cx, cy + sign * 0.03, cz), color=stripes('paint_y', 'black', s * 0.2, axis=0), scale=(1.3, 0.35, 0.9), segs=8, rings=5)
        for sx in (-1, 1):
            p.sphere(s * 0.26, (cx + sx * s * 0.22, cy + sign * 0.035, cz + s * 0.3), color=c('white'), scale=(1, 0.3, 0.7), segs=6, rings=4)
    else:
        p.prism(hexagon, 0.02, (cx + sign * 0.005, cy, cz), rot=(0, 0, 90), color=c('paint_y'))
        p.sphere(s * 0.38, (cx + sign * 0.03, cy, cz), color=stripes('paint_y', 'black', s * 0.2, axis=1), scale=(0.35, 1.3, 0.9), segs=8, rings=5)
        for sy in (-1, 1):
            p.sphere(s * 0.26, (cx + sign * 0.035, cy + sy * s * 0.22, cz + s * 0.3), color=c('white'), scale=(0.3, 1, 0.7), segs=6, rings=4)


def honey_crate(lod=0, seed=304):
    """1.1 m wooden crate with the factory's bee logo on all four sides."""
    p = Part('honey_crate', hard=True, seed=seed)
    s = 1.1
    h = s / 2
    if lod:
        p.box((s, s, s), (0, 0, 0), color=c('wood_lt'), base=True)
        hexagon = [(math.cos(a) * 0.28, math.sin(a) * 0.28) for a in [k * math.pi / 3 + math.pi / 6 for k in range(6)]]
        for sy in (-1, 1):
            p.prism(hexagon, 0.02, (0, sy * (h + 0.005), h), color=c('paint_y'))
        return [p]
    p.box((s - 0.04, s - 0.04, s - 0.04), (0, 0, 0), color=c('wood_lt'), base=True, jitter=0.04)
    t = 0.11
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((t, t, s), (sx * (h - t / 2 + 0.01), sy * (h - t / 2 + 0.01), 0), color=c('wood_dk'), base=True, bevel=0.015)
            p.box((s, t, t), (0, sy * (h - t / 2 + 0.01), (sx + 1) / 2 * (s - t) + t / 2), color=c('wood_dk'), bevel=0.015)
            p.box((t, s, t), (sx * (h - t / 2 + 0.01), 0, (sx + 1) / 2 * (s - t) + t / 2), color=c('wood_dk'), bevel=0.015)
    for sy in (-1, 1):
        _bee_logo(p, 0, sy * (h - 0.01), h, 0.26, 'y', sy)
    for sx in (-1, 1):
        _bee_logo(p, sx * (h - 0.01), 0, h, 0.26, 'x', sx)
    return [p]


# ---------------------------------------------------------------------------
# Machinery
# ---------------------------------------------------------------------------

def honey_tank(lod=0, seed=305):
    """Giant honey tank, radius 10.5 m, 19 m to the top of the dome; glowing gauge window on -Y (front)."""
    p = Part('honey_tank', hard=True, seed=seed)
    R, Ht = 10.5, 15.0
    segs = 28 if lod == 0 else 14
    p.lathe([(0, 0), (R + 0.6, 0), (R + 0.6, 0.7), (R, 0.7)], color=c('steel_dk'), segs=segs)
    prof = [(R, 0.7)]
    bands = 6 if lod == 0 else 0
    for i in range(bands):
        z = 0.7 + (Ht - 0.7) * (i + 0.5) / bands
        prof += [(R, z - 0.12), (R + 0.12, z - 0.06), (R + 0.12, z + 0.06), (R, z + 0.12)]
    prof += [(R, Ht)]

    def body(co, n):
        a = math.atan2(co.y, co.x)
        panel = 0.5 + 0.5 * math.cos(a * 14)
        return mix(c('copper_dk'), c('copper'), 0.55 + 0.25 * panel ** 6 + noise.noise(co * 0.15) * 0.2)
    p.lathe(prof, color=body, segs=segs, cap0=False, cap1=False)
    p.lathe([(R + 0.15, Ht - 0.1), (R + 0.2, Ht + 0.1), (R * 0.85, Ht + 2.0), (R * 0.5, Ht + 3.4), (1.6, Ht + 4.0), (1.6, Ht + 4.4), (0, Ht + 4.45)],
            color=grad_z(c('copper'), c('honey_lt'), Ht, Ht + 4.4, 0.0), segs=segs)
    # gauge window: tall glowing strip (honey level) on the front
    gw = 1.6
    p.box((gw, 0.3, Ht - 3.0), (0, -R - 0.05, 1.6), color=c('honey_lt'), base=True, mat='emit:#ffb21e')
    p.box((gw + 0.5, 0.35, 0.35), (0, -R - 0.1, 1.4), color=c('steel_dk'), base=True)
    p.box((gw + 0.5, 0.35, 0.35), (0, -R - 0.1, Ht - 1.6), color=c('steel_dk'), base=True)
    for sx in (-1, 1):
        p.box((0.3, 0.38, Ht - 2.6), (sx * (gw / 2 + 0.15), -R - 0.1, 1.4), color=c('steel_dk'), base=True)
    if lod == 0:
        # level ticks
        for k in range(8):
            p.box((0.5, 0.42, 0.08), (gw / 2 + 0.35, -R - 0.12, 2.5 + k * 1.4), color=c('black'), base=True)
        # round gauges (dials) with red needles
        for k, (ax, az) in enumerate([(-3.8, 3.2), (3.8, 3.2), (-5.5, 7.5)]):
            a = math.atan2(-R, ax)
            gx, gy = math.cos(a) * (R + 0.25), math.sin(a) * (R + 0.25)
            p.cyl(0.75, 0.25, (gx, gy, az), rot=(90, 0, math.degrees(a) - 90), color=c('steel_lt'), segs=14)
            p.cyl(0.6, 0.27, (gx, gy, az), rot=(90, 0, math.degrees(a) - 90), color=c('white'), segs=14)
            p.box((0.08, 0.05, 0.5), (gx * 1.03, gy * 1.03, az), rot=(0, 30 + k * 40, 0), color=c('red'))
        # ladder on the side (+X)
        for sy in (-1, 1):
            p.box((0.08, 0.08, Ht + 1.5), (R + 0.45, sy * 0.3, 0.7), color=c('steel_dk'), base=True)
        for i in range(int(Ht / 0.5)):
            p.box((0.06, 0.6, 0.06), (R + 0.45, 0, 1.0 + i * 0.5), color=c('steel_dk'))
        # pipes into the ground and towards the hall (+Y back, -X)
        p.sweep([(-R * 0.7, R * 0.7, 2.2), (-R * 0.95, R * 0.95, 2.2), (-R - 3.0, R + 3.0, 2.2), (-R - 3.0, R + 3.0, 0)], 0.55, c('steel'), segs=10)
        p.sweep([(R * 0.6, R * 0.8, 6.0), (R * 0.9, R * 1.2, 6.0), (R + 4.0, R + 4.0, 6.0), (R + 4.0, R + 4.0, 0)], 0.45, c('copper'), segs=10)
        for x, y in [(-R - 3.0, R + 3.0), (R + 4.0, R + 4.0)]:
            p.cyl(0.9, 0.3, (x, y, 0), color=c('steel_dk'), segs=10)
        # honeycomb crown on top
        p.cyl(1.0, 1.4, (0, 0, Ht + 4.4), color=c('paint_y'), segs=6)
    return [p]


def honey_press(lod=0, seed=306):
    """Stamping press: steel column at +X with an arm over a 8.4 m wide strip; child 'head' (the
    stamp, origin at its bottom centre, raised 4.4 m) moves along Y. Child 'lamp' = warning light."""
    p = Part('honey_press', hard=True, seed=seed)
    W, L = 8.4, 4.4
    colx = W / 2 + 1.6
    top = 8.0
    # column and foot
    p.box((2.2, 3.0, 0.5), (colx, 0, 0), color=c('steel_dk'), base=True, bevel=0.05)
    p.box((1.4, 1.8, top + 1.0), (colx, 0, 0.5), color=c('paint_y'), base=True, bevel=0.06)
    for z in (1.0, 2.0):
        p.box((1.46, 1.86, 0.4), (colx, 0, z), color=c('black'), base=True)
    # arm
    p.box((W + 2.6, 2.2, 1.4), (colx - (W + 2.6) / 2 + 0.7, 0, top), color=c('paint_y'), base=True, bevel=0.08)
    p.box((W + 2.7, 2.26, 0.25), (colx - (W + 2.6) / 2 + 0.7, 0, top + 1.4), color=c('paint_y_dk'), base=True)
    # hydraulic cylinder above the head
    p.cyl(0.75, 1.0, (0, 0, top - 0.9), color=c('steel'), segs=14)
    # head: stamp plate with hazard edges and a honeycomb print
    hd = Part('head', origin=(0, 0, 4.4), parent='honey_press', hard=True, seed=seed)
    hd.box((W, L, 1.1), (0, 0, 4.4 + 0.25), color=c('steel'), base=True, bevel=0.06)
    hd.box((W + 0.1, L + 0.1, 0.28), (0, 0, 4.4), color=hazard(0.55), base=True)
    hd.box((W * 0.6, L * 0.6, 0.6), (0, 0, 4.4 + 1.35), color=c('steel_dk'), base=True, bevel=0.05)
    hd.cyl(0.45, 2.6, (0, 0, 4.4 + 1.9), color=c('steel_lt'), segs=12)
    if lod == 0:
        for k in range(5):
            hx = -W / 2 + 0.9 + k * (W - 1.8) / 4
            hd.cyl(0.32, 0.03, (hx, -L / 2 - 0.01, 4.4 + 0.65), rot=(90, 0, 0), color=c('paint_y'), segs=6)
    # warning lamp (emissive, its own node so the view can pulse it)
    lp = Part('lamp', origin=(colx, 0, top + 1.65), parent='honey_press', hard=False, seed=seed)
    lp.cyl(0.32, 0.5, (colx, 0, top + 1.65), color=c('#ff7a2a'), segs=10, mat='emit:#ff6a1a')
    lp.sphere(0.32, (colx, 0, top + 2.15), color=c('#ff7a2a'), segs=10, rings=5, mat='emit:#ff6a1a')
    return [p, hd, lp]


def honey_cannon(lod=0, seed=307):
    """Pipe cannon. Intake funnel at the ground facing -Z (glTF, towards approaching karts), barrel rising
    to a muzzle 13 m up pointing forward (+Z). Child 'lid' = the intake hatch (hinge at its top, opens
    by rotating about local X)."""
    p = Part('honey_cannon', hard=True, seed=seed)
    segs = 20 if lod == 0 else 12
    # intake funnel (axis along -Y Blender = +Z glTF; opening faces +Y Blender = -Z glTF)
    p.lathe([(2.6, 0), (2.7, 0.15), (2.2, 1.2), (1.7, 2.6), (1.7, 3.2)], (0, 3.2, 2.7), rot=(90, 0, 0), color=c('copper'), segs=segs, cap0=False, cap1=False)
    p.lathe([(2.45, 0), (2.0, 1.2), (1.55, 2.6), (1.55, 3.2)], (0, 3.2, 2.7), rot=(90, 0, 0), color=c('copper_dk'), segs=segs, cap0=False, cap1=False)
    # barrel: sweep up and forward
    pts = [(0, 0.0, 2.7), (0, -2.5, 3.1), (0, -5.0, 4.6), (0, -7.0, 7.0), (0, -8.6, 10.0), (0, -9.8, 13.0)]
    p.sweep(pts, [1.75, 1.75, 1.75, 1.75, 1.75, 1.9], c('copper'), segs=segs, cap0=False, cap1=False)
    for k, t in enumerate([0.15, 0.4, 0.65, 0.9]):
        i = t * (len(pts) - 1)
        a, b = pts[int(i)], pts[min(len(pts) - 1, int(i) + 1)]
        f = i - int(i)
        q = Vector(a).lerp(Vector(b), f)
        d = (Vector(b) - Vector(a)).normalized()
        rx = math.degrees(math.atan2(d.y, d.z))
        p.cyl(1.95, 0.45, tuple(q), rot=(-rx, 0, 0), color=c('paint_y'), segs=segs)
    p.cyl(2.15, 0.7, (0, -9.8, 13.0), rot=(-40, 0, 0), color=c('paint_y'), segs=segs)
    # cradle and base
    p.box((5.6, 6.0, 1.0), (0, -3.0, 0), color=c('steel_dk'), base=True, bevel=0.08)
    for sx in (-1, 1):
        p.box((0.8, 1.2, 6.5), (sx * 2.2, -6.5, 0.8), color=c('steel'), base=True, bevel=0.05)
        p.box((0.8, 1.2, 3.0), (sx * 2.2, -2.0, 0.8), color=c('steel'), base=True, bevel=0.05)
    # hazard ring around the mouth and arrow lights
    p.lathe([(2.75, 0), (2.85, 0.05), (2.85, 0.35), (2.75, 0.4)], (0, 3.25, 2.7), rot=(90, 0, 0), color=hazard(0.6), segs=segs, cap0=False, cap1=False)
    if lod == 0:
        for k in range(3):
            p.prism([(-0.6, 0), (0.6, 0), (0, 0.7)], 0.1, (0, 3.3, 5.8 + k * 0.85), rot=(0, 0, 0), color=c('lamp'), mat='emit:#ffb21e')
    return [p]


def honey_cannon_lid(lod=0, seed=320):
    """Closed hatch of the pipe cannon intake (laps 1 and 2). Origin on the ground below the hatch
    centre; place it 3.35 m behind the cannon origin (glTF -Z). Hidden when the cannon opens."""
    p = Part('honey_cannon_lid', hard=True, seed=seed)
    p.cyl(2.65, 0.22, (0, 0.11, 2.7), rot=(90, 0, 0), color=c('steel'), segs=20)
    p.box((4.4, 0.2, 0.55), (0, -0.12, 2.7), color=hazard(0.5))
    p.box((0.55, 0.2, 4.4), (0, -0.13, 2.7 - 2.2), color=hazard(0.5), base=True)
    for k in range(8):
        a = k * math.pi / 4
        p.sphere(0.12, (math.cos(a) * 2.3, -0.1, 2.7 + math.sin(a) * 2.3), color=c('steel_dk'), segs=6, rings=4)
    return [p]


def honey_pipe(lod=0, seed=308):
    """Straight pipe 6 m along X, radius 0.45, flanges at both ends; lies on two little stands."""
    p = Part('honey_pipe', hard=True, seed=seed)
    p.cyl(0.45, 6.0, (-3.0, 0, 0.9), rot=(0, 90, 0), color=c('copper'), segs=12, caps=False)
    for x in (-3.0, 3.0):
        p.cyl(0.58, 0.2, (x - 0.1, 0, 0.9), rot=(0, 90, 0), color=c('copper_dk'), segs=12)
    for x in (-1.8, 1.8):
        p.box((0.3, 0.8, 0.5), (x, 0, 0), color=c('steel_dk'), base=True)
    return [p]


# ---------------------------------------------------------------------------
# Hives and fields
# ---------------------------------------------------------------------------

def _hive_box(p, x, y, z, w, d, h, col='hive'):
    p.box((w, d, h), (x, y, z), color=c(col), base=True, bevel=0.03, jitter=0.03)
    p.box((w + 0.06, d + 0.06, 0.08), (x, y, z + h - 0.06), color=c('wood_dk'), base=True)
    # entrance slot + landing board (front -Y)
    p.box((w * 0.5, 0.05, 0.06), (x, y - d / 2, z + 0.08), color=c('black'), base=True)
    p.box((w * 0.6, 0.18, 0.04), (x, y - d / 2 - 0.08, z + 0.04), color=c('wood'), base=True)


def honey_hive(lod=0, seed=309):
    """Bee hive: two boxes and a gabled red roof on a little stand, 1.6 m tall."""
    p = Part('honey_hive', hard=True, seed=seed)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.08, 0.08, 0.35), (sx * 0.3, sy * 0.25, 0), color=c('wood_dk'), base=True)
    _hive_box(p, 0, 0, 0.35, 0.8, 0.65, 0.42)
    _hive_box(p, 0, 0, 0.77, 0.8, 0.65, 0.42, col='#f6e8c2')
    p.prism([(-0.55, 0), (0.55, 0), (0, 0.35)], 0.8, (0, 0, 1.2), rot=(0, 0, 90), color=c('hive_roof'))
    return [p]


def honey_hive_tower(lod=0, seed=310):
    """Hive tower: a tall honeycomb tower of stacked hive boxes, 15 m, with landing boards and a beacon."""
    rng = random.Random(seed)
    p = Part('honey_hive_tower', hard=True, seed=seed)
    # base
    p.lathe([(0, 0), (4.0, 0), (4.0, 0.8), (3.4, 1.2), (0, 1.2)], color=c('brick'), segs=6, phase=math.pi / 6)
    z = 1.2
    levels = 7
    for i in range(levels):
        r = 3.0 - i * 0.18
        hh = 1.75
        col = [c('hive'), c('#f6e8c2'), c('wax')][i % 3]
        p.lathe([(r, z), (r, z + hh), (0, z + hh)], color=col, segs=6, phase=math.pi / 6, cap0=False)
        p.lathe([(r + 0.12, z + hh - 0.02), (r + 0.12, z + hh + 0.14), (0, z + hh + 0.14)], color=c('wood_dk'), segs=6, phase=math.pi / 6, cap0=False)
        if lod == 0:
            for k in range(3):
                a = (k * 2 + (i % 2)) * math.pi / 3
                ex, ey = math.cos(a) * r * 0.92, math.sin(a) * r * 0.92
                p.box((0.9, 0.12, 0.25), (ex, ey, z + 0.2), rot=(0, 0, math.degrees(a) + 90), color=c('black'), base=True)
                p.box((1.1, 0.5, 0.08), (ex * 1.08, ey * 1.08, z + 0.15), rot=(0, 0, math.degrees(a) + 90), color=c('wood'), base=True)
        z += hh + 0.14
    # roof cone and a glowing honey beacon
    p.lathe([(2.2, z), (2.0, z + 0.2), (0.4, z + 2.4), (0, z + 2.5)], color=c('hive_roof'), segs=6, phase=math.pi / 6)
    p.sphere(0.6, (0, 0, z + 3.0), color=c('honey_lt'), segs=10, rings=6, mat='emit:#ffb21e')
    if lod == 0:
        # honeycomb hexagons on the base
        for k in range(6):
            a = k * math.pi / 3 + math.pi / 6
            p.cyl(0.45, 0.06, (math.cos(a) * 3.62, math.sin(a) * 3.62, 0.5), rot=(90, 0, math.degrees(a) + 90), color=c('comb'), segs=6)
    return [p]


def honey_sunflower(lod=0, seed=311):
    """Sunflower 2.3 m tall, head (0.7 m) facing -Y (glTF +Z)."""
    rng = random.Random(seed)
    p = Part('honey_sunflower', hard=False, seed=seed)
    p.sweep([(0, 0, 0), (0.05, 0.02, 1.0), (0, -0.05, 1.9), (0, -0.12, 2.15)], [0.05, 0.045, 0.04, 0.035], c('leaf_dk'), segs=5, cap0=False)
    for k, z in enumerate((0.7, 1.3)):
        a = k * 2.6
        dx, dy = math.cos(a), math.sin(a)
        p.prism([(0, 0), (0.18, 0.12), (0.42, 0.08), (0.18, -0.08)], 0.02, (dx * 0.03, dy * 0.03, z), rot=(0, -20, math.degrees(a)), color=c('leaf'), mat='foliage')
    hz, hy = 2.2, -0.16
    p.cyl(0.18, 0.1, (0, hy, hz), rot=(80, 0, 0), color=c('seed'), segs=10)
    n = 12
    for k in range(n):
        a = k * 2 * math.pi / n
        px, pz = math.cos(a), math.sin(a)
        p.prism([(-0.07, 0), (0.07, 0), (0.03, 0.22), (0, 0.27), (-0.03, 0.22)], 0.015,
                (px * 0.16, hy + 0.03, hz + pz * 0.16), rot=(0, -math.degrees(a) + 90, 0), color=c('petal') if k % 2 else c('petal_dk'), mat='foliage')
    return [p]


def honey_lavender(lod=0, seed=312):
    """Lavender bush, 0.9 m wide, 0.75 m tall: grey-green tuft with purple flower spikes."""
    rng = random.Random(seed)
    p = Part('honey_lavender', hard=False, seed=seed)
    p.blob([((0, 0, 0.15), 0.45, (1.2, 1.2, 0.6)), ((0.15, 0.1, 0.2), 0.3, (1, 1, 0.7))], color=c('#7c9a6a'), res=0.18, tris=60, field=0.6, squash=(0.0, 0.2))
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(0.05, 0.32)
        x, y = math.cos(a) * r, math.sin(a) * r
        top = rng.uniform(0.55, 0.78)
        p.sweep([(x * 0.6, y * 0.6, 0.2), (x, y, top * 0.7), (x * 1.15, y * 1.15, top)], [0.012, 0.012, 0.01], c('#6e8f5e'), segs=3, cap0=False)
        p.sphere(0.045, (x * 1.15, y * 1.15, top + 0.04), color=c('lav') if k % 2 else c('lav_dk'), scale=(1, 1, 2.4), segs=5, rings=4)
    return [p]


# ---------------------------------------------------------------------------
# Bees and lamps
# ---------------------------------------------------------------------------

def honey_bee(lod=0, seed=313):
    """Friendly bee worker, 1.4 m tall, standing upright with a helmet; child 'wings' (pivot on its back)."""
    p = Part('honey_bee', hard=False, seed=seed)
    p.force_mat = 'base'
    p.sphere(0.42, (0, 0.05, 0.62), color=stripes('fur', 'black', 0.17, axis=2, offset=0.05), scale=(1, 0.9, 1.15), segs=14 if not lod else 9, rings=10 if not lod else 7)
    p.sphere(0.3, (0, -0.05, 1.12), color=c('fur'), segs=12 if not lod else 8, rings=8 if not lod else 5)
    for sx in ((-1, 1) if not lod else ()):
        p.sphere(0.1, (sx * 0.13, -0.29, 1.15), color=c('black'), scale=(1, 0.6, 1.2), segs=8, rings=6)
        p.sphere(0.035, (sx * 0.11, -0.36, 1.2), color=c('white'), segs=6, rings=4)
        p.sweep([(sx * 0.09, -0.05, 1.38), (sx * 0.18, -0.12, 1.6), (sx * 0.26, -0.18, 1.66)], 0.018, c('black'), segs=4)
        p.sphere(0.045, (sx * 0.27, -0.19, 1.67), color=c('black'), segs=6, rings=4)
        # arms and legs
        p.sweep([(sx * 0.33, -0.05, 0.75), (sx * 0.48, -0.2, 0.62), (sx * 0.42, -0.32, 0.5)], 0.05, c('black'), segs=5)
        p.sweep([(sx * 0.18, 0.05, 0.28), (sx * 0.2, 0.0, 0.1), (sx * 0.22, -0.08, 0.02)], 0.06, c('black'), segs=5)
        p.sphere(0.08, (sx * 0.22, -0.12, 0.04), color=c('black'), scale=(1, 1.5, 0.6), segs=6, rings=4)
    p.sphere(0.05, (0, -0.31, 1.03), color=c('#e8705a'), scale=(1.6, 0.6, 0.6), segs=6, rings=4)
    # hard hat
    p.lathe([(0.34, 1.27), (0.33, 1.33), (0.27, 1.44), (0.15, 1.5), (0, 1.51)], color=c('paint_y'), segs=12)
    p.lathe([(0.38, 1.26), (0.38, 1.29), (0, 1.29)], color=c('paint_y_dk'), segs=12, cap0=False)
    if lod:
        for sx in (-1, 1):
            p.sphere(0.1, (sx * 0.13, -0.29, 1.15), color=c('black'), segs=6, rings=4)
            p.sphere(0.25, (sx * 0.28, 0.42, 1.05), color=c('#e9f4fb'), scale=(1.1, 0.12, 0.65), segs=6, rings=4)
        return [p]
    w = Part('wings', origin=(0, 0.35, 0.95), parent='honey_bee', hard=False, seed=seed)
    w.force_mat = 'base'
    for sx in (-1, 1):
        w.sphere(0.28, (sx * 0.28, 0.42, 1.05), color=c('#e9f4fb'), scale=(1.1, 0.12, 0.65), rot=(0, sx * 25, 0), segs=10, rings=6, mat='gloss')
    return [p, w]


def honey_lamp(lod=0, seed=314):
    """Hanging factory lamp: 3 m cable, enamel shade, warm glowing bulb. Origin = cable top."""
    p = Part('honey_lamp', hard=True, seed=seed)
    p.cyl(0.025, 3.0, (0, 0, -3.0), color=c('black'), segs=4)
    p.lathe([(0.12, -3.0), (0.14, -3.15), (0.55, -3.55), (0.62, -3.62), (0.6, -3.65), (0.12, -3.25)], color=c('#3c6b5a'), segs=14, cap0=False, cap1=False)
    p.sphere(0.2, (0, 0, -3.5), color=c('lamp'), segs=10, rings=6, mat='emit:#ffcf7a')
    return [p]


def honey_lamp_post(lod=0, seed=315):
    """Yard lamp post 5 m with a warm lantern."""
    p = Part('honey_lamp_post', hard=True, seed=seed)
    p.cyl(0.3, 0.3, (0, 0, 0), color=c('steel_dk'), segs=8)
    p.cyl(0.09, 4.7, (0, 0, 0.3), color=c('black'), segs=8)
    p.box((0.9, 0.08, 0.08), (0.35, 0, 4.9), color=c('black'))
    p.lathe([(0.08, 4.95), (0.3, 4.6), (0.32, 4.55)], (0.75, 0, 0), color=c('black'), segs=10, cap0=False, cap1=False)
    p.sphere(0.2, (0.75, 0, 4.55), color=c('lamp'), segs=10, rings=6, mat='emit:#ffcf7a')
    return [p]


# ---------------------------------------------------------------------------
# Factory hall kit
# ---------------------------------------------------------------------------

def honey_wall(lod=0, seed=316):
    """Hall wall section 8 m wide (X), 12 m tall, 0.6 m thick: brick plinth, a tall steel window frame
    (open, so light and views pass), a honeycomb frieze and a cornice."""
    p = Part('honey_wall', hard=True, seed=seed)
    W, Hh, T = 8.0, 12.0, 0.6
    p.box((W, T, 2.2), (0, 0, 0), color=lambda co, n: mix(c('brick_dk'), c('brick'), 0.6 + noise.noise(co * 2.5) * 0.4), base=True)
    p.box((W + 0.02, T + 0.1, 0.25), (0, 0, 2.2), color=c('cream'), base=True)
    # pilasters at the ends
    for sx in (-1, 1):
        p.box((0.9, T + 0.2, Hh), (sx * (W / 2 - 0.45), 0, 0), color=c('brick'), base=True, jitter=0.03)
    # window frame (open)
    x0, x1, z0, z1 = -W / 2 + 0.9, W / 2 - 0.9, 2.45, Hh - 2.0
    p.box((x1 - x0, 0.2, 0.18), (0, 0, z0), color=c('steel_dk'), base=True)
    for k in range(1, 3):
        xm = x0 + (x1 - x0) * k / 3
        p.box((0.14, 0.16, z1 - z0), (xm, 0, z0), color=c('steel_dk'), base=True)
    for k in range(1, 4):
        zm = z0 + (z1 - z0) * k / 4
        p.box((x1 - x0, 0.16, 0.12), (0, 0, zm), color=c('steel_dk'), base=True)
    # frieze + cornice
    p.box((W, T, Hh - z1), (0, 0, z1), color=c('cream'), base=True)
    if lod == 0:
        for k in range(5):
            hx = -W / 2 + 1.4 + k * (W - 2.8) / 4
            for sy in (-1, 1):
                p.cyl(0.42, 0.06, (hx, sy * (T / 2 + 0.02), z1 + 0.9), rot=(90, 0, 0), color=c('comb'), segs=6)
    p.box((W + 0.1, T + 0.5, 0.35), (0, 0, Hh - 0.1), color=c('paint_y_dk'), base=True)
    return [p]


def honey_truss(lod=0, seed=317):
    """Roof truss spanning 46 m along X (origin at the centre of the bottom chord), 4 m deep."""
    p = Part('honey_truss', hard=True, seed=seed)
    L, D = 46.0, 4.0
    t = 0.3
    p.box((L, t, t), (0, 0, 0), color=c('steel'), base=True)
    n = 16 if not lod else 8
    for k in range(n + 1):
        x = -L / 2 + L * k / n
        top = D * (1 - abs(x) / (L / 2) * 0.35)
        p.box((t * 0.8, t * 0.8, top), (x, 0, 0), color=c('steel'), base=True)
        if k < n:
            x2 = -L / 2 + L * (k + 1) / n
            top2 = D * (1 - abs(x2) / (L / 2) * 0.35)
            p.box((math.hypot(x2 - x, top2 - top), t, t), ((x + x2) / 2, 0, (top + top2) / 2), rot=(0, -math.degrees(math.atan2(top2 - top, x2 - x)), 0), color=c('steel'))
            dl = math.hypot(x2 - x, (top + top2) / 2)
            ang = math.degrees(math.atan2((top + top2) / 2, x2 - x))
            p.box((dl, t * 0.7, t * 0.7), ((x + x2) / 2, 0, (top + top2) / 4), rot=(0, -ang if k % 2 == 0 else ang, 0), color=c('steel_dk'))
    return [p]


def honey_column(lod=0, seed=318):
    """Steel hall column (I-beam) 13 m with a yellow base guard."""
    p = Part('honey_column', hard=True, seed=seed)
    p.box((0.7, 0.18, 13.0), (0, 0, 0), color=c('steel_dk'), base=True)
    for sy in (-1, 1):
        p.box((0.7, 0.08, 13.0), (0, sy * 0.35, 0), color=c('steel'), base=True)
    p.box((1.1, 1.1, 1.2), (0, 0, 0), color=hazard(0.5), base=True, bevel=0.05)
    return [p]


def honey_vat(lod=0, seed=319):
    """Open honey vat (6 m round, 1.4 m tall) with a stirring paddle; the honey surface glows softly."""
    p = Part('honey_vat', hard=True, seed=seed)
    p.force_mat = 'base'
    R = 3.0
    segs = 20 if lod == 0 else 12
    p.lathe([(0, 0), (R, 0), (R, 1.4), (R - 0.2, 1.4), (R - 0.2, 0.2), (0, 0.2)], color=c('steel'), segs=segs)
    p.lathe([(R + 0.02, 1.15), (R + 0.06, 1.2), (R + 0.06, 1.4), (R + 0.02, 1.45)], color=c('paint_y'), segs=segs, cap0=False, cap1=False)
    p.cyl(R - 0.2, 0.05, (0, 0, 1.2), color=c('honey'), segs=segs, mat='gloss')
    p.box((R * 2 + 0.6, 0.4, 0.4), (0, 0, 2.6), color=c('paint_y'), base=True)
    p.cyl(0.12, 1.6, (0, 0, 1.0), color=c('steel_dk'), segs=8)
    p.box((1.6, 0.1, 0.5), (0, 0, 1.0), color=c('steel_dk'), base=True)
    for sx in (-1, 1):
        p.box((0.3, 0.3, 2.6), (sx * (R + 0.3), 0, 0), color=c('steel_dk'), base=True)
    return [p]


BUILDERS = {
    'honey_jar_giant': honey_jar_giant, 'honey_jar': honey_jar, 'honey_barrel': honey_barrel, 'honey_crate': honey_crate,
    'honey_tank': honey_tank, 'honey_press': honey_press, 'honey_cannon': honey_cannon, 'honey_cannon_lid': honey_cannon_lid, 'honey_pipe': honey_pipe,
    'honey_hive': honey_hive, 'honey_hive_tower': honey_hive_tower, 'honey_sunflower': honey_sunflower,
    'honey_lavender': honey_lavender, 'honey_bee': honey_bee, 'honey_lamp': honey_lamp, 'honey_lamp_post': honey_lamp_post,
    'honey_wall': honey_wall, 'honey_truss': honey_truss, 'honey_column': honey_column, 'honey_vat': honey_vat,
}
LODS = {'honey_crate', 'honey_barrel', 'honey_bee', 'honey_truss', 'honey_jar_giant', 'honey_tank', 'honey_hive_tower', 'honey_press', 'honey_wall', 'honey_vat'}
AO = {
    'honey_jar_giant': dict(distance=1.5, samples=24), 'honey_jar': dict(distance=0.2, samples=16),
    'honey_barrel': dict(distance=0.4, samples=24), 'honey_crate': dict(distance=0.3, samples=24),
    'honey_tank': dict(distance=2.5, samples=24), 'honey_press': dict(distance=1.5, samples=24),
    'honey_cannon': dict(distance=1.5, samples=24), 'honey_cannon_lid': dict(distance=0.4, samples=16), 'honey_pipe': dict(distance=0.5, samples=16),
    'honey_hive': dict(distance=0.4, samples=24), 'honey_hive_tower': dict(distance=1.5, samples=24),
    'honey_sunflower': dict(distance=0.3, strength=0.4, samples=16), 'honey_lavender': dict(distance=0.3, strength=0.4, samples=16),
    'honey_bee': dict(distance=0.3, strength=0.45, samples=24), 'honey_lamp': dict(distance=0.3, samples=16, ground=False),
    'honey_lamp_post': dict(distance=0.4, samples=16), 'honey_wall': dict(distance=1.0, samples=24),
    'honey_truss': dict(distance=0.6, samples=16, ground=False), 'honey_column': dict(distance=0.6, samples=16),
    'honey_vat': dict(distance=0.8, samples=24),
}
