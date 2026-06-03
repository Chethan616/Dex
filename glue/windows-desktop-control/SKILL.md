---
name: windows-desktop-control
description: Control Windows app GUIs (click, type, automate Office/Excel/Edge/Photoshop/system panels) via UFO2. Use ONLY for tasks that need a real app's interface.
os: ["windows"]
always: false
---

# Windows Desktop Control

This skill teaches you to drive **Windows application GUIs** through Microsoft UFO², via the `windows-desktop-control` MCP server's single tool `run_desktop_task`.

## When to reach for this

Use `run_desktop_task` ONLY when the user's request needs a real GUI:

- Office apps: Word, Excel, PowerPoint, Outlook
- Browser-rendered tasks where the page is the UI (not scriptable via fetch/curl)
- Image/video tools: Photoshop, Premiere, custom drawing apps
- Windows Settings, Control Panel, system dialogs
- Any program where shell/file tools can't reach the answer

**Do not use this for:**
- Reading or editing files — use the shell/edit tools.
- Web scraping where HTTP fetches work — use the web tool.
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
