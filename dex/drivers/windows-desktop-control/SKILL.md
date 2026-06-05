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

- **Anything inside a webpage** (forms, scraping, web-based tests, multi-page flows in Chrome / Edge / Vivaldi / Firefox) → use `run_browser_task` (browser-control skill). UFO2 can technically poke a browser's window chrome, but it's the wrong tool for DOM-level work.
- Reading or editing files — use the shell/edit tools.
- Pure data work (parsing, math, transforms) — do it inline.

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
- `timeout_s` — hard cap, 1-600s. Default 120 is fine for one app-step. Bump for multi-step flows.
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
