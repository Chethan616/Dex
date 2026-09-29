# Blender — scenes, models, renders

**Blender runs in the background — no window.** The user keeps their desktop
(browsing, typing, gaming) while you model, and nothing needs focus. Never
open the Blender app on their screen unless they ask to see it
(`dex-blender show`).

| | What | When |
|---|---|---|
| **Blender tools** (`mcp__blender__*`, MCP server `blender` / `dex_blender`) | This task's background Blender — started by the first call, a few seconds: run Python in the scene, **see it** (`get_viewport_screenshot` = a real render), inspect objects, pull Poly Haven / Sketchfab / Poly Pizza assets, export GLB/FBX | Building and iterating — anything you need to look at |
| **`dex-blender`** | `status` · `scene` (the scene's .blend, autosaved after every change) · `run` a script / `render` a still in a separate headless Blender · `show` it to the user when asked | Final renders; batch scripts |
| **`dex-3d`** | An AI-generated, **textured** model (GLB) of one object, from a description or a picture (Hunyuan3D-2.1 on Hugging Face) | Hero objects that are hard to build by hand: characters, creatures, plants, detailed props |

## The quality bar

The user judges the render, not the effort. Blocky primitive stacks read as a 2/5. Unless they ask for low-poly:

- **No raw primitives in the final shot.** Everything gets bevels, and organic things get Subdivision (level 2 render) + smooth shading.
- **Enough resolution**: spheres 64×32 segments, cylinders 48+ vertices, curves with bevel depth and resolution ≥ 12. Faceting is a bug.
- **Organic shapes are shaped**: bend, taper and displace (Simple Deform, Displace with a Noise/Musgrave texture, proportional editing in bmesh). A palm trunk curves and tapers; leaves are many, arched and layered, instanced along the stem.
- **Hero objects come from `dex-3d`** or real assets, not from cubes — they'll beat hand-built geometry every time.
- **Materials have texture**: image textures (Poly Haven) or procedural noise/voronoi driving colour and roughness. A flat colour is a placeholder, not a finish.
- **Self-review before you finish**: rate the render 1–5 on silhouette & detail, materials, lighting, composition. Anything under 4 — fix the weakest one and render again. Say the scores in your answer.

There is nothing to open first: the tools start the background Blender. If one reports a problem, `dex-blender status` says what's running.
The scene carries over between turns of this task (autosave) — a follow-up like "make the roof blue" continues where you left off.
`"$DEX_BLENDER"` is the Blender exe if you need it directly.

## The loop — this is what makes it good

1. **Plan before geometry.** Write the shot down: subject, style (realistic / stylised / low-poly), mood, time of day, camera angle, what's in foreground / midground / background. `dex-state plan` it.
2. **Look first.** `get_addon_status` (Blender version) and `get_scene_info`. Start from an empty scene unless asked to edit one (delete the default cube, keep nothing you didn't mean to).
3. **Block out** with simple shapes at real-world scale (1 unit = 1 m: a door is 2 m, a chair seat 0.45 m). Get proportions and composition right before any detail. Ground, floors and water must reach past the edges of the camera's view (a 200–500 m plane, or a big disc) — a visible edge where the world ends ruins the shot. Small props must be big enough to read at the camera's distance.
4. **Look after every meaningful change** — `get_viewport_screenshot` — and actually judge it: proportions, overlaps, floating or sunken objects, empty frame. Fix, then look again. Never report something you haven't looked at.
   - There's no viewport in the background: the "screenshot" is a **quick EEVEE render through the scene camera** — exactly the shot. With no camera yet it shows an automatic 3/4 view of everything; with no lights yet, a neutral studio light (its result says so). So set up the camera early and the screenshots become the composition check: everything important inside the frame with breathing room, nothing cut off at the edges (tree tops, heads), subject filling roughly a third to two-thirds of the frame.
   - **The final check is a full render**: `dex-blender render "$(dex-blender scene)" preview.png --samples 16 --size 960x540`, then Read the PNG.
5. **Detail**: bevels (Bevel modifier, 2–3 segments) so edges catch light; Subdivision + shade smooth for organic forms; Array/Mirror/Solidify instead of duplicated hand-work; Geometry Nodes for scattering (rocks, grass, crowds).
6. **Materials — PBR**: Principled BSDF. Real values: metals Metallic 1, roughness 0.2–0.5; plastics roughness 0.3–0.6; wood/stone with textures. Poly Haven textures (`search_polyhaven_assets` type textures → `download_polyhaven_asset` → `set_texture`) beat flat colours every time. Add subtle roughness variation (Noise texture → ColorRamp → Roughness) so nothing looks like CG plastic.
7. **Light like a photographer**: a Poly Haven **HDRI** for the world (instant realism), plus a key light (Area, large = soft) and optionally a rim light behind the subject. Avoid a single point light and flat grey world.
8. **Camera**: 35–50 mm for natural, 85 mm+ for product shots, 18–24 mm for interiors/landscapes. Rule of thirds, a clear subject, something in the foreground for depth. Depth of field (f/2.8–5.6) focused on the subject for product/hero shots. `bpy.context.scene.camera` must be set.
9. **Render**: `dex-blender render "$(dex-blender scene)" out.png` — EEVEE (fast, default) for previews, `--engine cycles --samples 128–512` for finals (Cycles runs on this PC's GPU). It's a separate process, so the tools stay free. Look at the render (Read the PNG) before calling it done.
10. **Deliver** into `./outputs/<session>/`:
    - the `.blend` — `bpy.ops.wm.save_as_mainfile(filepath=..., copy=True)`;
    - **a `.glb` of the model** — `bpy.ops.export_scene.gltf(filepath=".../name.glb", export_format="GLB", use_selection=True)` with the model's objects selected (not the ground, lights or camera), or the `dex-3d` GLB itself if that is the whole model;
    - the final render.

    `dex-state file` each one. They show up in the task — and **on the user's phone**: a .glb opens in the built-in 3D viewer (turn, zoom), and a **.blend opens as the full scene** — the phone asks this PC to render it through the scene camera and to export everything, then shows Render and an interactive 3D of the whole scene inside its HDRI. So give the scene a real camera and world before you save it. A task from the phone isn't finished until its .glb and .blend are recorded. Mention the paths in the answer.

## Models — pick the right source

1. **`dex-3d`** for the hero object when it's organic or intricate: `dex-3d "a weathered bronze dragon statue"` (or `--image photo.png` for a specific look). It returns a textured GLB — `bpy.ops.import_scene.gltf(filepath=...)`. Free, but **about 1–2 per day** on the user's free Hugging Face account: one hero object per task, then duplicate/instance it. If it says the day's GPU time is used up or Hugging Face isn't connected, say so and fall back to 2 or 3.
2. **Real assets** when the thing exists in the world: Poly Haven (free, no key — models, HDRIs, textures), Sketchfab (realistic, specific) and Poly Pizza (low-poly, credit CC-BY authors) if their `get_*_status` says they're set up (free keys in Settings → Connections → Blender).
3. **Procedural in Python** for architecture, mechanical parts, anything repetitive or precise, and scatter (Geometry Nodes). Build from primitives + modifiers + bmesh to the quality bar above, name every object, parent parts to an Empty, one Collection per group.
4. The Blender tools' own generators (Hyper3D Rodin / Hunyuan3D / Tripo) only if their `get_*_status` says configured — they need paid keys.

After importing anything: read its `world_bounding_box`, then fix scale and location so it sits on the ground and fits the scene.

## Python in Blender 5.x — rules that avoid breakage

- `bpy_api_lookup` / `describe_node_type` **before** using an API you're unsure of — Blender's API changes between versions; don't guess.
- Find nodes by type, not name: `next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")` (names are localised).
- Don't hardcode enum values — read them: `[i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]`.
- `Material.use_nodes` is deprecated in 5.x (removed in 6.0) — new materials have nodes already; set colours on the BSDF inputs, not `material.diffuse_color`.
- Prefer data API (`bpy.data`, `obj.modifiers.new`, `bmesh`) over `bpy.ops` where possible — ops depend on context and selection.
- Keep each `execute_blender_code` call to one logical step, and `print()` what you changed so you can see it.
- **No UI in the background**: `bpy.context.screen`, areas, spaces and region_3d don't exist, and editor operators (`bpy.ops.view3d.*`, `screen.*`) fail. Use the data API, object/mesh operators and bmesh.
- Long jobs (Cycles finals, bakes, big scatters) don't belong in a tool call — they'd hit its time limit: `dex-blender render "$(dex-blender scene)" …`, or write a script and `dex-blender run script.py "$(dex-blender scene)"`.

## Safety

`execute_blender_code` runs arbitrary Python in Blender on the user's PC. Never delete or overwrite the user's own `.blend` files — work in a new file under `./outputs/<session>/` unless they asked you to edit theirs, and save their file under a new name first if you must. Don't read or send files outside the task.
