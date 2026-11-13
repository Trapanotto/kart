"""Probe: metaball -> mesh, bmesh bevel, colour layers, EEVEE background render, view transforms."""
import bpy, bmesh, sys, os, time
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
mb = bpy.data.metaballs.new('mb'); mb.resolution = 0.2; mb.render_resolution = 0.2
ob = bpy.data.objects.new('mb', mb); sc.collection.objects.link(ob)
for p in [(0, 0, 0), (0.8, 0, 0.2), (-0.5, 0.4, 0.3)]:
    e = mb.elements.new(); e.co = p; e.radius = 1.0
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
print('META verts', len(me.vertices), 'polys', len(me.polygons))
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
r = bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=0.1, segments=2, affect='EDGES', profile=0.5)
print('BEVEL faces', len(bm.faces))
print('LAYERS', dir(bm.loops.layers))
m2 = bpy.data.meshes.new('c'); bm.to_mesh(m2)
print('mesh methods', [a for a in dir(m2) if 'sharp' in a or 'smooth' in a or 'normals' in a])
print('VIEW', [e.identifier for e in sc.view_settings.bl_rna.properties['view_transform'].enum_items])
print('LOOKS', [e.identifier for e in sc.view_settings.bl_rna.properties['look'].enum_items][:12])
o2 = bpy.data.objects.new('c', m2); sc.collection.objects.link(o2)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
cam.location = (4, -4, 3); cam.rotation_euler = (1.1, 0, 0.78); sc.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 320; sc.render.resolution_y = 240
sc.render.filepath = out; sc.render.image_settings.file_format = 'PNG'
t = time.time(); bpy.ops.render.render(write_still=True); print('EEVEE render s', time.time() - t)
