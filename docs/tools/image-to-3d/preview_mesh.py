"""Six-view Workbench preview of a TripoSR mesh with its vertex colours (and one plain-grey row for the shape).
usage: blender -b --factory-startup -P preview_mesh.py -- <mesh.obj> <out.png>"""
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src, forward_axis='Y', up_axis='Z')   # keep TripoSR's frame: z up, input camera on +x
ob = bpy.context.selected_objects[0]
me = ob.data
print('attrs', [(a.name, a.domain, a.data_type) for a in me.attributes], 'colors', [c.name for c in me.color_attributes])
sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = sc.render.resolution_y = 400
sc.render.film_transparent = False
sh = sc.display.shading
sh.light = 'FLAT'; sh.color_type = 'VERTEX'
sc.world = bpy.data.worlds.new('w'); sc.world.color = (.25, .27, .3)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.1
views = [('+X', (3, 0, 0)), ('-X', (-3, 0, 0)), ('+Y', (0, 3, 0)), ('-Y', (0, -3, 0)), ('+Z', (0, 0, 3)), ('-Z', (0, 0, -3))]
import os, tempfile
tmp = tempfile.mkdtemp()
paths = []
for mode in ['VERTEX', 'SINGLE']:
    sh.color_type = mode; sh.light = 'FLAT' if mode == 'VERTEX' else 'STUDIO'
    for name, pos in views:
        cam.location = Vector(pos)
        d = -Vector(pos)
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()   # camera -Z looks along d, its Y is image up
        p = os.path.join(tmp, f'{mode}{name}.png'); sc.render.filepath = p
        bpy.ops.render.render(write_still=True); paths.append((mode + name, p))
# grid
imgs = [bpy.data.images.load(p) for _, p in paths]
W = 400; cols = 6; rows = 2
outimg = bpy.data.images.new('grid', W * cols, W * rows)
import numpy as np
buf = np.zeros((W * rows, W * cols, 4), np.float32)
for i, im in enumerate(imgs):
    a = np.array(im.pixels[:]).reshape(W, W, 4)
    r, c = i // cols, i % cols
    buf[(rows - 1 - r) * W:(rows - r) * W, c * W:(c + 1) * W] = a
outimg.pixels = buf.ravel()
outimg.filepath_raw = out; outimg.file_format = 'PNG'; outimg.save()
print('views', [n for n, _ in paths])
