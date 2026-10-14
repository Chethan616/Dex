---
name: unify-workspace-plan
description: "The `unify` branch plan — Codex-style shared browser + documents workspace per DEX task; P0–P3 built (extensions 2026-10-14); key research facts"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-30T12:24:03.826Z
---

The user wants DEX's agent view rebuilt as a Codex-style **workspace**:
- tabs for web pages, documents (.docx/.pdf/…) and a New-tab page;
- the user and the agent share the same live tabs;
- an agent cursor, the address bar, and Chrome extensions.

They want DEX's own layout kept (sidebar, dashboard, agent view, Logs window).

**The plan** is on branch `unify`: `docs/unify/PLAN.md` (phases P0–P5, §3.12 the chat), `docs/unify/codex-research.md` (evidence), `P0.md`, `P1-background-tabs.md`.

**State on 2026-09-30:** P0 and P1 are built, pushed and live-tested:
- tabs, the toolbar, shared control, and the agent cursor;
- `dex-tab`;
- the off-screen **stage** window that parks tabs not on screen, so agent screenshots work there. Before it, background tabs and tray-hidden tasks couldn't be screenshotted at all.

The user also asked (via a `UI/claude_see_this_*.png` note) for the Codex-style **chat in the pane**. It's built too:
- a pinned Chat tab, "Worked for", file cards with "Open in", and the minibar;
- the per-task bot avatar with its states.

**State on 2026-10-01:** P2 (document tabs: pdf/docx/sheet/md/text/media/glb/html, `dex-open`, live reload) is built, unit-tested and pushed (`9b2555bc`), but not yet live-tested by me (the owner was using DEX). The hand-over for a teammate's Claude is **`TO_BE_DONE.md`** at the repo root: state, rules, gotchas, code map, remaining work (verify P2 live → finish P2 → P1 leftovers → P3 extensions → P4 → P5), plus the plan and research verbatim. Keep it current rather than re-deriving.

**State on 2026-10-06:** P1 leftovers mostly done and pushed (main == unify == 1fcbfa7f):
- Ctrl+Shift+T;
- download and password guards;
- the "user used the page" notice to the agent;
- the ⋯ menu (find, zoom, print and more);
- tab persistence (schema v14).

Still open in §3.2: #4 address suggestions, #1 the `persist:dex-web` profile, and the per-site policy. The subagents/rich-cards UI branch is merged. Windows app/OS control is researched and planned in `docs/desktop-control/` (see [[desktop-control-plan]]).

Earlier: **P2** was next, document tabs. Main-process changes need a DEX restart. Start dev detached via PowerShell `Start-Process cmd /c "set AGB_CDP_PORT=9222&& npx electron-forge start > log"`. A Git Bash background job exits at once. Kill stale `bun` REPLs first: they inherit port 9222.

**State on 2026-10-14:** P3 extensions built, live-tested and pushed (`60331561`…`bce80fac`; write-up `docs/unify/P3.md`). Own CRX3 verifier (not electron-chrome-web-store), MIT shim in `preload/extensionShim.ts`, `main/extensions/` (DNR engine, webRequestHub — Electron's extension webRequest never fires, one listener per session), `persist:dex-web` profile with cookie copy + site permission prompts. Dark Reader + uBO Lite (100/100) work; owner installed VIT Vellore Library (needs their login to test proxy). Pages wider than the pane now zoom to fit (`workspace/fitWidth.ts`). Live-test recipe: dev build with AGB_CDP_PORT=9222, scratchpad `cdp.mjs`, task resumed with a tiny haiku prompt to get a browser, native dialogs answered with UIA focus+Enter.

**Key facts:**
- **Codex desktop (Windows, `OpenAI.Codex` MSIX)** runs on "OWL", a rebranded Chromium 154, not Electron.
  - Tabs are `<webview>`s in `persist:codex-browser-app`.
  - The agent goes through a `js` REPL MCP, then a named pipe, then `webContents.debugger`, with a CDP allowlist.
  - The cursor is a host-DOM overlay, and each click waits for a cursor-arrived handshake.
  - There's no takeover lock.
  - Extensions are feature-gated and were OFF on the user's install.
- **DEX today** (from BrowserPool and takeoverOverlay):
  - one `WebContentsView` per task, emulated 1440×900 plus zoom;
  - a takeover overlay blocks input, and "Stop and take over" cancels the task;
  - The open `--remote-debugging-port` security gap was fixed early in `f675a5f4` (see [[cdp-broker]]); P1 builds on that broker.
- **Pre-checks on Electron 41:**
  - an isolated-world closed-shadow cursor works and lets clicks pass;
  - `electron-chrome-web-store` (MIT) installs Dark Reader, which works;
  - uBO Lite needs a `chrome.tabs`/`windows` shim;
  - `electron-chrome-extensions` is GPL-3/paid, and DEX is MIT with a `LICENSES.md` audit.

**Why:** The user asked on 2026-09-29 for research plus a plan on a new `unify` branch.

**How to apply:** Build from PLAN.md in phase order, starting with P0 spikes. Don't copy OpenAI's code; describe it only.

Related: [[release-process]], [[no-metal-buttons]].

**Progress 2026-10-14 (session baacd51d):** P3 extensions done + an Extensions panel 1:1 with the Marketplace (`ExtensionsMarket.tsx`, store/options open in `main/extensions/extensionWindow.ts`); P2: Terminal + Review tool tabs (Ctrl+` / Ctrl+Shift+G), syntax colours (own tokenizer), windowed sheets (100k rows), Pages rail for PDF/DOCX; Settings is one section per screen. Left in P2: .pptx, .blend, Ctrl+P quick-open. The live log of what's next is the RESUME HERE block at the top of TO_BE_DONE.md.
