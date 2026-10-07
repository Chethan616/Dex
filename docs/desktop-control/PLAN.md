# Plan: DEX controls Windows apps and the OS in the background

Written 2026-10-06 for the `unify` branch.

- The evidence behind every decision is in [`RESEARCH.md`](RESEARCH.md). The
  marks [V], [V-local], [L] and [U] mean what they mean there.
- Paths are under `desktop/app/` unless they start with `docs/` or the repo
  root.
- House rules from `TO_BE_DONE.md` §1.2 apply throughout:
  - comments say *why*;
  - tests are named as behaviour sentences;
  - user-facing text is short, warm and concrete;
  - yarn, not npm;
  - don't run `graphify update`;
  - never commit `UI/`, `install-id.json` or `package-lock.json`.

---

## 0. The contract (non-negotiable)

**The user keeps their PC while DEX works.**

1. **DEX never takes the user's hands.** No `SendInput`, `SendKeys`,
   pyautogui, `SetForegroundWindow`, `SetFocus` or cursor moves, and no
   windows popping up in front. The only exception is the user lending them
   explicitly (Phase 4).
   - Every UIA client sets `IUIAutomation2.AutoSetFocus = FALSE`. With UIA's
     default setting, a background window steals the foreground [V-local].
2. **Use the most structured interface first:**
   1. an OS API (PowerShell, CIM, netsh, pnputil, `SystemParametersInfo`);
   2. an app or media API (SMTC);
   3. UIA patterns on a background window;
   4. only then ask to borrow input.
3. **DEX moves only windows it opened.** It acts on the user's own windows in
   place, through patterns. It never moves, minimizes or closes them without
   asking.
4. **Every change has a tier.**
   - Destructive and admin changes always ask, and only for that one action.
   - Every change is recorded in an undo journal before it runs.
5. **DEX never drives these:**
   - itself;
   - password managers;
   - security or privacy settings;
   - elevated (admin) windows;
   - the lock screen;
   - other AI agent apps.

   It never reads or types into password fields.

---

## 1. Architecture

```
engine (Claude Code / Codex / BrowserCode)  ── the planner: its own model, AGENTS.md, dex-tools/desktop.md
  │   (Phase 4, optional) "desk-operator" subagent on a small model, Claude Code only (--agents)
  │
  ├─ MCP stdio: mcp__windows__*
  │     mcp-servers/windows/server.mjs   Electron's Node (ELECTRON_RUN_AS_NODE=1), no dependencies
  │       ├─ policy.mjs     tier + category per call, blocklist, "never DEX itself"
  │       ├─ POST /dex/confirm        approval card (hub + phone), blocks until answered
  │       ├─ POST /dex/desktop-gate   "hold" while the user paused or took over a window
  │       ├─ POST /dex/screenshot     captures land on the task ledger (cards, chat, phone)
  │       ├─ POST /dex/desktop-event  focus incidents, parked/taken-over windows
  │       └─ host: powershell.exe -NoProfile -NonInteractive -Mta -File host.ps1   (JSON lines on stdio)
  │             ├─ DexDesk.cs (compiled once by Add-Type, cached DLL)
  │             │     UIA3 via Interop.UIAutomationClient (MIT), AutoSetFocus=0, timeouts
  │             │     Win32: window list, launch-without-activation, parking, PrintWindow,
  │             │            focus sentinel, SystemParametersInfo
  │             └─ PowerShell: SMTC (WinRT), NetTCPIP/NetAdapter cmdlets, netsh/pnputil parsing, event logs
  │
main process (src/main/index.ts)
  ├─ approvals/policy.ts         new categories: app-control, system-change, system-destructive, elevation
  ├─ desktop/deskState.ts (new)  per-session hold flag, parked windows, incidents
  └─ (Phase 2) desktop/journal.ts  undo journal; elevated batch runner
hub
  ├─ ConfirmationCard: tier badge, "once" only for destructive/admin, real-pointer guard
  └─ (Phase 3) Desk tab: live frames of the window DEX is in, highlight, Pause / Show me / Hand back
phone (Firebase bridge): approvals already flow; (Phase 3) tier-aware notifications and desk thumbnails
```

**Why an MCP server, and not more `dex-*` CLI tools**
- **Typed schemas.** Tool results can carry images.
- **One long-lived host per engine turn,** instead of a PowerShell start-up
  (0.3–1 s) on every call.
- **All three engines reach it.**
  - Claude Code reads it through `--mcp-config`.
  - Codex and BrowserCode reach it through `mcp-servers/launch.mjs`.
  - `src/main/hl/engines/services.ts` already wires both.
- **Precedent.** The Blender server is the model for a per-task background
  helper copied out of `app.asar` (`mcp-servers/blender/server.mjs`,
  `hostScript()`).

**Why a PowerShell + C# host, and not a native Node addon**
- **Nothing to install.** Windows PowerShell 5.1 and .NET Framework ship with
  Windows.
- **No yarn.lock churn and no prebuilt binaries.** Both are gotchas in
  TO_BE_DONE §1.4.
- **Measured** [V-local]:
  - compile and load in about 0.2 s;
  - first UIA call about 0.85 s after a cold start;
  - tree walks in tens of ms.
- **Fallback** if `Add-Type` is blocked (AMSI, Constrained Language Mode): a
  precompiled .NET Framework helper exe built in CI. Evaluate Terminator's
  Node bindings in spike S9.

---

## 2. Safety model

### 2.1 Tiers → approval categories

| Tier | What | Examples | `policy.ts` category | Full access | Approve for me | Ask | Lifetimes offered |
|---|---|---|---|---|---|---|---|
| T0 Observe | Reading | Window list, UIA tree, capture of a non-blocked window, `system_info`, SMTC status | none | silent | silent | silent | — |
| T1 App control | Acting inside an app the user named or DEX opened | UIA invoke/set/toggle/select; launch an app; media play/pause/shuffle | `app-control` | silent | silent (card on first use of each app, owner decision Q2) | card | once / turn / session |
| T2 Reversible system change | Journaled with an exact undo | DNS flush; Wi-Fi reconnect; a touchpad setting; restart Explorer (visible) | `system-change` (`registry-write` for registry values, which stays always-ask) | silent (owner decision Q2) | card | card | once / turn / session |
| T3 Destructive or hard to reverse | Backup + restore point first | Uninstall; driver remove or reinstall; network or winsock reset; disable a device; delete files outside `outputs/`; close a window DEX didn't open | `system-destructive` | **card** | **card** | **card** | **once only** |
| T4 Elevation | Needs admin, so UAC | Any admin step; combined with T2/T3 in **one** card per batch | `elevation` | **card + UAC** | **card + UAC** | **card + UAC** | **once only** |
| Refused | Never, in any mode | Defender/firewall/UAC/BitLocker/credential settings; `\Policies\`, Winlogon, LSA, `Run`/`RunOnce`, IFEO, `\Services\` keys (the Python-era RED band); password managers; DEX's own windows; elevated windows; the lock screen | — | refuse | refuse | refuse | — |

**Code changes this implies** (Phase 1, `src/main/approvals/policy.ts`)

- **New categories:** add `'app-control' | 'system-change' |
  'system-destructive' | 'elevation'` to `ApprovalCategory` and to
  `APPROVAL_CATEGORIES`.
  - Unknown strings still normalise to `registry-write`, which always
    prompts. Keep that.
- **`ALWAYS_PROMPT`** = `{registry-write, system-destructive, elevation}`.
  `needsPrompt()` returns true for these whatever the mode. A remembered
  "session" answer must not skip them.
- **`ONCE_ONLY`** = `{system-destructive, elevation}`.
  `recordDecision()` ignores any lifetime but `once` for these, and the card
  doesn't offer one.
- **In `auto` mode:**
  - `app-control` prompts only for apps on the "ask first" list (owner
    decision Q10);
  - `system-change` always prompts.

### 2.2 Gates that don't depend on the model behaving

**Signed approvals** (from the Python-era SAFETY.md)
- Each card carries `payloadHash` (SHA-256 of the canonical JSON of the
  exact operation).
- `server.mjs` hashes the operation again right before executing it. A
  mismatch means asking again.

**DEX never drives itself**
- `launchEnv` passes `DEX_EXE_PATH = process.execPath` to the MCP server.
- The host refuses any window whose process image path equals it. That covers
  the hub, Logs, the pill, the stage, and every renderer/webview.
- The host also never *walks* those windows, which would switch on Chromium
  accessibility in DEX.

**Real-pointer guard on approval cards**
- `ConfirmationCard` acts only on a trusted `pointerdown` → `pointerup` on
  the button, with pointer movement inside the card in the preceding 5 s.
  - This is the "movement" discriminator from the Flutter era: memory
    `injected-click-guard`.
  - A bare `click` (a UIA `Invoke`, an accessibility default action) or
    Enter is ignored.
- Spike S5 confirms which events a UIA `Invoke` produces in Chromium.
- The phone path is unaffected.

**Privilege is the hard boundary**
- The agent and the host run non-elevated.
- Admin steps go only through the elevated batch runner (Phase 2), after an
  approval card and a UAC prompt.

**Shell guard** (Phase 2)
- A Claude Code `PreToolUse` hook denies system-mutating commands in the
  engine's own Bash/PowerShell, and names the gated tool to use instead.
- Claude Code honours hooks and deny rules even under
  `--dangerously-skip-permissions` [V].
- It's defense in depth only: string matching can be dodged.
- Codex has no verified equivalent (owner decision Q11).

**Cooperative pause**
- `runEngine.ts` can't pause an engine on Windows: "not supported on Windows
  yet".
- So every mutating host call first asks `POST /dex/desktop-gate`.
- Pause in the pane (and on the phone) sets a per-session **hold**. Desktop
  actions then wait, while reads continue.

**Data hygiene**
- Password fields (`UIA_IsPasswordPropertyId` = 30019) come back with value
  `"•••"`. `set_text` on them is refused with `secret_field`.
- Captures are taken only of the target window, never the full screen.
  They're stored under the session, and deleted with the task.

### 2.3 Rollback (Phase 2)

**The undo journal**
- One JSON file per change at
  `%APPDATA%/DEX/desktop/journal/<sessionId>/<n>.json`.
- It holds: what, when, the before-state, the command, the inverse command,
  backup paths, the restore point id, and the result.
- The `undo` tool and an "Undo" button on the fix report replay the inverse.

**Backups**
- Registry: `dex-registry export`.
- Drivers: `pnputil /export-driver` [V-local].
- Network state snapshot: adapters, IP and DNS per adapter, and the Wi-Fi
  profile export without keys.
- Files: send to the Recycle Bin (Shell API), never a hard delete.

**Restore point**
- Before every T3 batch, try `Checkpoint-Computer -RestorePointType
  MODIFY_SETTINGS` (or `DEVICE_DRIVER_INSTALL`) inside the elevated batch.
- If one was made in the last 24 h, Windows skips creating it [V]. The card
  says "Using the restore point from <time>".

---

## 3. UX

### Desktop

**Phase 1 (minimal)**
- Captures appear as cards and chat images through the existing `screenshot`
  event.
- A focus incident becomes a `notify` warning: "DEX brought Spotify to the
  front by mistake — sorry. It won't do that again this task."
- Approval cards show the tier and the exact commands.

**Phase 3: the Desk tab**
- **Where:** a workspace tab next to Chat, web and doc tabs. It appears when a
  task first uses `mcp__windows__*`.
- **What it shows:** live frames of the window DEX is working in (2 fps while
  acting, none when idle).
- **A highlight box** over the element being acted on, from UIA bounds. It
  plays the role of the browser's agent cursor, but in the mirror: nothing is
  drawn on the real app.
- **A caption line:** "Pressing Shuffle in Spotify".
- **Buttons:**
  - **Pause**: hold desktop actions.
  - **Show me**: bring the parked window onto the user's screen. The user
    started it, so activation is allowed. DEX then stops touching that window.
  - **Hand back**: re-park it, and DEX may continue.
  - **Stop**.
- **The fix report:** the agent ends system tasks with a `dex-canvas` report:
  "What I found / What I changed / How to undo", with Undo buttons wired to
  the journal (Phase 3).

### Phone

- Approvals already work through `answer_confirmation`.
- **Phase 3 adds:**
  - the tier in the notification text;
  - T3/T4 cards carry no inline "Approve" button. They open the app (owner
    decision Q7).
  - Steps that need UAC say "Needs you at the PC — Windows will ask for admin
    permission".
  - Desk captures at milestones arrive as image blocks with a thumbnail.

### Wording (examples)

- "Opening Spotify in the background — it won't pop up."
- "I need admin rights for 2 steps. Windows will ask once."
- "Your Wi-Fi drops about 4 times an hour. Here's what I found."

---

## 4. Phases

| Phase | What | Depends on |
|---|---|---|
| 0 | Spikes: answer the unknowns that change designs | — |
| 1 | Background desktop tools, approvals, AGENTS.md (**task 1: Spotify**) | 0 (S1–S6) |
| 2 | System diagnosis and gated changes, undo, elevation, shell guard (**tasks 2 and 3**) | 1 |
| 3 | Desk tab, takeover, fix report, phone | 1 (2 for undo buttons) |
| 4 | Borrowed input with consent, vision fallback, app memory, operator subagent, batching | 1, 3 |
| 5 | Optional isolation backends (child session on Pro, Windows isolation session), privileged helper service | owner decisions Q1, Q6 |

---

### Phase 0 — Spikes

**How to run them**
- Throwaway code goes in the scratchpad, never the repo.
- Each result is appended to `RESEARCH.md` under "Spike results", with its
  mark.
- Spikes that open apps run only with the owner's OK, or while the PC is idle
  (`GetLastInputInfo` > 2 min). Revert any setting changed.
- Start from the probe in RESEARCH §1.1:
  - a WinForms window shown without activation at -32000;
  - UIA3 through `Interop.UIAutomationClient` in Windows PowerShell 5.1;
  - foreground, cursor and last-input checked before and after;
  - `PrintWindow` with flag 2.

| # | Question | Pass when | Design it changes |
|---|---|---|---|
| S1 | Settings (WinUI): with AutoSetFocus=0, can UIA navigate pages and read toggles while Settings is behind or off-screen (not minimized)? Does `ms-settings:` launched with `SW_SHOWNOACTIVATE` stay in the background? | Navigation works and the foreground never changes | Whether Settings is "show only" or also drivable |
| S2 | Spotify (CEF): its tree (names and AutomationIds of Search, Play, Shuffle, Like); Invoke Play and Shuffle while parked off-screen; is the tree fresh after a second walk? Painting off-screen? Minimized? | Play + Shuffle by UIA with 0 incidents | The Spotify recipe and parking strategy |
| S3 | Launch without activation: `CreateProcessW` with `SW_SHOWMINNOACTIVE`, then `SetWindowPlacement(SW_SHOWNOACTIVATE, off-screen rect)`, for `mspaint.exe`, `notepad.exe` (packaged on Win11), Calculator (UWP), Spotify | No visible pop and no foreground change. Note per app which flags are honoured | `app_launch` |
| S4 | Capture: `PrintWindow` flag 2 versus Electron `desktopCapturer` for parked Chromium/CEF and UWP windows; how often frames come back blank | A valid frame within 3 tries | Desk frames, `window_capture` |
| S5 | Self-approval: in a dev build, UIA `Invoke` on the hub's Approve button; log the DOM events it produces | The guard design in §2.2 holds | ConfirmationCard guard |
| S6 | MCP plumbing: does a stdio MCP server started by Claude Code (shared `mcp.json`) and by Codex (`launch.mjs`) see `DEX_SESSION_ID` and `DEX_CONTROL_FILE`? Does either engine time out a tool call blocked for 3 or 10 min? | Env present; the max blocking time is known | Approval wait design (§4.1.7) |
| S7 | `Add-Type` with Defender/AMSI on; cached-DLL load time; behaviour under Constrained Language Mode (a VM if possible) | Compile < 2 s, cached load < 0.5 s | Whether to build the fallback exe now |
| S8 | Touchpad: does a `SPI_SETTOUCHPADPARAMETERS` round-trip with *unchanged* values succeed? Does a gesture registry change apply without sign-out? (Owner's OK; revert) | Known | Phase 2 touchpad fix path |
| S9 | Terminator (`@mediar-ai/terminator`, MIT): does a click on the WinForms probe change the foreground? Install size, prebuilt binaries | Compared with DEX's host | Keep the host, or adopt it |
| S10 | Spotify's SMTC session: `Controls.IsShuffleEnabled`; does `TryChangeShuffleActiveAsync(true)` work? | Known | Recipe step 4 |

---

### Phase 1 — Background desktop tools (the foundation)

**The goal**
- The agent can find, read, act in, capture, launch and park Windows apps,
  and control media.
- All of it without focus or cursor changes.
- T1 gated through the new categories, DEX itself unreachable, and
  pause-aware.
- Task 1 (Spotify) passes.

#### 4.1.1 Files

**New**

| File | What it does |
|---|---|
| `mcp-servers/windows/server.mjs` | The MCP stdio server (newline JSON-RPC 2.0; protocol `2025-06-18`, like `mcp-servers/microsoft/server.mjs`). Answers `initialize`, `tools/list`, `tools/call`, `ping`. Copies `host/*` out of `app.asar` into `%APPDATA%/DEX/desktop/host/` when the bytes differ (Blender's `hostScript()` pattern). Starts the host lazily on the first call, restarts it if it dies, and closes it on stdin end. Runs policy, gate, approval, the call itself, and incident reporting |
| `mcp-servers/windows/tools.mjs` | `TOOLS`: names, descriptions, JSON schemas (§4.1.3). `toHostOp(name, args)` |
| `mcp-servers/windows/policy.mjs` | `classify(tool, args, ctx) → {tier, category, title, detail, subject}`. `BLOCKED_PROCESSES`, `ASK_FIRST_PROCESSES`, `isDexWindow(info)`. Pure, so it is unit-tested |
| `mcp-servers/windows/control.mjs` | Reads `DEX_CONTROL_FILE` (url + token, as `dex-lib.sh` does). Exposes `confirm()`, `gate()`, `screenshot()`, `desktopEvent()` |
| `mcp-servers/windows/host/host.ps1` | The JSON-lines loop: reads a request, dispatches, writes one response line. Loads the cached `DexDesk-<sha8>.dll` or compiles `DexDesk.cs` with `Add-Type`. SMTC through the WinRT `AsTask` reflection helper (the one that worked in RESEARCH §1.2). Read-only system queries for Phase 1 |
| `mcp-servers/windows/host/DexDesk.cs` | UIA3 and Win32 (§4.1.4) |
| `mcp-servers/windows/host/Interop.UIAutomationClient.dll` | NuGet `Interop.UIAutomationClient` 10.19041.0, `lib/net45` (151,040 bytes, MIT, Roemer/UIAutomation-Interop). Record its SHA-256 in LICENSES.md. Alternative: owner decision Q9 |
| `mcp-servers/windows/host/LICENSE-Interop.UIAutomationClient.txt` | The MIT text from the package |
| `src/main/desktop/deskState.ts` | Per session: `hold` (paused or taken over), parked windows `{hwnd, title, process, launchId}`, incident count. Cleared on session delete |
| `src/main/hl/stock/dex-tools/desktop.md` | The skill doc for the agent (§4.1.8) |
| `src/main/hl/stock/desktop-recipes/spotify.md` | The Spotify recipe, filled in from S2/S10 |
| `scripts/desk-fixture.ps1` | A WinForms test window shown without activation, off-screen. Has a button, a text box, a password box, a check box, a list, and a combo box. Prints its hwnd and writes every event to a log file |
| `scripts/desk-live.mjs` | Drives `server.mjs` over stdio against the fixture and against Calculator. Asserts results and **zero focus incidents**. Run by hand on Windows |
| `tests/unit/mcp/windowsServer.test.ts` | The protocol and routing, with a fake host (§4.1.10) |
| `tests/unit/mcp/windowsPolicy.test.ts` | `classify()` cases |
| `tests/unit/desktop/deskState.test.ts` | Hold, parked windows, cleanup |

**Changed**

| File | Change |
|---|---|
| `src/main/mcp/catalog.ts` | Add a definition: `id: 'windows'`, `displayName: 'Windows'`, `builtIn: 'windows'`, `credentials: []`, plus new optional fields `alwaysOn: true`, `platforms: ['win32']`, `staticToolNames: TOOL_NAMES`. `launchEnv: () => ({ DEX_EXE_PATH: process.execPath, DEX_DESK_HOME: path.join(app.getPath('userData'), 'desktop') })`. Summary: "Use Windows apps and settings in the background — your mouse, keyboard and windows stay yours." |
| `src/main/hl/engines/runEngine.ts` | `usableServers([...await enabledConnections(), ...alwaysOnConnections()])`. `alwaysOnConnections()` (new, in `mcp/store.ts` or `catalog.ts`) returns `{id, values:{}, toolNames: def.staticToolNames}` for each `alwaysOn` definition on a matching platform, unless the user switched it off in Settings (a stored `enabled:false` wins) |
| `src/main/approvals/policy.ts` | The categories, `ALWAYS_PROMPT` and `ONCE_ONLY` from §2.1 |
| `src/main/index.ts` | (1) `/dex/confirm` accepts optional `tier` (0–4) and `payloadHash`, and puts `category` and `tier` on the `confirmation` event. (2) `resolveConfirmation` forces `once` for `ONCE_ONLY`. (3) Routes `POST /dex/screenshot` (port from `feat/desktop-uia-cua` commit `b9a35479`: validates `sessionId`, `path`, `mode`, `caption`, then `appendOutput({type:'screenshot',…})`), `POST /dex/desktop-gate` `{sessionId}` → `{hold, reason}`, and `POST /dex/desktop-event` `{sessionId, kind:'focus-incident'\|'parked'\|'taken-over'\|'handed-back', …}`. (4) `pauseSessionFromMain`: on win32, also set `deskState.hold(sessionId,'paused')` and still report paused for desktop actions, even though the process can't be suspended. Resume clears it |
| `src/shared/session-schemas.ts` | `HlEventConfirmationSchema`: add `category: z.string().optional()` and `tier: z.number().int().min(0).max(4).optional()`. zod strips undeclared fields (TO_BE_DONE §1.4) |
| `src/renderer/hub/types.ts` | Mirror the new optional fields |
| `src/renderer/hub/PreviewDeck.tsx` | `ConfirmationCard`: a tier badge ("Changes your PC", "Can't be undone easily", "Needs admin"); hide the lifetime control when the tier is 3 or above; the real-pointer guard (§2.2) |
| `src/main/hl/stock/AGENTS.md` | §4.1.8 text |
| `src/main/hl/harness.ts` | Add `'mcp__windows__'` to the AGENTS.md `sentinels` so existing installs get the new file |
| `src/main/hl/engines/claude-code/adapter.ts` | One direct line in `wrapPrompt` (§4.1.8). Precedent: the registry line, "a direct instruction beats a skill doc" |
| `src/main/hl/stock/dex-tools/SKILL.md` | One row pointing at `desktop.md` |
| `src/main/hl/stock/dex-tools/registry.md`, `dex-registry` (header comment) | Replace the stale `dex-uia` mentions. That tool only exists on the unmerged branch `feat/desktop-uia-cua` |
| `LICENSES.md` | A "Desktop app: Windows control" section: Interop.UIAutomationClient (MIT, version, SHA-256, source URL) |

#### 4.1.2 How windows and elements are named

**A window selector** (one of these; resolved by the host):

```json
{ "hwnd": 1312456 }
{ "process": "Spotify.exe" }
{ "title": "Calculator", "match": "exact" }   // match: exact | contains (default exact)
{ "opened": "L3" }                            // a launchId from app_launch
```

- It must resolve to exactly one visible top-level window.
- More than one match gives `ambiguous_window` with
  `candidates: [{hwnd,title,process}]`. This is the Python-era
  `AmbiguousWindow` rule: guessing is how an agent overwrites the document
  someone was working on.

**An element handle** is a short string like `"e17"`.
- The host keeps a per-window map from UIA `RuntimeId` to handle.
- The same element keeps the same handle across tree reads, which fixes the
  index-shifting bug `dex-uia` found on Calculator.
- If the element is gone, tools return `stale_ref` with "call window_tree
  again".

**Alternatively, a name locator:** `{ "name": "Shuffle", "role": "Button",
"automationId": "…" }`, resolved with the matching rules ported from
`uia_driver.py` (git `3348ced9`):
- strip accelerators and trailing "(Ctrl+S)";
- exact before prefix before single whole word;
- if nothing enabled matches the role, retry by name only (Windows often
  exposes a "button" as `ListItem`);
- the accessible name wins over AutomationId;
- several enabled matches give `ambiguous_element` with candidates.

#### 4.1.3 Tools (Phase 1)

All names are `mcp__windows__<name>`. Every result is
`{ok, …, focus?: {incident}}`. Errors are
`{ok:false, error:<code>, message, hint}`.

| Tool | Input | Output | Tier |
|---|---|---|---|
| `windows_list` | `{ includeMinimized?: boolean }` | `windows: [{hwnd, title, process, pid, className, foreground, minimized, cloaked, onScreen, bounds:[x,y,w,h], openedByDex, elevated}]` (blocked processes appear with `blocked:true` and no title) | T0 |
| `window_tree` | `{ window, root?: handle, depth?: 1–12 (default 6), max?: ≤ 600 (default 250), mode?: 'actionable'\|'all' }` | `{window:{hwnd,title,process}, nodes:[{h, role, name, id?, value?, pat:['invoke','value','toggle','select','expand','scroll','window','range'], st:['disabled','offscreen','on','off','expanded','collapsed','selected','password'], box:[x,y,w,h], depth}], truncated}`. `actionable` keeps nodes with a pattern or a name (the shared "worth listing" rule from `dex-uia`) | T0 |
| `window_find` | `{ window, name?, role?, automationId?, match?: 'exact'\|'prefix'\|'contains', limit?: ≤ 20 }` | `matches:[node]`; `near: [names]` when there are none | T0 |
| `window_capture` | `{ window, annotate?: boolean, maxWidth?: ≤ 1600 (default 1280) }` | MCP content: `text` (JSON with `path`, `size`) + `image` (PNG, base64). Also `POST /dex/screenshot` with `mode: annotate ? 'uia' : 'raw'`. Validates and retries blank frames, up to 3 times / 600 ms | T0 |
| `ui_invoke` | `{ window, target: handle \| locator }` | `{method:'invoke'\|'toggle'\|'select'\|'expand'\|'legacy', verified?}`. The ladder: Invoke → SelectionItem.Select → ExpandCollapse.Expand → LegacyIAccessible.DoDefaultAction. **Never a mouse click.** If nothing applies: `needs_input` | T1 |
| `ui_set_text` | `{ window, target, text, append?: false }` | `{method:'value'\|'wm_settext', readBack, verified}`. ValuePattern.SetValue (refuses `IsReadOnly`); for a classic `Edit`-class control with a native handle, `SendMessage(WM_SETTEXT)`. Password field: `secret_field` | T1 |
| `ui_toggle` | `{ window, target, state: 'on'\|'off' }` | `{was, now, verified}` (reads first; never flips blindly) | T1 |
| `ui_select` | `{ window, target }` | `{selected:true}` | T1 |
| `ui_expand` | `{ window, target, expanded: boolean }` | `{state}` | T1 |
| `ui_scroll` | `{ window, target, direction:'up'\|'down'\|'left'\|'right', amount?: 'small'\|'large' }`, or `{ window, target, intoView:true }` (ScrollItemPattern) | `{ok}` | T0 (it changes nothing the user cares about) |
| `ui_wait` | `{ window, name?, role?, automationId?, gone?: boolean, timeoutMs?: ≤ 30000 }` | `{appeared\|disappeared: boolean, node?}` | T0 |
| `app_launch` | `{ app: string /* exe path, Start-menu name or AUMID */, args?: string[], uri?: string, show?: boolean }` | `{launchId, pid, hwnd, parked, mayHaveTakenFocus}` | T1 |
| `window_manage` | `{ window, action: 'park'\|'unpark'\|'minimize'\|'close' }` | `{ok}`. `park`/`unpark` only for windows DEX opened. `close` for a window DEX didn't open is T3. `minimize` is refused for packaged apps (they suspend [V]) | T1 / T3 |
| `media` | `{ action: 'status'\|'play'\|'pause'\|'toggle'\|'next'\|'previous'\|'shuffle'\|'repeat', value?: boolean\|'none'\|'track'\|'list', app?: string }` | `status` → `sessions:[{app, title, artist, album, playback, shuffle, repeat, can:{play,pause,next,previous,shuffle,repeat}}]`; commands → `{before, after, verified}` | T0 (status) / T1 |
| `system_info` (Phase 1: read-only topics) | `{ topic: 'network'\|'wifi'\|'wlan_events'\|'devices'\|'driver'\|'touchpad'\|'apps'\|'events', …params }` | Typed JSON per topic (§4.2.2) | T0 |
| `open_settings` | `{ page: string /* documented ms-settings id, e.g. 'network-status' */ }` | `{opened, mayHaveTakenFocus:true}`. Allowed only when the user asked to see it, or as the last step of a task ("show"). The tool description says so | T1 |

**How `app_launch` launches without focus**

The host resolves the target in this order:
1. **An exe path.**
   - `CreateProcessW` with `STARTUPINFOW{ dwFlags = STARTF_USESHOWWINDOW,
     wShowWindow = SW_SHOWMINNOACTIVE }`.
   - Then wait up to 15 s for a visible top-level window owned by that pid
     (or a child pid; Spotify is multi-process).
   - Then **park** it: `SetWindowPlacement` with `showCmd =
     SW_SHOWNOACTIVATE` and `rcNormalPosition` = the park rect.
2. **A Start-menu name.**
   - Resolve it to an AppID with `Get-StartApps` [L that the cmdlet exists on
     all Win11 SKUs].
   - A path goes to step 1; an AUMID to step 3.
3. **An AUMID (packaged app).** `IApplicationActivationManager.ActivateApplication`
   *will* activate [L]. Allowed only with `show:true`; otherwise it returns
   `would_take_focus`. Spike S1/S3 may lift this.
4. **A `uri`.** `ShellExecuteExW` with `nShow = SW_SHOWNOACTIVATE`, returning
   `mayHaveTakenFocus:true`. Then park, if the window belongs to a process
   DEX started.

**The park rect**
- To the right of the virtual screen: `left = SM_XVIRTUALSCREEN +
  SM_CXVIRTUALSCREEN + 200`, `top = SM_YVIRTUALSCREEN`.
- Same size as the window's normal size, or 1280×800.
- It is not -32000: that is the minimized position, and minimized packaged or
  CEF apps freeze.

**Every 2 s, for parked windows, the host:**
- re-parks a window that a display change moved on-screen (and the user
  didn't);
- if a parked window became foreground *and* real user input happened (the
  `GetLastInputInfo` time moved), the user took it, for example from the
  taskbar or Alt+Tab. The host then:
  - moves it on-screen, centred on the monitor under the cursor
    (`SWP_NOACTIVATE`; it is already active);
  - posts `taken-over`;
  - sets the hold for that window until "Hand back" (Phase 3) or the end of
    the task.

#### 4.1.4 The host (`DexDesk.cs` + `host.ps1`)

**How it is started**
- `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy
  Bypass -Mta -File host.ps1 -Home <DEX_DESK_HOME>`.
- `windowsHide: true`.
- UIA clients should run on an MTA, non-UI thread. [L] (`-Mta` exists in
  Windows PowerShell 3.0+)

**The protocol** (one JSON object per line)

```json
→ {"id":7,"op":"invoke","args":{"hwnd":1312456,"target":"e17"}}
← {"id":7,"ok":true,"result":{"method":"invoke","verified":true},
   "focus":{"incident":null},"ms":31}
```

**Ops**
- `hello` (version, OS build, elevated?, PowerShell language mode)
- `windows`, `tree`, `find`, `invoke`, `set_text`, `toggle`, `select`,
  `expand`, `scroll`, `wait`
- `capture`, `launch`, `window`
- `media_status`, `media_cmd`
- `sys`
- `parked`
- `shutdown`

**UIA setup**
- `IUIAutomation2 uia = (IUIAutomation2) new CUIAutomation8Class()`.
- `uia.AutoSetFocus = 0` (**required**; see RESEARCH §1.1).
- `ConnectionTimeout = 2000`, `TransactionTimeout = 5000`. [U] exact units
  and effect; confirm in S7.
- Never call `IUIAutomationElement.SetFocus`.

**Fast tree reads**
- Use one `IUIAutomationCacheRequest` with:
  - Name, ControlType, AutomationId, BoundingRectangle;
  - IsEnabled, IsOffscreen, IsPassword;
  - NativeWindowHandle, RuntimeId;
  - the `Is*PatternAvailable` properties;
  - ToggleState, ExpandCollapseState, IsSelected;
  - Value (skipped when IsPassword).
- Then `BuildUpdatedCache` / `FindAllBuildCache` over the control view, to
  the requested depth and max.

**Timeouts**
- Each op runs under a watchdog (default 8 s, configurable per op).
- When it fires, the result is `provider_timeout`, and the host recreates its
  UIA object.
- If the process itself is wedged, `server.mjs` kills and restarts the host.

**The focus sentinel** (around every mutating op)

```
before = { fg: GetForegroundWindow(), cursor: GetCursorPos(), input: GetLastInputInfo().dwTime }
run op; sleep 150 ms   (the Python-era "settle": Invoke returns before the app acts)
after  = same three
incident = (after.fg != before.fg && after.input == before.input) → {kind:'foreground', to:{hwnd,process,title}}
         | (cursor moved && after.input == before.input)          → {kind:'cursor'}
```

- User input during the op is attributed to the user. That is no incident.
- `server.mjs` posts every incident to `/dex/desktop-event`.
- Main appends a `notify` warning and counts it.
- The tool result carries it, so the agent changes approach.

**Refusals in the host** (defense in depth; `policy.mjs` checks first)
- Any window whose process image path equals `DEX_EXE_PATH`.
- Any window whose process is elevated when the host isn't
  (`OpenProcessToken`/`TokenElevation`). Error: `elevated_window`.
- `BLOCKED_PROCESSES`.

**Captures**
- `PrintWindow(hwnd, hdc, 2 /* PW_RENDERFULLCONTENT */)` into a 32-bpp
  bitmap.
- Blank check: sample 1 pixel in 16. If > 98% are equal to the corner pixel,
  retry. (RESEARCH §1.1 saw a blank frame right after an activation.)
- Downscale to `maxWidth`. Save PNG to
  `<DEX_DESK_HOME>/captures/<sessionId>/<ts>.png`.
- `annotate`: draw each actionable node's handle on its box, in the same
  coordinate space as `window_tree`.

**SMTC (in `host.ps1`)**
- `[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,
  Windows.Media.Control, ContentType=WindowsRuntime]` with the `AsTask`
  generic-method helper.
- Picks the session whose `SourceAppUserModelId` contains `app`, or the
  current session.
- Verifies 300 ms after a command by reading `GetPlaybackInfo()` again.

**The compiled helper is cached**
- Compile once: `Add-Type -TypeDefinition (Get-Content DexDesk.cs -Raw)
  -ReferencedAssemblies <interop>,System.Drawing -OutputAssembly
  <home>/DexDesk-<sha8 of .cs>.dll`.
- After that: `Add-Type -Path`.
- Load the interop first with `[Reflection.Assembly]::LoadFrom`, or type
  resolution fails. The probe hit exactly this.

#### 4.1.5 `server.mjs` call flow

```
tools/call(name, args)
  1. validate args against TOOLS schema            → invalid_args
  2. host.call('windows'|…) to resolve the selector → window info (process, path, elevated, openedByDex)
  3. policy.classify(name, args, {window, sessionId})
       refused → {ok:false, error:'refused', message:"DEX doesn't use <app>: <why>"}
  4. if mutating: control.gate(sessionId)            hold → poll 1 s up to 120 s, then {ok:false,error:'held'}
  5. if tier ≥ 1 and policy says prompt: control.confirm({sessionId,title,detail,category,subject,tier,payloadHash})
       denied/timeout → {ok:false, error:'denied'}
  6. re-hash payload == payloadHash, else back to 5
  7. host.call(op, args)
  8. on incident → control.desktopEvent(...)
  9. on capture → control.screenshot(...)
  return MCP content
```

#### 4.1.6 Gate, hold and pause in main

- **`deskState.ts`**
  - `hold(sessionId, reason)`, `release(sessionId)`, `isHeld(sessionId)`.
  - `noteParked(sessionId, win)`, `noteTakenOver(sessionId, hwnd)`.
  - `clear(sessionId)`, called where `documentTabs.closeSession` is called.
- **`POST /dex/desktop-gate`** answers `{hold: isHeld(id), reason}`.
- **The pane's Pause button and the phone's `pause`** call
  `pauseSessionFromMain`.
  - On win32, `deskState.hold(id,'paused')` is set **before** trying the
    process pause. A failed process pause on Windows still leaves desktop
    actions held.
  - The pane copy becomes: "Paused — DEX won't touch your apps until you
    resume."

#### 4.1.7 Waiting on approvals inside an MCP call

- `control.confirm()` blocks on `/dex/confirm`, as `dex-registry` does. It
  times out after 10 min, and a timeout counts as a denial.
- **If S6 shows an engine times out first:** switch to two steps.
  - The tool returns
    `{ok:false, error:'awaiting_approval', approvalId, hint:'call
    approval_wait'}` after 100 s.
  - A new tool `approval_wait {approvalId}` blocks for up to 100 s more.
  - Main keeps the card pending meanwhile; it already does, for 10 min.

#### 4.1.8 What the agent is told

**`AGENTS.md`**: replace the "A Windows desktop app" row and add two:

| Job | First choice | Fall back to |
|---|---|---|
| A Windows app — Spotify, Settings, Office, anything with a window | `mcp__windows__*`. It works in the background and never takes the user's mouse, keyboard or focus. Read `./dex-tools/desktop.md` first, and the app's file in `./desktop-recipes/` if there is one | Tell the user what's blocking you. **Never** `SendKeys`, `SendInput`, pyautogui, coordinate clicks, or `Start-Process` of a GUI app in your shell |
| Music and video playing on the PC | `mcp__windows__media` | — |
| Checking the PC: network, Wi-Fi, devices, drivers, touchpad, installed apps, event logs | `mcp__windows__system_info` | your shell, read-only |

**AGENTS.md also gets a new section, "The User Keeps Their PC"** (about 15
lines). In substance:
- The user is using this PC while you work. Anything that pops a window,
  moves the pointer or takes the keyboard interrupts them.
- Launch apps with `app_launch`; they open parked off-screen. Use
  `open_settings`, or `show:true`, only when the user asked to see something,
  or as the very last step.
- Don't move, minimize or close the user's own windows.
- Re-read the tree (`window_tree`/`window_find`) after any action that could
  change the UI. Handles stay stable; a missing one returns `stale_ref`.
- `held` means the user paused you, or took that window. Wait, or ask; don't
  retry around it.
- `focus.incident` in a result means you just interrupted the user. Say
  sorry in one line, and don't repeat that action the same way.
- Password fields are off-limits (`secret_field`). Ask the user to type it.

**`dex-tools/desktop.md`** (about 150 lines), sections:
1. The loop: `windows_list` → `window_find`/`window_tree` → act by handle →
   verify by reading back.
2. Launching and parking; what "parked" means to the user; `show`.
3. Media first for playback; UI only to pick *what* plays.
4. Settings are show-only; diagnose through `system_info`.
5. The error codes and the right response to each: `needs_input`,
   `secret_field`, `held`, `stale_ref`, `ambiguous_window`,
   `ambiguous_element`, `provider_timeout`, `elevated_window`, `refused`,
   `would_take_focus`, `denied`.
6. Recording with `dex-state` (`--tool uia --fallback …`, as AGENTS.md
   already teaches).

**The Claude Code `wrapPrompt` line**:

> Windows apps, media and PC diagnostics are `mcp__windows__*` tools. They
> work in the background: never bring a window to the front, move the mouse,
> or type with SendKeys/SendInput — the user is using this PC while you work.

#### 4.1.9 The Spotify recipe (`desktop-recipes/spotify.md`)

Exact names to be filled in from S2/S10.
1. `media status`: is a Spotify session there?
2. If not, `app_launch {app:"Spotify"}`. It opens parked.
3. Resolve the playlist:
   - a link becomes `spotify:playlist:<id>`;
   - otherwise use the parked window: `window_find` the search box,
     `ui_set_text`, `ui_wait` for results, `ui_invoke` the playlist row.
   - Prefer UIA in the parked window to URI activation, which may come to the
     front.
4. `media shuffle true` if `can.shuffle`. Otherwise `ui_toggle` the shuffle
   button to on (read its name and state first).
5. `ui_invoke` the playlist page's Play button.
6. Verify with `media status`: playing, shuffle on, a track from the
   playlist.
7. Tell the user one line: "Playing <playlist> on shuffle — Spotify stayed in
   the background."

#### 4.1.10 Tests

**Unit** (`npx vitest run tests/unit/mcp tests/unit/approvals tests/unit/desktop tests/unit/hub`)

- **`windowsServer.test.ts`** spawns `server.mjs` with
  `DEX_DESK_HOST_CMD=<node fake-host.mjs>`. The server honours this env for
  tests only, and only when `NODE_ENV==='test'`. It uses a fake control
  server on a random port with a temp control file.
  - `it('lists every Windows tool with a schema the engines accept')`
  - `it('asks for approval before a ui_invoke when the session is in Ask mode')`
  - `it('refuses to act on a window that belongs to DEX itself')`
  - `it('returns held without touching the app while the session is paused')`
  - `it('reports a focus incident to DEX when the host saw the foreground change')`
  - `it('records every window_capture as a screenshot on the task')`
  - `it('restarts the host once when it dies mid-call')`
- **`windowsPolicy.test.ts`**
  - `it('never offers a session-long approval for a destructive change')`
  - `it('treats closing a window DEX did not open as destructive')`
  - `it('blocks password managers even for reading')`
- **`policy.test.ts`** (additions)
  - `it('asks for elevation even in Full access')`
  - `it('ignores a remembered session answer for system-destructive')`
- **`ConfirmationCard.spec.tsx`**
  - `it('does not approve on a click that came without a real pointer press')`
  - `it('hides the remember-for options for a change that needs admin')`
- **`catalog`/`runEngine`**
  - `it('gives every Windows task the Windows server without the user enabling it')`
  - `it('leaves the Windows server out on macOS and Linux')`

**Live** (Windows, by hand: `node scripts/desk-live.mjs`)

| # | Check | Pass when |
|---|---|---|
| L1 | Fixture: tree → set text → invoke → toggle → select → capture | All verified. **0 incidents in 50 loops**, while Notepad is in front and a script types into it every 200 ms (simulates a busy user). The Notepad text has no stray characters |
| L2 | Fixture password box | `window_tree` shows `•••`; `ui_set_text` → `secret_field` |
| L3 | Calculator (UWP): `app_launch`, then invoke 1, 2, ×, 9, = | Display reads 108; 0 incidents; it was never on screen. If S3 shows Calculator activates on launch, launch it while idle and record that |
| L4 | Media: play a YouTube video in a browser, then `media pause` / `play` / `status` | State changes; 0 incidents |
| L5 | Self-guard: `window_tree {process:"DEX.exe"}` (or `electron.exe` in dev) | `refused` |
| L6 | Pause: press Pause in the pane during L1 | The next mutating call returns `held` within 120 s; resuming continues |
| L7 | Self-approval: `dex-registry set` waits on a card; a script UIA-Invokes Approve | Not approved; a real click approves |

**Task 1 acceptance** (needs a human step: the owner installs Spotify and signs
in)

- Prompt: "Open Spotify, go to <link to a playlist>, shuffle and play."
- **Pass:**
  - music from that playlist plays with shuffle on;
  - the Spotify window never appeared over the owner's work;
  - 0 focus incidents;
  - the owner typed in another app throughout with no interruption;
  - the time is recorded.
- **Also pass** with the playlist named instead of linked ("my Discover
  Weekly").

#### 4.1.11 Phase 1 risks

| Risk | Mitigation |
|---|---|
| Spotify's tree is thin, or freezes off-screen (S2) | Park with a sliver on-screen, or behind other windows. If it still fails, step 3 becomes a *shown* step with the user's OK |
| `Add-Type` is blocked on some PCs (S7) | `hello` reports the language mode. A clear error: "Windows blocked DEX's helper (PowerShell Constrained Language Mode). Desktop control is off on this PC." The fallback exe goes in Phase 2 |
| The MCP server restarts each turn, about 1 s of host start | Acceptable. Phase 3 can make the host a detached per-session process, like Blender's |
| The agent ignores the tools and scripts the GUI in its shell | AGENTS.md and the prompt line. The Phase 2 hook blocks `SendKeys`, `SendInput` and `[System.Windows.Forms.Cursor]` patterns |

---

### Phase 2 — System diagnosis and gated changes (tasks 2 and 3)

**Scope**
- All `system_info` topics.
- The `system_change` tool, with typed, allowlisted actions.
- The undo journal and the `undo` tool.
- Backups and restore points.
- The elevated batch runner.
- The Claude Code shell guard.
- Recipes: `desktop-recipes/wifi.md` and `desktop-recipes/touchpad.md`.
- The fix-report convention, in `desktop.md`.

#### 4.2.1 Files

**New**
- `mcp-servers/windows/host/system/network.ps1`, `touchpad.ps1`,
  `devices.ps1`, `apps.ps1`, `events.ps1`: dot-sourced by `host.ps1`. Each
  function returns a hashtable, which becomes JSON.
- `mcp-servers/windows/host/elevated.ps1`: the template for a batch of
  approved admin actions.
- `src/main/desktop/journal.ts`: write, list and undo.
- `src/main/hl/stock/dex-tools/dex-guard` (+ `.cmd`): the bash `PreToolUse`
  hook.
- `tests/unit/desktop/journal.test.ts`, `tests/unit/hl/dexGuard.test.ts`.

**Changed**
- `tools.mjs`, `policy.mjs`: `system_change`, `undo`, `restore_point`.
- `index.ts`: `POST /dex/desktop-journal`.
- `claude-code/adapter.ts`:
  - write `<harnessDir>/claude-settings.json` with
    `hooks.PreToolUse` = `[{matcher:"Bash|PowerShell", hooks:[{type:"command",
    command:"bash <dexToolsDir>/dex-guard"}]}]`;
  - pass it with `--settings`.
  - **Caution:** `--settings` keys override the same keys in the user's own
    settings for that run [V]. Check whether `hooks` merges or replaces; if it
    replaces, document it, or use `--disallowedTools` patterns instead
    (§4.2.6).
- `harness.ts`: add `dex-guard` to `executableBasenames`.

#### 4.2.2 `system_info` topics

All read-only; none needs admin, except where marked.

| Topic | Source | Returns |
|---|---|---|
| `network` | `Get-NetAdapter`, `Get-NetIPConfiguration`, `Get-DnsClientServerAddress`, `Test-NetConnection` (gateway; 1.1.1.1:443; `www.msftconnecttest.com`:80), `Resolve-DnsName` | Per adapter: status, link speed, driver, IPv4/6, DHCP or static, APIPA flag, gateway reachable, DNS servers and resolution, internet reachable, proxy (`netsh winhttp show proxy`, plus the HKCU proxy read in the host) |
| `wifi` | `netsh wlan show interfaces`, parsed | state, signal %, band, channel, radio type, rates, `locationBlocked` (on access denied: tell the user Settings → Privacy & security → Location [V]) |
| `wlan_events` | `Get-WinEvent` on `Microsoft-Windows-WLAN-AutoConfig/Operational` (+ NCSI, DHCP Admin) | Counts by id over N hours, disconnects per hour, the last 10 disconnect reasons |
| `wlan_report` (**admin**, T4) | `netsh wlan show wlanreport` | Path to the HTML. Opened with `dex-open` only if asked |
| `devices` | `pnputil /enum-devices /class <c> /format csv` (or `Get-PnpDevice`) | Instance id, name, status, problem code, driver INF |
| `driver` | `Get-PnpDeviceProperty` | Provider, version, date, INF, signer |
| `touchpad` | `SPI_GETTOUCHPADPARAMETERS` (0x00AE, `versionNumber=1`; read as verified locally) + the `PrecisionTouchPad` and `\Status` values + the touchpad devices | Precision/legacy, enabled/active, mouse present, each gesture setting with its meaning [L], driver and vendor utility processes |
| `apps` | The Uninstall keys (HKLM, HKLM\WOW6432Node, HKCU) + `Get-AppxPackage` (+ `winget list --id` if winget is present) | name, version, publisher, scope (user/machine), uninstall command, winget id |
| `events` | Allowlisted logs only (System filtered by provider, Kernel-PnP, WLAN, NCSI, DHCP, Application errors for one exe) | Counts and the last N messages (clipped) |

#### 4.2.3 `system_change` actions

Every action has a dry run (`dryRun:true` returns the commands and the undo).

| Action | Tier | Admin | Undo recorded |
|---|---|---|---|
| `dns_flush` | T2 | no [L] | — (harmless) |
| `wifi_reconnect {profile?}` | T2 | no [L] | — |
| `wifi_radio {on}` | T2 | yes [L] | the opposite |
| `adapter_restart {name}` | T2+T4 | yes [L] | — |
| `dns_set {adapter, servers \| 'dhcp'}` | T2+T4 | yes | the snapshot of the previous servers/source |
| `ip_renew {adapter}` | T2 | [U] | — |
| `winsock_reset`, `ip_stack_reset` | T3+T4, needs a restart | yes | restore point |
| `touchpad_set {field, value}` (documented `TOUCHPAD_PARAMETERS` user fields only) | T2 | no | the previous value |
| `gesture_set {key: ThreeFingerSlideEnabled\|FourFingerSlideEnabled\|ThreeFingerTapEnabled\|FourFingerTapEnabled, value}` | T2 (shown as a registry change; always asks, like `registry-write`) | no | the previous value + a `.reg` export |
| `device_restart {instanceId}` | T2+T4 | yes | — |
| `device_disable / device_enable {instanceId}` | T3+T4 / T2+T4 | yes | the opposite |
| `driver_reinstall {instanceId}` | T3+T4 | yes | `pnputil /export-driver` + restore point. **Refused for an input device unless another one of the same kind is present** (`externalMousePresent`, or an extra keyboard) |
| `app_uninstall {wingetId \| uninstallString \| aumid}` | T3 (+T4 for machine scope) | depends | the winget id and version for reinstall |
| `service_restart {name}` | T2+T4 | yes | — |
| `explorer_restart` | T2 (visible: the taskbar blinks) | no | — |
| `files_recycle {paths}` (outside `outputs/`) | T3 | no | the Recycle Bin restore path |
| `restore_point {description}` | T4 | yes | — |

#### 4.2.4 Elevation: one UAC per approved batch

1. **Group the plan.** When the agent calls admin actions, `server.mjs`
   groups them. The agent can pass `batch:"<id>"` to group several, or call
   `system_change` with `actions:[…]`.
2. **Generate the script.** The server fills `elevated-<id>.ps1` from
   `elevated.ps1`:
   - fixed functions per action;
   - arguments validated and passed as JSON;
   - no free text.
   - It computes the SHA-256.
3. **One card for the batch.** It lists every action, the restore point, the
   backups and the undo, plus the script hash.
4. **The host runs it.** After approval: `Start-Process powershell.exe -Verb
   RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile
   -ExecutionPolicy Bypass -File <script> -Expect <sha256> -Out
   <result.json>'`.
   - The script checks its own hash before doing anything.
   - That narrows, but doesn't close, a swap between approval and run.
     Documented.
5. **The answer.**
   - UAC declined → `elevation_declined`.
   - Otherwise the result JSON goes into the journal.

#### 4.2.5 Undo journal

- **`journal.ts`**: `record(sessionId, entry)` writes a file;
  `list(sessionId)`; `undo(sessionId, n)` replays the inverse through the
  same server path (approval included).
- **The `undo` tool**: `{n}`, or `{all:true}` in reverse order.
- **Phase 3** surfaces the journal as Undo buttons on the fix report.

#### 4.2.6 The shell guard

`dex-guard` reads the hook JSON on stdin and takes `tool_input.command`.

**It denies** (exit 2, plus `permissionDecision:"deny"` and the reason) any
match of:
- `netsh … (set|add|delete|reset)`;
- `pnputil … /(delete-driver|remove-device|disable-device|add-driver)`;
- `winget (uninstall|install)`;
- `Remove-AppxPackage`;
- `reg(.exe)? (add|delete|import)`;
- `Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|Remove-Item` on
  `HK…:`;
- `Restart-NetAdapter|Disable-NetAdapter|Set-DnsClientServerAddress`;
- `bcdedit|diskpart|sc(.exe)? (config|delete|stop)|Stop-Service|Set-Service`;
- `shutdown`;
- `SendKeys|SendInput|SetCursorPos|mouse_event|keybd_event`;
- `Start-Process … -Verb RunAs`.

**The reason message:** "Use mcp__windows__system_change (or dex-registry) —
it backs up, asks the user, and can undo."

**Read-only verbs pass.**

**The alternative:** `--disallowedTools` scoped rules. They also block in
bypass mode [V], but match only "as written".

**Tests** use a table of allowed and denied commands.

#### 4.2.7 Acceptance

**Task 2 — Wi-Fi** (the owner's PC; read-only first)
- **Prompt:** "Troubleshoot my Wi-Fi."
- **Pass:**
  - a fix report with adapter, signal, IP/DNS, internet reachability,
    disconnect frequency (from events) and the driver age;
  - 0 admin prompts, 0 focus incidents;
  - Settings opened only if the owner asks ("show me").
- **Pass with consent, on a VM or a second PC:**
  1. Seed a fault: an approved `dns_set` to an unreachable server.
  2. DEX diagnoses "DNS not resolving".
  3. It proposes `dns_set dhcp` (T2+T4, one card, one UAC).
  4. It verifies resolution works.
  5. `undo` restores the seeded state, proving the journal.

**Task 3 — Touchpad gestures**
- **Read-only on the owner's PC.**
  - **Prompt:** "My touchpad works but gestures don't — look into it."
  - **Pass:** the report names:
    - the touchpad type (precision);
    - each gesture setting and its meaning;
    - the driver provider, version and date;
    - whether a mouse makes the touchpad inactive.
  - No changes without a card.
- **With the owner's consent:**
  1. Seed `ThreeFingerSlideEnabled=0` through `dex-registry` (card).
  2. "Three-finger swipes do nothing — fix it."
  3. DEX finds it, proposes `gesture_set … 1` (card), and applies it.
  4. It says whether a sign-out is needed (from S8).
  5. Three-finger swipe works.
  6. `undo` brings back 0.
- **A driver reinstall is never part of the automatic test.** Check by hand
  that `driver_reinstall` is refused when no other pointing device is present.

**Shell guard**
- Asked to "reset winsock" directly, the agent's native Bash
  `netsh winsock reset` is denied, and the agent switches to `system_change`
  (card shown).

#### 4.2.8 Phase 2 risks

| Risk | Mitigation |
|---|---|
| A wrong repair makes things worse (network reset, driver) | Rungs in order, cheapest first; T3 cards spell out the side effects ("You'll need to restart; saved Wi-Fi passwords are kept/lost"); restore point; journal |
| Prompt injection: a document, page or app text says "uninstall X" | SAFETY.md §3: content is data. Cards show *why* the agent wants the change (the agent passes a `reason` field, displayed verbatim); T3/T4 always asks |
| The 24-h restore-point limit | The card says which restore point covers this. Raising the frequency is owner decision Q8 |
| Wi-Fi details blocked by location consent | Fall back to events and adapter data; tell the user the one Settings switch |

---

### Phase 3 — Desk tab, takeover, fix report, phone

**Scope**
- **Desk tab:** `src/renderer/hub/workspace/DeskView.tsx`, plus
  `WorkspaceBar` gaining a "Desk" tab kind.
  - Frames come from a host op `frames {hwnd, fps:2, maxWidth:960, on}`. It
    writes `<desk>/live/<session>.jpg` atomically, with `focusBox` metadata.
  - Main watches the file. While the renderer reports the Desk tab visible,
    main pushes `workspace:desk-frame (sessionId, bytes, meta)`.
  - The hub draws the frame and the highlight box. Respect the Fluidity
    rules: no animation of large surfaces; draw in a canvas.
- **"Show me":**
  - the user just clicked DEX, so main is the foreground process;
  - main spawns a one-shot helper (`powershell … host.ps1 -Op activate -Hwnd
    <h>`). A process "started by the foreground process" may set the
    foreground [V], and Electron has no `AllowSetForegroundWindow` API;
  - the helper moves the window on-screen and activates it;
  - `deskState.noteTakenOver`.
- **"Hand back":** re-park; hold released.
- **Labels in chat:** `src/renderer/hub/chat/turns.ts` maps `mcp__windows__*`
  calls to friendly verbs: "Pressed Shuffle in Spotify", "Read your Wi-Fi
  adapter".
- **Fix report:** the canvas convention, plus Undo buttons (journal IPC
  `desktop:undo`).
- **Phone:**
  - `bridge.ts` includes `tier` on the pending-approval row;
  - Android shows tier text; no inline Approve for T3/T4 (owner Q7);
  - "Needs you at the PC" for UAC;
  - screenshot events reach the phone as image blocks with `thumb` (check
    `transcript.ts` handles `screenshot`).
- **Settings → "Desktop control":**
  - on/off;
  - blocked apps;
  - ask-first apps;
  - "first use of each app asks" toggle;
  - a link to the journal.

**Acceptance**
- During task 1, the Desk tab shows Spotify updating while parked. Show me
  brings it forward on one click; Hand back hides it again; the agent waits
  while it's taken.
- A phone T3 approval opens the app instead of approving from the
  notification.
- Fluidity: profile the Desk tab on the hub; frames cost < 5% CPU at 2 fps.

---

### Phase 4 — Borrowed input, vision fallback, app memory, operator subagent

**Borrowed input** — built (2026-10-07) as `input_act {window, steps, why}`,
with the owner's answer in §6 (no card in Full access or Approve-for-me). It
differs from the sketch below in three ways:
- steps are batched in one call, not one tool per click;
- the idle wait is 1.5 s, not 3 s;
- DEX's input is told apart by its own `dwExtraInfo` mark, not the
  injected flag (other tools' injected input counts as the user's).

The sketch as first planned:
- **The tool:** `input_borrow {window, reason, seconds≤30}`, category
  `app-control`, always a card unless the owner allows "when idle"
  (owner Q3).
- **After approval, the host:**
  1. waits for user idle ≥ 3 s;
  2. shows a click-through, top-most edge-glow window with a countdown and
     "Move the mouse to take back control" (the Windows-MCP pattern);
  3. activates the target;
  4. installs `WH_MOUSE_LL` and `WH_KEYBOARD_LL` hooks, and aborts on any
     input without the injected flag (`LLMHF_INJECTED`/`LLKHF_INJECTED`);
  5. runs `input_click {x,y}` / `input_type {text}` / `input_key {key}` with
     SendInput, inside that window only;
  6. restores the cursor position and the previous foreground at the end.
- **The approval cards' real-pointer guard (Phase 1) is mandatory here.** So
  is the DEX-self refusal: injected input could otherwise click Approve.

**Vision fallback**
- `window_capture {annotate:true}` → the model picks a handle, or a point
  inside a borrowed window.
- Only for controls with no pattern. Record it with `dex-state step-fail
  --tool uia --fallback vision`.

**App memory**
- `$DEX_APP_MEMORY_DIR/<exe>.md`: per-app notes of working routes
  (AutomationIds, names). Written by the agent after success, read before
  acting, like site memory.

**Operator subagent** (Claude Code only)
- Pass `--agents '{"desk-operator":{"description":"Carries out one GUI
  sub-goal in one Windows app with the mcp__windows__ tools, then reports
  what changed.","prompt":"…","tools":[<explicit mcp__windows__ names>],"model":"haiku"}}'`.
  The subagent `model` field and `--agents` are verified in the Claude Code
  docs [V]; a wildcard in `tools` is [U], so list the names.
- Enable behind a setting. Measure the 3 tasks' time and tokens against the
  main model. Keep it only if it's cheaper *and* as reliable.

**`ui_batch`**
- `{window, steps:[{tool,args,expect?}]}` runs several pattern actions with a
  check after each, stopping at the first mismatch.
- It is UFO2's speculative multi-action, done deterministically.

**Acceptance**
- An app with a canvas control (Paint: pick a colour swatch that has no
  pattern) completes through a borrowed-input step:
  - the user saw the countdown;
  - moving the mouse aborted it, then a retry finished it.
- No input is ever injected without an approved card.

---

### Phase 5 — Optional isolation and helper service (owner decisions)

- **RDP child session**, for Pro/Enterprise PCs [L]:
  - enable with `WTSEnableChildSessions(TRUE)` in an elevated batch;
  - a viewer: a small native host for the RDP ActiveX control with
    `ConnectToChildSession` [V]. Electron can't host ActiveX;
  - run `host.ps1` *inside* the child session; talk over a named pipe with a
    DACL;
  - the Desk tab shows the viewer.
  - Spikes needed:
    - how to start the executor in the child session [U];
    - GPU and painting while the viewer is hidden ("display exists only
      while the viewer is attached" [L]);
    - whether per-user apps (Spotify) and HKCU are the same user's (yes, same
      user [V]).
- **Windows isolation session / agent workspace:** adopt when Microsoft makes
  a public, stable API for third parties.
  - Today: Insider Experimental + a private WinMD (MXC), or Copilot only [V].
  - Note: it runs as a *separate agent account*, which can't reach the user's
    HKCU (touchpad) or per-user apps (Spotify). So it suits file and app work,
    not "fix my PC".
- **Privileged helper service** (owner Q1):
  - a LocalSystem service installed once (one UAC);
  - a typed allowlist (the `system_change` actions only, no shell);
  - a named pipe whose DACL allows only the installing user;
  - requests signed with a per-install key held by DEX main.
  - It removes per-batch UAC and enables phone approval of admin steps. It
    deliberately weakens UAC for those actions.
- **MCP on Windows / ODR:** with package identity (sparse MSIX, owner Q5),
  DEX could also consume Windows' own connectors (File Explorer; Settings on
  Copilot+ PCs) [V]/[L], and register its own.

---

## 5. Risks (whole project)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Apps with little UIA (canvas, games, some CEF builds) | High for some apps | A task can't finish focus-free | Phase 4 borrowed input with consent; tell the user plainly; app memory |
| 2 | Packaged apps (Settings) activate on launch and suspend when minimized | High | Focus incidents | API-first; Settings is show-only; S1/S3 |
| 3 | Off-screen Chromium/CEF windows stop painting or updating | Medium | Stale tree, blank frames | Sliver or behind parking; capture validation; S2/S4 |
| 4 | UIA's default `AutoSetFocus` slips back in (a new code path, a library) | Medium | Focus steals | One UIA factory in `DexDesk.cs`; a unit test asserts `AutoSetFocus==0` after creation; the focus sentinel on every call |
| 5 | The agent approves its own card through UIA, or later through injected input | Medium | A security failure | DEX-self refusal; real-pointer guard; S5; phone answers unaffected |
| 6 | The engine's native shell runs system changes ungated | High (already true today) | Unapproved changes | Phase 2 hook; instructions; non-elevated privilege boundary; Codex gap (Q11) |
| 7 | UAC interrupts every admin batch; it can't be done from the phone | Certain | UX | Batch to one UAC; Q1 helper service |
| 8 | A destructive fix leaves the PC worse (no network, no touchpad) | Low–medium | High | Cheapest rung first; alternate-input check; restore point; export before delete; cards spell out effects |
| 9 | Prompt injection through app or document content | Medium | High | Tiers, cards with reasons, T3/T4 always ask, content is data |
| 10 | `Add-Type` blocked (AMSI/CLM/WDAC) | Low on home PCs | No desktop control | Detect and explain; fallback exe |
| 11 | Hung UIA providers | Medium | Stuck calls | Timeouts, host restart, `provider_timeout` |
| 12 | Two DEX tasks drive the same app | Low | Conflicts | Per-window lease in `deskState` (the first session owns it; others get `busy`) |
| 13 | Privacy: captures of the user's windows go to the model and the phone | Medium | Trust | Target window only; blocklist; password redaction; captures deleted with the task; Settings shows the blocklist |
| 14 | Token cost of trees | Medium | Cost and latency | Compact node format, find-first, depth caps, `ui_batch` |
| 15 | Spotify Web API limits (Premium + 5 users per app) | Certain | No API route for most users | UIA + SMTC route is primary; BYO app optional (Q4) |

---

## 6. Owner decisions

### Answered (2026-10-06)

These override anything above that says otherwise.

1. **Elevation (Q1): no per-action admin prompt.** Admin steps run elevated without a UAC "Yes/No" each time, like Codex's Full access or Claude Code's bypass mode. Whether DEX asks first is decided by the **existing Approvals setting**, on the desktop and the phone:
   - *Full access*: admin steps just run;
   - *Approve for me*: a card for admin and destructive steps;
   - *Ask*: a card for everything.

   **Mechanism:** a one-time setup (the only UAC prompt, from Settings) registers an elevated helper as a scheduled task, `DEX\Elevated`, run as the same user with highest privileges. It is the user's own elevated token, so HKCU (touchpad gestures) and per-user apps still work. DEX starts it on demand with no prompt, and talks to it over a named pipe whose DACL allows only that user, with a per-install secret. It runs only the typed `system_change` actions; there is no free shell.

   This replaces the "one UAC per batch" design of §4.2.4. The batch card stays for *Approve for me* and *Ask*.
2. **Full access is quiet (Q2): yes.**
   - T2 (reversible) changes run without a card.
   - So do T3 (destructive) and T4 (admin) under *Full access*, following the owner's answer to Q1.
   - The undo journal, backups and restore point still happen before every T3 step, with or without a card.
   - "Refused" stays refused in every mode: DEX's own windows, password managers, and security settings such as Defender, the firewall, UAC and BitLocker.
3. **Borrowed input (Q3): take it immediately, no card.** When an app can't be driven in the background, DEX uses the real mouse and keyboard at once. Because the user must never be blocked, it also:
   - shows the edge-glow and "DEX is using your mouse — move it to take over" (§Phase 4);
   - **hands control back the instant the user moves or types** (the low-level hooks), and resumes only after they've been idle ≥ 2 s;
   - restores the cursor position and the previous foreground window after each burst.

   In practice that means short bursts in the gaps of the user's own input.
4. **Firebase rule for phone subagents:** deployed (owner's OK, 2026-10-06).

### Still open


1. **Elevation.**
   - (a) One UAC prompt per approved batch. The default; needs the user at
     the PC.
   - (b) Install a privileged DEX helper service once, which allows phone
     approval of admin fixes. It deliberately weakens UAC for allowlisted
     actions.
2. **How quiet "Full access" is.**
   - Should T2 (reversible system changes) run without a card under Full
     access?
   - Should the first use of each app in a task ask ("Let DEX use Spotify for
     this task?")?
3. **Borrowed input** (Phase 4): never? Only with a card each time? Or
   automatically when the PC has been idle ≥ N seconds?
4. **Spotify Web API:** worth a "bring your own Spotify developer app"
   connection (Premium; 5 users per app)? Or UIA + SMTC only?
5. **Package identity (sparse MSIX):** worth the installer work, to use
   Windows' MCP agent connectors and future agent-workspace APIs?
6. **Isolation:**
   - Upgrade this PC to Windows Pro for an RDP child-session backend?
   - Or wait for Microsoft's agent workspace / isolation-session APIs to
     become public?
7. **Phone approvals of destructive (T3) steps:** allowed straight from the
   notification? Or only inside the app, with biometric unlock?
8. **Restore points:** may DEX set `SystemRestorePointCreationFrequency` (an
   HKLM write, once) so it can make a fresh restore point before each
   destructive batch? Or keep Windows' 24-hour limit?
9. **The 151 KB MIT interop DLL:** commit it in the public repo? Or download
   it at first run from NuGet with a pinned SHA-256?
10. **Default blocklists:**
    - **Blocked:** password managers, banking and trading apps, other AI
      agent apps, terminals, Windows Security.
    - **Ask-first:** email and chat apps' Send actions?
11. **Codex engine:** no verified hook or deny-rule equivalent was found for
    its native shell. Accept instruction-only gating for Codex? Or route
    desktop/system tasks to Claude Code?
