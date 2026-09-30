# Research: how the Codex desktop app (Windows) builds its in-app browser

Input for [PLAN.md](./PLAN.md), the unify plan.

Research date: 29–30 Sep 2026. Target: MSIX `OpenAI.Codex_26.924.2738.0_x64__2p2nqsd0c76g0` (app version 26.924.22138, build 11645).
Method: read-only inspection of the install directory, `app.asar` (listed and selectively extracted), the bundled `cua_node` runtime, the user-data *directory names* (no cookie, login or token files opened), the running process tree, public docs, and one question to the Codex CLI.

Legend: **[V]** = verified in shipped code or files on this machine. **[I]** = inferred from that evidence. **[W]** = from web sources. **[C]** = the Codex CLI's own opinion (unverified).

Scratch extracts stayed on the research machine and are not in the repo. This is a public repo, so OpenAI's shipped code is described in prose rather than quoted.

---

## 1. Summary

1. **The runtime is OWL, a rebranded Chromium 154 with an Electron-compatible JS layer, not stock Electron.** [V]
   - `ChatGPT.exe` reports `OriginalFilename=chrome.exe` and version `154.0.8037.57`.
   - The user-data folder is a complete Chrome user-data-dir: Safe Browsing, WidevineCdm, component and extension CRX caches, `Local State`, and per-profile `Extensions`, `Login Data` and `Web Data` stores.
   - The Electron-style main bundle refuses to start without OWL: `"Codex requires the Owl app shell; stock Electron is no longer supported."`
   - OWL adds many non-Electron APIs, for example `session.autocomplete`, extension toolbar and action APIs, `webContents.setAgentActive`, `_createWebViewAdoptionLease`, `setPageCapturePaintLeaseEnabled`, `permissionHandling:'browser'` and `app.showTaskManager`.

2. **Every browser tab is a `<webview>` guest inside the React renderer.** [V]
   - It is not a `WebContentsView`, a separate window or a screenshot stream.
   - All tabs share one Chrome profile, `persist:codex-browser-app` (on disk: `...\web\Codex\codex-browser-app\`), and one preload (`browser-page-preload.js`).
   - The tab strip, address bar, New Tab page, cursor overlay and annotation chrome are React DOM drawn around and on top of the `<webview>`.
   - The address bar's suggestions come from Chrome's own omnibox engine via the OWL API `session.autocomplete.createController()`.

3. **The agent drives the exact same `WebContents` the user sees, over CDP (`webContents.debugger.attach('1.3')`).** [V]
   - The chain is: model → `cua_repl`/`node_repl` MCP `js` tool → `@oai/browser-desktop` service (Node) → Windows named pipe `\\.\pipe\codex-browser-use…` (JSON-RPC 2.0, length-prefixed frames) → main-process "IAB API" class → `webContents.debugger.sendCommand(...)`.
   - CDP is allow-listed: no `Target.*` except `setAutoAttach`, and only `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent` and `Input.insertText` from `Input.*`.

4. **The agent cursor is a DOM layer in the host renderer over the `<webview>` (`pointer-events:none`, z-20), not inside the page.** [V]
   - It holds an SVG arrow animated with spring physics along Bezier or "scoot" paths via `requestAnimationFrame`, with an accent-blue glow.
   - A click is **gated on the animation**. `moveMouse` → renderer animates → the renderer posts `browser-use-cursor-arrived` → only then is `Input.dispatchMouseEvent` pressed/released sent.
   - That handshake, plus real GPU compositing of a real renderer, is why it looks natural and "zero-lag".

5. **User clicks during agent control are not blocked, and no take-over mode was found.** [V/I]
   - A pointer-down only closes popovers in the browser chrome.
   - Agent and user share the page, so input can race. [I]
   - There are safety rails:
     - `setAgentActive(true)` on the tab's `WebContents`;
     - navigation restrictions and download blocking while the agent controls the tab;
     - a model-side confirmations policy;
     - turn-end cleanup, where temporary agent tabs close unless marked `markDeliverable()` or `markHandoff()`.

6. **Chrome extensions are real Chromium extensions, but feature-gated.**
   - [V] The extension APIs, toolbar, puzzle menu, "Visit Web Store" (opens `https://chromewebstore.google.com/` in the in-app browser), embedded `chrome://extensions/` and "import extensions from Chrome" are all in the code.
   - [V] On this PC, `owl-feature-bootstrap-cache.json` (dated 7 Aug 2026) lists `OwlExtensions` as **disabled**.
   - [V] The in-app browser profile has **no user-installed extensions**; only the component "Chromium PDF Viewer" is present.
   - [W] Public docs don't mention extensions in the built-in browser.

7. **Documents are custom React viewers in "artifact" tabs.**
   - [V] `.docx` uses `docx-preview` 0.3.7 (Apache-2.0) and JSZip, with a redlines layer, zoom, a thumbnail rail and annotations. `.pdf` uses `pdfjs-dist` 5.4.296 (Apache-2.0) with text and annotation layers. There are also pptx and xlsx panels plus a .NET OpenXML WASM worker ("walnut").
   - [V] "Request edits" and "Annotate" create typed comment objects that are serialized into the next prompt (page URL, frame, target selector/role/path, rect, selected text, screenshot, then "Comment:").
   - [V] `tectonic.exe` compiles LaTeX to PDF, and `artifact-template-picker` is an MCP server for choosing Office or Google templates.

8. **For DEX (Electron 41):**
   - About 80% of the *experience* is replicable: CDP-driven same-tab control, the cursor handshake, annotations, docx/pdf viewers, a new-tab page and hidden agent tabs.
   - What cannot be matched without shipping a Chromium fork: Chrome's WebUI pages, the omnibox engine, the password manager and autofill, native permission bubbles, the full extension platform (`chrome.tabs`/`chrome.windows`/action popups, native Web Store install), and OWL niceties (webview adoption, paint leases, agent-active state).
   - See §4 for the concrete plan.

---

## 2. Evidence per question

### Q1. Runtime architecture: what OWL is here and how the Electron app runs on it

**Install-directory facts [V]**

| Item | Evidence |
|---|---|
| `ChatGPT.exe` (4.7 MB) | Version resource: `Product='Codex' ProductVer=154.0.8037.57 Orig='chrome.exe'`. This is a rebranded `chrome.exe`. |
| `chrome.dll` (327 MB) | `Orig='chrome.dll'`, version 154.0.8037.57. It is the whole Chromium. |
| `Codex.exe` (1.1 MB) | No version info. PDB path `...\electron\native\windows-updater-addon\build\Release\windows_update_trampoline.pdb`, so it is an update trampoline, not the app. |
| `owl-electron-app.json` | `"runtimeName": "owl"`, `packagedFrom ...\codex-apps\electron\out\Codex-win32-x64`, `runtimeArchiveSha`. |
| `owl-app.ini` | `[Owl] UserDataDirectoryName=Codex, AppVersion=26.924.22138` |
| `owl-shell-runtime.json` | `{schemaVersion:1, platform:win32, arch:x64, msixPackageDependencies:[]}` |
| `resources\app.asar` `package.json` | `name: openai-codex-electron`, `main: .vite/build/early-bootstrap.js`, `devDependencies.electron: 42.3.0` (used for types only), scripts `ensure-owl-electron-types.mjs`, `owl-shell.mjs run`, `forge:make:owl-shell`. |
| `AppxManifest.xml` | Entry point `app/ChatGPT.exe` (plus `codex-command-runner.exe`). Protocol `codex:`. File types `.docx .pptx .xlsx .xls .xlsm .csv .tsv .skill`. Capabilities include `graphicsCaptureProgrammatic` and `graphicsCaptureWithoutBorder`. No http/https handler. |

**OWL gate and switches [V]**

- `bootstrap-*.js` throws when it runs on stock Electron (it checks for OWL's `app.showTaskManager`): "Codex requires the Owl app shell; stock Electron is no longer supported."
- `early-bootstrap.js` appends two switches: `owl-scoped-user-agent-prefix=CodexBrowser`, and `owl-scoped-user-agent-additional-hosts` for openai.com and chatgpt.com.

**OWL-only APIs seen in the main bundle (`main-DAwJoFgo.js`, 4.1 MB) [V]**

- `app`:
  - `showTaskManager()` (Chrome's task manager);
  - `isRuntimeFeatureEnabled(name)` and `setRuntimeFeatures({OwlOpenAIGoLinks, OwlRemoteSearchSuggestions})`;
  - `setLegacyChromePolicyFallbackEnabled(true)` (Chrome enterprise policy);
  - `process._linkedBinding('electron_browser_owl_update_policies')` (relaunch policy).
- `session`:
  - `fromPartition(name, {permissionHandling:'browser'})` (Chrome's native permission UI);
  - `setPermissionPromptHandler`;
  - `session.autocomplete.createController(webContents)` (Chrome `AutocompleteController`: `result.matches`, `accept(token, disposition)`, `deleteMatch`, `recordNavigation`, `'result-changed'`);
  - `session.faviconService`;
  - `session.extensions.getExtensionToolbarState()`, `.setExtensionPinned()` and `.getExtensionCounts()`;
  - events `extension-loaded`, `extension-ready` and `pinned-extensions-changed`.
- `webContents`:
  - extension actions: `getExtensionActions()`, `triggerExtensionAction(id, {anchorRect})`, `showExtensionActionContextMenu`, `begin/execute/closeExtensionActionContextMenu`;
  - `_createWebViewAdoptionLease(owner)`, which moves an existing `WebContents` into a `<webview>`;
  - a history-clone call (error text: "Owl history clone cannot be adopted by a webview");
  - `setAgentActive(bool)` and `setPageCapturePaintLeaseEnabled(bool)`;
  - `getFaviconImage({size})` and `setFaviconImageSizes([...])`;
  - events `owl-favicon-image-updated`, `-owl-native-contents-close`, `being-captured-state-changed`, `password-manager-open-settings`, `page-info-open-site-settings` and `extension-action-context-menu-closed`.
- Node permission model: the app relaunches with `--allow-addons --allow-child-process --allow-worker --allow-ipc=…`, and errors if "Owl did not activate the required Node network permissions."
- Crash reports tag `minidump.source = owl`.

**Public description [W]**

- OpenAI's "How we built OWL" post (summarized by ByteByteGo) says Atlas runs "Chromium's browser process outside the main Atlas application process". The two sides communicate "through IPC using Mojo" with custom Swift/TypeScript bindings.
- On macOS, web content is "rendered to a CALayer" that the client embeds via `CALayerHost`.
- "Agent-generated events route directly to the web page renderer and never pass through the privileged browser layer."
- [I] On Windows, Codex uses the same OWL host with an Electron-API-compatible JS shell ("owl-electron") instead of a Swift client. The Electron main-process code (`.vite/build/*`) runs inside the OWL/Chromium browser process.

**Process layout (running now, read-only `Win32_Process`) [V]**

```
ChatGPT.exe (browser process: OWL/Chromium + Electron-style main JS)
 ├─ ChatGPT.exe --type=renderer (x4)  --type=gpu-process  --type=utility NetworkService / StorageService  crashpad
 └─ %LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe        (Rust app-server / agent loop)
     ├─ codex-code-mode-host.exe                             (model "code mode" exec host)
     ├─ runtimes\cua_node\<hash>\bin\node_repl.exe           (node_repl MCP: browser plugin path)
     └─ runtimes\cua_node\<hash>\bin\node.exe  →  node_repl.exe  (cua_repl MCP: unified computer use)
            ├─ node.exe (x2)   (trusted services: @oai/browser-desktop/service, @oai/sky/service)
            └─ codex.exe
```

**User-data locations [V] (names listed only)**

- `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex\web\Codex\` (MSIX-virtualized) is a full Chrome user-data-dir. It contains:
  - `Local State`, `Last Version` (=154.0.8037.57), `Default\`, `codex-browser-app\` and `Safe Browsing`;
  - `WidevineCdm`, `extensions_crx_cache`, `component_crx_cache`, `OptimizationHints` and `OnDeviceHeadSuggestModel`;
  - `browser-sidebar-page-states.json`, `owl-feature-bootstrap-cache.json` and `statsig-state.json`.
- `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\` holds the copied Codex CLI. `...\runtimes\cua_node\<hash>\` holds the downloaded computer-use runtime.
- `~\.codex\` is the Codex home. `browser\sessions\<id>.toml` holds per-session `[origins] allowed` site approvals. `browser\config.toml` is referenced in code with keys `full_cdp_access_enabled` and `webmcp_enabled`.

### Q2. The browser panel: how tabs are hosted, navigation, and why it feels lag-free

**Tabs are `<webview>` guests managed by the main process (`browser-sidebar-manager`) [V]**

The renderer mounts `<webview>` elements, and the main process rewrites them in `will-attach-webview`:

- partition becomes `persist:codex-browser-app` (one shared Chrome profile);
- the session is set to the browser session, created with `permissionHandling:'browser'`;
- the preload is set to `browser-page-preload.js`;
- `navigateOnDragDrop` is on;
- the rest is `sandbox:true`, context isolation, `nodeIntegration:false`, `webviewTag:false` and `plugins:false`.

- **Route encoding.** Each tab is requested with partition `persist:codex-browser-app-route:<encodeURIComponent(conversationId\0browserTabId)>[:host:<rendererInstanceId>:<generation>]`. The main process decodes that route, validates host generation and storage ownership, and then swaps in the shared session. [V]
- **Hidden agent tabs.** `HiddenBrowserUseWebviewHost` mounts `<webview>`s for agent tabs the user isn't looking at, with `hostKind:'hidden-browser-use', isVisible:false, shouldBootstrapWhenHidden:true, shouldPaint:false`. [V]
- **Adoption.** A tab opened by `window.open`, a duplicated tab, or a tab dragged to another window reuses the *same live `WebContents*` via `_createWebViewAdoptionLease`. The IPC message is `open-browser-tab {adoptionLease, adoptedWebContentsId}`. This is why moving or showing a tab never reloads it. [V]
- **Hidden tabs keep painting.** For screenshots, `setPageCapturePaintLeaseEnabled(true)` keeps a hidden or background page painting. `backgroundThrottling:false` is set for localhost and file targets (`qe(url)`). [V]
- **Detached windows.** A tab can be popped out into its own window (`page-67a486f4766d.js`, `registerWebviewHostSession`). [V]
- **Chrome WebUI inside the app.** Settings pages embed real `chrome://` pages in dedicated partitions: `chrome://extensions/`, `chrome://password-manager/` (`persist:codex-password-manager-settings`), `chrome://settings/addresses|contactInfo` (`persist:codex-contact-info-settings`) and `chrome://settings/content|privacy|handlers|cookies` (`persist:codex-site-settings`). Stock Electron cannot do this. [V]
- **Profile import.** The schema accepts `profilePath`, `importCookies`, `importPasswords`, `importHistory`, `importExtensions`, `allowUnverifiedExtensions`, `allowElevatedChromeDecryption` and `cookieDomainAllowlist`. UI strings include "Bring over your passwords and cookies to the built-in browser". [V]

**Address bar and navigation [V]**

- The toolbar is React (`tab-content-59217e83b250.js`): back/forward/reload, "Search or enter a URL", find-in-page, zoom, device toolbar, screenshot, print, the extensions puzzle menu and "Site controls".
- Suggestions come from `session.autocomplete.createController()`. Matches carry Chrome `AutocompleteMatch` fields (`contents`, `contentsClass`, `description`, `destinationURL`, `fillIntoEdit`, `inlineAutocompletion`, `deletable`, `acceptToken`). Favicons come from `session.faviconService`.
- Commands (`open-find`, `focus-address`, `step-zoom`, `set-interaction-mode`) travel as `browser-sidebar-command` IPC.

**Why it feels lag-free [I, with V basis]**

- The page is a real Chromium renderer whose frames are composited by the GPU/Viz into the same window. There is no screenshot or video stream. [I]
- The agent acts on that same renderer via CDP, so the user sees the real DOM change the instant it happens. [V/I]
- Cursor motion is drawn locally at display rate, while the agent's click is delayed until the cursor "arrives". The animation therefore never lags behind the effect. [V]
- Tabs are prewarmed (`shouldPrewarmEmptyBrowserTab`) and adopted instead of reloaded. [V]
- OWL starts Chromium asynchronously ([W] from the Atlas post), though that matters less on Windows.

### Q3. Extensions: install, storage and use

- **The code paths exist [V]:**
  - The extension toolbar in the in-app browser has pinned actions, a puzzle menu, "Manage extensions" (`chrome://extensions/` in partition `persist:codex-browser-app`) and "Visit Web Store" (`https://chromewebstore.google.com/`, `openTarget:'in-app-browser'`).
  - Action popups use `webContents.triggerExtensionAction(actionId,{anchorRect})` and Chrome's own popup.
  - Windows opened by `chrome-extension://` pages are allowed when `browserExtensions` is on.
  - Installation from the Web Store therefore uses **Chromium's native Web Store install flow** inside the in-app browser (the `Default` profile has the component "Web Store" app `ahfgeienlihckogmohjhadlkjgocpleb`). There is no `chrome.management` or custom installer in the app code. [V/I]
- **Gating [V]:**
  - desktop feature flag `browserExtensions` (default `false`, server-driven);
  - renderer Statsig gate `2982604767` for `extensionsEnabled`;
  - user setting `extensionsToolbarVisible`;
  - OWL runtime feature `OwlExtensions`.
  - This PC's `owl-feature-bootstrap-cache.json` (written 07-08-2026) reads: enabled `OwlAuth, OwlAutofillAndPasswords, OwlDownloads, OwlPermissions, OwlWebViewEnhancements, OwlHistory, OwlPrinting`; disabled `OwlExtensions, OwlOpenAIGoLinks`.
  - Current live gate values could not be read. The Statsig file stores hashed keys differently.
- **Storage [V]:**
  - `...\web\Codex\codex-browser-app\Extensions\` exists and is empty.
  - `Extension State`, `Extension Rules` and `Extension Scripts` LevelDBs are initialized.
  - `Secure Preferences` lists only `mhjfbmdgcfjbbpaeojofohoefgiehjai` ("Chromium PDF Viewer", component).
  - `extensions_crx_cache` holds one cached CRX (appid `ngpampappnmepgilojfohadhhmbhlaek`, 25 Jun 2026, probably an externally registered extension). It is not installed.
- **The agent and extensions [V]:** the agent does not use extensions to control the in-app browser. A separate "ChatGPT browser extension" is used to control the user's **external** Chrome, Edge, Brave, Opera or Vivaldi (`browserType:'extension'`, native-messaging host `plugins\chrome\extension-host\windows\x64\extension-host.exe`).
- **Conclusion.** The user's "can install Chrome extensions" is true of the architecture (real Chromium extension system), but on this install it is currently flag-disabled. [V/I]

### Q4. Agent control: how the agent drives the same pages

**Transport [V]**

- `resources\cua_node\` is a private Node 24.21 runtime ("cua-node 0.0.24"). It holds `node_repl.exe` and packages `@oai/cua` 0.2.5, `@oai/cua-repl` 0.1.0, `@oai/browser-desktop` 0.1.1 ("Production browser runtime for Codex Desktop"), `@oai/sky` (native desktop control) and `playwright`.
- `@oai/browser-desktop/scripts/browser-service.mjs` (1.9 MB) connects to the app's named pipe. `Hn = win32 ? "\\\\.\\pipe\\codex-browser-use" : "/tmp/codex-browser-use"` (the prefix; per-session pipes are created by `gXe()`).
- **Frame format:** 4-byte little-endian length plus JSON-RPC 2.0. Max 8 MB incoming and 64 MB outgoing.
- **Main-process RPC methods** (class `YYe`, logger `browser-use-iab-api`, registered via `registerRequestHandlerObject`):
  - tab and session: `ping, focusTab, getCommittedTabUrl, getTabs, createTab, nameSession, markTab, getInfo, getUserHistory`;
  - CDP: `attach, attachTarget, detach, detachTarget, executeCdp, executeCdpWithCachedExpression`;
  - other: `allowDownload, executeUnhandledCommand, moveMouse, releaseSessionControl, turnEnded`.
- **Notifications:** app → service sends `onCDPEvent, onCDPDetach, onPageEvent, onDownloadChange, onBrowserTabMentionsInvalidated`. Service → app sends `moveMouse` and `webMcpToolInvoked`.
- The same RPC shape is spoken by the Chrome extension backend (`type:'extension'`) and the cloud CDP backend (`type:'cdp'`). The in-app browser (`type:'iab'`) is just another backend. [V]

**CDP execution in the main process [V]**

- `attachTab` calls `webContents.debugger.attach('1.3')`. The attachment is shared and ref-counted with annotation mode.
- Commands go through `webContents.debugger.sendCommand(method, params, sessionId)` with a timeout.
- An allowlist throws "Browser Use CDP method is not supported in the in-app browser":
  - for any `Target.*` method except `Target.setAutoAttach`;
  - for any `Input.*` method except `dispatchMouseEvent`, `dispatchKeyEvent` and `insertText`.

- `Emulation.setFocusEmulationEnabled` is toggled so the page behaves as focused while the agent or annotation mode works. Full-page screenshots temporarily resize a "capture surface" (`Page.captureScreenshot` with `captureBeyondViewport`).
- Browser-service input is raw CDP ([V], `browser-service.mjs`):
  - `clickPoint`: `ui.moveMouse(tab,x,y)` (awaits cursor arrival) → `Input.dispatchMouseEvent mouseMoved` → `mousePressed` / `mouseReleased` × clickCount.
  - Scrolling uses `Input.synthesizeScrollGesture`. Typing uses `Input.dispatchKeyEvent` and `Input.insertText`.
  - DOM targets use `DOM.scrollIntoViewIfNeeded` plus `DOM.getContentQuads`.
  - `tab.playwright` is **not** playwright-core over `connectOverCDP`. It re-implements a Playwright-like locator API over raw CDP (`Runtime.evaluate`/`callFunctionOn` plus Playwright's injected selector script), so it works on every backend.
  - Accessibility snapshots use CDP `Accessibility.*` and `browser-accessibility.wasm.br`. QR decoding uses `zxing_reader.wasm`.

**Agent cursor overlay [V]**

- Renderer (`tab-content-*.js` `fc`, `options-menu-view-*.js` `Qn`):
  - `<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden" data-testid="browser-agent-cursor-overlay">` sits above the `<webview>` in the app's DOM.
  - Inside it is an `<img>` of `cursor-*.svg` (24×24 arrow) with `glowColor: var(--app-color-accent-blue)`.
  - Motion uses `transform: translate3d(...)` driven by damped springs (`response` / `dampingFraction`).
    - Long moves follow a Bezier path with rotation along the tangent and speed-based stretch.
    - Short moves use "scoot" mode with squash-and-stretch.
    - When idle, a small "thinking" wiggle plays.
- Main process: `moveMouse` → `setBrowserUseCursor({moveSequence, x, y})` → `browser-sidebar-browser-use-cursor-state` IPC.
  - The renderer animates, then `onArrived(moveSequence)` → `browser-use-cursor-arrived` → `notifyCursorArrived` resolves the waiter, and the CDP click proceeds.
  - Animation is skipped (`animateMovement:false`) when the window is unfocused or the tab isn't visible.


**When the user clicks while the agent works [V/I]**

- The main process forwards `before-mouse-event` mouseDown as `browser-sidebar-web-contents-pointer-down`. The renderer's handler only closes popovers and sets a flag. There is no stop, pause or take-over logic, and no "take control" strings for the in-app browser. [V]
- User input is not blocked, so agent CDP input and user input can interleave. [I] The model docs tell the agent to re-observe after every action, and `browser-control-interruption.md` covers the case where "the extension or user took control" (that applies to the external-Chrome extension path).
- **While the agent is active [V]:**
  - `webContents.setAgentActive(true)` is set (the native effect is unknown);
  - `isAgentControllingBrowser` cancels downloads not granted via `allowDownload`;
  - browser-use navigation restrictions apply (site allow/deny policy);
  - the tab is marked `sessionControlled`;
  - the renderer shows the cursor only while `isBrowserUseActive`.
- **At `turnEnded` [V]:** clipboards are restored and the debugger detached. Temporary tabs are closed unless marked `handoff` or `deliverable`. User-opened (persistent) tabs are released, not closed.
- **The user stops the turn [V]:** the plugin hook `Interrupt` → `turn_ended` MCP tool cleans up.

**[C] The Codex CLI's own answer (gpt-5.6-luna, unverified).** It said it doesn't know the private implementation, "unsure whether the transport is CDP over `webContents.debugger`, a native/browser pipe, or another internal RPC layer". It called extension installation "likely disabled or tightly gated". On user clicks it said the click "should affect the shared tab … I'm unsure whether OWL serializes user input, cancels the agent action … or allows both inputs to race". The code evidence above supersedes this.

### Q5. Documents: .docx/.pdf rendering, Request edits, Annotate, tectonic, template picker

- **DOCX [V].** `docx-preview-panel-*.js` lazy-loads `docx-preview` (0.3.7, Apache-2.0; bundle includes JSZip 3.10.1, MIT/GPLv3 dual).
  - It renders twice: a "clean" layer and a "redlines" layer (`renderChanges:true`, toggled by "Show/Hide redlines").
  - It also has a paged thumbnail rail, a zoom control with "fit" (`docx-preview-zoom-trigger`), download, and an annotation overlay.
  - Strings: "Add document annotation", "Ask for change", "Request edits".
  - `walnut-reader.worker-*.js` loads `DocumentFormat.OpenXml*.wasm` (.NET OpenXML SDK in WASM), probably for document structure and editing. [I]
- **PDF [V].** `pdf-preview-panel-*.js` uses `pdfjs-dist` 5.4.296 (Apache-2.0) with canvas pages, `TextLayer`, `AnnotationLayer` and a worker (`pdf.worker.min-*.mjs`). `react-pdf` 10.4.1 (MIT) is also bundled.
  - "PDF page {page}. Click to locate source" shows SyncTeX-style source location for LaTeX output. [I]
  - Web PDFs *inside the in-app browser* use Chromium's own PDF Viewer component extension. [V: installed in the profile]
- **Other panels [V]:** `presentation-panel` (pptx), `workbook-panel` (xlsx), `site-preview`, `notebook-preview-panel`, image and text previews. "Live document control", "Live presentation control" and "Live workbook control" strings suggest the agent can drive these viewers too. [I]
- **Request edits / Annotate, end to end [V]:**
  1. Annotation mode lets the user click an element, drag a region or select text. In the browser this is the preload's `mountBrowserCommentRuntime`: a React root inside an **open shadow root** injected into the page, with `elementFromPoint` picking and a max-z-index layer. Documents use overlays in the viewer.
  2. Each annotation becomes a comment object `{type:'comment', content:[{content_type:'text',text}], position:{path,line}, localBrowserContext | localPdfContext | localArtifactAnnotationContext, localBrowserScreenshot, localBrowserDesignChange, ...}`. Screenshots come from the main process (`browser-sidebar-comment-screenshot`).
  3. The comments are batched ("Artifact review", "Send", "Accept all", "See latest changes") and serialized into the prompt:

```text
Page URL: …   Frame: top document   Frame URL: …
Target: …   Target role: …   Target selector: …   Target path: …
Area rectangle: x=…, y=…, width=…, height=…   Nearby text: … | Selected text: …
PDF path: … / PDF page: 3/10 | Artifact path: … / Artifact type: docx / Annotation target: …
<screenshot reference>   Comment:\n<user text>
```

  4. "Adjust" (advanced annotation / "tweaks") lets users live-edit CSS (`localBrowserDesignChange`, `data-codex-browser-design-*`) and send the diff. [V/W]
  5. Pages can opt in via a **site annotation API**, using feature strings `containers, controls, surfaces, metadata, requests(-with-prompts), mode-toggle`. **WebMCP** tools come from `document.modelContext.getTools()` and are bridged to the agent (`tab.capabilities.get("webmcp")`). [V]
- **`tectonic` [V].** `resources\tectonic\tectonic.exe` (55 MB) is the Tectonic TeX engine, used by the bundled `latex` plugin (`compile_latex.py`, `detect_tectonic.py`) so the agent can produce PDFs.
- **`artifact-template-picker` [V].** `server.mjs` is a stdio MCP server (`openai_artifact_template_picker`) with tools `choose_artifact_template` and `list_artifact_templates`. It shows a form elicitation (`openai/elicitation`) to pick docx, pptx, xlsx or Google Docs/Slides/Sheets templates from skills.

### Q6. New Tab page and other workspace features

- **The New Tab page [V]** is the component in `thread-panel-toggle-button-a44370c9937c.js`, with IDs `threadWorkspace.newTab.*` and `thread.sidePanel.newTab.*`.
  - **Tools:** the chat's side-panel tab actions (Review, Terminal, Side chat, Files, …) with keyboard shortcuts. The first 5–6 are shown, then a "More tools…" menu with "More tools" and "**Plugins and MCPs**" (plugin-provided tab actions). Terminal has a trailing "Open bottom terminal" toggle.
  - **Suggested:** the chat's `outputArtifacts` (e.g. the generated .docx or .pdf).
  - **Recents:** "Recent work", a scrollable list sized by a ResizeObserver.
- **The side panel is a tabbed workspace [V]:** "Open tabs", "Task tabs", "New tab in full view", "Enter split view", move to left/right/bottom pane, "Swap left and right panes", number-key tab shortcuts.
  - Side chat: `local-conversation-side-chat-*.js`.
  - Terminal: `@xterm/xterm` 5.5.0 + `node-pty` 1.1.0.
  - Review: `@pierre/diffs` and `pull-request-code-review-*`.
  - Files: `review-file-tree-*`.
- **Other [V]:** `codex-app-tools` MCP (`server.mjs`: threads, automations and more); a "Chrome" plugin for external browsers; the `unified-computer-use` plugin (cua_repl); `computer-use` plugin; `deep-research`, `visualize` and `latex` plugins.

---

## 3. Tool and API surface the agent gets for the browser

**MCP tools [V]**

| MCP server (plugin) | Tools exposed to the model | Notes |
|---|---|---|
| `cua_repl` (`unified-computer-use`) | `js`, `js_reset`, `turn_ended` (hidden) | The `js` input is `{code}`, described as "JavaScript to execute using the initialized cua_repl runtime." Output limit is 25k tokens. The banner runs `await import("@oai/cua/tinyskyAlt")`. Trusted services are `@oai/browser-desktop/service` and `@oai/sky/service`. |
| `node_repl` (`browser` plugin, skill `control-in-app-browser`) | `js`, `js_reset`, `js_add_node_module_dir`, `turn_ended` | The skill says to `import(".../scripts/browser-client.mjs")` → `setupBrowserRuntime()` → `agent.browsers.get("iab")` → `nodeRepl.write(await iab.documentation())`. |

**`cua` API (cua_repl) [V]:**
- `getState()` and `listBrowsers/listTabs/listApps/listWindows`;
- `getBrowser({url|id})`, `createBrowserTab("iab"|"chrome"|"edge"|browserId, url, {visible, sessionName})`, `getTab(id | {mention} | {url}, {browser})`, `getApp(...)`;
- `Tab` methods: `getAXState()` (diffed), `getScreenshot()`, `click(index|[x,y])`, `scroll`, `drag`, `typeText`, `pressKey`, `paste`, `selectText`, `setValue`, `performSecondaryAction`, `goto/back/forward/reload/close`, `markDeliverable/markHandoff`.

**`browser-client` API (`api.json`, 60 KB) [V]:**
- `agent.browsers.list/get/getDefault/getForUrl`;
- `Browser`: `tabs`, `capabilities`, `user.openTabs/claimTab`, `history`, `nameSession`, `documentation`;
- `Tab`: `goto, back, forward, reload, close, screenshot, title, url, getJsDialog, markDeliverable, markHandoff`, plus sub-APIs:
  - `ax.*` (accessibility-index actions; preferred);
  - `cua.*` (coordinate click, drag, move, scroll, type, keypress);
  - `dom_cua.*` (DOM node-id actions);
  - `playwright.*` (locator subset, `waitForEvent('download'|'filechooser')`, read-only `evaluate`, `domSnapshot`);
  - `clipboard.*`, `content.exportGsuite/exportYouTubeTranscript`, `dev.logs`;
- capabilities: browser `management` (Chrome-compatible tabs/windows/tabGroups/bookmarks, with audit trail), `viewport`, `visibility`; tab `cdp` (raw CDP `send` / `readEvents`, origin-scoped), `pageAssets`, `webmcp`, `botDetection`, `browserAuth`.

**Model-side docs (`environment-docs/codex-app/*.md`) [V]:**
- `api-use-behavior`, `accessibility` (AX first, then batch, then re-observe);
- `browser-safety` and `confirmations` (tiered confirm or hand-off policy, e.g. always confirm "install browser extensions", purchases and sensitive transmissions);
- `visibility` ("Keep browser work in the background by default"; `visibility.set(true)` to show);
- `tab-cleanup-iab`, `tab-mentions-iab` (users can @-mention a tab: `plugin://browser@openai-bundled?mention=tab-v1&browserId=…&tabId=…&title=…&url=…`);
- `file-uploads`, `webmcp`, `screenshots` (embed proof-of-work screenshots in the reply).

---

## 4. What DEX can replicate in Electron, and how

DEX context (already verified by the coordinator):
- Electron 41.2.1 has `session.extensions`, `webContents 'input-event'`, `setWindowOpenHandler({createWindow})`, `executeJavaScriptInIsolatedWorld` and `WebContentsView.setBorderRadius`.
- A closed-shadow-root cursor injected in an isolated world works (github, google, vtop) with click-through.
- `electron-chrome-web-store` (MIT) installs Dark Reader, which works. uBO Lite's service worker fails on missing `chrome.tabs`/`chrome.windows`.
- `electron-chrome-extensions` is GPL-3.0 or Patron. DEX is MIT.

**Feature-by-feature mapping**

**1. One browser the user and agent share (the core change)**
- Codex: `<webview>` guests in one Chrome profile. The agent attaches CDP to the same `WebContents`.
- DEX: a `WebContentsView` per tab inside the main `BaseWindow`, with bounds set from React layout via IPC and `setBorderRadius`. All tabs use `session.fromPartition('persist:dex-browser')`. The agent calls `view.webContents.debugger.attach('1.3')` on the **same** view.
- Notes:
  - Prefer `WebContentsView` over `<webview>`; Electron discourages `<webview>`. The trade-off is that you can't draw app DOM *over* a native view (see the cursor row).
  - A view can be re-parented between windows without reload, which gives an adoption-like effect for free.

**2. Agent transport**
- Codex: a named pipe with JSON-RPC and a CDP allowlist.
- DEX: keep the CDP broker in the main process. Expose `getTabs/createTab/attach/executeCdp/moveMouse/markTab/turnEnded` to the agent over the existing DEX IPC or MCP.
- Copy the allowlist idea: block `Target.*` except `setAutoAttach`, and allow only three `Input.*` methods.

**3. Agent cursor**
- Codex: a host-DOM overlay above the `<webview>`, with spring animation and an **arrival handshake**.
- DEX:
  - (a) Keep the verified spike: a closed shadow root in an isolated world, `pointer-events:none`, re-injected on `did-navigate` / `dom-ready`.
  - (b) Or a transparent overlay `WebContentsView` stacked above the page view. Input pass-through is a problem there, so it's not recommended.
  - Either way, copy the handshake: `moveMouse(x,y)` → animate → post `cursor-arrived(seq)` → then send `Input.dispatchMouseEvent`.
- Notes: the physics is about 200 lines (spring integrator plus Bezier path) and can be re-implemented in MIT code; don't copy OpenAI's code. Hide the cursor when the tab is hidden or unfocused (skip animation).

**4. Hidden agent tabs**
- Codex: `hidden-browser-use` webviews plus a paint lease.
- DEX:
  - A `WebContentsView` not added to the window, or added off-screen.
  - `webContents.setBackgroundThrottling(false)`.
  - `capturePage(rect, {stayHidden:true, stayAwake:true})` for screenshots of hidden views.
  - Show the tab by attaching the same view (no reload).

**5. User and agent co-control**
- Codex: no lock; `setAgentActive`, nav/download guard, turn cleanup.
- DEX:
  - Listen to `webContents.on('input-event')` (Electron 41). A real `mouseDown`/`keyDown` while an agent turn is active can pause the agent and show a "You took over — Resume?" chip. DEX's injected-click guard memory already covers "movement-based" detection.
  - Mark agent-created tabs temporary. Close them at turn end unless marked deliverable.

**6. Address bar and suggestions**
- Codex: Chrome omnibox via `session.autocomplete`.
- DEX: build it yourself.
  - URL-vs-search heuristics: `tldts`, MIT.
  - A local history DB: `better-sqlite3`, recording `did-navigate`.
  - A search-suggest endpoint, optional.
  - Favicons: `page-favicon-updated`.

**7. Extensions**
- Codex: native Chrome extension system and Web Store (gated).
- DEX:
  - Install with `electron-chrome-web-store` (MIT, works). Load with `session.extensions.loadExtension`.
  - Missing `chrome.tabs`/`chrome.windows`/`chrome.action` popups, which need **one of**:
    - (a) license `electron-chrome-extensions` (GPL-3.0 is incompatible with an MIT app unless DEX relicenses; or buy a Patron license);
    - (b) write a minimal MIT shim. Implement `chrome.tabs.query/get/create/update/remove/onUpdated/onActivated` and `chrome.windows.getAll/getCurrent/get` by injecting a preload into the extension's service worker and background contexts (`session.registerPreloadScript({type:'service-worker'})`) that RPCs to the main process's tab model. Also implement an action button that opens `popup.html` in a small `BrowserWindow`.
- Notes:
  - Electron's native support covers a subset: `chrome.runtime`, `storage`, `scripting` (partial), `i18n`, `webRequest`, `devtools` and a partial `tabs`. Expect MV3 service-worker gaps.
  - Don't promise "all Chrome extensions"; test a curated list (Dark Reader OK, uBO Lite needs the shim).

**8. Chrome settings pages (`chrome://extensions`, passwords, site settings)**
- Codex: real WebUI in dedicated partitions.
- DEX: not available in Electron. Build a small React "Extensions" page (list, enable/disable, remove via `session.extensions.getAllExtensions()` / `removeExtension`) and "Site permissions" via `setPermissionRequestHandler` plus your own prompt UI.

**9. Passwords, autofill, import from Chrome**
- Codex: OWL `OwlAutofillAndPasswords` and profile import including elevated Chrome decryption.
- DEX: skip, or use cookie import only.
  - Chrome's app-bound cookie encryption on Windows makes importing Chrome cookies hard. Avoid it; ask the user to sign in inside DEX's browser, or use DEX's existing external-browser path.

**10. PDFs in the browser**
- Codex: Chromium PDF Viewer component.
- DEX: Electron ships the Chromium PDF viewer. Keep `webPreferences.plugins: true` for the browser views and PDFs open in-tab.

**11. Document tab (.docx)**
- Codex: `docx-preview` 0.3.7 (Apache-2.0), with a redlines layer.
- DEX:
  - `docx-preview` (Apache-2.0, ~1.9k★ project, actively maintained, renders page-accurate-ish HTML, `renderChanges` experimental).
  - `mammoth` (BSD-2-Clause) is better for extracting clean semantic HTML/text for the LLM, not for WYSIWYG display.
  - Use both: docx-preview for the view, mammoth or `docx` for agent reads.

**12. Document tab (.pdf, artifacts)**
- Codex: `pdfjs-dist` 5.x (Apache-2.0) canvas plus text and annotation layers.
- DEX: `pdfjs-dist` directly (or `react-pdf`, MIT). The text layer enables region, quote and annotation anchors.

**13. Request edits / Annotate**
- Codex: shadow-root overlay in the page, typed comments, screenshot, prompt serialization.
- DEX:
  - An isolated-world overlay (same technique as the cursor): element picker via `elementFromPoint` and a CSS-path builder, region drag, text selection.
  - `webContents.capturePage(rect)` for the crop.
  - Serialize to a prompt block like Codex's (URL, frame, selector, role, rect, text, comment).
  - For docx/pdf, overlay on the viewer's DOM or canvas.
  - `modern-screenshot` (MIT) if you need DOM-to-image of app panels.

**14. New Tab page**
- Codex: React: Tools (with shortcuts), Suggested (artifacts), Recents.
- DEX: a pure React page rendered as a "virtual tab" (not a web page). Tools map to DEX panels; Suggested lists files the agent produced this session; Recents lists recent tabs and files.

**15. Terminal and review panes**
- Codex: `@xterm/xterm` + `node-pty`, diff viewers.
- DEX: the same libraries (`@xterm/xterm` MIT, `node-pty` MIT); `diff` / `@pierre/diffs` or `react-diff-view`.

**16. LaTeX to PDF**
- Codex: `tectonic.exe` (MIT).
- DEX: optional; bundle Tectonic (MIT) if DEX writes reports.

**Where Electron falls short of OWL, and workarounds**

- **Chrome WebUI and browser services.** Electron lacks the omnibox engine, password manager and autofill, Safe Browsing UI, native permission bubbles, page-info bubble, task manager, Sync and the component updater.
  - Workaround: build the small subset DEX needs (history, suggestions, permission prompts). Treat the rest as out of scope.
- **The extension platform.**
  - Workaround: a partial API plus the Web Store installer (MIT) plus DEX's own `chrome.tabs`/`windows` shim, or the licensed `electron-chrome-extensions`.
- **`<webview>` adoption and paint leases.**
  - `WebContentsView` re-parenting covers adoption.
  - `setBackgroundThrottling(false)` plus `capturePage({stayHidden})` covers paint leases.
- **Agent events bypassing the privileged layer.** OWL/Atlas injects agent input directly into the renderer.
  - In Electron, CDP `Input.dispatchMouseEvent` is equivalent in practice. Keep the CDP allowlist and never expose raw `Target.*` or `Browser.*` to the model.
- **WebMCP (`document.modelContext`).** It depends on Chromium flags. Electron 41 (Chromium 146) may need `--enable-blink-features=WebMCP` or similar.
  - Treat it as optional or experimental. (Not verified for Electron.)
- **One profile shared by user and agent.** Codex does this deliberately; it is not an isolated agent profile.
  - DEX can do the same with one persistent partition. Apply a site allow/deny policy (Codex: "Always ask / Auto approve / Always allow" per site; `~/.codex/browser/sessions/*.toml`).

**Recommended build order for DEX [I]**

1. The `WebContentsView` tab host plus React chrome (tabs, address bar, New Tab).
2. The main-process CDP broker plus the allowlist.
3. The injected cursor with arrival handshake.
4. Hidden agent tabs and turn-end cleanup.
5. Annotate and Request edits.
6. The docx and pdf viewers.
7. Extensions via `electron-chrome-web-store` plus the MIT `chrome.tabs`/`windows` shim.

---

## 5. Open questions and unknowns

1. **Live extension gate.** The feature cache that disables `OwlExtensions` is from 7 Aug 2026. The current Statsig or `browserExtensions` value couldn't be read without launching the app. The user's statement that extensions work may reflect a later rollout.
2. **What `webContents.setAgentActive(true)` does natively.** Possibly an OWL indicator or input policy. The name suggests Chromium-side state (e.g. focus or visibility policy); not observable statically.
3. **How OWL on Windows embeds guest content.** The code only shows `<webview>` plus `OwlWebViewEnhancements`; whether OWL uses stock Chromium guest-view compositing or its own is unknown. The macOS Atlas path (CALayerHost) is documented; Windows is not.
4. **The exact per-session pipe name and peer authorization on Windows.** The code prefix is `\\.\pipe\codex-browser-use…`; peer authorization is enforced only on macOS in the code seen.
5. **The purpose of the .NET OpenXML WASM (`walnut-reader`).** Reading vs. applying edits to .docx wasn't traced.
6. **Whether user input during agent control ever cancels a pending agent step.** No such code was found, but OWL-native behaviour (e.g. via `setAgentActive`) could exist.
7. **Electron-side claims in §4.** Electron's extension API subset, `capturePage` options, `registerPreloadScript({type:'service-worker'})` and PDF viewer behaviour are from prior knowledge; the Electron docs fetch failed on a rate limit. Verify against Electron 41 docs before implementing.

---

## 6. Sources

**Local (read-only)**
- `C:\Program Files\WindowsApps\OpenAI.Codex_26.924.2738.0_x64__2p2nqsd0c76g0\`
  - `AppxManifest.xml`
  - `app\ChatGPT.exe` and `app\chrome.dll` (version info)
  - `app\Codex.exe` (PDB string)
  - `app\owl-shell-runtime.json`
- `...\app\resources\`
  - `owl-electron-app.json`, `owl-app.ini`, `THIRD_PARTY_NOTICES.txt`
  - `app.asar`:
    - `package.json`
    - `.vite/build/{early-bootstrap,bootstrap-D2PJMYEh,main-DAwJoFgo,browser-page-preload,preload,sandbox-preload,policy-BiKjVXeL}.js`
    - `webview/assets/{tab-content-59217e83b250,page-67a486f4766d,options-menu-view-5a4d4f4a1721,webview-b46c74f23aa6,hidden-browser-use-webview-host-b7d81b8a922d,thread-panel-toggle-button-a44370c9937c,docx-preview-panel-2389d691f332,docx-preview-8513c2dacad2,pdf-preview-panel-2911c201d5e8,source-toolbar-a11dd3175c84,app-shared-c568b0b98683,app-initial-ff48311587c5}.js`
    - `cursor-*.svg`
  - `cua_node\manifest.json`
  - `cua_node\bin\node_modules\@oai\{browser-desktop,cua,cua-repl,sky}\...`, including `environment-docs/codex-app/*.md`, `api.json`, `scripts/browser-service.mjs`, `cua-repl/README.md`, `instructions/*` and `dist/.../launch.js`
  - `plugins\openai-bundled\` (`browser`, `chrome`, `codex-app-tools`, `unified-computer-use`, `latex` manifests and `SKILL.md`)
  - `tectonic\tectonic.exe`, `artifact-template-picker\server.mjs`
- `%LOCALAPPDATA%\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Roaming\Codex\web\Codex\`
  - directory names only;
  - `owl-feature-bootstrap-cache.json`;
  - extension IDs and names from `Secure Preferences` (only `extensions.settings` id/name/location printed);
  - `extensions_crx_cache\metadata.json`.
- `~\.codex\` (names, `browser\sessions\*.toml` keys only, `models_cache.json` slugs), and the `Win32_Process` tree (executable paths only).
- Codex CLI 0.153.4, `codex exec -m gpt-5.6-luna --sandbox read-only` (one question; answer quoted in §2 Q4 as [C]).

**Web**
- OpenAI, "How we built OWL, the new architecture behind our ChatGPT-based browser, Atlas": https://openai.com/index/building-chatgpt-atlas/ (403 to fetch; quoted via the ByteByteGo summary below)
- ByteByteGo, "The Architecture Behind Atlas": https://blog.bytebytego.com/p/the-architecture-behind-atlas-openais
- ChatGPT Learn, "Browser" (in-app browser docs; redirected from developers.openai.com/codex/app/browser): https://learn.chatgpt.com/docs/browser?surface=app
- ChatGPT Learn, "Browser extension": https://learn.chatgpt.com/docs/chrome-extension
- OpenAI Devs on X (advanced annotation mode): https://x.com/OpenAIDevs/status/2057530210967523399
- Surf AI, "OpenAI's Codex Ditches Electron for a Custom Chromium Layer" (speculative): https://asksurf.ai/pulse/en/openai-codex-ditches-electron-custom-chromium
- MacRumors, Codex Chrome extension (7 May 2026): https://www.macrumors.com/2026/05/07/openai-codex-chrome-extension/
- Electron docs (referenced, not fetched this session):
  - https://www.electronjs.org/docs/latest/api/extensions-api
  - https://www.electronjs.org/docs/latest/api/web-contents-view
  - https://www.electronjs.org/docs/latest/api/debugger
- `electron-browser-shell` (electron-chrome-extensions / electron-chrome-web-store): https://github.com/samuelmaddock/electron-browser-shell (licenses per the coordinator's verification)
