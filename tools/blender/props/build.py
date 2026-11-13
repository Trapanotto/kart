"""Build props: blender -b -P tools/blender/props/build.py -- [name ...] [--no-ao] [--no-lod]

Each prop module registers BUILDERS = {name: fn(lod) -> [Part, ...]} and optionally LODS = {name, ...}
for which a second file prop.<name>.lod1.glb is generated with fn(lod=1).
Writes public/assets/models/prop.<name>.glb and merges stats into tools/blender/props/out/stats.json.
"""
import bpy, sys, os, json, importlib, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kit
importlib.reload(kit)

MODULES = ['props_nature', 'props_farm', 'props_buildings', 'props_race']
BUILDERS, LODS, AO = {}, set(), {}
for mname in MODULES:
    if not os.path.exists(os.path.join(HERE, mname + '.py')):
        continue
    mod = importlib.import_module(mname)
    BUILDERS.update(mod.BUILDERS)
    LODS |= set(getattr(mod, 'LODS', ()))
    AO.update(getattr(mod, 'AO', {}))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
names = [a for a in argv if not a.startswith('--')] or list(BUILDERS)
use_ao = '--no-ao' not in argv
use_lod = '--no-lod' not in argv

os.makedirs(kit.MODELS, exist_ok=True)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
stats_path = os.path.join(HERE, 'out', 'stats.json')
stats = json.load(open(stats_path)) if os.path.exists(stats_path) else {}

for name in names:
    for lod in ([0, 1] if (use_lod and name in LODS) else [0]):
        t0 = time.time()
        kit.new_scene()
        parts = BUILDERS[name](lod)
        objs = kit.realize(parts, name)
        if use_ao:
            ao = AO.get(name, {})
            kit.bake_ao(objs, **ao)
        tris = kit.tri_count(objs)
        lo, hi = kit.bounds(objs)
        fn = 'prop.%s.glb' % name if lod == 0 else 'prop.%s.lod1.glb' % name
        size = kit.export_glb(objs, os.path.join(kit.MODELS, fn))
        key = name if lod == 0 else name + '.lod1'
        # Blender (x, y, z) -> glTF: width = x, height = z, depth = y
        stats[key] = dict(file=fn, tris=tris, bytes=size,
                          size_m=[round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)],
                          min_gltf=[round(lo.x, 2), round(lo.z, 2), round(-hi.y, 2)],
                          max_gltf=[round(hi.x, 2), round(hi.z, 2), round(-lo.y, 2)],
                          nodes=[o.name for o in objs],
                          materials=sorted({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}))
        print('BUILT %-22s lod%d tris %6d  %7.1f KB  %s  %.1fs' % (name, lod, tris, size / 1024, stats[key]['size_m'], time.time() - t0))
json.dump(stats, open(stats_path, 'w'), indent=1, sort_keys=True)
