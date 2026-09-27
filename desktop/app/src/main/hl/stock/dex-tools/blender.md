# Blender — scenes, models, renders

Two ways in, use both:

| | What | When |
|---|---|---|
| **Blender tools** (`mcp__blender__*`, MCP server `blender` / `dex_blender`) | Drive the **open** Blender: run Python in the live scene, **see the viewport** (`get_viewport_screenshot`), inspect objects, pull Poly Haven / Sketchfab / Poly Pizza assets, export GLB/FBX | Building and iterating — anything you need to look at |
| **`dex-blender`** | `open` Blender and wait until the tools can reach it · `run` a script headless · `render` a still headless | Starting Blender; batch scripts; the final render |
| **`dex-3d`** | An AI-generated, **textured** model (GLB) of one object, from a description or a picture (Hunyuan3D-2.1 on Hugging Face) | Hero objects that are hard to build by hand: characters, creatures, plants, detailed props |

## The quality bar

The user judges the render, not the effort. Blocky primitive stacks read as a 2/5. Unless they ask for low-poly:

- **No raw primitives in the final shot.** Everything gets bevels, and organic things get Subdivision (level 2 render) + smooth shading.
- **Enough resolution**: spheres 64×32 segments, cylinders 48+ vertices, curves with bevel depth and resolution ≥ 12. Faceting is a bug.
- **Organic shapes are shaped**: bend, taper and displace (Simple Deform, Displace with a Noise/Musgrave texture, proportional editing in bmesh). A palm trunk curves and tapers; leaves are many, arched and layered, instanced along the stem.
- **Hero objects come from `dex-3d`** or real assets, not from cubes — they'll beat hand-built geometry every time.
- **Materials have texture**: image textures (Poly Haven) or procedural noise/voronoi driving colour and roughness. A flat colour is a placeholder, not a finish.
- **Self-review before you finish**: rate the render 1–5 on silhouette & detail, materials, lighting, composition. Anything under 4 — fix the weakest one and render again. Say the scores in your answer.

If a Blender tool says it can't connect: `dex-blender open` (or `dex-blender open path\to\scene.blend`), then retry.
`"$DEX_BLENDER"` is the Blender exe if you need it directly.

## The loop — this is what makes it good

1. **Plan before geometry.** Write the shot down: subject, style (realistic / stylised / low-poly), mood, time of day, camera angle, what's in foreground / midground / background. `dex-state plan` it.
2. **Look first.** `get_addon_status` (Blender version) and `get_scene_info`. Start from an empty scene unless asked to edit one (delete the default cube, keep nothing you didn't mean to).
3. **Block out** with simple shapes at real-world scale (1 unit = 1 m: a door is 2 m, a chair seat 0.45 m). Get proportions and composition right before any detail. Ground, floors and water must reach past the edges of the camera's view (a 200–500 m plane, or a big disc) — a visible edge where the world ends ruins the shot. Small props must be big enough to read at the camera's distance.
4. **Screenshot after every meaningful change** — `get_viewport_screenshot` — and actually judge it: proportions, overlaps, floating or sunken objects, empty frame. Fix, then look again. Never report something you haven't looked at.
   - **The screenshot shows the editor viewport, not the camera.** To judge the *shot*, look through the camera first — in `execute_blender_code`: for every `VIEW_3D` area, `area.spaces[0].region_3d.view_perspective = "CAMERA"` and `area.spaces[0].shading.type = "MATERIAL"` — then screenshot. Everything important must be inside the frame with breathing room: nothing cut off at the edges (tree tops, heads), subject filling roughly a third to two-thirds of the frame.
   - **The final check is a real render**: `dex-blender render scene.blend preview.png --samples 16 --size 960x540`, then Read the PNG. Lighting, materials and edges only show up for real there.
5. **Detail**: bevels (Bevel modifier, 2–3 segments) so edges catch light; Subdivision + shade smooth for organic forms; Array/Mirror/Solidify instead of duplicated hand-work; Geometry Nodes for scattering (rocks, grass, crowds).
6. **Materials — PBR**: Principled BSDF. Real values: metals Metallic 1, roughness 0.2–0.5; plastics roughness 0.3–0.6; wood/stone with textures. Poly Haven textures (`search_polyhaven_assets` type textures → `download_polyhaven_asset` → `set_texture`) beat flat colours every time. Add subtle roughness variation (Noise texture → ColorRamp → Roughness) so nothing looks like CG plastic.
7. **Light like a photographer**: a Poly Haven **HDRI** for the world (instant realism), plus a key light (Area, large = soft) and optionally a rim light behind the subject. Avoid a single point light and flat grey world.
8. **Camera**: 35–50 mm for natural, 85 mm+ for product shots, 18–24 mm for interiors/landscapes. Rule of thirds, a clear subject, something in the foreground for depth. Depth of field (f/2.8–5.6) focused on the subject for product/hero shots. `bpy.context.scene.camera` must be set.
9. **Render**: `dex-blender render scene.blend out.png` — EEVEE (fast, default) for previews, `--engine cycles --samples 128–512` for finals (Cycles runs on this PC's GPU). Look at the render (Read the PNG) before calling it done.
10. **Deliver**: save the `.blend` (`bpy.ops.wm.save_as_mainfile`) in `./outputs/<session>/`, render, `dex-state file` both, and if the user is on their phone or asked, `dex-send` the render. Mention both paths in the answer.

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
- Long jobs (heavy renders, bakes, big scatters) go headless: write the script, `dex-blender run script.py scene.blend`.

## Safety

`execute_blender_code` runs arbitrary Python inside the user's Blender. Never delete or overwrite the user's own `.blend` files — work in a new file under `./outputs/<session>/` unless they asked you to edit theirs, and save their file under a new name first if you must. Don't read or send files outside the task.
