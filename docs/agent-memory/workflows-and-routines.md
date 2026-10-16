---
name: workflows-and-routines
description: "DEX workflows/daily routines — owner spec 2026-10-14, BUILT 2026-10-15 (8963092f desktop, de842ac8 phone): dex-workflow CLI, /workflow cards, n8n-style graph, scheduler"
metadata:
  node_type: memory
  type: project
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-10-14T16:16:12.434Z
---

The owner asked (2026-10-14) for workflows and daily routines in DEX:

- Saying "create a daily routine for me", "make a workflow", "do this every morning / every week" makes DEX **save it to memory**; it can later **update, edit and delete** them by natural language.
- **`/workflow`** in the composer shows every saved workflow by name **as a gen-UI widget in the chat** (cards, like the flight cards from the widget kit, [[widgets-genui]]).
- Each card has a **View** button (like Select/Book on flight cards) that opens an **n8n-style graph** of the workflow: nodes and edges, in DEX's own theme, SVG icons, colours and tokens.
- Same on the **phone** app; scaling must be good on desktop and mobile.
- Scheduled ones ("every morning") should run on their schedule.

**Why:** the owner wants DEX to handle routines, not only one-off tasks; they judge it by UX ("neat", matching the app's look).

**How to apply:** the full request and its order (pause/resume chip first, app pickers, troubleshooting, then workflows, then a release) is the "THIRD batch" in the RESUME HERE block of `TO_BE_DONE.md`. Read it before starting. Related: [[keep-resume-log]], [[desktop-control-plan]].

**Built 2026-10-15 (second PC):** `src/shared/workflows.ts` (schema, triggerText, isDue with a 3 h catch-up, the run prompt), `main/workflows/store.ts` (`<userData>/workflows.json`) + `scheduler.ts` (30 s tick, records the run before starting), control route `POST /dex/workflow`, CLI `dex-tools/dex-workflow` + `workflows.md`, widget type `workflows` (each item is a whole workflow), hub `hub/workflows/` (cards, `WorkflowGraph` snake layout, pan/zoom written straight to the DOM), `/workflow` bare in a task = local via `SlashCommand.inTask` (no agent turn), phone `ui/components/WorkflowGraph.kt` (Run now = a reply message, so no Firestore rules change). Steps are linear on purpose. Desktop seen live; phone only rendered with Robolectric.

**2026-10-15 evening:** the owner's first real try failed. Asked to "add that to the workflow", the agent (Claude Code, Haiku) used Claude Code's own `schedule` skill and made a cloud routine instead of using `dex-workflow`, so `/workflow` stayed empty.
- Fixed in `942efa59`: DEX's Claude Code runs get `--disable-slash-commands` plus `--disallowedTools CronCreate,CronDelete,CronList,RemoteTrigger,ScheduleWakeup`.
- Phone-sent `/workflow` is now expanded in main (`shared/slashCommands.ts`).
- If a routine still doesn't save, check the task's events in `%APPDATA%/DEX/sessions.db` (`session_events`) for which tool the agent used.
- **Codex equivalent:** `in_app_local_automation` and Codex's own `browser_use`, `in_app_browser` and `computer_use` are off in DEX's tasks via `-c features.X=false`. Don't use `--disable`: it errors on a feature name an older Codex lacks.
- **Second try failed too (2026-10-15 ~22:20):** the owner's DEX was a dev build started before the fixes. Check what's running before blaming the code: `Get-Process electron`'s path and start time, and whether `electron-forge` actually restarted main.
- **Now:** every prompt carries DEX's memory and the routine rules (`engines/memory.ts`). "execute <routine name>" runs it directly (`workflowCalledFor`). Clean-up steps use `temp_clean`, `recycle_bin_empty` and `app_close`.

- **Third failure (2026-10-16), the real one:** Claude Code now runs commands through its **PowerShell** tool on Windows, and Windows PowerShell 5.1 puts a BOM in front of anything it pipes to a program (and .NET's UTF8 writes one into files). `dex-workflow create` embedded stdin raw, so every spec arrived as `"spec":﻿{…}` → "not valid JSON". Fixed in 0972e13c: the BOM is stripped in `dex-lib.sh` (`dex_stdin`) and in `localTaskServer.readBody`. There's also a no-JSON form: `dex-workflow create "<name>" --when "every day at 8am" --step "pc: …"`, plus `--file`. Schedules parse from words and cron (`triggerFromText`). Debug a failing tool by reading `session_events` for the exact command and its output.
