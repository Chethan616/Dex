"""
A .blend, made viewable on the phone (which can't run Blender):

    blender -b scene.blend -P scene_preview.py -- --out DIR [--size 1600]

writes into DIR:
  render.jpg   the scene rendered through its camera (EEVEE) — real materials
               and lighting; an automatic 3/4 view when there's no camera
  scene.glb    every visible object, modifiers applied, textures ≤ 1024 px,
               heavy meshes decimated to fit a phone — the interactive 3D
  sky.jpg      the world's environment picture (HDRI), if it has one — the
               phone shows the scene inside it, as in the render
  view.json    the camera as <model-viewer> wants it (orbit/target/fov), so
               the 3D view starts where the render was taken
  meta.json    what went in, and how long it took

Procedural materials only survive in the render (glTF can't carry node
graphs); the 3D keeps their base colours.
"""

import argparse
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser(prog="dex-scene-preview")
ap.add_argument("--out", required=True)
ap.add_argument("--size", type=int, default=1600)
ap.add_argument("--max-triangles", type=int, default=900_000)
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)
started = time.time()
scene = bpy.context.scene
meta = {"blend": bpy.data.filepath, "blender": bpy.app.version_string}


def log(*parts):
    print("DEX scene:", *parts, flush=True)


VISIBLE_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT"}


def visible_objects():
    return [o for o in scene.objects if o.type in VISIBLE_TYPES and not o.hide_render and o.visible_get()]


def scene_bounds(objs):
    boxes = []
    for obj in objs:
        pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        size = hi - lo
        ground = size.z < 0.01 * max(size.x, size.y, 1e-6) and max(size.x, size.y) > 50
        boxes.append((lo, hi, ground))
    subject = [b for b in boxes if not b[2]] or boxes
    if not subject:
        return Vector((0, 0, 0)), 2.0
    lo = Vector((min(b[0].x for b in subject), min(b[0].y for b in subject), min(b[0].z for b in subject)))
    hi = Vector((max(b[1].x for b in subject), max(b[1].y for b in subject), max(b[1].z for b in subject)))
    return (lo + hi) / 2, max((hi - lo).length / 2, 0.1)


objs = visible_objects()
centre, radius = scene_bounds(objs)

# ── Camera: the scene's, or a 3/4 view of everything ─────────────────────────
auto_camera = scene.camera is None
if auto_camera:
    data = bpy.data.cameras.new("DEX view")
    data.lens = 50
    fov = 2 * math.atan(data.sensor_width / (2 * data.lens))
    dist = radius / math.sin(fov / 2) * 1.1
    data.clip_start, data.clip_end = max(dist / 1000, 0.001), dist + radius * 20
    cam = bpy.data.objects.new("DEX view", data)
    scene.collection.objects.link(cam)
    cam.location = centre + Vector((1.0, -1.15, 0.75)).normalized() * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
cam = scene.camera
meta["camera"] = "automatic 3/4 view" if auto_camera else cam.name

# ── view.json: that camera, in <model-viewer> terms ──────────────────────────
r = scene.render
res_x = r.resolution_x * r.resolution_percentage / 100
res_y = r.resolution_y * r.resolution_percentage / 100
cd = cam.data
fit = cd.sensor_fit
if fit == "VERTICAL" or (fit == "AUTO" and res_y > res_x):
    along = cd.sensor_height if fit == "VERTICAL" else cd.sensor_width
    vfov = 2 * math.atan(along / (2 * cd.lens))
else:
    hfov = 2 * math.atan(cd.sensor_width / (2 * cd.lens))
    vfov = 2 * math.atan(math.tan(hfov / 2) * res_y / max(res_x, 1))
cam_pos = cam.matrix_world.translation.copy()
forward = cam.matrix_world.to_quaternion() @ Vector((0, 0, -1))
dist = max((centre - cam_pos).dot(forward), radius * 0.3, 0.05)
target = cam_pos + forward * dist


def gltf(v):  # Blender Z-up → glTF Y-up (what the exporter does)
    return Vector((v.x, v.z, -v.y))


rel = gltf(cam_pos) - gltf(target)
orbit_r = max(rel.length, 1e-4)
theta = math.degrees(math.atan2(rel.x, rel.z))
phi = math.degrees(math.acos(max(-1.0, min(1.0, rel.y / orbit_r))))
t = gltf(target)
view = {
    "orbit": f"{theta:.3f}deg {phi:.3f}deg {orbit_r:.4f}m",
    "target": f"{t.x:.4f}m {t.y:.4f}m {t.z:.4f}m",
    "fov": f"{math.degrees(vfov):.2f}deg",
    "radius": round(radius, 4),
    # The render's shape, so a phone held upright can frame it the same way.
    "aspect": round(res_x / max(res_y, 1), 4),
}
with open(os.path.join(args.out, "view.json"), "w", encoding="utf-8") as f:
    json.dump(view, f)

# ── render.jpg ───────────────────────────────────────────────────────────────
def scene_is_lit():
    if any(o.type == "LIGHT" and not o.hide_render for o in scene.objects):
        return True
    tree = getattr(scene.world, "node_tree", None) if scene.world else None
    for node in (tree.nodes if tree else []):
        if node.type == "TEX_ENVIRONMENT" and getattr(node, "image", None):
            return True
        if node.type == "BACKGROUND":
            c, s = node.inputs[0].default_value, node.inputs[1].default_value
            if (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * s > 0.15:
                return True
    return False


if not scene_is_lit():
    for name, energy, yaw in (("DEX key", 4.0, 35), ("DEX fill", 1.2, -120)):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        light.data.energy, light.data.angle = energy, math.radians(20)
        scene.collection.objects.link(light)
        light.rotation_euler = (math.radians(50), 0, cam.rotation_euler.z + math.radians(yaw))
    meta["studio_light"] = True

aspect = (res_x or 16) / (res_y or 9)
w, h = (args.size, max(1, round(args.size / aspect))) if aspect >= 1 else (max(1, round(args.size * aspect)), args.size)
r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100
r.image_settings.file_format = "JPEG"
r.image_settings.quality = 90
engines = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
render_path = os.path.join(args.out, "render.jpg")
for engine in [e for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE") if e in engines] + ["BLENDER_WORKBENCH"]:
    try:
        r.engine = engine
        if engine.startswith("BLENDER_EEVEE"):
            scene.eevee.taa_render_samples = 32
        t0 = time.time()
        bpy.ops.render.render(write_still=False)
        bpy.data.images["Render Result"].save_render(filepath=render_path)
        meta["render"] = {"engine": engine, "size": [w, h], "seconds": round(time.time() - t0, 1)}
        log("rendered", engine, w, "x", h)
        break
    except Exception as e:  # noqa: BLE001
        log("render with", engine, "failed:", e)

# ── sky.jpg: the world's environment picture ─────────────────────────────────
tree = getattr(scene.world, "node_tree", None) if scene.world else None
env = next((n.image for n in (tree.nodes if tree else []) if n.type == "TEX_ENVIRONMENT" and getattr(n, "image", None)), None)
if env is not None:
    try:
        sky = env.copy()
        sky.scale(2048, 1024)
        r.image_settings.file_format = "JPEG"
        sky.save_render(filepath=os.path.join(args.out, "sky.jpg"), scene=scene)
        meta["sky"] = env.name
        log("sky from", env.name)
    except Exception as e:  # noqa: BLE001
        log("sky failed:", e)

# ── scene.glb ────────────────────────────────────────────────────────────────
deps = bpy.context.evaluated_depsgraph_get()


def triangles(obj):
    try:
        mesh = obj.evaluated_get(deps).to_mesh()
        n = sum(len(p.vertices) - 2 for p in mesh.polygons)
        obj.evaluated_get(deps).to_mesh_clear()
        return n
    except Exception:  # noqa: BLE001
        return 0


counts = {o.name: triangles(o) for o in objs}
total = sum(counts.values())
meta["triangles_before"] = total
if total > args.max_triangles:
    # Thin the heavy meshes (grass, scatter, subdivided hero pieces) so the
    # phone stays smooth; small objects keep their shape.
    heavy = [o for o in objs if counts[o.name] > 20_000 and o.type == "MESH"]
    heavy_total = sum(counts[o.name] for o in heavy)
    budget = max(args.max_triangles - (total - heavy_total), args.max_triangles * 0.3)
    ratio = max(0.03, min(1.0, budget / max(heavy_total, 1)))
    for o in heavy:
        mod = o.modifiers.new("DEX phone", "DECIMATE")
        mod.ratio = ratio
    meta["decimated"] = {"objects": len(heavy), "ratio": round(ratio, 3)}

# Procedural colours can't travel in glTF: the exporter would leave those
# surfaces white. Follow each Base Color chain (colour ramps, mixes, RGB
# nodes) to a representative flat colour instead — the render keeps the
# real thing.
COLOR_PASS = {"HUE_SAT", "BRIGHTCONTRAST", "GAMMA", "INVERT", "CURVE_RGB", "RGBTOBW", "MAP_RANGE"}


def guess_color(socket, depth=0):
    if depth > 8:
        return None
    if not socket.is_linked:
        v = getattr(socket, "default_value", None)
        try:
            return tuple(v[:3]) if len(v) >= 3 else None
        except TypeError:
            return None
    node = socket.links[0].from_node
    kind = node.type
    if kind == "TEX_IMAGE":
        return "image"
    if kind == "RGB":
        return tuple(node.outputs[0].default_value[:3])
    if kind == "VALTORGB":
        # Noise and gradients feeding a ramp sit around 0.5 most of the time.
        try:
            return tuple(node.color_ramp.evaluate(0.5)[:3])
        except Exception:  # noqa: BLE001
            els = node.color_ramp.elements
            return tuple(sum(e.color[i] for e in els) / len(els) for i in range(3))
    if kind in ("MIX_RGB", "MIX"):
        return guess_mix(node, depth)
    if kind in COLOR_PASS:
        first = next((s for s in node.inputs if s.type == "RGBA"), None)
        return guess_color(first, depth + 1) if first else None
    return None


def guess_mix(node, depth):
    """A colour Mix, done the way Blender does it — a MULTIPLY by a pale noise
    at 25% darkens the red a little; it doesn't average in the white."""
    if node.type == "MIX":
        if getattr(node, "data_type", "RGBA") != "RGBA":
            return None
        live = [s for s in node.inputs if s.enabled]
        fac_s = next((s for s in live if s.name == "Factor"), None)
        a_s = next((s for s in live if s.name == "A" and s.type == "RGBA"), None)
        b_s = next((s for s in live if s.name == "B" and s.type == "RGBA"), None)
    else:
        fac_s, a_s, b_s = node.inputs.get("Fac"), node.inputs.get("Color1"), node.inputs.get("Color2")
    if a_s is None or b_s is None:
        return None
    a, b = guess_color(a_s, depth + 1), guess_color(b_s, depth + 1)
    if not isinstance(a, tuple) or not isinstance(b, tuple):
        return a if isinstance(a, tuple) else (b if isinstance(b, tuple) else None)
    # A driven factor (height gradient, noise…) is somewhere in between.
    fac = 0.5 if fac_s is None or fac_s.is_linked else float(fac_s.default_value)
    mode = getattr(node, "blend_type", "MIX")
    ops = {
        "MULTIPLY": lambda x, y: x * y,
        "ADD": lambda x, y: x + y,
        "SUBTRACT": lambda x, y: x - y,
        "SCREEN": lambda x, y: 1 - (1 - x) * (1 - y),
        "DARKEN": min,
        "LIGHTEN": max,
    }
    op = ops.get(mode, lambda x, y: y)
    return tuple(max(0.0, min(1.0, a[i] + (op(a[i], b[i]) - a[i]) * fac)) for i in range(3))


flattened = 0
for mat in bpy.data.materials:
    tree = getattr(mat, "node_tree", None)
    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if tree else None
    base = bsdf.inputs.get("Base Color") if bsdf else None
    if base is None or not base.is_linked:
        continue
    colour = guess_color(base)
    if isinstance(colour, tuple):
        for link in list(base.links):
            tree.links.remove(link)
        base.default_value = (*colour, 1.0)
        flattened += 1
meta["flattened_materials"] = flattened

for img in bpy.data.images:
    try:
        if img.size[0] > 1024 or img.size[1] > 1024:
            k = 1024 / max(img.size)
            img.scale(max(1, int(img.size[0] * k)), max(1, int(img.size[1] * k)))
    except Exception:  # noqa: BLE001 — an image that won't load just stays as is
        pass

for o in scene.objects:
    o.select_set(False)
for o in objs:
    o.select_set(True)
glb_path = os.path.join(args.out, "scene.glb")
opts = dict(filepath=glb_path, export_format="GLB", use_selection=True, export_apply=True,
            export_cameras=False, export_lights=False, export_image_format="JPEG")
for drop in ([], ["export_image_format"]):
    try:
        bpy.ops.export_scene.gltf(**{k: v for k, v in opts.items() if k not in drop})
        break
    except TypeError as e:
        log("exporter option refused:", e)
meta["glb_bytes"] = os.path.getsize(glb_path) if os.path.exists(glb_path) else 0
meta["objects"] = len(objs)
meta["seconds"] = round(time.time() - started, 1)
with open(os.path.join(args.out, "meta.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f)
log("done", json.dumps(meta))
