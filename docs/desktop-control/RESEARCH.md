# Research: autonomous Windows app and OS control without taking the user's hands

Written 2026-10-06 for the `unify` branch of DEX. The plan built on this is
[`PLAN.md`](PLAN.md).

**The question.** How can DEX carry out multi-step goals in Windows apps and in
the OS itself, such as these:

- "open Spotify, play this playlist on shuffle";
- "troubleshoot my Wi-Fi";
- "my touchpad gestures stopped working, fix it".

It must do this while the person keeps using the same PC: no stolen focus, no
hijacked cursor or keyboard, no windows popping up in front of them.

**How claims are marked**

| Mark | Meaning |
|---|---|
| **[V]** | Verified. I read the primary source (Microsoft Learn, the project's own repo or docs, vendor docs), quoted or paraphrased closely. |
| **[V-local]** | Verified by running it on the owner's PC (Windows 11 Home 26H2, build 26300.9457, Windows PowerShell 5.1). Only read-only commands, plus a throwaway window owned by the probe itself. |
| **[L]** | Likely. A secondary source, or strong indirect evidence. Not confirmed first-hand. |
| **[U]** | Unverified. A plausible claim I could not confirm. Treat it as a question for a spike. |

The repo is public. Other projects' approaches are described here, never
pasted.

---

## 0. Summary

1. **The one technique that is focus-free, general and works today is UI
   Automation (UIA) control patterns, with `AutoSetFocus` turned off.**
   - **Setup.** I built a throwaway WinForms window. It could be activated, and
     it sat off-screen and never in front.
   - **What worked.** UIA3 `Invoke`, `ValuePattern.SetValue`, `Toggle` and
     `SelectionItem.Select` all worked from Windows PowerShell 5.1:
     - four actions took about 0.55 s, of which 0.45 s was deliberate settle
       waits;
     - the foreground window did not change;
     - the cursor did not move. [V-local]
   - **What failed.** With UIA's default setting, the same calls made the
     hidden window the foreground window. That is a real focus steal.
     [V-local]
   - **Microsoft documents this default.** "By default, most UI Automation
     methods that perform an action on an element … set focus to the element
     before performing the action." [V] (IUIAutomation2::AutoSetFocus)
   - **The rule:** every DEX UIA client must set `AutoSetFocus = false`, and
     must never call `SetFocus()`.
2. **OS tasks barely need a GUI.**
   - **Wi-Fi.** Diagnosis is fully possible in the background, with no admin:
     - `Get-NetAdapter`;
     - `netsh wlan show interfaces`;
     - the WLAN-AutoConfig and NCSI event logs. [V-local]
   - **Touchpad.** Diagnosis is also fully background, with no admin:
     - the documented `SPI_GETTOUCHPADPARAMETERS`;
     - the `PrecisionTouchPad` registry values;
     - PnP driver properties. [V-local]
   - **Repairs** use `pnputil`, `netsh`, PowerShell and the registry.
   - **The hard part is permission, not focus.** Many repairs need admin, and
     a UAC prompt *always* takes over the screen. It appears on the secure
     desktop on this PC. [V-local]
3. **Media is fully background.**
   - The System Media Transport Controls (SMTC) session API plays, pauses,
     skips and sets shuffle/repeat without focus.
   - It is reachable from PowerShell 5.1 on this PC. [V-local]
   - It cannot start a *specific* playlist. That needs either:
     - Spotify's own UI, reached through UIA; or
     - the Spotify Web API, which needs Premium. Since February 2026 it also
       needs a developer app whose owner has Premium, and it is capped at 5
       users. [V]
4. **True isolation (a second session the agent owns) is not available to DEX
   on this PC today.**

   | Option | Why not today |
   |---|---|
   | UFO2's "Picture-in-Picture" desktop | Never shipped. The UFO FAQ says "planned for future releases". [V] |
   | RDP child sessions, the mechanism behind that idea | Need Windows Pro or Enterprise [L]. They are off on this PC [V-local]. |
   | Windows "isolation sessions" (MXC) | An Insider Experimental build (26340.9212+) and a private WinRT API. `SendInput` is blocked inside them. [V] |
   | Windows "agent workspace" | For Copilot Actions only. An admin-only, experimental toggle. [V] |

   These are a later phase, not the foundation.
5. **Nobody ships focus-free Windows computer use yet.**
   - OpenAI's Codex Computer Use docs say that on Windows it "runs on the
     active desktop … expect ChatGPT to move the pointer, type, and take over
     the foreground". [V]
   - Anthropic documents background operation for Claude's computer use only
     on macOS 15+. [V]
   - So the approach above, "API first, UIA without focus, borrow the user's
     input only with permission", would put DEX ahead of both on Windows.
6. **Biggest risks**
   - **Apps that expose little to UIA.** Canvas UIs, and Chromium/CEF apps
     whose renderer accessibility is off.
   - **Packaged (UWP/WinUI) apps such as Settings.** They suspend when
     minimized [V], and launching them may activate them [L].
   - **Off-screen Chromium windows may stop painting** [L].
   - **The agent's own native shell bypasses DEX's approval gate.** Engines
     run with `--dangerously-skip-permissions`.
   - **The agent could click DEX's own Approve button through UIA.** This has
     to be closed.

---

## 1. Focus-free control techniques

### 1.1 What the probes measured (this PC, 2026-10-06)

Probe scripts are in the session scratchpad, not committed.

- **The test window:**
  - the probe creates its own WinForms window: a button, a text box, a check
    box and a list;
  - it is shown *without activation* at (-32000, -32000);
  - so it is never on screen and never foreground.
- **The UIA client:**
  - UIA3, through the COM client (`CUIAutomation8`);
  - via the MIT-licensed `Interop.UIAutomationClient` 10.19041.0 assembly,
    loaded into Windows PowerShell 5.1 with `Add-Type`.

| Run | Window style | AutoSetFocus | Invoke / SetValue / Toggle / Select | Foreground changed? | Cursor moved? |
|---|---|---|---|---|---|
| 1 | `WS_EX_NOACTIVATE` | default (on) | all four took effect | no (the style blocks activation) | no |
| 2 | normal, activatable | **0** | all four took effect, 548 ms (450 ms of it settle waits) | **no** | no |
| 3 | normal, activatable | **default (1)** | all four took effect, 567 ms | **yes: the hidden probe window became foreground** | no |

[V-local]

**Other measurements**
- Cold start: compiling the C# helper and loading the interop took about
  0.2 s. The first UIA call came after about 0.85 s in total. Walking the
  taskbar subtree (29 elements) took 42 ms. [V-local]
- `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` captured the off-screen
  window correctly in runs 1 and 2, with the typed text, the ticked box and
  the selected row visible. [V-local]
- In run 3, the capture taken just after the window was activated came back
  with the frame only and a blank client area. **Captures must be validated
  and retried**, the same lesson DEX learned with `capturePage()` on hidden
  views (TO_BE_DONE §1.4). [V-local]

**Conclusions**
- UIA patterns drive non-foreground windows without focus or cursor, **only
  with `IUIAutomation2.AutoSetFocus = FALSE`**. [V]
  ([Learn: AutoSetFocus](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomation2-get_autosetfocus))
- `IUIAutomation2` also has `ConnectionTimeout` and `TransactionTimeout`, to
  bound calls into a hung provider. [V]
  ([Learn: IUIAutomation2](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nn-uiautomationclient-iuiautomation2))
- These runs used Win32 common controls. WPF, UWP/WinUI (Settings) and
  Chromium/CEF (Spotify) providers implement patterns differently. Each needs
  its own check (spikes in PLAN Phase 0). [U]

### 1.2 Technique by technique

| Technique | Focus-free? | What it can do | What it can't | Status |
|---|---|---|---|---|
| **UIA patterns, `AutoSetFocus=false`**: Invoke, Value, Toggle, ExpandCollapse, SelectionItem, Scroll, ScrollItem, Window, RangeValue | Yes | Click, type into fields, tick boxes, pick list items, expand, scroll, minimize or close windows. Works on windows that are behind, off-screen or (for Win32) minimized | Elements with no pattern (canvas, custom-drawn, games). Elevated windows (UIPI). Anything needing real keystrokes, such as shortcuts or IME | [V-local] for Win32; [U] per framework |
| UIA `Invoke` contract | n/a | "Calls to this method should return immediately without blocking. However, this behavior depends on the implementation." Some providers block (modal dialogs), so calls need timeouts | | [V] [Learn](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationinvokepattern-invoke) |
| UIA `ValuePattern.SetValue` | Yes (with AutoSetFocus off) | Sets text atomically; read back to verify. Providers should refuse when `IsReadOnly` | Rich editors that expose only TextPattern; password fields (DEX must refuse them by policy) | [V] [Learn](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-implementingvalue) |
| UIA2 (managed `System.Windows.Automation`, used by the old `dex-uia`) | Same rules | Works for Win32/WinForms | "does not work well with WPF or even worse with Windows Store Apps" (FlaUI). Use UIA3 (COM) | [V] [FlaUI README](https://github.com/FlaUI/FlaUI) |
| MSAA `LegacyIAccessible.DoDefaultAction` | Likely | A fallback for old Win32/WinForms controls with no Invoke | Same limits | [L] |
| `SendMessage`/`PostMessage` (`BM_CLICK`, `WM_SETTEXT`) | Yes | Classic Win32 buttons and edits | Keyboard simulation through posted `WM_KEYDOWN`/`WM_CHAR` is unreliable: posted messages don't update key state, and they skip `WH_KEYBOARD` hooks. Chen's advice: "use UI Automation … or SendInput" | [V] [Chen 2005](https://devblogs.microsoft.com/oldnewthing/20050530-11/?p=35513), [Chen 2025](https://devblogs.microsoft.com/oldnewthing/20250319-00/?p=110979) |
| `SendInput` / pyautogui / `SendKeys` | **No** | Anything a human can do | Goes into the system input stream, so the foreground window and real cursor are used. "Subject to UIPI." Fails silently against higher-integrity windows | [V] [Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput) |
| `SetForegroundWindow` (activating a window) | **No**, by definition | | Windows itself limits it. A process may take the foreground only if, among other conditions, it "was started by the foreground process" or "received the last input event". **Processes DEX spawns while DEX is in front can steal focus**, so DEX must launch and act without activation on purpose | [V] [Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow) |
| COM automation (Office `Application` objects, `Shell.Application`) | Likely yes | Office documents, Explorer windows, shell verbs, without UI | Only apps with an object model. Office must be installed (it isn't checked here) | [L] |
| URI / protocol activation (`spotify:`, `ms-settings:`) | **No** in general | Opens the target app at a place | The target usually comes to the front (not checked here). Use it to *show* the user something, or to launch an app that is then parked off-screen | [L] |
| Settings deep links | Same as URIs | Documented pages include `ms-settings:network-wifi`, `network-status`, `network-advancedsettings`, `devices-touchpad`, `troubleshoot`, `appsfeatures` | | [V] [Learn](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings-app) |
| **System Media Transport Controls**: `GlobalSystemMediaTransportControlsSessionManager` | Yes | `TryPlayAsync`, `TryPauseAsync`, `TryTogglePlayPauseAsync`, `TrySkipNext/PreviousAsync`, `TryChangeShuffleActiveAsync(bool)`, `TryChangeAutoRepeatModeAsync`, `TryGetMediaPropertiesAsync`, `GetPlaybackInfo`, change events. Any app that publishes a session | Can't choose *what* to play (no "play playlist X"). Whether shuffle/repeat work depends on the app (`PlaybackInfo.Controls.IsShuffleEnabled`) | [V] [Learn](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession); `RequestAsync` works from PS 5.1 here [V-local] |
| PowerShell / CIM / WMI / `netsh` / `pnputil` / `winget` / registry / `SystemParametersInfo` | Yes, with no UI at all | Most OS diagnosis and repair | Many writes need admin, which means a UAC prompt on the secure desktop. That interrupts by design | [V-local] (pnputil verbs, logs, SPI); UAC behaviour [V] (see §5) |
| UIA against elevated windows (Task Manager or regedit run as admin, MMC snap-ins started elevated) | n/a | | A medium-integrity client "cannot access elevated … process UI". Getting past that needs `UIAccess`, which requires an Authenticode-signed binary in a secure location such as Program Files. DEX installs per-user with Squirrel, so **DEX cannot drive elevated UI**. That is also a useful safety property | [V] [Learn](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview) |

### 1.3 Launching apps without stealing focus

**What Windows offers**
- `STARTUPINFO.wShowWindow` passes `nCmdShow` to the new process's first
  `ShowWindow`. With `SW_SHOWMINNOACTIVE` (7) or `SW_SHOWNOACTIVATE` (4), a
  Win32 app that honours it starts without activating. [L]
- Then `SetWindowPlacement` with `showCmd = SW_SHOWNOACTIVATE` and an
  off-screen `rcNormalPosition` can "park" the window where it renders but the
  user doesn't see it. [U]

**Problems for each kind of app**
- **Chromium/CEF apps** (Spotify, Electron) may ignore the first `nCmdShow`.
  [U]
- **Off-screen or fully covered Chromium windows** can be marked occluded and
  stop painting.
  - DEX hit exactly this with its own off-screen stage and had to disable
    `CalculateNativeWinOcclusion` for itself (TO_BE_DONE §1.4).
  - DEX can't pass that flag to a third-party CEF app. [L]
- **Packaged (UWP/WinUI) apps such as Settings:** "When the user minimizes an
  app Windows waits a few seconds … Windows suspends the app."
  - So a minimized Settings window is frozen, and UIA on it will stall.
  - Packaged apps are activated through the shell, which usually brings them
    forward. [V] ([Learn: app lifecycle](https://learn.microsoft.com/en-us/windows/uwp/launch-resume/app-lifecycle)) / [L]
- **Spotify specifically:** a third-party widget that drives Spotify through
  UIA reports two things:
  - it "adds [to Liked Songs] without stealing focus" through Spotify's
    accessibility tree;
  - but "Spotify freezes that information while its window is minimized".
  [L] ([spotify-taskbar-widget](https://github.com/mechanicwb2-hub/spotify-taskbar-widget). Unlicensed: described, not used.)

**The practical rules**
- DEX launches apps itself, without activation, and parks them off-screen,
  not minimized.
- It treats packaged apps as "API first, show only".
- It never moves, minimizes or closes windows it didn't open.

---

## 2. Isolation: the agent's own session

| Option | How it works | Focus-free? | Requirements | Fit for DEX |
|---|---|---|---|---|
| **UFO2 Picture-in-Picture** | Paper: "Windows' native Remote Desktop Protocol (RDP) loopback, creating a distinct virtual session hosted on the same machine". Apps "inherit the user's identity, credentials, settings"; mouse and keyboard "fully scoped to that session"; named-pipe IPC to the host [V] ([arXiv 2504.14603](https://arxiv.org/abs/2504.14603)) | Yes, by design | **Not released.** The UFO FAQ says "Picture-in-Picture mode is planned for future releases". Issue #222 ("When to release …", May 2025) is unanswered. DEX's June 2026 notes found the same by grepping UFO at commit `adef15b8` [V] ([FAQ](https://github.com/microsoft/UFO/blob/main/documents/docs/faq.md), [#222](https://github.com/microsoft/UFO/issues/222)) | No code to reuse. The idea maps to child sessions (next row). MIT licence [V] |
| **RDP child session** (the documented loopback mechanism) | "a special loopback Remote Desktop session that is tied to a user's existing session". Turned on with `WTSEnableChildSessions`, joined through the RDP ActiveX control's `ConnectToChildSession` property. Logs on as the same user without asking for credentials. "One active and connected child session at any given time"; no lock screen [V] ([Learn](https://learn.microsoft.com/en-us/windows/win32/termserv/child-sessions)) | Yes: its own input queue and desktop | Windows Pro or Enterprise in practice (childstream: "Windows 10/11 **Pro** (tested on Windows 11 Pro 25H2)") [L]. **This PC is Home:** `WTSIsChildSessionsEnabled` returns false and RDP inbound is off (`fDenyTSConnections=1`) [V-local]. Enabling needs admin. A viewer needs the RDP ActiveX control in a native host. "Display exists only while the viewer is attached" [L] ([childstream](https://github.com/mattxslv/childstream)) | Best "real isolation" for Pro users. The executor must *run inside* the child session (UIA can't cross sessions) and talk to DEX over a pipe. A later, optional phase. OpenAI and Anthropic both have open feature requests for it ([codex#51134](https://github.com/openai/codex/issues/51134) [V]; claude-code#99740 seen in search results [U]) |
| **Win32 alternate desktop** (`CreateDesktop`/`SwitchDesktop`) | A second desktop object in WinSta0 | Input reaches only the *input desktop*. "Window messages can be sent only between processes that are on the same desktop", and hooks too [V] ([Learn](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)) | No edition limit | **Rejected.** The agent can't use SendInput there. UIA clients must run on that desktop. GPU and DWM composition for a non-input desktop are poor [L] |
| **Windows virtual desktops** (`IVirtualDesktopManager`) | Public API: `IsWindowOnCurrentVirtualDesktop`, `GetWindowDesktopId`, `MoveWindowToDesktop` only. No API to create one. Microsoft's guidance: apps "should avoid automatically switching the user from one virtual desktop to another" [V] ([Learn](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ivirtualdesktopmanager)) | No. Same session, same input. Activating a window on another virtual desktop switches the user there [L] | Creating desktops needs undocumented internal interfaces [L] | **Rejected** |
| **Windows Sandbox / a Hyper-V VM** | Hypervisor-isolated, disposable Windows. "Host-installed software isn't available in the sandbox" [V] ([Learn](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/)) | Yes | "Pro, Enterprise, and Education" [V]. Not installed here [V-local] | **Rejected** for these tasks: it isn't the user's Spotify, Wi-Fi or touchpad |
| **Windows "agent workspace" / agent accounts** (Copilot Actions) | "agent workspace runs in a separate Windows session, allowing agents to interact with apps in parallel to your own session"; "Each agent operates using its own account". The Settings toggle is System > AI components > Agent tools > Experimental agentic features: admin-only, off by default. Preview builds 26100.7344+, published 2025-10-16, updated 2025-11-17 and 2025-12-05 [V] ([support](https://support.microsoft.com/en-us/windows/experimental-agentic-features-a25ede8a-e4c2-4841-85a8-44839191dfb3), [security book](https://learn.microsoft.com/en-us/windows/security/book/operating-system-agentic-security)) | Yes | Today Copilot Actions only. "The Windows platform and its security controls will be available for other developers in preview soon" [V]. No public third-party API found [U]. The agent account sees only six known folders, and apps "available to all users" (not per-user installs such as Spotify's default) [V] | **Watch.** It would also run as a *different* account, so the user's HKCU (touchpad settings, Spotify login) is out of reach |
| **MXC "isolation_session"** (Microsoft Execution Containers, MIT) | Provisions a per-run Windows *agent user* and a separate OS session via the WinRT `Windows.AI.IsolationSession.Preview` API: "private WinMD", "gated on an internal Windows feature flag". In that session "window creation, GDI … work; only input injection is blocked … `SendInput` returns `ERROR_ACCESS_DENIED`"; its "windows are unreachable and invisible" to the user [V] ([MXC](https://github.com/microsoft/mxc), [isolation-session docs](https://github.com/microsoft/mxc/tree/main/docs/isolation-session)) | Yes | Insider **Experimental** build 26340.9212+ (released 2026-08-17) [V] ([notes](https://learn.microsoft.com/en-us/windows-insider/release-notes/experimental/preview-build-26340-9212)). This PC is 26300 [V-local] | **Watch.** Good for sandboxed *commands*. For GUI work an agent would need UIA (no SendInput) and a viewer API that isn't public. A different user account again |
| **Windows 365 for Agents** (Cloud PC) | Managed Cloud PCs for agents, "Generally available (within Agent 365)" (Build 2026) [V] ([Windows Dev Blog](https://blogs.windows.com/windowsdeveloper/2026/06/02/build-2026-furthering-windows-as-the-trusted-platform-for-development/)) | Yes | An enterprise subscription | **Rejected** for personal PC repair |

**Microsoft's agent stack, as of 2026-10**

- **MCP on Windows / On-device Agent Registry (ODR)**
  - `odr.exe` lists and manages MCP "agent connectors". There are built-in
    File Explorer and Windows Settings connectors. [V]
    ([overview](https://learn.microsoft.com/en-us/windows/ai/mcp/overview))
  - The host quickstart requires build 26220.7262+.
  - It also requires an MCP host "with package identity" (MSIX): "not
    enforced in the public preview release but it will be in the stable
    release". [V]
    ([quickstart](https://learn.microsoft.com/en-us/windows/ai/mcp/quickstart-mcp-host))
  - The Settings connector is described for Copilot+ PCs. [L]
  - On this PC `odr.exe` is absent, though `Windows.AI.Agents.dll` and
    `AgentGovernanceCSP.dll` are in System32. [V-local]
  - DEX ships with Squirrel, not MSIX: package identity is an owner decision.
- **App Actions on Windows**
  - Content-centric "atomic" actions (translate text, process an image),
    implemented by apps through URI or COM. [V]
    ([Learn](https://learn.microsoft.com/en-us/windows/ai/app-actions/))
  - Not app control. Low value here.
- **Taskbar agents** (`@`-mention in Ask Copilot)
  - Rolling out from April 2026 through the `Windows.UI.Shell.Tasks` API.
  - Only Microsoft 365 Researcher at the time. [L]
    ([Windows Latest](https://www.windowslatest.com/2026/04/18/microsoft-confirms-ai-agents-are-still-coming-to-the-windows-11-taskbar-as-it-prepares-for-public-rollout/))
- **Not adopted from secondary sources**
  - Several third-party Build 2026 recaps describe a "Windows Agent
    Framework/Runtime/Store". The Windows Developer Blog post I read doesn't
    use those names.
  - These are **not** treated as facts here. [U]

---

## 3. Seeing without focus

| Method | Occluded / off-screen | Minimized | Notes | Status |
|---|---|---|---|---|
| `PrintWindow` + `PW_RENDERFULLCONTENT` (0x2) | Yes, for the Win32 probe window off-screen | No useful image [L] | The flag is in `winuser.h` but not on the Learn page, which documents only `PW_CLIENTONLY` [V]. One blank frame right after activation, so validate (non-uniform pixels) and retry [V-local] | [V-local] |
| Windows.Graphics.Capture (WGC) | Occluded: yes | "minimized windows return a typed error" [L] | A yellow capture border unless `IsBorderRequired=false`. That needs `GraphicsCaptureAccess.RequestAccessAsync(Borderless)` and a packaged capability (`graphicsCaptureWithoutBorder`) [V] ([Learn](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired)). Codex's Windows Computer Use uses WGC and broke on builds before 20348 over `IsBorderRequired` [V] ([codex#25178](https://github.com/openai/codex/issues/25178)) | [V]/[L] |
| DWM thumbnail (`DwmRegisterThumbnail`) | Yes (live, GPU-composited) | Last frame [L] | Source and destination must be top-level. The destination must belong to the calling process [V] ([Learn](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmregisterthumbnail)). It draws *above* web content in DEX's window: the same z-order problem as native views (TO_BE_DONE §1.4) | [V] |
| Electron `desktopCapturer.getSources({types:['window']})` | [U] | [U] | Already in DEX's stack; returns thumbnails of every window (costly per frame) | [U] |
| `Graphics.CopyFromScreen` (old `dex-screen`) | **No.** It copies screen pixels, so it needs the window visible and in front | No | Implies bringing the window forward. Don't reuse | [V] (by construction) |
| UIA tree reading | Yes | Win32: yes; UWP: frozen (suspended); Spotify: stale [L] | The main "eyes". Cheap (tens of ms) [V-local]. Must redact `IsPassword` fields (`UIA_IsPasswordPropertyId` = 30019 [V-local]) | [V-local] |

**Chromium, Electron and CEF accessibility**

- "Chrome doesn't enable accessibility for the main web area by default
  unless it detects a screen reader or other advanced assistive technology";
  `--force-renderer-accessibility` overrides that. [V]
  ([Chromium](https://www.chromium.org/developers/accessibility/windows-accessibility/))
- From Chrome 138, Chromium on Windows "enable[s] native UI Automation (UIA)
  support by default". [V]
  ([Chrome blog](https://developer.chrome.com/blog/windows-uia-support-update))
- Chromium also turns accessibility on when it sees assistive-technology
  queries, such as `WM_GETOBJECT` for a custom object id. [L]
- So for a CEF app (Spotify):
  - the first UIA walk may return a thin tree;
  - a second walk, a moment later, should be full. [U]
- The bundled Chromium version decides whether UIA is native or goes through
  the MSAA/IA2 bridge. [U]
- **Side effect inside DEX:** a UIA client that walks DEX's own hub window
  would switch on Chromium accessibility in DEX itself, which costs CPU.
  DEX's UIA host must never walk DEX's windows.

---

## 4. The three example tasks

### 4.1 "Open Spotify, go to <playlist>, shuffle and play"

Spotify isn't installed on this PC [V-local], so nothing below was run.

**Recipe (no focus change, no Premium needed)**
1. **Resolve the playlist.**
   - An `open.spotify.com/playlist/<id>` link becomes
     `spotify:playlist:<id>`. [L] (Spotify's URI format)
   - If only a name is given: search inside the app through UIA (set the
     search box's value, invoke the result), or ask the user for the link.
2. **Make sure Spotify is running.** Look for its SMTC session or process.
   If it isn't running, launch it without activation and park it off-screen
   (§1.3). [U] for CEF
3. **Open the playlist.**
   - Preferred: UIA in the parked window (search, or Your Library → item).
   - `spotify:` URI activation also works, but probably brings Spotify
     forward [L]. Use it only when the user is fine seeing it.
4. **Turn shuffle on.**
   - First choice: SMTC `TryChangeShuffleActiveAsync(true)`, if
     `Controls.IsShuffleEnabled`. [V] for the API; [U] for Spotify's support
   - Otherwise UIA: Spotify's shuffle button is drivable through UIA
     ("Shuffle (Spotify): all three modes — off … shuffle … Smart Shuffle")
     [L]. Use `Toggle` or `Invoke`, reading the button's name before and
     after.
5. **Play the playlist itself.** UIA `Invoke` on the playlist page's Play
   button. SMTC `TryPlayAsync` only resumes whatever context is already
   loaded. [V] (SMTC has no context argument)
6. **Verify:**
   - SMTC `PlaybackStatus == Playing`;
   - `IsShuffleActive == true`;
   - `TryGetMediaPropertiesAsync` gives the track and artist.

**What can be done where**

| | |
|---|---|
| Fully background | 1, 4 (via SMTC), 6 |
| Needs Spotify's GUI (parked, not shown) | 3, 5 |
| Needs approval | Nothing, except launching an app under the "Ask" approval mode |

**Alternative: the Spotify Web API** (all background)
- `PUT /v1/me/player/shuffle?state=true`, then `PUT /v1/me/player/play` with
  `context_uri`.
- Scope `user-modify-playback-state`, and "only works for users who have
  Spotify Premium". [V]
  ([Spotify](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback))
- Since 2026-02-11 (2026-03-09 for existing apps), Development Mode apps need
  an owner with Premium and allow **5 users**. Extended quota needs a
  registered business. [V]
  ([migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide))
- So DEX can't ship one shared Spotify client ID. At most it can offer an
  optional "bring your own Spotify app" connection.

### 4.2 "Open Windows Settings and troubleshoot my Wi-Fi"

**Diagnose: all background, no admin** [V-local] unless marked

1. **The adapter.**
   - `Get-NetAdapter`: status, link speed, driver version and date.
   - `Get-PnpDevice -Class Net` and `pnputil /enum-devices /class Net` for
     the device and driver.
2. **The radio and link.** `netsh wlan show interfaces` gives state, signal,
   band, channel, radio type and rates.
   - **Caveat:** since Windows 11 24H2, some WLAN APIs return
     `ERROR_ACCESS_DENIED` without location consent.
   - `netsh` lives in System32, so "no prompt is shown".
   - Fall back to `Get-NetAdapter` and the event logs, and tell the user
     which Location setting to enable. [V]
     ([Learn](https://learn.microsoft.com/en-us/windows/win32/nativewifi/wi-fi-access-location-changes))
3. **IP and DNS.**
   - `Get-NetIPConfiguration`: a 169.254.x.x address means DHCP failed.
   - `Get-DnsClientServerAddress`.
   - `Test-NetConnection` to the gateway, to a public IP on 443, and to
     `www.msftconnecttest.com`.
   - `Resolve-DnsName`.
   - Proxy and VPN adapters. [L] that each needs no admin
4. **History.**
   - `Microsoft-Windows-WLAN-AutoConfig/Operational`:
     - 8000/8001 connect, 8003 disconnect;
     - 11000–11010 association and security.
     - Here: 405 events in 48 h, 9 disconnects. [V-local]
   - `Microsoft-Windows-NCSI/Operational` and the DHCP client Admin log.
     [V-local]
5. **The full report.**
   - `netsh wlan show wlanreport` writes
     `C:\ProgramData\Microsoft\Windows\WlanReport\wlan-report-latest.html`.
   - It needs admin. [L]
     ([Windows Central](https://www.windowscentral.com/software-apps/windows-11/how-to-generate-a-wi-fi-report-on-windows-11))
6. **The old troubleshooters are gone.**
   - The MSDT troubleshooters were retired: redirection to Get Help started in
     2023 and was completed in 2024; "2025 – Remove the MSDT platform". [V]
     ([support](https://support.microsoft.com/en-us/windows/experience/deprecation-of-microsoft-support-diagnostic-tool-msdt-and-msdt-troubleshooters))
   - `msdt.exe` still exists on this PC [V-local]. Don't build on it.
   - No documented way to launch a Get Help troubleshooter by URI was found.
     [U]

**Fix ladder** (each rung is gated as in §5)
- **Rung 1: no admin, reversible.**
  - Flush DNS (`Clear-DnsClientCache` or `ipconfig /flushdns`). [L] no admin
  - Disconnect and reconnect to the saved profile
    (`netsh wlan disconnect`, then `netsh wlan connect name=<profile>`). [L]
    no admin
- **Rung 2: admin, reversible.**
  - `Restart-NetAdapter`.
  - DHCP release and renew.
  - DNS back to DHCP, or to a resolver the user picks. The old daemon read
    back DNS per adapter so its check could fail properly (git `3348ced9`,
    `daemon/handlers/network_handler.py`).
  - Adapter power-management changes.
- **Rung 3: admin, disruptive.**
  - `netsh winsock reset`, `netsh int ip reset`, and Settings → Network
    reset. All need a restart. [L]
  - Driver rollback or reinstall through `pnputil`.
- **Settings is opened only to show the result**
  (`ms-settings:network-status` / `network-wifi` [V]). It is never driven to
  diagnose.

### 4.3 "My touchpad works but gestures don't — fix it"

**Diagnose: all background, no admin**

1. **`SystemParametersInfo(SPI_GETTOUCHPADPARAMETERS)`** (0x00AE, Windows 11
   24H2+). [V]
   ([Learn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-touchpad_parameters_v1))
   - It returns:
     - `touchpadPresent` (a Precision Touchpad), `legacyTouchpadPresent`;
     - `externalMousePresent`, `touchpadEnabled`, `touchpadActive`,
       `allowActiveWhenMousePresent`;
     - `tapEnabled`, `twoFingerTapEnabled`, `panEnabled`, `zoomEnabled`,
       `scrollDirectionReversed`, `sensitivityLevel` …
   - The user-setting fields can be *written* with
     `SPI_SETTOUCHPADPARAMETERS`.
   - Three- and four-finger gestures are **not** in this structure. [V]
   - Here: precision touchpad present, 5 contacts, enabled and active, no
     external mouse, pan and zoom on. [V-local]
2. **Three- and four-finger settings** are DWORDs under
   `HKCU\Software\Microsoft\Windows\CurrentVersion\PrecisionTouchPad`:
   - `ThreeFingerSlideEnabled`, `FourFingerSlideEnabled`,
     `ThreeFingerTapEnabled`, `FourFingerTapEnabled`, and others.
   - Values here: `ThreeFingerSlideEnabled=1`, `FourFingerSlideEnabled=2`,
     `ThreeFingerTapEnabled=2`, `FourFingerTapEnabled=0`. [V-local]
   - The touchpad on/off switch is under `…\PrecisionTouchPad\Status`,
     `Enabled`. [V-local]
   - The meaning of each value (0 = nothing, 1 = switch apps, 2 = switch
     desktops …) and "sign out to apply" come from community tutorials. [L]
     ([ElevenForum](https://www.elevenforum.com/t/change-touchpad-three-finger-swipe-gestures-in-windows-11.7514/))
3. **Device and driver.**
   - `Get-PnpDevice` / `Get-PnpDeviceProperty`: status, problem code,
     provider, version, date, INF.
   - Here: "ASUS Precision Touchpad" with a vendor driver (`oem29.inf`,
     16.0.0.27, 2024-07-01) over the inbox `hidi2c.inf`. [V-local]
   - Look for vendor gesture utilities and services that can override Windows
     gestures. [L]
4. **Common causes, in order:**
   1. a gesture set to "Nothing";
   2. a legacy (non-precision) touchpad, so Windows gesture settings don't
      apply;
   3. the touchpad inactive while a mouse is present;
   4. a broken or outdated vendor filter driver;
   5. a shell glitch (restarting Explorer is visible to the user, so it needs
      approval). [L]

**Fixes**
- `SPI_SETTOUCHPADPARAMETERS` for documented fields. Expected to apply at
  once. [U]
- Registry values for three- and four-finger gestures, through
  `dex-registry` (backed up, card). May need sign-out [L]. A spike should
  check whether Settings or the input stack picks up registry changes live.
  [U]
- `pnputil /restart-device <instance>` (admin).
- **Driver reinstall:** `pnputil /export-driver` first, then
  `/delete-driver oemNN.inf /uninstall`, then `/scan-devices`. Verbs present
  here [V-local].
  - Destructive: the touchpad can disappear.
  - Only with an external mouse or keyboard present, a restore point, and
    explicit approval.
- Show `ms-settings:devices-touchpad` [V] when done, or when the user would
  rather flip it themselves.

---

## 5. Safety tiers and gates

### 5.1 What exists in DEX today (read in code)

- **`src/main/approvals/policy.ts`**
  - Categories: `registry-write` (always prompts),
    `filesystem-write-unsafe-path`, `process-launch`, `service-control`.
  - Modes: `ask` / `auto` / `full`. The default is `full`.
  - Lifetimes: `once` / `turn` / `session`.
  - Unknown categories become `registry-write`, so the safe direction.
- **`POST /dex/confirm` in `src/main/index.ts`**
  - Puts up a blocking card.
  - Times out after 10 minutes, which counts as a denial.
- **`ConfirmationCard`** in `src/renderer/hub/PreviewDeck.tsx` renders the
  card in the pane header.
- **The phone** answers the same card (`answer_confirmation` in
  `src/main/firebase/bridge.ts`, and `ApprovalActionReceiver.kt`).
- **`dex-registry`** backs up the key, describes the exact change, and waits
  for a person.
- **Gap 1: the native shell bypasses all of this.**
  - Claude Code runs with `--dangerously-skip-permissions`, and Codex with
    `--dangerously-bypass-approvals-and-sandbox` (the adapters).
  - So the agent's own Bash or PowerShell can run `netsh`, `pnputil`,
    `winget uninstall` or `reg add` with no card. `registry.md` admits as
    much.
  - Claude Code's permission docs: "**Deny rules block in every mode,
    including `bypassPermissions`**". `PreToolUse` hooks can deny calls too.
    [V] ([permission modes](https://code.claude.com/docs/en/permission-modes),
    [hooks](https://code.claude.com/docs/en/hooks))
  - String-pattern rules can be dodged. Privilege is the real boundary: the
    agent runs non-elevated [V-local].
- **Gap 2: Pause doesn't work on Windows.** `runEngine.ts` says: "Pausing an
  in-flight agent is not supported on Windows yet." Desktop actions need their
  own cooperative gate.
- **Gap 3: the agent can approve its own cards.** Any UIA client, including a
  PowerShell script the agent writes, can `Invoke` the Approve button in DEX's
  hub. Chromium exposes it through UIA. The card needs a guard that tells real
  pointer input from programmatic activation. [U] that Chromium's
  accessibility click lacks `pointerdown`/`pointermove`; needs a test

### 5.2 Earlier safety design in DEX's own history (reusable as text and rules)

All of this comes from the Python-era `SAFETY.md` and daemon (git `3348ced9`).

- **Four confirmation tiers:** hand-off; always confirm; pre-approval works;
  silent.
- **Registry bands, decided by `classify_write`:**
  - GREEN: silent. DEX's own keys and known-effect keys.
  - AMBER: confirm.
  - RED: refused even under Full Access. Covers `\Policies\`,
    `\CurrentControlSet\Services\`, Winlogon, LSA, Defender, `Run`/`RunOnce`,
    Image File Execution Options, UAC.
  - A boundary-safe prefix match, so `HKCU\Software\DEXTERITY` must not
    match `HKCU\Software\DEX`.
- **"Signed and versioned" confirmations:** an approval is bound to the exact
  step version.
- **Windows rules:**
  - never type into password or OTP fields (checks `IsPassword`);
  - never automate password managers, terminals, or DEX itself;
  - never act on an ambiguous window;
  - never change security or privacy settings;
  - never use Win-key shortcuts;
  - stop if the desktop is locked.

### 5.3 Rollback tools

**System Restore points**
- `Checkpoint-Computer`: "supported only on client operating systems". From
  Windows 8 it creates at most one restore point per 24 hours. It needs admin
  and exists in Windows PowerShell only (5.1 docs). [V]
  ([Learn](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/checkpoint-computer?view=powershell-5.1))
- The frequency can be changed with `HKLM\Software\Microsoft\Windows NT\
  CurrentVersion\SystemRestore\SystemRestorePointCreationFrequency` (minutes;
  0 = no skipping). [V]
  ([SRSetRestorePointW](https://learn.microsoft.com/en-us/windows/win32/api/srrestoreptapi/nf-srrestoreptapi-srsetrestorepointw))
- Changing it is itself an HKLM write, so it needs the owner's decision.
- On this PC `RPSessionInterval=1`, so System Restore is probably on, and no
  frequency override is set. [V-local]
- A restore point covers system files, drivers and the registry, not user
  files. [L]

**Backups before change**
- Registry: `dex-registry export` (exists).
- Drivers: `pnputil /export-driver <oem#.inf> <dir>` [V-local].
- Network: snapshot the DNS servers, IP config, and `netsh wlan export
  profile`. [L] that it works without admin for the key-less export

**An undo journal**
- One JSON record for each change, holding:
  - before-state;
  - command;
  - inverse command;
  - backup paths.
- Shown to the user as "Undo".
- New: nothing like this exists in the unify code.

**Dry-run**
- Every mutating tool can return the exact commands and the expected effect
  without running them. The approval card shows that text.

### 5.4 UAC is unavoidable for admin actions

- This PC prompts admins on the secure desktop:
  `ConsentPromptBehaviorAdmin=5`, `PromptOnSecureDesktop=1`. DEX runs
  non-elevated. [V-local]
- While the UAC dialog is open the system is on the Winlogon desktop [V]
  ([Learn: Desktops](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)),
  so **every elevation interrupts the user** and can't be answered from the
  phone.
- **Option 1: one UAC per approved batch.** Gather all admin steps the user
  approved and run them in a single elevated script.
- **Option 2: a one-time-installed privileged helper service.**
  - It accepts only typed, allowlisted operations over a named pipe with a
    real DACL (as in the Python era's SAFETY.md §6).
  - The UAC prompt happens once, at install.
  - This deliberately weakens UAC for those operations. The owner must
    decide.
- Anthropic's advice for Claude computer use on Windows says the same: keep
  UAC prompts and admin-only windows under direct human control. [L] (seen in
  search results; not on the help page I read)

---

## 6. Prior art and reusable parts

| Project | Licence | What it is | Focus-free? | Reuse in DEX |
|---|---|---|---|---|
| **Microsoft UFO² / UFO³** | MIT [V] | Python. A HostAgent splits the request into subtasks and dispatches them to per-app AppAgents. "Puppeteer" chooses between app APIs and GUI actions. Controls come from UIA plus OmniParser vision (detections overlapping UIA by IoU > 10% are dropped). Speculative multi-action cuts LLM calls by up to 51.5%. WAA 27.9% and OSWorld-W 28.6% with GPT-4o [V] (paper). UFO³ "Galaxy" (Nov 2025) adds multi-device orchestration and MCP device agents; UFO² now "requires MCP … servers" [V] (README, FAQ) | No. PiP was never released [V] | **Ideas only:** the host/app split, API-before-GUI, batched speculative actions, the UIA+vision merge rule. Not the runtime: Python, heavy, foreground input. DEX ran it end-to-end in June 2026 (git `990d524f`) and dropped it |
| **Windows-MCP** (CursorTouch) | MIT [V] | Python 3.13 MCP server: Click/Type/Scroll/Move/Shortcut by coordinates, Snapshot (UIA tree), App, PowerShell, Registry … "ControlStatus": while the AI has control, moving the mouse hard or pressing Ctrl+Alt+Shift+Backspace takes it back. The README calls this "best-effort, not a security boundary". Telemetry on by default [V] | No (coordinates, foreground) | The **input-borrowing** UX: an edge glow, a hotkey, and losing control when the user moves. The tool list is a useful checklist |
| **Terminator** (mediar-ai) | MIT [V] | Rust core with Node/Python SDKs and an MCP agent: "Playwright for Windows". Claims it "doesn't take over your cursor or keyboard" [V] (README claim) | Claimed [U] | A candidate UIA backend with Node bindings (`@mediar-ai/terminator`). A native dependency means yarn.lock churn and prebuilt binaries. Evaluate in Phase 0 against DEX's own host |
| **FlaUI** | MIT [V] | .NET UIA2/UIA3 wrapper (`FlaUI.UIA3` 5.0.0 targets net48, net6/8) | n/a | Optional. DEX needs only the interop assembly it depends on |
| **Interop.UIAutomationClient** (Roemer) | MIT [V] | A 151 KB COM interop assembly for UIA3 (`lib/net45`) | n/a | **Bundle this.** It is what the probes used [V-local] |
| **pywinauto** | BSD-3 [V] | Python Win32/UIA automation; `invoke()` versus `click_input()` | Patterns yes; `*_input` no | Concepts only (Python isn't in DEX's runtime) |
| **yinkaisheng/uiautomation** (Python) | Apache-2.0 [V] | UIA3 via comtypes. Used by DEX's Python-era `uia_driver.py` | Patterns yes | **Port the logic** of `uia_driver.py` (git `3348ced9`): label normalisation (accelerators, "(Ctrl+S)"); exact > prefix > single-word match; ListItem retry when a "Button" isn't found; `AmbiguousWindow`; `SecretField`; read-back verification; 150 ms settle; `wait_for` |
| **DEX `feat/desktop-uia-cua`** (`dex-uia`, `dex-screen`, `dex-input`, `uia.md`, unmerged) | DEX (MIT) | PowerShell + one C# Add-Type per tool, UIA2. Every call reads the **foreground** window. Fallbacks: SetFocus+SendKeys and SetCursorPos+SendInput. Captures use CopyFromScreen. Adds `POST /dex/screenshot` | **No** | **Reuse:** the `/dex/screenshot` route and the `screenshot` event (the schema already exists on unify); the index-instability lesson ("read the tree again after every action"); one shared "worth listing" rule for tree and annotation. **Don't reuse:** the foreground targeting, the SendKeys and mouse fallbacks, CopyFromScreen |
| **Agent S3** (Simular) | Apache-2.0 [V] | Vision-first CUA. OSWorld 72.6% (bBoN); WindowsAgentArena 50.2% → 56.6% with 3 rollouts [V] (README) | No | A benchmark reference. Not the runtime |
| **Windows Agent Arena** | MIT [V] | Benchmark of 150+ Windows tasks in a VM | n/a | Borrow task *shapes* for DEX's acceptance set |
| **OmniParser** | Repo MIT; weights: `icon_detect_v3` MIT, "Earlier Ultralytics-based icon detectors retain their original AGPL" [V] | Screen parsing for vision fallback | n/a | Only the v3 weights if ever needed. Never the AGPL ones (LICENSES.md rule) |
| **OpenAI Codex Computer Use (Windows)** | Proprietary | WGC screenshots, accessibility text, key delivery, window activation [L] (issue #25178). Docs: "runs on the active desktop … take over the foreground"; "keep the target app visible" [V] ([docs](https://learn.chatgpt.com/docs/computer-use)). Background control is an open request ([#41323](https://github.com/openai/codex/issues/41323)) [V] | **No** on Windows | Its Windows sandbox makes local accounts; `CodexSandboxOffline`/`CodexSandboxOnline` exist on this PC [V-local] |
| **Anthropic Claude computer use** | Proprietary | API tool versions `computer_20250124` and `computer_20251124`. The reference implementation runs "inside a Docker container"; Anthropic advises a "virtual machine or container with minimal privileges" [V] ([docs](https://docs.claude.com/en/docs/agents-and-tools/tool-use/computer-use-tool)). In Cowork and Claude Code desktop: "On macOS (version 15 or later), Claude works in background windows … doesn't take over your pointer or keyboard"; asks per app; blocks trading and crypto apps by default; scans for prompt injection [V] ([help](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork)) | Background on macOS only | The per-app permission prompt and the default blocklist are good patterns |

---

## 7. UX patterns to build on

**What DEX already has** (from the code and TO_BE_DONE)
- The workspace tabs and chat.
- The bot moods.
- The **agent cursor**, which glides, waits for arrival, and is hidden from
  screenshots.
- The **polite agent**, which holds input while the user is active, up to
  8 s.
- The glow plus "DEX is working — you can use the page too" with Pause.
- `takeoverOverlay`, with "Stop and take over".
- Approval cards in the pane header.
- `dex-state` plan steps, and `dex-canvas` reports.
- The phone mirror, with approve/deny notifications and pause/resume/stop
  commands.

**What background OS work needs on top**
1. **A desk view.**
   - The window the agent is working in, as frames captured in the
     background.
   - A highlight drawn over the element being acted on (from UIA bounds).
     There's no real cursor to show.
   - Microsoft calls this "a way for users to authorize, monitor, and take
     over agent actions" [V] (security book).
2. **Take over and hand back.** Bring the parked window onto the user's
   screen (user-initiated, so allowed). DEX stops touching it until handed
   back.
3. **Approval cards that show tier, exact commands, the backup or restore
   point, and how to undo.** Destructive steps are allowed "once" only.
4. **A "fix report"** (dex-canvas): what was found, what changed, how to undo
   it.
5. **On the phone:**
   - tiered notifications;
   - "needs you at the PC" for UAC steps;
   - desk thumbnails at milestones.

---

## 8. Comparison of approaches

| Approach | Focus-free? | Works for | Reliability | Latency per action | Setup / edition | Licence / cost | Verdict |
|---|---|---|---|---|---|---|---|
| OS APIs (PowerShell, CIM, netsh, pnputil, winget, registry, SPI) | **Yes** | OS diagnosis and repair | High | 0.2–3 s (PowerShell start-up dominates) | None; admin for many writes (UAC) | In-box | **Primary for OS tasks** |
| SMTC | **Yes** | Media apps with an SMTC session | High (transport); app-dependent (shuffle/repeat) | < 100 ms [L] | None | In-box | **Primary for media transport** |
| UIA3 patterns, `AutoSetFocus=false` | **Yes** [V-local] | Win32/WinForms [V-local]; WPF/UWP/Chromium [U] | Medium–high; provider-dependent | ~25 ms per action plus a 100–150 ms settle [V-local] | Interop DLL (MIT); medium IL only | Free | **Primary GUI path** |
| UIA with the default `AutoSetFocus` | **No** [V-local] | | | | | | Never |
| MSAA DoDefaultAction / BM_CLICK / WM_SETTEXT | Yes | Old Win32 controls | Medium | Fast | None | In-box | Fallback inside the UIA host |
| URI / Settings deep links | No [L] | Apps with handlers | High | ~1 s | None | In-box | **Show the user only**, or launch-then-park |
| COM automation (Office, Shell) | Yes [L] | Office, Explorer | High | Fast | Office installed | In-box | Later, per app |
| SendInput / coordinates / vision | **No** | Everything | Medium (vision grounding) | 0.5–3 s with a model call | None | Model tokens | **Only by borrowing input with consent** (Phase 4) |
| PostMessage keyboard simulation | Yes | Few apps | **Low** [V] | Fast | | | Don't |
| Win32 alternate desktop | Partial | | Low | | | | Rejected |
| Virtual desktops | No | | | | No create API | | Rejected |
| RDP child session (UFO2-style PiP) | **Yes** | All apps, same user | High [L] | RDP compositor | **Pro/Enterprise** [L]; admin to enable once; ActiveX viewer host; one at a time | In-box | Optional later phase for Pro |
| MXC isolation session / agent workspace | **Yes** | Separate agent account | Unknown | Unknown | Insider Experimental / Copilot only | MIT SDK; private OS API | Watch |
| Windows Sandbox / VM | Yes | Not the user's apps or settings | High | | Pro+ | | Rejected for these tasks |
| UFO2 as an engine | No | Many apps | ~28–33% on WAA (2025) | Many model calls | Python 3.10/3.11, venv | MIT | Ideas only |
| Windows-MCP / Terminator as a dependency | No / claimed | Many apps | Unknown | | Python 3.13 / native Node module | MIT | Terminator: evaluate; Windows-MCP: ideas |

---

## 9. Unknowns (each becomes a spike or an owner decision)

1. UIA patterns with `AutoSetFocus=false` on:
   - **Settings** (WinUI): it suspends when minimized, so can it work
     non-minimized and behind or off-screen?
   - **Spotify** (CEF): its tree names, Invoke on Play and Shuffle,
     staleness when off-screen.
   - **WPF**.
2. Whether a CEF/Chromium window parked off-screen (not minimized) keeps
   painting and updating its accessibility tree. If not, try parking it
   mostly off-screen with a sliver showing, or keep it behind the user's
   windows.
3. Whether `STARTUPINFO.wShowWindow = SW_SHOWNOACTIVATE`/`SW_SHOWMINNOACTIVE`
   plus `SetWindowPlacement` launches Spotify and Settings without a visible
   pop or a focus change.
4. Whether URI activation (`spotify:playlist:…`) of an already-running
   Spotify activates its window.
5. Whether Spotify's SMTC session exposes shuffle (`IsShuffleEnabled`).
6. Whether registry changes to three- and four-finger gestures take effect
   without sign-out. Whether `SPI_SETTOUCHPADPARAMETERS` applies at once.
7. Whether a UIA `Invoke` on DEX's own Approve button produces
   `pointerdown`/`pointermove` events in Chromium. This decides the
   self-approval guard design.
8. MCP plumbing:
   - Does Claude Code pass its environment (`DEX_SESSION_ID`,
     `DEX_CONTROL_FILE`) to stdio MCP servers listed in a shared `mcp.json`?
     DEX's Blender server already relies on this, so [L].
   - Codex's MCP tool-call timeout, and Claude Code's, while a tool waits on
     an approval card.
9. AMSI/Defender, or Constrained Language Mode (WDAC/AppLocker), blocking
   `Add-Type` on some PCs. The old `TOBETESTED.md` flagged the same risk.
10. Whether child sessions work at all on Windows Home. [U] (likely not)
11. When the agent workspace and isolation-session APIs become public for
    third parties, and on which editions.
12. Codex: an equivalent of Claude Code's deny rules and `PreToolUse` hooks
    for blocking risky shell commands, and of `--agents` subagents with
    their own model. [U]
