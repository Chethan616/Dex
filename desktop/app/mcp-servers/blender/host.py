"""
DEX's background Blender: the MCP for Blender add-on's command server, run
inside a windowless Blender (`blender -b`), so the agent can model while the
user keeps their desktop — no Blender window, nothing to keep focused.

    blender -b [scene.blend] -P host.py -- --port N --autosave scene.blend [--idle 900]

The add-on (github.com/ahujasid/mcp-for-blender, MIT; installed into Blender
by `mcp-for-blender install-addon`) refuses `-b` because it runs commands from
a UI timer. Its server class doesn't need the UI, though: this script runs the
same accept thread and drains the same command queue from its own loop, on
Blender's main thread — so every tool behaves exactly as with a GUI, except:

  * get_viewport_screenshot is a quick EEVEE render through the scene camera
    (an automatic 3/4 view of everything when there's no camera yet), since
    there is no viewport — which is what the agent should judge anyway;
  * the scene is saved to --autosave after every command that can change it,
    so a restarted host (next turn, after an idle exit) picks up where it was.

Exits after --idle seconds without a command. Exit code 3: add-on missing.
"""

import argparse
import json
import math
import os
import socket
import sys
import threading
import time
import traceback

import addon_utils
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser(prog="dex-blender-host")
ap.add_argument("--port", type=int, required=True)
ap.add_argument("--autosave", required=True)
ap.add_argument("--idle", type=int, default=900)
args = ap.parse_args(argv)

STATUS_FILE = os.path.join(os.path.dirname(args.autosave), "host.status")


def log(*parts):
    print("DEX host:", *parts, flush=True)


def status(**fields):
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "port": args.port, "at": time.time(), **fields}, f)
    except OSError:
        pass


# ── The add-on ───────────────────────────────────────────────────────────────
mod = None
try:
    mod = addon_utils.enable("blender_mcp", default_set=False, persistent=False)
except Exception as e:  # noqa: BLE001 — any failure means "not usable"
    log("enabling the add-on failed:", e)
if mod is None or not hasattr(mod, "BlenderMCPServer"):
    status(error="addon-missing")
    log("the MCP for Blender add-on isn't installed")
    sys.exit(3)


def enable_asset_sources(*_):
    """Poly Haven needs no key; Sketchfab / Poly Pizza only when DEX has one."""
    for scene in bpy.data.scenes:
        for prop, on in (
            ("blendermcp_use_polyhaven", True),
            ("blendermcp_use_sketchfab", bool(os.environ.get("BLENDERMCP_SKETCHFAB_API_KEY"))),
            ("blendermcp_use_polypizza", bool(os.environ.get("BLENDERMCP_POLYPIZZA_API_KEY"))),
        ):
            try:
                setattr(scene, prop, on)
            except Exception:  # noqa: BLE001 — older add-on without that source
                pass


enable_asset_sources()
# A file opened by the agent (open_mainfile) brings its own scene settings.
bpy.app.handlers.load_post.append(bpy.app.handlers.persistent(enable_asset_sources))


# ── "Screenshots": a real render through the camera ──────────────────────────
VISIBLE_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT", "VOLUME", "POINTCLOUD", "CURVES", "GREASEPENCIL", "GPENCIL"}


def scene_bounds(scene):
    """Centre and radius of what's worth looking at (not a 500 m ground plane)."""
    boxes = []
    for obj in scene.objects:
        if obj.type not in VISIBLE_TYPES or obj.hide_render or obj.hide_get():
            continue
        pts = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        size = hi - lo
        flat_and_huge = size.z < 0.01 * max(size.x, size.y, 1e-6) and max(size.x, size.y) > 50
        boxes.append((lo, hi, flat_and_huge))
    subject = [b for b in boxes if not b[2]] or boxes
    if not subject:
        return Vector((0, 0, 0)), 2.0
    lo = Vector((min(b[0].x for b in subject), min(b[0].y for b in subject), min(b[0].z for b in subject)))
    hi = Vector((max(b[1].x for b in subject), max(b[1].y for b in subject), max(b[1].z for b in subject)))
    return (lo + hi) / 2, max((hi - lo).length / 2, 0.1)


def add_temp_camera(scene):
    centre, radius = scene_bounds(scene)
    data = bpy.data.cameras.new("DEX preview camera")
    data.lens = 50
    fov = 2 * math.atan(data.sensor_width / (2 * data.lens))
    dist = radius / math.sin(fov / 2) * 1.1
    data.clip_start = max(dist / 1000, 0.001)
    data.clip_end = dist + radius * 20
    cam = bpy.data.objects.new("DEX preview camera", data)
    scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.15, 0.75)).normalized()
    cam.location = centre + direction * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam


def scene_is_lit(scene):
    if any(o.type == "LIGHT" and not o.hide_render for o in scene.objects):
        return True
    world = scene.world
    tree = getattr(world, "node_tree", None) if world else None
    if not tree:
        return False
    for node in tree.nodes:
        if node.type == "TEX_ENVIRONMENT" and getattr(node, "image", None):
            return True
        if node.type == "BACKGROUND":
            colour = node.inputs[0].default_value
            strength = node.inputs[1].default_value
            if (0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2]) * strength > 0.15:
                return True
    return False


def add_temp_lights(scene, cam):
    """A neutral key + fill, like the viewport's studio light, for an unlit scene."""
    made = []
    for name, energy, yaw in (("DEX preview key", 4.0, 35), ("DEX preview fill", 1.2, -120)):
        data = bpy.data.lights.new(name, "SUN")
        data.energy = energy
        data.angle = math.radians(20)
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.rotation_euler = (math.radians(50), 0, cam.rotation_euler.z + math.radians(yaw))
        made.append(light)
    return made


def eevee_id():
    ids = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    for ident in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if ident in ids:
            return ident
    return "BLENDER_WORKBENCH"


def render_preview(max_size=800, filepath=None, format="png"):
    if not filepath:
        return {"error": "No filepath provided"}
    scene = bpy.context.scene
    r = scene.render
    saved = {
        "engine": r.engine, "x": r.resolution_x, "y": r.resolution_y, "pct": r.resolution_percentage,
        "camera": scene.camera, "fmt": r.image_settings.file_format,
    }
    saved_samples = getattr(scene.eevee, "taa_render_samples", None)
    temp = []
    view = "the scene camera"
    try:
        if scene.camera is None:
            scene.camera = add_temp_camera(scene)
            temp.append(scene.camera)
            view = "an automatic 3/4 view (the scene has no camera yet)"
        lit = scene_is_lit(scene)
        if not lit:
            temp += add_temp_lights(scene, scene.camera)
        aspect = (r.resolution_x or 16) / (r.resolution_y or 9)
        w, h = (max_size, max(1, round(max_size / aspect))) if aspect >= 1 else (max(1, round(max_size * aspect)), max_size)
        r.resolution_x, r.resolution_y, r.resolution_percentage = w, h, 100
        r.image_settings.file_format = "JPEG" if str(format).lower() in ("jpg", "jpeg") else "PNG"
        last_error = None
        for engine in (eevee_id(), "BLENDER_WORKBENCH", "CYCLES"):
            try:
                r.engine = engine
                if engine.startswith("BLENDER_EEVEE") and saved_samples is not None:
                    scene.eevee.taa_render_samples = 16
                if engine == "CYCLES":
                    scene.cycles.samples = 16
                bpy.ops.render.render(write_still=False)
                bpy.data.images["Render Result"].save_render(filepath=filepath)
                last_error = None
                break
            except Exception as e:  # noqa: BLE001 — try the next engine
                last_error = e
                log("preview render with", engine, "failed:", e)
        if last_error:
            return {"error": f"Couldn't render a preview: {last_error}"}
        note = f"Rendered through {view}" + ("" if lit else ", with a neutral studio light (the scene has no lights yet)")
        return {"success": True, "width": w, "height": h, "filepath": filepath, "method": note}
    finally:
        r.engine, r.resolution_x, r.resolution_y, r.resolution_percentage = saved["engine"], saved["x"], saved["y"], saved["pct"]
        r.image_settings.file_format = saved["fmt"]
        if saved_samples is not None:
            scene.eevee.taa_render_samples = saved_samples
        scene.camera = saved["camera"]
        for obj in temp:
            data, kind = obj.data, obj.type
            bpy.data.objects.remove(obj, do_unlink=True)
            if data is not None and data.users == 0:
                (bpy.data.cameras if kind == "CAMERA" else bpy.data.lights).remove(data)


# ── The server ───────────────────────────────────────────────────────────────
READ_ONLY = {
    "ping", "get_scene_info", "get_object_info", "get_viewport_screenshot", "get_addon_info",
    "get_world_state_snapshot", "describe_node_type", "bpy_api_lookup", "drain_human_activity",
    "get_telemetry_consent", "get_polyhaven_status", "get_hyper3d_status", "get_sketchfab_status",
    "get_polypizza_status", "get_hunyuan3d_status", "get_tripo_status", "get_polyhaven_categories",
    "search_polyhaven_assets", "get_polyhaven_asset_preview", "search_sketchfab_models",
    "get_sketchfab_model_preview", "search_polypizza_models", "export_scene",
}

last_activity = time.time()


def autosave():
    try:
        bpy.ops.wm.save_as_mainfile(filepath=args.autosave, copy=True, check_existing=False)
    except Exception as e:  # noqa: BLE001
        log("autosave failed:", e)


server = mod.BlenderMCPServer(host="127.0.0.1", port=args.port)
server.get_viewport_screenshot = render_preview
run_command = server.execute_command


def execute_command(command):
    global last_activity
    last_activity = time.time()
    try:
        return run_command(command)
    finally:
        if command.get("type") not in READ_ONLY:
            autosave()
        last_activity = time.time()


server.execute_command = execute_command

server.running = True
server.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    server.socket.bind(("127.0.0.1", args.port))
except OSError as e:
    status(error="port-in-use", detail=str(e))
    log("port", args.port, "is taken:", e)
    sys.exit(4)
server.socket.listen(5)
threading.Thread(target=server._server_loop, daemon=True).start()
status(ready=True)
log(f"listening on 127.0.0.1:{args.port} (Blender {bpy.app.version_string}, no window); scene autosaves to {args.autosave}")

try:
    while True:
        try:
            server._drain_command_queue()
        except Exception:  # noqa: BLE001 — one bad command must not take the host down
            traceback.print_exc()
        if time.time() - last_activity > args.idle:
            log(f"idle for {args.idle}s, saving and exiting")
            break
        time.sleep(0.03)
finally:
    autosave()
    server.running = False
    try:
        server.socket.close()
    except OSError:
        pass
    status(exited=True)
