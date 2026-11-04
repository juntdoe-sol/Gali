"""
Gali 3D cartoon short: the miner walks onto ORE Island, cracks a glowing ORE rock in three swings,
it bursts into gems, he celebrates and the GALI wordmark pops in. 10 s at 24 fps.

    blender -b --factory-startup --python build_scene.py -- <out_dir> stills 40 66 122 160 230
    blender -b --factory-startup --python build_scene.py -- <out_dir> anim
"""
import bpy, bmesh, sys, os, math, random
from math import radians, sin, cos, sqrt, pi
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])
MODE = argv[1] if len(argv) > 1 else "stills"
STILLS = [int(a) for a in argv[2:]] or [40, 66, 122, 160, 230]
VERTICAL = os.environ.get("GALI_ASPECT", "h") == "v"   # GALI_ASPECT=v renders 9:16 for phones
SUFFIX = "_v" if VERTICAL else ""
HERE = os.path.dirname(os.path.abspath(__file__))
WORDMARK = os.path.join(HERE, "..", "public", "wordmark.png")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COL = scene.collection
PREFS = bpy.context.preferences
FPS, END = 24, 240
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, END

# ---------------------------------------------------------------- helpers
def hexc(h, a=1.0):
    h = h.lstrip("#")
    s = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in s) + (a,)

def setin(node, name, val):
    if name in node.inputs:
        node.inputs[name].default_value = val

def mat(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0, sss=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    setin(b, "Base Color", hexc(color))
    setin(b, "Roughness", rough)
    setin(b, "Metallic", metal)
    setin(b, "Coat Weight", coat)
    if sss:
        setin(b, "Subsurface Weight", sss)
        setin(b, "Subsurface Radius", (0.6, 0.3, 0.2))
        setin(b, "Subsurface Scale", 0.05)
    if emit:
        setin(b, "Emission Color", hexc(emit))
        setin(b, "Emission Strength", strength)
    return m

def K(target, path, frame, value=None, interp="BEZIER"):
    """Set target.path = value and key it."""
    PREFS.edit.keyframe_new_interpolation_type = interp
    if value is not None:
        cur = getattr(target, path)
        if hasattr(cur, "__len__") and not isinstance(value, (int, float)):
            setattr(target, path, value)
        else:
            setattr(target, path, value)
    target.keyframe_insert(path, frame=frame)

def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.2
    e.location = loc
    COL.objects.link(e)
    if parent:
        e.parent = parent
    return e

def finish(o, m, parent, smooth=True):
    if m:
        o.data.materials.append(m)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    if parent:
        o.parent = parent
    return o

def sphere(name, loc, scale, m, parent=None, rot=(0, 0, 0), seg=40):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1, location=loc)
    o = bpy.context.active_object
    o.name, o.scale, o.rotation_euler = name, scale, rot
    return finish(o, m, parent)

def ico(name, loc, scale, m, parent=None, sub=2, smooth=False, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    o = bpy.context.active_object
    o.name, o.scale, o.rotation_euler = name, scale, rot
    return finish(o, m, parent, smooth)

def cone(name, loc, r1, r2, depth, m, parent=None, rot=(0, 0, 0), scale=(1, 1, 1), verts=32):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name, o.rotation_euler, o.scale = name, rot, scale
    return finish(o, m, parent)

def cyl(name, loc, r, depth, m, parent=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=depth, location=loc)
    o = bpy.context.active_object
    o.name, o.rotation_euler = name, rot
    return finish(o, m, parent)

def limb(name, p1, p2, r, m, parent=None, r2=None):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=r, depth=d.length, location=(p1 + p2) / 2)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=r, radius2=r2, depth=d.length, location=(p1 + p2) / 2)
    o = bpy.context.active_object
    o.name = name
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    return finish(o, m, parent)

def octa(name, m, scale):
    me = bpy.data.meshes.new(name)
    v = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1.5), (0, 0, -1.5)]
    f = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    me.from_pydata(v, [], f)
    me.update()
    o = bpy.data.objects.new(name, me)
    COL.objects.link(o)
    o.scale = (scale,) * 3
    me.materials.append(m)
    return o

# island surface: a wide flattened ellipsoid
IC, IR = Vector((0, 0, -0.95)), Vector((9.0, 6.5, 1.1))
def ground(x, y):
    t = 1 - (x / IR.x) ** 2 - (y / IR.y) ** 2
    return IC.z + IR.z * sqrt(t) if t > 0 else -0.35

# ---------------------------------------------------------------- materials
M = dict(
    skin=mat("Skin", "#b0703f", 0.55, sss=0.2),
    skin2=mat("SkinNose", "#9e6034", 0.5, sss=0.2),
    eye=mat("EyeWhite", "#ffffff", 0.15, coat=0.6),
    pupil=mat("Pupil", "#14101e", 0.1, coat=1.0),
    hi=mat("EyeShine", "#ffffff", 0.1, emit="#ffffff", strength=4),
    brow=mat("Brow", "#2e1c14", 0.7),
    mouth=mat("Mouth", "#4a1520", 0.6),
    helmet=mat("Helmet", "#ffc400", 0.4, emit="#ffb000", strength=0.05),
    lampbody=mat("LampBody", "#3a3a48", 0.4, metal=0.6),
    lamplens=mat("LampLens", "#fff3c0", 0.1, emit="#fff3c0", strength=12),
    shirt=mat("Shirt", "#c94a3a", 0.6),
    overalls=mat("Overalls", "#2f5fd0", 0.55),
    button=mat("Button", "#ffc83d", 0.25, metal=1.0),
    boot=mat("Boot", "#5a3a24", 0.5),
    glove=mat("Glove", "#8a5a34", 0.6),
    wood=mat("Handle", "#8a5a34", 0.6),
    pick=mat("PickGold", "#ffc83d", 0.22, metal=1.0, emit="#ffb000", strength=0.15),
    rock=mat("Rock", "#6b6280", 0.85),
    rockdark=mat("RockDark", "#4b4560", 0.9),
    crystal=mat("OreCrystal", "#3de0c8", 0.1, emit="#3de0c8", strength=6),
    gold=mat("Gold", "#ffc83d", 0.18, metal=1.0, emit="#ffa800", strength=1.2),
    spark=mat("Spark", "#fff1a0", 0.2, emit="#ffe070", strength=25),
    trunk=mat("PalmTrunk", "#8b6a45", 0.8),
    leaf=mat("PalmLeaf", "#3a9a4a", 0.55, sss=0.1),
    leaf2=mat("PalmLeafDark", "#2b7a3c", 0.55),
    coconut=mat("Coconut", "#5a3a24", 0.6),
    bush=mat("Bush", "#3f8f45", 0.7),
    moon=mat("Moon", "#fff2c8", 0.5, emit="#fff2c8", strength=6),
    flame=mat("Flame", "#ffb040", 0.5, emit="#ff9a30", strength=20),
    torchwood=mat("TorchWood", "#6b4a32", 0.8),
    farisle=mat("FarIsland", "#3a5a6a", 0.9),
)

# sand with gentle colour noise
sand = bpy.data.materials.new("Sand")
sand.use_nodes = True
nt = sand.node_tree
bsdf = nt.nodes["Principled BSDF"]
noise = nt.nodes.new("ShaderNodeTexNoise")
setin(noise, "Scale", 3.0)
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = hexc("#dcb47a")
ramp.color_ramp.elements[1].color = hexc("#f2d7a0")
nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
nt.links.new(ramp.outputs[0], bsdf.inputs["Base Color"])
setin(bsdf, "Roughness", 0.95)

# ---------------------------------------------------------------- world: dusk sky
world = bpy.data.worlds.new("Dusk")
scene.world = world
world.use_nodes = True
wn = world.node_tree
tc = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
ma = wn.nodes.new("ShaderNodeMath")
ma.operation = "MULTIPLY_ADD"
ma.inputs[1].default_value = 0.5
ma.inputs[2].default_value = 0.5
sky = wn.nodes.new("ShaderNodeValToRGB")
els = sky.color_ramp.elements
els[0].position, els[0].color = 0.0, hexc("#1a1440")
els[1].position, els[1].color = 1.0, hexc("#191446")
for pos, c in ((0.5, "#ffa36b"), (0.53, "#ff8a7a"), (0.6, "#c4609a"), (0.74, "#5a44a8")):
    e = els.new(pos)
    e.color = hexc(c)
wn.links.new(tc.outputs["Generated"], sep.inputs[0])
wn.links.new(sep.outputs["Z"], ma.inputs[0])
wn.links.new(ma.outputs[0], sky.inputs[0])
wn.links.new(sky.outputs[0], wn.nodes["Background"].inputs[0])
wn.nodes["Background"].inputs[1].default_value = 0.9

# ---------------------------------------------------------------- environment
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1, location=IC)
isl = bpy.context.active_object
isl.name, isl.scale = "Island", IR
finish(isl, sand, None)

bpy.ops.mesh.primitive_grid_add(x_subdivisions=160, y_subdivisions=160, size=180, location=(0, 0, 0.0))
sea = bpy.context.active_object
sea.name = "Sea"
sea_m = mat("Sea", "#1d3f86", 0.08, coat=0.3)
finish(sea, sea_m, None)
wave = sea.modifiers.new("Waves", "WAVE")
wave.height, wave.width, wave.speed, wave.narrowness = 0.05, 1.6, 0.04, 1.2

sphere("Moon", (13, 48, 14), (2.4, 2.4, 2.4), M["moon"])
for i, (x, y, s) in enumerate(((-26, 38, 5), (22, 30, 3.5), (-8, 55, 7))):
    sphere(f"FarIsland_{i}", (x, y, -0.6), (s, s * 0.6, s * 0.28), M["farisle"])

def palm(name, x, y, height=2.7, lean=(0.5, 0.15), phase=0.0):
    g = ground(x, y)
    root = empty(name, (x, y, g))
    pts = []
    n = 8
    for i in range(n + 1):
        t = i / n
        pts.append(Vector((lean[0] * t * t, lean[1] * t * t, height * t)))
    for i in range(n):
        r1 = 0.17 - 0.07 * (i / n)
        limb(f"{name}_trunk{i}", pts[i], pts[i + 1] + (pts[i + 1] - pts[i]) * 0.08, r1, M["trunk"], root, r2=r1 * 0.88)
    crown = empty(f"{name}_crown", pts[-1], root)
    for k in range(8):
        a = k / 8 * 2 * pi + phase
        lm = M["leaf"] if k % 2 else M["leaf2"]
        leaf = cone(f"{name}_leaf{k}", (0, 0, 0), 0.26, 0.0, 1.6, lm, crown, scale=(1, 0.22, 1))
        leaf.rotation_euler = Euler((radians(115), 0, a + pi / 2))
        d = Vector((cos(a), sin(a), -0.35)).normalized()
        leaf.location = d * 0.72
    for k in range(3):
        a = k / 3 * 2 * pi
        sphere(f"{name}_coco{k}", (0.12 * cos(a), 0.12 * sin(a), -0.12), (0.1, 0.1, 0.1), M["coconut"], crown)
    # gentle sway
    for f in range(1, END + 1, 16):
        s = sin(f / 16 * 1.3 + phase)
        K(crown, "rotation_euler", f, (radians(4 * s), radians(3 * cos(f / 16 * 1.3 + phase)), 0))
    return root

palm("PalmA", -3.6, 2.4, 2.9, (0.6, 0.2), 0.3)
palm("PalmB", 2.7, 2.5, 3.1, (-0.4, 0.3), 1.4)
palm("PalmC", 4.9, 0.3, 2.4, (0.7, -0.1), 2.2)
palm("PalmD", -6.2, 0.6, 2.2, (-0.6, 0.0), 3.1)

for i, (x, y, s) in enumerate(((-2.5, 2.9, 0.45), (1.6, 2.8, 0.5), (3.9, 1.6, 0.4), (-5.0, 1.8, 0.38), (5.6, -1.4, 0.35), (-1.2, 3.4, 0.4))):
    sphere(f"Bush_{i}", (x, y, ground(x, y) + s * 0.4), (s * 1.3, s, s * 0.8), M["bush"])
for i, (x, y, s) in enumerate(((-1.9, -1.6, 0.18), (2.4, -1.2, 0.22), (-4.0, -0.6, 0.15), (1.2, 1.6, 0.14))):
    ico(f"Pebble_{i}", (x, y, ground(x, y) + s * 0.3), (s * 1.4, s, s * 0.8), M["rockdark"], sub=1)

torches = []
for i, (x, y) in enumerate(((-1.9, 1.5), (2.1, 1.1))):
    g = ground(x, y)
    t = empty(f"Torch_{i}", (x, y, g))
    limb(f"Torch_{i}_pole", (0, 0, 0), (0, 0, 1.25), 0.04, M["torchwood"], t)
    cyl(f"Torch_{i}_cup", (0, 0, 1.3), 0.08, 0.14, M["torchwood"], t)
    fl = cone(f"Torch_{i}_flame", (0, 0, 1.47), 0.07, 0.0, 0.26, M["flame"], t)
    ld = bpy.data.lights.new(f"TorchLight_{i}", "POINT")
    ld.color, ld.energy, ld.shadow_soft_size = hexc("#ff9a40")[:3], 60, 0.15
    lo = bpy.data.objects.new(f"TorchLight_{i}", ld)
    lo.location = (0, 0, 1.55)
    COL.objects.link(lo)
    lo.parent = t
    for f in range(1, END + 1, 3):
        K(ld, "energy", f, 45 + random.random() * 35)
        K(fl, "scale", f, (1, 1, 0.85 + random.random() * 0.35))

# ---------------------------------------------------------------- the miner
D_WALK, D_WORK, D_CHEER = 76.0, 90.0, 22.0
M_POS = Vector((-0.4, 0.25))
root = empty("Miner", (0, 0, 0))
root.rotation_euler = (0, 0, radians(D_WORK))
body = empty("MinerBody", (0, 0, 0), root)

hips = {}
for side, sx in (("L", 1), ("R", -1)):
    h = empty(f"Hip_{side}", (0.13 * sx, 0, 0.45), body)
    limb(f"Leg_{side}", (0, 0, 0.02), (0, 0, -0.3), 0.085, M["overalls"], h)
    sphere(f"Boot_{side}", (0, -0.05, -0.36), (0.12, 0.17, 0.09), M["boot"], h)
    hips[side] = h

sphere("Overalls", (0, 0, 0.66), (0.37, 0.32, 0.36), M["overalls"], body)
sphere("Shirt", (0, 0.01, 0.88), (0.33, 0.29, 0.24), M["shirt"], body)
sphere("Bib", (0, -0.2, 0.8), (0.22, 0.12, 0.17), M["overalls"], body)
for sx in (1, -1):
    sphere(f"Button_{'L' if sx > 0 else 'R'}", (0.13 * sx, -0.3, 0.88), (0.035, 0.02, 0.035), M["button"], body)
    limb(f"Strap_{'L' if sx > 0 else 'R'}", (0.13 * sx, -0.29, 0.88), (0.15 * sx, 0.05, 1.06), 0.03, M["overalls"], body)

head = empty("HeadPivot", (0, 0, 1.02), body)
sphere("Head", (0, 0, 0.3), (0.37, 0.35, 0.36), M["skin"], head)
for sx in (1, -1):
    sphere(f"Ear_{'L' if sx > 0 else 'R'}", (0.36 * sx, 0.02, 0.28), (0.06, 0.05, 0.085), M["skin"], head)
sphere("Nose", (0, -0.37, 0.24), (0.085, 0.08, 0.075), M["skin2"], head)
mouth = sphere("Mouth", (0, -0.305, 0.115), (0.12, 0.06, 0.035), M["mouth"], head)
eyes, brows = [], []
for side, sx in (("L", 1), ("R", -1)):
    e = empty(f"Eye_{side}", (0.125 * sx, -0.29, 0.36), head)
    sphere(f"EyeWhite_{side}", (0, 0, 0), (0.095, 0.07, 0.115), M["eye"], e)
    sphere(f"Pupil_{side}", (-0.012 * sx, -0.062, -0.01), (0.05, 0.022, 0.06), M["pupil"], e)
    sphere(f"EyeShine_{side}", (0.0, -0.084, 0.025), (0.016, 0.01, 0.016), M["hi"], e)
    eyes.append(e)
    b = sphere(f"Brow_{side}", (0.13 * sx, -0.31, 0.5), (0.085, 0.03, 0.026), M["brow"], head, rot=(0, radians(-10) * sx, 0))
    brows.append(b)
hat = empty("Hat", (0, 0, 0.4), head)
sphere("HelmetDome", (0, 0.01, 0.0), (0.395, 0.385, 0.3), M["helmet"], hat)
sphere("HelmetBrim", (0, -0.05, -0.04), (0.45, 0.48, 0.035), M["helmet"], hat)
limb("HelmetRidge", (0, -0.3, 0.17), (0, 0.3, 0.17), 0.04, M["helmet"], hat)
cyl("LampBody", (0, -0.37, 0.07), 0.075, 0.07, M["lampbody"], hat, rot=(radians(90), 0, 0))
cyl("LampLens", (0, -0.408, 0.07), 0.058, 0.012, M["lamplens"], hat, rot=(radians(90), 0, 0))
spot_d = bpy.data.lights.new("Headlamp", "SPOT")
spot_d.energy, spot_d.spot_size, spot_d.spot_blend, spot_d.color = 120, radians(42), 0.6, hexc("#fff0c8")[:3]
spot_d.shadow_soft_size = 0.05
spot = bpy.data.objects.new("Headlamp", spot_d)
spot.location, spot.rotation_euler = (0, -0.42, 0.07), (radians(-100), 0, 0)
COL.objects.link(spot)
spot.parent = hat

# Right arm swings the pickaxe. Its pivot is the right shoulder and the hand sits out at the side,
# beyond the helmet brim, so the hand, handle and pick never pass through the head or hat.
GRIP_X = -0.27                       # hand offset from the shoulder, outward
arms = empty("ArmPivot", (-0.33, 0, 0.92), body)
sphere("Shoulder_R", (0, 0, 0), (0.1, 0.1, 0.1), M["shirt"], arms)
limb("Arm_R", (0, 0, 0), (GRIP_X, -0.46, 0), 0.07, M["skin"], arms)
limb("Sleeve_R", (0, 0, 0), (GRIP_X * 0.3, -0.14, 0), 0.085, M["shirt"], arms)
sphere("Glove_R", (GRIP_X, -0.47, 0), (0.09, 0.09, 0.09), M["glove"], arms)
limb("PickHandle", (GRIP_X, -0.22, 0), (GRIP_X, -1.22, 0), 0.036, M["wood"], arms)
sphere("PickHub", (GRIP_X, -1.22, 0), (0.06, 0.075, 0.085), M["lampbody"], arms)
for s in (1, -1):
    blade = cone(f"PickBlade_{'up' if s > 0 else 'dn'}", (GRIP_X, -1.2, 0.17 * s), 0.065, 0.0, 0.34, M["pick"], arms,
                 scale=(1, 0.75, 1))
    blade.rotation_euler = (radians(-14) if s > 0 else pi + radians(14), 0, 0)

# Left arm is free: it swings when he walks, goes out for balance and pumps a fist at the end.
free = empty("ArmPivot_L", (0.33, 0, 0.92), body)
sphere("Shoulder_L", (0, 0, 0), (0.1, 0.1, 0.1), M["shirt"], free)
limb("Sleeve_L", (0, 0, 0), (0.02, 0, -0.14), 0.085, M["shirt"], free)
limb("Arm_L", (0, 0, 0), (0.05, 0, -0.42), 0.07, M["skin"], free)
sphere("Glove_L", (0.05, 0, -0.47), (0.09, 0.09, 0.09), M["glove"], free)

def place(f, xy, z_off=0.0, interp="BEZIER"):
    K(root, "location", f, (xy[0], xy[1], ground(xy[0], xy[1]) + z_off), interp)

def pose(f, swing=None, lean=None, sq=None, interp="BEZIER", left=None):
    """left = (forward/back, out to the side) in degrees for the free arm; negative side raises it outward."""
    if left is not None:
        K(free, "rotation_euler", f, (radians(left[0]), radians(left[1]), 0), interp)
    if swing is not None:
        K(arms, "rotation_euler", f, (radians(swing), 0, 0), interp)
    if lean is not None:
        K(body, "rotation_euler", f, (radians(lean), 0, 0), interp)
    if sq is not None:
        K(root, "scale", f, sq, interp)

def blink(f):
    for e in eyes:
        K(e, "scale", f - 2, (1, 1, 1))
        K(e, "scale", f, (1, 1, 0.08))
        K(e, "scale", f + 2, (1, 1, 1))

# ---- walk in (frames 1-44), pickaxe on the shoulder
P0 = Vector((-4.6, 1.38))
for f in range(1, 45):
    t = (f - 1) / 43
    p = P0.lerp(M_POS, t)
    bob = 0.07 * abs(sin(pi * f / 6))
    place(f, p, bob, "LINEAR")
    sw = 32 * sin(2 * pi * f / 12)
    K(hips["L"], "rotation_euler", f, (radians(sw), 0, 0))
    K(hips["R"], "rotation_euler", f, (radians(-sw), 0, 0))
    K(head, "rotation_euler", f, (radians(3 * sin(2 * pi * f / 12)), 0, radians(4 * sin(2 * pi * f / 24))))
    K(arms, "rotation_euler", f, (radians(-112 + 5 * sin(2 * pi * f / 6)), 0, 0))
    K(free, "rotation_euler", f, (radians(-0.8 * sw), radians(-12), 0))
K(root, "rotation_euler", 1, (0, 0, radians(D_WALK)))
K(root, "rotation_euler", 44, (0, 0, radians(D_WALK)))
K(root, "rotation_euler", 50, (0, 0, radians(D_WORK)))
pose(1, lean=6, sq=(1, 1, 1))
pose(44, lean=6)
for side in "LR":
    K(hips[side], "rotation_euler", 48, (0, 0, 0))
K(head, "rotation_euler", 48, (0, 0, 0))
pose(46, sq=(1.07, 1.07, 0.92), lean=-2)
pose(51, sq=(1, 1, 1), lean=0, swing=-110, left=(0, -12))
blink(28)

# ---- three swings
HITS = [66, 92, 122]
BURST = HITS[-1]
pose(58, swing=-130, lean=-9, sq=(1.03, 1.03, 0.95), left=(-25, -40))
pose(63, swing=-138, lean=-11)
for b in brows:
    K(b, "location", 50, None)
    K(b, "rotation_euler", 50, None)
for i, b in enumerate(brows):
    sx = 1 if i == 0 else -1
    K(b, "location", 58, (0.13 * sx, -0.31, 0.47))
    K(b, "rotation_euler", 58, (0, radians(-14) * sx, 0))  # determined

def strike(f, back_from, wind_to, big=False):
    pose(f - 1, swing=-40, lean=7, sq=(0.95, 0.95, 1.07), interp="LINEAR", left=(10, -30))
    pose(f, swing=-4, lean=10, sq=(1.1, 1.1, 0.9), left=(35, -20))
    pose(f + 3, swing=-10, lean=8, sq=(1, 1, 1))

strike(HITS[0], -166, None)
pose(76, swing=-70, lean=2, left=(0, -15))
pose(84, swing=-132, lean=-10, sq=(1.03, 1.03, 0.95), left=(-25, -40))
pose(89, swing=-140, lean=-12)
strike(HITS[1], -168, None)
pose(102, swing=-70, lean=2, left=(0, -15))
pose(112, swing=-140, lean=-16, sq=(1.05, 1.05, 0.92), left=(-30, -50))
pose(119, swing=-150, lean=-18, sq=(1.06, 1.06, 0.9))
strike(HITS[2], -178, None, big=True)

# ---- surprise, then celebrate
P_BACK = M_POS + Vector((-0.18, 0.08))
place(BURST, M_POS)
place(BURST + 6, P_BACK)
pose(BURST + 6, swing=-60, lean=-20, sq=(1, 1, 1), left=(-20, -75))
K(root, "rotation_euler", BURST + 6, (0, 0, radians(D_WORK)))
K(root, "rotation_euler", BURST + 16, (0, 0, radians(D_CHEER)))   # turns to camera to celebrate
for e in eyes:
    K(e, "scale", BURST, (1, 1, 1))
    K(e, "scale", BURST + 3, (1.3, 1.3, 1.35))
    K(e, "scale", BURST + 30, (1.3, 1.3, 1.35))
    K(e, "scale", BURST + 36, (1.05, 1.05, 1.05))
for i, b in enumerate(brows):
    sx = 1 if i == 0 else -1
    K(b, "location", BURST, (0.13 * sx, -0.31, 0.47))
    K(b, "rotation_euler", BURST, (0, radians(-14) * sx, 0))
    K(b, "location", BURST + 3, (0.13 * sx, -0.29, 0.57))
    K(b, "rotation_euler", BURST + 3, (0, radians(14) * sx, 0))
K(mouth, "scale", BURST, (0.12, 0.06, 0.035))
K(mouth, "scale", BURST + 4, (0.09, 0.06, 0.08))   # "O!"
K(mouth, "scale", BURST + 18, (0.09, 0.06, 0.08))
K(mouth, "scale", BURST + 24, (0.15, 0.07, 0.075))  # big grin
K(mouth, "location", BURST + 18, (0, -0.305, 0.115))
K(mouth, "location", BURST + 24, (0, -0.3, 0.1))

J1 = BURST + 18      # jump 1 take-off
pose(J1 - 8, swing=-95, lean=-6, left=(-10, -100))
pose(J1, swing=-92, lean=4, sq=(1.14, 1.14, 0.82), left=(0, -140))
place(J1, P_BACK)
place(J1 + 8, P_BACK, 0.95)
pose(J1 + 4, sq=(0.9, 0.9, 1.15))
pose(J1 + 8, swing=-88, lean=-4, sq=(1, 1, 1.03))
place(J1 + 15, P_BACK)
pose(J1 + 14, sq=(0.95, 0.95, 1.06))
pose(J1 + 16, sq=(1.15, 1.15, 0.84))
pose(J1 + 21, sq=(1, 1, 1), lean=0)
J2 = J1 + 24
pose(J2, sq=(1.08, 1.08, 0.9), swing=-92)
place(J2, P_BACK)
place(J2 + 6, P_BACK, 0.45)
pose(J2 + 3, sq=(0.95, 0.95, 1.07))
place(J2 + 12, P_BACK)
pose(J2 + 13, sq=(1.1, 1.1, 0.9))
pose(J2 + 17, sq=(1, 1, 1))
for side in "LR":
    K(hips[side], "rotation_euler", J1 + 4, (radians(-25 if side == "L" else 18), 0, 0))
    K(hips[side], "rotation_euler", J1 + 14, (0, 0, 0))
f = J2 + 18
k = 0
while f <= END:
    pose(f, swing=-90 + (14 if k % 2 else -8), lean=2 if k % 2 else -2, left=(0, -125 if k % 2 else -140))
    K(head, "rotation_euler", f, (radians(-4 if k % 2 else 2), 0, radians(6 if k % 2 else -6)))
    place(f, P_BACK, 0.05 if k % 2 else 0.0)
    f += 9
    k += 1
blink(BURST + 50)
blink(BURST + 96)

# ---------------------------------------------------------------- the ORE rock
dirv = Vector((sin(radians(D_WORK)), -cos(radians(D_WORK))))       # where he faces
sidev = Vector((cos(radians(D_WORK)), sin(radians(D_WORK))))        # his local +x
R_POS = M_POS + dirv * 1.55 + sidev * (-0.33 + GRIP_X)             # straight under the pick
rock = empty("OreRock", (R_POS.x, R_POS.y, ground(R_POS.x, R_POS.y)))
rbody = ico("RockBody", (0, 0, 0.36), (0.5, 0.46, 0.42), M["rock"], rock, sub=3)
try:
    tex = bpy.data.textures.new("RockNoise", "CLOUDS")
    tex.noise_scale = 0.55
    dm = rbody.modifiers.new("Lumps", "DISPLACE")
    dm.texture, dm.strength = tex, 0.18
except Exception as ex:
    print("displace skipped", ex)
for i in range(7):
    a = i / 7 * 2 * pi + 0.4
    el = radians(35 + 25 * (i % 3))
    d = Vector((cos(a) * cos(el), sin(a) * cos(el), sin(el)))
    c = cone(f"Crystal_{i}", Vector((0, 0, 0.36)) + Vector((d.x * 0.42, d.y * 0.38, d.z * 0.36)),
             0.06 + 0.02 * (i % 2), 0.0, 0.26 + 0.08 * (i % 3), M["crystal"], rock, verts=6)
    c.rotation_mode = "QUATERNION"
    c.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
for i in range(5):
    a = i / 5 * 2 * pi
    ico(f"GoldVein_{i}", (cos(a) * 0.43, sin(a) * 0.4, 0.3 + 0.1 * (i % 2)), (0.06, 0.06, 0.05), M["gold"], rock, sub=1)

glow_d = bpy.data.lights.new("OreGlow", "POINT")
glow_d.color, glow_d.shadow_soft_size = hexc("#3de0c8")[:3], 0.3
glow = bpy.data.objects.new("OreGlow", glow_d)
glow.location = (R_POS.x, R_POS.y, ground(R_POS.x, R_POS.y) + 0.7)
COL.objects.link(glow)
K(glow_d, "energy", 1, 90)
for n, h in enumerate(HITS):
    big = h == BURST
    K(glow_d, "energy", h - 1, 90 + n * 40)
    K(glow_d, "energy", h + 1, 1300 if big else 600 + n * 250)
    K(glow_d, "energy", h + (14 if big else 8), 120 if big else 120 + n * 60)
K(glow_d, "energy", END, 50)

K(rock, "scale", 1, (1, 1, 1))
for h in HITS[:-1]:
    K(rock, "scale", h, (1, 1, 1))
    K(rock, "scale", h + 1, (1.14, 1.14, 0.84))
    K(rock, "scale", h + 4, (0.95, 0.95, 1.06))
    K(rock, "scale", h + 7, (1, 1, 1))
    for j, dx in enumerate((0.05, -0.04, 0.025, 0)):
        K(rock, "rotation_euler", h + 1 + j, (0, radians(dx * 60), radians(dx * 40)))
K(rock, "scale", BURST - 1, (1, 1, 1))
K(rock, "scale", BURST, (1.22, 1.22, 0.78), "CONSTANT")
K(rock, "scale", BURST + 1, (0.001, 0.001, 0.001), "CONSTANT")

GRAV = 9.8
def ballistic(o, f0, p0, v, size, spin, until=END, rest=0.35, life=None):
    p, vel = Vector(p0), Vector(v)
    K(o, "scale", f0 - 1, (0.0001,) * 3, "CONSTANT")
    K(o, "scale", f0, (size,) * 3, "CONSTANT")
    K(o, "location", f0 - 1, p, "CONSTANT")
    bounces, settled = 0, False
    rot = Vector((random.random(), random.random(), random.random())) * 6
    for f in range(f0, until + 1):
        if not settled:
            dt = 1 / FPS
            vel.z -= GRAV * dt
            p += vel * dt
            g = ground(p.x, p.y) + size * 0.9
            if p.z < g:
                p.z = g
                if bounces >= 2 or abs(vel.z) < 1.0 or g < -0.2:
                    settled = True
                else:
                    vel.z = -vel.z * rest
                    vel.x *= 0.55
                    vel.y *= 0.55
                    bounces += 1
            rot += Vector(spin) / FPS * (0.3 if settled else 1)
        K(o, "location", f, p, "LINEAR")
        K(o, "rotation_euler", f, Euler(rot), "LINEAR")
        if life and f - f0 >= life:
            K(o, "scale", f, (0.0001,) * 3, "LINEAR")
            break
        if settled and f > f0 + 4:
            break
    if life:
        K(o, "scale", f0 + max(1, life - 4), (size,) * 3, "LINEAR")

center = Vector((R_POS.x, R_POS.y, ground(R_POS.x, R_POS.y) + 0.45))
# gems
for i in range(30):
    gold_gem = i % 3 != 0
    o = octa(f"Gem_{i}", M["gold"] if gold_gem else M["crystal"], 1)
    a = random.uniform(0, 2 * pi)
    sp = random.uniform(1.2, 3.0)
    v = (cos(a) * sp, sin(a) * sp * 0.8 + 0.4, random.uniform(4.2, 7.0))
    ballistic(o, BURST + 1, center + Vector((0, 0, random.uniform(-0.1, 0.2))), v,
              random.uniform(0.07, 0.12), (random.uniform(-9, 9), random.uniform(-9, 9), random.uniform(-6, 6)))
# rock chunks
for i in range(9):
    o = ico(f"Chunk_{i}", (0, 0, 0), (1, 1, 1), M["rock"], None, sub=1)
    o.scale = (1, 0.8, 0.7)
    a = i / 9 * 2 * pi + random.uniform(-0.3, 0.3)
    sp = random.uniform(1.5, 2.6)
    ballistic(o, BURST + 1, center, (cos(a) * sp, sin(a) * sp, random.uniform(2.0, 3.8)),
              random.uniform(0.1, 0.17), (random.uniform(-6, 6), random.uniform(-6, 6), 0), rest=0.25)
# sparks on every hit
for h in HITS:
    hit_p = Vector((R_POS.x, R_POS.y, ground(R_POS.x, R_POS.y))) + Vector((-dirv.x * 0.35, -dirv.y * 0.35, 0.72))
    for i in range(14 if h == BURST else 9):
        o = sphere(f"Spark_{h}_{i}", (0, 0, 0), (1, 1, 1), M["spark"], seg=8)
        a = random.uniform(0, 2 * pi)
        sp = random.uniform(1.5, 3.5)
        ballistic(o, h, hit_p, (cos(a) * sp, sin(a) * sp, random.uniform(1.5, 4.0)), random.uniform(0.018, 0.03),
                  (0, 0, 0), life=random.randint(8, 13))

# ---------------------------------------------------------------- lights
sun_d = bpy.data.lights.new("KeySun", "SUN")
sun_d.energy, sun_d.color, sun_d.angle = 3.2, hexc("#ffc08a")[:3], radians(4)
sun = bpy.data.objects.new("KeySun", sun_d)
sun.rotation_euler = (radians(58), 0, radians(-38))
COL.objects.link(sun)
rim_d = bpy.data.lights.new("Rim", "AREA")
rim_d.energy, rim_d.size, rim_d.color = 450, 4, hexc("#9a86ff")[:3]
rim = bpy.data.objects.new("Rim", rim_d)
rim.location = (0.6, 3.5, 3.2)
COL.objects.link(rim)
rt = rim.constraints.new("TRACK_TO")
rt.target = root
fill_d = bpy.data.lights.new("Fill", "AREA")
fill_d.energy, fill_d.size, fill_d.color = 420, 5, hexc("#ffd2b0")[:3]
fill = bpy.data.objects.new("Fill", fill_d)
fill.location = (-1, -5.5, 3)
COL.objects.link(fill)
ft = fill.constraints.new("TRACK_TO")
ft.target = root
if VERTICAL:   # the taller frame sees the sea where these lights would reflect as bright panels
    fill_d.specular_factor = 0.0
    rim_d.specular_factor = 0.0

# ---------------------------------------------------------------- GALI wordmark + tagline
img = bpy.data.images.load(WORDMARK)
logo_m = bpy.data.materials.new("Wordmark")
logo_m.use_nodes = True
ln = logo_m.node_tree
ln.nodes.clear()
lout = ln.nodes.new("ShaderNodeOutputMaterial")
itex = ln.nodes.new("ShaderNodeTexImage")
itex.image = img
emi = ln.nodes.new("ShaderNodeEmission")
emi.inputs["Strength"].default_value = 1.7
trn = ln.nodes.new("ShaderNodeBsdfTransparent")
mix = ln.nodes.new("ShaderNodeMixShader")
ln.links.new(itex.outputs["Color"], emi.inputs["Color"])
ln.links.new(itex.outputs["Alpha"], mix.inputs[0])
ln.links.new(trn.outputs[0], mix.inputs[1])
ln.links.new(emi.outputs[0], mix.inputs[2])
ln.links.new(mix.outputs[0], lout.inputs[0])
w, h = img.size
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0, 0))
logo = bpy.context.active_object
logo.name = "GaliWordmark"
logo.data.materials.append(logo_m)
logo.data.transform(__import__("mathutils").Matrix.Diagonal((1.4, 1.4 * h / w, 1, 1)))
logo_anchor = empty("WordmarkAnchor", (-0.3, 0.6, 2.95))
logo.parent = logo_anchor

tag_c = bpy.data.curves.new("Tagline", "FONT")
tag_c.body = "MINE ORE.  MAKE IT A GAME."
tag_c.align_x, tag_c.align_y, tag_c.size, tag_c.extrude = "CENTER", "CENTER", 0.17, 0.012
tag = bpy.data.objects.new("Tagline", tag_c)
COL.objects.link(tag)
tag.data.materials.append(mat("TagWhite", "#ffffff", 0.4, emit="#fff6e0", strength=2.5))
tag.parent = logo_anchor
tag.location = (0, 0, -0.58)

LOGO_IN = BURST + 30
K(logo_anchor, "scale", 1, (0.0001,) * 3, "CONSTANT")
K(logo_anchor, "scale", LOGO_IN - 1, (0.0001,) * 3, "BEZIER")
K(logo_anchor, "scale", LOGO_IN + 7, (1.18,) * 3)
K(logo_anchor, "scale", LOGO_IN + 12, (0.93,) * 3)
K(logo_anchor, "scale", LOGO_IN + 17, (1.0,) * 3)
K(logo_anchor, "location", LOGO_IN, (-0.3, 0.6, 2.75))
K(logo_anchor, "location", LOGO_IN + 8, (-0.3, 0.6, 2.98))
for f in range(LOGO_IN + 20, END + 1, 20):
    K(logo_anchor, "location", f, (-0.3, 0.6, 2.95 + 0.04 * (1 if (f // 20) % 2 else -1)))
TAG_IN = LOGO_IN + 16
K(tag, "scale", 1, (0.0001,) * 3, "CONSTANT")
K(tag, "scale", TAG_IN, (0.0001,) * 3)
K(tag, "scale", TAG_IN + 6, (1.1,) * 3)
K(tag, "scale", TAG_IN + 10, (1.0,) * 3)

# ---------------------------------------------------------------- camera
target = empty("CamTarget")
cam_d = bpy.data.cameras.new("Camera")
cam_d.lens = 25 if VERTICAL else 32
cam = bpy.data.objects.new("Camera", cam_d)
COL.objects.link(cam)
ct = cam.constraints.new("TRACK_TO")
ct.target = target
scene.camera = cam
for o in (logo, tag):
    c = o.constraints.new("TRACK_TO")
    c.target, c.track_axis, c.up_axis = cam, "TRACK_Z", "UP_Y"

CAM = [
    (1, (-6.2, -6.6, 2.5), (-4.3, 1.1, 0.95)),
    (44, (-2.0, -5.0, 1.7), (-0.3, 0.1, 0.9)),
    (60, (2.6, -3.7, 1.45), (0.4, -0.08, 0.78)),
    (BURST - 3, (2.3, -3.35, 1.35), (0.45, -0.12, 0.74)),
    (BURST + 10, (0.8, -5.4, 2.0), (0.2, 0.0, 1.05)),
    (LOGO_IN + 10, (0.0, -6.5, 2.4), (-0.25, 0.3, 1.7)),
    (END, (0.1, -5.9, 2.25), (-0.25, 0.3, 1.75)),
]
for f, cp, tp in CAM:
    K(cam, "location", f, cp)
    K(target, "location", f, tp)
for n, h in enumerate(HITS):
    amp = 0.03 if h != BURST else 0.09
    base = Vector(next(tp for f, cp, tp in CAM if f >= h))
    # small shake around the interpolated target
    scene.frame_set(h)
    cur = target.location.copy()
    for j, (dx, dz) in enumerate(((amp, -amp), (-amp * 0.7, amp * 0.6), (amp * 0.4, -amp * 0.3), (0, 0))):
        K(target, "location", h + j, cur + Vector((dx, 0, dz)))

# ---------------------------------------------------------------- render settings
r = scene.render
r.engine = "BLENDER_EEVEE"
r.resolution_x, r.resolution_y, r.resolution_percentage = (1080, 1920, 100) if VERTICAL else (1920, 1080, 100)
r.image_settings.file_format = "PNG"
try:
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
    scene.eevee.use_raytracing = True
except Exception as ex:
    print("eevee opt", ex)
try:
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = -0.25
except Exception as ex:
    print("look", ex)

# soft bloom through the compositor
try:
    tree = bpy.data.node_groups.new("Bloom", "CompositorNodeTree")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    go = tree.nodes.new("NodeGroupOutput")
    for prop, val in (("glare_type", "BLOOM"), ("quality", "HIGH")):
        try:
            setattr(gl, prop, val)
        except Exception:
            pass
    for name, val in (("Type", "Bloom"), ("Threshold", 1.0), ("Strength", 0.45), ("Size", 0.6)):
        if name in gl.inputs:
            try:
                gl.inputs[name].default_value = val
            except Exception:
                pass
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    tree.links.new(gl.outputs["Image"], go.inputs[0])
    scene.compositing_node_group = tree
    r.use_compositing = True
    print("bloom on")
except Exception as ex:
    print("bloom skipped", ex)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"gali_cartoon{SUFFIX}.blend"))

if MODE == "check":
    # Every frame: does a hand, arm, handle or blade come within its own radius of the head or helmet?
    obstacles = [bpy.data.objects[n] for n in ("Head", "HelmetDome", "HelmetBrim", "Nose", "Ear_L", "Ear_R")]
    probes = []   # (object, local point, radius)
    for n, r in (("Glove_R", 0.09), ("Glove_L", 0.09), ("PickHub", 0.08)):
        probes.append((bpy.data.objects[n], Vector((0, 0, 0)), r))
    for n, r in (("PickHandle", 0.036), ("Arm_R", 0.07), ("Arm_L", 0.07), ("Sleeve_R", 0.085), ("Sleeve_L", 0.085),
                 ("PickBlade_up", 0.06), ("PickBlade_dn", 0.06)):
        o = bpy.data.objects[n]
        zs = [v.co.z for v in o.data.vertices]
        for k in range(9):
            probes.append((o, Vector((0, 0, min(zs) + (max(zs) - min(zs)) * k / 8)), r))
    worst = []
    for f in range(1, END + 1):
        scene.frame_set(f)
        for ob in obstacles:
            inv = ob.matrix_world.inverted()
            ax = ob.matrix_world.to_scale()
            for o, lp, r in probes:
                q = inv @ (o.matrix_world @ lp)          # unit-sphere space of the obstacle
                # inside the ellipsoid grown by the probe radius along each axis?
                d = sqrt(sum((q[i] * ax[i] / (ax[i] + r)) ** 2 for i in range(3))) - 1
                if d < 0:
                    worst.append((round(d, 3), f, o.name, ob.name))
    worst.sort()
    print("CLIPS", len(worst))
    for w in worst[:15]:
        print("  ", w)
elif MODE == "anim":
    r.filepath = os.path.join(OUT, f"frames{SUFFIX}", "f_")
    bpy.ops.render.render(animation=True)
else:
    r.resolution_percentage = 50
    for f in STILLS:
        scene.frame_set(f)
        r.filepath = os.path.join(OUT, f"stills{SUFFIX}", f"still_{f:03d}.png")
        bpy.ops.render.render(write_still=True)
print("DONE")
