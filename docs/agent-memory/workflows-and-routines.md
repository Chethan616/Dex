---
name: workflows-and-routines
description: "Owner's spec (2026-10-14) for DEX workflows/daily routines — NL create/edit, /workflow lists them as gen-UI cards, View opens an n8n-style graph, phone too, scheduled runs"
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
