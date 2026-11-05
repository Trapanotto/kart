"""
Licht der Strecken in Blender backen (Cycles) – Trapanotto Kart.

Vorher die Strecke aus dem Spiel exportieren: `node tools/serve.mjs 8081 --dev`, Spiel öffnen,
in der Browser-Konsole `await pgp.exportBake(<Streckennummer>)` (schreibt build/<id>.glb + .json).

Aufruf (aus dem Repo):
  blender -b -P tools/blender/bake_tracks.py -- meadow glacier      # einzelne Strecken
  blender -b -P tools/blender/bake_tracks.py -- all [--fast]        # alle exportierten

Ergebnis je Strecke in assets/tracks/<id>/:
  bake.glb         statische Streckenteile mit zweiter UV-Ebene (Lightmap), Draco-komprimiert
  lm_0.webp ...    Lightmaps (+ _low in halber Größe fürs Handy)
  bake.json        welche Lightmap zu welchem Teil gehört, Helligkeit
"""
import bpy
import json
import math
import os
import sys
import time

import numpy as np
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD = os.path.join(ROOT, "build")


def log(*a):
    print("[bake]", *a, flush=True)


def hex2lin(h):
    h = h.lstrip("#")
    return [(int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]


def setup_gpu():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as ex:  # noqa
        log("GPU nicht verfuegbar:", ex)


def setup_light(meta):
    """Himmel und Sonne wie im Spiel (Sonne steht dort bei Versatz (45, 90, 35) zum Spieler)"""
    sc = bpy.context.scene
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    top, hor = hex2lin(meta["sky"][0]), hex2lin(meta["sky"][1])
    bg.inputs["Color"].default_value = (*[(a + b) / 2 for a, b in zip(top, hor)], 1)
    bg.inputs["Strength"].default_value = 1.3 * meta["hemi"] / 1.1
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 4.0 * meta["sun"] / 2.6
    ld.angle = math.radians(3)
    sun = bpy.data.objects.new("sun", ld)
    sc.collection.objects.link(sun)
    d = Vector((45, -35, 90)).normalized()  # Spiel (x, y, z) -> Blender (x, -z, y)
    sun.rotation_euler = Vector((0, 0, 1)).rotation_difference(d).to_euler()
    # Lampen, Lampions, Lichtleisten und Leuchtkristalle als Punktlichter (Spiel (x, y, z) -> Blender (x, -z, y))
    for n, L in enumerate(meta.get("lights", [])):
        pl = bpy.data.lights.new("lamp%d" % n, "POINT")
        pl.energy = L["e"]
        pl.color = hex2lin(L["c"])
        pl.shadow_soft_size = 0.4
        ob = bpy.data.objects.new("lamp%d" % n, pl)
        x, y, z = L["p"]
        ob.location = (x, -z, y)
        sc.collection.objects.link(ob)
    if meta.get("lights"):
        log("  %d Lichtquellen" % len(meta["lights"]))


def area(ob):
    return sum(p.area for p in ob.data.polygons) * max(ob.scale) ** 2


def fix_winding(objs):
    """Flaechen, deren Drehsinn gegen ihre Normale zeigt, umdrehen (im Spiel sind manche Materialien
    beidseitig, beim Backen zaehlt aber die Vorderseite: sonst laege die Fahrbahn im Dunkeln)"""
    import bmesh
    n_fixed = 0
    for ob in objs:
        me = ob.data
        cn = me.corner_normals
        flip = []
        for p in me.polygons:
            avg = Vector()
            for li in p.loop_indices:
                avg += cn[li].vector
            if avg.dot(p.normal) < 0:
                flip.append(p.index)
        if not flip:
            continue
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        for i in flip:
            bm.faces[i].normal_flip()
        bm.to_mesh(me)
        bm.free()
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception:  # noqa
            pass
        for p in me.polygons:
            p.use_smooth = True
        n_fixed += 1
    return n_fixed


def lightmap_uvs(objs, margin):
    for ob in objs:
        me = ob.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
        lm = me.uv_layers.get("LM") or me.uv_layers.new(name="LM")
        me.uv_layers.active = lm
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    # gleiche Aufloesung pro Meter fuer alle Teile, sonst bekommt kleine Deko viel und die Fahrbahn fast nichts
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=margin, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for ob in objs:
        ob.data.uv_layers.active = ob.data.uv_layers[0]


def bake(objs, size, samples):
    img = bpy.data.images.new("lm", size, size, float_buffer=True)
    added = []
    for ob in objs:
        for slot in ob.material_slots:
            m = slot.material
            if m is None:
                continue
            m.use_nodes = True
            nt = m.node_tree
            n = nt.nodes.get("LM_BAKE") or nt.nodes.new("ShaderNodeTexImage")
            n.name = "LM_BAKE"
            n.image = img
            nt.nodes.active = n
            added.append((nt, n))
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.context.scene.cycles.samples = samples
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=4, use_clear=True, uv_layer="LM")
    for nt, n in added:
        if n.name in nt.nodes:
            nt.nodes.remove(n)
    px = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[..., :3]


def denoise(a, passes=3, radius=2):
    """Entrauschen mit Kantenschutz (aehnlich helle Nachbarn mitteln, harte Schattenkanten bleiben)"""
    for _ in range(passes):
        L = a.mean(2)
        nz = L[L > 1e-5]
        sig = 0.25 * L + 0.04 * (float(np.percentile(nz, 90)) if nz.size else 1.0) + 1e-4
        acc = a.copy()
        wsum = np.ones_like(L)
        p = np.pad(a, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
        pl = np.pad(L, radius, mode="edge")
        H, W = L.shape
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx == 0 and dy == 0:
                    continue
                nl = pl[radius + dy:radius + dy + H, radius + dx:radius + dx + W]
                wgt = np.exp(-((nl - L) / sig) ** 2) * math.exp(-(dx * dx + dy * dy) / (radius * radius))
                acc += p[radius + dy:radius + dy + H, radius + dx:radius + dx + W] * wgt[..., None]
                wsum += wgt
        a = acc / wsum[..., None]
    return a


def save_webp(a, scale, path, size=None):
    v = np.clip(a / scale, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    if size and size != s.shape[0]:
        f = s.shape[0] // size
        s = s.reshape(size, f, size, f, 3).mean((1, 3))
    h, w = s.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = s
    img.pixels.foreach_set(px.ravel())
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "WEBP"
    sc.render.image_settings.quality = 90
    sc.render.image_settings.color_mode = "RGB"
    img.save_render(path, scene=sc)
    bpy.data.images.remove(img)


def bake_track(tid, fast=False):
    t0 = time.time()
    src = os.path.join(BUILD, tid + ".glb")
    meta = json.load(open(os.path.join(BUILD, tid + ".json")))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.view_settings.view_transform = "Standard"
    setup_gpu()
    bpy.ops.import_scene.gltf(filepath=src)
    stat = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("bk")]
    casters = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("bk")]
    log(f"{tid}: {len(stat)} feste Teile, {len(casters)} Schattenwerfer")
    for ob in stat:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
    # Bodenflaechen (sehr gross) bekommen eine eigene Lightmap, damit die Fahrbahn scharf bleibt
    def span(ob):
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        return max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb))
    big = [o for o in stat if span(o) > 700]
    # ferne Huegel/Berge: wenige riesige Flaechen -> nicht backen (behalten im Spiel ihr Echtzeit-Licht)
    far = [o for o in stat if o not in big and area(o) / max(1, len(o.data.polygons)) > 3000]
    rest = [o for o in stat if o not in big and o not in far]
    log(f"  {len(rest)} nah, {len(big)} Boden, {len(far)} fern (bleiben ungebacken)")
    log(f"  Drehsinn korrigiert bei {fix_winding(stat)} Teilen")
    setup_light(meta)
    groups = [g for g in (rest, big) if g]
    sizes = [(2048 if fast else 4096), (1024 if fast else 2048)][:len(groups)] if rest else [(1024 if fast else 2048)]
    samples = 32 if fast else 128
    baked = []
    for g, size in zip(groups, sizes):
        lightmap_uvs(g, 0.004 if size >= 4096 else 0.006)
        t1 = time.time()
        baked.append(denoise(bake(g, size, samples)))
        log(f"  {len(g)} Teile, {size}px gebacken ({time.time() - t1:.0f}s)")
    # Helligkeit: sonnige Flaeche soll im Spiel so hell wirken wie heute mit Sonne + Himmel
    # Bezug: der flache, offene Boden (eigene Lightmap); ohne Boden die mittlere Helligkeit der nahen Teile
    flat = baked[-1].mean(2) if big else baked[0].mean(2)
    ref = float(np.percentile(flat[flat > 1e-4], 85 if big else 60))
    scale = float(max(np.percentile(np.concatenate([b.mean(2).ravel() for b in baked]), 99.8), ref) * 1.08)
    fill = 0.1 * ref  # Schattenseiten nicht zu dunkel (Kart-Stil)
    target = (meta["sun"] * 0.84 + meta["hemi"]) / math.pi + 0.25
    out = os.path.join(ROOT, "assets", "tracks", tid)
    os.makedirs(out, exist_ok=True)
    files = []
    for k, a in enumerate(baked):
        fn = f"lm_{k}.webp"
        save_webp(a + fill, scale + fill, os.path.join(out, fn))
        save_webp(a + fill, scale + fill, os.path.join(out, f"lm_{k}_low.webp"), size=a.shape[0] // 2)
        files.append(fn)
    intensity = target * math.pi * (scale + fill) / (ref + fill)
    # nur die festen Teile exportieren
    for o in casters:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in stat:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out, "bake.glb"), export_format="GLB", use_selection=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="NONE",
                              export_vertex_color="ACTIVE", export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_cameras=False, export_lights=False, export_yup=True)
    objects = {o.name.split(".")[0]: (0 if o in rest else len(groups) - 1) for o in stat if o not in far}
    json.dump({"id": tid, "count": meta["count"], "lightmaps": files, "objects": objects, "intensity": round(intensity, 4)},
              open(os.path.join(out, "bake.json"), "w"))
    log(f"{tid} fertig ({time.time() - t0:.0f}s) -> {out}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    fast = "--fast" in argv
    ids = [a for a in argv if not a.startswith("--")]
    if ids == ["all"] or not ids:
        ids = sorted(f[:-4] for f in os.listdir(BUILD) if f.endswith(".glb"))
    for tid in ids:
        bake_track(tid, fast)


main()
