---
name: windows-desktop-control
description: Drive native Windows app GUIs (Office, Settings, Calculator, file dialogs, Photoshop, anything Win32) via UFO2 and the Windows accessibility tree. NOT for browser tasks -- use run_browser_task instead.
os: ["windows"]
always: false
---

# Windows Desktop Control

This skill teaches you to drive **native Windows application GUIs** through Microsoft UFO2, via the `windows-desktop-control` MCP server's single tool `run_desktop_task`.

## When to reach for this

Use `run_desktop_task` for tasks happening inside a native Win32 app's UI:

- Office apps: Word, Excel, PowerPoint, Outlook
- Image / video tools: Photoshop, Premiere, custom drawing apps
- Windows Settings, Control Panel, system dialogs
- Calculator, Notepad, File Explorer, native file pickers
- Any program where shell/file tools can't reach the answer AND it's not a webpage

## When NOT to use this

- **Just OPENING / launching an app** ("open notepad", "open whatsapp", "start chrome") → use the `exec` shell tool: `Start-Process notepad`, `Start-Process "WhatsApp"`, `Start-Process chrome`. It's instant and never times out. run_desktop_task is only for CLICKING/TYPING inside an app once it's open — never to open one.
- **Anything inside a webpage** (forms, scraping, web-based tests, multi-page flows in Chrome / Edge / Vivaldi / Firefox) → use `run_browser_task` (browser-control skill). UFO2 can technically poke a browser's window chrome, but it's the wrong tool for DOM-level work.
- **Sending messages/files via WhatsApp, Telegram, Discord, or Slack when that channel is PAIRED in Dex** → use the `message` tool (one call, seconds). Only GUI-drive a messenger app when no channel is paired.
- Reading or editing files — use the shell/edit tools.
- Pure data work (parsing, math, transforms) — do it inline.

## Prefer shell when possible

Before calling `run_desktop_task`, check whether the goal (or a sub-step of
it) is one of these shell-solvable patterns — if so, use the `exec` tool
instead. A PowerShell one-liner finishes in seconds; navigating Settings UI
for the same result takes minutes and can time out:

- Current wallpaper → copy `$env:APPDATA\Microsoft\Windows\Themes\TranscodedWallpaper` to a `.png` — this file ALWAYS exists and is the live image. (The registry `HKCU:\Control Panel\Desktop\WallPaper` path can point at a moved/deleted file — observed ENOENT in practice.)
- Launch an app → `start <name>` / `Start-Process` (then drive its UI with `run_desktop_task` only if the task continues INSIDE the app)
- DNS change → Write `Set-DnsClientServerAddress -InterfaceAlias "Wi-Fi" -ServerAddresses "1.1.1.1","1.0.0.1"` to a temporary `.ps1` file (e.g. `set-dns.ps1`) in the workspace, and execute it elevated: `Start-Process powershell -Verb RunAs -ArgumentList '-File','set-dns.ps1'` (user approves ONE UAC prompt), then verify with `Get-DnsClientServerAddress -InterfaceAlias "Wi-Fi"`. Cleaning up the `.ps1` afterwards is recommended. NEVER navigate the Settings UI for DNS — it times out.
- Display resolution / audio device → PowerShell + `DisplaySwitch.exe` / CIM
- Service start/stop → `Start-Service` / `Stop-Service`
- Env vars → `[Environment]::SetEnvironmentVariable(...)`
- Registry read/write → `Get-ItemProperty` / `Set-ItemProperty`
- Full-screen screenshot → PowerShell `System.Drawing` capture (no GUI driving needed)

For compound tasks, mix freely: shell for the data step, `run_desktop_task`
for the GUI step. Example: "send my wallpaper to X on WhatsApp" = `exec`
(copy `TranscodedWallpaper` to a `.png`) THEN `run_desktop_task` (attach the
file in WhatsApp). You CAN open and drive desktop apps like WhatsApp — never
tell the user you're unable to operate applications.

## How to call

```jsonc
run_desktop_task({
  "goal": "In Excel, sum column B from B2 to B40 and place the total in B41",
  "app_hint": "Excel",
  "timeout_s": 120,
  "dry_run": false
})
```

- `goal` — one clear sentence. Include the operation, the target app, and any cell/file/range that matters.
- `app_hint` — the app to focus first. Omit if obvious from the goal.
- `timeout_s` — hard cap, 1-600s. Default 300. Settings / Control-Panel navigation and multi-window flows need the full default; only lower it for trivial single-window steps.
- `dry_run` — `true` to plan without executing. **Not currently wired** in v1; prefer the user-confirmation rule below.

Returns: `{ ok, summary, steps, task_id, log_path }`. `ok=false` means the task failed or was refused — surface `summary` to the user.

## User confirmation — REQUIRED before every real call

Before calling `run_desktop_task` with `dry_run=false`, you MUST:

1. State the plan to the user in one short paragraph. Use plain steps:
   > "I'll focus Excel, select B2:B40, and write =SUM(B2:B40) into B41. Approve?"
2. Wait for explicit approval (`yes`, `approve`, `do it`, or equivalent). A bare "ok" is acceptable; ambiguous responses are not.
3. On denial or silence, do not call the tool. Ask one clarifying question or move on.

This convention is the Action Preview surface in the Dex UI. Skipping it bypasses the user's safety review.

## Behavior rules

- Pass exactly one logical operation per call. Multi-app workflows: chain calls.
- If the tool returns failure, summarize what happened from `summary` and the log_path. **Retry at most once**, and only if the failure looks transient (a window not yet ready). Never silently re-issue after a refusal or an explicit failure.
- The tool will refuse destructive patterns (formatting drives, disabling antivirus, BitLocker, mass deletion). If you see `refused: ...` in the summary, do not paraphrase your way around it — explain to the user why and stop.
- Long tasks: prefer a sequence of shorter calls (each with its own approval) over one mega-call with timeout_s=600.

## Examples

**Good:** "I'll open Calculator and compute 12 × 9. Approve?" → user: "yes" → `run_desktop_task({ goal: "compute 12 × 9", app_hint: "Calculator" })`.

**Bad:** Calling without explaining. The Dex UI relies on your plan message as the Action Preview content.
