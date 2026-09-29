# DEX for Android — roadmap

## 1.0.14

- **Blender scenes (.blend) open on the phone.** The PC prepares them in a windowless Blender (`mcp-servers/blender/scene_preview.py`, ~20 s, then cached per file version). The viewer has two tabs:
  - **Render:** through the scene camera, with the real materials and light. Pinch to zoom, double-tap to fit.
  - **3D:** the whole scene inside its HDRI sky, starting from that camera. Procedural colours are flattened, heavy meshes decimated, textures ≤ 1024 px.
  - On a portrait phone the 3D steps back to frame the scene like the render, and the orbit stays above the terrain.
  - Transport: `fetch_file` with `mode: "scene"`, so no Firestore rules change was needed.
- **Pictures are sorted by type:** every image goes under Pictures, not just ones that came with a preview. Old ones without a preview are downloaded for the grid.
- **Agent paths:** files recorded as Git Bash paths (`/tmp/…`, `/c/…`, relative) now resolve on the PC (`hl/agentPaths.ts`), so they get previews and can be fetched. `dex-state file` sends absolute Windows paths.
- **No junk files:** Blender's temp/backup files (`.blend@`, `.blend1`) and other scratch files aren't recorded, and older ones are hidden on the phone.

## 1.0.9

- **Blender works in the background.** No Blender window, nothing to keep focused: the user browses or games while the agent models.
  - `mcp-servers/blender` starts one windowless Blender per task on the first Blender tool call, running `host.py` (the MCP for Blender add-on's server, driven by its own loop).
  - The scene autosaves after every change and carries over between turns. The host quits after 15 idle minutes.
  - Screenshots are real EEVEE renders through the camera (an auto 3/4 view with studio light when there's none yet).
  - Blender is connected automatically when installed.
- **"Make a 3D model" from the phone:** the agent records the `.glb` (plus a render). It arrives in the phone chat, and the phone downloads it right away, so the tap opens the 3D viewer at once.
- `dex-3d` text → 3D works again: Hugging Face retired the FLUX Inference API route, so the reference picture now comes from the FLUX.1-schnell ZeroGPU Space.
- **3D viewer:** pinch-zoom no longer snaps back. The end of a pinch (two fingers lifting) was read as a double-tap, which reset the view.
- **Every task has its own bot avatar**, the same on phone and PC, instead of one per engine. The engine pickers keep the engine's bot.
- "Getting it from your PC" now reads "Downloading from your PC…". Once downloaded, a file shows "on your phone".

## 1.0.8 — fixes from testing 1.0.7 on a real phone

- **3D viewer showed nothing.** The model loaded but was drawn into a 0-px-tall box: `AndroidView` gives a WebView WRAP_CONTENT params, and Chromium then lays the page out against a zero-height viewport. Fix: MATCH_PARENT params, plus `<model-viewer>` pinned with `position: fixed`. Also the title pill was dark-on-dark.
- **Files from the PC are kept on the phone** (per task + path, for a day). Reopening a model or a PDF is instant and doesn't pull megabytes through Firestore again.
- **Files sheet listed the same file twice** (`C:\a\b.glb` vs `C:/a/b.glb`).
- **Session composer while a task runs:** two rows. The text gets the full width, and attach · pause · stop · mic · send sit underneath.
- **Prompt bar:** the agent chip no longer shrinks to "…". **New task sheet:** Claude · Codex · Browser fit.
- **Markdown:** emphasis nests (`**the *real* one**`, links inside bold).
- **Stopping a task** says "Stopped", not "Done" or a red error: the pill, the card and the notification ("Stopped · …").
- Desktop:
  - Claude Code dropped whitespace-only stream deltas, which lost spaces ("114users") and newlines (breaking tables).
  - The Done card's echo check ignores whitespace and Markdown.
  - A follow-up no longer replaces the task's opening request: the title and first message stay the original request after a reload.

## Shipped in 1.0.7 (top picks)

- **Phone → PC files.** Attach photos (library or camera) and files to a new task or a follow-up. Photos are shrunk to ≤ 2048 px JPEG. Uploads go through Firestore chunks (`uploads/{id}`, free Spark plan), and the PC turns them into normal attachments.
- **Share → DEX** from any app: links, text, photos, PDFs, any file. It opens the new-task sheet pre-filled, with one-tap actions ("What's in this?", "Make a 3D model of this", "Summarize this page", …).
- **Built-in 3D viewer** for `.glb` / `.gltf`: Google's `<model-viewer>`, bundled offline. Drag to turn, pinch to zoom, double-tap to reset, plus Share / Open with…
- **Notification actions.** Reply to a Done or Couldn't-finish notification (a follow-up without opening the app). Stop on the live "working" notification.
- Desktop: attach files in the chat window's follow-up box (📎, drag-and-drop on the window, paste a screenshot). Attachments show on the message, on the desktop and the phone.

## Next tier — waiting for a go-ahead

### 1. Home-screen widget + Quick Settings tile
- Glance widget, 2×1 and 4×2. The DEX avatar, an "Ask DEX" pill (opens the prompt bar focused, or voice mode on long-press) and the running task's live line with a thin progress beam.
- Quick Settings tile: "Ask DEX" opens voice mode. It shows "Working…" with the task name while something runs.
- Data: TaskWatcher already has the live sessions, so it pushes `GlanceAppWidget.update()` on change. No extra Firestore reads.

### 2. Manage tasks on the phone
- Search (prompt + summary), filter chips: Running · Needs you · Failed · Done.
- Swipe actions: pin (pinned section on top), rename, delete. Delete asks and then sends a new `delete_session` command, so the PC deletes it and the existing delete sync removes it everywhere.
- Needs: `rename_session` / `delete_session` / `pin` commands in the bridge and rules.

### 3. Fingerprint lock
- Optional app lock (BiometricPrompt, `BIOMETRIC_STRONG or DEVICE_CREDENTIAL`) on open and after N minutes in the background.
- Risky approvals (registry writes, process launch, filesystem writes outside safe paths) also ask for a fingerprint before Approve is sent, both in-app and from the notification (the notification opens a tiny confirm activity).

### 4. Watch it work ("peek")
- A 👁 button on a running task. The PC captures the agent's browser view every ~1.5 s, **only while you're looking**, as a small JPEG (~40 KB) in `users/{uid}/peek/{sessionId}`, one document overwritten in place.
- Stops automatically when you leave the screen, or after 2 minutes. Costs about 40 writes per minute of watching, well inside the free plan.
- Optional: tap-to-point, sending a coordinate the agent sees as a hint (later).

### 5. Voice mode — matching the desktop's look
The desktop pairs **VoiceBeam** (a colourful glow along the bottom edge that rises and blooms with your voice) with the **thinking orbs**. Voice mode on the phone is the same language, full-screen:

```
┌──────────────────────────────┐
│  ✕                  PC · Codex│   top: close, which PC / agent
│                              │
│            ◉ orb             │   DexOrb, big: listening → thinking →
│        (Listening…)          │   speaking states, as on the desktop
│                              │
│   “find me a flight to NYC   │   live transcript, words appear as
│    next friday under $600”   │   they're recognised (partial results)
│                              │
│ ▁▂▃▅▇ VoiceBeam glow ▇▅▃▂▁   │   bottom-edge beam driven by mic level
│   ⌨ type     ● mic     ⏹ stop│   (RMS from SpeechRecognizer)
└──────────────────────────────┘
```

- **Listening:** SpeechRecognizer with partial results. The beam's height and bloom follow `onRmsChanged`, and the orb is in its listening state. It ends on silence, or tap the mic.
- **Working:** the task is sent (new task, or a follow-up if voice was opened from a task). The orb moves to its thinking states in step with the live `lastLine` ("Opening Google Flights…", shown as a caption).
- **Answering:** on Done, Android TextToSpeech reads a short spoken version of the summary (Markdown stripped, tables summarised as "I found 7 flights, cheapest $470 on Etihad…"). The orb is in its speaking state, the beam pulses with the TTS audio level, and the full answer is a tap away.
- **Barge-in:** start talking and the reading stops, then it listens again. That makes it a real back-and-forth conversation.
- **Haptics** on each state change; Material 3 Expressive shapes and springs.
- **Entry points:** mic long-press anywhere, the Quick Settings tile, the widget, and the "Hey DEX" assistant shortcut (Android App Actions / assist intent).
- All on-device and free: Android SpeechRecognizer and TextToSpeech, no cloud speech API.
- Build: port VoiceBeam's shader-like gradient to a Compose `Canvas` with `Brush.radialGradient` layers animated by the level (it's a glow, not audio DSP, so it's cheap).

### Later
- Scheduled / recurring tasks ("every morning at 8, summarise my mail").
- Pick between several PCs.
- Tablet and foldable layout: list on the left, task on the right.
- Usage and cost per engine.
- "View in your room": AR for 3D models (Scene Viewer needs a public URL or ARCore, so this needs its own design).
