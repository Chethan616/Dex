# TO BE DONE — the `unify` branch, handed over

> **To the Claude reading this:** use **Claude Opus 5.5** (`claude-opus-5-5`) at effort **xhigh**.
> Use **max** for the hard parts:
> - the P3 extension shim;
> - anything in `cdpBroker.ts`, `cdpLease.ts` or `BrowserPool.ts`;
> - anything that changes what the agent can reach.
>
> In Claude Code, pick the model with `/model` and set the effort there (or with your version's effort setting) **before you start**.
>
> This one file holds what you need to carry on without asking anyone:
> - the state of the branch;
> - the rules of this repo;
> - how to run and test it;
> - what's built and where;
> - what's left, step by step with acceptance tests;
> - the full plan, the full research and the measurements (verbatim, in the appendices).
>
> Read Part 1 completely before you change anything. Keep this file current as you work: tick items, add findings.

Written 2026-10-01 by the Claude session that built P0–P2 (Opus 5.5).
Branch `unify` of `github.com/Chethan616/Dex`.
The repo is **public**.

---

## Contents

- **Part 1 — Start here**
  - 1.1 State in one screen
  - 1.2 The rules (security, secrets, style)
  - 1.3 Run, test, ship
  - 1.4 Gotchas that cost hours
- **Part 2 — What exists**
  - 2.1 Phase status
  - 2.2 Code map
  - 2.3 How the pieces talk
  - 2.4 Where the code differs from PLAN.md
- **Part 3 — What to do, in order**
  - 3.0 Verify P2 live (first)
  - 3.1 Finish P2
  - 3.2 P1 leftovers
  - 3.3 P3: extensions
  - 3.4 P4: annotate, request edits, side chat
  - 3.5 P5: polish
  - 3.6 Known issues
- **Part 4 — The Android app** (state and release, in case you touch it)
- **Appendix A** — `docs/unify/PLAN.md` (the entire plan)
- **Appendix B** — `docs/unify/codex-research.md` (the entire research)
- **Appendix C** — `docs/unify/P0.md` (measurements and spikes)
- **Appendix D** — `docs/unify/P1-background-tabs.md` (the stage)

---

# Part 1 — Start here

## 1.1 State in one screen

**What unify is.** In DEX, each task gets a Codex-style **workspace** in its pane:
- **tabs** holding the live web pages, the documents the task made, and a chat;
- **you and the agent use the same live pages at the same time.** Nothing blocks your input, and a small "DEX" cursor shows where the agent clicks.

DEX keeps its own layout: sidebar, dashboard, agent view header, Logs window. The model for all this is the side panel of OpenAI's Codex desktop app (researched in Appendix B).

**Branch.**
- Branch: `unify`, cut from `feat/low-latency`, which was itself merged in.
- `main` is far behind; don't merge into it unless the owner asks.
- Head at hand-over: `9b2555bc Unify P2: document tabs — files drawn in the workspace, next to the chat`.

**Done:**

| Phase | State |
|---|---|
| P0 — measure & spike | ✅ done. Results in Appendix C |
| P1 — browser & shared control | ✅ core done, live-tested. Tabs, toolbar, address bar, popups as tabs, native-size rendering, no blocking overlay, polite agent, agent cursor with arrival handshake, `dex-tab`, the off-screen **stage**, the CDP broker. **Leftovers listed in §3.2** |
| Chat in the pane (PLAN §3.12) | ✅ done, live-tested. Codex-style turns, file cards, minibar, composer, per-task bot avatar with moods |
| P2 — documents | ✅ built and unit-tested, **not yet live-tested** (§3.0). Remaining P2 bits in §3.1 |
| P3 — extensions | ⏳ not started. Spikes proved the approach (Appendix C #3–#5) |
| P4 — annotate / request edits / side chat | ⏳ not started |
| P5 — polish | ⏳ not started |

**Tests at hand-over** (`desktop/app`, `npx vitest run`): **820 passed, 8 skipped**, 98 files. `tsc --noEmit` is clean. ESLint shows only old warnings in `AgentPane.tsx`.

**Your first three moves:**
1. Do the P2 live check in §3.0. It's a checklist.
2. Finish P2 (§3.1).
3. Then P1 leftovers (§3.2) and P3 (§3.3), in that order unless the owner says otherwise.

## 1.2 The rules (non-negotiable)

These come from the owner directly, over several sessions. Treat each as a hard constraint.

**Secrets and accounts**
- **Never commit secrets.** In particular:
  - the Android keystore;
  - `google-services.json`;
  - `config/firebase.json`;
  - `config/oauth-clients.json`;
  - anything from `~/.gradle/gradle.properties` (`DEX_RELEASE_*` signing values).
- Never print tokens or signing secrets in output either.
- **Never push keys to Firebase.** Keep Firebase on the **free plan**: no billing, no paid features. Make no IAM or console changes unless asked.
- **The Hugging Face token lives only in the OS keychain** (keytar). Never write it to a file, a log or git.
- **The repo is public.** When you describe what OpenAI's Codex does, *describe* it. Never paste or quote its code. The research in Appendix B follows this rule; keep it that way.

**Files never to commit**
- `desktop/app/install-id.json`
- anything under `UI/` (the owner's screenshots and notes)
- `dex/core/apps/android/.gradle/9.4.1/fileHashes/fileHashes.lock`
- `desktop/app/package-lock.json`: the repo uses **yarn**. An npm install made this file. Leave it untracked or delete it.

**Other people's files and settings**
- **Don't overwrite `TOBEDONE.MD`** (repo root). It belongs to a collaborator. This file is `TO_BE_DONE.md`, a different file.
- **Don't modify the owner's `~/.codex/config.toml`.**

**The owner's machine and phone**
- **Don't drive or restart DEX while the owner is using it.** Before you restart DEX or drive its UI, check:
  - how long the PC has been idle (`GetLastInputInfo`);
  - what the foreground window is.

  If they're active, or DEX's "Hub" is in front, wait.
- **Don't tap the owner's phone while they use it.** Check `adb shell dumpsys window | grep mCurrentFocus` first.

**Tools and taste**
- **Don't run `graphify update`.** It was killed for using too much memory. Skip it unless the owner asks, even though `CLAUDE.md` says to run it after changes.
- **No metal buttons.** The owner dislikes the `MetalButton` / metallic style. Use plain pill buttons, or M3 Expressive on Android.
- **Fluidity beats flourish.** The owner's words: "I prefer fluidity more than anything." On the phone (and the desktop) every animation must stay smooth on a real device:
  - no Compose shared-element transitions: the bot that flies from a Home row into the chat's top bar is `ui/avatar/BotFlight.kt`, one avatar in an overlay layer moved by its layer transform. Reuse that pattern for any "element flies between screens" effect;
  - nothing heavy while a screen slides in (the chat's list waits for `settled`);
  - no image decoding in composition (`rememberThumb` decodes off the main thread);
  - no per-item entrance cascades;
  - no full-screen scale or fade transitions;
  - read animated values in the **draw or layer phase** (`Canvas {}`, `graphicsLayer {}`), never in composition, or the whole subtree recomposes every frame;
  - nothing animates forever in a list (`BotAvatar(still = true)`);
  - Firestore listeners on a background executor;
  - no animated scroll through long lists.

  The commits for Android 1.0.19 (`ec9a8d17`) and 1.0.20 (`3461af49`) explain each of these.

**Style of this codebase** (match it; reviewers notice)
- Comments explain **why**, in plain sentences, at the density of the surrounding code. Look at `BrowserPool.ts`, `stage.ts` or `documents.ts`.
- User-facing text is short, warm and concrete: "Opening notes.md…", "DEX can't draw this kind of file here."
- Tests are named as behaviour sentences, e.g. `it('opening the same file again re-shows its tab instead of adding one')`.
- Commit messages:
  - a short subject, often "Unify P2: …";
  - a body that says what changed and why;
  - your model's `Co-Authored-By:` trailer at the end.
- Prefer small, focused commits. Push to `origin unify` when a piece is done and green.

## 1.3 Run, test, ship

**Layout.** The desktop app is in `desktop/app`: Electron 41.2.1 (Chromium 146), electron-forge, Vite, React 19, TypeScript, vitest. The Android app is in `android/`.

```bash
# desktop/app
yarn install --frozen-lockfile        # what CI does; .yarnrc sets --ignore-engines
npx tsc --noEmit                      # typecheck (no "include": the whole tree)
npx vitest run                        # all unit tests (~15 s)
npx vitest run tests/unit/hub/workspace   # a folder
npx eslint src/renderer/hub/workspace     # lint what you touched
```

**Running DEX in dev (Windows)**
- Start it **from PowerShell**, detached. A Git Bash background job exits at once:
  ```powershell
  cd C:\Users\cheth\OneDrive\Desktop\DEXV3\desktop\app
  Start-Process -WindowStyle Hidden cmd -ArgumentList '/c', 'set AGB_CDP_PORT=9222&& npx electron-forge start > %TEMP%\dex-dev.log 2>&1'
  ```
- `AGB_CDP_PORT=9222` opens Chromium's remote-debugging port so *you* can drive the hub over CDP for UI checks.
  - It's closed by default: that's a security fix, see §2.3.
  - Settings shows a warning while it's open.
  - Restart without it when you're done.
- **Main-process changes need a restart.** Kill the forge node tree and start again. Renderer changes hot-reload.
- **Kill stale `bun` processes first.** They are `browser-harness-js` REPLs, and they inherit port 9222.
- The **installed** DEX (from the release) and the dev build share a single-instance lock. Quit the installed one first, and only if the owner isn't using it (§1.2).
- Driving the hub over CDP: list targets at `http://127.0.0.1:9222/json`, pick the one titled `Hub`, and talk to it over its `webSocketDebuggerUrl`:
  - `Runtime.evaluate` with `awaitPromise:true` to call `window.electronAPI.*` or click DOM;
  - `Page.captureScreenshot` to look.

  A ~40-line Python (`websocket-client`) or Node (`ws`) script does it.

**Releases**
- **Desktop:**
  - bump `desktop/app/package.json` `version`;
  - tag `vX.Y.Z` at that commit (the tag must equal the version);
  - push the tag. `.github/workflows/dex-release.yml` builds the Squirrel installer (`dex-setup.exe`, `RELEASES`, `.nupkg`) and publishes the release.
  - Installed apps auto-update from `releases/latest/download/RELEASES`.
  - **Don't tag without the owner's OK.**
- **Android:** see Part 4. Built locally and uploaded with `gh`.
- CI installs with **`yarn install --frozen-lockfile`**. If you add a dependency, update `yarn.lock` **with yarn**, keeping every platform's optional packages. How, in §1.4.

## 1.4 Gotchas that cost hours

**Lockfile and installs**
- **Lockfile churn.** `npm install` (or a yarn run on a broken cache) can rewrite `yarn.lock` and **drop other platforms' optional packages** (`@esbuild/linux-x64`, `@rollup/rollup-darwin-*`…). The release CI then breaks. The safe way to add a dependency:
  1. Copy `package.json` plus HEAD's `yarn.lock` into a scratch folder.
  2. Run `yarn install --ignore-scripts --ignore-engines --cache-folder <scratch>/cache` there.
  3. Copy the resulting `yarn.lock` back.
  4. Check the diff only *adds* entries.
- **The owner's global yarn cache has a corrupt `@electron/node-gyp` entry** ("There should only be one folder in a package cache"). Use `--cache-folder`. Don't clean their global cache without asking.
- **Installing packages while DEX runs** fails with `EBUSY`. Stop DEX first.
- npm needs `--legacy-peer-deps`: there's an old `@visx` peer conflict. Yarn only warns.

**IPC and schemas**
- **zod strips unknown fields.** Session events go through `src/shared/session-schemas.ts`. A new field on an event (for example `at`) must be declared there, or it silently disappears on the way to the hub.
- **The hub's CSP** is a `<meta>` in `src/renderer/hub/hub.html`. It now allows `blob:` for img/media/font/connect and `worker-src 'self' blob:` (pdf.js). Anything new that loads from another scheme needs it added there. The hub can't load `file://`: read bytes through `sessions.readFile` and make a blob URL (`hub/workspace/useTaskFileUrl.ts`).
- **Never call raw `webContents.debugger.attach/detach`.** Use `leaseDebugger()` / `withDebugger()` from `src/main/cdpLease.ts`, or you cut the agent's broker off its tab.

**Native views (`WebContentsView`)**
- **A view that's in no window never paints**, so CDP `Page.captureScreenshot` on it **hangs**. That's why the stage exists (Appendix D). Never "detach" a tab to hide it: park it on the stage (`BrowserPool.park`).
- **A view hidden before its first layout stays 0×0.** Set its bounds while visible, then hide it.
- **`capturePage()` of a hidden view returns stale frames** (3–7 times in 10). Don't serve screenshots from it.
- **Windows occlusion tracking** marks the off-screen stage as hidden, and its views stop producing frames. `index.ts` disables `CalculateNativeWinOcclusion`. Keep that.
- **Native views sit above all renderer DOM.** A React menu can't draw over a live page. Either draw in the toolbar strip, or step the page aside to the stage while a surface owns the rect. The chat and documents do the latter: AgentPane's `surfaceActive`.

**Tests and shell**
- **`.gitignore` ignores any folder named `logs`**, which includes `tests/unit/logs`. Force-add (`git add -f`) test files there.
- **jsdom lacks `ResizeObserver` and `CSS.escape`.** Stub the first in specs, and don't use the second in components (see `DocumentView` anchors).
- **Python heredocs and escapes.** When patching TS with a Python heredoc, `'\\n'` inside a string becomes a real newline in the output. Use the Edit tool for escape-heavy code.
- **`.cmd` launchers must keep CRLF.** `sed` on them drops it. Copy bytes, or write them with explicit `\r\n`.
- **The owner's PC can't run local LLMs on the GPU.** The RX 6800M is on a 2021 AMD driver: ROCm refuses it and Vulkan computes garbage. Gemini's free tier is 20 requests/**day**, and DEX needs ~30 calls per GUI task. Live tests use Claude Code, the owner's subscription, sparingly.
- **Codex engine and the owner's config.** `~/.codex/config.toml` sets `model = "gpt-6-luna"`. When DEX starts Codex **without** `-m`, Codex uses that model and fails: "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account."
  - Live tests: either pick a model in DEX's model picker (it passes `-m`, e.g. `gpt-5.6-luna`), or use Claude Code.
  - Don't edit their config. A fix in DEX is listed in §3.6.

---

# Part 2 — What exists

## 2.1 Phase status, item by item

PLAN §5 and the P1/P2 rows, against the code:

| Item (PLAN ref) | State | Where |
|---|---|---|
| Tabs per task, the active tab = "the session's browser" | ✅ | `src/main/sessions/BrowserPool.ts` |
| `window.open` / `target=_blank` / OAuth popups as tabs, `window.opener` kept | ✅ | `BrowserPool.wireTab` → `setWindowOpenHandler` |
| Cap 12 tabs per task; closing the last leaves a new tab; a crashed background tab doesn't end the task | ✅ | `BrowserPool` |
| Native-size rendering (1440-px emulation removed) | ✅ | `BrowserPool` (P0 #6: it cost sharpness, not frames) |
| Tab strip, back/forward/reload/stop, address bar (URL or search; `javascript:`/`data:`/`file:` refused) | ✅ | `hub/workspace/WorkspaceBar.tsx`, `src/shared/address.ts` |
| Shortcuts Ctrl+T/W/L/R, Ctrl+Tab, Alt+←/→, F5 (page focused and hub focused) | ✅ | `BrowserPool.runShortcut`, `AgentPane` keydown effect |
| No blocking overlay; a glow around the page while DEX drives; "DEX is working — you can use the page too" + Pause | ✅ | `AgentPane` (`pane__output--agent`), `WorkspaceBar` |
| Polite agent: holds DEX's next input while you click/scroll/type (≤ 8 s; DEX's own input filtered) | ✅ | `src/main/workspace/userActivity.ts`, broker hook |
| Agent cursor (closed shadow root, isolated world), click waits for arrival, hidden in agent screenshots | ✅ | `src/main/workspace/agentCursor.ts` (`DEX_AGENT_CURSOR=0` turns it off) |
| CDP broker (no open debug port; per-task token; allowlist) | ✅ (`f675a5f4`) | `src/main/cdpBroker.ts`, `src/main/cdpLease.ts` |
| `dex-tab` (list/new/show/keep/close; scratch tabs close at run end) | ✅ | `hl/stock/dex-tools/dex-tab(.cmd)`, `tabs.md`, `POST /dex/tab`, `BrowserPool.closeTemporaryTabs` |
| The stage (off-screen window for tabs not on screen) | ✅ | `src/main/workspace/stage.ts`, Appendix D |
| New-tab page (Suggested sites + this task's files) | ✅ partial | `hub/workspace/NewTabPage.tsx`; **Tools** row missing (§3.1) |
| Chat in the pane (turns, "Worked for", file cards, minibar, composer) | ✅ | `hub/chat/*` |
| Bot moods (awake/thinking/working/needs-you/happy/sad/sleeping) | ✅ | `components/lib/botMood.ts`, `AgentAvatar.tsx`, `TaskAvatar.tsx` |
| Events carry `at` | ✅ | `SessionManager.appendOutput`, `session-schemas.ts` `WHEN` |
| `sessions:open-file` (recorded files only; executables only revealed) | ✅ | `index.ts`, `sessions/recordedFiles.ts` |
| **P2** document tabs (all kinds in §3.9 except .blend/.pptx), live reload, `dex-open`, file cards → tabs | ✅ **not live-tested** | §2.2 "P2" |
| `persist:dex-web` profile + one-time cookie migration | ❌ | §3.2 |
| Tab persistence across restarts | ❌ | §3.2 |
| Download guard, per-site navigation policy, password-field guard | ❌ | §3.2 |
| Address-bar suggestions (history, site memory) | ❌ | §3.2 |
| ⋯ menu: find in page, zoom, print, open in your browser, copy link, devtools, clear site data | ❌ | §3.2 |
| Ctrl+Shift+T reopen closed tab | ❌ | §3.2 |
| `user-interacted` signal to the engine | ❌ | §3.2 (the skill doc tells the agent to re-read instead) |
| Extensions (P3) | ❌ | §3.3 |
| Annotate / Request edits / @-mention a tab / side chat (P4) | ❌ | §3.4 |
| Split, maximize, reorder, memory badges, interactive terminal, phone tab list (P5) | ❌ | §3.5 |

## 2.2 Code map (everything unify touched)

Paths are under `desktop/app/` unless noted.

**Main process**

| File | What it does |
|---|---|
| `src/main/index.ts` | Wiring. Unify parts: `documentTabs` (P2) near the top. The local task server's routes `POST /dex/tab`, `POST /dex/open`. IPC `sessions:open-file`, `sessions:read-file`, `workspace:docs`/`doc-open`/`doc-close`, `workspace:tabs`/`tab`/`shortcut`, `sessions:view-attach/detach/resize`. Broker hooks (`beforeCommand` → `browserPool.noteAgentUse` + `waitForFrame` for screenshots). Occlusion switch. `closeTemporaryTabs` at session end. `documentTabs.closeSession` on delete and `dispose` on quit |
| `src/main/sessions/BrowserPool.ts` | Per-task tabs. Each `TabEntry` has a `place`: `screen` (in DEX's window), `stage`, or `none`. Key methods: `create`, `openTab`, `activateTab`, `closeTab`, `navigateTab`, `tabAction`, `listTabs`, `keepTab`, `closeTemporaryTabs`, `attachToWindow`/`detachFromWindow`, `park`, `putOnScreen`, `ensureOnScreen`, `setWindowHidden`, `noteAgentUse`, `getTabWebContents`, `runShortcut`. Frame-rate and idle-freeze policy. 50 unit tests |
| `src/main/workspace/stage.ts` | `getStage()` (BaseWindow at −32000, `showInactive`, not focusable, no taskbar, `type:'toolbar'`), `stageEnabled()` (win32 and `DEX_STAGE!=='0'`), `fitStage`, `destroyStage`, `waitForFrame(wc)` (isolated world, 2 rAF or 200 ms) |
| `src/main/workspace/agentCursor.ts` | The injected cursor: spring glide, arrival handshake, press ring, hide during capture |
| `src/main/workspace/userActivity.ts` | Real user input per tab (`noteInputEvent`), DEX's own input filtered (`noteAgentInput`), `userActiveWithin`, `waitForUserIdle` |
| `src/main/workspace/documents.ts` | **P2.** `DocumentTabs`: a task's open documents (`list`/`get`/`isOpen`/`open`/`close`/`closeSession`/`dispose`). Watches each file (`fs.watch`, 250 ms debounce) and reports changes. `MAX_DOC_BYTES` = 80 MB |
| `src/main/sessions/recordedFiles.ts` | `resolveRecordedFile(path, output, harnessDir)`: a path is allowed only if the task recorded it (file_output, screenshot, task_state files). `isRunnable` |
| `src/main/cdpBroker.ts`, `src/main/cdpLease.ts` | The CDP broker (per-task token URL `BU_CDP_WS`, allowlist) and debugger leasing |
| `src/main/hl/harness.ts` | Materialises the stock skills/tools into the agent's working dir. `executableBasenames` lists every `dex-*` tool (add new tools here) |
| `src/main/hl/stock/AGENTS.md` | The agent's top-level instructions (what tool for what job; "Sharing the page with the user") |
| `src/main/hl/stock/dex-tools/` | `dex-tab` + `.cmd` + `tabs.md`; **`dex-open` + `.cmd` + `open.md`** (P2); `SKILL.md` (index of tools); `dex-lib.sh` (`dex_post` reads `DEX_CONTROL_FILE` for the server URL and token) |
| `src/main/sessions/SessionManager.ts` | `appendOutput` stamps `at` on every event |

**Shared, preload, types**

| File | What it does |
|---|---|
| `src/shared/session-schemas.ts` | zod schemas for events; `WHEN = { at }` spread into 15 event schemas |
| `src/shared/address.ts` | URL-or-search parsing, `displayAddress` |
| `src/preload/shell.ts` | `electronAPI.workspace.{tabs, tab, onTabsChanged, shortcut, onFocusAddress, docs, docOpen, docClose, onDocsChanged, onDocChanged}`, `electronAPI.sessions.{openFile, readFile, …}` |
| `src/renderer/globals.d.ts` | Types: `WorkspaceTab`, `WorkspaceTabAction`, `WorkspaceShortcut`, `WorkspaceDoc`, `ElectronWorkspaceAPI`, `ElectronSessionAPI.readFile/openFile` |

**Renderer (hub)**

| File | What it does |
|---|---|
| `src/renderer/hub/AgentPane.tsx` | The task's pane. Decides what owns the rect. `paneOverride` is `'auto' \| 'page' \| 'chat' \| 'doc'`. The surfaces: `docActive` (a document tab in front), `chatActive`, `newTabActive`. When any `surfaceActive`, it detaches the page view (to the stage). It renders `WorkspaceBar`, then `DocumentView`, `ChatView` or `NewTabPage`. Measures the rect for the native view (ResizeObserver, rAF-coalesced). Hub-focused shortcuts (with a doc in front, Ctrl+W closes the doc) |
| `src/renderer/hub/workspace/WorkspaceBar.tsx` + `workspace.css` | Tab strip: Chat (pinned), **doc tabs**, web tabs, +. Toolbar only while a web page is in front. `browser={false}` hides web chrome for tasks without a browser |
| `src/renderer/hub/workspace/useWorkspaceTabs.ts` | Live web tabs from main |
| `src/renderer/hub/workspace/useWorkspaceDocs.ts` | **P2.** Live doc tabs; `focus` (bump to bring one to front); `revisions` (bump to reload) |
| `src/renderer/hub/workspace/useTaskFileUrl.ts` | **P2.** blob: URL for a recorded file via `readFile` (chat screenshots) |
| `src/renderer/hub/workspace/NewTabPage.tsx` | New-tab page: Recents (task files), Suggested (sites) |
| `src/renderer/hub/workspace/docs/kinds.ts` | **P2.** `viewerFor(name)` → `pdf\|docx\|sheet\|markdown\|text\|image\|video\|audio\|model\|html\|none`, `mimeFor`, `zoomable`, `safeHref`, `ViewerProps`, `OutlineItem` |
| `src/renderer/hub/workspace/docs/DocumentView.tsx` | **P2.** The doc surface. A bar: outline toggle, badge, name, size, "opened by DEX", Changes (docx), zoom −/%/+, Open in app, Show in folder. Below it, the scroll area with the lazy viewer. Loads bytes via `sessions.readFile`. Keeps the scroll position across reloads of the same doc. Captures every link click: web links go to a workspace tab, `#anchor` scrolls, everything else is dropped. Ctrl+wheel and Ctrl +/−/0 zoom |
| `src/renderer/hub/workspace/docs/PdfView.tsx` | pdf.js 6: pages laid out at size, drawn lazily (IntersectionObserver, 600 px margin), TextLayer, PDF bookmarks as the outline |
| `src/renderer/hub/workspace/docs/DocxView.tsx` | docx-preview: pages, `renderChanges` (redlines toggle), base64 images/fonts, links sanitised, Heading1–3 as the outline |
| `src/renderer/hub/workspace/docs/SheetView.tsx` | SheetJS CE 0.20.3: `sheetGrid` (formatted text, capped 5,000 rows × 200 cols), sticky headers, sheet tabs |
| `src/renderer/hub/workspace/docs/TextView.tsx` | Text/code with line numbers (one-line JSON pretty-printed, 2 M chars cap); `MarkdownView` (DEX's Markdown, h1–h3 outline) |
| `src/renderer/hub/workspace/docs/MediaView.tsx` | Image (zoomable, checkerboard), video, audio; `useBlobUrl` |
| `src/renderer/hub/workspace/docs/ModelView.tsx` | `@google/model-viewer` for .glb/.gltf (self-contained only) |
| `src/renderer/hub/workspace/docs/HtmlView.tsx` | `<iframe sandbox="" srcDoc>`: nothing runs |
| `src/renderer/hub/workspace/docs/docs.css` | All viewer styles, incl. pdf.js's text-layer rules (Apache-2.0, credited) |
| `src/renderer/hub/chat/ChatView.tsx`, `turns.ts`, `Composer.tsx`, `FileCards.tsx`, `fileKinds.tsx`, `Minibar.tsx`, `chat.css` | The chat. `FileCards.showFile()` opens a file as a doc tab when DEX can draw it, else in its app. "Open in ▾" now starts with "A tab in DEX" |
| `src/renderer/components/lib/botMood.ts`, `AgentAvatar.tsx`, `TaskAvatar.tsx`, `lib.css` | Bot moods (`moodFor`, `liveMood`, `useBotMood`) |
| `src/renderer/hub/hub.html` | The CSP (see §1.4) |

**Tests added by unify** (all under `desktop/app/tests/unit/`):
- `sessions/BrowserPool.test.ts`
- `sessions/recordedFiles.test.ts`
- `sessions/SessionManager.stuckTimer.test.ts`
- `sessions/session-schemas.test.ts`
- `workspace/{agentCursor,userActivity,documents}.test.ts`
- `logs/transcript.test.ts` (force-added)
- `hub/chat/{turns.test.ts, ChatView.spec.tsx}`
- `hub/workspace/{docs.test.ts, DocumentView.spec.tsx}`
- `components/botMood.test.ts`
- `cdpBroker.test.ts`, `cdpLease.test.ts`

**Docs:** `docs/unify/PLAN.md`, `codex-research.md`, `P0.md`, `P1-background-tabs.md` (all four are reproduced in the appendices), and `LICENSES.md` (the desktop viewers section).

## 2.3 How the pieces talk

**The agent and its tabs**

```
engine (Claude Code / Codex / BrowserCode)
  └─ runs browser-harness-js (a Bun REPL) with BU_CDP_WS = broker token URL, BU_TARGET_ID = its first tab
       └─ CDP over WebSocket → main/cdpBroker.ts
            ├─ allowlist (no Browser.*, no Target.createTarget, no foreign attach, Input.* limited)
            ├─ beforeCommand → BrowserPool.noteAgentUse(wc)   (wakes a parked tab on the stage, 6 s idle → sleep)
            │                → waitForFrame(wc) before Page.captureScreenshot
            ├─ Input.* → userActivity gate (waits while you use the page) → agentCursor glide → arrived → dispatch
            └─ webContents.debugger via cdpLease (shared, never raw attach)
```

**The agent's `dex-*` tools.** They're bash scripts, plus `.cmd` launchers on Windows. They POST JSON to DEX's local task server. The URL and token come from the control file (`DEX_CONTROL_FILE`); `dex-lib.sh` handles it.
- `dex-tab …` → `POST /dex/tab` → `BrowserPool`
- `dex-open <file> [--background]` → `POST /dex/open {sessionId, path, show}` → `documentTabs.open(id, abs, 'agent', show)`

`documentTabs` pushes `workspace:docs-changed (sessionId, docs, focusId)` to the hub. Later file rewrites push `workspace:doc-changed (sessionId, docId, mtimeMs)`.

**What the hub may read.** One rule decides which files the hub can open or read: **the task recorded it, or it's one of the task's open documents.** `sessions:read-file`, `sessions:open-file` and `workspace:doc-open` all apply it (`resolveRecordedFile` and `documentTabs.isOpen`).
- The agent can already read any file itself, so `dex-open` showing any file adds no new access to the data.
- The hub can't name arbitrary paths.
- `open-file` never runs an executable; it reveals it in its folder.

**Who owns the pane's rect.** In `AgentPane`, one surface at a time:
1. a **document tab** (`paneOverride==='doc'` and the doc still exists), else
2. **chat**: no browser, or your pick, or a finished/page-less task (`auto`), else
3. **the New-tab page** (a blank tab *you* opened), else
4. **the live page** (the native view attached at the measured rect).

For 1–3 the page view is detached from DEX's window and parked on the stage, so the agent can keep using it and screenshots still work. A new run (`status → running`) resets your pick to `auto`. `dex-open` (or a file-card click) sets `doc` for that tab.

## 2.4 Where the code differs from PLAN.md (on purpose)

| PLAN.md says | The code does | Why |
|---|---|---|
| New `WorkspaceManager.ts` + `TabPool.ts` replacing BrowserPool (§4.1) | **BrowserPool grew tabs** in place. "The session's view" is the active tab | Every existing caller kept working; less churn. If you need a manager for persistence, put it next to BrowserPool, not instead of it |
| `dex-doc://` protocol for document bytes (§4.1) | **`sessions:read-file` IPC** returning bytes; the renderer makes blob: URLs | Same allow-rule, no protocol to secure, works in dev and packaged builds alike |
| A Settings toggle "New workspace (beta)" until P2 (§5) | **No toggle.** The workspace is simply on | The owner wanted it as the default |
| `ActivityStrip.tsx` under the page (§3.1) | A chip in the toolbar ("DEX is working — you can use the page too" + Pause) and a glow around the page | Takes no vertical space |
| PreviewDeck folded into New tab (§4.3) | The **chat** replaced the deck as the default surface (§3.12). `PreviewDeck.tsx` still provides `ConfirmationCard`/`getPendingConfirmations` (approval cards in the pane header) | The chat is where outputs, progress and sources live now |
| Document viewer per the table (§3.9) | All but **.blend** and **.pptx**; no page-thumbnail rail; no virtualised grid (capped table instead) | Listed in §3.1 |

---

# Part 3 — What to do, in order

Each item has **Do**, **Where**, **Done when**. Write the tests listed. Run `tsc`, `vitest` and `eslint` (touched files) before each commit.

## 3.0 Verify P2 live (do this first)

P2 is unit-tested (DocumentTabs with real files and the watcher; kinds; sheet capping; DocumentView rendering, links, zoom, reload; the WorkspaceBar doc tabs). It has **not** run in the real app yet: the owner was using DEX at hand-over. Things only a live run proves:
- the Vite build of pdf.js's worker (`?url`);
- model-viewer's ESM import;
- the CSP;
- docx-preview's styles in the hub;
- the stage hand-off when a doc takes the rect.

**Steps:**
1. Make sure the owner isn't using DEX (§1.2). Quit the installed DEX, kill stale `bun`, and start dev with `AGB_CDP_PORT=9222` (§1.3).
2. Start a short **Claude Code** task in DEX (not Codex; see §1.4). For example:

   > Make three files in your outputs folder: `notes.md` (a heading, two subheadings, a link to https://example.com and a table), `data.csv` (20 rows, 4 columns), and download https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf. Record each with `dex-state file` and show each to me with `dex-open`. Then append a line to notes.md.

3. Check, with CDP screenshots of the `Hub` target:
   - [ ] Each `dex-open` adds a doc tab after **Chat**, and the newest comes to the front.
   - [ ] **Markdown** renders, and the outline button lists the headings. Clicking the example.com link opens a **web tab**; the hub doesn't navigate.
   - [ ] **CSV** shows a grid with A/B/C… headers and row numbers.
   - [ ] **PDF** shows pages with selectable text (drag-select works). If the page is blank, check the devtools console of the hub for a **worker** or **CSP** error: the fix is in `hub.html` or `PdfView.tsx`'s `workerUrl` import.
   - [ ] When the agent appends to notes.md, the tab **reloads by itself** and keeps the scroll position.
   - [ ] Switching between a doc tab, Chat and the web tab works. While a doc is in front, the **page view is gone** from the rect, and comes back on the web tab.
   - [ ] **Ctrl+W** with a doc in front closes the doc (not the web tab). Middle-click and × close a doc tab.
   - [ ] Clicking a **file card** in the chat opens it as a tab. "Open in ▾ → Default app" still opens Word/Excel.
   - [ ] A **chat screenshot** (if the task took one) now shows. It loads through `readFile`, no longer `file://`.
   - [ ] **DOCX:** ask the agent to make a .docx with python-docx, including a tracked change if it can. It renders as pages, and **Changes** toggles redlines.
   - [ ] **GLB:** any .glb (`dex-3d` makes them) orbits in the tab.
   - [ ] **Performance** (PLAN P2 "done when"): a 20-page .docx opens in **< 500 ms** (time from the tab click to the first page painted). Note the number in `docs/unify/P2.md`.
4. Write `docs/unify/P2.md` with the results (copy P1-background-tabs.md's style: a measurements table, then decisions). Fix what fails. Commit.

## 3.1 Finish P2

1. **New-tab page: the Tools row** (PLAN §3.6).
   - **Do:** a row of tool tiles on `NewTabPage`:
     - **Files** (Ctrl+P): quick-open over the task's files and outputs, opening each as a doc tab;
     - **Terminal** (Ctrl+`): `TerminalPane`;
     - **Logs** (opens the Logs window);
     - **Review** (Ctrl+Shift+G): the files the task created or changed;
     - **Connections**: the task's MCP servers and accounts (the same data `hub/SettingsPane.tsx` lists).
     - Read it the way SettingsPane does; don't duplicate the config parsing.
   - **Done when:** each tile works and each shortcut fires while the hub has focus.
   - **Test:** a NewTabPage spec.
2. **Logs window file rows open a doc tab.**
   - **Do:** in `src/renderer/logs/`, a file row calls a new IPC that focuses the hub on that task and runs `workspace:doc-open`. Main has to bring the shell window forward and tell the hub which session to select: look at how `dex:focus-composer` is dispatched for a pattern.
3. **.blend.**
   - **Do:** show `scene_preview.py`'s render plus the `scene.glb` beside it, the way the phone does. See `src/main/threed/` and the Android 3D viewer.
   - **Where:** a new `BlendView.tsx`, with `viewerFor('x.blend') → 'blend'`.
   - The render and glb must be **recorded files** (or open docs), or `readFile` refuses them. Open them through `documentTabs.open` in main, not from the renderer.
4. **.pptx.**
   - **Do:** for now, the fallback card with "Open in PowerPoint", which already happens via `viewerFor → 'none'`. Optional: if LibreOffice is installed (`soffice --headless --convert-to pdf`), convert to a temp PDF in main, open *that* as the doc, and label the tab with the .pptx name.
5. **Document polish** (PLAN §3.9):
   - a **page-thumbnail rail** for PDF and DOCX (small canvases or scaled clones; click to jump);
   - **"Download"**: a copy via `openFile(…,'copy')`, already in the chat menu, now also in the doc bar;
   - **syntax colours** for code in `TextView`. Use a small highlighter with an MIT/BSD licence, and add it to `LICENSES.md`;
   - a **virtualised grid** for sheets past ~2,000 rows, replacing the cap note.
6. **Restore doc tabs** when the task is reopened after a restart. This goes with tab persistence in §3.2: persist `{path, openedBy}` per task and re-open on load, skipping missing files.

## 3.2 P1 leftovers

1. **One web profile `persist:dex-web`, plus a one-time cookie migration** (PLAN §4.1; P0 #9 proved the copy: 20/20 cookies with flags).
   - **Do:**
     - every tab's `WebContentsView` uses `session.fromPartition('persist:dex-web')`;
     - on first run, copy cookies from `session.defaultSession` (`cookies.get({})` then `cookies.set` with the same flags; skip `__Host-` when the path isn't `/`);
     - keep DEX's own windows on the default session;
     - move the UA cleaning and `navigator.webdriver` hiding to the new session.
   - **Careful:**
     - `cdpBroker`, `agentCursor` and the chrome-import code may assume the default session: grep `defaultSession` and `session.` in `src/main`;
     - anything that reads page cookies must point at the new session: DEX's cookie browser (`renderer/shared/CookieBrowser.ts`), `chrome-import/`, the login-memory tools. Site memory itself is files (`DEX_SITE_MEMORY_DIR`, a `site-memory/` folder next to the harness dir), so it's unaffected;
     - P3 (extensions) loads into this session, so do this first.
   - **Done when:** after an upgrade you're still logged in to sites; extensions can't touch the hub.
   - **Test:** a unit test of the migration (mock `cookies`).
2. **Tab persistence** (PLAN §3.2).
   - **Do:**
     - a `workspace_tabs` table in `sessions.db`: `session_id, tab_id, url, title, opened_by, kept, position, active, kind, file_path`;
     - write on tab changes (debounced);
     - on reopening a task, restore its tabs **unloaded** (title and favicon only); each loads on first view.
     - Doc tabs too (§3.1 #6).
   - **Where:** next to `SessionManager`'s DB code (better-sqlite3; see the "unbatched, recompiled synchronous SQLite" fix in history `febc7839` before you write queries: prepare once, batch in a transaction).
3. **Guards while DEX drives** (PLAN §3.4, Codex's own guards in Appendix B).
   - **Downloads:**
     - `session.on('will-download')`: while the task is `running`, ask through the approval system (`src/main/approvals/`) unless the task has allowed it;
     - downloads the user starts while no agent input happened in the last ~2 s go through silently;
     - record finished downloads as task files (`file_output`) so they show in the chat and can be opened as tabs.
   - **Site policy:** "Always ask / Auto approve / Always allow" per site, per task (persist like approvals), checked in `will-navigate` / `setWindowOpenHandler` when the navigation came from agent input. Keep it simple: start with a policy only for **new origins**.
   - **Password fields:** in the broker, refuse `Runtime.evaluate` / `DOM.getAttributes` results that read `value` of a focused `input[type=password]`, and blank such fields in the agent's screenshots. Simplest robust version: before `Page.captureScreenshot`, inject `-webkit-text-security`/blur on password inputs in the isolated world (as the cursor hiding does), restore after.
   - **Tests:** each guard as unit tests on the broker hooks.
4. **Address-bar suggestions** (PLAN §3.3).
   - **Do:** a dropdown under the address input with history (a `visits` table: url, title, last, count), site-memory hosts (the folders in `DEX_SITE_MEMORY_DIR`), the task's tabs, and "Search for …".
   - **Careful:** the dropdown is renderer DOM, and the native page sits **above** all DOM. While the dropdown is open, either keep it inside the toolbar's height (a horizontal strip), or **park the page on the stage** while it's open, as the chat does (cheap; the page comes back on blur).
5. **The ⋯ menu:**
   - Find in page (`webContents.findInPage` + `found-in-page`, with a small find bar in the toolbar);
   - Zoom (`setZoomFactor` per tab);
   - Print (`webContents.print`);
   - Open in your browser (`shell.openExternal`);
   - Copy link;
   - Developer tools (`openDevTools({mode:'detach'})`);
   - Clear site data (`session.clearStorageData({origin})`).
   - The same DOM-over-native-view issue as #4; same fix.
6. **Ctrl+Shift+T** reopens the last closed tab: keep a short per-task stack of `{url, openedBy}` in BrowserPool.
7. **"The user changed the page" signal for the engine** (PLAN §6 "races").
   - **Do:** when `userActivity` sees real input in a tab the agent is driving, stamp it.
   - On the agent's next CDP `Input.*` or screenshot, the broker adds a one-line notice to the session output ("You used the page since DEX's last look"), which the engines surface. Today `tabs.md` only *tells* the agent to re-read after surprises.

## 3.3 P3 — Extensions

**Read first:** PLAN §3.8 and §4.4 (Appendix A), and P0 #2–#5 (Appendix C).
- Native `loadExtension` works.
- `electron-chrome-web-store` (**MIT**) installs from the Web Store.
- A **service-worker preload shim** gives MV3 extensions the `chrome.tabs`, `windows` and `proxy` APIs Electron lacks; an extension's `proxy.settings.set` really applied.
- **Do not** bundle `electron-chrome-extensions`: it's GPL-3.0, and DEX is MIT with an audited `LICENSES.md`.

**Acceptance targets, in order:**
1. **Dark Reader**: already works with no shim (P0).
2. **uBlock Origin Lite**: crashes today on `chrome.tabs.onRemoved` / windows. The shim fixes it.
3. **VIT Vellore Library 3.2.57**: the owner is a VIT student, and it routes journal sites through the library proxy. It needs:
   - `proxy.settings.get/set/clear`;
   - `webRequest.onAuthRequired` (proxy login);
   - `tabs.query/create/update/get/sendMessage` and all six `tabs.on*` events;
   - `windows.onFocusChanged`;
   - `action.setIcon/setPopup/enable/disable`;
   - `notifications.create`, `alarms`, `scripting.executeScript`;
   - `webNavigation.onBeforeNavigate`, `storage.session`, `storage.onChanged`.

   This one is the real test.
4. Then Bitwarden, Grammarly, Google Translate and React DevTools. List each as works / partial / unsupported, with the reason, in `docs/unify/P3.md`.

**Build steps:**
1. **Session.** Extensions live only in `persist:dex-web` (§3.2 #1 first). Load the installed ones at startup from `userData/extensions/<id>/<version>`.
2. **Install.**
   - Wire `electron-chrome-web-store` on that session. "Add to Chrome" on `chromewebstore.google.com` then works, and updates are checked.
   - Hide the "Switch to Chrome?" banner with an injected style on that host (P0 #4).
   - Also offer **install by ID** and **load unpacked** from the Extensions page.
3. **The MIT shim** (`src/main/workspace/extensions/shim.ts` + `preload-sw.ts`):
   - `session.registerPreloadScript({ type: 'service-worker', filePath })` and `{ type: 'frame' }` for extension pages.
   - In the preload, `contextBridge.executeInMainWorld` defines the missing `chrome.*` APIs, each an RPC over `ServiceWorkerMain.ipc` (frames: `ipcRenderer`) to main.
   - Map onto BrowserPool:
     - `tabs.*` (query/get/create/update/remove/sendMessage + the six events): **ids must be stable integers**, so keep a map from tab id string to int;
     - `windows.*` (one "window" per task, or one for the hub; pick one model and document it);
     - `proxy.settings` → `session.setProxy` (and `clear` restores direct);
     - `webRequest.onAuthRequired` → `app.on('login')` / `session.on('login')` for proxy auth;
     - `action.*` → the 🧩 area state;
     - `notifications` → Electron `Notification`;
     - `alarms` → timers persisted in `storage`;
     - `webNavigation` → `did-start-navigation`.
   - The P0 spike's code is **not in the repo** (scripts lived outside it). Rebuild from the description in Appendix C. It's small.
4. **UI:**
   - a 🧩 button in the toolbar; pinned extension icons with badges;
   - **popups** as a small frameless `WebContentsView` anchored under the button, in the `persist:dex-web` session, loading `chrome-extension://<id>/<popup>`;
   - **an Extensions page** (a hub route or a doc-like surface): icon, name, version, on/off, pin, remove, site access, "load unpacked", "install by ID".
5. **The agent.** It can open an extension popup as a tab (`chrome-extension://…`), so the broker must allow the agent to attach to it as one of its task's tabs. **Check the broker allowlist doesn't let the agent reach other extensions' background pages.**
6. **Security review before shipping:**
   - extensions run with the user's logged-in profile. They're **off in DEX's own windows**, since the hub uses the default session;
   - no extension may reach `file://` unless the user ticks "allow file access";
   - the shim's RPC validates every argument (zod), since extension code is untrusted.
7. **Tests:**
   - the shim's API mapping as unit tests (fake BrowserPool);
   - an integration test that loads a tiny MV3 extension from `tests/fixtures/` and calls `chrome.tabs.query` from its worker. Skip it on CI if Electron can't launch there; see how existing e2e tests launch.

## 3.4 P4 — Annotate, Request edits, @-mention a tab, side chat

PLAN §3.7, plus Codex's note format in Appendix B. The format matters: the models already handle it well.
1. **Annotate** (web or doc tab):
   1. Freeze a capture: web via CDP `Page.captureScreenshot` through `withDebugger` (not `capturePage`, which returns stale frames); docs via the canvas or DOM snapshot.
   2. An overlay editor in the renderer (box, arrow, pen, text).
   3. **Send to DEX** attaches the image and a note block to a follow-up, using the composer's existing attachments path.
2. **Note block format.** One per note:
   - `Page URL:`, `Frame:`, `Target:` (text), `Target role:`, `Target selector:`, `Area rectangle:`, `Selected text:` / `Nearby text:`;
   - for docs: `Artifact path:`, `PDF page:`;
   - then the screenshot reference, then `Comment:` and the user's words.

   Several notes batch into one follow-up.
3. **The in-page picker** (element / region / text): an isolated-world overlay like `agentCursor.ts`.
4. **Request edits** (doc tab):
   - select text → "Ask DEX to change this";
   - the composer opens prefilled with the quote, the file and the location (PDF page or DOCX heading/paragraph index; you have the outline items);
   - DEX edits the file (python-docx etc.);
   - the tab reloads by itself (done in P2); add an "Updated by DEX" toast on `workspace:doc-changed`.
5. **@-mention a tab** in the composer. The mention list includes the task's tabs; picking one makes it the agent's target for the next turn. Tell the agent in the follow-up text: "The user means tab t3 (targetId …)".
6. **Side chat** (Ctrl+Alt+S): the chat docked on the right of the page instead of as a tab. The native view's rect shrinks; ChatView is already a self-contained component.

**Done when:** an annotated screenshot and a doc edit request each round-trip into a task, and the doc updates in place.

## 3.5 P5 — Polish

- **Split** (two tabs side by side; native view plus DOM surface, or two native views) and **maximize** (hide the sidebar).
- Drag to reorder tabs; tab tooltips; memory badges (`resourceMonitor` exists).
- An interactive terminal (`node-pty` is already a dependency).
- Light-theme pass of the new surfaces.
- **Accessibility:** roles exist on tabs; add keyboard tab switching in the strip and focus rings everywhere.
- **Phone:** list the task's tabs on Android with an "Open on PC" action, via the existing Firebase bridge. **Free plan only, no keys pushed.**

## 3.6 Known issues to fix along the way

- **Codex and the owner's default model** (§1.4).
  - **Fix in DEX:** when the user picked no model and the engine is Codex, read the effective model DEX would get. Or pass `-m` with the first of `selectableModels` when Codex's config names a model the ChatGPT-account mode rejects.
  - At least, surface the error in the chat in plain words ("Your Codex config asks for gpt-6-luna, which ChatGPT sign-in can't use. Pick a model above.").
  - **Never edit `~/.codex/config.toml`.**
- **`AgentPane.tsx` has old unused code** (lint warnings: `OutputRow`, `OutputIcon`, `CopyIcon`, `TerminalPane` import…). That's leftover from the pre-chat deck. Remove it when you're next in there, in its own commit.
- **HTML documents** are drawn with scripts off (sandbox). A user may expect a running page: offer "Open as a web tab" in the doc bar for .html. That needs a `file://` web tab, so check the address bar's refusal of `file:` and allow it **only** for paths the task recorded.
- **`gltf` with external buffers** can't render from one file's bytes (`ModelView` says so). If it matters, have main serve the folder via a scoped custom protocol.
- **Big files:** `sessions:read-file` sends the whole file over IPC (≤ 80 MB). For video, a streaming custom protocol (`protocol.handle` with range requests) would start playback faster. Add it only if it's a real problem.

---

# Part 4 — The Android app (if you touch it)

`android/` holds a Jetpack Compose app (material3 `1.5.0-alpha29`, M3 Expressive), package `com.chethan616.dex`. It pairs with the PC over the Firebase bridge.

**State at hand-over:** **1.0.25** (versionCode 26).
- It's published as `DEX-android-1.0.25.apk` on the GitHub release **v3.2.0** (desktop 3.2.0), which is `releases/latest`.
- The app updates itself from GitHub Releases, like the desktop:
  - `update/ReleaseChecker.kt` reads `releases/latest` and looks for an asset named `DEX-android-<version>.apk`;
  - `update/AppUpdater.kt` downloads it inside the app, checks it's DEX at that version and signed with the same key, then opens Android's installer (`REQUEST_INSTALL_PACKAGES`; the FileProvider `updates/` path);
  - Settings › Updates and Home's banner both show it (`update/UpdateUi.kt`).
- **Asset naming matters:** a release without a correctly named APK means phones never see the update.
- Recent work:
  - bot moods everywhere (`ui/avatar/BotAvatar.kt`, `BotMoods.kt`, `TaskBot.kt`);
  - an expressive send button (`ui/components/SendButton.kt`);
  - a compact agent picker (`ui/components/AgentPicker.kt`);
  - slide-only screen transitions (`DexRoot.kt`) and the bot flight between Home and a chat (`ui/avatar/BotFlight.kt`);
  - touch physics (`ui/components/Physics.kt`: `springPress`, `springDrag`);
  - a fluidity pass and a baseline profile (`app/src/main/baseline-prof.txt`). Keep both: see the fluidity rule in §1.2.

**Release (Android only, no new tag):**
1. Bump `versionCode` / `versionName` in `android/app/build.gradle.kts`.
2. `cd android && ./gradlew :app:assembleRelease`. Signing comes from `~/.gradle/gradle.properties` `DEX_RELEASE_*`. **Never print or commit those.**
3. Verify:
   - `apksigner verify --print-certs`: the cert SHA-256 starts `2f727fa5`;
   - `zipalign -c -P 16 4`;
   - `aapt2 dump badging` shows the new version.

   The SDK is at `D:\Android\Sdk`; build-tools are under `D:/Android/Sdk/build-tools/<ver>/`.
4. Copy the APK to `android/release/DEX-android-<ver>.apk` (gitignored).
5. `gh release upload <latest tag, e.g. v3.2.0> android/release/DEX-android-<ver>.apk`. Check the asset's sha256 digest equals the local file (`gh release view <latest tag, e.g. v3.2.0> --json assets`).
6. `gh release delete-asset <latest tag, e.g. v3.2.0> DEX-android-<old>.apk -y`.
7. Update the notes line that names the APK: `gh release view --json body` → edit → `gh release edit <latest tag, e.g. v3.2.0> --notes-file …`.

**Screenshots without a phone (Robolectric):**
1. Add temporarily: `testImplementation("org.robolectric:robolectric:4.17")`, the compose BOM, `ui-test-junit4`, `debugImplementation ui-test-manifest`, and `testOptions.unitTests.isIncludeAndroidResources = true`.
2. Test class annotations: `@GraphicsMode(NATIVE)` and `@Config(sdk=[34], qualifiers="w411dp-h914dp-xxhdpi", application=android.app.Application::class)`.
3. Wrap the content in `DexTheme(..., dynamicColor=false)`. Use **one `setContent` per rule** (switch theme with a `mutableStateOf`). Set `mainClock.autoAdvance=false` + `advanceTimeBy`.
4. Capture with `onRoot().captureToImage()`.
5. **Revert** the Gradle changes and delete the test afterwards.

**The phone over adb:** a OnePlus with laggy input. Screenshot after every tap; coordinates are ×3 from a 413-wide preview. Don't tap while the owner uses it (§1.2).

---

The rest of this file is the plan, the research and the measurements, **verbatim** from `docs/unify/`. The plan's §5 phases and §8 tests are the spec. The research explains *why* each choice was made. Where Part 3 above is more specific than the plan, Part 3 wins: it reflects what was learned while building P0–P2.

---

# Appendix A — The entire plan

*Verbatim copy of `docs/unify/PLAN.md` at hand-over. Relative links inside it point into `docs/unify/`. If you change the plan, edit `docs/unify/PLAN.md` and refresh this appendix.*

<!-- appendix start -->

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

<!-- appendix end -->

---

# Appendix B — The entire research: how the Codex desktop app builds its in-app browser

*Verbatim copy of `docs/unify/codex-research.md` at hand-over. Relative links inside it point into `docs/unify/`. If you change the plan, edit `docs/unify/codex-research.md` and refresh this appendix.*

<!-- appendix start -->

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

<!-- appendix end -->

---

# Appendix C — P0 measurements and spikes

*Verbatim copy of `docs/unify/P0.md` at hand-over. Relative links inside it point into `docs/unify/`. If you change the plan, edit `docs/unify/P0.md` and refresh this appendix.*

<!-- appendix start -->

# Unify P0 — measurements and spikes

Run on 2026-09-29/30 on the development laptop (Windows 11, 165 Hz panel, 16 GB, RX 6800M), with DEX's own Electron **41.2.1** (Chromium 146). Each spike ran as a standalone script against `desktop/app/node_modules/electron`, with its own userData and no DEX code, unless noted. Scripts live outside the repo; the results are recorded here.

## Results

| # | Question | Result | Decision |
|---|---|---|---|
| 1 | Is the in-page agent cursor viable? (closed shadow root in an isolated world, `adoptedStyleSheets`, `pointer-events:none`) | ✅ Injected on github.com, google.com and vtop.vit.ac.in with **no CSP errors**. `elementFromPoint` under the cursor returns the page, so clicks pass through | Use it (PLAN §3.5) |
| 2 | Native `session.extensions.loadExtension`, MV3 | ✅ Its content script ran | Base of P3 |
| 3 | Chrome Web Store install (`electron-chrome-web-store`, MIT) | ✅ Dark Reader installed in 1.1 s and restyles pages. uBlock Origin Lite and **VIT Vellore Library** 3.2.57 installed, but their service workers crash on missing APIs | Use it; add the shim (#5) |
| 4 | The store page's "Switch to Chrome?" | It's a **dismissible banner**; the **Add to Chrome** button is still there. It shows even with Chrome's own client-hint brands, so it isn't brand sniffing we can simply fake | Hide the banner with an injected style on `chromewebstore.google.com`. Installing by ID (address bar or Extensions page) bypasses the page entirely |
| 5 | Can a **service-worker preload** give extensions the missing APIs? (`session.registerPreloadScript({type:'service-worker'})` + `contextBridge.executeInMainWorld` + `ServiceWorkerMain.ipc`) | ✅ Yes (table below). An extension calling `chrome.proxy.settings.set` really **changed the session's proxy** (`resolveProxy` → `PROXY 10.0.0.1:3128`) | MIT shim, no GPL dependency (PLAN §4.4) |
| 6 | Rendering: today's 1440-px emulation + zoom vs native size (github.com/electron/electron, 1100×760, 4 s rAF scroll) | **No difference**: both 165 fps, p95 6.2 ms, 0 slow frames. Emulation lays the page out at 1705×1066 CSS px and scales it down, which costs **sharpness**, not frames | Native size for crisp text (P1). Look elsewhere for the lag, below |
| 7 | `<webview>` with an app-DOM overlay | The overlay passes hit-testing (`elementFromPoint` → WEBVIEW). A click synthesized with `sendInputEvent` on the host did **not** reach the guest page. Scroll perf equals WebContentsView | Stay on `WebContentsView` (PLAN §4.3). The test-automation story is worse with `<webview>` |
| 8 | `window.open` / `target=_blank` as a tab (`setWindowOpenHandler` → `createWindow` → `new WebContentsView({ webContents })`) | ✅ It opened as a tab with **no stray window**, and `window.opener` was kept (OAuth popups work) | P1 |
| 9 | Moving cookies to a dedicated `persist:dex-web` profile | ✅ 20/20 copied, with `httpOnly`/`secure`/`sameSite` kept | P1, a one-time migration |
| 10 | The open debugging port | Fixed ahead of P1 in `f675a5f4` (`cdpBroker.ts`): no port by default, a token link per task, and `Browser.*` / foreign targets refused | Done |

### Extension APIs: stock Electron 41 vs with the shim

Probed from inside an MV3 service worker:

| API | Stock Electron | With the DEX shim |
|---|---|---|
| `chrome.tabs.onRemoved/onActivated` | exists | exists |
| `chrome.tabs.query({})` | **`[]`** (knows no tabs) | DEX's workspace tabs |
| `chrome.windows.*` | **undefined → crash** | works |
| `chrome.proxy.settings.get/set` | **undefined → crash** | works, and applied via `session.setProxy` |
| `chrome.storage.onChanged`, `storage.session` | exists | exists |

### What VIT Vellore Library needs

It's a real target: the user is a VIT student, and it routes journal sites through the library's proxy.
- `proxy.settings.get/set/clear`
- `webRequest.onAuthRequired` (proxy login)
- `tabs.query/create/update/get/sendMessage` and all six `tabs.on*` events
- `windows.onFocusChanged`
- `action.setIcon/setPopup/enable/disable`
- `notifications.create`, `alarms`, `scripting.executeScript`
- `webNavigation.onBeforeNavigate`, `storage.session`, `storage.onChanged`

This is the P3 acceptance test, together with uBlock Origin Lite and Dark Reader.

## Where the "lag" actually is

Frames are identical (#6), so the slowness people feel in DEX's browser comes from:
- **Background throttling.** A task's view runs at **4 fps** while not shown and **1 fps** when idle (`BrowserPool` `THROTTLED_FRAME_RATE` / `IDLE_FRAME_RATE`). It is also **frozen** after 15 s idle (`Page.setWebLifecycleState`). Opening a task that worked in the background shows a stale page until it wakes.
- **The blocking overlay.** `takeoverOverlay.ts` stacks a second, continuously animating `WebContentsView` above the page, and it eats every click and scroll.
- **The agent's own cadence.** Most "slowness" is the time between actions: screenshot, think, act. Codex's browser API batches actions and prefers accessibility snapshots, and its cursor animates *while* the click waits (the arrival handshake), so motion never lags behind effect.

P1 addresses each:
- visible tabs never throttle, and the agent's hidden tabs throttle only when no task is running on them;
- no overlay view;
- the arrival-handshake cursor;
- harness helpers that batch (click-and-wait, type-and-submit) (PLAN §4.2).

<!-- appendix end -->

---

# Appendix D — P1: tabs off your screen, the stage

*Verbatim copy of `docs/unify/P1-background-tabs.md` at hand-over. Relative links inside it point into `docs/unify/`. If you change the plan, edit `docs/unify/P1-background-tabs.md` and refresh this appendix.*

<!-- appendix start -->

# P1 — Tabs off your screen: the stage

**Problem.** A web view that isn't in any window has nowhere to draw, so
Chromium never paints it. DEX removed the view of every tab you weren't looking
at from its window: a background tab, the tab you switched away from, every
task you weren't viewing, and all of them while DEX sat in the tray. For those,
`Page.captureScreenshot` **hangs**. The page also runs as a hidden tab (no
animation frames, so lazy-loading and rAF-driven UIs stall). Clicks still land,
so the agent could act but couldn't see.

That was true before unify for a task run from the phone with DEX closed.
`dex-tab new` (background tabs) would have hit it on every use.

## Measurements (Electron 41.2.1, Windows 11, 2026-09-30)

Page screenshot via CDP (`Page.captureScreenshot`), 3–5 tries each, 3–4 s timeout:

| Where the view is | Screenshot | rAF/s | Notes |
|---|---|---|---|
| On screen | ok, 120–350 ms | 165 | |
| Removed from the window (DEX until now) | **timeout, every time** | 1 | also with emulation on, `fromSurface:false`, `captureBeyondViewport` |
| Never added to any window | **timeout**; lays out **0×0** | 1 | |
| In the window, hidden (`setVisible(false)`) | ok 250 ms… | 1 | …then **timeouts** once the window is occluded |
| `capturePage({stayHidden})` of a removed view | "display surface not available" | — | Needs a view that has been shown once |
| **On the stage, hidden; shown while the agent uses it** | **ok, fresh, 95–140 ms** | 1 idle / 165 busy | 11/11 live e2e below |

Occlusion matters: Windows' native occlusion tracking marks an off-screen or
covered window as hidden, and then even views that were shown before stop
producing frames. With `CalculateNativeWinOcclusion` disabled, an off-screen
window counts as visible and its hidden views stay capturable.

Freshness (the page changes colour, then capture): a single `capturePage` of a
hidden view returned the **previous** frame 3–7 times in 10. That's why DEX
doesn't serve screenshots of sleeping tabs from `capturePage`. It shows the
tab on the stage, waits two frames (≤ 200 ms) and lets CDP capture as usual:
10/10 fresh, and every CDP option (clip, `captureBeyondViewport`, webp) keeps
working.

## Design

- `src/main/workspace/stage.ts` provides the stage, a `BaseWindow`:
  - it sits at (−32000, −32000); Windows clamps it to about −26000;
  - it's shown inactive, never focusable, and has no taskbar button;
  - `type:'toolbar'` keeps it out of Alt+Tab;
  - being a `BaseWindow`, it isn't in `BrowserWindow.getAllWindows()`, so DEX's
    "is any window open?" checks don't see it;
  - it exists on Windows only (macOS keeps windows on screen), and
    `DEX_STAGE=0` turns it off.
- `BrowserPool` gives every tab a place: `screen` (DEX's window), `stage`, or
  `none` (no stage).
  - A new tab is born on the stage at the pane's size. It is laid out while
    shown, then hidden, because a view hidden before its first layout stays 0×0.
  - Switching tabs, detaching a task, a hub menu (`temporarilyDetachAll`), and
    DEX going to the tray or minimizing all park the front tab on the stage.
    Coming back puts it on screen again.
- The broker's `beforeCommand` calls `browserPool.noteAgentUse(wc)`.
  - A parked tab the agent touches is shown on the stage and goes back to
    sleep 6 s after its last command.
  - If a screenshot is what woke it, the hook waits for a frame first.
- `index.ts` disables `CalculateNativeWinOcclusion` on Windows. The cost: DEX's
  own window keeps drawing its animations while another app covers it.
  Hidden views still sleep.

## Live e2e (real harness REPL → broker → BrowserPool → stage)

`$TEMP/broker-e2e/stage-e2e.cjs`, 11/11:

- the stage isn't one of DEX's windows;
- both tabs are reachable through the broker;
- a background tab lays out at the pane's size (1000×700);
- a screenshot of a tab that was never on screen: fresh, 115 ms;
- again: fresh, 94 ms;
- after the tab went back to sleep, the next screenshot wakes it: fresh, 114 ms;
- `document.visibilityState` is `visible` while the agent uses it;
- a click in a background tab lands;
- the tab you switched away from: fresh, 114 ms;
- with DEX in the tray, the task's page: fresh, 121 ms;
- back on screen afterwards: fresh, 119 ms.

<!-- appendix end -->
