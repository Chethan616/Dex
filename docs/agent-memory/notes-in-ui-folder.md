---
name: notes-in-ui-folder
description: "The user leaves instructions for Claude as screenshot file names in DEXV3/UI/ (e.g. \"claude_see_this_i_missed_inprompt_…png\")"
metadata:
  node_type: memory
  type: user
  originSessionId: baacd51d-de97-451d-b014-856abd9e3f87
  modified: 2026-09-30T16:21:23.133Z
---

The user sometimes adds a request they forgot to type as a screenshot in `DEXV3/UI/`, with the request in the file name itself, addressed to Claude: `claude_see_this_i_missed_inprompt_i_want_you to redesign the chat UI in desktop like the minibar tool….png` (2026-09-30, the Codex-style chat redesign).

**Why:** it was spotted only by chance (a VS Code window title); the request would otherwise have been missed.

**How to apply:** when resuming DEX/unify work, glob `UI/claude_see_this*` (and look at new files in `UI/`) and treat them as part of the user's request. Never commit `UI/` (see [[project-overview]]).
