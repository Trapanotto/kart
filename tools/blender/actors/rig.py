# Shared armature, skinning and animation clips authored as code.
#
# Every driver gets the same bone layout (root, hips, spine, chest, neck, head,
# ear_l/r, upperarm/forearm/hand_l/r, thigh_l/r, tail_1..3 where present).
# Clips are written once as functions of time that return rotations in
# armature-aligned axes relative to the seated rest pose; the arms are solved
# with analytic IK onto the steering-wheel grips, so the same clip retargets
# to every character's proportions.
#
# Rotation convention (degrees, applied about the bone head, axes = armature axes):
#   +X = pitch forward (top goes to the front), +Z = turn left, +Y = tilt left.
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

import anatomy as A

FPS = 30


# ---------------------------------------------------------------- armature
def rig_character(spec, objs):
    arm_data = bpy.data.armatures.new(spec.id + '_rig')
    arm = bpy.data.objects.new('rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    order = list(spec.joints.keys())
    # parents first
    done, ebs = set(), {}
    while len(done) < len(order):
        for n in order:
            if n in done:
                continue
            h, t, par = spec.joints[n]
            if par and par not in done:
                continue
            eb = arm_data.edit_bones.new(n)
            eb.head = Vector(h)
            eb.tail = Vector(t)
            d = (Vector(t) - Vector(h)).normalized()
            ref = Vector((0, -1, 0)) if abs(d.z) > 0.7 else Vector((0, 0, 1))
            eb.align_roll(ref)
            if par:
                eb.parent = ebs[par]
                eb.use_connect = False
            eb.use_deform = True
            ebs[n] = eb
            done.add(n)
    bpy.ops.object.mode_set(mode='OBJECT')

    # skin weights
    for o in objs:
        o.parent = arm
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm
        n = len(o.data.vertices)
        if o.name.endswith('_fur'):
            W = spec._fur_weights
            names = [b for b in W if b in spec.joints]
            M = np.stack([W[b] for b in names], 1)
            # keep the 4 strongest influences
            idx = np.argsort(-M, 1)[:, :4]
            top = np.take_along_axis(M, idx, 1)
            top[top < 0.02 * top[:, :1]] = 0
            top /= top.sum(1, keepdims=True)
            groups = {b: o.vertex_groups.new(name=b) for b in names}
            for vi in range(n):
                for j in range(4):
                    w = top[vi, j]
                    if w > 0:
                        groups[names[idx[vi, j]]].add([vi], float(w), 'REPLACE')
        else:
            bones = spec._part_bones[o.name]
            by = {}
            for vi, b in enumerate(bones):
                by.setdefault(b, []).append(vi)
            for b, vs in by.items():
                o.vertex_groups.new(name=b).add(vs, 1.0, 'REPLACE')
    return arm


# ---------------------------------------------------------------- posing helpers
def rest_rot(arm, name):
    return arm.data.bones[name].matrix_local.to_3x3()


def world_axis_quat(arm, name, deg):
    """Rotation given in armature axes -> bone basis quaternion."""
    R = Euler([math.radians(a) for a in deg], 'XYZ').to_matrix()
    M = rest_rot(arm, name)
    return (M.inverted() @ R @ M).to_quaternion()


def aim_quat(pb, target_dir):
    """Basis rotation that turns the bone (with identity basis already evaluated) to point along target_dir."""
    M0 = pb.matrix.to_3x3()
    cur = M0.col[1].normalized()
    R = cur.rotation_difference(Vector(target_dir).normalized()).to_matrix()
    q = (M0.inverted() @ R @ M0).to_quaternion()
    return q


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def env(t, a, b, c, d):
    """0 before a, ramps to 1 by b, holds, ramps down from c to d."""
    if t < a or t > d:
        return 0.0
    if t < b:
        return smooth((t - a) / max(b - a, 1e-6))
    if t > c:
        return 1.0 - smooth((t - c) / max(d - c, 1e-6))
    return 1.0


S = math.sin
TAU = math.tau


# ---------------------------------------------------------------- clips
# Each clip: (duration, loop, fn(t, u) -> pose) where u = t / duration.
# pose = {'rot': {bone: (x,y,z)}, 'loc': (x,y,z) root offset, 'ik': {'l': w, 'r': w},
#         'steer': wheel angle for the grips, 'arm': {bone: (x,y,z)} FK arm rotation}

def tail_wave(p, u, amp=10, phase=0.0, n=3, axis=2, base=(0, 0, 0)):
    for i in range(n):
        r = list(base)
        r[axis] += amp * S(TAU * u - i * 0.9 + phase)
        p['rot']['tail_%d' % (i + 1)] = tuple(r)


def ear_wiggle(p, u, amp=6, base=0.0):
    p['rot']['ear_l'] = (base + amp * S(TAU * u), 0, 0)
    p['rot']['ear_r'] = (base + amp * S(TAU * u + 0.7), 0, 0)


def new_pose():
    return {'rot': {}, 'loc': (0, 0, 0), 'ik': {'l': 1.0, 'r': 1.0}, 'steer': 0.0, 'arm': {}}


def c_idle(t, u):
    p = new_pose()
    b = S(TAU * u)
    p['rot']['spine'] = (1.5 * b, 0, 0)
    p['rot']['chest'] = (2 * b, 0, 0)
    p['rot']['neck'] = (-1.5 * b, 0, 0)
    p['rot']['head'] = (2.5 * S(TAU * u + 0.6), 0, 2.5 * S(TAU * u * 1 + 1.2))
    p['loc'] = (0, 0, 0.006 * b)
    ear_wiggle(p, u, 5)
    tail_wave(p, u, 8)
    return p


def c_steer(side):
    # side +1 = left turn
    def fn(t, u):
        p = new_pose()
        b = S(TAU * u)
        p['steer'] = side * 1.0
        p['rot']['hips'] = (0, side * 4, side * 3)
        p['rot']['spine'] = (2, side * 5, side * 4)
        p['rot']['chest'] = (2 + b, side * 5, side * 6)
        p['rot']['head'] = (0, side * 8, side * 14)
        p['loc'] = (side * 0.02, 0, 0.004 * b)
        ear_wiggle(p, u, 4, -side * 3)
        tail_wave(p, u, 8, base=(0, 0, -side * 15))
        return p
    return fn


def c_drift(side):
    def fn(t, u):
        p = new_pose()
        b = S(TAU * u * 2)
        p['steer'] = side * 1.15
        p['rot']['hips'] = (0, side * 7, side * 6)
        p['rot']['spine'] = (4, side * 9, side * 6)
        p['rot']['chest'] = (5 + 2 * b, side * 9, side * 10)
        p['rot']['neck'] = (0, side * 4, side * 6)
        p['rot']['head'] = (-3, side * 10 + 2 * b, side * 22)
        p['loc'] = (side * 0.035, 0, 0.012 * abs(b))
        p['rot']['ear_l'] = (-25 + 8 * b, -10, 0)
        p['rot']['ear_r'] = (-25 + 8 * S(TAU * u * 2 + 1), 10, 0)
        tail_wave(p, u * 2, 14, base=(0, 0, -side * 30))
        return p
    return fn


def c_boost(t, u):
    p = new_pose()
    v = S(TAU * u * 2)
    p['rot']['hips'] = (6, 0, 0)
    p['rot']['spine'] = (8, 0, 0)
    p['rot']['chest'] = (10 + 1.5 * v, 0, 0)
    p['rot']['neck'] = (-8, 0, 0)
    p['rot']['head'] = (-6 + 2 * v, 0, 0)
    p['loc'] = (0, -0.03, 0.004 * v)
    p['rot']['ear_l'] = (-55 + 6 * v, -15, 0)
    p['rot']['ear_r'] = (-55 + 6 * S(TAU * u * 2 + 1.3), 15, 0)
    tail_wave(p, u * 2, 10, axis=2, base=(-35, 0, 0))
    return p


def c_hit(t, u):
    p = new_pose()
    w = env(u, 0.0, 0.12, 0.75, 1.0)
    a = TAU * u * 2.5
    p['rot']['spine'] = (-6 * w, 8 * w * S(a), 10 * w * S(a))
    p['rot']['chest'] = (-8 * w + 4 * w * S(a * 2), 10 * w * S(a + 1), 12 * w * S(a))
    p['rot']['neck'] = (8 * w * S(a + 1.6), 0, 0)
    p['rot']['head'] = (14 * w * S(a + 1.6), 16 * w * S(a), 18 * w * S(a + 0.5))
    p['loc'] = (0, 0, 0.05 * w * abs(S(a * 0.5)))
    p['ik'] = {'l': 1 - w, 'r': 1 - w}
    flail = 25 * S(a * 2)
    p['arm'] = {'upperarm_l': (-110, 0, -40 + flail), 'forearm_l': (-30, 0, 0),
                'upperarm_r': (-110, 0, 40 - flail), 'forearm_r': (-30, 0, 0)}
    p['rot']['ear_l'] = (40 * w * S(a * 2), 0, 0)
    p['rot']['ear_r'] = (40 * w * S(a * 2 + 2), 0, 0)
    tail_wave(p, u * 3, 30 * w)
    return p


def c_squash(t, u):
    p = new_pose()
    w = env(u, 0.0, 0.08, 0.7, 1.0)
    jig = S(TAU * u * 6) * w
    p['rot']['spine'] = (12 * w, 0, 0)
    p['rot']['chest'] = (10 * w, 4 * jig, 0)
    p['rot']['neck'] = (10 * w, 0, 0)
    p['rot']['head'] = (8 * w, 8 * jig, 6 * jig)
    p['loc'] = (0, 0, -0.06 * w)
    p['ik'] = {'l': 1 - w, 'r': 1 - w}
    p['arm'] = {'upperarm_l': (20, 0, -70), 'forearm_l': (0, 0, -20), 'upperarm_r': (20, 0, 70), 'forearm_r': (0, 0, 20)}
    p['rot']['ear_l'] = (0, -50 * w, 0)
    p['rot']['ear_r'] = (0, 50 * w, 0)
    return p


def c_cheer(t, u):
    p = new_pose()
    w = env(u, 0.0, 0.15, 0.7, 1.0)
    pump = S(TAU * u * 3) * w
    p['rot']['spine'] = (-6 * w, 0, 0)
    p['rot']['chest'] = (-8 * w, -6 * w, -6 * w)
    p['rot']['head'] = (-14 * w + 4 * pump, 8 * w, 10 * w)
    p['loc'] = (0, 0, 0.03 * w + 0.02 * abs(pump))
    p['ik'] = {'l': 1.0, 'r': 1 - w}
    p['arm'] = {'upperarm_r': (-150 + 15 * pump, 0, 25), 'forearm_r': (-20 - 25 * pump, 0, 0), 'hand_r': (0, 0, 0)}
    p['rot']['ear_l'] = (-15 * w, 0, 0)
    p['rot']['ear_r'] = (-15 * w, 0, 0)
    tail_wave(p, u * 3, 25 * w)
    return p


def c_look_back(t, u):
    p = new_pose()
    b = S(TAU * u)
    p['rot']['hips'] = (0, 0, -10)
    p['rot']['spine'] = (0, 0, -25)
    p['rot']['chest'] = (-4, 4, -35)
    p['rot']['neck'] = (0, 0, -30)
    p['rot']['head'] = (-6 + 2 * b, -6, -45)
    p['ik'] = {'l': 1.0, 'r': 0.0}
    p['arm'] = {'upperarm_r': (20, -20, 30), 'forearm_r': (-40, 0, 0)}
    ear_wiggle(p, u, 6)
    tail_wave(p, u, 10)
    return p


def c_throw(t, u):
    p = new_pose()
    wind = env(u, 0.0, 0.3, 0.3, 0.45)
    fling = env(u, 0.3, 0.45, 0.6, 1.0)
    w = env(u, 0.0, 0.1, 0.7, 1.0)
    p['rot']['chest'] = (-8 * wind + 12 * fling, 0, -18 * wind + 14 * fling)
    p['rot']['spine'] = (0, 0, -8 * wind + 6 * fling)
    p['rot']['head'] = (-6 * wind + 4 * fling, 0, 6 * wind)
    p['ik'] = {'l': 1.0, 'r': 1 - w}
    a = -140 * wind + (-60) * fling * (1 - wind)
    p['arm'] = {'upperarm_r': (a - 20 * w, 0, 30 * w), 'forearm_r': (-60 * wind + 10 * fling, 0, 0)}
    return p


def c_win(t, u):
    p = new_pose()
    b = S(TAU * u * 2)
    p['rot']['spine'] = (-6, 0, 0)
    p['rot']['chest'] = (-8 + 3 * b, 0, 5 * S(TAU * u))
    p['rot']['head'] = (-14 + 4 * b, 6 * S(TAU * u), 8 * S(TAU * u))
    p['loc'] = (0, 0, 0.03 + 0.03 * abs(b))
    p['ik'] = {'l': 0.0, 'r': 0.0}
    p['arm'] = {'upperarm_l': (-150 + 10 * b, 0, -25 - 15 * S(TAU * u * 2)), 'forearm_l': (-15, 0, 0),
                'upperarm_r': (-150 - 10 * b, 0, 25 + 15 * S(TAU * u * 2)), 'forearm_r': (-15, 0, 0)}
    p['rot']['ear_l'] = (-10 + 10 * b, 0, 0)
    p['rot']['ear_r'] = (-10 - 10 * b, 0, 0)
    tail_wave(p, u * 2, 30)
    return p


def c_lose(t, u):
    p = new_pose()
    b = S(TAU * u)
    p['rot']['spine'] = (14, 0, 0)
    p['rot']['chest'] = (14, 0, 0)
    p['rot']['neck'] = (14, 0, 0)
    p['rot']['head'] = (14 + 2 * b, 0, 12 * S(TAU * u * 2))
    p['loc'] = (0, 0.01, -0.03)
    p['ik'] = {'l': 0.0, 'r': 0.0}
    p['arm'] = {'upperarm_l': (55, 0, -10), 'forearm_l': (10, 0, 0), 'upperarm_r': (55, 0, 10), 'forearm_r': (10, 0, 0)}
    p['rot']['ear_l'] = (0, -45, 0)
    p['rot']['ear_r'] = (0, 45, 0)
    tail_wave(p, u, 5, base=(30, 0, 0))
    return p


CLIPS = {
    'idle': (2.0, True, c_idle),
    'steer_l': (1.0, True, c_steer(1)),
    'steer_r': (1.0, True, c_steer(-1)),
    'drift_l': (1.0, True, c_drift(1)),
    'drift_r': (1.0, True, c_drift(-1)),
    'boost': (0.6, True, c_boost),
    'hit': (1.2, False, c_hit),
    'squash': (1.0, False, c_squash),
    'cheer': (1.2, False, c_cheer),
    'look_back': (1.0, True, c_look_back),
    'throw': (0.6, False, c_throw),
    'win': (2.0, True, c_win),
    'lose': (2.0, True, c_lose),
}


# ---------------------------------------------------------------- baking
def apply_pose(spec, arm, pose):
    pbs = arm.pose.bones
    for pb in pbs:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    for name, deg in pose['rot'].items():
        if name in pbs:
            pbs[name].rotation_quaternion = world_axis_quat(arm, name, deg)
    lx, ly, lz = pose['loc']
    # root location: bone 'root' points up (+Z world) -> convert world offset to bone space
    M = rest_rot(arm, 'root')
    pbs['root'].location = M.inverted() @ Vector((lx, ly, lz))
    bpy.context.view_layer.update()
    for side in ('l', 'r'):
        w = pose['ik'].get(side, 1.0)
        ua, fa, hd = pbs['upperarm_' + side], pbs['forearm_' + side], pbs['hand_' + side]
        fk = {n: world_axis_quat(arm, n, pose['arm'].get(n, (0, 0, 0))) for n in ('upperarm_' + side, 'forearm_' + side, 'hand_' + side)}
        if w <= 0:
            for n, q in fk.items():
                pbs[n].rotation_quaternion = q
            bpy.context.view_layer.update()
            continue
        sgn = 1 if side == 'l' else -1
        T = A.grip(sgn, -pose['steer'] * A.WHEEL_STEER_POSE)
        S_ = Vector(ua.head)
        la = (Vector(ua.tail) - Vector(ua.head)).length
        lb = (Vector(fa.tail) - Vector(fa.head)).length
        E, W = A.two_bone_ik(np.array(S_), T, la, lb, np.array((sgn * 1.0, 0.6, -0.9)))
        ua.rotation_quaternion = Quaternion()
        fa.rotation_quaternion = Quaternion()
        bpy.context.view_layer.update()
        q1 = aim_quat(ua, Vector(E) - S_)
        ua.rotation_quaternion = fk['upperarm_' + side].slerp(q1, w) if w < 1 else q1
        bpy.context.view_layer.update()
        q2 = aim_quat(fa, Vector(W) - Vector(fa.head))
        fa.rotation_quaternion = fk['forearm_' + side].slerp(q2, w) if w < 1 else q2
        hd.rotation_quaternion = fk['hand_' + side].slerp(Quaternion(), w)
        bpy.context.view_layer.update()


def animate(spec, arm, objs):
    sc = bpy.context.scene
    sc.render.fps = FPS
    arm.animation_data_create()
    names = [b.name for b in arm.pose.bones]
    for cname, (dur, loop, fn) in CLIPS.items():
        act = bpy.data.actions.new(cname)
        act.use_fake_user = True
        arm.animation_data.action = act
        nf = int(round(dur * FPS))
        for f in range(nf + 1):
            t = f / FPS
            u = (f % nf) / nf if loop else f / nf
            pose = fn(t, u)
            apply_pose(spec, arm, pose)
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            arm.pose.bones['root'].keyframe_insert('location', frame=f + 1)
        arm.animation_data.action = None
        tr = arm.animation_data.nla_tracks.new()
        tr.name = cname
        tr.strips.new(cname, 1, act)
        tr.mute = True
    # leave the armature in its rest pose
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    print('clips', list(CLIPS))
