---
name: plain-words-steps
description: Owner wants every user-facing step (live island, chat, notifications) in plain words like the flight demo — never raw commands, paths or tool names
metadata:
  type: feedback
---

On 2026-10-15 the owner sent phone screenshots of the live island showing "Ran browser-harness-js <<'EOF'" and "Read /tmp/vtop-academics-menu.png", and a task titled "/workflow". They asked: "it's not user friendly; display something understandable like the flight demo live island".

**Why:** the owner judges DEX by its UX. Raw tool output reads as broken to a normal user.

**How to apply:**
- Any step text a user sees goes through `transcript.ts` `classifyTool`/`stepPhrase`: the agent's own description or code comment, put into present and past tense, else what the code does.
- Titles go through `taskTitle`.
- When adding a tool or CLI, give it words in `DEX_CLI` or `KIND_META`.
- Check the phone's live update text too: it's the bridge's `lastLine`.

Related: [[widgets-genui]], [[workflows-and-routines]].
