"""Moon Cat v5 ghosts, 3D -> 2D: a real sheet ghost with a cloth simulation, rendered flat in the painting's cel style (the chimney ghost, H).
Blender 5.2.2, headless, EEVEE.

The ghost: one sheet (a polar-grid disc, about 3.5k vertices, scalloped hem, a longer flap at the back that trails like a tail) pinned over a
head sphere from the crown to just below the eyes; below that it hangs free and is simulated (soft, light, damped: it floats more than it falls).
Two hidden arm colliders under the sheet make the sleeves: one waves, both come up in front of the face when it is shy. The face (eyes, happy
arcs, blush, a small smile) sits on the head, outside the cloth.

The motion is the act itself (CR_HIDE in the Moon Cat package main.js), simulated in one continuous run along the real path: the same Hermite path the
runtime uses with a bob, sway and lean, the glances as true head turns (the whole ghost yaws, the sheet lags behind), the wave, the giggle
bounce. So the hem trails when it zips back behind the chimney and billows up when it drops. 1 Blender unit = 100 art px. Round 1 played the
pumpkin act with light cloth (gravity at a third); it read as too light, so the default is now heavy (full gravity, more mass).

Look: Diffuse -> ShaderToRGB -> constant ramp with three flat tones (and a darker inside of the sheet), Freestyle ink lines of the painting's
weight in its deep indigo, flat emissive face. The camera is orthographic and follows the smooth path (without bob), so every frame is centred
the way the runtime places it; the bob, sway and lean are in the frames.

Run (repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P <this> -- <outdir> [all | t1,t2,... (still times)] [--res 512]
      [--act chimney] [--cloth heavy | medium | light]
writes <outdir>/f####.png (12 fps, frame n = tau 0.8 + n / 12) or <outdir>/t<tau>.png; to pack them into the atlas see step 6 of docs/approaches/3d-cloth-sim-to-cel-sprite.md 
"""
import bpy, bmesh, math, sys, os, json
import numpy as np
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0]); os.makedirs(OUT, exist_ok=True)
WHAT = argv[1] if len(argv) > 1 else '3,7,9,11.5,15,17'
RES = int(argv[argv.index('--res') + 1]) if '--res' in argv else 512
ACT = argv[argv.index('--act') + 1] if '--act' in argv else 'chimney'          # chimney (the pumpkin act of round 1 was dropped)
CLOTH = argv[argv.index('--cloth') + 1] if '--cloth' in argv else 'heavy'      # heavy (picked) | medium | light (round 1)
ORTHO = 2.4                                      # 240 art px across a frame

def lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) for v in c]

# ---------------------------------------------------------------- the acts (paths in art px, the same as in creatures-v5.js; crPath, crGhostState)
# chimney: CR_HIDE in creatures-v5.js (the path point is the head):
# it slides out from behind the big chimney's left edge, looks at the cat, at you, zips back, climbs up behind it, pops up over the cap, waves at you,
# giggles and drops back down.
ACTS_DEF = {
  'chimney': dict(PTS=[[0, 3137, 640], [.8, 3132, 640], [2.0, 3010, 628], [4.6, 3006, 632], [5.2, 3132, 636], [6.3, 3134, 560], [7.6, 3136, 352],
                       [10.4, 3138, 358], [11.6, 3137, 350], [12.4, 3136, 600], [13.5, 3136, 640]],
                  ACTS=[('float', .8), ('float', 1.2), ('left', 1.4), ('you', 1.2), ('float', .6), ('float', 2.4), ('wave', 2.8), ('giggle', 1.2), ('float', 1.9)],
                  YAW={'float': -35, 'left': -68, 'you': -4, 'wave': -14, 'giggle': -20, 'shy': -12}, T_END=13.6, R=(.8, 12.8), BOB=.6),
}[ACT]
PTS, ACTS, YAW = ACTS_DEF['PTS'], ACTS_DEF['ACTS'], ACTS_DEF['YAW']
FPS, T0, T_END = 24, -2.0, ACTS_DEF['T_END']     # sim from tau -2 (settles while hidden) to the end of the act
R_FPS, (R_T0, R_T1) = 12, ACTS_DEF['R']          # rendered frames: 12 fps while it can be seen
X0, Y0 = PTS[0][1], PTS[0][2]
# cloth weight (light cloth read as too light on the first try): gravity weight, mass, air damping, turbulence, bending, tension
CLOTHS = {'light': (.32, .12, 2.4, 1.6, .35, 9), 'medium': (.62, .22, 1.5, .9, .55, 13), 'heavy': (1.0, .32, .9, .5, .8, 16)}
G_W, MASS, AIR, TURB, BEND, TENS = CLOTHS[CLOTH]
def cr_path(t):
    n = len(PTS)
    if t <= PTS[0][0]: return PTS[0][1], PTS[0][2]
    if t >= PTS[-1][0]: return PTS[-1][1], PTS[-1][2]
    i = 0
    while t > PTS[i + 1][0]: i += 1
    p0, p1 = PTS[i], PTS[i + 1]; dt = p1[0] - p0[0]; u = (t - p0[0]) / dt
    def tan(j, c):
        a, b = PTS[max(0, j - 1)], PTS[min(n - 1, j + 1)]; return (b[c] - a[c]) / max(1e-6, b[0] - a[0])
    h = u * u; h3 = h * u; A = 2 * h3 - 3 * h + 1; B = h3 - 2 * h + u; C = -2 * h3 + 3 * h; D = h3 - h
    return tuple(A * p0[k] + B * dt * tan(i, k) + C * p1[k] + D * dt * tan(i + 1, k) for k in (1, 2))
def state(t):
    px, py = cr_path(t); pa = cr_path(t - .3); pb = cr_path(t + .3); vx = (pb[0] - pa[0]) / .6
    bob = ACTS_DEF['BOB'] * (5 * math.sin(t * 2 * math.pi / 3.4) + 2 * math.sin(t * 2 * math.pi / 5.7 + 1)); swx = ACTS_DEF['BOB'] * 3 * math.sin(t * 2 * math.pi / 4.9 + .5)
    ang = max(-.06, min(.06, vx * .0012)) + .03 * math.sin(t * 2 * math.pi / 4.1 + 1.2)
    return px, py, px + swx, py + bob, ang
def art2b(x, y): return (x - X0) / 100, -(y - Y0) / 100
starts = np.cumsum([0] + [d for _, d in ACTS]); NAMES = [a for a, _ in ACTS]
def act_at(t):
    i = max(0, min(len(ACTS) - 1, int(np.searchsorted(starts, t, 'right') - 1))); return NAMES[i], t - starts[i], ACTS[i][1]
def sm(x): x = max(0., min(1., x)); return x * x * (3 - 2 * x)
# (YAW per act above: waving it turns half to us, so the waving arm clears the head)
def yaw_at(t):                                   # each act's facing, eased over 0.4 s into the next
    y = YAW[NAMES[0]]
    for k in range(1, len(ACTS)):
        y += (YAW[NAMES[k]] - YAW[NAMES[k - 1]]) * sm((t - starts[k] + .1) / .4)
    return math.radians(y)
def env(t, a, b, rise=.35):                      # 1 inside [a, b], eased at both ends
    return sm((t - a) / rise) * (1 - sm((t - b + rise) / rise))
def pose(t):
    """arm angles (rad): out = swing outward in the ghost's side plane, fwd = forward toward the face; bounce (units), happy face"""
    name, u, d = act_at(t)
    span = lambda n: (starts[NAMES.index(n)], starts[NAMES.index(n)] + ACTS[NAMES.index(n)][1]) if n in NAMES else (-99, -98)
    (wa, wb), (sa, sb), (ga, _) = span('wave'), span('shy'), span('giggle')
    w = env(t, wa, wb, .45); s = env(t, sa, sb, .4)
    rest = math.radians(24) + math.radians(4) * math.sin(t * 2 * math.pi / 3.1)
    waving = math.radians(26) * math.sin(2 * math.pi * 1.55 * (t - wa - .45)) * env(t, wa + .35, wb - .2, .3)
    cat_out = rest * (1 - s) * (1 - w) + w * (math.radians(112) + waving) - s * math.radians(8)   # the arm on the cat's side (local -x) waves out to the side; shy: both arms forward and in
    other_out = rest * (1 - s) - s * math.radians(8)
    fwd = s * math.radians(100)
    cat_fwd = fwd + w * math.radians(32)                          # the waving arm also comes a little forward, in front of the head's plane
    bounce = .035 * math.sin(2 * math.pi * 3.6 * (t - ga)) * math.exp(-1.6 * max(0, t - ga)) * (ga <= t <= ga + 1.5)
    return cat_out, other_out, fwd, cat_fwd, bounce, name == 'giggle'

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'; sc.render.fps = FPS
sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.eevee.taa_render_samples = 16; sc.render.filter_size = 1.0
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (1, 1, 1, 1); world.node_tree.nodes['Background'].inputs[1].default_value = .35
sc.gravity = (0, 0, -9.81)
# Freestyle: the outer contour and the border (the hem's edge) in the painting's deep indigo, a constant weight
sc.render.use_freestyle = True; sc.render.line_thickness_mode = 'ABSOLUTE'
vl = sc.view_layers[0]; vl.use_freestyle = True
fs = vl.freestyle_settings; fs.crease_angle = math.radians(128)
ls = fs.linesets[0] if fs.linesets else fs.linesets.new('ink')
ls.select_by_visibility = True; ls.select_by_edge_types = True
ls.select_silhouette = False; ls.select_border = True; ls.select_crease = False; ls.select_contour = False; ls.select_external_contour = True   # outer line and the hem only: inner fold lines crossed the face
ls.select_by_collection = True
ink_col = bpy.data.collections.new('inked'); sc.collection.children.link(ink_col); ls.collection = ink_col
lsty = ls.linestyle = ls.linestyle or bpy.data.linestyles.new('ink'); lsty.color = lin('#1E1A4C'); lsty.thickness = RES / 512 * 5.0; lsty.thickness_position = 'CENTER'
lsty.caps = 'ROUND'

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = ORTHO; cam.rotation_euler = (math.radians(90), 0, 0)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.data.energy = 2.6; sun.rotation_euler = Euler((math.radians(50), 0, math.radians(-40)), 'XYZ')   # from upper left, a little from the front (the moon side)

def mat_toon(name, tones, inside):
    """tones: [(threshold, hex)] from dark to light; the inside of the sheet (backfacing) gets one darker flat tone"""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    d = nt.nodes.new('ShaderNodeBsdfDiffuse'); s2r = nt.nodes.new('ShaderNodeShaderToRGB'); cr = nt.nodes.new('ShaderNodeValToRGB')
    bw = nt.nodes.new('ShaderNodeRGBToBW'); geo = nt.nodes.new('ShaderNodeNewGeometry'); mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
    cr.color_ramp.interpolation = 'CONSTANT'
    els = cr.color_ramp.elements
    while len(els) < len(tones): els.new(.5)
    for e, (th, col) in zip(els, tones): e.position = th; e.color = (*lin(col), 1)
    nt.links.new(d.outputs[0], s2r.inputs[0]); nt.links.new(s2r.outputs[0], bw.inputs[0]); nt.links.new(bw.outputs[0], cr.inputs[0])
    mix.inputs['B'].default_value = (*lin(inside), 1)
    nt.links.new(geo.outputs['Backfacing'], mix.inputs['Factor']); nt.links.new(cr.outputs[0], mix.inputs['A'])
    nt.links.new(mix.outputs['Result'], em.inputs[0]); nt.links.new(em.outputs[0], out.inputs[0])
    m.use_backface_culling = False
    return m
def mat_flat(name, col):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission'); out = nt.nodes.new('ShaderNodeOutputMaterial')
    em.inputs[0].default_value = (*lin(col), 1); nt.links.new(em.outputs[0], out.inputs[0]); return m
M_SHEET = mat_toon('sheet', [(0, '#8E97D8'), (.16, '#BAC2F0'), (.42, '#F0F2FF')], '#7880C2')
M_EYE, M_HI, M_BLUSH, M_MOUTH = mat_flat('eye', '#15123A'), mat_flat('hi', '#FFFFFF'), mat_flat('blush', '#FFA6C2'), mat_flat('mouth', '#5A2242')

def link(o, col=None): (col or sc.collection).objects.link(o); return o
def empty(name, parent=None, loc=(0, 0, 0)):
    o = link(bpy.data.objects.new(name, None)); o.parent = parent; o.location = loc; return o
root = empty('root'); yawer = empty('yawer', root)
RH = .38                                                         # head radius (38 art px)
HC = Vector((0, 0, 0))                                           # head centre = the yawer's origin

# head collider (not rendered)
bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=20, radius=RH * .97)
head = bpy.context.active_object; head.name = 'head'; head.parent = yawer; head.hide_render = True
hc = head.modifiers.new('col', 'COLLISION'); head.collision.thickness_outer = .012; head.collision.cloth_friction = 40

# arms: ellipsoid colliders hanging from shoulder pivots just under the head, at the ghost's sides (local +x = near side at the default yaw)
arms = []
for sgn in (1, -1):
    sh = empty(f'shoulder{sgn:+d}', yawer, (sgn * RH * .62, 0, -RH * .55))
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1)
    a = bpy.context.active_object; a.name = f'arm{sgn:+d}'; a.scale = (.1, .1, .2); a.parent = sh; a.location = (0, 0, -.17); a.hide_render = True
    a.modifiers.new('col', 'COLLISION'); a.collision.thickness_outer = .02; a.collision.cloth_friction = 30
    hand = empty(f'hand{sgn:+d}', sh, (0, 0, -.36))             # the arm's tip: it holds a patch of the sheet (a hook, pinned), so a raised arm lifts a sleeve
    arms.append((sgn, sh, a, hand))

# the sheet: polar grid, scalloped hem, a longer trailing flap at the back; pre-draped: the cap lies on the head down to just past the equator
NRING, NSEG = 40, 112
phis = np.linspace(0, 2 * math.pi, NSEG, endpoint=False)
FACE = 0.0                                                       # local -y = face direction (phi measured from it)
def hem(phi):
    back = max(0., math.cos(phi - math.pi)) ** 3                 # phi = pi: straight behind the face
    side = max(0., math.cos(phi - math.pi * .78)) ** 6           # the tail flap leans to one side so it reads in profile
    return 1.36 + .32 * back + .30 * side + .055 * math.cos(7 * phi + .4)
CAP = math.radians(104)
verts = [(0, 0, RH)]; faces = []; pin = [1.0]; handw = {-1: [0.], 1: [0.]}
for i in range(1, NRING + 1):
    for j, phi in enumerate(phis):
        s = hem(phi) * i / NRING                                 # arc length from the crown
        th = s / RH
        dx, dy = math.sin(phi), -math.cos(phi)                  # phi 0 = toward the face (local -y)
        if th <= CAP:
            r = RH * math.sin(th); z = RH * math.cos(th); p = (dx * r, dy * r, z)
        else:
            r0 = RH * math.sin(CAP); z0 = RH * math.cos(CAP); e = s - CAP * RH
            r = r0 + e * .30; z = z0 - e * .95                  # the skirt starts falling from just under the head, a little flared
            p = (dx * r, dy * r, z)
        verts.append(p)
        frontness = .5 + .5 * math.cos(phi)                     # the face side stays pinned a bit lower (the eyes must not lose their cloth)
        crown = 1 - sm((th - math.radians(80 + 14 * frontness)) / math.radians(26))
        for side, phi0 in ((-1, 1.5 * math.pi), (1, .5 * math.pi)): # the hand patches: at the sides, a little below where the skirt starts
            dphi = (phi - phi0 + math.pi) % (2 * math.pi) - math.pi
            hw = math.exp(-(dphi / .24) ** 2) * math.exp(-((s - CAP * RH - .45) / .09) ** 2)   # about where the hand's tip is at rest
            handw[side].append(hw if hw > .06 else 0.)
        pin.append(max(crown, handw[-1][-1], handw[1][-1]))
for j in range(NSEG): faces.append((0, 1 + j, 1 + (j + 1) % NSEG))
for i in range(1, NRING):
    for j in range(NSEG):
        a = 1 + (i - 1) * NSEG + j; b = 1 + (i - 1) * NSEG + (j + 1) % NSEG; c = 1 + i * NSEG + (j + 1) % NSEG; d = 1 + i * NSEG + j
        faces.append((a, d, c, b))
me = bpy.data.meshes.new('sheet'); me.from_pydata(verts, [], faces); me.update()
for p in me.polygons: p.use_smooth = True
sheet = link(bpy.data.objects.new('sheet', me), ink_col); sheet.parent = yawer; me.materials.append(M_SHEET)
vg = sheet.vertex_groups.new(name='pin')
for k, w in enumerate(pin):
    if w > .001: vg.add([k], float(w), 'REPLACE')
for sgn, sh, a, hand in arms: sh.rotation_euler = Euler((0, -sgn * math.radians(24), 0), 'XYZ')   # the rest pose, for binding
bpy.context.view_layer.update()
for sgn, sh, a, hand in arms:                                      # hooks before the cloth: the pinned hand patch follows the hand
    g = sheet.vertex_groups.new(name=f'hand{sgn:+d}')
    for k, w in enumerate(handw[sgn]):
        if w > 0: g.add([k], float(w), 'REPLACE')
    hk = sheet.modifiers.new(f'hook{sgn:+d}', 'HOOK'); hk.object = hand; hk.vertex_group = g.name
    hk.matrix_inverse = hand.matrix_world.inverted() @ sheet.matrix_world   # bound at the rest pose: no change until the arm moves
cl = sheet.modifiers.new('cloth', 'CLOTH'); cs = cl.settings
cs.quality = 10; cs.mass = MASS; cs.air_damping = AIR; cs.tension_stiffness = TENS; cs.compression_stiffness = TENS; cs.shear_stiffness = 6; cs.bending_stiffness = BEND
cs.vertex_group_mass = 'pin'; cs.pin_stiffness = 1.0; cs.effector_weights.gravity = G_W
cl.collision_settings.use_collision = True; cl.collision_settings.distance_min = .01; cl.collision_settings.collision_quality = 4
cl.point_cache.frame_start = 1; cl.point_cache.frame_end = int((T_END - T0) * FPS) + 2
sub = sheet.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = 1
sc.frame_start, sc.frame_end = 1, cl.point_cache.frame_end
# a slow turbulence keeps the hem alive when it hangs still
bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0)); tb = bpy.context.active_object; tb.field.strength = TURB; tb.field.size = .55; tb.field.flow = .3
tb.parent = root

# the face: on the head, a hair outside the cloth; eyes (dark ovals + highlights), happy arcs (giggle), blush, a small smile
def ellipsoid(name, mat, sx, sy, sz):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1)
    o = bpy.context.active_object; o.name = name; o.scale = (sx, sy, sz); o.data.materials.append(mat)
    for p in o.data.polygons: p.use_smooth = True
    return o
def arc(name, mat, pts, rad):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = rad; cu.bevel_resolution = 2
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for q, pt in zip(sp.points, pts): q.co = (*pt, 1)
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o); cu.materials.append(mat); return o
def on_head(o, ang, dz, out=.022):
    """place o on the head surface at angle ang round from the face and height dz, facing out"""
    r = math.sqrt(max(RH * RH - dz * dz, 0)) + out
    o.parent = yawer; o.location = (math.sin(ang) * r, -math.cos(ang) * r, dz); o.rotation_euler = (math.atan2(dz, RH) * .6, 0, ang)
eyes, his, arcs = [], [], []
for sgn in (-1, 1):
    e = ellipsoid(f'eye{sgn:+d}', M_EYE, .062, .018, .092); on_head(e, sgn * .42, -.03); eyes.append(e)      # about as big as the painted ghost's eyes
    h = ellipsoid(f'hi{sgn:+d}', M_HI, .019, .01, .025); on_head(h, sgn * .42 - .055, .015, .036); his.append(h)
    a = arc(f'arc{sgn:+d}', M_EYE, [(math.cos(t) * .058, 0, math.sin(t) * .05 - .02) for t in np.linspace(math.pi * .1, math.pi * .9, 9)], .012)
    on_head(a, sgn * .42, -.03, .028); arcs.append(a)
    b = ellipsoid(f'blush{sgn:+d}', M_BLUSH, .045, .008, .022); on_head(b, sgn * .66, -.14);
smile = arc('smile', M_MOUTH, [(math.cos(t) * .034, 0, -math.sin(t) * .02) for t in np.linspace(math.pi * .12, math.pi * .88, 9)], .008); on_head(smile, 0, -.15, .028)

# ---------------------------------------------------------------- animate (keyframes on every sim frame) and run
NF = sc.frame_end
for f in range(1, NF + 1):
    t = T0 + (f - 1) / FPS
    px, py, x, y, ang = state(t)
    bx, bz = art2b(x, y); cat_out, other_out, fwd, cat_fwd, bounce, happy = pose(t)
    root.location = (bx, 0, bz + bounce); root.rotation_euler = (0, ang, 0)   # the runtime turns the sprite clockwise for a positive angle
    root.keyframe_insert('location', frame=f); root.keyframe_insert('rotation_euler', frame=f)
    yawer.rotation_euler = (0, 0, yaw_at(t)); yawer.keyframe_insert('rotation_euler', frame=f)
    for sgn, sh, a, hand in arms:
        out, fw = (cat_out, cat_fwd) if sgn < 0 else (other_out, fwd)
        sh.rotation_euler = Euler((-fw, -sgn * out, 0), 'XYZ')  # -x rotation swings the arm forward (toward the face, -y), -/+y swings the +/-x arm outward
        sh.keyframe_insert('rotation_euler', frame=f)
for o in (root, yawer) + tuple(sh for _, sh, _, _ in arms):
    if o.animation_data and o.animation_data.action:
        for fc in getattr(o.animation_data.action, 'fcurves', []):
            for k in fc.keyframe_points: k.interpolation = 'LINEAR'

if WHAT == 'all': want = {int(round((R_T0 + n / R_FPS - T0) * FPS)) + 1: f'f{n:04d}.png' for n in range(int(round((R_T1 - R_T0) * R_FPS)) + 1)}
else: want = {int(round((float(s) - T0) * FPS)) + 1: f't{s}.png' for s in WHAT.split(',')}
last = max(want)
meta = {'act': ACT, 'cloth': CLOTH, 'fps': R_FPS, 't0': R_T0, 'ortho_art_px': ORTHO * 100, 'res': RES, 'frames': {}}
for f in range(1, last + 1):
    sc.frame_set(f)
    if f in want:
        t = T0 + (f - 1) / FPS
        px, py, *_ = state(t); cx, cz = art2b(px, py)
        cam.location = (cx, -10, cz)
        happy = pose(t)[5]
        for o in eyes + his: o.hide_render = happy
        for o in arcs: o.hide_render = not happy
        sc.render.filepath = os.path.join(OUT, want[f]); bpy.ops.render.render(write_still=True)
        meta['frames'][want[f]] = round(t, 4)
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print('done', len(want), 'frames')
