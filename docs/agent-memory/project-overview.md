---
name: project-overview
description: What DEX is today (2026-10) — the Electron desktop app plus the Android companion; where things live; branches
metadata:
  type: project
---

DEX (repo Chethan616/Dex, public) is an AI agent that works on the user's Windows PC beside them, plus a phone app.

- **Desktop:** `desktop/app` (Electron + React + TypeScript).
  - Each task gets a workspace: shared live browser tabs, documents, and a chat.
  - Engines: Claude Code, Codex, or BrowserCode/OpenCode.
  - Connectors: built-in accounts plus the Marketplace's hosted MCP servers; see [[connectors-marketplace]].
- **Phone:** `android/` (Compose, M3 Expressive), paired via the user's own Firebase project; see [[phone-and-accounts]].
- **Branches:** `unify` is the working branch, and `main` is kept equal to it.
- **The hand-over is `TO_BE_DONE.md`.** Next big item: Windows app/OS control, see [[desktop-control-plan]].

On 2026-10-07 the old Python/Flutter era code was deleted: the `dex/` OpenClaw fork, the 7-agent design and Agent-S3. Ignore older notes about "slices", "Brain/Orchestrator" or branch `v3/dex`.

**Why:** older memories described that abandoned design and misled resumptions.

**How to apply:** start from `TO_BE_DONE.md` and the code; release steps are in [[release-process]].
