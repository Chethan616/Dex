# Screenshot tools

These make the Play Store screenshots (`../screenshots/`) and the README images (`../../images/readme/`). Every screen is the real app with sample data. Nothing is mocked up by hand.

| What | How |
|---|---|
| **Phone screens** | `StoreShots.kt`: Robolectric renders the app's own Compose screens. The steps are at the top of `frames.py`. |
| **Desktop screens** | `desk/capture.mjs`: the hub's React UI runs in a headless Edge against the Vite dev server. `desk/mock.js` stands in for the Electron preload, and `desk/sample.js` holds the tasks. No DEX window opens. |
| **Play frames** | `frames.py` puts each phone screen in a 1080×1920 frame with a headline. |
| **The 3D scene** | `nook.py`: a cozy reading nook built from primitives and rendered with Cycles in Blender 5.2, run headless (`blender -b --python nook.py -- <out> 1400 96`, about a minute). It writes the render, the .glb the viewers open and the .blend. Pass the folder as `DEX_SAMPLE_FILES` to `capture.mjs` and `StoreShots.kt`. |
| **README images** | `readme_frames.py` makes the hero (the desktop window with the phone in front) and the desktop frames. |

Both Python scripts need the Inter variable font (OFL, from `github.com/google/fonts` `ofl/inter`). Save it as `Inter.ttf` next to them, or point `DEX_INTER` at it. `DEX_SHOTS` and `DEX_DESK_SHOTS` point at the rendered screens.

After a UI change:
1. Re-render the screens.
2. Run both Python scripts.
3. Check the images by eye before committing.
