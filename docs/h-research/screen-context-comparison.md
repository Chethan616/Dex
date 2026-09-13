# Phase H.1 — Screen Context Research Report

**Status**: research-first deliverable. **NO H.2+ implementation may begin until this report is reviewed and the per-category recommendations are confirmed.**

**Generated**: 2026-06-07
**Author**: Chethan616 + Claude (Dex)
**Caveat**: Same as G.1 — star counts and recent activity are best-effort from training knowledge through early 2026. Spot-check the top 3-5 picks via live GitHub before any H.2 commit lands.

---

## 0. Why this report exists

Phase H wires the "explain what I'm looking at" experience: user on a phone asks "explain this code" → Dex on the laptop reads the active window state → answers through the phone. **Two hard constraints** from the plan:

1. **Observer mode by default.** No bring-to-foreground, no tab switch, no focus theft, no fullscreen interrupt. Read the currently-visible state only.
2. **Cross-device works without uploads.** Phone never sees the file/screenshot — only the structured ContextPayload + optional compressed screenshot if the user explicitly opts in.

Like G.1, this report enforces **reuse > extend > build**. Mature OS APIs and well-tested libraries beat anything we'd hand-roll.

---

## 1. Categories audited

| Category | Why Dex needs it | Candidates evaluated |
|---|---|---|
| **Screen capture (scoped to foreground window)** | Read just the active window's pixels — NOT the full desktop | Win32 BitBlt / PrintWindow, macOS CGWindowListCreateImage, X11 XGetImage, Wayland xdg-desktop-portal ScreenCast, node-screenshots, electron's `desktopCapturer`, screenshot-desktop |
| **Accessibility tree / UI Automation** | Read structured UI elements (text fields, buttons, table cells) | Microsoft UIA (Win32), macOS AXUIElement, Linux AT-SPI2, `uiautomation` Python, `pywinauto`, `pyatspi`, RobotFramework |
| **Browser DOM extraction** | Pull live HTML / accessibility tree from Chrome / Edge / Firefox | Chrome DevTools Protocol (CDP), Playwright introspection, browser extensions (Manifest V3), Firefox Marionette |
| **Screen text understanding (vision)** | Convert screenshot → structured `[(bbox, label, type)]` | OmniParser (Microsoft), GPT-4V, LLaVA-Next, Florence-2, Set-of-Mark prompting, Pix2Struct |
| **OCR fallback** | When no UIA / no DOM, read pixels via OCR | Tesseract, PaddleOCR (re-evaluated from G.1) |
| **Editor introspection** | Tap VS Code / JetBrains accessibility extensions for source code context | VS Code MCP server (microsoft/vscode-mcp), JetBrains MCP, JetBrains LSP bridge |

---

## 2. Evaluation matrix (same shape as G.1)

| Criterion | What we check |
|---|---|
| **License** | Must be MIT / Apache 2.0 / BSD-3 OR a permitted system API |
| **Local-first** | Zero cloud calls |
| **Non-disruption compatible** | The API must NOT force foreground / focus changes |
| **OS coverage** | Windows is mandatory; macOS / Linux desktop are stretch |
| **Permission model** | What does the user have to grant? Once or per-session? |
| **Resource footprint** | Memory + disk |
| **Maintenance** | Active commits in last 90 days; OR is it a stable OS API |
| **Embed cost** | Lines of glue code; native module required? |

---

## 3. Category 1 — Screen capture (scoped to foreground window)

### 3.1 Win32 BitBlt + PrintWindow

Native Win32 APIs. **Free, license-clean (OS API).** Two strategies:
- **BitBlt** — copies pixels from a window's device context. Misses occluded portions of the target window if another window overlays it.
- **PrintWindow with PW_RENDERFULLCONTENT** — asks the window to render itself into our DC, returning even occluded portions. Slower (~50-200 ms per capture) but correct.

**Non-disruption: ✓.** Neither call touches Z-order, focus, or visibility. They just read pixels from the window we already know about (via `GetForegroundWindow`).

**Recommendation: PrintWindow with PW_RENDERFULLCONTENT as the default; BitBlt as a fallback when PrintWindow's render fails (some games / DRM apps refuse it).**

### 3.2 node-screenshots

Native Rust addon, Node bindings. License: MIT. **Captures the full desktop, not scoped to a window.** Useful for OS X / Linux but doesn't enforce Dex's non-disruption invariant (it'd capture other apps too). **Pass on for primary capture; use it only on macOS / Linux as a stopgap until we wrap CGWindowListCreateImage / xdg-desktop-portal directly.**

### 3.3 screenshot-desktop

Pure Node + native binaries (uses platform tools like `screencapture` on macOS, `gnome-screenshot` on Linux, `wmctrl` chains). License: MIT. **Whole-desktop capture again.** Same pass.

### 3.4 Electron's `desktopCapturer`

Useful if Dex were Electron. **It's not** — Flutter desktop. Out of scope.

### 3.5 macOS — CGWindowListCreateImage

Native AppKit / Quartz API. **Free, scoped to a window list we specify.** Requires the "Screen Recording" permission — granted once per app, per system preference change. **Non-disruption: ✓.** Recommendation: wrap via a small Swift / Objective-C bridge. ~30 LOC.

### 3.6 Linux X11 — XGetImage

Native Xlib. **Free, scoped to the window XID.** Works on traditional X11. **Non-disruption: ✓.** Recommendation: shell out to `import` (ImageMagick) for the MVP; native bindings later.

### 3.7 Linux Wayland — xdg-desktop-portal ScreenCast

Cross-compositor standard. Permission prompt every session by default. License: ScreenCast portal is LGPL-2.1 (system service, not bundled). **Non-disruption: ✓ (it's the OS asking, not Dex).** Recommendation: use as the Wayland primary; document the per-session prompt clearly.

### Category 1 — Recommendation

**Per-OS scoped-window capture:**
- **Windows**: `PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT)` via a small native module (~50 LOC of C++).
- **macOS**: `CGWindowListCreateImage(rect, .optionIncludingWindow, windowID, .nominalResolution)` via Swift bridge.
- **Linux X11**: `XGetImage` via Xlib; or shell out to ImageMagick `import` for MVP.
- **Linux Wayland**: `org.freedesktop.portal.ScreenCast` via dbus; respect per-session prompts.

**Don't bundle a whole-desktop capture library** like node-screenshots — it'd violate the principle of "only the active window."

---

## 4. Category 2 — Accessibility tree / UI Automation

### 4.1 Windows UI Automation (UIA)

Native COM API. License: free OS API. **The gold standard** for Windows accessibility introspection. Reads structured element trees: text fields, buttons, table cells, with parent/child/sibling navigation. **What UFO² already uses.** Re-use here.

Node bindings: `node-uiauto` exists but unmaintained. **Recommendation: shell out to a small Python sidecar using `uiautomation`** (well-maintained, MIT, Pythonic API). Reuse the UFO² venv.

### 4.2 macOS AXUIElement (AppKit Accessibility API)

Native API. Requires the "Accessibility" permission (granted once per app). Strong but Objective-C-only. **Recommendation: small Swift bridge** reading the focused window's AX tree → JSON.

### 4.3 Linux AT-SPI2

D-Bus-based accessibility tree. Apps must opt-in (most GTK/Qt apps do). Spotty coverage on Linux compared to Windows UIA. **Recommendation: use pyatspi via the Python sidecar** for the apps that support it; OCR fallback elsewhere.

### 4.4 pywinauto

Python library wrapping Windows UIA + legacy MSAA. License: BSD-3. **Mature, well-documented.** Alternative to `uiautomation`. Both work; `uiautomation` has a slightly cleaner API surface for our read-only needs.

### 4.5 RobotFramework

Test framework, not a library. Out of scope.

### Category 2 — Recommendation

**Python sidecar with `uiautomation` (Windows), Swift bridge for AX (macOS), `pyatspi` (Linux).**
- Sidecar exposes a single MCP-like endpoint: `getAccessibilityTree(hwnd?) → {elements: [{kind, name, value, role, bounds}]}`.
- Reuses the UFO² Python venv; no new install for Dex users who already set up UFO².
- ~150 LOC of Python.

---

## 5. Category 3 — Browser DOM extraction

### 5.1 Chrome DevTools Protocol (CDP)

The native protocol used by Chrome / Edge / Brave / Vivaldi (all Chromium). Requires the browser launched with `--remote-debugging-port=N`. **Most users don't have this on by default.**

License: free protocol. **Non-disruption: ✓.** Recommendation: detect if CDP is reachable; if yes, pull the active tab's accessibility tree via `Accessibility.getFullAXTree`. If no, fall back to UIA on the browser's outer window (less detail).

### 5.2 Playwright introspection

We already use Playwright for browser-control. Can we also use it for CONTEXT extraction? **No** — Playwright launches its own browser session; it can't attach to the user's existing Chrome/Edge. Out of scope here.

### 5.3 Browser extensions (Manifest V3)

A WebExtension we ship can read the active tab's DOM via `chrome.tabs.executeScript` (MV2) or content scripts (MV3). **Requires the user to install the extension once.** Strong privacy story: extension only activates on Dex's request via a long-lived port.

**Pros**: works without `--remote-debugging-port`; richer access than CDP for some properties.
**Cons**: install friction; users on Edge / Brave / Vivaldi need separate installs (or a single XPI / CRX that works across Chromium browsers).

### 5.4 Firefox Marionette / WebDriver BiDi

Firefox's debugging protocol. License: MPL-2.0 (Mozilla). Niche; Firefox is <5% of our target users. **Defer** until somebody asks.

### Category 3 — Recommendation

**Tiered fallback chain:**
1. **Browser extension** if installed (best fidelity, no port required).
2. **CDP** via `--remote-debugging-port` if enabled by the user (document the flag in SETUP.md).
3. **UIA + OCR** on the browser's outer window (worst, but always available).

The extension is the right v2 investment. **For H.2's MVP, skip the extension and use CDP + UIA fallback only.** Add the extension in a separate Phase H follow-up.

---

## 6. Category 4 — Screen text understanding (vision)

### 6.1 OmniParser (Microsoft)

MIT-licensed; ONNX weights ~2 GB. Local. **Already adopted in Dex's plan (Phase C.5 + E).** Output: `[(bbox, label, type)]` for every interactive element. **Strong fit for Phase H** when UIA / CDP fall short — feeds the structured payload directly into the screen-context response. Recommendation: re-use the existing scaffold; H.3 wires it.

### 6.2 GPT-4V / Claude Sonnet vision

Strong, multimodal, expensive, cloud. **Out of scope** — Phase H's hard rule is local-first. The user's chat LLM gets the structured ContextPayload, but the EXTRACTION must be local.

### 6.3 LLaVA-Next

Open-source visual reasoning model. License: Apache 2.0. Heavier than OmniParser (~7B params → ~14 GB disk for f16 weights, ~7 GB Q4_K_M). **Defer** — OmniParser covers our needs at a tenth the footprint.

### 6.4 Florence-2 (Microsoft)

Vision foundation model. ~800M params. License: MIT. **Strong second pick if OmniParser doesn't generalize to a specific app**, but adds dependency complexity. Defer.

### 6.5 Set-of-Mark prompting

Technique (not a library) where you ANNOTATE screenshots with numbered overlays so the LLM can refer to them. **Useful technique to apply on top of OmniParser's output**, not a competing library.

### 6.6 Pix2Struct

Google research model for screenshot → structured representation. ~280M params. License: Apache 2.0. **Defer**; OmniParser's MS adoption + active maintenance wins.

### Category 4 — Recommendation

**OmniParser for v1.** Same model used in Phase E. Both file-intel (G) and screen-context (H) consume the same `parse_screen` MCP tool. Single Python venv hosts the inference. **No new vision dependency added.**

---

## 7. Category 5 — OCR fallback (re-evaluated from G.1)

Same conclusions as G.1: **Tesseract via native binary, `tesseract.js` fallback.** PaddleOCR for Asian-language screenshots if the user opts in.

The OCR runs only when BOTH the accessibility tree AND OmniParser fail to find usable text. In practice this is rare on Windows + macOS (UIA / AX coverage is good); more common on Linux Wayland with minimal toolkits.

---

## 8. Category 6 — Editor introspection

### 8.1 VS Code MCP server (`microsoft/vscode-mcp`)

Microsoft's official MCP server for VS Code. License: MIT. Exposes the active editor's source code, selection, file path, language ID. **Perfect fit for the "explain this code" demo.** Recommendation: when the foreground process is `code.exe` / `cursor.exe`, route the screen-context request through this MCP server INSTEAD of the generic OCR + UIA path. Vastly more accurate.

### 8.2 JetBrains MCP

Community MCP server for IntelliJ / PyCharm / WebStorm / Rider. Less mature than VS Code's. License: MIT. **Use it when present**, fall back to UIA + OCR otherwise.

### 8.3 JetBrains LSP bridge

Language Server Protocol bridge. Not strictly editor introspection; out of scope.

### Category 6 — Recommendation

**Tiered editor introspection:**
1. **VS Code / Cursor** → `microsoft/vscode-mcp` (requires the user installs the extension once).
2. **IntelliJ family** → JetBrains MCP server (same install once).
3. **Other editors** (Notepad++, Sublime, Vim/Neovim in terminal) → fall back to UIA + OCR.

These integrations DRAMATICALLY improve the "explain this code" experience because we get the actual source, not OCR'd pixels. Worth investing in.

---

## 9. The non-disruption invariant — a static-policy check

Phase H's hardest rule: **never disrupt the user's workspace**. The plan calls for `packages/screen-context/test/policy.test.ts` — a static grep that fails the build if any banned API call sneaks into the screen-context source. Banned calls:

| API | OS | Why banned |
|---|---|---|
| `SetForegroundWindow` | Win32 | brings target window to foreground |
| `BringWindowToTop` | Win32 | re-orders Z |
| `ShowWindow(SW_RESTORE)` / `ShowWindow(SW_SHOW)` | Win32 | reveals hidden window |
| `SetFocus` | Win32 | steals focus |
| `mouse_event` / `SendInput` (with INPUT_KEYBOARD/MOUSE) | Win32 | input synthesis |
| `SwitchToThisWindow` | Win32 | alt-tab equivalent |
| `chrome.tabs.update` | CDP / extension | switches tabs |
| `[NSApplication activate]` / `activateIgnoringOtherApps:` | macOS | brings app forward |
| `AXUIElementPerformAction(kAXRaiseAction)` | macOS | brings window forward |
| `XRaiseWindow` | X11 | brings window forward |

**Recommendation**: implement the static-check as a Vitest test that greps screen-context source for these tokens at module scope. False positives in comments / strings handled by requiring the API to appear as `\bAPI\s*\(` (call site, not narrative reference).

---

## 10. Final recommendations — per-category cheat sheet

| Surface | Pick | License | Rationale |
|---|---|---|---|
| **Win window capture** | `PrintWindow(PW_RENDERFULLCONTENT)` native module | OS API | Scoped to foreground window only |
| **macOS window capture** | `CGWindowListCreateImage` via Swift bridge | OS API | Scoped to focused window |
| **Linux X11 capture** | `XGetImage` or ImageMagick `import` | LGPL / Apache 2.0 | Stable |
| **Linux Wayland capture** | `xdg-desktop-portal ScreenCast` | OS service | Cross-compositor standard |
| **Win UIA** | Python sidecar with `uiautomation` | MIT | Reuse UFO² venv |
| **macOS AX** | Swift bridge to AXUIElement | OS API | Native |
| **Linux AT-SPI2** | Python sidecar with `pyatspi` | LGPL | Reuse same venv |
| **Browser DOM** | Extension > CDP > UIA fallback | mixed | Tiered |
| **Vision** | OmniParser (already adopted) | MIT | Reuse Phase E |
| **OCR fallback** | Tesseract | Apache 2.0 | Same as G.1 |
| **VS Code** | `microsoft/vscode-mcp` | MIT | Source > OCR |
| **JetBrains** | Community JetBrains MCP | MIT | Source > OCR |
| **Non-disruption check** | Vitest grep over banned API calls | n/a | Static policy |

---

## 11. What H.2+ will build

Per the slash-plan's H.7 file layout, the implementation phases land:

- `packages/screen-context/src/capture/{win32,macos,linux-x11,linux-wayland}.ts` — thin wrappers over native APIs
- `packages/screen-context/src/extract/{uia,dom,vscode,pdf,ocr-fallback}.ts` — adapters per surface
- `packages/screen-context/src/classify/{language,error-message,chart-table-form}.ts` — heuristic classifiers
- `packages/screen-context/src/non-disruption.ts` — the rule set + checker
- `packages/screen-context/src/session.ts` — server-side context cache for follow-up turns
- `packages/screen-context/src/mesh/{request,transport}.ts` — phone → laptop request transport
- `packages/screen-context/test/policy.test.ts` — the banned-API static check

**~2000-3000 LOC** total for v1 MVP. **Native modules** for capture + AX on macOS will require a small build step per platform; the plan section H.7 already accounts for that.

---

## 12. Verification gate before H.2

Before any H.2 commit lands:

- [ ] Spot-check `PrintWindow(PW_RENDERFULLCONTENT)` on a fresh Win11 install with a regular non-DRM app. Capture must produce a non-black PNG.
- [ ] Confirm `uiautomation` Python lib still actively maintained (last commit < 90 days).
- [ ] Confirm `microsoft/vscode-mcp` install path on Windows (extension marketplace ID, install command).
- [ ] Confirm Wayland portal ScreenCast on Ubuntu 24.04 (the most likely Linux target user) returns a single frame from a non-interactive call.

Once those four pass, sign this report and proceed to H.2.

---

## 13. Open questions for Chethan

1. **Browser extension** — willing to ship a separate WebExtension users install once for richer DOM access? Or stick with CDP + UIA fallback in v1? (My take: defer to v2; CDP + UIA + OmniParser is enough for v1.)
2. **VS Code MCP** — require user to install it as a prerequisite? Or auto-suggest install when foreground is `code.exe`?
3. **Permission prompts** — auto-accept per-pair (Chethan's other devices, once granted, stay granted), or per-session ask every time? Plan default is per-pair + per-session-toggle; confirm.
4. **OCR opt-in** — same question as G.1: default on or off? (Recommendation: off; Settings toggle in v1.4.)
