"""Example: TripoSR mesh of a small crab -> cleaned, upright creature with the Codex painting projected back on, rendered flat.
This is a worked example from one wallpaper, not a general tool: scene constants (art-pixel grid, camera, wave spots, the
water.png it reads at crest_fn) belong to that scene, so copy it and adapt. Expected layout of the working folder (HERE =
parent of the script's folder): mesh/, work/, renders/, blender/, rig.json.
usage (from the repo root; blender = your Blender 5.x executable):
  python docs/tools/gpu_lock.py -- blender -b --factory-startup -P <working folder>/blender/crab.py -- still [--grade G] [--elev 12] [--roll 12]
modes: still  = rest pose from the scene camera -> renders/still-<grade>.png (RGBA) and renders/model-<grade>.png (on grey, big)
Units: 1 Blender unit = 100 art px (the 1672x941 pass-1 grid). The crab faces +X (the viewer), walks along Y, Z is up.
"""
import bpy, bmesh, sys, math, json
import numpy as np
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parents[1]           # working folder (parent of blender/)
MESH = HERE / 'mesh' / 'front-r256.obj'
PROJ = HERE / 'mesh' / 'front-proj.png'              # input-rgba with the colours bled outward (projection texture)
PROJ_A = HERE / 'mesh' / 'front-input-rgba.png'
OUT = HERE / 'renders'
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MODE = argv[0] if argv else 'still'
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
ELEV = arg('--elev', 12.)      # scene camera elevation (deg)
ROLL = arg('--roll', 12.)      # crest slope: the crab's right side (screen right, +Y) is higher
GRADE = arg('--grade', 'b')
REF_ELEV = 20.                 # Codex reference was painted from about 20 deg above; TripoSR assumes 0
SPAN = .32                     # leg span in BU (32 art px, about 37 px on a 1080p screen)
OUT.mkdir(exist_ok=True)

def log(*a): print('[crab]', *a, flush=True)

def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=str(MESH), forward_axis='Y', up_axis='Z')     # TripoSR frame: input camera on +X
    ob = bpy.context.selected_objects[0]; ob.name = 'crab'
    me = ob.data
    # --- clean: merge, drop floaters, outward normals
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    seen = set(); islands = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; isl = []; seen.add(v.index)
        while stack:
            x = stack.pop(); isl.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen: seen.add(o.index); stack.append(o)
        islands.append(isl)
    islands.sort(key=len, reverse=True)
    drop = [v for isl in islands[1:] if len(isl) < 300 for v in isl]
    log('islands', [len(i) for i in islands[:8]], 'dropping', len(drop), 'verts in', sum(1 for i in islands[1:] if len(i) < 300), 'floaters')
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    # --- projection fit: which raw axes are image right/up (score = vertex colour vs painting)
    n = len(me.vertices)
    P = np.zeros(n * 3, np.float32); me.vertices.foreach_get('co', P); P = P.reshape(n, 3)
    C = np.zeros(n * 4, np.float32); me.color_attributes['Color'].data.foreach_get('color', C); C = C.reshape(n, 4)[:, :3]
    img = bpy.data.images.load(str(PROJ_A)); W, H = img.size
    A = np.array(img.pixels[:], np.float32).reshape(H, W, 4)          # bottom row first
    t = math.tan(math.radians(20.))                                  # fovy 40
    depth = 1.9 - P[:, 0]
    best = None
    for h in (1, 2):
        v = 3 - h
        for sh in (1, -1):
            for sv in (1, -1):
                u = .5 + .5 * sh * P[:, h] / (depth * t); w = .5 + .5 * sv * P[:, v] / (depth * t)
                xi = np.clip((u * W).astype(int), 0, W - 1); yi = np.clip((w * H).astype(int), 0, H - 1)
                px = A[yi, xi]
                ok = px[:, 3] > .5
                err = np.abs(px[:, :3] ** 2.2 - C).mean() if ok.mean() > .3 else 9    # painting is sRGB, colours linear-ish
                cov = ok.mean()
                log(f'axes h={h}{"+" if sh > 0 else "-"} v={v}{"+" if sv > 0 else "-"}: inside {cov:.2f} err {err:.3f}')
                if best is None or (err, -cov) < best[0]: best = ((err, -cov), h, sh, v, sv, u, w)
    _, h, sh, v, sv, U, V = best
    log('projection: image right = raw', 'xyz'[h], sh, ', image up = raw', 'xyz'[v], sv)
    # --- visibility from the reference camera: occluded points keep TripoSR's own (blurry) colour
    bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
    cam = Vector((1.9, 0, 0)); vis = np.zeros(n, np.float32)
    for i in range(n):
        p = Vector(P[i]); d = p - cam; L = d.length
        hit = bvh.ray_cast(cam, d / L, L + 1e-3)
        vis[i] = 1. if hit[0] is not None and (hit[0] - p).length < .025 else 0.   # thin legs: side points sit up to a leg radius behind the first hit
    nb = [[] for _ in range(n)]
    for e in me.edges:
        a_, b_ = e.vertices; nb[a_].append(b_); nb[b_].append(a_)
    for _ in range(3):
        vis = np.array([.5 * vis[i] + .5 * np.mean(vis[nb[i]]) if nb[i] else vis[i] for i in range(n)], np.float32)
    log('visible from the reference camera:', round(float((vis > .5).mean()), 3))
    at = me.attributes.new('vis', 'FLOAT', 'POINT'); at.data.foreach_set('value', vis)
    # match TripoSR's own colours (used where the painting can't reach) to the painting on the points both see
    U0 = np.clip((U * W).astype(int), 0, W - 1); V0 = np.clip((V * H).astype(int), 0, H - 1)
    seen_ = (vis > .9) & (A[V0, U0, 3] > .9)
    gain = (A[V0, U0, :3][seen_] ** 2.2).mean(0) / np.maximum(C[seen_].mean(0), 1e-4)
    C4 = np.zeros(n * 4, np.float32); me.color_attributes['Color'].data.foreach_get('color', C4); C4 = C4.reshape(n, 4)
    C4[:, :3] = np.clip((C4[:, :3] * gain) ** (1 / 2.2), 0, 1); me.color_attributes['Color'].data.foreach_set('color', C4.ravel())
    log('fallback colour gain', np.round(gain, 3).tolist())
    uv = me.uv_layers.new(name='proj')
    li = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', li)
    uv.data.foreach_set('uv', np.stack([U[li], V[li]], 1).ravel().astype(np.float32))
    # --- upright frame: X = toward the viewer, Z = up, then undo the reference's 20 deg view from above
    rx = Vector((1, 0, 0)); ru = Vector([0, 0, 0]); ru[v] = sv
    ry = ru.cross(rx)
    R = Matrix((rx, ry, ru)).to_4x4()                     # rows: world x, y, z expressed in raw coords
    R = Matrix.Rotation(math.radians(-REF_ELEV), 4, 'Y') @ R
    me.transform(R)
    P = np.zeros(n * 3, np.float32); me.vertices.foreach_get('co', P); P = P.reshape(n, 3)
    span = P[:, 1].max() - P[:, 1].min()
    s = SPAN / span
    me.transform(Matrix.Scale(s, 4))
    P *= s
    lo = np.percentile(P[:, 2], .5)
    me.transform(Matrix.Translation((-np.median(P[:, 0]), -(P[:, 1].max() + P[:, 1].min()) / 2, -lo)))
    me.update()
    log('scale', round(s, 4), 'size (BU)', np.round(P.max(0) - P.min(0), 3).tolist())
    return ob

GRADES = {   # emission = painting x (base + rim x warm sun rim); the rim only on faces turned toward the low sun (behind left)
    'a': dict(base=1.0, rim=0.0, sat=1.0),     # the painting as Codex made it (lit from the front)
    # first tries b, c (base .62/.48, rim .55/.70, sat .85/.75, ramp .05-.35): the ramp was so wide that half the crab got
    # brighter, and the desaturation turned it pink
    'd': dict(base=.58, rim=.60, sat=1.0, lo=.38, hi=.62),   # backlit: front in shade, a narrow warm rim
    'e': dict(base=.46, rim=.75, sat=1.0, lo=.38, hi=.62),   # darker shade, stronger rim
}

def material(ob, grade):
    g = GRADES[grade]
    m = bpy.data.materials.new('crab'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    for x in list(N): N.remove(x)
    out = N.new('ShaderNodeOutputMaterial')
    uvn = N.new('ShaderNodeUVMap'); uvn.uv_map = 'proj'
    tex = N.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(str(PROJ)); tex.extension = 'EXTEND'; tex.interpolation = 'Linear'
    Lk.new(uvn.outputs[0], tex.inputs[0])
    vc = N.new('ShaderNodeAttribute'); vc.attribute_name = 'Color'
    vg = N.new('ShaderNodeGamma'); vg.inputs[1].default_value = 2.2   # TripoSR colours are display values; the shader wants linear
    nt.links.new(vc.outputs['Color'], vg.inputs[0])
    vs = N.new('ShaderNodeAttribute'); vs.attribute_name = 'vis'
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    Lk.new(vs.outputs['Fac'], mix.inputs['Factor']); Lk.new(vg.outputs[0], mix.inputs[6]); Lk.new(tex.outputs['Color'], mix.inputs[7])
    hsv = N.new('ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = g['sat']
    Lk.new(mix.outputs[2], hsv.inputs['Color'])
    # light: a toon rim from the low sun (left and a little behind), as the painted boulder's lit left edge
    dif = N.new('ShaderNodeBsdfDiffuse'); s2r = N.new('ShaderNodeShaderToRGB')
    Lk.new(dif.outputs[0], s2r.inputs[0])
    bw = N.new('ShaderNodeRGBToBW'); Lk.new(s2r.outputs[0], bw.inputs[0])
    ramp = N.new('ShaderNodeValToRGB'); cr = ramp.color_ramp; cr.interpolation = 'EASE'
    cr.elements[0].position = g.get('lo', .05); cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = g.get('hi', .35); cr.elements[1].color = (1, 1, 1, 1)
    Lk.new(bw.outputs[0], ramp.inputs[0])
    sunc = N.new('ShaderNodeMix'); sunc.data_type = 'RGBA'; sunc.blend_type = 'MULTIPLY'
    sunc.inputs['Factor'].default_value = 1.; sunc.inputs[7].default_value = (1.0, .78, .5, 1)
    Lk.new(ramp.outputs[0], sunc.inputs[6])
    lit = N.new('ShaderNodeMix'); lit.data_type = 'RGBA'; lit.blend_type = 'MIX'
    # factor = base + rim * sun
    k = N.new('ShaderNodeVectorMath'); k.operation = 'MULTIPLY_ADD'
    Lk.new(sunc.outputs[2], k.inputs[0]); k.inputs[1].default_value = (g['rim'],) * 3; k.inputs[2].default_value = (g['base'],) * 3
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.
    Lk.new(hsv.outputs[0], mul.inputs[6]); Lk.new(k.outputs[0], mul.inputs[7])
    em = N.new('ShaderNodeEmission'); Lk.new(mul.outputs[2], em.inputs[0])
    Lk.new(em.outputs[0], out.inputs[0])
    ob.data.materials.clear(); ob.data.materials.append(m)

def scene_setup(res_x, res_y, ortho):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
    sc.render.filter_size = 1.0
    if sc.world is None: sc.world = bpy.data.worlds.new('w')
    sc.world.color = (0, 0, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    e = math.radians(ELEV)
    cam.location = Vector((5 * math.cos(e), 0, 5 * math.sin(e) + .06))
    cam.rotation_euler = (Vector((0, 0, .06)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = math.pi          # diffuse out = albedo 0.8 x cos, so the rim ramp reads cos
    d = Vector((-.45, -.88, .18)).normalized()          # toward the sun: behind (-X), left (-Y), low
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    return sc, cam

if MODE == 'export':                  # leveled mesh for the rig analysis (analyse_parts.py)
    ob = build(); me = ob.data
    n = len(me.vertices); P = np.zeros(n * 3, np.float32); me.vertices.foreach_get('co', P)
    F = np.array([list(p.vertices) for p in me.polygons], np.int64)
    vis = np.zeros(n, np.float32); me.attributes['vis'].data.foreach_get('value', vis)
    (HERE / 'work').mkdir(exist_ok=True)
    np.savez(HERE / 'work' / 'leveled.npz', P=P.reshape(n, 3), F=F, vis=vis)
    log('exported', n, 'verts')

if MODE == 'still':
    ob = build()
    ob.rotation_euler = (math.radians(ROLL), 0, 0)
    for gname in ([GRADE] if GRADE != 'all' else ['a', 'd', 'e']):
        material(ob, gname)
        sc, cam = scene_setup(256, 256, .5)            # 50 art px square at 5.12 px per art px
        sc.render.filepath = str(OUT / f'still-{gname}.png'); bpy.ops.render.render(write_still=True)
        # clean model render: bigger, grey background, three views
        sc.render.film_transparent = False; sc.world.color = (.35, .36, .38)
        sc.render.resolution_x = sc.render.resolution_y = 640; cam.data.ortho_scale = .42
        for name, az in [('front', 0), ('left', -55), ('right', 55)]:
            e = math.radians(ELEV + 8); a = math.radians(az)
            cam.location = Vector((5 * math.cos(e) * math.cos(a), 5 * math.cos(e) * math.sin(a), 5 * math.sin(e) + .06))
            cam.rotation_euler = (Vector((0, 0, .06)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = str(OUT / f'model-{gname}-{name}.png'); bpy.ops.render.render(write_still=True)
        for o in [o for o in sc.objects if o.type in ('CAMERA', 'LIGHT')]: bpy.data.objects.remove(o)
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'blender' / 'crab-still.blend'))
    log('done')

# ---------------------------------------------------------------------------------------------------------------------
# anim / test: rig from rig.json + work/rig.npz (analyse_parts.py), the act along the boulder crest, sprite frames.
# The crab's base (armature object) moves on the X = 0 plane; art px <-> world: Y = (x - XREF) / 100, Z = -(y - YREF) / (100 cos e),
# so the ortho camera (elevation ELEV) sees 1 BU = 100 art px in both image directions. Each frame is rendered with the camera
# centred on the base (+CZ up); act.json records that centre in art px per frame, and the page draws the cell there.
FPS = 30
CELL = (.56, .36)              # BU = 56 x 36 art px
PXBU = 250                     # px per BU in the frames (2.5 px per art px, about 2.2x a 1080p screen pixel)
CZ = .10                       # cell centre above the feet (BU)
# two stages: the big boulder at the right (the brief's pick) and the low dome rock in front of it, which has pale water behind
# its top instead of the dark forest reflection (the crab-2d session found the boulder's crest a poor stage at 1080p)
SPOTS = {'boulder': dict(x0=1606., x1=1574., ref=(1590., 650.), scan=(1480, 1672, 600)),
         'dome': dict(x0=1312., x1=1282., ref=(1296., 836.), scan=(1240, 1362, 815))}
SPOT = arg('--spot', 'boulder')
XREF, YREF = SPOTS[SPOT]['ref']
FEET = 2.                      # art px the feet stand behind (below) the crest line, so the crest hides the tips
HIDE = 20.                     # art px below that when hidden
GAIT = dict(T=.42, swing=.4, lift=.016)
# act (s): rise from behind the crest, pause, scuttle left, pause, raise the right claw (screen left) once, pause, duck
ACT = dict(x0=SPOTS[SPOT]['x0'], x1=SPOTS[SPOT]['x1'], rise=(.3, 1.9), walk=(2.5, 4.6), claw=(5.3, 7.4), duck=(8.1, 8.6), end=9.0)

def ease(a, b, t):
    x = min(1., max(0., (t - a) / (b - a))); return x * x * (3 - 2 * x)

def crest_fn():
    img = bpy.data.images.load(str(HERE.parents[1] / 'package' / 'water.png'))
    W_, H_ = img.size
    A_ = np.array(img.pixels[:], np.float32).reshape(H_, W_, 4)[::-1, :, 0]      # top row first
    xa, xb, y0 = SPOTS[SPOT]['scan']
    xs = np.arange(xa, xb)
    ys = np.array([y0 + np.nonzero(A_[y0:, x] < .5)[0][0] for x in xs], np.float64)
    ys = np.convolve(np.pad(ys, 8, mode='edge'), np.ones(17) / 17, mode='valid')     # smooth the mask's stair steps
    return lambda x: float(np.interp(x, xs, ys)), lambda x: float((np.interp(x + 3, xs, ys) - np.interp(x - 3, xs, ys)) / 6)

def build_rig(ob):
    rig = json.loads((HERE / 'rig.json').read_text())
    R = np.load(HERE / 'work' / 'rig.npz'); chain, spar, wfade = R['chain'], R['s'], R['w']
    sc = bpy.context.scene
    arm = bpy.data.armatures.new('rig'); ao = bpy.data.objects.new('base', arm); sc.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao; bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    body = eb.new('body'); body.head = (-.02, 0, .06); body.tail = (-.02, 0, .12)
    legs, claws = [], {}
    for c in rig['chains']:
        p = [Vector(q) for q in c['pts']]
        if c['kind'] == 'leg':
            a = eb.new(f"leg{c['id']}.a"); a.head = p[0]; a.tail = p[5]; a.parent = body
            b = eb.new(f"leg{c['id']}.b"); b.head = p[5]; b.tail = p[11]; b.parent = a; b.use_connect = True
            legs.append(c)
        else:
            claws.setdefault(c['side'], []).append(c)
    Pv = np.zeros(len(ob.data.vertices) * 3, np.float32); ob.data.vertices.foreach_get('co', Pv); Pv = Pv.reshape(-1, 3)
    for side, cs in claws.items():
        # pivot at the claw's outer root (seen from the front), so the claw swings up in the picture plane and keeps its
        # painted side to the camera; turned 90 deg about a forward-pointing arm it showed its blurry unpainted back
        cv_ = np.isin(chain, [c['id'] for c in cs]) & (wfade > .1)
        q = Pv[cv_]; o = np.argmin(q[:, 1]) if side == 'L' else np.argmax(q[:, 1])
        sh = Vector((float(q[:, 0].mean()), float(q[o, 1]) + (.012 if side == 'L' else -.012), float(q[:, 2].mean()) + .012))
        wr = sum((Vector(c['pts'][5]) for c in cs), Vector()) / len(cs)
        tp = sum((Vector(c['pts'][11]) for c in cs), Vector()) / len(cs)
        a = eb.new(f'claw{side}.arm'); a.head = sh; a.tail = wr; a.parent = body
        b = eb.new(f'claw{side}.hand'); b.head = wr; b.tail = tp; b.parent = a; b.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    # weights: body until the geodesic fade (wfade) is in, then the chain's two bones split at s ~ .45
    n = len(ob.data.vertices)
    groups = {bn.name: ob.vertex_groups.new(name=bn.name) for bn in arm.bones}
    kind = {c['id']: c for c in rig['chains']}
    def sstep(a, b, x): t = min(1., max(0., (x - a) / (b - a))); return t * t * (3 - 2 * t)
    for i in range(n):
        c = int(chain[i]); w = float(wfade[i]) if c >= 0 else 0.
        if 1 - w > 1e-4: groups['body'].add([i], 1 - w, 'REPLACE')
        if w <= 1e-4: continue
        cc = kind[c]; s = float(spar[i])
        if cc['kind'] == 'leg': na, nb = f'leg{c}.a', f'leg{c}.b'; lo, hi = .38, .52
        else:   # the claw moves as a near-rigid piece: a soft join to the body stretched into a smear when it rose 70 deg
            na, nb = f"claw{cc['side']}.arm", f"claw{cc['side']}.hand"; lo, hi = .40, .55
            w = sstep(0., .6, w)   # a short soft band at the root: it stretches into the arm when the claw lifts
            if 1 - w > 1e-4: groups['body'].add([i], 1 - w, 'REPLACE')
            if w <= 1e-4: continue
        wb = sstep(lo, hi, s)
        if (1 - wb) * w > 1e-4: groups[na].add([i], (1 - wb) * w, 'REPLACE')
        if wb * w > 1e-4: groups[nb].add([i], wb * w, 'REPLACE')
    # TripoSR fused touching legs (and the front legs with the claws) into one surface: cut every face that spans two
    # appendages, or a moving leg drags a sliver of its neighbour along (a long streak when the claw rose)
    part = np.array([(-1 if c < 0 or wfade[i] < .3 else (100 + (0 if kind[c]['side'] == 'L' else 1) if kind[c]['kind'] == 'claw' else c))
                     for i, c in enumerate(chain)])
    bm = bmesh.new(); bm.from_mesh(ob.data)
    cut = [f for f in bm.faces if len({part[v.index] for v in f.verts} - {-1}) > 1]
    bmesh.ops.delete(bm, geom=cut, context='FACES_ONLY')
    bm.to_mesh(ob.data); bm.free()
    log('cut', len(cut), 'faces between appendages')
    ob.parent = ao
    mod = ob.modifiers.new('arm', 'ARMATURE'); mod.object = ao
    # IK: one target empty per leg, the standard solver from the rest pose, no pole (small steps keep the knee plane)
    targets = {}
    for c in legs:
        t = bpy.data.objects.new(f"tgt{c['id']}", None); sc.collection.objects.link(t)
        pb = ao.pose.bones[f"leg{c['id']}.b"]
        k = pb.constraints.new('IK'); k.target = t; k.chain_count = 2; k.use_stretch = False
        targets[c['id']] = (t, Vector(c['pts'][11]))
    log('rig:', len(legs), 'legs,', {s: len(v) for s, v in claws.items()}, 'claw chains')
    return ao, legs, targets, list(claws)

def act_state(t, crest, slope):
    """base pose at act time t: art position of the feet line, roll (crest slope), pitch (climbing), grip (feet planted)."""
    e = math.radians(ELEV)
    r0, r1 = ACT['rise']; w0, w1 = ACT['walk']; d0, d1 = ACT['duck']
    x = ACT['x0'] + (ACT['x1'] - ACT['x0']) * ease(w0, w1, t)
    up = ease(r0, r1, t) * (1 - ease(d0, d1, t))
    y = crest(x) + FEET + HIDE * (1 - up)
    pitch = -math.radians(24) * (1 - ease(r0, r1, t)) - math.radians(14) * ease(d0, d1, t)   # front up while on the far slope
    roll = math.atan(-slope(x) / math.cos(e))
    loc = Vector((0, (x - XREF) / 100, -(y - YREF) / (100 * math.cos(e))))
    M = Matrix.Translation(loc) @ Matrix.Rotation(roll, 4, 'X') @ Matrix.Rotation(pitch, 4, 'Y')
    return M, x, y, t < d0 - .05

def art_of(v):                     # world point on (near) the X = 0 plane -> art px (ortho view at ELEV)
    e = math.radians(ELEV)
    zi = v.z * math.cos(e) - v.x * math.sin(e)          # image-up component
    return XREF + 100 * v.y, YREF - 100 * zi

def leg_targets(t, legs, targets, crest, slope):
    """planted feet: each leg steps with period T, phase by tetrapod group; a step plants where the rest foot is at mid-stance."""
    T, sw, LH = GAIT['T'], GAIT['swing'], GAIT['lift']
    out = {}
    M, _x, _y, grip = act_state(t, crest, slope)
    for c in legs:
        lid = c['id']; tgt, rest = targets[lid]
        if not grip:
            out[lid] = M @ rest; continue
        # tetrapod: alternate groups across sides and along the leg row (front-to-back order by rest x)
        order = sorted([q for q in legs if q['side'] == c['side']], key=lambda q: -q['pts'][11][0]).index(c)
        ph = ((order % 2) + (1 if c['side'] == 'R' else 0)) % 2 * .5 + .04 * ((lid * 7) % 5)
        k = math.floor(t / T - ph); tk = (k + ph) * T
        def plant(kk):
            tm = (kk + ph) * T + sw * T + (1 - sw) * T / 2
            return act_state(tm, crest, slope)[0] @ rest
        u = (t - tk) / T
        if u < sw:
            a_, b_ = plant(k - 1), plant(k); s_ = u / sw
            amt = min(1., (b_ - a_).length / .006)
            upv = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
            out[lid] = a_.lerp(b_, s_ * s_ * (3 - 2 * s_)) + upv * LH * amt * math.sin(math.pi * s_)
        else:
            out[lid] = plant(k)
    return out

def claw_pose(ao, side, t):
    """raise the claw once: up about 70 deg, one slow wave, back down."""
    c0, c1 = ACT['claw']
    up = ease(c0, c0 + .55, t) * (1 - ease(c1 - .6, c1, t))
    wave = math.sin(math.pi * 2 * ease(c0 + .6, c1 - .7, t)) * ease(c0 + .5, c0 + .7, t) * (1 - ease(c1 - .75, c1 - .6, t))
    pa = ao.pose.bones[f'claw{side}.arm']; ph = ao.pose.bones[f'claw{side}.hand']
    def rot_local(pb, axis_arm, ang):
        B = pb.bone.matrix_local.to_3x3()
        ax = (B.inverted() @ axis_arm).normalized()
        return Matrix.Rotation(ang, 3, ax).to_quaternion()
    # swing the claw up in the picture plane about its outer root (rotation about X, the view axis), then one wave
    sgn = 1 if side == 'L' else -1
    R = Quaternion(Vector((1, 0, 0)), sgn * (math.radians(55) * up + math.radians(16) * wave)).to_matrix()
    B = pa.bone.matrix_local.to_3x3()
    pa.rotation_mode = 'QUATERNION'; pa.rotation_quaternion = (B.inverted() @ R @ B).to_quaternion()
    # lift the whole claw up and out beside the shell, so at 35 px it shows against the water (a rotation alone kept it
    # inside the crab's outline and the wave did not read at all)
    pa.location = B.inverted() @ (Vector((0, -.04 * sgn, .075)) * up)
    ph.rotation_mode = 'QUATERNION'; ph.rotation_quaternion = Quaternion()
    return up

def body_pose(ao, t, up_claw, claw_side):
    w0, w1 = ACT['walk']
    walking = ease(w0, w0 + .3, t) * (1 - ease(w1 - .3, w1, t))
    bob = .0035 * walking * abs(math.sin(math.pi * t / GAIT['T']))
    pb = ao.pose.bones['body']
    pb.location = (0, bob, 0)                                        # bone-local y = world up for the body bone
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = (0, math.radians(5) * up_claw * (1 if claw_side == 'L' else -1), 0)

if MODE in ('anim', 'test'):
    ob = build()
    material(ob, GRADE if GRADE in GRADES else 'd')
    crest, slope = crest_fn()
    ao, legs, targets, claw_sides = build_rig(ob)
    WAVE = 'L' if 'L' in claw_sides else claw_sides[0]               # L = -Y = screen left = the crab's own right claw
    rx, ry = round(CELL[0] * PXBU), round(CELL[1] * PXBU)
    sc, cam = scene_setup(rx, ry, CELL[0])
    big = MODE == 'test'
    if big: sc.render.resolution_x, sc.render.resolution_y = rx * 4, ry * 4
    e = math.radians(ELEV); view = Vector((math.cos(e), 0, math.sin(e)))
    times = [float(x) for x in arg('--times', '0.5,1.2,2.0,3.0,3.2,3.4,5.0,6.0,6.6,8.3').split(',')] if big else \
        [i / FPS for i in range(int(ACT['end'] * FPS) + 1)]
    fdir = OUT / ('test' if big else f'frames-{SPOT}'); fdir.mkdir(parents=True, exist_ok=True)
    for old in fdir.glob('*.png'): old.unlink()
    frames = []
    for i, t in enumerate(times):
        M, x, y, grip = act_state(t, crest, slope)
        ao.matrix_world = M
        for lid, p in leg_targets(t, legs, targets, crest, slope).items(): targets[lid][0].location = p
        up_c = claw_pose(ao, WAVE, t)
        body_pose(ao, t, up_c, WAVE)
        bpy.context.view_layer.update()
        if big:
            for bn in (f'claw{WAVE}.arm', f'claw{WAVE}.hand'):
                pb = ao.pose.bones[bn]; log(f't {t:.2f} {bn}: rest head {tuple(round(v, 3) for v in pb.bone.head_local)} tail {tuple(round(v, 3) for v in pb.bone.tail_local)} -> posed tail {tuple(round(v, 3) for v in pb.tail)}')
        c = M.translation + Vector((0, 0, CZ))
        cam.location = c + view * 5; cam.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
        cx, cy = art_of(c)
        sc.render.filepath = str(fdir / (f't{t:.2f}.png' if big else f'f{i:04d}.png'))
        bpy.ops.render.render(write_still=True)
        frames.append([round(cx, 3), round(cy, 3)])
    if not big:
        (HERE / f'act-{SPOT}.json').write_text(json.dumps(dict(spot=SPOT, fps=FPS, cell_art=[CELL[0] * 100, CELL[1] * 100], cell_px=[rx, ry],
            act=ACT, feet=FEET, hide=HIDE, centres=frames)))
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / 'blender' / f'crab-{MODE}-{SPOT}.blend'))
    log('rendered', len(times), 'frames to', fdir.name)
