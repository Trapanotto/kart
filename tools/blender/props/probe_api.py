"""Probe the Blender 5.x Python API (engines, exporter options, operators) before relying on it."""
import bpy, sys
print('VERSION', bpy.app.version_string)
print('ENGINES', [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items])
props = bpy.ops.export_scene.gltf.get_rna_type().properties
print('GLTF', [p.identifier for p in props if 'draco' in p.identifier or p.identifier in (
    'export_format', 'export_yup', 'export_apply', 'export_normals', 'export_vertex_color',
    'export_all_vertex_colors', 'export_active_vertex_color_when_no_material', 'use_selection',
    'export_extras', 'export_materials', 'export_texcoords', 'export_attributes', 'export_vertex_color_name')])
for p in props:
    if p.identifier in ('export_vertex_color', 'export_format'):
        print(p.identifier, [e.identifier for e in p.enum_items])
print('OPS shade', [o for o in dir(bpy.ops.object) if 'shade' in o])
print('MOD types', [e.identifier for e in bpy.types.Modifier.bl_rna.properties['type'].enum_items if e.identifier in ('WEIGHTED_NORMAL', 'BEVEL', 'DECIMATE', 'SMOOTH_BY_ANGLE', 'NODES')])
bpy.ops.mesh.primitive_cube_add()
o = bpy.context.object
print('MESH attrs', hasattr(o.data, 'color_attributes'), hasattr(o.data, 'use_auto_smooth'))
sc = bpy.context.scene
print('EEVEE attrs', [a for a in dir(sc.eevee) if 'shadow' in a or 'ray' in a or 'gtao' in a][:30])
print('VIEW', [e.identifier for e in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items])
print('FILEFMT', [e.identifier for e in bpy.types.ImageFormatSettings.bl_rna.properties['file_format'].enum_items])
