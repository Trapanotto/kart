"""Print the JSON structure summary of GLB files (nodes, meshes, primitive attributes, materials).
python tools/blender/props/glbinfo.py public/assets/models/prop.x.glb ..."""
import json, struct, sys

for path in sys.argv[1:]:
    data = open(path, 'rb').read()
    magic, ver, length = struct.unpack('<III', data[:12])
    clen, ctype = struct.unpack('<II', data[12:20])
    j = json.loads(data[20:20 + clen])
    print('==', path, len(data), 'bytes')
    print(' extensionsUsed', j.get('extensionsUsed'))
    for i, n in enumerate(j.get('nodes', [])):
        print(' node', i, n.get('name'), 'mesh', n.get('mesh'), 'children', n.get('children'), 't', n.get('translation'), 'r', n.get('rotation'))
    for m in j.get('meshes', []):
        for p in m['primitives']:
            print(' mesh', m['name'], 'mat', p.get('material'), 'attrs', sorted(p['attributes']), 'draco', 'KHR_draco_mesh_compression' in p.get('extensions', {}))
    for m in j.get('materials', []):
        print(' material', m.get('name'), json.dumps(m.get('pbrMetallicRoughness')), 'double', m.get('doubleSided'), 'emissive', m.get('emissiveFactor'), m.get('extensions'))
