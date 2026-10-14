---
name: blender-background
description: "How DEX drives Blender with no window (per-task headless host), and how dex-3d makes AI models on free HF ZeroGPU Spaces"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-29T11:23:20.533Z
---

The user requires that Blender never takes over their screen: the agent models in the background while they keep full control of the desktop (said 2026-09-29).

- **Blender MCP** is the `blender` catalog entry, `builtIn: 'blender'`, pointing at `desktop/app/mcp-servers/blender/server.mjs`. That wrapper runs `uvx mcp-for-blender` (ahujasid, MIT) with `BLENDER_PORT` set to a per-task port.
  - On the first `tools/call`, it starts a windowless `blender -b -P host.py` for that task (`DEX_SESSION_ID`).
  - `host.py` reuses the add-on's `BlenderMCPServer` class but runs the drain loop itself; the add-on refuses `-b` on its own.
  - It overrides `get_viewport_screenshot` with an EEVEE render through the camera.
  - It autosaves to `<userData>/blender/<session>/scene.blend` after every mutating command.
  - It quits after 15 idle minutes.
- `host.py` is copied out of app.asar before use, because Blender can't read asar.
- Blender is auto-connected at startup when installed, unless the user turned it off.
- Codex gets `DEX_SESSION_ID` via the launch env, because it whitelists MCP env vars.
- **dex-3d** is text → image → 3D:
  - Text → image uses the FLUX.1-schnell ZeroGPU Space. The HF Inference API route was retired in Sept 2026.
  - Image → 3D uses Hunyuan3D-2.1, falling back to TRELLIS. Both run via `@gradio/client` with the user's HF OAuth token.
  - The free quota is about 1–2 models per day.
- **.blend on the phone:** `fetch_file` with `mode: 'scene'` makes the PC run `scene_preview.py` headless.
  - It returns render.jpg, scene.glb (procedural colours flattened), sky.jpg and view.json (the camera in model-viewer terms).
  - Results are cached under `<userData>/blender/scene-previews`, keyed by file version plus script version.
  - The phone shows them in `SceneViewerDialog` (Render | 3D).
- The laptop has hard-frozen repeatedly (Sept 2026, BugcheckCode 0), sometimes under GPU load. Keep renders modest; the user was advised to update the AMD driver.
- **Open gap:** `uvx` (uv) must exist on the PC. There's no auto-install yet, which matters for "installed users never run setup".

Related: [[tech-stack]], [[phone-and-accounts]], [[phone-adb-testing]]
