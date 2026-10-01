# Unify — one live workspace per task

**Branch:** `unify` · **Status:** P0, P1 (core), the chat (§3.12) and P2 built; P3–P5 to do — see [`TO_BE_DONE.md`](../../TO_BE_DONE.md) at the repo root · **Written:** 2026-09-29–30, status 2026-10-01

Each DEX task gets a single **workspace**: tabs holding web pages, documents and a New-tab page. You and DEX work in the same live tabs at the same time. DEX's clicks show as a small cursor. You can type any URL, use Chrome extensions, and open the .docx or .pdf the agent just wrote, right next to the page it came from.

The model is the side panel in OpenAI's Codex desktop app. DEX keeps its own layout: the sidebar of agents, the dashboard, the agent view with its header and the Logs window. Only the agent view's body changes, from "a browser DEX drives" to "a workspace you share".

What Codex actually does, with evidence, is in [codex-research.md](./codex-research.md).

---

## 1. What we want (from the request)

| # | Requirement | Today in DEX |
|---|---|---|
| R1 | **Unified**: web pages, documents and tools in one tabbed panel | One web view per task. Documents show only as file cards (PreviewDeck); a .docx or .pdf can't be opened in the app |
| R2 | **Browser controls**: tab strip, back/forward/reload, URL/search bar, Annotate, "…" menu, maximize, split | No tabs, no address bar, no navigation for the user |
| R3 | **Shared control**: you can click, scroll and type while DEX works | A takeover overlay blocks all input while the agent runs. "Stop and take over" **cancels the task** |
| R4 | **Agent cursor**: see where DEX clicks | Only a pulsing glow around the pane |
| R5 | **No lag**: feels like a real browser | The page is laid out at 1440–1920×900 then zoomed to fit, with an extra overlay view composited on top |
| R6 | **Extensions**: install from the Chrome Web Store and use them, agent included | None |
| R7 | **URLs**: browse anywhere, like a normal browser | Only where the agent navigates. Popups open as loose native windows |
| R8 | **Keep DEX's layout** | — |

## 2. Where DEX is today (verified in code)

- **`src/main/sessions/BrowserPool.ts`** keeps one `WebContentsView` per session.
  - It runs in the default session, sandboxed.
  - The UA is cleaned of the `Electron/` and app tokens, and `navigator.webdriver` is hidden.
  - Device emulation pins a 1440–1920×900 CSS viewport, and `setZoomFactor` scales it into the pane.
  - Frame rate is 60 when attached, 4 in the background and 1 when idle. `Page.setWebLifecycleState` freezes a view after 15 s idle.
  - `getTabs()` always returns exactly one tab.
  - There is no `setWindowOpenHandler`, so `window.open` / `target=_blank` produce stray Electron windows.
- **The agent drives that view over CDP.**
  - `browser-harness-js` (`src/main/hl/stock/browser-harness-js`) is a Bun server holding one CDP `Session`. It is attached to the app's own remote-debugging port, and `BU_TARGET_ID` is the task's WebContents.
  - Clicks are raw `Input.dispatchMouseEvent`. Everything goes through `session.*` calls, so we can wrap it.
- **`src/main/takeoverOverlay.ts`** is a transparent `WebContentsView` stacked above the page while automation runs.
  - Its own header says "input blocking is implicit": the topmost view gets every click.
  - Its button is "Stop and take over", which cancels the session.
- **`src/renderer/hub/AgentPane.tsx` + `PreviewDeck.tsx`**: the pane is the native view. When no page is up, PreviewDeck shows the plan, found files and screenshots, with files as "reveal in Explorer" cards.
- **Chat** is the Logs window (`src/main/logsPill.ts`, `renderer/logs`). **Terminal** exists as `hub/TerminalPane.tsx` (read-only xterm of the session's output).
- **Electron 41.2.1.** Everything below exists in its `electron.d.ts`:
  - `session.extensions` (`loadExtension`, `getAllExtensions`, events);
  - `webContents.on('input-event')`;
  - `setWindowOpenHandler({ createWindow })`;
  - `executeJavaScriptInIsolatedWorld`;
  - `WebContentsView.setBorderRadius`;
  - `navigationHistory`;
  - `found-in-page`.

## 2a. What Codex does, and what DEX takes from it

This is the short version. The evidence is in [codex-research.md](./codex-research.md).

| | Codex (verified in the shipped app) | DEX plan |
|---|---|---|
| Engine | **OWL**: a rebranded Chromium 154 (`ChatGPT.exe` is `chrome.exe`) with an Electron-compatible JS shell. It refuses to run on stock Electron | Stay on Electron 41 (Chromium 146). We rebuild the UI and plumbing that OWL gets from Chrome |
| Tabs | A `<webview>` per tab in the React window, all in one Chrome profile (`persist:codex-browser-app`). A window-opened or dragged tab is *adopted* (the same live WebContents, no reload) | A `WebContentsView` per tab, one `persist:dex-web` profile, re-parented instead of reloaded (§4.1, §4.3) |
| Agent ↔ page | The model writes JS in a `js` REPL tool against a browser API. That goes over a named pipe to the main process, which calls `webContents.debugger.sendCommand`. **The CDP allowlist:** no `Target.*` except `setAutoAttach`, and only `Input.dispatchMouseEvent/KeyEvent/insertText` | DEX's `browser-harness-js` is already a JS REPL over CDP. We add a **main-process CDP broker** with the same kind of allowlist, instead of the open remote-debugging port (§4.2) |
| Cursor | A React layer *above* the `<webview>`: an SVG arrow on spring physics along Bezier paths. **The click waits until the cursor has arrived** (`moveMouse`, animate, `cursor-arrived`, then `Input.dispatchMouseEvent`) | The same handshake. Because DEX's page is a native view, the cursor is drawn *inside* the page in an isolated world. The pre-check shows this works and never blocks clicks (§3.5) |
| You clicking mid-task | **Not blocked, and no takeover mode.** Your input and the agent's can race. Guards while the agent is active: downloads blocked unless allowed, navigation limited by a per-site policy ("Always ask / Auto approve / Always allow"), tab marked session-controlled | Not blocked either, and DEX goes a step further: the agent **politely waits** while you're using the page (§3.4). The download and site guards are copied |
| Agent tabs | Opened **hidden** by default ("keep browser work in the background"). At turn end, temporary tabs close unless marked *deliverable* or *handoff*. Your own tabs are only released | The same, with a visible **Keep** action on any agent tab (§3.2) |
| Documents | `.docx`: docx-preview with a *redlines* layer, zoom and a thumbnail rail. `.pdf` artifacts: pdf.js with text and annotation layers. Web PDFs: Chromium's viewer. Also pptx and xlsx panels | The same choices (§3.9) |
| Annotate / Request edits | A picker in the page (element, region or text) makes a typed comment. Comments are batched and serialized into the next prompt as URL, frame, selector, role, rect, selected text, screenshot, then "Comment:" | The same block format (§3.7) |
| New tab | **Tools:** side-panel actions with shortcuts, plus "Plugins and MCPs". **Suggested:** the chat's output files. **Recents:** recent work | The same, with Tools mapped to DEX's panels and Connections (§3.6) |
| Extensions | The real Chrome extension system (Web Store, `chrome://extensions`, import from Chrome) is in the code but **feature-gated**. **On this PC it's off** (`OwlExtensions` disabled; no user extensions installed) | Web Store install (MIT library) plus DEX's own `chrome.tabs`/`windows` shim (§4.4). Shipped, this would be *ahead* of the Codex install here |
| Chrome-only extras | Chrome's omnibox engine, password manager and autofill, native permission bubbles, `chrome://` settings pages, profile import | Out of reach on Electron. DEX builds history-based suggestions, its own permission prompts and an Extensions page. Passwords and import are skipped |

## 3. The experience

### 3.1 Layout (DEX's, not Codex's)

```
┌ sidebar ──────┐┌ agent view ───────────────────────────────────────────────────┐
│ + New agent   ││ 🟢 Find flights to Goa · Codex · Running 1m12s  [Logs][⏸][■] │  ← existing header
│               │├───────────────────────────────────────────────────────────────┤
│ 🐱 Find fli…  ││ [🌐 MakeMyTrip ×] [📄 Itinerary.docx ×] [✦ New tab ×] [+]   ⤢ ◫ │  ← tab strip
│ 🤖 Mushroom…  ││ ← → ⟳  🔒 makemytrip.com/flights?from=BLR&to=GOI  [✎][🧩][⋯] │  ← toolbar
│ 🌸 Reply to…  ││                                                               │
│               ││                  live page (native WebContentsView)           │
│               ││                         ➤ DEX                                 │  ← agent cursor
│               ││                                                               │
│               ││ ● DEX is clicking “Search” · you can use the page too  [Pause] │  ← activity strip
└───────────────┘└───────────────────────────────────────────────────────────────┘
```

- **⤢ Maximize** hides the sidebar, so the workspace takes the whole window.
- **◫ Split** shows two tabs side by side, e.g. the page and the document being written from it.
- **Logs** stays a separate window. A **side chat** (Ctrl+Alt+S) docks it on the right of the workspace instead, for people who want Codex's arrangement.

### 3.2 Tabs

| Kind | Opened by | Shows |
|---|---|---|
| **Web** | You (URL bar, Ctrl+T, links, popups) or DEX | A real Chromium page, rendered at the pane's real size |
| **Document** | Clicking a file DEX made (Recents, a Logs file row, a phone request), or DEX opening it | .pdf, .docx, .xlsx/.csv, .md/.txt/code, images, video, .glb/.gltf, .blend (its render + 3D) |
| **New tab** | Ctrl+T, the + button, or a task that has no page yet (replaces PreviewDeck) | Search/URL box, **Tools**, **Suggested**, **Recents** (see §3.6) |

- Tabs belong to the task.
- They're restored when you reopen the task. Web tabs come back unloaded and load on first view.
- **Tabs DEX opens for itself start hidden**, as Codex's do: the work happens in the background and the tab strip shows them dimmed with the task's bot.
  - They become visible when you click them, or when DEX shows one ("look at this").
  - When the turn ends, DEX's temporary tabs close unless DEX marked them as the result, or you pressed **Keep**.
  - Your own tabs are never closed by DEX.

### 3.3 Browser toolbar

- **Back, forward, reload/stop**, driven by `navigationHistory` and `did-start/stop-loading`.
- **Address bar:**
  - shows the host, and the full URL on focus;
  - Enter navigates, and non-URLs go to the default search engine;
  - suggestions come from history, site memory (`site-memory/`) and connected services.
- **Page indicators:** 🔒 connection info, a favicon and title in the tab, and a loading bar.
- **✎ Annotate:** §3.7.
- **🧩 Extensions:** pinned extension buttons plus the menu, §3.8.
- **⋯ menu:** find in page (Ctrl+F), zoom, print, "Open in your browser", copy link, developer tools, extensions, clear site data.

### 3.4 Shared control: you and DEX in the same page

- **Nothing blocks input.** The takeover overlay view goes away.
  - A thin animated frame is drawn in the renderer *around* the native view, where the renderer can still paint.
  - It says DEX is working, without covering the page.
- **DEX is polite.** Main watches `webContents.on('input-event')` / `before-input-event` for real user input.
  - While you're active (and 1.5 s after), the harness holds DEX's next `Input.*` command.
  - It waits up to a few seconds, then continues where you left the page.
  - A long hold shows in the activity strip: "Waiting — you're using the page".
- **Pause** replaces "Stop and take over". It uses the session pause that already exists, and **Resume** carries on in the same tabs.
- **Password fields.** When the focus is in a `type=password` field, the harness refuses to read its value or screenshot it. This extends the approval policy.
- **Guards while DEX is driving,** as Codex has:
  - downloads need an explicit allow;
  - navigation follows a per-site policy, "Always ask / Auto approve / Always allow", kept per task like `~/.codex/browser/sessions/*.toml`;
  - the tab shows as agent-controlled.
- Codex itself has **no** lock and no wait: its user and agent inputs simply race. The polite wait is DEX going one better, and P0 checks it doesn't make DEX feel sluggish.

### 3.5 The agent cursor

A small arrow with the **task's own bot** badge (the same per-task avatar as the sidebar). It glides to each target, dips on click and ripples.

- **Drawn inside the page, never in front of it.**
  - A closed shadow root is added through an isolated world (`Page.createIsolatedWorld` / `executeJavaScriptInIsolatedWorld`), so page scripts and CSP don't interfere.
  - It's a single `position:fixed; pointer-events:none; z-index:2147483647` element, so it never takes a click from you.
  - A native view can't be click-through per pixel, which is why an overlay view can't do this.
- **The harness moves it, and the click waits for it**, which is Codex's trick.
  - Before a press, the broker asks the page to animate the cursor to (x, y). It follows a spring along a slight curve, leaning into the motion, with a squash on short hops.
  - The page answers **"arrived"**, and only then is `Input.dispatchMouseEvent` pressed and released. The motion therefore never trails behind the effect.
  - Animation is skipped (the arrow jumps straight there) when the tab is hidden or the window unfocused, so hidden agent tabs stay fast.
  - Typing shows a caret pulse at the focused element.
  - Nothing changes for the model or the engines: the same CDP calls get the cursor for free.
  - It's our own MIT code, about 200 lines of spring maths. Nothing is copied from Codex.
- **Hidden from the agent's own screenshots.** The `Page.captureScreenshot` wrapper sets `visibility:hidden` for the capture.
- Survives navigations: re-injected on `Page.frameNavigated`.

### 3.6 New-tab page (renderer, not a web view)

- **Tools:**
  - **Files** (Ctrl+P): quick open over the task's files and outputs.
  - **Terminal** (Ctrl+`): TerminalPane.
  - **Logs / Side chat** (Ctrl+Alt+S).
  - **Review** (Ctrl+Shift+G): files the task created or changed, with a diff for text.
  - **Connections:** the task's MCP servers and accounts, like Codex's "Plugins and MCPs".
- **Suggested:** sites DEX has memory for, sites this task visited, and connected services (Gmail, Drive, GitHub).
- **Recents:** files this task produced, newest first, with type icon and time. One click opens them as document tabs.

### 3.7 Annotate and Request edits

- **Annotate** (web or document tab):
  1. It freezes a capture of the tab (`webContents.capturePage()`, or the document canvas).
  2. You draw on it: box, arrow, pen, text.
  3. **Send to DEX** adds it as a follow-up to the task, with the image attached and your note. This uses the existing follow-up and attachments path.
- **How a note reaches DEX** (Codex's format, which the models already handle well):
  - Each note is one block in the follow-up: `Page URL`, `Frame`, `Target` (text), `Target role`, `Target selector`, `Area rectangle`, `Selected text` or `Nearby text`, and for documents `Artifact path` / `PDF page`.
  - Then the screenshot reference, then `Comment:` and your words.
  - Several notes can be batched and sent together.
  - The page-side picker (element, region or text) is an isolated-world overlay, the same technique as the cursor.
- **Request edits** (document tab): select text and choose "Ask DEX to change this".
  - The composer opens prefilled with a quote, the file and the location (page, heading, paragraph index).
  - DEX edits the file (python-docx etc.).
  - The tab **reloads live**: a file watcher on the document, plus an "Updated by DEX" toast.

### 3.8 Extensions

- **Install:** from the Chrome Web Store page in a tab ("Add to Chrome" works), or load unpacked from the ⋯ menu.
- **Use:**
  - content scripts just work;
  - toolbar buttons and popups sit in the 🧩 area;
  - the agent can open an extension's popup as a tab (`chrome-extension://<id>/…`) and drive it like any page.
- **Manage:** ⋯ → Extensions lists each one with icon, name, version, on/off, pin, remove and site access. They're off in the app's own windows; they only live in the web profile.

### 3.9 Documents

| Type | Viewer | Licence |
|---|---|---|
| .pdf (files DEX made or opened) | `pdfjs-dist`: canvas pages plus a text layer, so notes and Request edits can anchor to text | Apache-2.0 |
| .pdf on the web | Chromium's built-in PDF viewer, inside the web tab | Chromium |
| .docx | `docx-preview` (the library Codex uses): real pages on a grey desk, a page-thumbnail rail, outline from headings, zoom, download, and a **redlines** toggle (`renderChanges`) to show DEX's tracked changes. `mammoth` extracts clean text for the agent | Apache-2.0 / BSD-2 |
| .xlsx / .csv | SheetJS CE + a virtualised grid, sheet tabs | Apache-2.0 |
| .md / .txt / code | DEX's Markdown renderer; code with syntax colours | ours |
| images / video / audio | native elements | — |
| .glb / .gltf | `<model-viewer>`, the same as the phone | Apache-2.0 |
| .blend | `scene_preview.py`'s render + scene.glb, the same as the phone | ours |
| .pptx | "Open in PowerPoint" for now. Later, a PDF via LibreOffice when installed | — |

Every document tab has **Outline ▾ · Request edits · Zoom · Download · Open with…**. Documents open from the renderer (no native view), so menus and popovers sit on top of them normally.

### 3.10 Speed

- **Render at the pane's real size.** Drop the fixed 1440×900 emulation plus zoom-down: it costs raster time and blurs text.
  - Keep a "desktop layout" fallback that emulates *width only* when the pane is narrower than ~1000 px.
- **One compositor layer per visible tab.** No overlay view on top.
- **Resizes coalesced** to one `setBounds` per animation frame. Emulation isn't re-applied on every attach.
- **Visible tab:** 60 fps, `backgroundThrottling:false`. **Hidden tabs:** throttled, then frozen, then discarded, reusing BrowserPool's machinery per tab.
- **A warm view** is pre-created for the next new tab or task.
- **Measured, not assumed.** Phase 0 records input-to-paint latency and scroll fps against desktop Chrome on the same pages. The budget: p95 within 5 ms of Chrome, 60 fps scrolling.

### 3.11 Keyboard

- **Tabs:** Ctrl+T new · Ctrl+W close · Ctrl+Tab / Ctrl+Shift+Tab switch · Ctrl+Shift+T reopen.
- **Page:** Ctrl+L address bar · Alt+←/→ back/forward · Ctrl+R reload · Ctrl+F find · Ctrl +/−/0 zoom.
- **Workspace:** Ctrl+P files · Ctrl+` terminal · Ctrl+Alt+S side chat · Ctrl+Shift+G review.
- **Integration:**
  - they're registered with `setIgnoreMenuShortcuts` and forwarded from `before-input-event` when the page has focus;
  - DEX's existing Ctrl+C interrupt keeps working.

### 3.12 The conversation (added 2026-09-30, from `UI/claude_see_this_…png`)

The chat moves out of the floating Logs window and into the pane, styled like
Codex's (the two screenshots in `UI/`), inside DEX's own layout:

- **A pinned Chat tab** first in the tab strip. Picking it parks the page on
  the stage (the agent keeps working there, §4.2) and draws the conversation
  in the rect; picking a web tab brings the page back. By default a finished
  or page-less task opens on Chat and a running browser task on its page,
  with your own choice winning until the next run.
- **Turns, not a log:**
  - your messages are right-aligned blue bubbles;
  - DEX's work collapses into **"Worked for 3m 45s ›"** over a hairline
    (open while it's working, closed when done). Inside are the tool
    cards, interim notes and screenshots;
  - the reply is full-width prose. GitHub links carry the GitHub mark and
    file links a file-type icon;
  - files it made follow as one **card list**: a type icon, the name, the kind
    ("Word", "Document · PDF") and **Open in ▾**, which offers default app,
    Show in File Explorer, an editor, and Download a copy;
  - a footer holds copy and the time.
- **The minibar**, a floating card at the top right of the chat, like Codex's:
  - the engine and model, and the status with its elapsed time;
  - **Progress** from `dex-state`;
  - **Outputs**, the files and documents it made;
  - **Sources**, the sites and searches it used, with **View all**.

  It hides behind a toggle on narrow panes.
- **The composer** is Codex's rounded box: +, the approval mode, the engine
  chip, and a round send button. It keeps DEX's slash commands, @-mentions
  and attachments (it's the old `FollowUpInput`).
- **Files outside `outputs/`** (Downloads, Documents) open through a new
  `sessions:open-file`. It opens only paths this task recorded, and it only
  ever reveals an executable, never runs it.
- **Events carry `at`**, stamped in `SessionManager.appendOutput`, so every
  turn knows its duration. Older sessions just show "Worked".
- The Logs button stays, for the raw terminal view.

## 4. Architecture

### 4.1 Main process: `src/main/workspace/`

- **`WorkspaceManager.ts`**: per session, `{ tabs: WorkspaceTab[], activeTabId, split? }`.
  - `WorkspaceTab = { id, kind: 'web'|'doc'|'newtab', title, url?, faviconUrl?, filePath?, loading, canGoBack, canGoForward, openedBy: 'user'|'agent', lastActiveAt }`.
  - Persisted in `sessions.db` (a new `workspace_tabs` table). Broadcasts `workspace:changed`.
- **`TabPool.ts`**: BrowserPool, generalised from one view per session to many views per session.
  - It keeps the UA cleaning, the webdriver hiding, the frame-rate policy and the freeze logic, with an LRU discard (per-task cap about 6 live tabs, global about 16).
  - `setWindowOpenHandler` returns `createWindow`, which hands back a new tab's WebContents. `window.opener` survives, so OAuth popups work as tabs.
- **Web profile:** a dedicated `persist:dex-web` partition shared by all tasks.
  - One browser profile: logins, history, extensions.
  - Existing cookies from the default session are copied over once on upgrade.
  - The app's own windows keep the default session, so extensions never touch DEX's UI.
- **`cursor.ts`**: the injected cursor script, and the isolated-world setup per frame.
- **`extensions.ts`**: see §4.4.
- **`documents.ts`**:
  - resolves a path to a viewer kind;
  - watches files and debounces the reload;
  - serves document bytes to the renderer through a `dex-doc://` protocol (`protocol.handle`) scoped to the task's allowed paths, with no raw `file://` from the renderer.
- **IPC (`workspace:*`):** `list`, `open(url|path)`, `activate`, `close`, `move`, `navigate`, `back`, `forward`, `reload`, `stop`, `setBounds`, `find`, `zoom`, `capture`, `devtools`, `extensions.*`.
  - They replace `sessions:view-attach/detach/resize`; one tab is attached at a time, two in split.

### 4.2 The agent's side

- **`BU_TARGET_ID`** follows the **active web tab**, and `listPageTargets()` sees all the task's tabs. Nothing changes for engines (Claude Code, Codex, BrowserCode).
- **New helpers** in the harness SDK and `dex-tools`, going through DEX's control server (`DEX_CONTROL_FILE`):
  - `dex-tab list | new <url> [--show] [--keep] | show <id> | keep <id> | close <id>` ✅ (switching is the harness's own `session.use(targetId)`);
  - `dex-open <file>`, which opens a document tab so the user sees what was written.
  - Tabs the agent opens are marked `openedBy:'agent'`.
- **A CDP broker in the main process replaces the open remote-debugging port.** ✅ *Shipped early on `feat/low-latency` (`f675a5f4`, `main/cdpBroker.ts` + `main/cdpLease.ts`): the port is closed by default, each task gets a token link to its own tab, and `Browser.*`/foreign targets are refused. P1 builds the cursor handshake and the guards on top of it.*
  - Today the harness attaches to `BU_CDP_PORT`, the app's own `--remote-debugging-port`. That port serves **every** WebContents, DEX's hub and approval cards included, to any local process.
  - Codex instead brokers CDP in the main process with `webContents.debugger` and an allowlist. DEX does the same:
    - the harness talks to the broker over a local pipe with a per-session token (the Bun server stays, so no model-facing change);
    - the broker attaches only to the task's own tabs;
    - it refuses `Target.*` except `setAutoAttach`, and any `Input.*` except `dispatchMouseEvent`, `dispatchKeyEvent` and `insertText`;
    - once nothing depends on the port, it is turned off (or bound to a random port with a token).
- **The broker is where the Input and screenshot wrappers live:**
  - the cursor move-and-arrive handshake before a press (§3.5);
  - a politeness gate (you're active, so wait);
  - the cursor hidden during `captureScreenshot`;
  - a password-field guard;
  - download and site-policy guards while DEX drives.
- **Turn end** (`turnEnded`): detach the debugger, close DEX's temporary tabs unless they're kept or the result, and release your tabs.
- **Tabs off your screen live on the stage** ✅ (`workspace/stage.ts`, [P1-background-tabs.md](P1-background-tabs.md)): an off-screen `BaseWindow` where background tabs, other tasks' tabs and the tray-hidden task keep a surface. A view removed from every window can't be screenshotted at all (it hung, before unify too); on the stage it sleeps hidden and is shown there while the agent uses it.
- **Skill docs** (`SKILL.md`, `AGENTS.md`):
  - tell the agent about tabs, documents and "the user may be using the page";
  - prefer `dex-open` over describing a file.

### 4.3 Renderer: `src/renderer/hub/workspace/`

- **Components:**
  - `Workspace.tsx` replaces the pane body in `AgentPane.tsx`;
  - `TabStrip.tsx`, `Toolbar.tsx` (address bar + actions), `NewTabPage.tsx`;
  - `DocViewer/` (`Pdf`, `Docx`, `Sheet`, `Markdown`, `Media`, `Model3d`, `Blend`);
  - `Annotate.tsx`, `ActivityStrip.tsx`.
- **Native-view bounds:** the renderer measures the content rect (ResizeObserver, rAF-coalesced) and sends `workspace:setBounds`.
- **Popovers over the page:**
  - the address-bar dropdown and ⋯ menu are drawn in the toolbar area where possible;
  - otherwise the view is briefly detached (the pattern PreviewDeck's confirmation cards already use);
  - long-term, render menus in a small frameless child view above the page.
- **PreviewDeck** is folded into the New-tab page (plan, progress, files) and Recents.
- **`WebContentsView` or `<webview>`?** Codex uses `<webview>`: the page is part of the React DOM, so the cursor, menus and annotation chrome simply sit on top of it.
  - That is the exact pain DEX has with native views: PreviewDeck's detach dance, and the overlay view that blocks input.
  - But Electron discourages `<webview>`, and Codex runs it on its own patched Chromium (`OwlWebViewEnhancements`), not stock Electron.
  - **Decision:** stay on `WebContentsView` (what BrowserPool uses, and what the research recommends), and solve "draw over the page" with isolated-world overlays (proven in §4.5) plus a small popover view.
  - P0 includes a one-day `<webview>` trial (focus, resize, drag-drop, input latency) so that choice is made on evidence.

### 4.4 Extensions in Electron 41

1. **Load:** `session.fromPartition('persist:dex-web').extensions.loadExtension(dir, { allowFileAccess })`. This is native MV3, with a *subset* of `chrome.*` (runtime, storage, scripting, i18n, webRequest, tabs partially).
2. **Install from the Web Store:** `electron-chrome-web-store` (**MIT**, v0.13).
   - It makes "Add to Chrome" on chromewebstore.google.com download, verify and unpack the CRX, and it handles updates.
3. **Toolbar buttons, popups, `chrome.tabs`/`windows`/`contextMenus`:**
   - `electron-chrome-extensions` does all of this, but it is **GPL-3.0** (or a paid "Patron" licence).
   - DEX is MIT and `LICENSES.md` audits every dependency, so we **don't** bundle it as-is.
   - Choose one:
     - **(a)** Sponsor for the proprietary-use licence.
     - **(b) Recommended:** write a small MIT shim that maps `chrome.tabs.query/get/create/update/remove` (+ `onUpdated/onActivated/onRemoved`), `chrome.windows.getCurrent/getAll/get` (+ `onRemoved`), `chrome.action` (icon, badge, popup) and `contextMenus` onto `WorkspaceManager`.
   - The shim is injected into extension service workers and pages with `session.registerPreloadScript({ type: 'service-worker' | 'frame' })`, which RPCs to main. Verify against the Electron 41 docs in P0.
   - The popup is a small frameless `WebContentsView` anchored under its 🧩 button.
   - uBlock Origin Lite's crash (`reading 'onRemoved'`) is the first acceptance test.
4. **Expect gaps.** `chrome.identity`, `sidePanel`, `offscreen` and native messaging are missing or partial. The first targets are uBlock Origin Lite, Dark Reader, Bitwarden, Grammarly, Google Translate and React DevTools. Each gets a status line in §6.

### 4.5 Pre-checks already run (2026-09-29)

I ran a standalone script with DEX's own Electron 41.2.1: `desktop/app/node_modules/electron`, its own userData, no DEX code involved.

| Check | Result |
|---|---|
| **Cursor in an isolated world** (closed shadow root, `adoptedStyleSheets`, `pointer-events:none`) on github.com, google.com and vtop.vit.ac.in | ✅ Injected on all three with **no CSP errors**. `elementFromPoint` under the cursor returns the page, not the cursor, so your clicks pass straight through |
| **Native `session.extensions.loadExtension`**, MV3 content script | ✅ Loaded, and the content script ran on example.com |
| **Chrome Web Store install** via `electron-chrome-web-store` (MIT): Dark Reader | ✅ Installed in about 1.1 s and **active on pages**. Warnings: the `contextMenus` and `fontSettings` permissions are unknown to Electron |
| Same, **uBlock Origin Lite** | ⚠️ Installed in about 8 s, but its service worker **failed to register**: `Cannot read properties of undefined (reading 'onRemoved')`. It needs `chrome.tabs`/`chrome.windows` events Electron doesn't provide. This confirms §4.4's shim is required, not optional |
| Screenshots of an off-screen window with `capturePage()` | ❌ "Current display surface not available". This is expected for a hidden window. The real app captures attached views; the harness uses CDP `Page.captureScreenshot` anyway |

## 5. Phases

Each phase ships on its own, behind a Settings toggle ("New workspace (beta)") until P2.

| Phase | Scope | Done when |
|---|---|---|
| **P0 — Measure & spike** (2–3 days) | Latency/fps baselines, with emulation and overlay on and off vs Chrome. Spikes: `createWindow` popups as tabs; cookie migration to `persist:dex-web`; a one-day `<webview>` trial (§4.3); the `registerPreloadScript` service-worker shim fixing uBlock Origin Lite. (Cursor injection, native `loadExtension` and the Web Store install are already done, §4.5) | A numbers table and go/no-go per spike in `docs/unify/P0.md` |
| **P1 — Browser & shared control** (1.5–2 wk) | WorkspaceManager + TabPool, tab strip, toolbar, address bar with suggestions, popups → tabs, native-size rendering, no blocking overlay, the broker's cursor and input wrappers (the broker itself shipped in `f675a5f4`), polite agent, download and site guards, Pause/Resume, the agent cursor with its arrival handshake, **hidden agent tabs and turn-end cleanup**, `dex-tab`, persistence, shortcuts | You scroll and click while a task runs, and it keeps going; DEX's clicks show the cursor, arriving before each click; the harness can no longer reach the hub's own page; Ctrl+T/L/W work; the latency budget is met |
| **P2 — Documents & New tab** (1 wk) | Document tabs for every type in §3.9, live reload, the New-tab page (Tools/Suggested/Recents), `dex-open`, a Logs file row opening a tab | A 20-page .docx opens in < 500 ms; the agent rewriting a file refreshes its tab |
| **P3 — Extensions** (1–1.5 wk) | The Web Store install, the manager UI, the MIT shim (tabs/windows/action/contextMenus), agent access to popups | The six targets in §4.4 install and work, or are listed as unsupported with the reason |
| **P4 — Annotate, Request edits, side chat** (1 wk) | §3.7 with Codex's note format, the docx redlines toggle, **@-mention a tab** in the composer (it becomes the agent's target), and the docked Logs | An annotated screenshot and a doc edit request round-trip into the task |
| **P5 — Polish** | Split and maximize, drag to reorder tabs, reopen closed tab, tab tooltips and memory badges, an interactive terminal (`node-pty`), light theme, accessibility, phone: the task's tabs listed on Android ("Open on PC") | — |

## 6. Risks

- **Google sign-in inside embedded browsers.** Google may refuse ("This browser or app may not be secure"). DEX already strips the Electron UA tokens. Keep Google work on the OAuth connection (Gmail/Drive APIs), and offer "Open in your browser" for sign-in pages.
- **Anti-bot fingerprints differ from real Chrome** (Codex runs a full Chrome build: see the research). Keep the current hardening, and add per-site "open in real Chrome" as an escape hatch.
- **Extension coverage** will be partial compared with Codex's real Chrome. Publish a compatibility list rather than promise "all extensions".
  - Worth knowing: on this PC Codex's own extension support is **switched off** by a server flag (`OwlExtensions` disabled, no extensions installed). What looked like "Codex installs extensions" is either a later rollout or the separate ChatGPT extension for your external Chrome.
- ~~**The open debug port.**~~ Fixed in `f675a5f4`. DEX used to set `--remote-debugging-port` in every build, so any local process could attach to its own windows and click approval cards. It is now closed unless opted into with `--remote-debugging-port` or `AGB_CDP_PORT` (Settings warns while it's open).
- **Licence:** electron-chrome-extensions is GPL-3.0 (§4.4).
- **Memory:** many tabs × tasks. Per-task and global caps, freeze and discard, and a memory badge on heavy tabs (the resource monitor already exists).
- **Races between you and DEX:** the politeness gate plus a visible cursor and the activity strip. The agent re-reads the page after any user input (the harness emits a `user-interacted` event to the engine's next observation).
- **Privacy:** a shared profile means the agent can use your logged-in sites. That's the point, but it stays behind the approval modes. Password fields are never read.

## 7. Considered and rejected

- **Driving your real Chrome or Edge in its own window.**
  - It isn't in DEX. Chrome 136+ refuses remote debugging on the default profile.
  - Re-parenting its window into DEX (Win32 `SetParent`) breaks DPI, focus and input.
- **CEF, or a Chromium fork like Codex's OWL:** months of work and a 300 MB runtime. Electron's `WebContentsView` is the same Chromium engine. What we lack is browser UI, extension plumbing and shared input, and those are what this plan builds.
- **Streaming screenshots of a headless browser:** that *is* the laggy option.

## 8. Tests

- **Unit:**
  - WorkspaceManager (open, close, activate, persistence, LRU discard);
  - URL vs search parsing;
  - document kind resolution;
  - the politeness gate timing;
  - the extension shim's API mapping.
- **Harness:** the cursor wrapper emits cursor moves before `Input.*` and hides the cursor during capture; the password guard.
- **E2E through CDP** (the setup DEX already uses for UI checks):
  - start a task;
  - scroll and click as the user while it runs;
  - assert the task continued and the cursor moved;
  - open a .docx tab;
  - install an unpacked extension and see its content script act.
- **Performance:** the P0 harness re-run as a regression check.

## 9. Files

- **New:** `src/main/workspace/{WorkspaceManager,TabPool,cursor,documents,extensions,ipc}.ts`, `src/renderer/hub/workspace/**`, `hl/stock/dex-tools/{dex-tab,dex-open}`.
- **Changed:**
  - `sessions/BrowserPool.ts` (→ TabPool);
  - `takeoverOverlay.ts` (removed; the frame and Pause move to the renderer);
  - `index.ts` (IPC), `preload/shell.ts`;
  - `hl/engines/{runEngine,browserHarnessEnv}.ts` (active-tab target);
  - `hl/stock/browser-harness-js/sdk/session.ts` (wrappers) and its `SKILL.md`;
  - `hub/AgentPane.tsx`, `hub/PreviewDeck.tsx`, `hub/hub.css`, `LICENSES.md`.
