"""A cozy isometric reading nook, built from primitives, for DEX's 3D screenshots.
blender -b --python nook.py -- <out_dir> <resolution> <samples>
Writes reading-nook.png (Cycles), reading-nook.glb and reading-nook.blend."""
import bpy, math, os, random, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.getcwd()
RES = int(argv[1]) if len(argv) > 1 else 1400
SAMPLES = int(argv[2]) if len(argv) > 2 else 128
os.makedirs(OUT, exist_ok=True)
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, rgb, rough=0.6, emit=None, strength=0.0, metal=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = strength
    return m


def finish(obj, m, bevel=0.0, segs=3):
    obj.data.materials.append(m)
    if bevel:
        b = obj.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = segs
        b.limit_method = 'ANGLE'
    for f in obj.data.polygons:
        f.use_smooth = bevel > 0
    return obj


def box(name, size, loc, m, bevel=0.0, rot=(0, 0, 0), segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, m, bevel, segs)


def cyl(name, r, h, loc, m, bevel=0.0, verts=48, r2=None, rot=(0, 0, 0)):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, vertices=verts, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, location=loc, vertices=verts, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    return finish(o, m, bevel)


# ── Materials ──────────────────────────────────────────────────────────
wood = mat('Oak floor', (0.50, 0.31, 0.18), 0.45)
wall_warm = mat('Warm wall', (0.86, 0.79, 0.68), 0.85)
wall_blue = mat('Blue wall', (0.13, 0.20, 0.34), 0.85)
white = mat('White trim', (0.92, 0.92, 0.90), 0.4)
mustard = mat('Mustard velvet', (0.80, 0.45, 0.06), 0.75)
dark_wood = mat('Walnut', (0.18, 0.10, 0.06), 0.5)
terracotta = mat('Rug', (0.58, 0.18, 0.10), 0.95)
rug_edge = mat('Rug edge', (0.93, 0.83, 0.66), 0.95)
black = mat('Black metal', (0.03, 0.03, 0.035), 0.35, metal=0.8)
shade = mat('Lamp shade', (1.0, 0.86, 0.66), 0.6, emit=(1.0, 0.72, 0.42), strength=4.0)
sky = mat('Window sky', (0.55, 0.75, 1.0), 0.2, emit=(0.55, 0.78, 1.0), strength=2.2)
leaf = mat('Leaf', (0.16, 0.42, 0.20), 0.55)
leaf2 = mat('Leaf light', (0.30, 0.58, 0.26), 0.55)
pot = mat('Pot', (0.95, 0.93, 0.88), 0.35)
screen = mat('DEX screen', (0.10, 0.35, 0.95), 0.2, emit=(0.18, 0.48, 1.0), strength=3.0)
alu = mat('Aluminium', (0.72, 0.74, 0.78), 0.3, metal=0.9)
art = mat('Canvas', (0.16, 0.42, 0.95), 0.6, emit=(0.16, 0.42, 0.95), strength=0.35)
mug_m = mat('Mug', (0.95, 0.95, 0.95), 0.3)
book_colours = [(0.75, 0.22, 0.20), (0.18, 0.36, 0.62), (0.92, 0.72, 0.25), (0.22, 0.48, 0.38),
                (0.55, 0.30, 0.55), (0.90, 0.88, 0.82), (0.12, 0.14, 0.20), (0.85, 0.45, 0.25)]
books = [mat(f'Book {i}', c, 0.7) for i, c in enumerate(book_colours)]

# ── Room ───────────────────────────────────────────────────────────────
box('Floor', (4.4, 4.4, 0.24), (0, 0, -0.12), wood, bevel=0.03)
for i in range(1, 9):  # floorboard lines
    box(f'Board {i}', (4.38, 0.012, 0.004), (0, -2.2 + i * 0.49, 0.001), dark_wood)
box('Back wall', (4.4, 0.24, 3.1), (0, 2.08, 1.55), wall_warm, bevel=0.02)
box('Side wall', (0.24, 4.16, 3.1), (-2.08, -0.12, 1.55), wall_blue, bevel=0.02)
box('Skirting back', (4.0, 0.03, 0.12), (0.12, 1.95, 0.06), white)
box('Skirting side', (0.03, 3.9, 0.12), (-1.95, -0.06, 0.06), white)

# Window on the back wall
wx, wz = 0.75, 1.75
box('Window frame', (1.5, 0.08, 1.3), (wx, 1.96, wz), white, bevel=0.015)
box('Window sky', (1.36, 0.02, 1.16), (wx, 1.915, wz), sky)
box('Mullion v', (0.05, 0.03, 1.16), (wx, 1.9, wz), white)
box('Mullion h', (1.36, 0.03, 0.05), (wx, 1.9, wz), white)
box('Sill', (1.7, 0.22, 0.06), (wx, 1.86, wz - 0.68), white, bevel=0.01)

# Rug
cyl('Rug', 1.25, 0.025, (0.25, -0.05, 0.0125), terracotta, bevel=0.008, verts=96)
cyl('Rug border', 1.32, 0.018, (0.25, -0.05, 0.009), rug_edge, verts=96)

# Armchair, turned towards the room
chair_rot = (0, 0, math.radians(-35))
cx, cy = -0.85, 0.85
def chair_part(name, size, off, m=mustard, bevel=0.07):
    c, s = math.cos(chair_rot[2]), math.sin(chair_rot[2])
    x = cx + off[0] * c - off[1] * s
    y = cy + off[0] * s + off[1] * c
    return box(name, size, (x, y, off[2]), m, bevel=bevel, rot=chair_rot, segs=4)
chair_part('Seat', (1.0, 0.9, 0.32), (0, 0, 0.42))
chair_part('Cushion', (0.82, 0.78, 0.14), (0, -0.04, 0.63), bevel=0.06)
chair_part('Back', (1.0, 0.24, 0.95), (0, 0.4, 0.82))
chair_part('Arm L', (0.2, 0.9, 0.6), (-0.52, 0, 0.56))
chair_part('Arm R', (0.2, 0.9, 0.6), (0.52, 0, 0.56))
for lx, ly in [(-0.45, -0.35), (0.45, -0.35), (-0.45, 0.38), (0.45, 0.38)]:
    chair_part('Leg', (0.06, 0.06, 0.26), (lx, ly, 0.13), dark_wood, bevel=0.01)

# Floor lamp
lx, ly = -1.55, 1.5
cyl('Lamp base', 0.22, 0.04, (lx, ly, 0.02), black, bevel=0.01)
cyl('Lamp pole', 0.022, 1.75, (lx, ly, 0.9), black)
cyl('Lamp shade', 0.34, 0.38, (lx, ly, 1.86), shade, r2=0.22)
bpy.ops.object.light_add(type='POINT', location=(lx, ly, 1.78))
lamp = bpy.context.active_object
lamp.data.energy = 120
lamp.data.color = (1.0, 0.72, 0.45)
lamp.data.shadow_soft_size = 0.15

# Bookshelf against the blue wall
sx = -1.78
box('Shelf back', (0.04, 1.5, 2.0), (sx - 0.16, -1.0, 1.0), dark_wood)
for side_y in (-1.75, -0.25):
    box('Shelf side', (0.36, 0.04, 2.0), (sx, side_y, 1.0), dark_wood, bevel=0.005)
for level in range(5):
    box('Shelf', (0.36, 1.5, 0.035), (sx, -1.0, 0.04 + level * 0.48), dark_wood, bevel=0.005)
for level in range(4):
    y = -1.7
    z0 = 0.06 + level * 0.48
    while y < -0.35:
        w = random.uniform(0.04, 0.075)
        h = random.uniform(0.26, 0.38)
        lean = random.random() < 0.08
        box('Book', (0.24, w, h), (sx + 0.02, y + w / 2, z0 + h / 2), random.choice(books), bevel=0.004,
            rot=(math.radians(12) if lean else 0, 0, 0))
        y += w + random.uniform(0.0, 0.01)
        if random.random() < 0.12:
            y += 0.12

# Art above the chair
box('Art frame', (0.05, 0.9, 0.64), (-1.94, 0.95, 2.05), dark_wood, bevel=0.01)
box('Art canvas', (0.02, 0.78, 0.52), (-1.915, 0.95, 2.05), art)

# Side table with a laptop and a mug
tx, ty = 0.35, 1.25
cyl('Table top', 0.34, 0.045, (tx, ty, 0.62), dark_wood, bevel=0.01)
cyl('Table leg', 0.035, 0.6, (tx, ty, 0.31), black)
cyl('Table foot', 0.18, 0.025, (tx, ty, 0.0125), black, bevel=0.005)
box('Laptop base', (0.34, 0.24, 0.015), (tx - 0.02, ty - 0.02, 0.65), alu, bevel=0.004, rot=(0, 0, math.radians(-20)))
box('Laptop screen', (0.34, 0.012, 0.22), (tx + 0.02, ty + 0.1, 0.76), alu, bevel=0.004, rot=(math.radians(-12), 0, math.radians(-20)))
box('Laptop display', (0.31, 0.004, 0.19), (tx + 0.018, ty + 0.092, 0.762), screen, rot=(math.radians(-12), 0, math.radians(-20)))
cyl('Mug', 0.045, 0.09, (tx + 0.2, ty - 0.12, 0.69), mug_m, bevel=0.005)

# Plant in the corner by the window
px_, py_ = 1.55, 1.45
cyl('Pot', 0.24, 0.5, (px_, py_, 0.25), pot, bevel=0.02, r2=0.18)
for i in range(16):
    a = random.uniform(0, math.tau)
    rr = random.uniform(0.0, 0.32)
    z = random.uniform(0.75, 1.45)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(px_ + rr * math.cos(a), py_ + rr * math.sin(a), z), segments=24, ring_count=12)
    o = bpy.context.active_object
    o.name = 'Leaf'
    o.scale = (random.uniform(0.07, 0.11), random.uniform(0.22, 0.32), 0.03)
    o.rotation_euler = (random.uniform(-0.9, 0.9), random.uniform(-0.6, 0.6), a)
    bpy.ops.object.transform_apply(scale=True)
    finish(o, random.choice((leaf, leaf2)), bevel=0)
    for f in o.data.polygons:
        f.use_smooth = True
cyl('Stem', 0.015, 0.6, (px_, py_, 0.75), leaf)

# ── Light, world, camera ──────────────────────────────────────────────
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(52), 0, math.radians(32)))
sun = bpy.context.active_object
sun.data.energy = 2.6
sun.data.color = (1.0, 0.93, 0.84)
sun.data.angle = math.radians(6)
bpy.ops.object.light_add(type='AREA', location=(5, -5, 6))
fill = bpy.context.active_object
fill.data.energy = 380
fill.data.size = 6
fill.data.color = (0.75, 0.85, 1.0)
fill.rotation_euler = (math.radians(50), 0, math.radians(45))
bpy.ops.object.light_add(type='AREA', location=(wx, 1.6, wz))
win = bpy.context.active_object
win.data.energy = 120
win.data.size = 1.2
win.data.color = (0.6, 0.78, 1.0)
win.rotation_euler = (math.radians(-90), 0, 0)

world = bpy.data.worlds.new('World')
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (0.022, 0.032, 0.07, 1)
bg.inputs['Strength'].default_value = 1.0

bpy.ops.object.empty_add(location=(-0.05, 0.15, 1.05))
target = bpy.context.active_object
bpy.ops.object.camera_add(location=(9.5, -9.5, 7.9))
cam = bpy.context.active_object
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 6.9
t = cam.constraints.new('TRACK_TO')
t.target = target
t.track_axis = 'TRACK_NEGATIVE_Z'
t.up_axis = 'UP_Y'
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Punchy'
except Exception:
    pass
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(OUT, 'reading-nook.png')
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'reading-nook.blend'))
# The model for <model-viewer>: meshes only, modifiers applied.
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'reading-nook.glb'), export_format='GLB', use_selection=True, export_apply=True)
print('DONE', OUT)
