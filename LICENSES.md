# Third-party licenses — Dex

This file is the authoritative audit of every third-party component bundled with or vendored into Dex. **Pre-shipping rule:** no AGPL-licensed dependency is permitted in the shipped product. Optional add-ons the user installs themselves are not covered here.

Status legend: `✓ verified` · `△ pending` (filled in during the phase that vendors it) · `✗ blocked` (license incompatible — must remove or replace).

---

## What this repo ships

The Windows app (`desktop/app`, Electron) and the Android app (`android`).
The old Flutter client, the forked OpenClaw runtime (`dex/core`) and its
Python drivers were removed on 2026-10-07; their licenses no longer apply.
Agent engines (Claude Code, Codex, OpenCode) are installed by the user, not
bundled.

## Android app (`android`)

| Package | License | Why | Status |
|---|---|---|---|
| Jetpack Compose, Material 3, AndroidX | Apache-2.0 | the UI | ✓ |
| `androidx.emoji2:emoji2-emojipicker` 1.5 | Apache-2.0 | every emoji, for reactions | ✓ |
| Firebase Auth / Firestore / Messaging | Apache-2.0 | pairing with the desktop | ✓ |
| Coil | Apache-2.0 | images | ✓ |

---

## Desktop app: document viewers (`desktop/app`, unify P2)

Added for the workspace's document tabs (`docs/unify/PLAN.md` §3.9). All permissive; bundled into the renderer.

| Package | License | SPDX | Why | Status |
|---|---|---|---|---|
| `pdfjs-dist` 6.3 | Apache-2.0 | `Apache-2.0` | PDF pages with a text layer | ✓ |
| `docx-preview` 0.4 | Apache-2.0 | `Apache-2.0` | .docx as real pages, with tracked changes | ✓ |
| `jszip` (transitive of docx-preview) | MIT or GPL-3.0 | `MIT OR GPL-3.0-or-later` | unzips .docx; used under MIT | ✓ |
| SheetJS CE `xlsx` 0.20.3 (from cdn.sheetjs.com; npm's 0.18.5 has known parser CVEs) | Apache-2.0 | `Apache-2.0` | .xlsx / .csv sheets | ✓ |
| `@google/model-viewer` 4.3 | Apache-2.0 | `Apache-2.0` | .glb / .gltf, as on the phone | ✓ |
| `three` 0.183 (peer of model-viewer) | MIT | `MIT` | 3D rendering | ✓ |
| `lit`, `@monogrid/gainmap-js` (transitive of model-viewer) | BSD-3-Clause, MIT | `BSD-3-Clause`, `MIT` | model-viewer's runtime | ✓ |

## Fonts

| Font | License | Source | Status |
|---|---|---|---|
| Geist (variable) | OFL-1.1 | https://github.com/vercel/geist-font | △ pending — confirm in Phase 5 (download single variable .ttf) |
| Geist Mono (variable) | OFL-1.1 | https://github.com/vercel/geist-font | △ pending — confirm in Phase 5 |

---

## Out-of-band / opt-in components (NOT bundled)

User-installed if used, not shipped in DEX:

- **Open Interpreter** — AGPL. Not bundled. User may install separately at their own risk.
- **Ollama / local model weights** — not bundled; users provide their own.

---

## Audit checklist (for Phase 7 close-out)

- [ ] Every row above is `✓ verified`, not `△ pending`.
- [ ] No transitive dependency is AGPL (run a license check on `desktop/app/yarn.lock` and the Gradle dependencies).
- [ ] Attribution screen / "About Dex" in the app surfaces this list (or a link to it).
